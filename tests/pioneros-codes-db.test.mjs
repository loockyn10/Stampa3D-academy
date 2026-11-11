// Launch scenario of the simplified "Edición Pioneros" promotion on the EXISTING discount-code system, against a REAL
// Postgres (embedded, throw-away, local only — never touches Supabase). Opt-in, like the other *-db tests:
//
//   npm i --no-save embedded-postgres pg && node --test tests/pioneros-codes-db.test.mjs
//
// Both discount migrations (20261029120000 + 20261030120000, the ones already applied in production) are applied.
// Scenario: 20 individual codes, code_type "fixed_price" = 9900, max_uses = 1, list price 19900. Every code below is a
// fixture: no real code is used. This file adds no production code; it pins the behaviour the promotion relies on.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireEmbeddedPgLock } from "./helpers/embedded-pg-lock.mjs";
import { makeDb } from "./helpers/discount-db-fixtures.mjs";

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  ({ default: pg } = await import("pg"));
} catch {
  // optional dev tooling not installed
}

const PORT = Number(process.env.PIONEROS_CODES_TEST_PG_PORT) || 54337;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-pioneros-codes-pg-"));
let server;

const SEATS = 20;
const PROMO_PRICE = 9900;
const codeOf = (i) => `PIONERO-TEST-${String(i).padStart(2, "0")}`;

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  const db = makeDb(pg, PORT);
  const { freshDb, newUser, insertCode, BASE, reserve, usedCount, reservationRows, confirm, buyWithCode, connect } = db;
  try {
    const c = await freshDb("pc_main", { discount: true, consistency: true });
    const t = (name, fn) => test(name, fn);

    const insertPioneerCodes = async (n = SEATS, fields = {}) => {
      for (let i = 1; i <= n; i += 1) {
        await insertCode(c, codeOf(i), { code_type: "fixed_price", discount_value: PROMO_PRICE, max_uses: 1, ...fields });
      }
    };

    await t("list price 19900 + fixed_price 9900 -> 9900; fixed_amount 10000 -> 9900; both change differently if the list price moves", async () => {
      const f = async (type, value, base) =>
        (await c.query(`select public.discount_code_final_amount($1,$2::numeric,$3::numeric) as v`, [type, value, base])).rows[0].v;
      assert.equal(await f("fixed_price", PROMO_PRICE, 19900), "9900.00");
      assert.equal(await f("discount_fixed_amount", 10000, 19900), "9900.00");
      // The recommended type does not drift when the list price changes; the fixed amount does.
      assert.equal(await f("fixed_price", PROMO_PRICE, 24900), "9900.00");
      assert.equal(await f("discount_fixed_amount", 10000, 24900), "14900.00");
      // A price at or above the list price is not a discount (cannot be used to charge more).
      assert.equal(await f("fixed_price", 19900, 19900), null);
    });

    await t("20 individual single-use codes: each of 20 buyers (concurrent connections) reserves their own at 9900", async () => {
      await insertPioneerCodes();
      const buyers = [];
      for (let i = 1; i <= SEATS; i += 1) buyers.push(await newUser(c));
      const conns = await Promise.all(buyers.map(() => connect("pc_main")));
      const results = await Promise.all(conns.map(async (cn, i) => reserve(cn, buyers[i], codeOf(i + 1))));
      await Promise.all(conns.map((cn) => cn.end()));
      for (const r of results) {
        assert.equal(r.status, "reserved", JSON.stringify(r));
        assert.equal(Number(r.final_amount), PROMO_PRICE);
        assert.equal(Number(r.base_amount), BASE);
        assert.equal(Number(r.discount_amount), BASE - PROMO_PRICE);
      }
      assert.equal(new Set(results.map((r) => r.reservation_id)).size, SEATS);
      assert.equal((await c.query(`select count(*)::int n from public.discount_code_reservations r join public.invite_codes k on k.id=r.invite_code_id where k.code like 'PIONERO-TEST-%' and r.status='reserved'`)).rows[0].n, SEATS);
    });

    await t("a leaked code: 12 different people racing for ONE single-use code -> exactly one wins", async () => {
      await insertCode(c, "PIONERO-FILTRADO", { code_type: "fixed_price", discount_value: PROMO_PRICE, max_uses: 1 });
      const people = [];
      for (let i = 0; i < 12; i += 1) people.push(await newUser(c));
      const conns = await Promise.all(people.map(() => connect("pc_main")));
      const results = await Promise.all(conns.map(async (cn, i) => (await reserve(cn, people[i], "PIONERO-FILTRADO")).status));
      await Promise.all(conns.map((cn) => cn.end()));
      assert.equal(results.filter((s) => s === "reserved").length, 1, results.join(","));
      assert.equal(results.filter((s) => s === "exhausted").length, 11, results.join(","));
    });

    await t("full flow: reserve -> checkout at 9900 -> authorized -> one confirmed use; the code can never be used again", async () => {
      await insertCode(c, "PIONERO-FLUJO", { code_type: "fixed_price", discount_value: PROMO_PRICE, max_uses: 1 });
      const [buyer, other] = [await newUser(c), await newUser(c)];
      const { reservation, attempt } = await buyWithCode(c, buyer, "PIONERO-FLUJO");
      assert.equal(Number(reservation.final_amount), PROMO_PRICE);
      // The subscription row holds what Mercado Pago will charge every month: 9900, not 19900.
      assert.equal(Number((await c.query(`select amount from public.subscriptions where mercado_pago_preapproval_id=$1`, [attempt.preapprovalId])).rows[0].amount), PROMO_PRICE);
      assert.equal(await usedCount(c, "PIONERO-FLUJO"), 0, "nothing is consumed before Mercado Pago authorizes");
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "confirmed");
      assert.equal(await usedCount(c, "PIONERO-FLUJO"), 1);
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "already_confirmed"); // duplicated webhook
      assert.equal(await usedCount(c, "PIONERO-FLUJO"), 1);
      assert.equal((await reserve(c, other, "PIONERO-FLUJO")).status, "exhausted");
      assert.equal((await reserve(c, buyer, "PIONERO-FLUJO")).status, "already_used");
    });

    await t("one person holds at most one live reservation: switching to another code releases the first seat", async () => {
      await insertCode(c, "PIONERO-DOBLE-A", { code_type: "fixed_price", discount_value: PROMO_PRICE, max_uses: 1 });
      await insertCode(c, "PIONERO-DOBLE-B", { code_type: "fixed_price", discount_value: PROMO_PRICE, max_uses: 1 });
      const u = await newUser(c);
      const a = await reserve(c, u, "PIONERO-DOBLE-A");
      const b = await reserve(c, u, "PIONERO-DOBLE-B");
      assert.equal(a.status, "reserved");
      assert.equal(b.status, "reserved");
      // Switching codes releases the previous seat: the person never holds two seats at once.
      const live = (await reservationRows(c, u)).filter((r) => r.status === "reserved");
      assert.equal(live.length, 1);
      assert.equal((await reserve(c, await newUser(c), "PIONERO-DOBLE-A")).status, "reserved", "code A was released when the person switched to B");
    });

    await t("abandoned or cancelled before authorization: the individual code is usable again (and only then)", async () => {
      await insertCode(c, "PIONERO-CANCELA", { code_type: "fixed_price", discount_value: PROMO_PRICE, max_uses: 1 });
      const [u, v] = [await newUser(c), await newUser(c)];
      const { attempt } = await buyWithCode(c, u, "PIONERO-CANCELA");
      assert.equal((await reserve(c, v, "PIONERO-CANCELA")).status, "exhausted");
      assert.equal((await c.query(`select public.release_discount_reservation_for_preapproval($1) as r`, [attempt.preapprovalId])).rows[0].r.released, 1);
      assert.equal((await reserve(c, v, "PIONERO-CANCELA")).status, "reserved");
    });

    await t("deactivating a code in the admin (status != active) makes the database refuse it immediately; an expired code is refused too", async () => {
      await insertCode(c, "PIONERO-APAGADO", { code_type: "fixed_price", discount_value: PROMO_PRICE, max_uses: 1 });
      const u = await newUser(c);
      assert.equal((await reserve(c, u, "PIONERO-APAGADO", { dryRun: true })).status, "ok");
      await c.query(`update public.invite_codes set status='inactive' where code='PIONERO-APAGADO'`);
      assert.equal((await reserve(c, u, "PIONERO-APAGADO", { dryRun: true })).status, "invalid");
      assert.equal((await reserve(c, u, "PIONERO-APAGADO")).status, "invalid");
      assert.equal((await reservationRows(c, u)).length, 0);
      await insertCode(c, "PIONERO-VENCIDO", { code_type: "fixed_price", discount_value: PROMO_PRICE, max_uses: 1, expires_at: new Date(Date.now() - 60_000).toISOString() });
      assert.equal((await reserve(c, u, "PIONERO-VENCIDO")).status, "expired");
    });

    await t("a code without max_uses never runs out (the exposure of the 3 existing codes); deactivating it is what closes it", async () => {
      await insertCode(c, "SIN-LIMITE", { code_type: "fixed_price", discount_value: PROMO_PRICE });
      const results = [];
      for (let i = 0; i < 5; i += 1) results.push((await reserve(c, await newUser(c), "SIN-LIMITE")).status);
      assert.deepEqual(results, Array(5).fill("reserved"));
      // Deactivating it is what closes it.
      await c.query(`update public.invite_codes set status='inactive' where code='SIN-LIMITE'`);
      assert.equal((await reserve(c, await newUser(c), "SIN-LIMITE")).status, "invalid");
    });

    await t("inventory diagnostic: read-only, lists the active discount codes masked (never the full code) with their usage and limits", async () => {
      const inventory = fs.readFileSync(path.join(process.cwd(), "supabase/diagnostics/20261111_discount_codes_inventory.sql"), "utf8");
      await insertCode(c, "PRECIO-SECRETO99", { code_type: "fixed_price", discount_value: PROMO_PRICE, title: "prueba interna" });
      await c.query("begin read only");
      let rows;
      try {
        rows = (await c.query(inventory)).rows;
      } finally {
        await c.query("rollback");
      }
      const row = rows.find((r) => r.title === "prueba interna");
      assert.ok(row, "the code is listed");
      assert.equal(row.code_masked, "PREC**********99");
      assert.equal(row.code_length, 16);
      assert.equal(row.is_unlimited, true);
      assert.equal(row.never_expires, true);
      assert.equal(Number(row.used_count), 0);
      assert.equal(Number(row.redemptions), 0);
      assert.equal(Number(row.reservations), 0);
      assert.doesNotMatch(JSON.stringify(rows), /SECRETO/);
      // No beta / free-access codes in the listing, and nothing was written.
      assert.ok(rows.every((r) => ["discount_percent", "discount_fixed_amount", "fixed_price"].includes(r.code_type)));
      // The statement is a single SELECT without any write keyword.
      const code = inventory.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
      assert.doesNotMatch(code, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i);
    });

    await t("checkout-test diagnostic: read-only; a full test purchase leaves everyone else's rows untouched, and it DETECTS interference", async () => {
      const state = fs.readFileSync(path.join(process.cwd(), "supabase/diagnostics/20261111_discount_checkout_test_state.sql"), "utf8");
      const s = await freshDb("pc_state", { discount: true, consistency: true });
      await s.query(`
        create table public.payments (id uuid primary key default gen_random_uuid(), user_id uuid, subscription_id uuid, status text, amount numeric, currency text, created_at timestamptz default now());
        create table public.profiles (id uuid primary key, membership_status text, membership_expires_at timestamptz, membership_started_at timestamptz);
        create table public.mercado_pago_webhook_events (id uuid primary key default gen_random_uuid(), event_type text, processed boolean default false, created_at timestamptz default now());`);
      // Everyone else: two real-looking members and a pending checkout, before the test starts.
      const [m1, m2, pending] = [await newUser(s), await newUser(s), await newUser(s)];
      for (const [u, amount] of [[m1, 19900], [m2, 250]]) {
        await s.query(`insert into public.subscriptions (user_id, mercado_pago_preapproval_id, status, amount, currency) values ($1,$2,'authorized',$3,'ARS')`, [u, `pre_other_${amount}`, amount]);
        await s.query(`insert into public.profiles (id, membership_status, membership_started_at) values ($1,'active', now() - interval '30 days')`, [u]);
      }
      await db.checkout(s, pending, 19900);
      await insertCode(s, "PRECIO-PRUEBA-X1", { code_type: "fixed_price", discount_value: PROMO_PRICE, max_uses: 1 });
      await insertCode(s, "OTRO-CODIGO", { code_type: "discount_percent", discount_value: 10 });
      const tester = (await s.query(`insert into auth.users (email) values ('Prueba.Pioneros@example.test') returning id`)).rows[0].id;
      const t0 = (await s.query(`select now() as t`)).rows[0].t.toISOString();

      const run = async () => {
        const sql = state
          .replace("'EDITAR-correo-de-la-cuenta-de-prueba'", "'prueba.pioneros@example.test'")
          .replace("'EDITAR-codigo-de-prueba'", "'precio-prueba-x1'")
          .replace("'2000-01-01 00:00:00-03'", `'${t0}'`);
        await s.query("begin read only");
        try {
          return (await s.query(sql)).rows;
        } finally {
          await s.query("rollback");
        }
      };
      const pick = (rows, section, item) => rows.find((r) => r.section === section && r.item.startsWith(item))?.detail;
      const fingerprints = (rows) => rows.filter((r) => r.section === "4_FINGERPRINT_OTHERS").map((r) => `${r.item}=${r.detail}`).join("\n");

      const before = await run();
      assert.equal(pick(before, "0_PARAMS", "test user found"), "1");
      assert.equal(pick(before, "0_PARAMS", "test code found"), "1");
      assert.equal(pick(before, "0_PARAMS", "t0 set"), "true");
      assert.equal(pick(before, "1_TEST_USER", "subscriptions"), "(none)");

      // The test purchase: reserve -> checkout at 9900 -> Mercado Pago authorizes -> first payment approved.
      const { attempt } = await db.buyWithCode(s, tester, "PRECIO-PRUEBA-X1");
      assert.equal((await db.confirm(s, attempt.preapprovalId)).status, "confirmed");
      await s.query(`insert into public.payments (user_id, status, amount, currency) values ($1,'approved',9900,'ARS')`, [tester]);
      await s.query(`insert into public.profiles (id, membership_status, membership_started_at, membership_expires_at) values ($1,'active', now(), now() + interval '33 days')`, [tester]);

      const after = await run();
      assert.match(pick(after, "1_TEST_USER", "subscriptions"), /pending amount=9900(\.00)? ARS/);
      assert.match(pick(after, "1_TEST_USER", "checkout attempts"), /completed amount=9900\.00 ARS/);
      assert.match(pick(after, "1_TEST_USER", "payments"), /approved amount=9900 ARS/);
      assert.match(pick(after, "1_TEST_USER", "discount reservations"), /confirmed base=19900\.00 final=9900\.00/);
      assert.match(pick(after, "2_TEST_CODE", "code row"), /used_count=1/);
      assert.equal(pick(after, "2_TEST_CODE", "redemptions"), "1");
      for (const item of ["subscriptions updated", "payments created", "checkout attempts updated", "discount reservations", "code redemptions", "profiles whose membership started"]) {
        assert.equal(pick(after, "3_OTHERS_TOUCHED_SINCE_T0", item), "0", item);
      }
      assert.equal(pick(after, "3_OTHERS_TOUCHED_SINCE_T0", "other codes with uses"), pick(before, "3_OTHERS_TOUCHED_SINCE_T0", "other codes with uses"));
      assert.equal(fingerprints(after), fingerprints(before), "everyone else is byte-for-byte unchanged");
      assert.match(fingerprints(after), /19900 x1, 250 x1/);

      // The diagnostic must notice interference: another member's subscription changes during the test.
      await s.query(`update public.subscriptions set status='cancelled', amount=9900, updated_at=now() where user_id=$1`, [m1]);
      const touched = await run();
      assert.equal(pick(touched, "3_OTHERS_TOUCHED_SINCE_T0", "subscriptions updated"), "1");
      assert.notEqual(fingerprints(touched), fingerprints(before));
      // Wrong parameters are visible, not silent.
      const lost = (await s.query(state)).rows;
      assert.equal(pick(lost, "0_PARAMS", "test user found"), "0");
      assert.equal(pick(lost, "0_PARAMS", "t0 set"), "false");
      // Single read-only SELECT, no code printed, no e-mail printed.
      assert.doesNotMatch(JSON.stringify(after), /PRECIO-PRUEBA|example\.test/i);
      const code = state.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
      assert.doesNotMatch(code, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i);
      await s.end();
    });

    await t("the promo never touches existing codes, subscriptions or the list price", async () => {
      const before = (await c.query(`select count(*)::int n from public.invite_codes`)).rows[0].n;
      await reserve(c, await newUser(c), codeOf(1), { dryRun: true });
      assert.equal((await c.query(`select count(*)::int n from public.invite_codes`)).rows[0].n, before);
      assert.equal((await c.query(`select count(*)::int n from public.subscriptions where status in ('authorized','active')`)).rows[0].n, 0);
    });

    await c.end();
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (!EmbeddedPostgres || !pg) {
  test("pioneros codes DB scenario", { skip: "optional: npm i --no-save embedded-postgres pg" }, () => {});
} else {
  await main();
}
