// DB-level behaviour of supabase/migrations/20261102120000_community_links.sql against a REAL Postgres
// (embedded, throw-away, local only — never touches Supabase). Opt-in, like the other *-db tests:
//
//   npm i --no-save embedded-postgres pg && node --test tests/community-links-db.test.mjs
//
// Supabase pieces (roles, auth.uid(), public.is_admin, public.has_platform_access) are stubbed. Every user is a fixture.
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

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261102120000_community_links.sql"), "utf8");
const PORT = Number(process.env.COMMUNITY_TEST_PG_PORT) || 54334;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-community-pg-"));
let server;

const mk = (database = "postgres") => new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database });

const stub = `
do $r$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator login password 'pw' noinherit; grant anon, authenticated, service_role to authenticator; end if; end $r$;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.stub_roles (user_id uuid primary key, is_admin boolean not null default false, is_paid boolean not null default false);
create function public.is_admin(p uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce((select is_admin from public.stub_roles where user_id = p), false) $$;
create function public.has_platform_access(p uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce((select is_paid or is_admin from public.stub_roles where user_id = p), false) $$;
revoke all on function public.is_admin(uuid), public.has_platform_access(uuid) from public;
grant execute on function public.is_admin(uuid), public.has_platform_access(uuid) to authenticated, service_role;
`;

async function asRole(c, role, uid = null) {
  await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role } : { role })]);
  await c.query(`set session authorization authenticator`);
  await c.query(`set role ${role}`);
}
async function asSuper(c) {
  await c.query(`reset role`);
  await c.query(`reset session authorization`);
  await c.query(`select set_config('request.jwt.claims', '', false)`);
}

async function freshDb(name) {
  const admin = mk();
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
  await admin.end();
  const c = mk(name);
  await c.connect();
  await c.query(stub);
  return c;
}

const newUser = async (c, { admin = false, paid = false } = {}) => {
  const id = (await c.query(`insert into auth.users (email) values ($1) returning id`, [`u${Math.random()}@x.com`])).rows[0].id;
  await c.query(`insert into public.stub_roles (user_id, is_admin, is_paid) values ($1,$2,$3)`, [id, admin, paid]);
  return id;
};

