// DB-level behaviour of supabase/migrations/20261005120000_beta_access_codes.sql against a REAL Postgres
// (embedded, throw-away, local only — never touches Supabase). Opt-in: it runs only when the optional
// packages are installed, otherwise it is skipped:
//
//   npm i --no-save embedded-postgres pg && node --test tests/beta-access-db.test.mjs
//
// Supabase pieces (auth schema, roles, profiles, user_access_grants, is_admin, has_platform_access) are
// stubbed; the PostgREST login role is emulated with SET SESSION AUTHORIZATION authenticator + SET ROLE.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  ({ default: pg } = await import("pg"));
} catch {
  // optional dev tooling not installed
}

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261005120000_beta_access_codes.sql"),
  "utf8",
);
const PORT = Number(process.env.BETA_TEST_PG_PORT) || 54329;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-beta-pg-"));
let server;
const notices = [];

function mk() {
  const c = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database: "postgres" });
  c.on("notice", (n) => notices.push(n.message));
  return c;
}

const stubBase = (hasPlatformBody) => `
do $r$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator login password 'pw' noinherit; grant anon, authenticated, service_role to authenticator; end if; end $r$;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
create table public.profiles (id uuid primary key references auth.users(id), role text, membership_status text, membership_expires_at timestamptz);
create table public.user_access_grants (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), grant_type text not null, status text not null default 'active', expires_at timestamptz, notes text, created_by uuid, created_at timestamptz default now());
alter table public.user_access_grants enable row level security;
-- Mirrors the remote diagnostic: Supabase default privileges (incl. TRUNCATE/REFERENCES/TRIGGER) for anon/authenticated/service_role.
grant all on public.user_access_grants to anon, authenticated, service_role;
grant all on public.profiles to service_role;
create function public.is_admin(uid uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles where id = uid and role = 'admin') $$;
-- Policies exactly as reported by the remote diagnostic.
create policy "Admins can manage access grants" on public.user_access_grants for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "Users can view own access grants" on public.user_access_grants for select to authenticated using (user_id = auth.uid());
${hasPlatformBody}
create table public.premium_things (id serial primary key, user_id uuid not null, name text);
alter table public.premium_things enable row level security;
create policy premium_select on public.premium_things for select to authenticated using (user_id = auth.uid() and public.has_platform_access(auth.uid()));
grant select on public.premium_things to authenticated;
`;

const OLD_HAS = `create function public.has_platform_access(uid uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.profiles p where p.id = uid and (p.role = 'admin' or (p.membership_status = 'active' and (p.membership_expires_at is null or p.membership_expires_at > now())))) $$;`;
const GRANT_HAS = `create function public.has_platform_access(uid uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.profiles p where p.id = uid and (p.role = 'admin' or p.membership_status = 'active'))
  or exists (select 1 from public.user_access_grants g where g.user_id = uid and g.status = 'active' and (g.expires_at is null or g.expires_at > now())) $$;`;

async function asUser(c, uid, role = "authenticated") {
  await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid, role })]);
  await c.query(`set session authorization authenticator`); await c.query(`set role ${role}`);
}
async function asSuper(c) {
  await c.query(`reset role`); await c.query(`reset session authorization`);
  await c.query(`select set_config('request.jwt.claims', '', false)`);
}

const t = (name, fn) => test(name, fn);

async function freshDb(name, hasBody) {
  const admin = mk(); await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
  await admin.end();
  const c = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database: name });
  c.on("notice", (n) => notices.push(n.message));
  await c.connect();
  await c.query(stubBase(hasBody));
  return c;
}

async function connectTo(name) {
  const c = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database: name });
  c.on("notice", (n) => notices.push(n.message));
  await c.connect();
  return c;
}

