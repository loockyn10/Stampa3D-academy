// Behaviour of 20261117120000_calculator_supplies.sql against a REAL Postgres (embedded, local only, never Supabase).
// Opt-in, like the other *-db tests:  npm i --no-save embedded-postgres pg && node --test tests/calculator-supplies-db.test.mjs
//
// Supabase pieces (roles, auth.users, auth.uid(), has_platform_access) and the pre-history calculator_product_types
// table (not versioned in the repo) are stubbed with the shape and RLS the app relies on.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireEmbeddedPgLock } from "./helpers/embedded-pg-lock.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  ({ default: pg } = await import("pg"));
} catch {
  // optional dev tooling not installed
}

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261117120000_calculator_supplies.sql"), "utf8");
const contingencyMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261118120000_calculator_supplies_contingency.sql"), "utf8");
const PORT = Number(process.env.CALCULATOR_SUPPLIES_TEST_PG_PORT) || 54371;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-calculator-supplies-pg-"));
const { buildProductTypeSupplyLines, priceSupplyLines } = loadTs("src/lib/calculator/supplies.ts");
let server;

const stub = `
do $r$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $r$;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.paid_users (user_id uuid primary key);
create function public.has_platform_access(uid uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.paid_users where user_id = uid) $$;
create function public.is_admin(uid uuid) returns boolean language sql stable as $$ select false $$;
grant execute on function public.has_platform_access(uuid), public.is_admin(uuid) to authenticated;
-- Pre-history calculator_product_types: per-user, owner policy + the restrictive paid-access policy of 20260912011034.
create table public.calculator_product_types (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  name text not null, multiplier numeric not null default 2, fixed_cost numeric not null default 0,
  sort_order integer default 0, is_active boolean not null default true);
alter table public.calculator_product_types enable row level security;
create policy calculator_product_types_own on public.calculator_product_types for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy calculator_free_requires_platform_access on public.calculator_product_types as restrictive for all to authenticated
  using (public.has_platform_access(auth.uid())) with check (public.has_platform_access(auth.uid()));
grant select, insert, update, delete on public.calculator_product_types to authenticated;
-- Pre-history calculator_settings (one row per user), same owner + restrictive paid-access policies.
create table public.calculator_settings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id),
  electricity_price_kwh numeric default 120, default_error_percent numeric default 5,
  platform_commission_percent numeric default 15, mercado_libre_extra_amount numeric default 0);
alter table public.calculator_settings enable row level security;
create policy calculator_settings_own on public.calculator_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy calculator_free_requires_platform_access on public.calculator_settings as restrictive for all to authenticated
  using (public.has_platform_access(auth.uid())) with check (public.has_platform_access(auth.uid()));
grant select, insert, update, delete on public.calculator_settings to authenticated;
`;

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  try {
    await server.initialise();
    await server.start();
  } catch (error) {
    // Puerto ocupado u otro fallo al arrancar: liberar el lock para no bloquear a los demás tests de DB.
    releaseLock();
    throw error;
  }
  const mk = (database = "postgres") => new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database });

  async function freshDb(name, { applyMigration = true } = {}) {
    const admin = mk();
    await admin.connect();
    await admin.query(`drop database if exists ${name}`);
    await admin.query(`create database ${name} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
    await admin.end();
    const c = mk(name);
    await c.connect();
    await c.query(stub);
    if (applyMigration) await c.query(migration);
    return c;
  }

  const newUser = async (c, { paid = true } = {}) => {
    const id = (await c.query(`insert into auth.users (email) values ($1) returning id`, [`u${Math.random()}@x.com`])).rows[0].id;
    if (paid) await c.query(`insert into public.paid_users values ($1)`, [id]);
    return id;
  };
  /** Runs `fn` as `authenticated` with auth.uid() = uid; always rolled back. */
  const as = async (c, uid, fn) => {
    await c.query("begin");
    try {
      await c.query(`set local role authenticated`);
      await c.query(`select set_config('app.uid', $1, true)`, [uid]);
      return await fn();
    } finally {
      await c.query("rollback");
    }
  };
  /** Same, but commits (seeds data through the real policies). */
  const asCommit = async (c, uid, fn) => {
    await c.query("begin");
    try {
      await c.query(`set local role authenticated`);
      await c.query(`select set_config('app.uid', $1, true)`, [uid]);
      const result = await fn();
      await c.query("commit");
      return result;
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
  };

  const productType = (c, uid, name, fixedCost = 0) => asCommit(c, uid, async () =>
    (await c.query(`insert into public.calculator_product_types (user_id, name, fixed_cost) values ($1, $2, $3) returning id`, [uid, name, fixedCost])).rows[0].id);
  // La app no manda user_id en la RLS: el default auth.uid() lo completa (igual que si lo mandara).
  const supply = (c, uid, fields) => asCommit(c, uid, async () => {
    const f = { category: "component", unit: "unit", unit_cost: 0, ...fields };
    const keys = Object.keys(f);
    return (await c.query(
      `insert into public.calculator_supplies (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
      Object.values(f),
    )).rows[0];
  });
  const link = (c, uid, typeId, supplyId, quantity, unit, sortOrder = 0) => asCommit(c, uid, async () =>
    (await c.query(
      `insert into public.calculator_product_type_supplies (product_type_id, supply_id, quantity, quantity_unit, sort_order) values ($1,$2,$3,$4,$5) returning *`,
      [typeId, supplyId, quantity, unit, sortOrder],
    )).rows[0]);
  const readAs = (c, uid, sql, params = []) => as(c, uid, async () => (await c.query(sql, params)).rows);

  try {
    await test("migration refuses to run without calculator_product_types and is idempotent", async () => {
      const admin = mk();
      await admin.connect();
      await admin.query(`drop database if exists cs_bare`);
      await admin.query(`create database cs_bare template template0`);
      await admin.end();
      const bare = mk("cs_bare");
      await bare.connect();
      await bare.query(`create schema auth; create table auth.users (id uuid primary key)`);
      await assert.rejects(bare.query(migration), /Missing dependency: public\.calculator_product_types/);
      await bare.end();

      const c = await freshDb("cs_idem");
      await c.query(migration);
      await c.query(migration);
      assert.equal((await c.query(`select count(*)::int n from pg_constraint where conname = 'calculator_product_type_supplies_supply_owner_fkey'`)).rows[0].n, 1);
      await c.end();
    });

    await test("existing product types and their results are untouched by the migration", async () => {
      const c = await freshDb("cs_upgrade", { applyMigration: false });
      const u = await newUser(c);
      await c.query(`insert into public.calculator_product_types (user_id, name, multiplier, fixed_cost) values ($1, 'Lámpara', 3, 500)`, [u]);
      await c.query(migration);
      assert.deepEqual((await c.query(`select name, multiplier::int m, fixed_cost::int f from public.calculator_product_types`)).rows, [{ name: "Lámpara", m: 3, f: 500 }]);
      assert.equal((await c.query(`select count(*)::int n from public.calculator_product_type_supplies`)).rows[0].n, 0);
      await c.end();
    });

    await test("D058 contingency: additive column defaults to 0 %, accepts 0–100 and keeps settings private", async () => {
      const db = await freshDb("cs_contingency");
      const owner = await newUser(db);
      const other = await newUser(db);
      const freeUser = await newUser(db, { paid: false });
      await db.query(`insert into public.calculator_settings (user_id, electricity_price_kwh) values ($1, 150), ($2, 90), ($3, 80)`, [owner, other, freeUser]);
      await db.query(contingencyMigration);
      await db.query(contingencyMigration);
      assert.equal((await db.query(`select count(*)::int n from pg_constraint where conname = 'calculator_settings_supplies_contingency_percent_range'`)).rows[0].n, 1);
      assert.deepEqual(
        (await db.query(`select electricity_price_kwh::int kwh, supplies_contingency_percent::text pct from public.calculator_settings where user_id = $1`, [owner])).rows,
        [{ kwh: 150, pct: "0.00" }],
        "las filas existentes quedan en 0 % y no cambia ningún otro ajuste",
      );

      await asCommit(db, owner, () => db.query(`update public.calculator_settings set supplies_contingency_percent = 5 where user_id = $1`, [owner]));
      assert.equal((await readAs(db, owner, `select supplies_contingency_percent::text pct from public.calculator_settings`))[0].pct, "5.00");
      await asCommit(db, owner, () => db.query(`update public.calculator_settings set supplies_contingency_percent = 100 where user_id = $1`, [owner]));
      await assert.rejects(as(db, owner, () => db.query(`update public.calculator_settings set supplies_contingency_percent = -1 where user_id = $1`, [owner])), /supplies_contingency_percent_range/);
      await assert.rejects(as(db, owner, () => db.query(`update public.calculator_settings set supplies_contingency_percent = 100.5 where user_id = $1`, [owner])), /supplies_contingency_percent_range/);

      // RLS sin cambios: B no ve ni modifica los ajustes de A; Free no accede a los ajustes de la calculadora.
      assert.deepEqual(await readAs(db, other, `select user_id from public.calculator_settings where user_id = $1`, [owner]), []);
      const hijack = await as(db, other, () => db.query(`update public.calculator_settings set supplies_contingency_percent = 50 where user_id = $1`, [owner]));
      assert.equal(hijack.rowCount, 0);
      assert.deepEqual(await readAs(db, freeUser, `select supplies_contingency_percent from public.calculator_settings`), []);
      assert.equal((await db.query(`select supplies_contingency_percent::int pct from public.calculator_settings where user_id = $1`, [owner])).rows[0].pct, 100);
      await db.end();
    });

    const c = await freshDb("cs_main");
    const ana = await newUser(c);
    const beto = await newUser(c);
    const free = await newUser(c, { paid: false });

    await test("catalog: create, edit cost, rename, archive and restore a supply", async () => {
      const foco = await supply(c, ana, { name: "  Foco   LED ", unit_cost: 1500 });
      assert.equal(foco.user_id, ana, "user_id defaults to auth.uid()");
      assert.equal(foco.name, "Foco LED", "name is normalized");
      await asCommit(c, ana, () => c.query(`update public.calculator_supplies set unit_cost = 1800.5, name = 'Foco LED E27' where id = $1`, [foco.id]));
      const [edited] = await readAs(c, ana, `select name, unit_cost::text cost, updated_at > created_at as touched from public.calculator_supplies where id = $1`, [foco.id]);
      assert.deepEqual(edited, { name: "Foco LED E27", cost: "1800.5000", touched: true });
      await asCommit(c, ana, () => c.query(`update public.calculator_supplies set archived_at = now() where id = $1`, [foco.id]));
      assert.ok((await readAs(c, ana, `select archived_at from public.calculator_supplies where id = $1`, [foco.id]))[0].archived_at);
      await asCommit(c, ana, () => c.query(`update public.calculator_supplies set archived_at = null where id = $1`, [foco.id]));
      assert.equal((await readAs(c, ana, `select archived_at from public.calculator_supplies where id = $1`, [foco.id]))[0].archived_at, null);
    });

    await test("catalog: no duplicate active names (case/space-insensitive); an archived name can be reused", async () => {
      const caja = await supply(c, ana, { name: "Caja 20x20", category: "packaging", unit_cost: 850 });
      await assert.rejects(supply(c, ana, { name: "  caja   20X20 " }), /calculator_supplies_active_name_idx|duplicate key/);
      await supply(c, beto, { name: "Caja 20x20" }); // otro usuario: permitido
      await asCommit(c, ana, () => c.query(`update public.calculator_supplies set archived_at = now() where id = $1`, [caja.id]));
      const again = await supply(c, ana, { name: "Caja 20x20", category: "packaging", unit_cost: 900 });
      assert.notEqual(again.id, caja.id);
    });

    await test("catalog: units, categories and costs are validated (non-negative, exact numeric precision)", async () => {
      await assert.rejects(supply(c, ana, { name: "Neg", unit_cost: -1 }), /calculator_supplies_unit_cost_check/);
      await assert.rejects(supply(c, ana, { name: "Pulgada", unit: "inch" }), /calculator_supplies_unit_check/);
      await assert.rejects(supply(c, ana, { name: "Otra", category: "other" }), /calculator_supplies_category_check/);
      await assert.rejects(supply(c, ana, { name: "Rollo", unit: "custom" }), /calculator_supplies_custom_unit_check/);
      await assert.rejects(supply(c, ana, { name: "Metro raro", unit: "m", custom_unit_label: "rollo" }), /calculator_supplies_custom_unit_check/);
      await assert.rejects(supply(c, ana, { name: "   " }), /calculator_supplies_name_length/);
      const cinta = await supply(c, ana, { name: "Cinta", unit: "custom", custom_unit_label: " rollo ", unit_cost: 0.35 });
      assert.equal(cinta.custom_unit_label, "rollo");
      assert.equal(String(cinta.unit_cost), "0.3500");
      const gratis = await supply(c, ana, { name: "Etiqueta", category: "packaging", unit_cost: 0 });
      assert.equal(Number(gratis.unit_cost), 0, "zero cost is allowed");
    });

    await test("security: user B cannot read, modify, delete or impersonate user A's supplies; Free cannot use the catalog", async () => {
      const secret = await supply(c, ana, { name: "Proveedor secreto", unit_cost: 999 });
      assert.equal((await readAs(c, beto, `select * from public.calculator_supplies where id = $1`, [secret.id])).length, 0);
      assert.equal((await readAs(c, beto, `select count(*)::int n from public.calculator_supplies where user_id = $1`, [ana]))[0].n, 0);
      const updated = await as(c, beto, () => c.query(`update public.calculator_supplies set unit_cost = 1 where id = $1`, [secret.id]));
      assert.equal(updated.rowCount, 0);
      const deleted = await as(c, beto, () => c.query(`delete from public.calculator_supplies where id = $1`, [secret.id]));
      assert.equal(deleted.rowCount, 0);
      assert.equal(Number((await c.query(`select unit_cost from public.calculator_supplies where id = $1`, [secret.id])).rows[0].unit_cost), 999);
      await assert.rejects(as(c, beto, () => c.query(`insert into public.calculator_supplies (user_id, name) values ($1, 'Falso')`, [ana])), /row-level security/);
      await assert.rejects(as(c, ana, () => c.query(`update public.calculator_supplies set user_id = $2 where id = $1`, [secret.id, beto])), /permission denied/);
      await assert.rejects(supply(c, free, { name: "Gratis" }), /row-level security/);
      assert.equal((await readAs(c, free, `select count(*)::int n from public.calculator_supplies`))[0].n, 0);
      await assert.rejects(as(c, ana, () => c.query(`set local role anon; select * from public.calculator_supplies`)), /permission denied/);
    });

    await test("components: add, change quantity, compatible units, remove; duplicates and bad quantities are rejected", async () => {
      const lampara = await productType(c, ana, "Lámpara");
      const cable = await supply(c, ana, { name: "Cable eléctrico", unit: "m", unit_cost: 450 });
      const resina = await supply(c, ana, { name: "Resina", unit: "kg", unit_cost: 3500 });
      const row = await link(c, ana, lampara, cable.id, 2, "m");
      assert.equal(row.user_id, ana);
      await link(c, ana, lampara, resina.id, 100, "g"); // g para un insumo por kg: compatible
      await assert.rejects(link(c, ana, lampara, cable.id, 1, "m"), /calculator_product_type_supplies_unique/);
      await assert.rejects(link(c, ana, lampara, resina.id, 1, "m"), /calculator_product_type_supplies_unique|calculator_supply_unit_mismatch/);
      const otro = await productType(c, ana, "Velador");
      await assert.rejects(link(c, ana, otro, resina.id, 1, "m"), /calculator_supply_unit_mismatch/);
      await assert.rejects(link(c, ana, otro, cable.id, 0, "m"), /calculator_product_type_supplies_quantity_check/);
      await assert.rejects(link(c, ana, otro, cable.id, -1, "m"), /calculator_product_type_supplies_quantity_check/);

      await asCommit(c, ana, () => c.query(`update public.calculator_product_type_supplies set quantity = 150, quantity_unit = 'cm' where id = $1`, [row.id]));
      const [changed] = await readAs(c, ana, `select quantity::float q, quantity_unit u from public.calculator_product_type_supplies where id = $1`, [row.id]);
      assert.deepEqual(changed, { q: 150, u: "cm" });
      await assert.rejects(asCommit(c, ana, () => c.query(`update public.calculator_product_type_supplies set quantity_unit = 'g' where id = $1`, [row.id])), /calculator_supply_unit_mismatch/);
      await assert.rejects(asCommit(c, ana, () => c.query(`update public.calculator_product_type_supplies set user_id = $2 where id = $1`, [row.id, beto])), /permission denied/);

      await asCommit(c, ana, () => c.query(`delete from public.calculator_product_type_supplies where id = $1`, [row.id]));
      assert.equal((await readAs(c, ana, `select count(*)::int n from public.calculator_product_type_supplies where product_type_id = $1`, [lampara]))[0].n, 1);
    });

    await test("security: associations never cross users (types, supplies and reads)", async () => {
      const anaType = await productType(c, ana, "Maceta");
      const anaSupply = await supply(c, ana, { name: "Plato", unit_cost: 200 });
      const betoType = await productType(c, beto, "Maceta B");
      const betoSupply = await supply(c, beto, { name: "Plato B", unit_cost: 100 });
      const anaLink = await link(c, ana, anaType, anaSupply.id, 1, "unit");

      await assert.rejects(link(c, ana, betoType, anaSupply.id, 1, "unit"), /calculator_product_type_not_owned/);
      await assert.rejects(link(c, ana, anaType, betoSupply.id, 1, "unit"), /calculator_supply_not_owned|calculator_product_type_supplies_supply_owner_fkey/);
      await assert.rejects(
        as(c, beto, () => c.query(`insert into public.calculator_product_type_supplies (user_id, product_type_id, supply_id, quantity, quantity_unit) values ($1,$2,$3,1,'unit')`, [ana, anaType, anaSupply.id])),
        /row-level security/,
      );
      assert.equal((await readAs(c, beto, `select * from public.calculator_product_type_supplies where id = $1`, [anaLink.id])).length, 0);
      assert.equal((await as(c, beto, () => c.query(`update public.calculator_product_type_supplies set quantity = 99 where id = $1`, [anaLink.id]))).rowCount, 0);
      assert.equal((await as(c, beto, () => c.query(`delete from public.calculator_product_type_supplies where id = $1`, [anaLink.id]))).rowCount, 0);
      assert.equal((await readAs(c, free, `select count(*)::int n from public.calculator_product_type_supplies`))[0].n, 0);
    });

    await test("references: a supply in use cannot be deleted nor switched to another dimension; kg ↔ g is allowed", async () => {
      const type = await productType(c, ana, "Jarro");
      const pintura = await supply(c, ana, { name: "Pintura", unit: "l", unit_cost: 8000 });
      await link(c, ana, type, pintura.id, 50, "ml");
      await assert.rejects(asCommit(c, ana, () => c.query(`delete from public.calculator_supplies where id = $1`, [pintura.id])), /calculator_product_type_supplies_supply_owner_fkey|foreign key/);
      await assert.rejects(asCommit(c, ana, () => c.query(`update public.calculator_supplies set unit = 'kg' where id = $1`, [pintura.id])), /calculator_supply_unit_in_use/);
      await asCommit(c, ana, () => c.query(`update public.calculator_supplies set unit = 'ml', unit_cost = 8 where id = $1`, [pintura.id]));
      const unused = await supply(c, ana, { name: "Barniz", unit: "l", unit_cost: 100 });
      await asCommit(c, ana, () => c.query(`update public.calculator_supplies set unit = 'kg' where id = $1`, [unused.id]));
      await asCommit(c, ana, () => c.query(`delete from public.calculator_supplies where id = $1`, [unused.id]));
    });

    await test("archived supplies: cannot be newly added, existing associations survive; deleting a type cascades", async () => {
      const type = await productType(c, ana, "Llavero");
      const argolla = await supply(c, ana, { name: "Argolla", unit_cost: 50 });
      const otroTipo = await productType(c, ana, "Llavero doble");
      await link(c, ana, type, argolla.id, 1, "unit");
      await asCommit(c, ana, () => c.query(`update public.calculator_supplies set archived_at = now() where id = $1`, [argolla.id]));
      await assert.rejects(link(c, ana, otroTipo, argolla.id, 1, "unit"), /calculator_supply_archived/);
      assert.equal((await readAs(c, ana, `select count(*)::int n from public.calculator_product_type_supplies where supply_id = $1`, [argolla.id]))[0].n, 1);
      await asCommit(c, ana, () => c.query(`update public.calculator_product_type_supplies set quantity = 2 where supply_id = $1`, [argolla.id]));
      await asCommit(c, ana, () => c.query(`delete from public.calculator_product_types where id = $1`, [type]));
      assert.equal((await readAs(c, ana, `select count(*)::int n from public.calculator_product_type_supplies where supply_id = $1`, [argolla.id]))[0].n, 0);
    });

    await test("centralized update: one price change reaches every product type through the real rows", async () => {
      const chica = await productType(c, ana, "Lámpara chica");
      const grande = await productType(c, ana, "Lámpara grande");
      const velador = await productType(c, ana, "Velador");
      const led = await supply(c, ana, { name: "Foco LED central", unit_cost: 1500 });
      await link(c, ana, chica, led.id, 1, "unit");
      await link(c, ana, grande, led.id, 2, "unit");
      await link(c, ana, velador, led.id, 1, "unit");
      const costs = async () => {
        const [rows, associations] = await Promise.all([
          readAs(c, ana, `select id, name, category, unit, custom_unit_label, unit_cost, archived_at from public.calculator_supplies`),
          readAs(c, ana, `select id, product_type_id, supply_id, quantity, quantity_unit, sort_order from public.calculator_product_type_supplies`),
        ]);
        return [chica, grande, velador].map((type) => priceSupplyLines(buildProductTypeSupplyLines(type, associations, rows)).total);
      };
      assert.deepEqual(await costs(), [1500, 3000, 1500]);
      await asCommit(c, ana, () => c.query(`update public.calculator_supplies set unit_cost = 1800 where id = $1`, [led.id]));
      assert.deepEqual(await costs(), [1800, 3600, 1800]);
    });

    await c.end();
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (EmbeddedPostgres && pg) {
  await main();
} else {
  test("calculator supplies DB behaviour (needs embedded-postgres + pg)", { skip: "npm i --no-save embedded-postgres pg" }, () => {});
}
