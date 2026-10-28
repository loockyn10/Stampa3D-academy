// DB-level behaviour of supabase/migrations/20261028120000_beta_redeem_legacy_invite_codes.sql against a REAL
// Postgres (embedded, throw-away, local only — never touches Supabase). Opt-in, like tests/beta-access-db.test.mjs:
//
//   npm i --no-save embedded-postgres pg && node --test tests/beta-legacy-invite-db.test.mjs
//
// Supabase pieces (auth schema, roles, profiles, user_access_grants, is_admin, has_platform_access) and the
// legacy invite_codes tables (not versioned in the repo; shape taken from /admin/codigos and /auth/callback)
// are stubbed. No real code is ever used: every code below is a fixture.
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

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const betaMigration = read("supabase/migrations/20261005120000_beta_access_codes.sql");
const legacyMigration = read("supabase/migrations/20261028120000_beta_redeem_legacy_invite_codes.sql");
const PORT = Number(process.env.BETA_LEGACY_TEST_PG_PORT) || 54331;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-legacy-beta-pg-"));
let server;

const mk = (database = "postgres") => new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database });

const stub = `
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
grant all on public.user_access_grants to anon, authenticated, service_role;
grant all on public.profiles to service_role;
create function public.is_admin(uid uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles where id = uid and role = 'admin') $$;
create policy "Admins can manage access grants" on public.user_access_grants for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "Users can view own access grants" on public.user_access_grants for select to authenticated using (user_id = auth.uid());
create function public.has_platform_access(uid uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.profiles p where p.id = uid and (p.role = 'admin' or p.membership_status = 'active'))
  or exists (select 1 from public.user_access_grants g where g.user_id = uid and g.status = 'active' and (g.expires_at is null or g.expires_at > now())) $$;
`;

const legacyTables = `
create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  code_type text not null,
  title text,
  status text not null default 'active',
  max_uses integer,
  used_count integer not null default 0,
  starts_at timestamptz,
  expires_at timestamptz,
  access_expires_at timestamptz,
  discount_type text,
  discount_value numeric,
  discount_duration text,
  applies_to text,
  notes text,
  created_by uuid,
  created_at timestamptz default now()
);
create table public.invite_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_code_id uuid not null references public.invite_codes(id),
  user_id uuid not null references auth.users(id),
  redeemed_at timestamptz default now()
);
alter table public.invite_codes enable row level security;
alter table public.invite_code_redemptions enable row level security;
`;

async function asUser(c, uid, role = "authenticated") {
  await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role } : { role: "anon" })]);
  await c.query(`set session authorization authenticator`);
  await c.query(`set role ${role}`);
}
async function asSuper(c) {
  await c.query(`reset role`);
  await c.query(`reset session authorization`);
  await c.query(`select set_config('request.jwt.claims', '', false)`);
}

async function freshDb(name, { beta = true, legacy = true } = {}) {
  const admin = mk();
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
  await admin.end();
  const c = mk(name);
  await c.connect();
  await c.query(stub);
  if (beta) await c.query(betaMigration);
  if (legacy) await c.query(legacyTables);
  return c;
}

