// DB-level behaviour of supabase/migrations/20261029120000_discount_code_checkout.sql against a REAL Postgres
// (embedded, throw-away, local only — never touches Supabase). Opt-in, like the other *-db tests:
//
//   npm i --no-save embedded-postgres pg && node --test tests/discount-codes-db.test.mjs
//
// The real checkout_attempts migration is applied; Supabase pieces (auth, roles, subscriptions) and the legacy
// invite_codes tables (not versioned in the repo) are stubbed. Every code below is a fixture: no real code is used.
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
const checkoutMigration = read("supabase/migrations/202608250001_checkout_attempts.sql");
const discountMigration = read("supabase/migrations/20261029120000_discount_code_checkout.sql");
const diagnostic = read("supabase/diagnostics/20261029_discount_codes_state.sql");
const PORT = Number(process.env.DISCOUNT_TEST_PG_PORT) || 54333;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-discount-pg-"));
let server;

const mk = (database = "postgres") => new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database });

const stub = `
do $r$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator login password 'pw' noinherit; grant anon, authenticated, service_role to authenticator; end if; end $r$;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  mercado_pago_preapproval_id text, status text, payer_email text, amount numeric, currency text, raw_data jsonb,
  next_payment_at timestamptz, started_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
`;

const legacyTables = `
create table public.invite_codes (
  id uuid primary key default gen_random_uuid(), code text not null unique, code_type text not null, title text,
  status text not null default 'active', max_uses integer, used_count integer not null default 0,
  starts_at timestamptz, expires_at timestamptz, access_expires_at timestamptz, discount_type text,
  discount_value numeric, discount_duration text default 'forever', applies_to text, notes text, created_by uuid,
  created_at timestamptz default now());
create table public.invite_code_redemptions (
  id uuid primary key default gen_random_uuid(), invite_code_id uuid not null references public.invite_codes(id),
  user_id uuid not null references auth.users(id), redeemed_at timestamptz default now());
alter table public.invite_codes enable row level security;
alter table public.invite_code_redemptions enable row level security;
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

async function freshDb(name, { checkout = true, legacy = true } = {}) {
  const admin = mk();
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
  await admin.end();
  const c = mk(name);
  await c.connect();
  await c.query(stub);
  if (checkout) await c.query(checkoutMigration);
  if (legacy) await c.query(legacyTables);
  return c;
}

const newUser = async (c) => (await c.query(`insert into auth.users (email) values ($1) returning id`, [`u${Math.random()}@x.com`])).rows[0].id;
const insertCode = async (c, code, fields = {}) => {
  const f = { code_type: "discount_percent", discount_value: 20, discount_duration: "forever", status: "active", ...fields };
  const keys = ["code", ...Object.keys(f)];
  return (await c.query(
    `insert into public.invite_codes (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    [code, ...Object.values(f)],
  )).rows[0].id;
};
const BASE = 19900;
const reserve = async (c, uid, code, { base = BASE, dryRun = false, ttl = 30, currency = "ARS" } = {}) =>
  (await c.query(`select public.reserve_discount_code($1,$2,$3,$4,$5,$6) as r`, [uid, code, base, currency, dryRun, ttl])).rows[0].r;
const usedCount = async (c, code) => (await c.query(`select used_count from public.invite_codes where code=$1`, [code])).rows[0].used_count;
const reservationRows = async (c, uid) => (await c.query(`select * from public.discount_code_reservations where user_id=$1 order by created_at`, [uid])).rows;