const insertLink = (c, f = {}) => {
  const v = { kind: "channel", platform: "telegram", name: "Canal", channel_type: "channel", url: "https://t.me/x", access_level: "public", is_active: true, sort_order: 0, ...f };
  return c.query(
    `insert into public.community_links (kind, platform, name, channel_type, url, access_level, is_active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [v.kind, v.platform, v.name, v.channel_type, v.url, v.access_level, v.is_active, v.sort_order],
  );
};

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  try {
    await test("migration aborts without is_admin / has_platform_access", async () => {
      const admin = mk();
      await admin.connect();
      await admin.query(`drop database if exists cl_nodeps`);
      await admin.query(`create database cl_nodeps template template0`);
      await admin.end();
      const c = mk("cl_nodeps");
      await c.connect();
      await c.query(`create schema auth; create table auth.users (id uuid primary key)`);
      await assert.rejects(c.query(migration), /Missing dependency/);
      await c.end();
    });

    const c = await freshDb("cl_main");
    await c.query(migration);

    await test("la migration es idempotente y el seed solo corre con la tabla vacía", async () => {
      const first = (await c.query(`select count(*)::int n from public.community_links`)).rows[0].n;
      assert.equal(first, 4);
      await c.query(migration);
      assert.equal((await c.query(`select count(*)::int n from public.community_links`)).rows[0].n, 4);
      const kinds = (await c.query(`select kind, array_agg(platform order by sort_order) p from public.community_links group by kind order by kind`)).rows;
      assert.deepEqual(kinds, [{ kind: "channel", p: ["whatsapp", "telegram"] }, { kind: "social", p: ["instagram", "youtube"] }]);
      assert.equal((await c.query(`select count(*)::int n from public.community_links where access_level <> 'public'`)).rows[0].n, 0);
    });

    await test("las constraints rechazan URLs inseguras, redes no públicas y tipos inválidos", async () => {
      const bad = [
        { url: "http://t.me/x" },
        { url: "javascript:alert(1)" },
        { url: "https://user:pw@t.me/x" },
        { url: "https://t.me/a b" },
        { url: "https://" },
        { access_level: "vip" },
        { kind: "social", channel_type: null, access_level: "premium", platform: "instagram" },
        { kind: "social", channel_type: "group", platform: "instagram" },
        { channel_type: null },
        { name: "   " },
        { platform: "Bad Platform" },
        { sort_order: -1 },
      ];
      for (const fields of bad) await assert.rejects(insertLink(c, fields), /violates check constraint/, JSON.stringify(fields));
      await insertLink(c, { url: "https://discord.gg/abc?x=1#y", platform: "discord", channel_type: "server" });
      await c.query(`delete from public.community_links where platform = 'discord'`);
    });

    const pub = (await insertLink(c, { name: "Pub", access_level: "public", sort_order: 10 })).rows[0].id;
    const reg = (await insertLink(c, { name: "Reg", access_level: "registered", sort_order: 11, url: "https://t.me/registered" })).rows[0].id;
    const prem = (await insertLink(c, { name: "VIP", access_level: "premium", sort_order: 12, url: "https://t.me/+PREMIUM_SECRET" })).rows[0].id;
    const off = (await insertLink(c, { name: "Off", access_level: "public", is_active: false, sort_order: 13, url: "https://t.me/off" })).rows[0].id;

    const anon = null;
    const free = await newUser(c);
    const paid = await newUser(c, { paid: true });
    const admin = await newUser(c, { admin: true });

    const direct = async (role, uid) => {
      await asRole(c, role, uid);
      try {
        return (await c.query(`select id, url from public.community_links`)).rows;
      } finally {
        await asSuper(c);
      }
    };
    const rpc = async (role, uid) => {
      await asRole(c, role, uid);
      try {
        return (await c.query(`select * from public.list_community_links()`)).rows;
      } finally {
        await asSuper(c);
      }
    };

    await test("RLS: lectura directa por nivel; la URL Premium no sale para anon ni Free", async () => {
      const anonRows = await direct("anon", anon);
      assert.ok(anonRows.some((r) => r.id === pub));
      assert.ok(!anonRows.some((r) => [reg, prem, off].includes(r.id)));
      assert.ok(!JSON.stringify(anonRows).includes("PREMIUM_SECRET"));

      const freeRows = await direct("authenticated", free);
      assert.ok(freeRows.some((r) => r.id === reg));
      assert.ok(!freeRows.some((r) => [prem, off].includes(r.id)));
      assert.ok(!JSON.stringify(freeRows).includes("PREMIUM_SECRET"));

      const paidRows = await direct("authenticated", paid);
      assert.ok(paidRows.some((r) => r.id === prem));
      assert.ok(!paidRows.some((r) => r.id === off), "inactivos ocultos para usuarios");

      const adminRows = await direct("authenticated", admin);
      assert.ok([pub, reg, prem, off].every((id) => adminRows.some((r) => r.id === id)), "el admin ve todo, incluso inactivos");
    });

    await test("RPC: anon solo recibe públicos; Free recibe Premium bloqueado sin URL; Premium la recibe", async () => {
      const anonRows = await rpc("anon", anon);
      assert.ok(anonRows.every((r) => r.access_level === "public" && r.locked === false && r.url));
      assert.ok(!anonRows.some((r) => r.id === off));

      const freeRows = await rpc("authenticated", free);
      const locked = freeRows.find((r) => r.id === prem);
      assert.ok(locked, "tarjeta bloqueada visible");
      assert.equal(locked.url, null);
      assert.equal(locked.locked, true);
      assert.equal(locked.name, "VIP");
      assert.equal(freeRows.find((r) => r.id === reg).url, "https://t.me/registered");
      assert.ok(!JSON.stringify(freeRows).includes("PREMIUM_SECRET"));

      const paidRows = await rpc("authenticated", paid);
      assert.equal(paidRows.find((r) => r.id === prem).url, "https://t.me/+PREMIUM_SECRET");
      assert.equal(paidRows.find((r) => r.id === prem).locked, false);
      assert.ok(!paidRows.some((r) => r.id === off));

      const ordered = paidRows.map((r) => `${r.kind}:${r.sort_order}`);
      assert.deepEqual(ordered, [...ordered].sort((a, b) => (a.split(":")[0] === b.split(":")[0] ? Number(a.split(":")[1]) - Number(b.split(":")[1]) : a.localeCompare(b))));
    });

    await test("escritura: solo el administrador; anon y usuarios comunes no pueden crear, editar ni borrar", async () => {
      for (const [role, uid] of [["anon", anon], ["authenticated", free], ["authenticated", paid]]) {
        await asRole(c, role, uid);
        try {
          await assert.rejects(c.query(`insert into public.community_links (kind, platform, name, channel_type, url) values ('channel','telegram','X','channel','https://t.me/x')`), /permission denied|row-level security/);
          const upd = await c.query(`update public.community_links set name = 'hack' where id = $1`, [pub]).catch((e) => e);
          assert.ok(upd instanceof Error || upd.rowCount === 0, "update bloqueado");
          const del = await c.query(`delete from public.community_links where id = $1`, [pub]).catch((e) => e);
          assert.ok(del instanceof Error || del.rowCount === 0, "delete bloqueado");
          await assert.rejects(c.query(`select public.reorder_community_links('channel', array[$1::uuid])`, [pub]), /permission denied|Solo los administradores/);
        } finally {
          await asSuper(c);
        }
      }
      assert.equal((await c.query(`select name from public.community_links where id = $1`, [pub])).rows[0].name, "Pub");

      await asRole(c, "authenticated", admin);
      try {
        const created = await c.query(`insert into public.community_links (kind, platform, name, channel_type, url, access_level) values ('channel','discord','Disc','server','https://discord.gg/x','premium') returning id, updated_by`);
        assert.equal(created.rows[0].updated_by, admin, "updated_by lo fija el servidor desde la sesión");
        await c.query(`update public.community_links set name = 'Disc2' where id = $1`, [created.rows[0].id]);
        assert.equal((await c.query(`delete from public.community_links where id = $1`, [created.rows[0].id])).rowCount, 1);
      } finally {
        await asSuper(c);
      }
    });

    await test("reorder_community_links aplica el orden completo en una sentencia y solo al tipo indicado", async () => {
      const socialIds = (await c.query(`select id from public.community_links where kind='social' order by sort_order`)).rows.map((r) => r.id);
      const channelBefore = (await c.query(`select id, sort_order from public.community_links where kind='channel' order by id`)).rows;
      await asRole(c, "authenticated", admin);
      try {
        await c.query(`select public.reorder_community_links('social', $1::uuid[])`, [[...socialIds].reverse()]);
        await assert.rejects(c.query(`select public.reorder_community_links('otro', $1::uuid[])`, [socialIds]), /Tipo de enlace inválido/);
      } finally {
        await asSuper(c);
      }
      const after = (await c.query(`select id from public.community_links where kind='social' order by sort_order`)).rows.map((r) => r.id);
      assert.deepEqual(after, [...socialIds].reverse());
      assert.deepEqual((await c.query(`select id, sort_order from public.community_links where kind='channel' order by id`)).rows, channelBefore);

      // Un id de otro tipo dentro de la lista no se reordena.
      await asRole(c, "authenticated", admin);
      try {
        await c.query(`select public.reorder_community_links('social', $1::uuid[])`, [[pub]]);
      } finally {
        await asSuper(c);
      }
      assert.equal((await c.query(`select sort_order from public.community_links where id=$1`, [pub])).rows[0].sort_order, 10);
    });

    await test("los helpers y la RPC no son ejecutables por roles sin permiso y service_role conserva acceso", async () => {
      await asRole(c, "anon", null);
      try {
        await assert.rejects(c.query(`select public.reorder_community_links('social', array[]::uuid[])`), /permission denied/);
        assert.ok((await c.query(`select public.community_viewer_can_access('public') as ok`)).rows[0].ok);
        assert.equal((await c.query(`select public.community_viewer_can_access('premium') as ok`)).rows[0].ok, false);
        assert.equal((await c.query(`select public.community_viewer_can_access('registered') as ok`)).rows[0].ok, false);
        assert.equal((await c.query(`select public.community_viewer_can_access('inventado') as ok`)).rows[0].ok, false);
      } finally {
        await asSuper(c);
      }
      await asRole(c, "service_role");
      try {
        assert.ok((await c.query(`select count(*)::int n from public.community_links`)).rows[0].n > 0);
      } finally {
        await asSuper(c);
      }
    });

    await c.end();
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (!EmbeddedPostgres || !pg) {
  test("community links DB behaviour", { skip: "optional: npm i --no-save embedded-postgres pg" }, () => {});
} else {
  await main();
}
