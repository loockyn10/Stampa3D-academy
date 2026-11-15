// Cupos de códigos de descuento (Pioneros) consumidos SOLO con el primer pago aprobado
// (supabase/migrations/20261115120000_discount_confirm_on_first_payment.sql) contra un PostgreSQL REAL embebido,
// descartable y local: nunca toca Supabase ni Mercado Pago. Opt-in como los otros *-db tests:
//
//   npm i --no-save embedded-postgres pg && node --test tests/discount-first-payment-db.test.mjs
//
// Se aplican las migrations reales de checkout_attempts y de descuentos (las dos ya aplicadas en producción + la nueva).
// auth, roles, subscriptions, payments e invite_codes (no versionadas) son stubs con la forma usada por la app.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireEmbeddedPgLock } from "./helpers/embedded-pg-lock.mjs";
import { makeDb, read } from "./helpers/discount-db-fixtures.mjs";

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  ({ default: pg } = await import("pg"));
} catch {
  // optional dev tooling not installed
}

const firstPayment = read("supabase/migrations/20261115120000_discount_confirm_on_first_payment.sql");
const PORT = Number(process.env.FIRST_PAYMENT_TEST_PG_PORT) || 54342;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-first-payment-pg-"));
let server;

const PAYMENTS = `
create table public.payments (
  id uuid primary key default gen_random_uuid(), user_id uuid, subscription_id uuid references public.subscriptions(id),
  mercado_pago_payment_id text, mercado_pago_preapproval_id text, status text, amount numeric, currency text,
  paid_at timestamptz, created_at timestamptz default now());
`;

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  const db = makeDb(pg, PORT);
  const { freshDb, newUser, insertCode, reserve, usedCount, reservationRows, confirm, buyWithCode, connect, checkout, attach } = db;

  let dbSeq = 0;
  async function setup() {
    dbSeq += 1;
    const name = `fp_${dbSeq}`;
    const c = await freshDb(name, { discount: true, consistency: true });
    await c.query(PAYMENTS);
    await c.query(firstPayment);
    return { c, name };
  }

  const authorize = (c, preapprovalId) =>
    c.query(`update public.subscriptions set status='authorized' where mercado_pago_preapproval_id=$1`, [preapprovalId]);
  const cancelAtProvider = async (c, preapprovalId) => {
    await c.query(`update public.subscriptions set status='cancelled', cancelled_at=now() where mercado_pago_preapproval_id=$1`, [preapprovalId]);
    return (await c.query(`select public.release_discount_reservation_for_preapproval($1) as r`, [preapprovalId])).rows[0].r;
  };
  /** What the billing circuit records for an installment (recordInvoice). */
  const recordPayment = async (c, preapprovalId, status, n = 1) => {
    const sub = (await c.query(`select id, user_id from public.subscriptions where mercado_pago_preapproval_id=$1`, [preapprovalId])).rows[0];
    await c.query(
      `insert into public.payments (user_id, subscription_id, mercado_pago_payment_id, mercado_pago_preapproval_id, status, amount, currency, paid_at)
       values ($1,$2,$3,$4,$5,9900,'ARS',now())`,
      [sub.user_id, sub.id, `pay_${preapprovalId}_${n}_${status}`, preapprovalId, status],
    );
  };
  const summary = async (c, code) =>
    (await c.query(`select * from public.discount_code_seat_summary() where code=$1`, [code])).rows[0];

  try {
    await test("una autorización sin pago NO consume el cupo: queda reservado y lo sigue ocupando", async () => {
      const { c } = await setup();
      await insertCode(c, "PIONEROS", { code_type: "fixed_price", discount_value: 9900, max_uses: 1 });
      const a = await newUser(c);
      const b = await newUser(c);
      const { attempt } = await buyWithCode(c, a, "PIONEROS");
      await authorize(c, attempt.preapprovalId);

      assert.deepEqual(await confirm(c, attempt.preapprovalId), { status: "awaiting_payment" });
      assert.equal(await usedCount(c, "PIONEROS"), 0);
      assert.equal((await reservationRows(c, a))[0].status, "reserved");
      // The authorization can still charge: nobody else may take the last seat.
      assert.equal((await reserve(c, b, "PIONEROS")).status, "exhausted");
      const s = await summary(c, "PIONEROS");
      assert.deepEqual([s.confirmed, s.reserved, s.reserved_authorized, s.available], [0, 1, 1, 0]);
      await c.end();
    });

    await test("pago rechazado o pendiente: no consume; el primer pago aprobado sí, una sola vez", async () => {
      const { c } = await setup();
      await insertCode(c, "PIONEROS", { code_type: "fixed_price", discount_value: 9900, max_uses: 20 });
      const a = await newUser(c);
      const { attempt } = await buyWithCode(c, a, "PIONEROS");
      await authorize(c, attempt.preapprovalId);

      await recordPayment(c, attempt.preapprovalId, "rejected");
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "awaiting_payment");
      await recordPayment(c, attempt.preapprovalId, "pending");
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "awaiting_payment");
      assert.equal(await usedCount(c, "PIONEROS"), 0);

      await recordPayment(c, attempt.preapprovalId, "approved");
      const first = await confirm(c, attempt.preapprovalId);
      assert.equal(first.status, "confirmed");
      assert.equal(Number(first.final_amount), 9900);
      // Duplicated webhook, late webhook and the monthly renewal: never another use.
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "already_confirmed");
      await recordPayment(c, attempt.preapprovalId, "approved", 2);
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "already_confirmed");
      assert.equal(await usedCount(c, "PIONEROS"), 1);
      assert.equal((await c.query(`select count(*)::int n from public.invite_code_redemptions`)).rows[0].n, 1);
      const s = await summary(c, "PIONEROS");
      assert.deepEqual([s.confirmed, s.reserved, s.available], [1, 0, 19]);
      await c.end();
    });

    await test("abandono: un checkout nunca autorizado ocupa el cupo hasta cancelarse en Mercado Pago y no consume uso", async () => {
      const { c } = await setup();
      await insertCode(c, "PIONEROS", { code_type: "fixed_price", discount_value: 9900, max_uses: 1 });
      const a = await newUser(c);
      const b = await newUser(c);
      const { attempt } = await buyWithCode(c, a, "PIONEROS");
      // Even far beyond the 30-minute TTL: an open checkout keeps its seat (it could still be authorized).
      await c.query(`update public.discount_code_reservations set expires_at = now() - interval '5 days'`);
      assert.equal((await reserve(c, b, "PIONEROS")).status, "exhausted");

      // Older than 48 h and still pending -> listed for the reconciliation, which cancels it at Mercado Pago.
      await c.query(`update public.checkout_attempts set created_at = now() - interval '3 days' where id=$1`, [attempt.attemptId]);
      const stale = (await c.query(`select * from public.list_stale_discount_checkouts(2880, 20)`)).rows;
      assert.deepEqual(stale.map((r) => r.preapproval_id), [attempt.preapprovalId]);

      assert.equal((await cancelAtProvider(c, attempt.preapprovalId)).released, 1);
      assert.equal(await usedCount(c, "PIONEROS"), 0);
      assert.equal((await reserve(c, b, "PIONEROS")).status, "reserved", "the seat is free again");
      assert.equal((await c.query(`select count(*)::int n from public.list_stale_discount_checkouts(2880, 20)`)).rows[0].n, 0);
      await c.end();
    });

    await test("cancelada antes del primer pago (autorizada, cobro rechazado): libera el cupo sin consumirlo", async () => {
      const { c } = await setup();
      await insertCode(c, "PIONEROS", { code_type: "fixed_price", discount_value: 9900, max_uses: 1 });
      const a = await newUser(c);
      const b = await newUser(c);
      const { attempt } = await buyWithCode(c, a, "PIONEROS");
      await authorize(c, attempt.preapprovalId);
      await recordPayment(c, attempt.preapprovalId, "rejected");
      // Authorized subscriptions are never listed as stale: they can still charge.
      await c.query(`update public.checkout_attempts set created_at = now() - interval '9 days'`);
      assert.equal((await c.query(`select count(*)::int n from public.list_stale_discount_checkouts(60, 20)`)).rows[0].n, 0);

      await cancelAtProvider(c, attempt.preapprovalId);
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "awaiting_payment");
      assert.equal(await usedCount(c, "PIONEROS"), 0);
      assert.equal((await reservationRows(c, a))[0].status, "released");
      assert.equal((await reserve(c, b, "PIONEROS")).status, "reserved");
      await c.end();
    });

    await test("20 cupos: 20 compradores pagan, el 21.º recibe «agotado»; nunca más de 20 usos confirmados", async () => {
      const { c } = await setup();
      await insertCode(c, "PIONEROS", { code_type: "fixed_price", discount_value: 9900, max_uses: 20 });
      const buyers = [];
      for (let i = 0; i < 20; i += 1) {
        const uid = await newUser(c);
        const { reservation, attempt } = await buyWithCode(c, uid, "PIONEROS");
        assert.equal(reservation.status, "reserved");
        buyers.push(attempt);
      }
      const late = await newUser(c);
      assert.equal((await reserve(c, late, "PIONEROS")).status, "exhausted", "20 open checkouts already hold the 20 seats");

      for (const attempt of buyers) {
        await authorize(c, attempt.preapprovalId);
        await recordPayment(c, attempt.preapprovalId, "approved");
      }
      // Webhooks of the 20 first payments arriving at the same time, each one twice.
      const conns = await Promise.all(Array.from({ length: 10 }, () => connect(c.database)));
      const results = await Promise.all(
        [...buyers, ...buyers].map((attempt, i) =>
          conns[i % conns.length].query(`select public.confirm_discount_reservation($1) as r`, [attempt.preapprovalId]).then((r) => r.rows[0].r.status),
        ),
      );
      await Promise.all(conns.map((x) => x.end()));
      assert.equal(results.filter((s) => s === "confirmed").length, 20);
      assert.equal(results.filter((s) => s === "already_confirmed").length, 20);
      assert.equal(await usedCount(c, "PIONEROS"), 20);
      assert.equal((await reserve(c, late, "PIONEROS")).status, "exhausted");
      const s = await summary(c, "PIONEROS");
      assert.deepEqual([s.confirmed, s.reserved, s.available, s.over_limit], [20, 0, 0, 0]);
      await c.end();
    });

    await test("abandonos y rechazos no consumen: con 3 abandonados de 20, quedan cupos para otros cuando se liberan", async () => {
      const { c } = await setup();
      await insertCode(c, "PIONEROS", { code_type: "fixed_price", discount_value: 9900, max_uses: 20 });
      const attempts = [];
      for (let i = 0; i < 20; i += 1) attempts.push((await buyWithCode(c, await newUser(c), "PIONEROS")).attempt);
      // 15 pay, 3 abandon (cancelled by the reconciliation), 2 are authorized but their first charge is rejected.
      for (const a of attempts.slice(0, 15)) {
        await authorize(c, a.preapprovalId);
        await recordPayment(c, a.preapprovalId, "approved");
        assert.equal((await confirm(c, a.preapprovalId)).status, "confirmed");
      }
      for (const a of attempts.slice(15, 18)) await cancelAtProvider(c, a.preapprovalId);
      for (const a of attempts.slice(18)) {
        await authorize(c, a.preapprovalId);
        await recordPayment(c, a.preapprovalId, "rejected");
        assert.equal((await confirm(c, a.preapprovalId)).status, "awaiting_payment");
      }
      assert.equal(await usedCount(c, "PIONEROS"), 15);
      let s = await summary(c, "PIONEROS");
      assert.deepEqual([s.confirmed, s.reserved, s.reserved_authorized, s.available], [15, 2, 2, 3]);

      // The 3 freed seats are sold to new buyers; a 4th new buyer is refused.
      for (let i = 0; i < 3; i += 1) assert.equal((await buyWithCode(c, await newUser(c), "PIONEROS")).reservation.status, "reserved");
      assert.equal((await reserve(c, await newUser(c), "PIONEROS")).status, "exhausted");
      s = await summary(c, "PIONEROS");
      assert.deepEqual([s.confirmed, s.reserved, s.available], [15, 5, 0]);
      await c.end();
    });

    await test("dos usuarios por el último cupo al mismo tiempo: exactamente uno lo reserva", async () => {
      const { c, name } = await setup();
      await insertCode(c, "PIONEROS", { code_type: "fixed_price", discount_value: 9900, max_uses: 3 });
      for (let i = 0; i < 2; i += 1) {
        const { attempt } = await buyWithCode(c, await newUser(c), "PIONEROS");
        await authorize(c, attempt.preapprovalId);
        await recordPayment(c, attempt.preapprovalId, "approved");
        await confirm(c, attempt.preapprovalId);
      }
      for (let round = 0; round < 5; round += 1) {
        const x = await newUser(c);
        const y = await newUser(c);
        const [cx, cy] = await Promise.all([connect(name), connect(name)]);
        const [rx, ry] = await Promise.all([reserve(cx, x, "PIONEROS"), reserve(cy, y, "PIONEROS")]);
        await Promise.all([cx.end(), cy.end()]);
        const statuses = [rx.status, ry.status].sort();
        assert.deepEqual(statuses, ["exhausted", "reserved"], `round ${round}`);
        // Free the winner's unattached reservation for the next round.
        await c.query(`update public.discount_code_reservations set status='released', released_at=now() where status='reserved'`);
      }
      assert.equal(await usedCount(c, "PIONEROS"), 2);
      await c.end();
    });

    await test("pago aprobado que llega tarde para una reserva ya liberada: se honra al pagador y queda marcado over_limit", async () => {
      const { c } = await setup();
      await insertCode(c, "PIONEROS", { code_type: "fixed_price", discount_value: 9900, max_uses: 1 });
      const a = await newUser(c);
      const b = await newUser(c);
      const { attempt: first } = await buyWithCode(c, a, "PIONEROS");
      await cancelAtProvider(c, first.preapprovalId);
      const { attempt: second } = await buyWithCode(c, b, "PIONEROS");
      await authorize(c, second.preapprovalId);
      await recordPayment(c, second.preapprovalId, "approved");
      assert.equal((await confirm(c, second.preapprovalId)).status, "confirmed");

      // Abnormal ordering: A's payment is only recorded now (it happened before the cancellation).
      await recordPayment(c, first.preapprovalId, "approved");
      assert.equal((await confirm(c, first.preapprovalId)).status, "confirmed_over_limit");
      const s = await summary(c, "PIONEROS");
      assert.equal(s.over_limit, 1, "visible to the admin");
      await c.end();
    });

    await test("compatibilidad: porcentaje sin límite, monto fijo con límite, suscripción sin código y códigos ya confirmados", async () => {
      const { c } = await setup();
      await insertCode(c, "DESC20", { code_type: "discount_percent", discount_value: 20 });
      await insertCode(c, "MENOS5000", { code_type: "discount_fixed_amount", discount_value: 5000, max_uses: 2 });
      const u1 = await newUser(c);
      const u2 = await newUser(c);
      const u3 = await newUser(c);
      const p1 = (await buyWithCode(c, u1, "DESC20")).attempt;
      const p2 = (await buyWithCode(c, u2, "MENOS5000")).attempt;
      for (const p of [p1, p2]) {
        await authorize(c, p.preapprovalId);
        await recordPayment(c, p.preapprovalId, "approved");
        assert.equal((await confirm(c, p.preapprovalId)).status, "confirmed");
      }
      // Without a code: nothing to confirm, nothing changes.
      const plain = await checkout(c, u3, 19900);
      await authorize(c, plain.preapprovalId);
      await recordPayment(c, plain.preapprovalId, "approved");
      assert.equal((await confirm(c, plain.preapprovalId)).status, "none");
      // A reservation confirmed under the previous rule (authorization) stays confirmed: the migration moves no data.
      await insertCode(c, "HISTORICO", { code_type: "fixed_price", discount_value: 250, max_uses: 1 });
      const u4 = await newUser(c);
      const old = await buyWithCode(c, u4, "HISTORICO");
      await c.query(`update public.discount_code_reservations set status='confirmed', confirmed_at=now() where id=$1`, [old.reservation.reservation_id]);
      assert.equal((await confirm(c, old.attempt.preapprovalId)).status, "already_confirmed");
      assert.equal((await reserve(c, u4, "HISTORICO")).status, "already_used");
      await c.end();
    });

    await test("cambiar de código o quitarlo libera la reserva anterior sin consumirla", async () => {
      const { c } = await setup();
      await insertCode(c, "PIONEROS", { code_type: "fixed_price", discount_value: 9900, max_uses: 1 });
      await insertCode(c, "DESC10", { code_type: "discount_percent", discount_value: 10 });
      const a = await newUser(c);
      const b = await newUser(c);
      const r1 = await reserve(c, a, "PIONEROS");
      const att = await checkout(c, a, 9900);
      assert.equal(await attach(c, a, r1.reservation_id, att.attemptId), "attached");
      assert.equal((await reserve(c, b, "PIONEROS")).status, "exhausted");
      // The route cancels the pending preapproval at Mercado Pago and closes the attempt before the new code.
      await c.query(`select public.close_pending_checkout($1,$2)`, [a, att.attemptId]);
      assert.equal((await reserve(c, a, "DESC10")).status, "reserved");
      assert.equal((await reserve(c, b, "PIONEROS")).status, "reserved");
      assert.equal(await usedCount(c, "PIONEROS"), 0);
      await c.end();
    });

    await test("privilegios: las funciones nuevas son solo de service_role; la migration no toca filas existentes", async () => {
      const { c } = await setup();
      for (const fn of [
        "discount_preapproval_has_approved_payment(text)",
        "confirm_discount_reservation(text)",
        "discount_code_seat_summary()",
        "list_stale_discount_checkouts(integer,integer)",
      ]) {
        const row = (await c.query(
          `select has_function_privilege('authenticated', $1, 'execute') as auth, has_function_privilege('anon', $1, 'execute') as anon,
                  has_function_privilege('service_role', $1, 'execute') as svc`,
          [`public.${fn}`],
        )).rows[0];
        assert.deepEqual(row, { auth: false, anon: false, svc: true }, fn);
      }
      // Top level only: function bodies ($$ … $$, $tag$ … $tag$) keep the same lifecycle writes as before.
      const topLevel = firstPayment
        .replace(/--.*$/gm, "")
        .replace(/\$\$[\s\S]*?\$\$/g, "")
        .replace(/\$(\w+)\$[\s\S]*?\$\1\$/g, "");
      assert.doesNotMatch(topLevel, /\b(insert into|delete from|update public|truncate|drop table|alter table)\b/i, "no data or table changes");
      assert.match(topLevel, /create or replace function public\.confirm_discount_reservation/);
      // Re-running is safe.
      await c.query(firstPayment);
      await c.end();
    });
  } finally {
    await server.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (EmbeddedPostgres && pg) {
  await main();
} else {
  test("discount first-payment db tests (skipped: npm i --no-save embedded-postgres pg)", { skip: true }, () => {});
}