let seq = 0;
/** Creates a COMPLETED checkout attempt (as the checkout flow does) at the given amount. */
async function checkout(c, uid, amount, { subscriptionStatus = "pending" } = {}) {
  seq += 1;
  const key = `30000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const begin = (await c.query(`select public.begin_membership_checkout($1,$2,$3,'ARS','p@x.com','Membresía','https://x.test/back') as r`, [uid, key, amount])).rows[0].r;
  assert.equal(begin.action, "call_provider", JSON.stringify(begin));
  const preapproval = `pre_${seq}_${Math.random().toString(36).slice(2, 8)}`;
  await c.query(`select public.complete_membership_checkout($1,$2,$3,'https://mp.test/init','pending','{}'::jsonb)`, [begin.attempt_id, begin.claim_token, preapproval]);
  if (subscriptionStatus !== "pending") await c.query(`update public.subscriptions set status=$2 where mercado_pago_preapproval_id=$1`, [preapproval, subscriptionStatus]);
  return { attemptId: begin.attempt_id, preapprovalId: preapproval };
}

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  try {
    // ---------- Migration preconditions ----------
    await test("migration aborts without the legacy invite tables", async () => {
      const c = await freshDb("dc_nolegacy", { legacy: false });
      await assert.rejects(c.query(discountMigration), /Missing dependency/);
      assert.equal((await c.query(`select to_regclass('public.discount_code_reservations') as t`)).rows[0].t, null);
      await c.end();
    });
    await test("migration aborts without checkout attempts", async () => {
      const c = await freshDb("dc_nocheckout", { checkout: false });
      await assert.rejects(c.query(discountMigration), /Missing dependency/);
      await c.end();
    });
    await test("migration aborts when a needed column is missing", async () => {
      const c = await freshDb("dc_badshape");
      await c.query(`alter table public.invite_codes drop column discount_duration`);
      await assert.rejects(c.query(discountMigration), /Missing expected columns: invite_codes\.discount_duration/);
      await c.end();
    });

    // ---------- Diagnostic ----------
    const runDiagnostic = async (client) => {
      await client.query("begin read only");
      try {
        return (await client.query(diagnostic)).rows;
      } finally {
        await client.query("rollback");
      }
    };
    await test("diagnostic: read-only, works before the migration and never prints a code", async () => {
      const c = await freshDb("dc_diag");
      await insertCode(c, "PROMO-SECRETO9");
      const before = await runDiagnostic(c);
      assert.match(before.find((r) => r.section === "0_VERDICT" && r.item.startsWith("Discount checkout migration")).detail, /^NOT APPLIED/);
      await c.query(discountMigration);
      const after = await runDiagnostic(c);
      assert.match(after.find((r) => r.section === "0_VERDICT" && r.item.startsWith("Discount checkout migration")).detail, /^applied/);
      assert.ok(after.some((r) => r.section === "D_counts" && /discount_percent \/ status=active \/ duration=forever: codes=1/.test(r.detail)));
      assert.doesNotMatch(JSON.stringify([...before, ...after]), /SECRETO/);
      await c.end();
    });

    // ---------- Behaviour ----------
    const c = await freshDb("dc_main");
    await c.query(discountMigration);
    await c.query(discountMigration); // idempotent
    const t = (name, fn) => test(name, fn);

    await t("pricing rule: percent, fixed amount, fixed price, rounding and invalid benefits", async () => {
      const f = async (type, value, base) =>
        (await c.query(`select public.discount_code_final_amount($1,$2::numeric,$3::numeric) as v`, [type, value, base])).rows[0].v;
      assert.equal(await f("discount_percent", 20, 19900), "15920.00");
      assert.equal(await f("discount_percent", 33.33, 19900), "13267.33");
      assert.equal(await f("discount_percent", 0.01, 19900), "19898.01");
      assert.equal(await f("discount_fixed_amount", 5000, 19900), "14900.00");
      assert.equal(await f("fixed_price", 9900, 19900), "9900.00");
      // No benefit / invalid → NULL
      assert.equal(await f("discount_percent", 100, 19900), null);
      assert.equal(await f("discount_percent", 0, 19900), null);
      assert.equal(await f("discount_percent", -5, 19900), null);
      assert.equal(await f("discount_fixed_amount", 19900, 19900), null);
      assert.equal(await f("discount_fixed_amount", 25000, 19900), null);
      assert.equal(await f("fixed_price", 19900, 19900), null);
      assert.equal(await f("fixed_price", 30000, 19900), null);
      assert.equal(await f("fixed_price", 0, 19900), null);
      assert.equal(await f("beta_tester", 20, 19900), null);
    });

    await t("valid percent code: reserves, locks the discounted amount, consumes nothing yet", async () => {
      await insertCode(c, "PROMO-PCT20");
      const u = await newUser(c);
      const r = await reserve(c, u, "promo-pct20"); // case/whitespace normalized
      assert.equal(r.status, "reserved");
      assert.equal(Number(r.final_amount), 15920);
      assert.equal(Number(r.base_amount), 19900);
      assert.equal(Number(r.discount_amount), 3980);
      assert.equal(r.reused, false);
      assert.equal(await usedCount(c, "PROMO-PCT20"), 0);
      const rows = await reservationRows(c, u);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "reserved");
    });

    await t("fixed amount and fixed price codes", async () => {
      await insertCode(c, "PROMO-MENOS5K", { code_type: "discount_fixed_amount", discount_value: 5000 });
      await insertCode(c, "PRECIO-9900", { code_type: "fixed_price", discount_value: 9900 });
      const [a, b] = [await newUser(c), await newUser(c)];
      assert.equal(Number((await reserve(c, a, "PROMO-MENOS5K")).final_amount), 14900);
      assert.equal(Number((await reserve(c, b, "PRECIO-9900")).final_amount), 9900);
    });

    await t("dry run previews the price and writes nothing", async () => {
      const u = await newUser(c);
      const r = await reserve(c, u, "PROMO-PCT20", { dryRun: true });
      assert.equal(r.status, "ok");
      assert.equal(Number(r.final_amount), 15920);
      assert.equal(r.reservation_id, undefined);
      assert.equal((await reservationRows(c, u)).length, 0);
    });

    await t("a price change is honoured: the preview follows the base price and the reservation is rebuilt", async () => {
      const u = await newUser(c);
      const first = await reserve(c, u, "PROMO-PCT20", { base: 10000 });
      assert.equal(Number(first.final_amount), 8000);
      const second = await reserve(c, u, "PROMO-PCT20", { base: 12000 });
      assert.equal(Number(second.final_amount), 9600);
      assert.notEqual(second.reservation_id, first.reservation_id);
      const rows = await reservationRows(c, u);
      assert.deepEqual(rows.map((x) => x.status), ["released", "reserved"]);
    });

    await t("repeating the same request is idempotent (same reservation, one live row)", async () => {
      const u = await newUser(c);
      const first = await reserve(c, u, "PROMO-PCT20");
      const second = await reserve(c, u, "PROMO-PCT20");
      assert.equal(second.reservation_id, first.reservation_id);
      assert.equal(second.reused, true);
      assert.equal((await reservationRows(c, u)).length, 1);
    });

    await t("switching to another code releases the previous reservation", async () => {
      const u = await newUser(c);
      const first = await reserve(c, u, "PROMO-PCT20");
      const second = await reserve(c, u, "PRECIO-9900");
      assert.equal(second.status, "reserved");
      const rows = await reservationRows(c, u);
      assert.equal(rows.find((x) => x.id === first.reservation_id).status, "released");
      assert.equal(rows.filter((x) => x.status === "reserved").length, 1);
    });

    await t("invalid code, beta/free-access codes and junk are all just 'invalid'; nothing is reserved", async () => {
      await insertCode(c, "BETA-AB23CD", { code_type: "beta_tester", discount_value: null });
      await insertCode(c, "GRATIS-1", { code_type: "manual_free_access", discount_value: null });
      const u = await newUser(c);
      for (const code of ["NOPE-NOPE", "BETA-AB23CD", "GRATIS-1", "", "   ", "x".repeat(65)]) {
        assert.equal((await reserve(c, u, code)).status, "invalid", code);
      }
      assert.equal((await reservationRows(c, u)).length, 0);
      assert.equal(await usedCount(c, "BETA-AB23CD"), 0);
    });

    await t("rate limit: 8 invalid guesses lock only that user", async () => {
      const u = await newUser(c);
      const other = await newUser(c);
      for (let i = 0; i < 8; i++) assert.equal((await reserve(c, u, `WRONG-${i}`)).status, "invalid");
      assert.equal((await reserve(c, u, "PROMO-PCT20")).status, "rate_limited");
      assert.equal((await reserve(c, other, "PROMO-PCT20")).status, "reserved");
    });

    await t("expired, inactive and not-yet-started codes", async () => {
      await insertCode(c, "PROMO-VENCIDO", { expires_at: new Date(Date.now() - 864e5).toISOString() });
      await insertCode(c, "PROMO-INACTIVO", { status: "inactive" });
      await insertCode(c, "PROMO-FUTURO", { starts_at: new Date(Date.now() + 864e5).toISOString() });
      const u = await newUser(c);
      assert.equal((await reserve(c, u, "PROMO-VENCIDO")).status, "expired");
      assert.equal((await reserve(c, u, "PROMO-INACTIVO")).status, "invalid");
      assert.equal((await reserve(c, u, "PROMO-FUTURO")).status, "invalid");
      assert.equal((await reservationRows(c, u)).length, 0);
    });

    await t("first-month-only codes are unsupported, not silently applied for ever", async () => {
      await insertCode(c, "PROMO-UNAVEZ", { discount_duration: "once" });
      const u = await newUser(c);
      assert.equal((await reserve(c, u, "PROMO-UNAVEZ")).status, "unsupported");
      assert.equal((await reserve(c, u, "PROMO-UNAVEZ", { dryRun: true })).status, "unsupported");
      assert.equal((await reservationRows(c, u)).length, 0);
    });

    await t("codes that give no benefit at the current price are refused", async () => {
      await insertCode(c, "PROMO-TOTAL", { discount_value: 100 });
      await insertCode(c, "PROMO-GIGANTE", { code_type: "discount_fixed_amount", discount_value: 99999 });
      await insertCode(c, "PRECIO-CARO", { code_type: "fixed_price", discount_value: 99999 });
      const u = await newUser(c);
      for (const code of ["PROMO-TOTAL", "PROMO-GIGANTE", "PRECIO-CARO"]) assert.equal((await reserve(c, u, code)).status, "no_benefit", code);
      assert.equal((await reservationRows(c, u)).length, 0);
    });

    await t("limit reached: live reservations count against max_uses; expiry frees the seat", async () => {
      await insertCode(c, "PROMO-LIMITE-1", { max_uses: 1 });
      const [a, b] = [await newUser(c), await newUser(c)];
      assert.equal((await reserve(c, a, "PROMO-LIMITE-1")).status, "reserved");
      assert.equal((await reserve(c, b, "PROMO-LIMITE-1")).status, "exhausted");
      assert.equal((await reserve(c, b, "PROMO-LIMITE-1", { dryRun: true })).status, "exhausted");
      // The first buyer abandons: the reservation lapses and the seat is available again.
      await c.query(`update public.discount_code_reservations set expires_at = now() - interval '1 minute' where user_id=$1`, [a]);
      assert.equal((await reserve(c, b, "PROMO-LIMITE-1")).status, "reserved");
      assert.equal((await reservationRows(c, a))[0].status, "expired");
    });

    await t("a stale used_count cannot hide real redemptions", async () => {
      const id = await insertCode(c, "PROMO-LEDGER", { max_uses: 1, used_count: 0 });
      const holder = await newUser(c);
      await c.query(`insert into public.invite_code_redemptions (invite_code_id, user_id) values ($1,$2)`, [id, holder]);
      assert.equal((await reserve(c, await newUser(c), "PROMO-LEDGER")).status, "exhausted");
    });

    await t("12 concurrent buyers of a 1-use code: exactly one reservation", async () => {
      await insertCode(c, "PROMO-CARRERA", { max_uses: 1 });
      const buyers = [];
      for (let i = 0; i < 12; i++) buyers.push(await newUser(c));
      const conns = await Promise.all(buyers.map(async () => { const x = mk("dc_main"); await x.connect(); return x; }));
      const results = await Promise.all(conns.map(async (cn, i) => (await reserve(cn, buyers[i], "PROMO-CARRERA")).status));
      await Promise.all(conns.map((cn) => cn.end()));
      assert.equal(results.filter((s) => s === "reserved").length, 1, results.join(","));
      assert.equal(results.filter((s) => s === "exhausted").length, 11, results.join(","));
      assert.equal((await c.query(`select count(*)::int n from public.discount_code_reservations r join public.invite_codes k on k.id=r.invite_code_id where k.code='PROMO-CARRERA' and r.status='reserved'`)).rows[0].n, 1);
    });

    await t("the same user firing the same request 8x concurrently ends with one reservation", async () => {
      await insertCode(c, "PROMO-REINTENTO", { max_uses: 5 });
      const u = await newUser(c);
      const conns = await Promise.all(Array.from({ length: 8 }, async () => { const x = mk("dc_main"); await x.connect(); return x; }));
      const results = await Promise.all(conns.map(async (cn) => (await reserve(cn, u, "PROMO-REINTENTO")).reservation_id));
      await Promise.all(conns.map((cn) => cn.end()));
      assert.equal(new Set(results).size, 1);
      assert.equal((await reservationRows(c, u)).length, 1);
    });

    await t("full checkout: reserve → checkout at the discounted amount → attach → authorized → confirmed", async () => {
      await insertCode(c, "PROMO-FLUJO", { max_uses: 1 });
      const [buyer, other] = [await newUser(c), await newUser(c)];
      const r = await reserve(c, buyer, "PROMO-FLUJO");
      const attempt = await checkout(c, buyer, Number(r.final_amount));
      assert.equal((await c.query(`select public.attach_discount_reservation($1,$2,$3) as r`, [buyer, r.reservation_id, attempt.attemptId])).rows[0].r.status, "attached");
      // Subscription amount in the table is the discounted one (what Mercado Pago will charge each month).
      assert.equal(Number((await c.query(`select amount from public.subscriptions where mercado_pago_preapproval_id=$1`, [attempt.preapprovalId])).rows[0].amount), 15920);
      assert.equal(await usedCount(c, "PROMO-FLUJO"), 0);

      const confirmed = (await c.query(`select public.confirm_discount_reservation($1) as r`, [attempt.preapprovalId])).rows[0].r;
      assert.equal(confirmed.status, "confirmed");
      assert.equal(await usedCount(c, "PROMO-FLUJO"), 1);
      assert.equal((await c.query(`select count(*)::int n from public.invite_code_redemptions r join public.invite_codes k on k.id=r.invite_code_id where k.code='PROMO-FLUJO'`)).rows[0].n, 1);
      // Idempotent: webhook + sync-subscription can both report the authorization.
      assert.equal((await c.query(`select public.confirm_discount_reservation($1) as r`, [attempt.preapprovalId])).rows[0].r.status, "already_confirmed");
      assert.equal(await usedCount(c, "PROMO-FLUJO"), 1);
      // No duplicated or reused use.
      assert.equal((await reserve(c, buyer, "PROMO-FLUJO")).status, "already_used");
      assert.equal((await reserve(c, other, "PROMO-FLUJO")).status, "exhausted");
    });

    await t("attach is verified by the database: wrong amount, other user's attempt or reservation are refused", async () => {
      await insertCode(c, "PROMO-ATTACH", { max_uses: 10 });
      const [u, v] = [await newUser(c), await newUser(c)];
      const r = await reserve(c, u, "PROMO-ATTACH");
      const full = await checkout(c, u, BASE); // a checkout created WITHOUT the discount
      const att = async (user, res, attempt) => (await c.query(`select public.attach_discount_reservation($1,$2,$3) as r`, [user, res, attempt])).rows[0].r.status;
      assert.equal(await att(u, r.reservation_id, full.attemptId), "amount_mismatch");
      assert.equal(await att(v, r.reservation_id, full.attemptId), "not_found");
      assert.equal((await reservationRows(c, u))[0].checkout_attempt_id, null);
      // Nothing can be confirmed through an unattached reservation.
      assert.equal((await c.query(`select public.confirm_discount_reservation($1) as r`, [full.preapprovalId])).rows[0].r.status, "none");
      assert.equal(await usedCount(c, "PROMO-ATTACH"), 0);
    });

    await t("an authorization that arrives after the reservation lapsed is still honoured (the price is already contracted)", async () => {
      await insertCode(c, "PROMO-TARDE", { max_uses: 2 });
      const u = await newUser(c);
      const r = await reserve(c, u, "PROMO-TARDE");
      const attempt = await checkout(c, u, Number(r.final_amount));
      await c.query(`select public.attach_discount_reservation($1,$2,$3)`, [u, r.reservation_id, attempt.attemptId]);
      await c.query(`update public.discount_code_reservations set status='expired' where id=$1`, [r.reservation_id]);
      assert.equal((await c.query(`select public.confirm_discount_reservation($1) as r`, [attempt.preapprovalId])).rows[0].r.status, "confirmed");
      assert.equal(await usedCount(c, "PROMO-TARDE"), 1);
    });

    await t("cancelled before authorization frees the seat; a confirmed use is never released", async () => {
      await insertCode(c, "PROMO-CANCELA", { max_uses: 1 });
      const [u, v] = [await newUser(c), await newUser(c)];
      const r = await reserve(c, u, "PROMO-CANCELA");
      const attempt = await checkout(c, u, Number(r.final_amount));
      await c.query(`select public.attach_discount_reservation($1,$2,$3)`, [u, r.reservation_id, attempt.attemptId]);
      assert.equal((await reserve(c, v, "PROMO-CANCELA")).status, "exhausted");
      assert.equal((await c.query(`select public.release_discount_reservation_for_preapproval($1) as r`, [attempt.preapprovalId])).rows[0].r.released, 1);
      assert.equal((await reserve(c, v, "PROMO-CANCELA")).status, "reserved");

      await insertCode(c, "PROMO-CONFIRMADO", { max_uses: 5 });
      const w = await newUser(c);
      const r2 = await reserve(c, w, "PROMO-CONFIRMADO");
      const a2 = await checkout(c, w, Number(r2.final_amount));
      await c.query(`select public.attach_discount_reservation($1,$2,$3)`, [w, r2.reservation_id, a2.attemptId]);
      await c.query(`select public.confirm_discount_reservation($1)`, [a2.preapprovalId]);
      assert.equal((await c.query(`select public.release_discount_reservation_for_preapproval($1) as r`, [a2.preapprovalId])).rows[0].r.released, 0);
      assert.equal((await c.query(`select public.release_discount_reservation($1,$2) as r`, [w, r2.reservation_id])).rows[0].r.released, 0);
      assert.equal(await usedCount(c, "PROMO-CONFIRMADO"), 1);
    });

    await t("replacing a still-pending checkout: only a never-authorized one can be closed, and then a new attempt is accepted", async () => {
      await insertCode(c, "PROMO-REEMPLAZO", { max_uses: 5 });
      const u = await newUser(c);
      const old = await checkout(c, u, BASE);
      const open = (await c.query(`select public.describe_open_checkout($1) as r`, [u])).rows[0].r;
      assert.equal(open.status, "open");
      assert.equal(open.attempt_id, old.attemptId);
      assert.equal(open.subscription_status, "pending");
      assert.equal(open.preapproval_id, old.preapprovalId);

      // Without closing it, a new checkout just returns the old (undiscounted) attempt.
      const key = "40000000-0000-4000-8000-000000000001";
      assert.equal((await c.query(`select public.begin_membership_checkout($1,$2,15920,'ARS','p@x.com','M','https://x.test') as r`, [u, key])).rows[0].r.action, "return_ready");

      assert.equal((await c.query(`select public.close_pending_checkout($1,$2) as r`, [u, old.attemptId])).rows[0].r.status, "closed");
      assert.equal((await c.query(`select state, last_error_code from public.checkout_attempts where id=$1`, [old.attemptId])).rows[0].last_error_code, "superseded_by_discount");
      assert.equal((await c.query(`select status from public.subscriptions where mercado_pago_preapproval_id=$1`, [old.preapprovalId])).rows[0].status, "cancelled");

      const r = await reserve(c, u, "PROMO-REEMPLAZO");
      const fresh = await checkout(c, u, Number(r.final_amount));
      assert.equal((await c.query(`select public.attach_discount_reservation($1,$2,$3) as r`, [u, r.reservation_id, fresh.attemptId])).rows[0].r.status, "attached");
    });

    await t("an authorized (paid) subscription is never closed or replaced", async () => {
      const u = await newUser(c);
      const att = await checkout(c, u, BASE, { subscriptionStatus: "authorized" });
      const r = (await c.query(`select public.close_pending_checkout($1,$2) as r`, [u, att.attemptId])).rows[0].r;
      assert.equal(r.status, "not_closable");
      assert.equal((await c.query(`select state from public.checkout_attempts where id=$1`, [att.attemptId])).rows[0].state, "completed");
      assert.equal((await c.query(`select status from public.subscriptions where mercado_pago_preapproval_id=$1`, [att.preapprovalId])).rows[0].status, "authorized");
      // Another user's attempt is not closable through someone else's id either.
      assert.equal((await c.query(`select public.close_pending_checkout($1,$2) as r`, [await newUser(c), att.attemptId])).rows[0].r.status, "not_closable");
    });

    await t("closing a superseded attempt releases its discount reservation", async () => {
      await insertCode(c, "PROMO-LIBERA", { max_uses: 1 });
      const [u, v] = [await newUser(c), await newUser(c)];
      const r = await reserve(c, u, "PROMO-LIBERA");
      const att = await checkout(c, u, Number(r.final_amount));
      await c.query(`select public.attach_discount_reservation($1,$2,$3)`, [u, r.reservation_id, att.attemptId]);
      await c.query(`select public.close_pending_checkout($1,$2)`, [u, att.attemptId]);
      assert.equal((await reservationRows(c, u))[0].status, "released");
      assert.equal((await reserve(c, v, "PROMO-LIBERA")).status, "reserved");
    });

    await t("security: API roles cannot execute any discount function nor read the tables", async () => {
      const fns = [
        "public.discount_code_final_amount(text,numeric,numeric)",
        "public.reserve_discount_code(uuid,text,numeric,text,boolean,integer)",
        "public.attach_discount_reservation(uuid,uuid,uuid)",
        "public.confirm_discount_reservation(text)",
        "public.release_discount_reservation(uuid,uuid)",
        "public.release_discount_reservation_for_preapproval(text)",
        "public.describe_open_checkout(uuid)",
        "public.close_pending_checkout(uuid,uuid)",
      ];
      for (const fn of fns) {
        for (const role of ["anon", "authenticated"]) {
          assert.equal((await c.query(`select has_function_privilege($1,$2,'execute') as v`, [role, fn])).rows[0].v, false, `${role} ${fn}`);
        }
        assert.equal((await c.query(`select has_function_privilege('service_role',$1,'execute') as v`, [fn])).rows[0].v, true, fn);
      }
      const u = await newUser(c);
      await asRole(c, "authenticated", u);
      await assert.rejects(c.query(`select public.reserve_discount_code($1,'PROMO-PCT20',19900,'ARS')`, [u]), /permission denied/);
      await assert.rejects(c.query(`select * from public.discount_code_reservations`), /permission denied/);
      await assert.rejects(c.query(`select * from public.discount_code_failed_attempts`), /permission denied/);
      await asSuper(c);
      await asRole(c, "service_role");
      assert.equal((await reserve(c, u, "PROMO-PCT20", { dryRun: true })).status, "ok");
      await asSuper(c);
    });

    await t("existing codes, redemptions and subscriptions are untouched by reserving and confirming", async () => {
      const beforeCodes = (await c.query(`select count(*)::int n from public.invite_codes`)).rows[0].n;
      const u = await newUser(c);
      await reserve(c, u, "PROMO-PCT20");
      assert.equal((await c.query(`select count(*)::int n from public.invite_codes`)).rows[0].n, beforeCodes);
      assert.equal((await c.query(`select count(*)::int n from public.subscriptions where user_id=$1`, [u])).rows[0].n, 0);
    });

    await c.end();
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (!EmbeddedPostgres || !pg) {
  test("discount code DB behaviour", { skip: "optional: npm i --no-save embedded-postgres pg" }, () => {});
} else {
  await main();
}
