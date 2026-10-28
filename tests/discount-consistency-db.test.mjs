// Regression tests for 20261030120000_discount_checkout_consistency.sql against a REAL Postgres (embedded, local only).
// Opt-in, like the other *-db tests:  npm i --no-save embedded-postgres pg && node --test tests/discount-consistency-db.test.mjs
//
// Covers the review findings: a late Mercado Pago authorization must never push a code past its max_uses, a reservation
// whose checkout is still open keeps its seat, and notifications are idempotent and race-safe. No real code is used.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireEmbeddedPgLock } from "./helpers/embedded-pg-lock.mjs";
import { makeDb, migrations, read } from "./helpers/discount-db-fixtures.mjs";

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  ({ default: pg } = await import("pg"));
} catch {
  // optional dev tooling not installed
}

const PORT = Number(process.env.DISCOUNT_CONSISTENCY_TEST_PG_PORT) || 54335;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-discount-consistency-pg-"));
let server;

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  const db = makeDb(pg, PORT);
  const { freshDb, newUser, insertCode, reserve, usedCount, reservationRows, confirm, checkout, buyWithCode, connect } = db;
  try {
    // ---------- Migration preconditions ----------
    await test("migration requires the base discount migration and is idempotent", async () => {
      const bare = await freshDb("dk_bare");
      await assert.rejects(bare.query(migrations.consistency), /Apply 20261029120000_discount_code_checkout\.sql first/);
      await bare.end();
      const ok = await freshDb("dk_ok", { discount: true });
      await ok.query(migrations.consistency);
      await ok.query(migrations.consistency);
      assert.equal((await ok.query(`select count(*)::int n from information_schema.columns where table_name='discount_code_reservations' and column_name='over_limit'`)).rows[0].n, 1);
      await ok.end();
    });

    await test("existing reservations and codes survive the migration untouched", async () => {
      const c = await freshDb("dk_upgrade", { discount: true });
      await insertCode(c, "PROMO-VIEJO", { max_uses: 3 });
      const u = await newUser(c);
      const before = await reserve(c, u, "PROMO-VIEJO");
      await c.query(migrations.consistency);
      const rows = await reservationRows(c, u);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, before.reservation_id);
      assert.equal(rows[0].status, "reserved");
      assert.equal(rows[0].over_limit, false);
      assert.equal((await reserve(c, u, "PROMO-VIEJO")).reservation_id, before.reservation_id);
      await c.end();
    });

    // ---------- Control: the review finding is real on the previous migration alone ----------
    await test("control (20261029 alone): the seat of an open checkout is given away after the clock and the late payment exceeds max_uses", async () => {
      const old = await freshDb("dk_control", { discount: true });
      await insertCode(old, "PROMO-CONTROL", { max_uses: 1 });
      const [u, v] = [await newUser(old), await newUser(old)];
      const { attempt } = await buyWithCode(old, u, "PROMO-CONTROL");
      await old.query(`update public.discount_code_reservations set expires_at = now() - interval '3 hours' where user_id=$1`, [u]);
      assert.equal((await reserve(old, v, "PROMO-CONTROL")).status, "reserved"); // seat handed to V although U's checkout is open
      const other = await checkout(old, v, 15920);
      const vRes = (await reservationRows(old, v))[0];
      await old.query(`select public.attach_discount_reservation($1,$2,$3)`, [v, vRes.id, other.attemptId]);
      await confirm(old, other.preapprovalId);
      await confirm(old, attempt.preapprovalId); // U pays late
      assert.equal(await usedCount(old, "PROMO-CONTROL"), 2, "two uses for a code limited to 1: the bug the new migration fixes");
      await old.end();
    });

    // ---------- Behaviour (both discount migrations applied) ----------
    const c = await freshDb("dk_main", { discount: true, consistency: true });
    const t = (name, fn) => test(name, fn);
    const pastClock = (uid) => c.query(`update public.discount_code_reservations set expires_at = now() - interval '3 hours', created_at = now() - interval '3 hours' where user_id=$1`, [uid]);

    await t("a reservation whose checkout is open keeps its seat after the 30 min clock (nobody can take it)", async () => {
      await insertCode(c, "PROMO-ASIENTO", { max_uses: 1 });
      const [u, v] = [await newUser(c), await newUser(c)];
      const { reservation } = await buyWithCode(c, u, "PROMO-ASIENTO");
      await pastClock(u);
      assert.equal((await reserve(c, v, "PROMO-ASIENTO")).status, "exhausted");
      assert.equal((await reserve(c, v, "PROMO-ASIENTO", { dryRun: true })).status, "exhausted");
      const row = (await reservationRows(c, u))[0];
      assert.equal(row.id, reservation.reservation_id);
      assert.equal(row.status, "reserved");
      assert.equal(await usedCount(c, "PROMO-ASIENTO"), 0);
    });

    await t("a reservation that never created a checkout still lapses after the clock and frees the seat", async () => {
      await insertCode(c, "PROMO-SINCHECKOUT", { max_uses: 1 });
      const [u, v] = [await newUser(c), await newUser(c)];
      assert.equal((await reserve(c, u, "PROMO-SINCHECKOUT")).status, "reserved");
      assert.equal((await reserve(c, v, "PROMO-SINCHECKOUT")).status, "exhausted");
      await pastClock(u);
      assert.equal((await reserve(c, v, "PROMO-SINCHECKOUT")).status, "reserved");
      assert.equal((await reservationRows(c, u))[0].status, "expired");
    });

    await t("late authorization (hours later) of a held seat is confirmed WITHOUT exceeding the limit", async () => {
      await insertCode(c, "PROMO-TARDE", { max_uses: 1 });
      const [u, v] = [await newUser(c), await newUser(c)];
      const { attempt } = await buyWithCode(c, u, "PROMO-TARDE");
      await pastClock(u);
      assert.equal((await reserve(c, v, "PROMO-TARDE")).status, "exhausted"); // the seat was never given away
      const late = await confirm(c, attempt.preapprovalId);
      assert.equal(late.status, "confirmed");
      assert.equal(await usedCount(c, "PROMO-TARDE"), 1);
      const row = (await reservationRows(c, u))[0];
      assert.equal(row.status, "confirmed");
      assert.equal(row.over_limit, false);
      assert.equal((await c.query(`select count(*)::int n from public.invite_code_redemptions r join public.invite_codes k on k.id=r.invite_code_id where k.code='PROMO-TARDE'`)).rows[0].n, 1);
      assert.equal((await reserve(c, v, "PROMO-TARDE")).status, "exhausted");
    });

    await t("Mercado Pago retries (same notification many times, concurrently) consume exactly one use", async () => {
      await insertCode(c, "PROMO-REINTENTOS", { max_uses: 2 });
      const u = await newUser(c);
      const { attempt } = await buyWithCode(c, u, "PROMO-REINTENTOS");
      const conns = await Promise.all(Array.from({ length: 10 }, () => connect("dk_main")));
      const results = await Promise.all(conns.map(async (cn) => (await confirm(cn, attempt.preapprovalId)).status));
      await Promise.all(conns.map((cn) => cn.end()));
      assert.equal(results.filter((s) => s === "confirmed").length, 1, results.join(","));
      assert.equal(results.filter((s) => s === "already_confirmed").length, 9, results.join(","));
      assert.equal(await usedCount(c, "PROMO-REINTENTOS"), 1);
      assert.equal((await c.query(`select count(*)::int n from public.invite_code_redemptions r join public.invite_codes k on k.id=r.invite_code_id where k.code='PROMO-REINTENTOS'`)).rows[0].n, 1);
      // A later retry still changes nothing.
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "already_confirmed");
      assert.equal(await usedCount(c, "PROMO-REINTENTOS"), 1);
    });

    await t("a notification for an unknown preapproval changes nothing", async () => {
      const before = (await c.query(`select coalesce(sum(used_count),0)::int n from public.invite_codes`)).rows[0].n;
      assert.equal((await confirm(c, "pre_does_not_exist")).status, "none");
      assert.equal((await c.query(`select coalesce(sum(used_count),0)::int n from public.invite_codes`)).rows[0].n, before);
    });

    await t("two simultaneous purchases of the last seat: one wins, and its late payment is still within the limit", async () => {
      await insertCode(c, "PROMO-ULTIMO", { max_uses: 1 });
      const buyers = [];
      for (let i = 0; i < 8; i++) buyers.push(await newUser(c));
      const conns = await Promise.all(buyers.map(() => connect("dk_main")));
      const results = await Promise.all(conns.map(async (cn, i) => (await reserve(cn, buyers[i], "PROMO-ULTIMO")).status));
      await Promise.all(conns.map((cn) => cn.end()));
      assert.equal(results.filter((s) => s === "reserved").length, 1, results.join(","));
      assert.equal(results.filter((s) => s === "exhausted").length, 7, results.join(","));
      const winner = buyers[results.indexOf("reserved")];
      const reservationId = (await reservationRows(c, winner))[0].id;
      const attempt = await checkout(c, winner, 15920);
      assert.equal((await c.query(`select public.attach_discount_reservation($1,$2,$3) as r`, [winner, reservationId, attempt.attemptId])).rows[0].r.status, "attached");
      await pastClock(winner);
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "confirmed");
      assert.equal(await usedCount(c, "PROMO-ULTIMO"), 1);
      const loser = buyers[results.indexOf("exhausted")];
      assert.equal((await reserve(c, loser, "PROMO-ULTIMO")).status, "exhausted");
    });

    await t("cancelled before authorization frees the seat; a confirmed use is never released by a later cancellation", async () => {
      await insertCode(c, "PROMO-CANCELA", { max_uses: 1 });
      const [u, v] = [await newUser(c), await newUser(c)];
      const { attempt } = await buyWithCode(c, u, "PROMO-CANCELA");
      assert.equal((await reserve(c, v, "PROMO-CANCELA")).status, "exhausted");
      assert.equal((await c.query(`select public.release_discount_reservation_for_preapproval($1) as r`, [attempt.preapprovalId])).rows[0].r.released, 1);
      assert.equal((await reserve(c, v, "PROMO-CANCELA")).status, "reserved");

      await insertCode(c, "PROMO-PAGADO", { max_uses: 1 });
      const w = await newUser(c);
      const paid = await buyWithCode(c, w, "PROMO-PAGADO");
      assert.equal((await confirm(c, paid.attempt.preapprovalId)).status, "confirmed");
      assert.equal((await c.query(`select public.release_discount_reservation_for_preapproval($1) as r`, [paid.attempt.preapprovalId])).rows[0].r.released, 0);
      assert.equal(await usedCount(c, "PROMO-PAGADO"), 1);
      assert.equal((await reservationRows(c, w))[0].status, "confirmed");
    });

    await t("abnormal late authorization with the seat still free is confirmed normally (payer not harmed, no flag)", async () => {
      await insertCode(c, "PROMO-LIBRE", { max_uses: 2 });
      const u = await newUser(c);
      const { attempt } = await buyWithCode(c, u, "PROMO-LIBRE");
      await c.query(`update public.discount_code_reservations set status='released', released_at=now() where user_id=$1`, [u]);
      const out = await confirm(c, attempt.preapprovalId);
      assert.equal(out.status, "confirmed");
      assert.equal((await reservationRows(c, u))[0].over_limit, false);
      assert.equal(await usedCount(c, "PROMO-LIBRE"), 1);
    });

    await t("abnormal late authorization when the code is already full: the payer is honoured and the excess is flagged", async () => {
      await insertCode(c, "PROMO-LLENO", { max_uses: 1 });
      const [u, v] = [await newUser(c), await newUser(c)];
      const { attempt } = await buyWithCode(c, u, "PROMO-LLENO");
      // The reservation was retired (e.g. by hand) and the seat went to someone else, who paid.
      await c.query(`update public.discount_code_reservations set status='released', released_at=now() where user_id=$1`, [u]);
      const other = await buyWithCode(c, v, "PROMO-LLENO");
      assert.equal((await confirm(c, other.attempt.preapprovalId)).status, "confirmed");
      assert.equal(await usedCount(c, "PROMO-LLENO"), 1);

      const out = await confirm(c, attempt.preapprovalId);
      assert.equal(out.status, "confirmed_over_limit");
      const row = (await reservationRows(c, u))[0];
      assert.equal(row.status, "confirmed");
      assert.equal(row.over_limit, true);
      assert.equal(await usedCount(c, "PROMO-LLENO"), 2); // the ledger tells the truth
      // The code stays closed for everyone else, and a retry of the same notification is a no-op.
      assert.equal((await reserve(c, await newUser(c), "PROMO-LLENO")).status, "exhausted");
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "already_confirmed");
      assert.equal(await usedCount(c, "PROMO-LLENO"), 2);
      // The subscription itself is untouched by the discount ledger.
      assert.equal((await c.query(`select status from public.subscriptions where mercado_pago_preapproval_id=$1`, [attempt.preapprovalId])).rows[0].status, "pending");
    });

    await t("confirm racing the last seat: never two holders without the over_limit flag (10 trials)", async () => {
      for (let i = 0; i < 10; i++) {
        const code = `PROMO-CARRERA-${i}`;
        await insertCode(c, code, { max_uses: 1 });
        const [u, v] = [await newUser(c), await newUser(c)];
        const { attempt } = await buyWithCode(c, u, code);
        await c.query(`update public.discount_code_reservations set status='released', released_at=now() where user_id=$1`, [u]);
        const [c1, c2] = await Promise.all([connect("dk_main"), connect("dk_main")]);
        const [confirmed, reserved] = await Promise.all([confirm(c1, attempt.preapprovalId), reserve(c2, v, code)]);
        await Promise.all([c1.end(), c2.end()]);
        if (reserved.status === "reserved") {
          assert.equal(confirmed.status, "confirmed_over_limit", `trial ${i}: V holds the seat, U must be flagged`);
        } else {
          assert.equal(reserved.status, "exhausted", `trial ${i}`);
          assert.equal(confirmed.status, "confirmed", `trial ${i}: U confirmed first, V waits`);
        }
        const flagged = (await reservationRows(c, u))[0].over_limit;
        assert.equal(flagged, reserved.status === "reserved", `trial ${i}`);
      }
    });

    await t("a closed checkout attempt no longer holds its seat (e.g. the subscription ended without authorization)", async () => {
      await insertCode(c, "PROMO-CERRADO", { max_uses: 1 });
      const [u, v] = [await newUser(c), await newUser(c)];
      const { attempt } = await buyWithCode(c, u, "PROMO-CERRADO");
      assert.equal((await reserve(c, v, "PROMO-CERRADO")).status, "exhausted");
      await c.query(`update public.checkout_attempts set state='closed', closed_at=now() where id=$1`, [attempt.attemptId]);
      assert.equal((await reserve(c, v, "PROMO-CERRADO")).status, "reserved");
      assert.equal((await reservationRows(c, u))[0].status, "released");
    });

    await t("replacing a pending checkout (user removed the code) releases the seat for others", async () => {
      await insertCode(c, "PROMO-QUITAR", { max_uses: 1 });
      const [u, v] = [await newUser(c), await newUser(c)];
      const { attempt } = await buyWithCode(c, u, "PROMO-QUITAR");
      assert.equal((await reserve(c, v, "PROMO-QUITAR")).status, "exhausted");
      const open = (await c.query(`select public.describe_open_checkout($1) as r`, [u])).rows[0].r;
      assert.equal(open.attempt_id, attempt.attemptId);
      assert.equal(Number(open.amount), 15920); // what the route compares with the list price
      assert.equal((await c.query(`select public.close_pending_checkout($1,$2) as r`, [u, attempt.attemptId])).rows[0].r.status, "closed");
      assert.equal((await reserve(c, v, "PROMO-QUITAR")).status, "reserved");
      // The user's next checkout is a plain one at the list price and is accepted by the checkout state machine.
      const plain = await checkout(c, u, 19900);
      assert.notEqual(plain.attemptId, attempt.attemptId);
      assert.equal(Number((await c.query(`select public.describe_open_checkout($1) as r`, [u])).rows[0].r.amount), 19900);
    });

    await t("a paid (authorized) subscription is never replaced, whatever the amount", async () => {
      await insertCode(c, "PROMO-PAGANDO", { max_uses: 5 });
      const u = await newUser(c);
      const { attempt } = await buyWithCode(c, u, "PROMO-PAGANDO");
      await confirm(c, attempt.preapprovalId);
      await c.query(`update public.subscriptions set status='authorized' where mercado_pago_preapproval_id=$1`, [attempt.preapprovalId]);
      assert.equal((await c.query(`select public.close_pending_checkout($1,$2) as r`, [u, attempt.attemptId])).rows[0].r.status, "not_closable");
      assert.equal((await c.query(`select state from public.checkout_attempts where id=$1`, [attempt.attemptId])).rows[0].state, "completed");
      assert.equal((await reservationRows(c, u))[0].status, "confirmed");
    });

    await t("checkout without discount: no reservation rows are involved and plain attempts are untouched", async () => {
      const u = await newUser(c);
      const plain = await checkout(c, u, 19900);
      const open = (await c.query(`select public.describe_open_checkout($1) as r`, [u])).rows[0].r;
      assert.equal(open.attempt_id, plain.attemptId);
      assert.equal(Number(open.amount), 19900);
      assert.equal((await reservationRows(c, u)).length, 0);
      assert.equal((await confirm(c, plain.preapprovalId)).status, "none");
    });

    await t("same-user concurrent reservations still end with one live reservation", async () => {
      await insertCode(c, "PROMO-MISMO", { max_uses: 5 });
      const u = await newUser(c);
      const conns = await Promise.all(Array.from({ length: 8 }, () => connect("dk_main")));
      const ids = await Promise.all(conns.map(async (cn) => (await reserve(cn, u, "PROMO-MISMO")).reservation_id));
      await Promise.all(conns.map((cn) => cn.end()));
      assert.equal(new Set(ids).size, 1);
      assert.equal((await reservationRows(c, u)).length, 1);
    });

    await t("security: the new helper is service_role only and the replaced functions keep their privileges", async () => {
      for (const fn of ["public.discount_reservation_holds_seat(text,uuid,timestamptz,timestamptz)", "public.reserve_discount_code(uuid,text,numeric,text,boolean,integer)", "public.confirm_discount_reservation(text)"]) {
        for (const role of ["anon", "authenticated"]) {
          assert.equal((await c.query(`select has_function_privilege($1,$2,'execute') as v`, [role, fn])).rows[0].v, false, `${role} ${fn}`);
        }
        assert.equal((await c.query(`select has_function_privilege('service_role',$1,'execute') as v`, [fn])).rows[0].v, true, fn);
      }
    });

    await t("diagnostic reports held seats and over-limit confirmations without printing codes", async () => {
      const diagnostic = read("supabase/diagnostics/20261029_discount_codes_state.sql");
      await c.query("begin read only");
      let rows;
      try {
        rows = (await c.query(diagnostic)).rows;
      } finally {
        await c.query("rollback");
      }
      const verdict = rows.find((r) => r.section === "0_VERDICT" && r.item.startsWith("Seat accounting migration"));
      assert.match(verdict.detail, /^applied/);
      assert.ok(rows.some((r) => r.section === "D_counts" && /over_limit=1/.test(r.detail)), "the over-limit confirmation is visible");
      assert.doesNotMatch(JSON.stringify(rows), /PROMO-/);
    });

    await c.end();
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (!EmbeddedPostgres || !pg) {
  test("discount consistency DB behaviour", { skip: "optional: npm i --no-save embedded-postgres pg" }, () => {});
} else {
  await main();
}
