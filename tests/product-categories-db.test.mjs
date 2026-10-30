// Behaviour of 20261101120000_product_categories.sql against a REAL Postgres (embedded, local only, never Supabase).
// Opt-in, like the other *-db tests:  npm i --no-save embedded-postgres pg && node --test tests/product-categories-db.test.mjs
//
// Supabase pieces (roles, auth.users, auth.uid(), has_platform_access, is_admin) and the pre-history `products` table are stubbed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireEmbeddedPgLock } from "./helpers/embedded-pg-lock.mjs";

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  ({ default: pg } = await import("pg"));
} catch {
  // optional dev tooling not installed
}

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261101120000_product_categories.sql"), "utf8");
const PORT = Number(process.env.PRODUCT_CATEGORIES_TEST_PG_PORT) || 54336;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-product-categories-pg-"));
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
create table public.admins (user_id uuid primary key);
create function public.has_platform_access(uid uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.paid_users where user_id = uid) $$;
create function public.is_admin(uid uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.admins where user_id = uid) $$;
grant execute on function public.has_platform_access(uuid), public.is_admin(uuid) to authenticated;
-- Pre-history products table with the permissive-by-owner RLS the app relies on.
create table public.products (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  name text not null, is_active boolean not null default true, sale_price numeric default 0);
alter table public.products enable row level security;
create policy products_own on public.products for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.products to authenticated;
`;

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
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

  const newUser = async (c, { paid = true, admin = false } = {}) => {
    const id = (await c.query(`insert into auth.users (email) values ($1) returning id`, [`u${Math.random()}@x.com`])).rows[0].id;
    if (paid) await c.query(`insert into public.paid_users values ($1)`, [id]);
    if (admin) await c.query(`insert into public.admins values ($1)`, [id]);
    return id;
  };
  /** Runs `fn` as the `authenticated` role with auth.uid() = uid, inside a rolled-back-on-error scope. */
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
  /** Same, but commits (used to seed data through the real policies). */
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
  const category = (c, uid, name) => asCommit(c, uid, async () =>
    (await c.query(`insert into public.product_categories (user_id, name) values ($1, $2) returning id, name`, [uid, name])).rows[0]);
  const product = (c, uid, name, categoryId = null) => asCommit(c, uid, async () =>
    (await c.query(`insert into public.products (user_id, name, category_id) values ($1, $2, $3) returning id`, [uid, name, categoryId])).rows[0].id);

  try {
    await test("migration refuses to run without its dependencies and is idempotent", async () => {
      const admin = mk();
      await admin.connect();
      await admin.query(`drop database if exists pc_bare`);
      await admin.query(`create database pc_bare template template0`);
      await admin.end();
      const bare = mk("pc_bare");
      await bare.connect();
      await assert.rejects(bare.query(migration), /Missing dependency: public\.products/);
      await bare.end();

      const c = await freshDb("pc_idem");
      await c.query(migration);
      await c.query(migration);
      assert.equal((await c.query(`select count(*)::int n from pg_constraint where conname = 'products_category_owner_fkey'`)).rows[0].n, 1);
      await c.end();
    });

    await test("existing products survive the migration untouched and uncategorized", async () => {
      const c = await freshDb("pc_upgrade", { applyMigration: false });
      const u = await newUser(c);
      await c.query(`insert into public.products (user_id, name, sale_price) values ($1, 'Llavero', 1500), ($1, 'Lámpara luna', 9000)`, [u]);
      await c.query(migration);
      const rows = (await c.query(`select name, sale_price::int p, category_id from public.products order by name`)).rows;
      assert.deepEqual(rows, [{ name: "Llavero", p: 1500, category_id: null }, { name: "Lámpara luna", p: 9000, category_id: null }]);
      await c.end();
    });

    const c = await freshDb("pc_main");
    const ana = await newUser(c);
    const beto = await newUser(c);

    await test("create + assign + change category; products can stay uncategorized", async () => {
      const lamps = await category(c, ana, "Lámparas");
      const pots = await category(c, ana, "Macetas");
      const uncategorized = await product(c, ana, "Sin categoría");
      const lamp = await product(c, ana, "Lámpara luna", lamps.id);
      assert.equal((await c.query(`select category_id from public.products where id = $1`, [uncategorized])).rows[0].category_id, null);
      assert.equal((await c.query(`select category_id from public.products where id = $1`, [lamp])).rows[0].category_id, lamps.id);

      await asCommit(c, ana, () => c.query(`update public.products set category_id = $2 where id = $1`, [lamp, pots.id]));
      assert.equal((await c.query(`select category_id from public.products where id = $1`, [lamp])).rows[0].category_id, pots.id);
      await asCommit(c, ana, () => c.query(`update public.products set category_id = null where id = $1`, [lamp]));
      assert.equal((await c.query(`select category_id from public.products where id = $1`, [lamp])).rows[0].category_id, null);
    });

    await test("filtering by category returns only that category's products", async () => {
      const cats = await category(c, beto, "Carteles");
      await product(c, beto, "Cartel A", cats.id);
      await product(c, beto, "Cartel B", cats.id);
      await product(c, beto, "Suelto");
      const rows = await as(c, beto, async () => (await c.query(`select name from public.products where category_id = $1 order by name`, [cats.id])).rows);
      assert.deepEqual(rows.map((r) => r.name), ["Cartel A", "Cartel B"]);
    });

    await test("duplicate names are rejected per user ignoring case and spaces, but allowed across users", async () => {
      await category(c, ana, "Accesorios");
      for (const dup of ["accesorios", "  ACCESORIOS ", "Accesorios   "]) {
        await assert.rejects(category(c, ana, dup), /product_categories_user_name_key|duplicate key/);
      }
      const other = await category(c, beto, "Accesorios");
      assert.equal(other.name, "Accesorios");
      // Renaming onto an existing name is also rejected
      const souvenirs = await category(c, ana, "Souvenirs");
      await assert.rejects(
        asCommit(c, ana, () => c.query(`update public.product_categories set name = 'accesorios' where id = $1`, [souvenirs.id])),
        /duplicate key/,
      );
    });

    await test("names are normalized by the database and validated", async () => {
      const row = await category(c, ana, "   Organizadores   de   escritorio ");
      assert.equal(row.name, "Organizadores de escritorio");
      await assert.rejects(category(c, ana, "    "), /product_categories_name_length|check constraint/);
      await assert.rejects(category(c, ana, "x".repeat(41)), /product_categories_name_length|check constraint/);
    });

    await test("rename updates the name and updated_at", async () => {
      const row = await category(c, ana, "Temporal");
      const before = (await c.query(`select updated_at from public.product_categories where id = $1`, [row.id])).rows[0].updated_at;
      await new Promise((r) => setTimeout(r, 15));
      await asCommit(c, ana, () => c.query(`update public.product_categories set name = '  Definitiva ' where id = $1`, [row.id]));
      const after = (await c.query(`select name, updated_at from public.product_categories where id = $1`, [row.id])).rows[0];
      assert.equal(after.name, "Definitiva");
      assert.ok(after.updated_at > before);
    });

    await test("deleting a category keeps its products and leaves them uncategorized", async () => {
      const doomed = await category(c, ana, "Para borrar");
      const p1 = await product(c, ana, "Pieza 1", doomed.id);
      const p2 = await product(c, ana, "Pieza 2", doomed.id);
      const archived = await product(c, ana, "Archivada", doomed.id);
      await c.query(`update public.products set is_active = false where id = $1`, [archived]);
      const keep = await category(c, ana, "Se queda");
      const other = await product(c, ana, "Otra", keep.id);

      await asCommit(c, ana, () => c.query(`delete from public.product_categories where id = $1`, [doomed.id]));

      const rows = (await c.query(`select id, user_id, category_id from public.products where id = any($1) order by name`, [[p1, p2, archived, other]])).rows;
      assert.equal(rows.length, 4, "no product was deleted");
      assert.ok(rows.every((r) => r.user_id === ana), "user_id of products intact");
      assert.equal(rows.filter((r) => r.category_id === null).length, 3);
      assert.equal(rows.find((r) => r.id === other).category_id, keep.id, "other categories untouched");
    });

    await test("user isolation: cannot read, edit, delete or assign another user's categories", async () => {
      const anaCat = await category(c, ana, "Privada de Ana");
      const betoProduct = await product(c, beto, "Producto de Beto");

      // read
      const visible = await as(c, beto, async () => (await c.query(`select id from public.product_categories where id = $1`, [anaCat.id])).rows);
      assert.equal(visible.length, 0);
      // rename (RLS filters the row: 0 rows updated)
      const renamed = await as(c, beto, () => c.query(`update public.product_categories set name = 'Hackeada' where id = $1`, [anaCat.id]));
      assert.equal(renamed.rowCount, 0);
      // delete
      const deleted = await as(c, beto, () => c.query(`delete from public.product_categories where id = $1`, [anaCat.id]));
      assert.equal(deleted.rowCount, 0);
      // insert as someone else
      await assert.rejects(as(c, beto, () => c.query(`insert into public.product_categories (user_id, name) values ($1, 'Falsa')`, [ana])), /row-level security/);
      // assign Ana's category to Beto's own product: blocked by the composite FK even though products RLS allows the update
      await assert.rejects(
        as(c, beto, () => c.query(`update public.products set category_id = $2 where id = $1`, [betoProduct, anaCat.id])),
        /products_category_owner_fkey/,
      );
      await assert.rejects(
        as(c, beto, () => c.query(`insert into public.products (user_id, name, category_id) values ($1, 'X', $2)`, [beto, anaCat.id])),
        /products_category_owner_fkey/,
      );
      assert.equal((await c.query(`select name from public.product_categories where id = $1`, [anaCat.id])).rows[0].name, "Privada de Ana");
    });

    await test("column privileges: user_id and id are immutable for users", async () => {
      const row = await category(c, ana, "Inmutable");
      await assert.rejects(as(c, ana, () => c.query(`update public.product_categories set user_id = $2 where id = $1`, [row.id, beto])), /permission denied/);
      await assert.rejects(as(c, ana, () => c.query(`update public.product_categories set id = gen_random_uuid() where id = $1`, [row.id])), /permission denied/);
    });

    await test("access gating: a user without platform access sees and writes nothing; anon has no access; admin can manage", async () => {
      const free = await newUser(c, { paid: false });
      await assert.rejects(category(c, free, "Gratis"), /row-level security/);
      const adminUser = await newUser(c, { paid: false, admin: true });
      const adminRows = await as(c, adminUser, async () => (await c.query(`select count(*)::int n from public.product_categories`)).rows[0].n);
      assert.ok(adminRows > 0);

      await c.query("begin");
      await c.query("set local role anon");
      await assert.rejects(c.query(`select * from public.product_categories`), /permission denied/);
      await c.query("rollback");
    });

    await test("deleting a user cascades only that user's categories", async () => {
      const temp = await newUser(c);
      await category(c, temp, "Efímera");
      await c.query(`delete from auth.users where id = $1`, [temp]);
      assert.equal((await c.query(`select count(*)::int n from public.product_categories where user_id = $1`, [temp])).rows[0].n, 0);
      assert.ok((await c.query(`select count(*)::int n from public.product_categories where user_id = $1`, [ana])).rows[0].n > 0);
    });

    await c.end();
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (!EmbeddedPostgres || !pg) {
  test("product categories DB behaviour", { skip: "optional: npm i --no-save embedded-postgres pg" }, () => {});
} else {
  await main();
}