const newUser = async (c, opts = {}) => {
  const { rows } = await c.query(`insert into auth.users (email) values ($1) returning id`, [`u${Math.random()}@x.com`]);
  await c.query(`insert into public.profiles (id, role, membership_status) values ($1,$2,$3)`, [rows[0].id, opts.role ?? null, opts.membership ?? null]);
  return rows[0].id;
};
const insertCode = async (c, code, fields = {}) => {
  const f = { code_type: "beta_tester", status: "active", ...fields };
  const keys = ["code", ...Object.keys(f)];
  const { rows } = await c.query(
    `insert into public.invite_codes (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    [code, ...Object.values(f)],
  );
  return rows[0].id;
};
const redeem = async (c, uid, code) => {
  await asUser(c, uid);
  try {
    return (await c.query(`select public.redeem_beta_access_code($1) as r`, [code])).rows[0].r;
  } finally {
    await asSuper(c);
  }
};
const hasAccess = async (c, uid) => (await c.query(`select public.has_platform_access($1) as v`, [uid])).rows[0].v;
const usedCount = async (c, code) => (await c.query(`select used_count from public.invite_codes where code=$1`, [code])).rows[0].used_count;
const grantsOf = async (c, uid) => (await c.query(`select * from public.user_access_grants where user_id=$1`, [uid])).rows;

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  try {
    // ---------- Migration preconditions (fail closed, nothing changed) ----------
    await test("migration aborts when the Beta Access objects are missing", async () => {
      const c = await freshDb("db_nobeta", { beta: false });
      await assert.rejects(c.query(legacyMigration), /Apply 20261005120000_beta_access_codes\.sql first/);
      await c.end();
    });
    await test("migration aborts when there are no legacy tables", async () => {
      const c = await freshDb("db_nolegacy", { legacy: false });
      await assert.rejects(c.query(legacyMigration), /do not exist/);
      assert.equal((await c.query(`select to_regprocedure('public.redeem_legacy_beta_invite(uuid,text)') as f`)).rows[0].f, null);
      await c.end();
    });
    await test("migration aborts when a legacy column it needs is missing", async () => {
      const c = await freshDb("db_badshape");
      await c.query(`alter table public.invite_codes drop column access_expires_at`);
      await assert.rejects(c.query(legacyMigration), /missing expected columns: invite_codes\.access_expires_at/);
      await c.end();
    });
    await test("migration aborts when grant_type is not text-like", async () => {
      const c = await freshDb("db_enum");
      await c.query(`create type grant_kind as enum ('beta_tester','manual_free_access','internal_tester')`);
      await c.query(`alter table public.user_access_grants alter column grant_type type grant_kind using grant_type::grant_kind`);
      await assert.rejects(c.query(legacyMigration), /grant_type is not text\/varchar/);
      await c.end();
    });

    // ---------- Diagnostic (read-only, single statement, works with or without the tables) ----------
    const diagnostic = read("supabase/diagnostics/20261028_codes_state.sql");
    const runDiagnostic = async (client) => {
      await client.query("begin read only");
      try {
        return (await client.query(diagnostic)).rows;
      } finally {
        await client.query("rollback");
      }
    };
    const verdictOf = (rows, item) => rows.find((r) => r.section === "0_VERDICT" && r.item.startsWith(item))?.detail;
    await test("diagnostic: runs read-only on a database with none of the objects and says what is missing", async () => {
      const c = await freshDb("db_diag_a", { beta: false, legacy: false });
      const rows = await runDiagnostic(c);
      assert.match(verdictOf(rows, "Beta Access migration"), /^NOT APPLIED/);
      assert.match(verdictOf(rows, "Legacy bridge"), /^n\/a/);
      assert.match(verdictOf(rows, "legacy tables"), /invite_codes=false/);
      assert.ok(rows.filter((r) => r.section === "D_legacy_counts").every((r) => r.detail === "(none)"));
      await c.end();
    });
    await test("diagnostic: before the bridge it flags that /admin/codigos codes are not redeemable; it never prints a code", async () => {
      const c = await freshDb("db_diag_b");
      await insertCode(c, "BETA-SECRETO1", { max_uses: 1, used_count: 1 });
      await insertCode(c, "PROMO-SECRETO2", { code_type: "discount_percent", discount_type: "percent", discount_value: 20 });
      const u = await newUser(c);
      const id = (await c.query(`select id from public.invite_codes where code='BETA-SECRETO1'`)).rows[0].id;
      await c.query(`insert into public.invite_code_redemptions (invite_code_id, user_id) values ($1,$2)`, [id, u]);
      const snapshot = JSON.stringify((await c.query(`select (select count(*) from public.invite_codes) a, (select count(*) from public.invite_code_redemptions) b, (select count(*) from public.user_access_grants) g`)).rows);
      const rows = await runDiagnostic(c);
      assert.match(verdictOf(rows, "Beta Access migration"), /^applied/);
      assert.match(verdictOf(rows, "Legacy bridge"), /^NOT APPLIED: only hashed/);
      assert.match(verdictOf(rows, "discount codes"), /^1 stored/);
      const counts = rows.filter((r) => r.section === "D_legacy_counts");
      assert.ok(counts.some((r) => /beta_tester \/ status=active: codes=1/.test(r.detail)));
      assert.ok(counts.some((r) => /codes_where_used_count_differs=0/.test(r.detail)));
      assert.ok(counts.some((r) => /^count=1$/.test(r.detail)), "the redemption without a grant is reported");
      assert.doesNotMatch(JSON.stringify(rows), /SECRETO/);
      assert.equal(JSON.stringify((await c.query(`select (select count(*) from public.invite_codes) a, (select count(*) from public.invite_code_redemptions) b, (select count(*) from public.user_access_grants) g`)).rows), snapshot);
      await c.end();
    });

    // ---------- Behaviour ----------
    const c = await freshDb("db_legacy");
    const before = (await c.query(`select pg_get_functiondef('public.redeem_beta_access_code(text)'::regprocedure) as d`)).rows[0].d;
    assert.doesNotMatch(before, /redeem_legacy_beta_invite/);
    await c.query(legacyMigration);
    await c.query(legacyMigration); // idempotent
    const t = (name, fn) => test(name, fn);

    await t("privileges: only authenticated can redeem; the helper is not callable by API roles", async () => {
      const priv = async (role, fn) => (await c.query(`select has_function_privilege($1, $2, 'execute') as v`, [role, fn])).rows[0].v;
      assert.equal(await priv("authenticated", "public.redeem_beta_access_code(text)"), true);
      assert.equal(await priv("anon", "public.redeem_beta_access_code(text)"), false);
      assert.equal(await priv("authenticated", "public.redeem_legacy_beta_invite(uuid,text)"), false);
      assert.equal(await priv("anon", "public.redeem_legacy_beta_invite(uuid,text)"), false);
      const u = await newUser(c);
      await asUser(c, u);
      await assert.rejects(c.query(`select public.redeem_legacy_beta_invite($1,'ANY-CODE-1')`, [u]), /permission denied/);
      await asSuper(c);
    });

    await t("valid legacy beta code: grants Beta access, counts the use, keeps the plaintext code out of grants", async () => {
      await insertCode(c, "BETA-AB23CD", { title: "Beta agosto", access_expires_at: new Date(Date.now() + 30 * 864e5).toISOString() });
      const u = await newUser(c);
      assert.equal(await hasAccess(c, u), false);
      const r = await redeem(c, u, "beta-ab23cd"); // lower case + whitespace are normalized like the admin page does
      assert.equal(r.status, "redeemed");
      assert.ok(r.access_expires_at);
      assert.equal(await hasAccess(c, u), true);
      const g = await grantsOf(c, u);
      assert.equal(g.length, 1);
      assert.equal(g[0].grant_type, "beta_tester");
      assert.equal(g[0].status, "active");
      assert.doesNotMatch(g[0].notes ?? "", /AB23CD/);
      assert.equal(await usedCount(c, "BETA-AB23CD"), 1);
      assert.equal((await c.query(`select count(*)::int n from public.invite_code_redemptions`)).rows[0].n, 1);
      assert.equal((await c.query(`select count(*)::int n from public.beta_access_failed_attempts`)).rows[0].n, 0);
      // Beta is not Paid: the profile is untouched.
      assert.equal((await c.query(`select membership_status from public.profiles where id=$1`, [u])).rows[0].membership_status, null);
    });

    await t("short legacy codes created by hand are redeemable (existing codes are preserved)", async () => {
      await insertCode(c, "BETA50");
      const u = await newUser(c);
      assert.equal((await redeem(c, u, "BETA50")).status, "redeemed");
      assert.equal(await hasAccess(c, u), true);
    });

    await t("manual_free_access legacy code writes a manual_free_access grant", async () => {
      await insertCode(c, "GRATIS-2026", { code_type: "manual_free_access" });
      const u = await newUser(c);
      assert.equal((await redeem(c, u, "GRATIS-2026")).status, "redeemed");
      assert.equal((await grantsOf(c, u))[0].grant_type, "manual_free_access");
      assert.equal(await hasAccess(c, u), true);
    });

    await t("invalid code: rejected, no grant, counted as a failed attempt; 5 failures rate-limit the user only", async () => {
      const u = await newUser(c);
      const other = await newUser(c);
      for (let i = 0; i < 5; i++) assert.equal((await redeem(c, u, `NOPE-CODE-${i}`)).status, "invalid");
      assert.equal((await redeem(c, u, "BETA50")).status, "rate_limited");
      assert.equal((await grantsOf(c, u)).length, 0);
      assert.equal(await hasAccess(c, u), false);
      // The counter is per user: someone else is not locked out by this user's failures.
      assert.equal((await redeem(c, other, "BETA50")).status, "redeemed");
    });

    await t("junk shapes never reach a lookup", async () => {
      const u = await newUser(c);
      assert.equal((await redeem(c, u, "AB")).status, "invalid");
      assert.equal((await redeem(c, u, "")).status, "invalid");
      assert.equal((await redeem(c, u, "x".repeat(65))).status, "invalid");
    });

    await t("unauthenticated callers get 'unauthenticated' and nothing is written", async () => {
      await asUser(c, null, "authenticated");
      const r = (await c.query(`select public.redeem_beta_access_code('BETA-AB23CD') as r`)).rows[0].r;
      await asSuper(c);
      assert.equal(r.status, "unauthenticated");
    });

    await t("anon cannot call the RPC", async () => {
      await asUser(c, null, "anon");
      await assert.rejects(c.query(`select public.redeem_beta_access_code('BETA-AB23CD')`), /permission denied/);
      await asSuper(c);
    });

    await t("code that expired (expires_at in the past) is 'expired' and grants nothing", async () => {
      await insertCode(c, "BETA-VENCIDO", { expires_at: new Date(Date.now() - 864e5).toISOString() });
      const u = await newUser(c);
      assert.equal((await redeem(c, u, "BETA-VENCIDO")).status, "expired");
      assert.equal((await grantsOf(c, u)).length, 0);
      assert.equal(await usedCount(c, "BETA-VENCIDO"), 0);
    });

    await t("code whose access window already ended is 'expired'", async () => {
      await insertCode(c, "BETA-ACCESO-PASADO", { access_expires_at: new Date(Date.now() - 864e5).toISOString() });
      const u = await newUser(c);
      assert.equal((await redeem(c, u, "BETA-ACCESO-PASADO")).status, "expired");
      assert.equal((await grantsOf(c, u)).length, 0);
    });

    await t("not-yet-started and inactive legacy codes are rejected", async () => {
      await insertCode(c, "BETA-FUTURO", { starts_at: new Date(Date.now() + 864e5).toISOString() });
      await insertCode(c, "BETA-INACTIVO", { status: "inactive" });
      const u = await newUser(c);
      assert.equal((await redeem(c, u, "BETA-FUTURO")).status, "invalid");
      assert.equal((await redeem(c, u, "BETA-INACTIVO")).status, "invalid");
      assert.equal((await grantsOf(c, u)).length, 0);
    });

    await t("already used by the same user: idempotent, never consumes a second use", async () => {
      const u = await newUser(c);
      await insertCode(c, "BETA-UNA-VEZ", { max_uses: 5 });
      assert.equal((await redeem(c, u, "BETA-UNA-VEZ")).status, "redeemed");
      assert.equal((await redeem(c, u, "BETA-UNA-VEZ")).status, "already_redeemed");
      assert.equal((await redeem(c, u, "BETA-UNA-VEZ")).status, "already_redeemed");
      assert.equal(await usedCount(c, "BETA-UNA-VEZ"), 1);
      assert.equal((await grantsOf(c, u)).length, 1);
    });

    await t("redemption done by the old callback is honoured (used_count/redemption/grant already exist)", async () => {
      const u = await newUser(c);
      const id = await insertCode(c, "BETA-HISTORICO", { max_uses: 1, used_count: 1 });
      await c.query(`insert into public.invite_code_redemptions (invite_code_id, user_id) values ($1,$2)`, [id, u]);
      await c.query(`insert into public.user_access_grants (user_id, grant_type, status, notes) values ($1,'beta_tester','active','Acceso gratuito por código BETA-HISTORICO')`, [u]);
      assert.equal((await redeem(c, u, "BETA-HISTORICO")).status, "already_redeemed");
      assert.equal(await usedCount(c, "BETA-HISTORICO"), 1);
      const stranger = await newUser(c);
      assert.equal((await redeem(c, stranger, "BETA-HISTORICO")).status, "exhausted");
    });

    await t("revoked Beta access is reported as revoked and not silently re-granted by the same code", async () => {
      const u = await newUser(c);
      await insertCode(c, "BETA-REVOCABLE", { max_uses: 5 });
      assert.equal((await redeem(c, u, "BETA-REVOCABLE")).status, "redeemed");
      await c.query(`update public.user_access_grants set status='revoked' where user_id=$1`, [u]);
      assert.equal(await hasAccess(c, u), false);
      assert.equal((await redeem(c, u, "BETA-REVOCABLE")).status, "revoked");
      assert.equal(await hasAccess(c, u), false);
    });

    await t("max_uses exhausted: the next user is rejected; a stale used_count cannot hide real redemptions", async () => {
      await insertCode(c, "BETA-LIMITE-2", { max_uses: 2 });
      const [a, b, d] = [await newUser(c), await newUser(c), await newUser(c)];
      assert.equal((await redeem(c, a, "BETA-LIMITE-2")).status, "redeemed");
      assert.equal((await redeem(c, b, "BETA-LIMITE-2")).status, "redeemed");
      assert.equal((await redeem(c, d, "BETA-LIMITE-2")).status, "exhausted");
      assert.equal(await hasAccess(c, d), false);
      // used_count lost an increment (legacy non-atomic callback); the ledger still wins.
      await c.query(`update public.invite_codes set used_count = 0 where code='BETA-LIMITE-2'`);
      assert.equal((await redeem(c, d, "BETA-LIMITE-2")).status, "exhausted");
    });

    await t("discount / fixed price codes never grant access", async () => {
      await insertCode(c, "PROMO-AB23CD", { code_type: "discount_percent", discount_type: "percent", discount_value: 50 });
      await insertCode(c, "PRECIO-AB23CD", { code_type: "fixed_price", discount_type: "fixed_price", discount_value: 9900 });
      const u = await newUser(c);
      assert.equal((await redeem(c, u, "PROMO-AB23CD")).status, "invalid");
      assert.equal((await redeem(c, u, "PRECIO-AB23CD")).status, "invalid");
      assert.equal((await grantsOf(c, u)).length, 0);
      assert.equal(await hasAccess(c, u), false);
      assert.equal(await usedCount(c, "PROMO-AB23CD"), 0);
      assert.equal((await c.query(`select count(*)::int n from public.invite_code_redemptions r join public.invite_codes k on k.id=r.invite_code_id where k.code_type like 'discount%' or k.code_type='fixed_price'`)).rows[0].n, 0);
    });

    await t("existing Beta is only ever extended, never shortened; a revoked grant is reactivated without duplicates", async () => {
      const x = await newUser(c);
      await c.query(`insert into public.user_access_grants (user_id, grant_type, status, expires_at) values ($1,'beta_tester','active',null)`, [x]);
      await insertCode(c, "BETA-CORTO", { code_type: "beta_tester", access_expires_at: new Date(Date.now() + 5 * 864e5).toISOString() });
      assert.equal((await redeem(c, x, "BETA-CORTO")).status, "redeemed");
      const g = await grantsOf(c, x);
      assert.equal(g.length, 1);
      assert.equal(g[0].expires_at, null);

      const y = await newUser(c);
      await c.query(`insert into public.user_access_grants (user_id, grant_type, status) values ($1,'beta_tester','revoked')`, [y]);
      assert.equal((await redeem(c, y, "BETA-CORTO")).status, "redeemed");
      assert.equal((await grantsOf(c, y)).length, 1);
      assert.equal(await hasAccess(c, y), true);
    });

    await t("hashed Beta codes keep working and win over legacy codes with the same text", async () => {
      await c.query(`select public.create_beta_access_code('UNIVERSO-HASHED-1','hashed',null,null,null)`);
      const u = await newUser(c);
      assert.equal((await redeem(c, u, "UNIVERSO-HASHED-1")).status, "redeemed");
      assert.equal((await c.query(`select count(*)::int n from public.beta_access_redemptions`)).rows[0].n, 1);
      assert.equal((await c.query(`select coalesce(sum(used_count),0)::int n from public.invite_codes where code='UNIVERSO-HASHED-1'`)).rows[0].n, 0);
    });

    await t("redeeming does not touch memberships, subscriptions or admin status", async () => {
      const paid = await newUser(c, { membership: "active" });
      await insertCode(c, "BETA-PAGO", {});
      assert.equal((await redeem(c, paid, "BETA-PAGO")).status, "redeemed");
      const p = (await c.query(`select role, membership_status from public.profiles where id=$1`, [paid])).rows[0];
      assert.deepEqual(p, { role: null, membership_status: "active" });
    });

    // ---------- True concurrency ----------
    await t("legacy max_uses=1, 12 concurrent redeemers → exactly 1 redeemed, 11 exhausted, used_count = 1", async () => {
      await insertCode(c, "BETA-CARRERA", { max_uses: 1 });
      const racers = [];
      for (let i = 0; i < 12; i++) racers.push(await newUser(c));
      const conns = await Promise.all(racers.map(async () => { const x = mk("db_legacy"); await x.connect(); return x; }));
      const results = await Promise.all(conns.map(async (cn, i) => {
        await asUser(cn, racers[i]);
        return (await cn.query(`select public.redeem_beta_access_code('BETA-CARRERA') as r`)).rows[0].r.status;
      }));
      await Promise.all(conns.map((cn) => cn.end()));
      assert.equal(results.filter((s) => s === "redeemed").length, 1, results.join(","));
      assert.equal(results.filter((s) => s === "exhausted").length, 11, results.join(","));
      assert.equal(await usedCount(c, "BETA-CARRERA"), 1);
      assert.equal((await c.query(`select count(*)::int n from public.user_access_grants where user_id = any($1) and status='active'`, [racers])).rows[0].n, 1);
    });

    await t("same user firing the same legacy redeem 8x concurrently consumes one use", async () => {
      await insertCode(c, "BETA-REINTENTO", { max_uses: 5 });
      const x = await newUser(c);
      const conns = await Promise.all(Array.from({ length: 8 }, async () => { const k = mk("db_legacy"); await k.connect(); return k; }));
      const results = await Promise.all(conns.map(async (cn) => {
        await asUser(cn, x);
        return (await cn.query(`select public.redeem_beta_access_code('BETA-REINTENTO') as r`)).rows[0].r.status;
      }));
      await Promise.all(conns.map((cn) => cn.end()));
      assert.equal(results.filter((s) => s === "redeemed").length, 1, results.join(","));
      assert.equal(results.filter((s) => s === "already_redeemed").length, 7, results.join(","));
      assert.equal(await usedCount(c, "BETA-REINTENTO"), 1);
      assert.equal((await grantsOf(c, x)).length, 1);
    });

    await t("diagnostic after the bridge: reports it as applied and still prints no code", async () => {
      const rows = await runDiagnostic(c);
      assert.match(verdictOf(rows, "Legacy bridge"), /^applied/);
      assert.match(verdictOf(rows, "user_access_grants.grant_type type"), /^text/);
      assert.ok(rows.some((r) => r.section === "C_functions" && r.item.startsWith("redeem_legacy_beta_invite") && /authenticated_execute=false/.test(r.detail)));
      assert.doesNotMatch(JSON.stringify(rows), /BETA-AB23CD|PROMO-AB23CD|BETA50/);
    });

    await c.end();
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (!EmbeddedPostgres || !pg) {
  test("legacy invite redemption DB behaviour", { skip: "optional: npm i --no-save embedded-postgres pg" }, () => {});
} else {
  await main();
}