const newUser = async (c, opts = {}) => {
  const { rows } = await c.query(`insert into auth.users (email) values ($1) returning id`, [`u${Math.random()}@x.com`]);
  await c.query(`insert into public.profiles (id, role, membership_status, membership_expires_at) values ($1,$2,$3,$4)`,
    [rows[0].id, opts.role ?? null, opts.membership ?? null, opts.expires ?? null]);
  return rows[0].id;
};
const redeem = async (c, uid, code) => {
  await asUser(c, uid);
  try { const r = await c.query(`select public.redeem_beta_access_code($1) as r`, [code]); return r.rows[0].r; }
  finally { await asSuper(c); }
};
const hasAccess = async (c, uid) => (await c.query(`select public.has_platform_access($1) as v`, [uid])).rows[0].v;

async function main() {
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  try {
  // ---------- Scenario A: has_platform_access NOT compatible → migration aborts, remote logic untouched ----------
  const diagnostic = fs.readFileSync(path.join(process.cwd(), "supabase/diagnostics/20261005_beta_access_state.sql"), "utf8");
  // The diagnostic must be a single, read-only statement: run it inside a READ ONLY transaction.
  const runDiagnostic = async (client) => {
    await client.query("begin read only");
    try {
      return (await client.query(diagnostic)).rows;
    } finally {
      await client.query("rollback");
    }
  };
  const verdict = (rows) => rows.find((r) => r.section === "0_VERDICT" && r.item === "has_platform_access(uuid)").detail;
  const definitionOf = async (client) =>
    (await client.query("select pg_get_functiondef('public.has_platform_access(uuid)'::regprocedure) as d")).rows[0].d;
  const betaTables = async (client) =>
    (await client.query("select count(*)::int n from pg_class where relname like 'beta\\_access\\_%' and relkind = 'r'")).rows[0].n;

  let c = await freshDb("db_a", OLD_HAS);
  const free = await newUser(c);
  const paid = await newUser(c, { membership: "active" });
  const admin = await newUser(c, { role: "admin" });
  await c.query(`insert into public.user_access_grants (user_id, grant_type, status) values ($1,'beta_tester','active')`, [free]);
  const definitionBefore = await definitionOf(c);

  await t("diagnostic is read-only and flags the incompatible function", async () => {
    const rows = await runDiagnostic(c);
    assert.match(verdict(rows), /^INCOMPATIBLE/);
    assert.ok(rows.some((r) => r.section === "A_functions" && /has_platform_access/.test(r.item)));
    assert.ok(rows.some((r) => r.section === "B_policies"));
    assert.ok(rows.some((r) => r.section === "D_beta_objects" && /No Beta objects yet/.test(r.detail)));
    assert.equal(await betaTables(c), 0);
  });
  await t("migration ABORTS (fails closed) when has_platform_access does not honour grants", async () => {
    await assert.rejects(c.query(migration), /Beta access migration aborted/);
  });
  await t("aborted migration changed nothing: function body identical, no Beta tables or functions", async () => {
    assert.equal(await definitionOf(c), definitionBefore);
    assert.equal(await betaTables(c), 0);
    const fns = (await c.query("select count(*)::int n from pg_proc where proname in ('redeem_beta_access_code','create_beta_access_code','revoke_beta_access')")).rows[0].n;
    assert.equal(fns, 0);
  });
  await t("aborted migration also did not run the privilege hardening (same transaction, nothing applied)", async () => {
    assert.equal((await c.query("select has_table_privilege('authenticated', 'public.user_access_grants', 'TRUNCATE') as v")).rows[0].v, true);
  });
  await t("a function that hides the grants behind an unknown helper is also refused (fail closed)", async () => {
    await c.query("create function public.opaque_helper(uuid) returns boolean language sql as 'select true'");
    await c.query("create or replace function public.has_platform_access(uid uuid) returns boolean language sql stable security definer as $$ select public.opaque_helper(uid) $$");
    await assert.rejects(c.query(migration), /Beta access migration aborted/);
    assert.equal(await betaTables(c), 0);
  });
  await t("paid/admin/free access is exactly as before after the aborted attempts", async () => {
    await c.query(OLD_HAS.replace("create function", "create or replace function"));
    assert.equal(await hasAccess(c, paid), true);
    assert.equal(await hasAccess(c, admin), true);
    assert.equal(await hasAccess(c, free), false);
  });
  await c.query("drop function public.has_platform_access(uuid) cascade");
  await t("missing has_platform_access: migration aborts and diagnostic says INCOMPATIBLE", async () => {
    await assert.rejects(c.query(migration), /Missing dependency: public\.has_platform_access/);
    assert.match(verdict(await runDiagnostic(c)), /^INCOMPATIBLE: public\.has_platform_access\(uuid\) does not exist/);
  });
  await c.end();

  // ---------- Scenario B: compatible (grants-aware) function → untouched; main behaviour ----------
  c = await freshDb("db_b", GRANT_HAS);
  const compatibleDefinition = await definitionOf(c);
  await t("diagnostic reports COMPATIBLE and is still read-only before the migration", async () => {
    const rows = await runDiagnostic(c);
    assert.match(verdict(rows), /^COMPATIBLE/);
    assert.equal(await betaTables(c), 0);
  });
  const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
  const priv = async (client, role, p) =>
    (await client.query("select has_table_privilege($1, 'public.user_access_grants', $2) as v", [role, p])).rows[0].v;
  const privSnapshot = async (client, role) => Object.fromEntries(await Promise.all(PRIVS.map(async (p) => [p, await priv(client, role, p)])));
  const serviceRoleBefore = await privSnapshot(c, "service_role");

  await t("before the migration the stub mirrors the remote problem (TRUNCATE exposed) and the diagnostic says NOT HARDENED", async () => {
    assert.equal(await priv(c, "anon", "TRUNCATE"), true);
    assert.equal(await priv(c, "authenticated", "TRUNCATE"), true);
    const rows = await runDiagnostic(c);
    const row = rows.find((r) => r.section === "0_VERDICT" && r.item === "user_access_grants privileges");
    assert.match(row.detail, /^NOT HARDENED/);
  });

  await t("migration applies on a compatible function WITHOUT touching it", async () => {
    await c.query(migration);
    assert.equal(await definitionOf(c), compatibleDefinition);
  });
  await t("diagnostic after the migration lists Beta objects with the expected privileges", async () => {
    const rows = await runDiagnostic(c);
    const beta = rows.filter((r) => r.section === "D_beta_objects");
    assert.ok(beta.some((r) => r.item === "table beta_access_codes" && /anon_select=false, authenticated_select=false, authenticated_insert=false/.test(r.detail)));
    assert.ok(beta.some((r) => r.item.startsWith("function redeem_beta_access_code") && /anon_execute=false, authenticated_execute=true/.test(r.detail)));
    assert.ok(beta.some((r) => r.item.startsWith("function beta_access_code_digest") && /authenticated_execute=false/.test(r.detail)));
    assert.ok(!rows.some((r) => /code_digest.*[0-9a-f]{64}/.test(r.detail ?? "")));
  });
  await t("migration is idempotent (re-run) and still leaves the function alone", async () => {
    await c.query(migration);
    assert.equal(await definitionOf(c), compatibleDefinition);
  });

  // ---- user_access_grants privilege hardening (applied by the migration) ----
  await t("hardening: anon has NO privilege at all on user_access_grants", async () => {
    for (const p of PRIVS) assert.equal(await priv(c, "anon", p), false, `anon ${p}`);
  });
  await t("hardening: authenticated has no TRUNCATE / REFERENCES / TRIGGER", async () => {
    for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"]) assert.equal(await priv(c, "authenticated", p), false, `authenticated ${p}`);
  });
  await t("hardening: authenticated keeps SELECT/INSERT/UPDATE/DELETE (admin grant management uses authenticated + RLS)", async () => {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) assert.equal(await priv(c, "authenticated", p), true, `authenticated ${p}`);
  });
  await t("hardening: service_role privileges are untouched", async () => {
    assert.deepEqual(await privSnapshot(c, "service_role"), serviceRoleBefore);
  });
  await t("TRUNCATE is rejected for anon and authenticated and no grant is lost", async () => {
    const victim = await newUser(c);
    await c.query(`insert into public.user_access_grants (user_id, grant_type, status) values ($1,'beta_tester','active')`, [victim]);
    const before = (await c.query("select count(*)::int n from public.user_access_grants")).rows[0].n;
    await c.query("set session authorization authenticator");
    await c.query("set role anon");
    await assert.rejects(c.query("truncate public.user_access_grants"), /permission denied/);
    await asSuper(c);
    await asUser(c, victim);
    await assert.rejects(c.query("truncate public.user_access_grants"), /permission denied/);
    await asSuper(c);
    assert.equal((await c.query("select count(*)::int n from public.user_access_grants")).rows[0].n, before);
  });
  await t("a normal user still cannot INSERT, UPDATE or DELETE grants, and still reads only their own", async () => {
    const normal = await newUser(c);
    const other = await newUser(c);
    await c.query(`insert into public.user_access_grants (user_id, grant_type, status) values ($1,'beta_tester','active')`, [other]);
    await asUser(c, normal);
    await assert.rejects(c.query(`insert into public.user_access_grants (user_id, grant_type, status) values ($1,'beta_tester','active')`, [normal]), /row-level security/);
    assert.equal((await c.query(`update public.user_access_grants set status = 'active', expires_at = null where user_id = $1`, [other])).rowCount, 0);
    assert.equal((await c.query(`delete from public.user_access_grants where user_id = $1`, [other])).rowCount, 0);
    assert.equal((await c.query("select count(*)::int n from public.user_access_grants")).rows[0].n, 0);
    await asSuper(c);
    assert.equal((await c.query("select count(*)::int n from public.user_access_grants where user_id = $1", [other])).rows[0].n, 1);
  });
  await t("Admin can still manage grants through authenticated + RLS (insert, revoke, delete) as the app does today", async () => {
    const admin = await newUser(c, { role: "admin" });
    const target = await newUser(c);
    await asUser(c, admin);
    assert.equal((await c.query(`insert into public.user_access_grants (user_id, grant_type, status, created_by) values ($1,'beta_tester','active',$2)`, [target, admin])).rowCount, 1);
    assert.equal((await c.query(`update public.user_access_grants set status = 'revoked' where user_id = $1`, [target])).rowCount, 1);
    assert.equal((await c.query(`select count(*)::int n from public.user_access_grants where user_id = $1`, [target])).rows[0].n, 1);
    assert.equal((await c.query(`delete from public.user_access_grants where user_id = $1`, [target])).rowCount, 1);
    await asSuper(c);
  });
  await t("service_role can still read and write grants (callback / admin client)", async () => {
    const target = await newUser(c);
    await asUser(c, target, "service_role");
    assert.equal((await c.query(`insert into public.user_access_grants (user_id, grant_type, status) values ($1,'beta_tester','active')`, [target])).rowCount, 1);
    assert.equal((await c.query(`update public.user_access_grants set status = 'revoked' where user_id = $1`, [target])).rowCount, 1);
    assert.equal((await c.query(`select count(*)::int n from public.user_access_grants where user_id = $1`, [target])).rows[0].n, 1);
    assert.equal((await c.query(`delete from public.user_access_grants where user_id = $1`, [target])).rowCount, 1);
    await asSuper(c);
  });
  await t("the Beta redemption RPC still works after the hardening (security definer, independent of table privileges)", async () => {
    await c.query(`select public.create_beta_access_code('HARDENING-CHECK-1','hardening',1,null,null)`);
    const x = await newUser(c);
    assert.equal((await redeem(c, x, "HARDENING-CHECK-1")).status, "redeemed");
    assert.equal(await hasAccess(c, x), true);
    assert.equal((await redeem(c, x, "HARDENING-CHECK-1")).status, "already_redeemed");
  });
  await t("diagnostic after the migration reports HARDENED and explicit TRUNCATE = false rows", async () => {
    const rows = await runDiagnostic(c);
    const row = rows.find((r) => r.section === "0_VERDICT" && r.item === "user_access_grants privileges");
    assert.match(row.detail, /^HARDENED/);
    const detail = (item) => rows.find((r) => r.section === "C_privileges" && r.item === item)?.detail;
    assert.equal(detail("anon TRUNCATE"), "false");
    assert.equal(detail("authenticated TRUNCATE"), "false");
    assert.equal(detail("anon SELECT"), "false");
    assert.equal(detail("authenticated INSERT"), "true");
    assert.equal(detail("service_role SELECT"), "true");
  });

  const u = {
    free: await newUser(c), a: await newUser(c), b: await newUser(c), existing: await newUser(c),
    paid: await newUser(c, { membership: "active" }), admin: await newUser(c, { role: "admin" }), other: await newUser(c),
  };
  const CODE = "TEST-BETA-ZZ91K2";

  await t("create_beta_access_code: non-admin authenticated is forbidden", async () => {
    await asUser(c, u.free);
    await assert.rejects(c.query(`select public.create_beta_access_code($1,'x',5,null,null)`, [CODE]), /forbidden/);
    await asSuper(c);
  });
  await t("create_beta_access_code: anon cannot execute", async () => {
    await c.query(`set session authorization authenticator`); await c.query(`set role anon`);
    await assert.rejects(c.query(`select public.create_beta_access_code($1,'x',5,null,null)`, [CODE]), /permission denied/);
    await asSuper(c);
  });
  await t("create_beta_access_code: postgres session can create (shared code, max 3)", async () => {
    const r = await c.query(`select public.create_beta_access_code($1,'Beta launch',3,now() + interval '10 days', now() + interval '60 days') as r`, [` ${CODE.toLowerCase()} `]);
    assert.equal(r.rows[0].r.label, "Beta launch");
    assert.ok(!JSON.stringify(r.rows[0].r).includes("ZZ91K2"));
  });
  await t("create_beta_access_code: admin authenticated can create another code", async () => {
    await asUser(c, u.admin);
    const r = await c.query(`select public.create_beta_access_code('SECOND-CODE-1', 'second', 1, null, null) as r`);
    await asSuper(c);
    assert.ok(r.rows[0].r.id);
  });
  await t("duplicate code rejected", async () => {
    await assert.rejects(c.query(`select public.create_beta_access_code($1,'dup',5,null,null)`, [CODE]), /code_already_exists/);
  });
  await t("no plaintext in DB: code text appears nowhere in codes table", async () => {
    const { rows } = await c.query(`select row_to_json(t)::text as j from public.beta_access_codes t`);
    for (const r of rows) { assert.ok(!/ZZ91K2/i.test(r.j)); assert.ok(!/SECOND-CODE/i.test(r.j)); }
    assert.equal(rows[0].j.includes("code_digest"), true);
  });
  await t("authenticated cannot read codes / write ledgers / call helpers", async () => {
    await asUser(c, u.free);
    await assert.rejects(c.query(`select * from public.beta_access_codes`), /permission denied/);
    await assert.rejects(c.query(`insert into public.beta_access_redemptions (code_id,user_id) values (gen_random_uuid(), $1)`, [u.free]), /permission denied/);
    await assert.rejects(c.query(`select * from public.beta_access_failed_attempts`), /permission denied/);
    await assert.rejects(c.query(`select public.beta_access_code_digest('X')`), /permission denied/);
    await assert.rejects(c.query(`select public.revoke_beta_access($1)`, [u.free]), /forbidden/);
    await asSuper(c);
  });
  await t("user cannot self-grant: update/insert into user_access_grants blocked (RLS, stub policy) and ledger writes blocked", async () => {
    await asUser(c, u.free);
    await assert.rejects(c.query(`insert into public.user_access_grants (user_id, grant_type, status) values ($1,'beta_tester','active')`, [u.free]), /(permission denied|row-level security)/);
    await asSuper(c);
  });

  await t("Free without code stays without platform access", async () => assert.equal(await hasAccess(c, u.free), false));
  await t("unauthenticated redeem", async () => {
    await c.query(`select set_config('request.jwt.claims', '', false)`);
    await c.query(`set session authorization authenticator`); await c.query(`set role authenticated`);
    const r = await c.query(`select public.redeem_beta_access_code($1) as r`, [CODE]);
    await asSuper(c);
    assert.equal(r.rows[0].r.status, "unauthenticated");
  });
  await t("valid code (any casing/spacing/dashes) → redeemed; Beta gets platform access", async () => {
    const r = await redeem(c, u.a, "  test–beta zz91k2 ");
    assert.equal(r.status, "redeemed");
    assert.equal(await hasAccess(c, u.a), true);
  });
  await t("Beta is NOT paid: profile membership untouched, grant is beta_tester", async () => {
    const p = (await c.query(`select membership_status, membership_expires_at from public.profiles where id=$1`, [u.a])).rows[0];
    assert.equal(p.membership_status, null);
    const g = (await c.query(`select grant_type,status,expires_at,notes from public.user_access_grants where user_id=$1`, [u.a])).rows;
    assert.equal(g.length, 1); assert.equal(g[0].grant_type, "beta_tester"); assert.equal(g[0].status, "active");
    assert.ok(g[0].expires_at); assert.ok(!/ZZ91K2/i.test(g[0].notes)); assert.equal(g[0].notes, "Código beta: Beta launch");
  });
  await t("access_expires_at is independent from redeem_until", async () => {
    const r = (await c.query(`select redeem_until, access_expires_at from public.beta_access_codes where label='Beta launch'`)).rows[0];
    assert.ok(new Date(r.access_expires_at) > new Date(r.redeem_until));
    const g = (await c.query(`select expires_at from public.user_access_grants where user_id=$1`, [u.a])).rows[0];
    assert.equal(new Date(g.expires_at).getTime(), new Date(r.access_expires_at).getTime());
  });
  await t("idempotent: same user again → already_redeemed, no extra use, no duplicate grant", async () => {
    const r = await redeem(c, u.a, CODE);
    assert.equal(r.status, "already_redeemed");
    assert.equal((await c.query(`select count(*)::int n from public.beta_access_redemptions r join public.beta_access_codes k on k.id = r.code_id where k.label = 'Beta launch'`)).rows[0].n, 1);
    assert.equal((await c.query(`select count(*)::int n from public.user_access_grants where user_id=$1`, [u.a])).rows[0].n, 1);
  });
  await t("existing account (already Free for a while) can redeem", async () => {
    assert.equal(await hasAccess(c, u.existing), false);
    assert.equal((await redeem(c, u.existing, CODE)).status, "redeemed");
    assert.equal(await hasAccess(c, u.existing), true);
  });
  await t("RLS: Beta user reads own premium rows, Free does not, other user's rows stay hidden", async () => {
    await c.query(`insert into public.premium_things (user_id,name) values ($1,'a-row'),($2,'free-row'),($3,'b-row')`, [u.a, u.free, u.existing]);
    await asUser(c, u.a);
    let rows = (await c.query(`select name from public.premium_things`)).rows;
    assert.deepEqual(rows.map((x) => x.name), ["a-row"]);
    await asUser(c, u.free);
    rows = (await c.query(`select name from public.premium_things`)).rows;
    assert.equal(rows.length, 0);
    await asSuper(c);
  });
  await t("paid and admin keep working", async () => {
    assert.equal(await hasAccess(c, u.paid), true);
    assert.equal(await hasAccess(c, u.admin), true);
  });
  await t("max_uses exhausted (3rd tester OK, 4th exhausted)", async () => {
    assert.equal((await redeem(c, u.b, CODE)).status, "redeemed");
    assert.equal((await redeem(c, u.other, CODE)).status, "exhausted");
    assert.equal(await hasAccess(c, u.other), false);
    assert.equal((await c.query(`select count(*)::int n from public.beta_access_redemptions r join public.beta_access_codes k on k.id = r.code_id where k.label = 'Beta launch'`)).rows[0].n, 3);
  });
  await t("invalid code → invalid and no access; shape-invalid too", async () => {
    const x = await newUser(c);
    assert.equal((await redeem(c, x, "NOPE-NOPE-NOPE")).status, "invalid");
    assert.equal((await redeem(c, x, "x")).status, "invalid");
    assert.equal((await redeem(c, x, null)).status, "invalid");
    assert.equal(await hasAccess(c, x), false);
  });
  await t("brute-force: 5 failures then rate_limited (even for the valid code)", async () => {
    const x = await newUser(c);
    for (let i = 0; i < 5; i++) assert.equal((await redeem(c, x, "WRONG-CODE-" + i)).status, "invalid");
    assert.equal((await redeem(c, x, "WRONG-CODE-9")).status, "rate_limited");
    assert.equal((await redeem(c, x, "SECOND-CODE-1")).status, "rate_limited");
    assert.equal(await hasAccess(c, x), false);
  });
  await t("rate limit is per user: one user's failures never block another tester (no shared counter)", async () => {
    const attacker = await newUser(c);
    for (let i = 0; i < 40; i++) await redeem(c, attacker, "NOPE-ATTACK-" + i);
    assert.equal((await redeem(c, attacker, "NOPE-ATTACK-X")).status, "rate_limited");
    const honest = await newUser(c);
    assert.equal((await redeem(c, honest, "WRONG-HONEST-1")).status, "invalid");
    assert.equal((await redeem(c, honest, "SECOND-CODE-1")).status, "redeemed");
    assert.equal(await hasAccess(c, honest), true);
  });
  await t("expired redeem_until → expired", async () => {
    await c.query(`select public.create_beta_access_code('EXPIRED-CODE-1','exp',null,now()+interval '1 day',null)`);
    await c.query(`update public.beta_access_codes set redeem_until = now() - interval '1 hour' where label='exp'`);
    const x = await newUser(c);
    assert.equal((await redeem(c, x, "EXPIRED-CODE-1")).status, "expired");
    assert.equal(await hasAccess(c, x), false);
  });
  await t("inactive code → invalid", async () => {
    await c.query(`select public.create_beta_access_code('INACTIVE-CODE-1','inact',null,null,null)`);
    await c.query(`update public.beta_access_codes set active=false where label='inact'`);
    const x = await newUser(c);
    assert.equal((await redeem(c, x, "INACTIVE-CODE-1")).status, "invalid");
  });
  await t("deactivating a code does not break already redeemed users (idempotent answer)", async () => {
    await c.query(`update public.beta_access_codes set active=false where label='Beta launch'`);
    assert.equal((await redeem(c, u.a, CODE)).status, "already_redeemed");
    await c.query(`update public.beta_access_codes set active=true where label='Beta launch'`);
  });
  await t("beta access expiration removes access", async () => {
    await c.query(`update public.user_access_grants set expires_at = now() - interval '1 minute' where user_id=$1`, [u.a]);
    assert.equal(await hasAccess(c, u.a), false);
    await asUser(c, u.a);
    assert.equal((await c.query(`select count(*)::int n from public.premium_things`)).rows[0].n, 0);
    await asSuper(c);
  });
  await t("revoked grant removes access; revoke_beta_access via admin; re-redeem same code → revoked", async () => {
    await asUser(c, u.admin);
    const r = await c.query(`select public.revoke_beta_access($1) as r`, [u.existing]);
    await asSuper(c);
    assert.equal(r.rows[0].r.grants_revoked, 1);
    assert.equal(await hasAccess(c, u.existing), false);
    assert.equal((await redeem(c, u.existing, CODE)).status, "revoked");
    assert.equal(await hasAccess(c, u.existing), false);
  });
  await t("admin UI style revoke (grant status only) is also reported as revoked, not already_redeemed", async () => {
    await c.query(`update public.user_access_grants set status='revoked' where user_id=$1`, [u.b]);
    assert.equal(await hasAccess(c, u.b), false);
    assert.equal((await redeem(c, u.b, CODE)).status, "revoked");
  });
  await t("existing unlimited admin-granted beta is never shortened by a code", async () => {
    const x = await newUser(c);
    await c.query(`insert into public.user_access_grants (user_id, grant_type, status, expires_at) values ($1,'beta_tester','active',null)`, [x]);
    await c.query(`select public.create_beta_access_code('LONG-ENOUGH-1','le',null,null,now()+interval '5 days')`);
    assert.equal((await redeem(c, x, "LONG-ENOUGH-1")).status, "redeemed");
    const g = (await c.query(`select expires_at from public.user_access_grants where user_id=$1`, [x])).rows;
    assert.equal(g.length, 1); assert.equal(g[0].expires_at, null);
  });
  await t("revoked grant is reactivated by a different valid code (no duplicate row)", async () => {
    const x = await newUser(c);
    await c.query(`insert into public.user_access_grants (user_id, grant_type, status) values ($1,'beta_tester','revoked')`, [x]);
    assert.equal((await redeem(c, x, "LONG-ENOUGH-1")).status, "redeemed");
    assert.equal((await c.query(`select count(*)::int n from public.user_access_grants where user_id=$1`, [x])).rows[0].n, 1);
    assert.equal(await hasAccess(c, x), true);
  });
  await c.end();

  // ---------- Scenario C: true concurrency ----------
  c = await connectTo("db_b");
  await c.query(`select public.create_beta_access_code('SINGLE-USE-CODE','single',1,null,null)`);
  const racers = [];
  for (let i = 0; i < 12; i++) racers.push(await newUser(c));
  await t("max_uses=1, 12 concurrent redeemers → exactly 1 redeemed, 11 exhausted", async () => {
    const conns = await Promise.all(racers.map(async () => connectTo("db_b")));
    const results = await Promise.all(conns.map(async (cn, i) => {
      await asUser(cn, racers[i]);
      const r = await cn.query(`select public.redeem_beta_access_code('SINGLE-USE-CODE') as r`);
      return r.rows[0].r.status;
    }));
    await Promise.all(conns.map((cn) => cn.end()));
    assert.equal(results.filter((s) => s === "redeemed").length, 1, results.join(","));
    assert.equal(results.filter((s) => s === "exhausted").length, 11, results.join(","));
    const n = (await c.query(`select count(*)::int n from public.beta_access_redemptions r join public.beta_access_codes k on k.id=r.code_id where k.label='single'`)).rows[0].n;
    assert.equal(n, 1);
    const grants = (await c.query(`select count(*)::int n from public.user_access_grants where user_id = any($1) and status='active'`, [racers])).rows[0].n;
    assert.equal(grants, 1);
  });
  await t("same user firing the same redeem 8x concurrently consumes one use", async () => {
    await c.query(`select public.create_beta_access_code('SHARED-CODE-77','shared',5,null,null)`);
    const x = await newUser(c);
    const conns = await Promise.all(Array.from({ length: 8 }, () => connectTo("db_b")));
    const results = await Promise.all(conns.map(async (cn) => {
      await asUser(cn, x);
      return (await cn.query(`select public.redeem_beta_access_code('SHARED-CODE-77') as r`)).rows[0].r.status;
    }));
    await Promise.all(conns.map((cn) => cn.end()));
    assert.equal(results.filter((s) => s === "redeemed").length, 1, results.join(","));
    assert.equal(results.filter((s) => s === "already_redeemed").length, 7, results.join(","));
    assert.equal((await c.query(`select count(*)::int n from public.user_access_grants where user_id=$1`, [x])).rows[0].n, 1);
  });
  await c.end();

  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

if (!EmbeddedPostgres || !pg) {
  test("beta access DB behaviour", { skip: "optional: npm i --no-save embedded-postgres pg" }, () => {});
} else {
  await main();
}
