// Behaviour of 20261102130000_product_print_files.sql against a REAL Postgres (embedded, local only, never Supabase).
// Opt-in, like the other *-db tests:  npm i --no-save embedded-postgres pg && node --test tests/product-print-files-db.test.mjs
//
// Supabase pieces (roles, auth.users, auth.uid(), has_platform_access, is_admin, storage.buckets) and the pre-history
// `products` / `product_components` / `printers` tables are stubbed.
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

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261102130000_product_print_files.sql"), "utf8");
const PORT = Number(process.env.PRODUCT_PRINT_FILES_TEST_PG_PORT) || 54338;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-print-files-pg-"));
let server;

const stub = `
do $r$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $r$;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create table public.paid_users (user_id uuid primary key);
create table public.admins (user_id uuid primary key);
create function public.has_platform_access(uid uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.paid_users where user_id = uid) $$;
create function public.is_admin(uid uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.admins where user_id = uid) $$;
grant execute on function public.has_platform_access(uuid), public.is_admin(uuid) to authenticated;
create table public.products (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  name text not null, is_active boolean not null default true, sale_price numeric default 0, base_cost numeric default 0, print_time_minutes int default 0);
create table public.product_components (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  product_id uuid not null references public.products(id), name text not null, is_active boolean not null default true);
create table public.printers (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), name text);
alter table public.products enable row level security;
create policy products_own on public.products for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.products, public.product_components, public.printers to authenticated;
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
  const asRole = async (c, role, uid, fn, { commit = false } = {}) => {
    await c.query("begin");
    try {
      await c.query(`set local role ${role}`);
      await c.query(`select set_config('app.uid', $1, true)`, [uid ?? ""]);
      const result = await fn();
      await c.query(commit ? "commit" : "rollback");
      return result;
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
  };
  const as = (c, uid, fn, opts) => asRole(c, "authenticated", uid, fn, opts);

  const uuid = () => crypto.randomUUID();
  const product = async (c, uid, name = "Lámpara") =>
    (await c.query(`insert into public.products (user_id, name, sale_price, base_cost, print_time_minutes) values ($1, $2, 9000, 3000, 300) returning id`, [uid, name])).rows[0].id;
  const component = async (c, uid, productId, name = "Base") =>
    (await c.query(`insert into public.product_components (user_id, product_id, name) values ($1, $2, $3) returning id`, [uid, productId, name])).rows[0].id;
  const printer = async (c, uid, name = "A1") => (await c.query(`insert into public.printers (user_id, name) values ($1, $2) returning id`, [uid, name])).rows[0].id;

  /** Inserta como `authenticated` (lo que hace la Server Action con la sesión del usuario). */
  const insertFile = (c, uid, productId, extra = {}) => {
    const id = extra.id ?? uuid();
    const row = {
      name: "Pantalla A1", slicer: "bambu_studio", file_name: "pantalla.3mf",
      storage_path: `${uid}/${productId}/${id}.3mf`, component_id: null, printer_id: null, printer_name: null, ...extra,
    };
    return as(c, uid, async () => {
      await c.query(
        `insert into public.product_print_files (id, user_id, product_id, component_id, name, slicer, printer_id, printer_name, file_name, storage_path)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, uid, productId, row.component_id, row.name, row.slicer, row.printer_id, row.printer_name, row.file_name, row.storage_path],
      );
      return id;
    }, { commit: true });
  };
  /** Lo que hace el servidor al verificar el objeto (service_role). */
  const markReady = (c, id, size = 5_000_000) => asRole(c, "service_role", null, () =>
    c.query(`update public.product_print_files set status = 'ready', file_size = $2 where id = $1`, [id, size]), { commit: true });

  try {
    await test("la migration exige sus dependencias y es idempotente", async () => {
      const admin = mk();
      await admin.connect();
      await admin.query(`drop database if exists pf_bare`);
      await admin.query(`create database pf_bare template template0`);
      await admin.end();
      const bare = mk("pf_bare");
      await bare.connect();
      await assert.rejects(bare.query(migration), /Missing dependency: public\.products/);
      await bare.end();

      const c = await freshDb("pf_idem");
      await c.query(migration);
      await c.query(migration);
      assert.equal((await c.query(`select count(*)::int n from storage.buckets where id = 'product-print-files'`)).rows[0].n, 1);
      await c.end();
    });

    await test("la migration se niega a correr si los ids no son uuid (no crea nada a medias)", async () => {
      const admin = mk();
      await admin.connect();
      await admin.query(`drop database if exists pf_types`);
      await admin.query(`create database pf_types template template0 encoding 'UTF8'`);
      await admin.end();
      const c = mk("pf_types");
      await c.connect();
      const bigintStub = stub.replace("create table public.printers (id uuid primary key default gen_random_uuid(),", "create table public.printers (id bigint generated always as identity primary key,");
      assert.notEqual(bigintStub, stub, "el stub fue modificado");
      await c.query(bigintStub);
      await assert.rejects(c.query(migration), /requires uuid/);
      assert.equal((await c.query(`select to_regclass('public.product_print_files') is null as missing`)).rows[0].missing, true);
      assert.equal((await c.query(`select count(*)::int n from storage.buckets`)).rows[0].n, 0);
      await c.end();
    });

    await test("el bucket es privado, con tope de tamaño y sin policies para usuarios", async () => {
      const c = await freshDb("pf_bucket");
      const bucket = (await c.query(`select public, file_size_limit from storage.buckets where id = 'product-print-files'`)).rows[0];
      assert.equal(bucket.public, false);
      assert.equal(Number(bucket.file_size_limit), 150 * 1024 * 1024);
      assert.equal((await c.query(`select count(*)::int n from pg_policies where schemaname = 'storage'`)).rows[0].n, 0);
      await c.end();
    });

    await test("productos existentes y sus costos quedan intactos tras la migration", async () => {
      const c = await freshDb("pf_upgrade", { applyMigration: false });
      const u = await newUser(c);
      const p = await product(c, u, "Llavero");
      await c.query(migration);
      const row = (await c.query(`select name, sale_price::int s, base_cost::int b, print_time_minutes t from public.products where id = $1`, [p])).rows[0];
      assert.deepEqual(row, { name: "Llavero", s: 9000, b: 3000, t: 300 });
      await c.end();
    });

    const c = await freshDb("pf_main");
    const ana = await newUser(c);
    const beto = await newUser(c);
    const free = await newUser(c, { paid: false });
    const root = await newUser(c, { paid: false, admin: true });
    const anaProduct = await product(c, ana);
    const betoProduct = await product(c, beto, "Maceta");

    await test("crear, listar y mantener varios proyectos del mismo laminador e impresoras distintas en un producto", async () => {
      const a1 = await printer(c, ana, "Bambu A1");
      const p1s = await printer(c, ana, "Bambu P1S");
      const f1 = await insertFile(c, ana, anaProduct, { name: "A1", slicer: "bambu_studio", printer_id: a1, printer_name: "Bambu A1" });
      const f2 = await insertFile(c, ana, anaProduct, { name: "P1S", slicer: "bambu_studio", printer_id: p1s, printer_name: "Bambu P1S" });
      const f3 = await insertFile(c, ana, anaProduct, { name: "Flash", slicer: "flash_studio", printer_name: "Adventurer 5M" });
      for (const id of [f1, f2, f3]) await markReady(c, id);
      const rows = await as(c, ana, async () =>
        (await c.query(`select name, slicer, printer_name, status from public.product_print_files where product_id = $1 and status = 'ready' order by slicer, name`, [anaProduct])).rows);
      assert.deepEqual(rows.map((r) => `${r.slicer}:${r.name}`), ["bambu_studio:A1", "bambu_studio:P1S", "flash_studio:Flash"]);
    });

    await test("un archivo puede vincularse a una pieza o a todo el producto", async () => {
      const base = await component(c, ana, anaProduct, "Base");
      const whole = await insertFile(c, ana, anaProduct, { name: "Completo" });
      const piece = await insertFile(c, ana, anaProduct, { name: "Solo base", component_id: base });
      const rows = (await c.query(`select name, component_id from public.product_print_files where id in ($1, $2) order by name`, [whole, piece])).rows;
      assert.equal(rows.find((r) => r.name === "Completo").component_id, null);
      assert.equal(rows.find((r) => r.name === "Solo base").component_id, base);
    });

    await test("eliminar una pieza deja el archivo, sin pieza (SET NULL)", async () => {
      const piece = await component(c, ana, anaProduct, "Difusor");
      const id = await insertFile(c, ana, anaProduct, { name: "Difusor 3MF", component_id: piece });
      await c.query(`delete from public.product_components where id = $1`, [piece]);
      assert.equal((await c.query(`select component_id from public.product_print_files where id = $1`, [id])).rows[0].component_id, null);
    });

    await test("aislamiento: otro usuario no ve ni modifica ni elimina proyectos ajenos", async () => {
      const id = await insertFile(c, ana, anaProduct, { name: "Privado" });
      await markReady(c, id);
      await as(c, beto, async () => {
        assert.equal((await c.query(`select count(*)::int n from public.product_print_files`)).rows[0].n, 0, "Beto no ve nada de Ana");
        assert.equal((await c.query(`update public.product_print_files set name = 'hack' where id = $1`, [id])).rowCount, 0);
        assert.equal((await c.query(`delete from public.product_print_files where id = $1`, [id])).rowCount, 0);
      });
      assert.equal((await c.query(`select name from public.product_print_files where id = $1`, [id])).rows[0].name, "Privado");
    });

    await test("no se puede insertar a nombre de otro usuario ni en un producto ajeno", async () => {
      const id = uuid();
      // user_id de otro: la política de INSERT lo rechaza.
      await assert.rejects(as(c, beto, () => c.query(
        `insert into public.product_print_files (id, user_id, product_id, name, slicer, file_name, storage_path) values ($1,$2,$3,'x','orcaslicer','x.3mf',$4)`,
        [id, ana, anaProduct, `${ana}/${anaProduct}/${id}.3mf`])), /row-level security/);
      // user_id propio pero producto ajeno: lo rechaza el trigger (pertenencia).
      const id2 = uuid();
      await assert.rejects(as(c, beto, () => c.query(
        `insert into public.product_print_files (id, user_id, product_id, name, slicer, file_name, storage_path) values ($1,$2,$3,'x','orcaslicer','x.3mf',$4)`,
        [id2, beto, anaProduct, `${beto}/${anaProduct}/${id2}.3mf`])), /no pertenece al usuario/);
    });

    await test("la pieza debe ser del mismo producto y la impresora del mismo usuario", async () => {
      const other = await component(c, ana, await product(c, ana, "Otro"), "Ajena al producto");
      await assert.rejects(insertFile(c, ana, anaProduct, { component_id: other }), /pieza no pertenece a este producto/);
      const betoPrinter = await printer(c, beto, "De Beto");
      await assert.rejects(insertFile(c, ana, anaProduct, { printer_id: betoPrinter }), /impresora no pertenece al usuario/);
    });

    await test("la ruta del objeto queda atada al dueño y al producto, y siempre es un .3mf con id uuid", async () => {
      const id = uuid();
      const bad = [
        `${beto}/${anaProduct}/${id}.3mf`,
        `${ana}/${betoProduct}/${id}.3mf`,
        `${ana}/${anaProduct}/${id}.stl`,
        `${ana}/${anaProduct}/../${id}.3mf`,
        `${ana}/${anaProduct}/nombre-libre.3mf`,
      ];
      for (const storage_path of bad) {
        await assert.rejects(insertFile(c, ana, anaProduct, { id, storage_path }), /product_print_files_storage_path_scope|violates check|row-level/, storage_path);
      }
    });

    await test("el cliente no puede marcar un archivo como ready ni cambiar su ruta, tamaño o dueño", async () => {
      const id = await insertFile(c, ana, anaProduct, { name: "Pendiente" });
      assert.equal((await c.query(`select status, file_size from public.product_print_files where id = $1`, [id])).rows[0].status, "pending");
      for (const column of ["status = 'ready'", "file_size = 5", `storage_path = '${ana}/${anaProduct}/${uuid()}.3mf'`, `user_id = '${beto}'`, `replaces_id = '${uuid()}'`]) {
        await assert.rejects(as(c, ana, () => c.query(`update public.product_print_files set ${column} where id = $1`, [id])), /permission denied/, column);
      }
      // insert como ready tampoco
      const id2 = uuid();
      await assert.rejects(as(c, ana, () => c.query(
        `insert into public.product_print_files (id, user_id, product_id, name, slicer, file_name, storage_path, status) values ($1,$2,$3,'x','orcaslicer','x.3mf',$4,'ready')`,
        [id2, ana, anaProduct, `${ana}/${anaProduct}/${id2}.3mf`])), /permission denied/);
    });

    await test("el servidor (service_role) sí puede confirmar; ready exige tamaño", async () => {
      const id = await insertFile(c, ana, anaProduct, { name: "A confirmar" });
      await assert.rejects(asRole(c, "service_role", null, () => c.query(`update public.product_print_files set status = 'ready' where id = $1`, [id])), /ready_has_size/);
      await markReady(c, id, 1234);
      assert.equal(Number((await c.query(`select file_size from public.product_print_files where id = $1`, [id])).rows[0].file_size), 1234);
    });

    await test("editar los datos del proyecto no toca el producto (precios, costos, tiempos)", async () => {
      const id = await insertFile(c, ana, anaProduct, { name: "Editable" });
      await as(c, ana, () => c.query(
        `update public.product_print_files set name = '  Nuevo   nombre ', slicer = 'orcaslicer', est_minutes = 220, est_grams = 125.5, material = 'PLA Translúcido' where id = $1`, [id]), { commit: true });
      const file = (await c.query(`select name, slicer, est_minutes, est_grams::float g, material from public.product_print_files where id = $1`, [id])).rows[0];
      assert.deepEqual(file, { name: "Nuevo nombre", slicer: "orcaslicer", est_minutes: 220, g: 125.5, material: "PLA Translúcido" });
      const prod = (await c.query(`select sale_price::int s, base_cost::int b, print_time_minutes t from public.products where id = $1`, [anaProduct])).rows[0];
      assert.deepEqual(prod, { s: 9000, b: 3000, t: 300 });
    });

    await test("restricciones: laminador con forma válida, nombre, estimaciones", async () => {
      await assert.rejects(insertFile(c, ana, anaProduct, { slicer: "Bambu Studio" }), /slicer_shape/);
      await assert.rejects(insertFile(c, ana, anaProduct, { name: "   " }), /name_length/);
      await assert.rejects(insertFile(c, ana, anaProduct, { name: "x".repeat(81) }), /name_length/);
      const id = await insertFile(c, ana, anaProduct, { name: "Estimaciones" });
      await assert.rejects(as(c, ana, () => c.query(`update public.product_print_files set est_minutes = 0 where id = $1`, [id])), /est_minutes/);
      await assert.rejects(as(c, ana, () => c.query(`update public.product_print_files set est_grams = -1 where id = $1`, [id])), /est_grams/);
    });

    await test("un usuario sin acceso a la plataforma (Free) no puede leer ni escribir", async () => {
      const fp = await product(c, free, "Free product");
      await assert.rejects(insertFile(c, free, fp), /row-level security/);
      await as(c, free, async () => {
        assert.equal((await c.query(`select count(*)::int n from public.product_print_files`)).rows[0].n, 0);
      });
    });

    await test("el admin accede a todo; anon no accede a nada", async () => {
      await as(c, root, async () => {
        assert.ok((await c.query(`select count(*)::int n from public.product_print_files`)).rows[0].n > 0);
      });
      await assert.rejects(asRole(c, "anon", null, () => c.query(`select 1 from public.product_print_files`)), /permission denied/);
    });

    await test("eliminar un proyecto no afecta a los demás ni al producto", async () => {
      const keep = await insertFile(c, ana, anaProduct, { name: "Se queda" });
      const drop = await insertFile(c, ana, anaProduct, { name: "Se va" });
      await as(c, ana, () => c.query(`delete from public.product_print_files where id = $1`, [drop]), { commit: true });
      assert.equal((await c.query(`select count(*)::int n from public.product_print_files where id = $1`, [keep])).rows[0].n, 1);
      assert.equal((await c.query(`select count(*)::int n from public.product_print_files where id = $1`, [drop])).rows[0].n, 0);
      assert.equal((await c.query(`select count(*)::int n from public.products where id = $1`, [anaProduct])).rows[0].n, 1);
    });

    await test("reemplazo: la fila nueva hereda datos y puede referenciar a la anterior sin FK (se limpia desde el servidor)", async () => {
      const old = await insertFile(c, ana, anaProduct, { name: "Original", slicer: "orcaslicer", printer_name: "Prusa" });
      await markReady(c, old);
      const nid = uuid();
      await as(c, ana, () => c.query(
        `insert into public.product_print_files (id, user_id, product_id, name, slicer, printer_name, file_name, storage_path, replaces_id)
         values ($1,$2,$3,'Original','orcaslicer','Prusa','v2.3mf',$4,$5)`,
        [nid, ana, anaProduct, `${ana}/${anaProduct}/${nid}.3mf`, old]), { commit: true });
      assert.equal((await c.query(`select replaces_id from public.product_print_files where id = $1`, [nid])).rows[0].replaces_id, old);
    });

    await c.end();
    releaseLock();
  } finally {
    await server?.stop();
  }
}

if (!EmbeddedPostgres || !pg) {
  test("product print files DB tests (omitidos: faltan embedded-postgres y pg)", { skip: true }, () => {});
} else {
  await main();
}
