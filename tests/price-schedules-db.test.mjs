// Promotional price schedules (Pioneros) against a REAL Postgres (embedded, throw-away, local only — never Supabase).
// Opt-in like the other *-db tests:
//
//   npm i --no-save embedded-postgres pg && node --test tests/price-schedules-db.test.mjs
//
// Applies the real checkout + discount migrations (the ones in production) and the NEW price-schedules migration.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireEmbeddedPgLock } from "./helpers/embedded-pg-lock.mjs";
import { makeDb } from "./helpers/discount-db-fixtures.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  ({ default: pg } = await import("pg"));
} catch {
  // optional dev tooling not installed
}

const MIGRATION = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261112120000_price_schedules.sql"), "utf8");
const PORT = Number(process.env.PRICE_SCHEDULES_TEST_PG_PORT) || 54346;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-price-schedules-pg-"));
let server;

const PROMO = 9900;
const POST = 19900;
const CODE = "PIONEROS-TEST";
const TERMS_V = "pioneros-v1";

const paymentsStub = `
create table public.payments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  subscription_id uuid references public.subscriptions(id), mercado_pago_payment_id text unique,
  status text, amount numeric, currency text, paid_at timestamptz, raw_data jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  const db = makeDb(pg, PORT);
  const { freshDb, newUser, insertCode, reserve, confirm, connect } = db;

  try {
    const c = await freshDb("ps_main", { discount: true, consistency: true });
    await c.query(paymentsStub);
    const t = (name, fn) => test(name, fn);
    const q = async (sql, params) => (await c.query(sql, params)).rows;
    const one = async (sql, params) => (await c.query(sql, params)).rows[0];
    const rpc = async (client, fn, ...args) =>
      (await client.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args)).rows[0].r;

    await t("preflight: without its dependencies the migration aborts and creates nothing", async () => {
      const bare = await freshDb("ps_bare", { checkout: false, legacy: false });
      await assert.rejects(bare.query(MIGRATION), /Missing dependency/);
      assert.equal((await bare.query(`select to_regclass('public.price_schedules') as r`)).rows[0].r, null);
      await bare.end();
    });

    await c.query(MIGRATION);
    await t("the migration is re-runnable", async () => {
      await c.query(MIGRATION);
    });

    const codeId = await insertCode(c, CODE, { code_type: "fixed_price", discount_value: PROMO, max_uses: 20 });
    await insertCode(c, "PLAIN-PROMO", { code_type: "fixed_price", discount_value: PROMO, max_uses: 20 });
    await c.query(
      `insert into public.discount_code_terms (invite_code_id, promo_cycles, post_price, terms_version) values ($1, 6, $2, $3)`,
      [codeId, POST, TERMS_V],
    );

    const purchase = async (uid, { accept = true, termsVersion = TERMS_V, code = CODE } = {}) => {
      const r = await reserve(c, uid, code);
      assert.equal(r.status, "reserved", JSON.stringify(r));
      let acceptance = null;
      if (accept) acceptance = await rpc(c, "record_promo_acceptance", uid, r.reservation_id, termsVersion);
      const attempt = await db.checkout(c, uid, Number(r.final_amount));
      assert.equal(await db.attach(c, uid, r.reservation_id, attempt.attemptId), "attached");
      return { r, attempt, acceptance };
    };

    const addPayment = async (uid, preapprovalId, { status, amount = PROMO, paidAt, debitDate, key }) => {
      const sub = await one(
        `insert into public.subscriptions (user_id, mercado_pago_preapproval_id, status) values ($1,$2,'authorized')
         on conflict do nothing returning id`,
        [uid, preapprovalId],
      ).catch(() => null);
      const subscriptionId = sub?.id ?? (await one(`select id from public.subscriptions where mercado_pago_preapproval_id=$1`, [preapprovalId])).id;
      await c.query(
        `insert into public.payments (user_id, subscription_id, mercado_pago_payment_id, status, amount, currency, paid_at, raw_data)
         values ($1,$2,$3,$4,$5,'ARS',$6,$7)`,
        [uid, subscriptionId, key ?? `inv_${Math.random().toString(36).slice(2)}`, status, amount, paidAt, debitDate ? { debit_date: debitDate } : {}],
      );
    };
    const sync = (preapprovalId, providerStatus = "authorized") => rpc(c, "sync_price_schedule", preapprovalId, providerStatus);

    await t("terms are looked up by code; a code without terms has none", async () => {
      assert.deepEqual(
        { ...(await rpc(c, "promo_terms_for_code", ` ${CODE.toLowerCase()} `)) },
        { has_terms: true, promo_cycles: 6, post_price: 19900, notice_days: 20, terms_version: TERMS_V },
      );
      assert.deepEqual(await rpc(c, "promo_terms_for_code", "PLAIN-PROMO"), { has_terms: false });
      assert.deepEqual(await rpc(c, "promo_terms_for_code", "NOPE"), { has_terms: false });
    });

    await t("acceptance: explicit, versioned, owned by the buyer, idempotent and immutable", async () => {
      const uid = await newUser(c);
      const r = await reserve(c, uid, CODE);
      assert.equal((await rpc(c, "record_promo_acceptance", uid, r.reservation_id, "old-version")).status, "terms_mismatch");
      assert.equal((await rpc(c, "record_promo_acceptance", uid, r.reservation_id, null)).status, "terms_mismatch");
      assert.equal((await rpc(c, "record_promo_acceptance", await newUser(c), r.reservation_id, TERMS_V)).status, "not_found");
      const ok = await rpc(c, "record_promo_acceptance", uid, r.reservation_id, TERMS_V);
      assert.equal(ok.status, "recorded");
      assert.equal((await rpc(c, "record_promo_acceptance", uid, r.reservation_id, TERMS_V)).status, "already_recorded");
      const acc = await one(`select * from public.promo_acceptances where reservation_id=$1`, [r.reservation_id]);
      assert.equal(Number(acc.list_price), 19900);
      assert.equal(Number(acc.promo_price), PROMO);
      assert.equal(Number(acc.post_price), POST);
      assert.equal(acc.promo_cycles, 6);
      assert.equal(acc.terms_version, TERMS_V);
      await assert.rejects(c.query(`update public.promo_acceptances set post_price = 29900 where id=$1`, [acc.id]), /immutable/);
      // A code without terms records nothing.
      const plain = await reserve(c, uid, "PLAIN-PROMO").catch(() => null);
      if (plain?.status === "reserved") assert.equal((await rpc(c, "record_promo_acceptance", uid, plain.reservation_id, TERMS_V)).status, "no_terms");
    });

    await t("terms cannot change once users accepted them; before that they can", async () => {
      const other = await insertCode(c, "EDITABLE-CODE", { code_type: "fixed_price", discount_value: PROMO, max_uses: 2 });
      await c.query(`insert into public.discount_code_terms (invite_code_id, promo_cycles, post_price, terms_version) values ($1,6,$2,'v1')`, [other, POST]);
      await c.query(`update public.discount_code_terms set post_price = 20900 where invite_code_id=$1`, [other]);
      const uid = await newUser(c);
      const r = await reserve(c, uid, "EDITABLE-CODE");
      assert.equal((await rpc(c, "record_promo_acceptance", uid, r.reservation_id, "v1")).status, "recorded");
      await assert.rejects(c.query(`update public.discount_code_terms set post_price = 29900 where invite_code_id=$1`, [other]), /cannot change once users accepted/);
    });

    await t("a schedule is created only for a confirmed, accepted discounted checkout; ensure is idempotent", async () => {
      const uid = await newUser(c);
      const { attempt } = await purchase(uid);
      assert.equal((await rpc(c, "ensure_price_schedule", attempt.preapprovalId)).status, "none", "not confirmed yet: nothing");
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "confirmed");
      assert.equal((await rpc(c, "ensure_price_schedule", attempt.preapprovalId)).status, "created");
      assert.equal((await rpc(c, "ensure_price_schedule", attempt.preapprovalId)).status, "exists");
      const s = await one(`select * from public.price_schedules where mercado_pago_preapproval_id=$1`, [attempt.preapprovalId]);
      assert.equal(s.status, "scheduled");
      assert.equal(s.anchor_at, null);
      assert.deepEqual([Number(s.list_price), Number(s.promo_price), Number(s.post_price), s.promo_cycles], [19900, 9900, 19900, 6]);

      // Plain checkout (no code): nothing. Confirmed but never accepted: nothing and it says so.
      const plain = await db.checkout(c, await newUser(c), 19900);
      assert.equal((await rpc(c, "ensure_price_schedule", plain.preapprovalId)).status, "none");
      const noAccept = await purchase(await newUser(c), { accept: false });
      await confirm(c, noAccept.attempt.preapprovalId);
      assert.equal((await rpc(c, "ensure_price_schedule", noAccept.attempt.preapprovalId)).status, "no_acceptance");
    });

    // A fully set up subscription with payments recorded as the billing circuit does.
    async function activeSchedule({ debit = "2026-01-15T12:00:00.000Z" } = {}) {
      const uid = await newUser(c);
      const { attempt } = await purchase(uid);
      await confirm(c, attempt.preapprovalId);
      await rpc(c, "ensure_price_schedule", attempt.preapprovalId);
      return { uid, pre: attempt.preapprovalId, debit };
    }

    await t("the calendar is fixed from the first installment's debit date and never moves", async () => {
      const { uid, pre } = await activeSchedule();
      assert.equal((await sync(pre)).anchor_at, null, "no installment yet: no anchor");

      // First charge REJECTED on 15 Jan, approved by a later retry on 20 Jan: the anchor is the debit date (15 Jan).
      await addPayment(uid, pre, { status: "rejected", paidAt: "2026-01-15T12:00:00Z", debitDate: "2026-01-15T12:00:00Z", key: "inv_1" });
      const first = await sync(pre);
      assert.equal(new Date(first.anchor_at).toISOString(), "2026-01-15T12:00:00.000Z");
      assert.equal(new Date(first.promo_ends_at).toISOString(), "2026-07-15T12:00:00.000Z");
      await c.query(`update public.payments set status='approved', paid_at='2026-01-20T12:00:00Z' where mercado_pago_payment_id='inv_1'`);

      // Period 2 paid, period 3 REJECTED and never recovered, period 4 paid late: none of it moves the end of the promotion.
      await addPayment(uid, pre, { status: "approved", paidAt: "2026-02-15T12:00:00Z", debitDate: "2026-02-15T12:00:00Z", key: "inv_2" });
      await addPayment(uid, pre, { status: "rejected", paidAt: "2026-03-15T12:00:00Z", debitDate: "2026-03-15T12:00:00Z", key: "inv_3" });
      await addPayment(uid, pre, { status: "approved", paidAt: "2026-04-18T12:00:00Z", debitDate: "2026-04-15T12:00:00Z", key: "inv_4" });
      const later = await sync(pre);
      assert.equal(new Date(later.anchor_at).toISOString(), "2026-01-15T12:00:00.000Z");
      assert.equal(new Date(later.promo_ends_at).toISOString(), "2026-07-15T12:00:00.000Z");
      assert.equal(later.approved_promo_periods, 3, "approved payments only reconcile: 3 of the 4 periods so far were paid");
    });

    await t("replaying the same sync (duplicate webhooks) changes nothing; other amounts do not reconcile as promotional", async () => {
      const { uid, pre } = await activeSchedule();
      await addPayment(uid, pre, { status: "approved", paidAt: "2026-01-15T12:00:00Z", debitDate: "2026-01-15T12:00:00Z", key: "a1" });
      await addPayment(uid, pre, { status: "approved", amount: 250, paidAt: "2026-02-15T12:00:00Z", debitDate: "2026-02-15T12:00:00Z", key: "a2" });
      await addPayment(uid, pre, { status: "pending", paidAt: "2026-03-15T12:00:00Z", debitDate: "2026-03-15T12:00:00Z", key: "a3" });
      await addPayment(uid, pre, { status: "approved", paidAt: "2026-08-15T12:00:00Z", debitDate: "2026-08-15T12:00:00Z", key: "a4" }); // after the promotion
      const results = await Promise.all(Array.from({ length: 12 }, async () => {
        const cn = await connect("ps_main");
        try {
          return await sync(pre).then(() => null) ?? null;
        } finally {
          await cn.end();
        }
      }));
      assert.equal(results.length, 12);
      const baseline = await sync(pre);
      for (let i = 0; i < 12; i += 1) assert.deepEqual(await sync(pre), baseline);
      assert.equal(baseline.approved_promo_periods, 1, "only the approved 9900 inside the promotional periods counts");
      assert.equal((await q(`select count(*)::int n from public.price_schedule_events where schedule_id=$1 and event='anchor_set'`, [baseline.schedule_id]))[0].n, 1);
    });

    await t("SQL month arithmetic equals the TypeScript calendar (month ends included)", async () => {
      const { addMonthsFromAnchor } = loadTs("src/lib/mercadopago/price-schedule.ts");
      const anchors = ["2026-01-31T10:00:00Z", "2026-08-31T23:30:00Z", "2026-02-28T00:00:00Z", "2028-02-29T12:00:00Z", "2026-05-31T12:00:00Z", "2026-11-30T12:00:00Z", "2026-12-15T12:00:00Z"];
      for (const a of anchors) {
        for (const months of [1, 3, 6, 12]) {
          const sql = (await one(`select (((($1::timestamptz) at time zone 'UTC') + make_interval(months => $2)) at time zone 'UTC') as v`, [a, months])).v;
          assert.equal(sql.toISOString(), addMonthsFromAnchor(new Date(a), months).toISOString(), `${a} + ${months}`);
        }
      }
    });

    await t("the fixed calendar and the accepted terms cannot be edited, even by the service role", async () => {
      const { uid, pre } = await activeSchedule();
      await addPayment(uid, pre, { status: "approved", paidAt: "2026-01-15T12:00:00Z", debitDate: "2026-01-15T12:00:00Z", key: "f1" });
      await sync(pre);
      await assert.rejects(c.query(`update public.price_schedules set promo_ends_at = promo_ends_at + interval '1 month' where mercado_pago_preapproval_id=$1`, [pre]), /fixed once set/);
      await assert.rejects(c.query(`update public.price_schedules set anchor_at = anchor_at + interval '1 day' where mercado_pago_preapproval_id=$1`, [pre]), /fixed once set/);
      await assert.rejects(c.query(`update public.price_schedules set post_price = 29900 where mercado_pago_preapproval_id=$1`, [pre]), /immutable/);
      await assert.rejects(c.query(`update public.price_schedules set promo_cycles = 12 where mercado_pago_preapproval_id=$1`, [pre]), /immutable/);
      const ev = await one(`select id from public.price_schedule_events limit 1`);
      await assert.rejects(c.query(`update public.price_schedule_events set event='x' where id=$1`, [ev.id]), /append-only/);
    });

    await t("a cancellation in Mercado Pago closes the schedule; terminal states never come back", async () => {
      const { uid, pre } = await activeSchedule();
      await addPayment(uid, pre, { status: "approved", paidAt: "2026-01-15T12:00:00Z", debitDate: "2026-01-15T12:00:00Z", key: "c1" });
      assert.equal((await sync(pre, "cancelled")).status, "void");
      assert.equal((await sync(pre, "authorized")).status, "void");
      await assert.rejects(c.query(`update public.price_schedules set status='scheduled' where mercado_pago_preapproval_id=$1`, [pre]), /terminal/);
      const s = await one(`select id from public.price_schedules where mercado_pago_preapproval_id=$1`, [pre]);
      assert.equal((await rpc(c, "finish_price_schedule", s.id, "applied")).unchanged, true);
    });

    await t("the lease is atomic: with 10 simultaneous runners exactly one claims the schedule", async () => {
      const { uid, pre } = await activeSchedule();
      await addPayment(uid, pre, { status: "approved", paidAt: "2026-01-15T12:00:00Z", debitDate: "2026-01-15T12:00:00Z", key: "l1" });
      await sync(pre);
      const s = await one(`select id from public.price_schedules where mercado_pago_preapproval_id=$1`, [pre]);
      const conns = await Promise.all(Array.from({ length: 10 }, () => connect("ps_main")));
      const claims = await Promise.all(conns.map((cn) => cn.query(`select * from public.claim_price_schedule($1, 120)`, [s.id])));
      await Promise.all(conns.map((cn) => cn.end()));
      assert.equal(claims.filter((x) => x.rows.length === 1).length, 1);
      assert.equal((await c.query(`select * from public.claim_price_schedule($1, 120)`, [s.id])).rows.length, 0, "still leased");
      await c.query(`update public.price_schedules set lease_until = now() - interval '1 second' where id=$1`, [s.id]);
      assert.equal((await c.query(`select * from public.claim_price_schedule($1, 120)`, [s.id])).rows.length, 1, "an expired lease can be taken again");
    });

    await t("finish: errors count attempts and set the retry time; applied records the date; invalid status is refused", async () => {
      const { uid, pre } = await activeSchedule();
      await addPayment(uid, pre, { status: "approved", paidAt: "2026-01-15T12:00:00Z", debitDate: "2026-01-15T12:00:00Z", key: "fn1" });
      await sync(pre);
      const s = await one(`select id from public.price_schedules where mercado_pago_preapproval_id=$1`, [pre]);
      await c.query(`select * from public.claim_price_schedule($1, 120)`, [s.id]);
      const failed = await rpc(c, "finish_price_schedule", s.id, "scheduled", "provider_http_500", { seen: 1 }, 3600);
      assert.equal(failed.attempts, 1);
      const row = await one(`select * from public.price_schedules where id=$1`, [s.id]);
      assert.equal(row.lease_until, null);
      assert.ok(row.next_attempt_at > new Date(Date.now() + 3000 * 1000));
      assert.equal(row.last_error, "provider_http_500");
      await assert.rejects(rpc(c, "finish_price_schedule", s.id, "bogus"), /invalid price schedule status/);
      assert.equal((await rpc(c, "finish_price_schedule", s.id, "applied", null, { amount: 19900 })).status, "applied");
      assert.ok((await one(`select applied_at from public.price_schedules where id=$1`, [s.id])).applied_at);
    });

    await t("work list: only active, anchored schedules whose window started, without lease or pending retry", async () => {
      const { uid, pre } = await activeSchedule();
      const s0 = await one(`select id from public.price_schedules where mercado_pago_preapproval_id=$1`, [pre]);
      const inList = async () => (await q(`select id from public.list_price_schedule_work(200)`)).some((r) => r.id === s0.id);
      assert.equal(await inList(), false, "no anchor yet");
      // Promotion that started 6 months ago (window long open) vs. one that started yesterday (window far away).
      await addPayment(uid, pre, { status: "approved", paidAt: new Date(Date.now() - 170 * 86400000).toISOString(), debitDate: new Date(Date.now() - 170 * 86400000).toISOString(), key: "w1" });
      await sync(pre);
      assert.equal(await inList(), true, "~10 days before the end: inside the window");
      await c.query(`select * from public.claim_price_schedule($1, 120)`, [s0.id]);
      assert.equal(await inList(), false, "leased");
      await c.query(`update public.price_schedules set lease_until=null, next_attempt_at = now() + interval '1 hour' where id=$1`, [s0.id]);
      assert.equal(await inList(), false, "backoff");
      await c.query(`update public.price_schedules set next_attempt_at=null where id=$1`, [s0.id]);
      assert.equal(await inList(), true);

      const fresh = await activeSchedule();
      await addPayment(fresh.uid, fresh.pre, { status: "approved", paidAt: new Date().toISOString(), debitDate: new Date().toISOString(), key: "w2" });
      await sync(fresh.pre);
      const s1 = await one(`select id from public.price_schedules where mercado_pago_preapproval_id=$1`, [fresh.pre]);
      assert.equal((await q(`select id from public.list_price_schedule_work(200)`)).some((r) => r.id === s1.id), false, "a promotion that just started is not work yet");
    });

    await t("notice mark records the e-mail once per call and refuses terminal schedules", async () => {
      const { uid, pre } = await activeSchedule();
      await addPayment(uid, pre, { status: "approved", paidAt: "2026-01-15T12:00:00Z", debitDate: "2026-01-15T12:00:00Z", key: "n1" });
      await sync(pre);
      const s = await one(`select id from public.price_schedules where mercado_pago_preapproval_id=$1`, [pre]);
      assert.equal((await rpc(c, "mark_price_notice_sent", s.id)).status, "marked");
      assert.equal((await one(`select notice_email_count n from public.price_schedules where id=$1`, [s.id])).n, 1);
      await sync(pre, "cancelled");
      assert.equal((await rpc(c, "mark_price_notice_sent", s.id)).status, "not_found");
      await assert.rejects(rpc(c, "add_price_schedule_event", s.id, "Bad Event"), /snake_case/);
    });

    await t("roles: a user reads only their own schedule and only the safe columns; nobody writes directly; functions are service_role only", async () => {
      const a = await activeSchedule();
      const b = await activeSchedule();
      const as = async (uid, role, sql) => {
        await c.query(`begin`);
        try {
          await c.query(`set local role ${role}`);
          await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
          return (await c.query(sql)).rows;
        } finally {
          await c.query(`rollback`);
        }
      };
      const own = await as(a.uid, "authenticated", `select user_id from public.price_schedules`);
      assert.deepEqual(own.map((r) => r.user_id), [a.uid]);
      await assert.rejects(as(a.uid, "authenticated", `select last_error from public.price_schedules`), /permission denied/);
      await assert.rejects(as(a.uid, "authenticated", `update public.price_schedules set status='applied'`), /permission denied/);
      await assert.rejects(as(a.uid, "authenticated", `select * from public.promo_acceptances`), /permission denied/);
      await assert.rejects(as(null, "anon", `select id from public.price_schedules`), /permission denied/);
      await assert.rejects(as(null, "service_role", `update public.price_schedules set status='applied'`), /permission denied/);
      await assert.rejects(as(null, "service_role", `insert into public.price_schedule_events (schedule_id, event) values (gen_random_uuid(),'x')`), /permission denied/);
      await assert.rejects(as(a.uid, "authenticated", `select public.ensure_price_schedule('x')`), /permission denied/);
      assert.ok((await as(null, "service_role", `select public.promo_terms_for_code('nope') as r`))[0].r);
      assert.ok(b.uid);
    });

    await t("the migration is additive: no DDL or DML on existing tables", async () => {
      const code = MIGRATION.replace(/--.*$/gm, "");
      for (const table of ["invite_codes", "invite_code_redemptions", "discount_code_reservations", "checkout_attempts", "subscriptions", "payments", "profiles", "membership_settings", "founder_members"]) {
        assert.doesNotMatch(code, new RegExp(`(alter table|insert into|update|delete from|drop table|truncate)\\s+(public\\.)?${table}\\b`, "i"), table);
      }
      assert.doesNotMatch(code, /create or replace function public\.(confirm_discount_reservation|reserve_discount_code|attach_discount_reservation)/);
      // Only its own triggers and its own policy are re-created; no table or function is ever dropped.
      assert.doesNotMatch(code, /\bdrop\s+(table|function)\b/i);
      assert.deepEqual(
        [...code.matchAll(/drop policy if exists (\w+) on (public\.\w+)/gi)].map((m) => m[2]),
        ["public.price_schedules"],
      );
    });

    await c.end();
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (!EmbeddedPostgres || !pg) {
  test("price schedules DB scenario", { skip: "optional: npm i --no-save embedded-postgres pg" }, () => {});
} else {
  await main();
}
