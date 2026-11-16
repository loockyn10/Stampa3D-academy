// Cupos del código PIONEROS: se cuentan SOLO con el primer pago aprobado; sin reservas temporales de cupos
// (supabase/migrations/20261116120000_discount_seats_confirmed_only.sql) contra un PostgreSQL REAL embebido, descartable
// y local: nunca toca Supabase ni Mercado Pago. Opt-in como los otros *-db tests:
//
//   npm i --no-save embedded-postgres pg && node --test tests/discount-confirmed-only-db.test.mjs
//
// Se aplican las migrations reales de checkout_attempts y de descuentos (20261029, 20261030, 20261115 y la nueva).
// auth, roles, subscriptions, payments e invite_codes (no versionadas) son stubs con la forma usada por la app.
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

const PORT = Number(process.env.CONFIRMED_ONLY_TEST_PG_PORT) || 54343;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-confirmed-only-pg-"));
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
  const { freshDb, newUser, insertCode, reserve, usedCount, reservationRows, confirm, buyWithCode, connect } = db;

  let dbSeq = 0;
  async function setup() {
    dbSeq += 1;
    const name = `co_${dbSeq}`;
    const c = await freshDb(name, { discount: true, consistency: true });
    await c.query(PAYMENTS);
    await c.query(migrations.firstPayment);
    await c.query(migrations.confirmedOnly);
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
  const pay = async (c, attempt, n = 1) => {
    await authorize(c, attempt.preapprovalId);
    await recordPayment(c, attempt.preapprovalId, "approved", n);
  };
  const summary = async (c, code) =>
    (await c.query(`select * from public.discount_code_seat_summary() where code=$1`, [code])).rows[0];
  const seatsLeft = async (c, code) => (await summary(c, code)).available;
  const promo = (c, max = 20) =>
    insertCode(c, "PIONEROS", { code_type: "fixed_price", discount_value: 9900, max_uses: max });

  try {
    await test("introducir el código, iniciar checkout, autorizar o tener un pago pendiente NO reducen los cupos disponibles", async () => {
      const { c } = await setup();
      await promo(c, 20);
      const users = [];
      for (let i = 0; i < 25; i += 1) users.push(await newUser(c));

      // Typing the code (dry-run preview) many times: nothing is held.
      for (const u of users) assert.equal((await reserve(c, u, "PIONEROS", { dryRun: true })).status, "ok");
      assert.equal(await seatsLeft(c, "PIONEROS"), 20);

      // 25 people start the checkout (more than the 20 seats): all of them are served and none holds a seat.
      const attempts = [];
      for (const u of users) {
        const { reservation, attempt } = await buyWithCode(c, u, "PIONEROS");
        assert.equal(reservation.status, "reserved");
        attempts.push(attempt);
      }
      assert.equal(await seatsLeft(c, "PIONEROS"), 20);

      // Some authorize (card accepted) and one has its first payment pending / rejected: still nothing consumed.
      for (const a of attempts.slice(0, 5)) await authorize(c, a.preapprovalId);
      await recordPayment(c, attempts[0].preapprovalId, "pending");
      await recordPayment(c, attempts[1].preapprovalId, "rejected");
      assert.equal((await confirm(c, attempts[0].preapprovalId)).status, "awaiting_payment");
      assert.equal((await confirm(c, attempts[1].preapprovalId)).status, "awaiting_payment");
      assert.equal(await usedCount(c, "PIONEROS"), 0);
      const s = await summary(c, "PIONEROS");
      assert.deepEqual([s.confirmed, s.available, s.over_limit], [0, 20, 0]);
      assert.equal(s.in_flight, 25, "informational only");
      assert.equal(s.in_flight_authorized, 5);
      await c.end();
    });

    await test("abandonados y cancelados no consumen; la liberación no cambia los cupos disponibles", async () => {
      const { c } = await setup();
      await promo(c, 2);
      const a = await newUser(c);
      const b = await newUser(c);
      const { attempt: aa } = await buyWithCode(c, a, "PIONEROS");
      const { attempt: ab } = await buyWithCode(c, b, "PIONEROS");
      assert.equal(await seatsLeft(c, "PIONEROS"), 2);
      await cancelAtProvider(c, aa.preapprovalId);
      await authorize(c, ab.preapprovalId);
      await recordPayment(c, ab.preapprovalId, "rejected");
      await cancelAtProvider(c, ab.preapprovalId);
      assert.equal(await usedCount(c, "PIONEROS"), 0);
      assert.equal(await seatsLeft(c, "PIONEROS"), 2);
      await c.end();
    });

    await test("primer pago aprobado: cuenta una sola vez; renovaciones y webhooks duplicados o tardíos no suman", async () => {
      const { c } = await setup();
      await promo(c, 20);
      const a = await newUser(c);
      const { attempt } = await buyWithCode(c, a, "PIONEROS");
      await authorize(c, attempt.preapprovalId);
      await recordPayment(c, attempt.preapprovalId, "rejected");
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "awaiting_payment");
      await recordPayment(c, attempt.preapprovalId, "approved");

      const first = await confirm(c, attempt.preapprovalId);
      assert.equal(first.status, "confirmed");
      assert.equal(Number(first.final_amount), 9900);
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "already_confirmed");
      await recordPayment(c, attempt.preapprovalId, "approved", 2); // renewal
      await recordPayment(c, attempt.preapprovalId, "approved", 3);
      assert.equal((await confirm(c, attempt.preapprovalId)).status, "already_confirmed");
      assert.equal(await usedCount(c, "PIONEROS"), 1);
      assert.equal((await c.query(`select count(*)::int n from public.invite_code_redemptions`)).rows[0].n, 1);
      const s = await summary(c, "PIONEROS");
      assert.deepEqual([s.confirmed, s.available, s.over_limit], [1, 19, 0]);
      await c.end();
    });

    await test("20 pagos aprobados: el código deja de ofrecerse (vista previa y checkout nuevo); ninguno pasa el límite", async () => {
      const { c } = await setup();
      await promo(c, 20);
      const buyers = [];
      for (let i = 0; i < 20; i += 1) buyers.push((await buyWithCode(c, await newUser(c), "PIONEROS")).attempt);
      for (const a of buyers) await pay(c, a);

      // Webhooks of the 20 first payments at the same time, each one twice, on separate connections.
      const conns = await Promise.all(Array.from({ length: 10 }, () => connect(c.database)));
      const results = await Promise.all(
        [...buyers, ...buyers].map((a, i) =>
          conns[i % conns.length].query(`select public.confirm_discount_reservation($1) as r`, [a.preapprovalId]).then((r) => r.rows[0].r.status),
        ),
      );
      await Promise.all(conns.map((x) => x.end()));
      assert.equal(results.filter((s) => s === "confirmed").length, 20);
      assert.equal(results.filter((s) => s === "already_confirmed").length, 20);
      assert.equal(results.filter((s) => s === "confirmed_over_limit").length, 0);

      const late = await newUser(c);
      assert.equal((await reserve(c, late, "PIONEROS", { dryRun: true })).status, "exhausted");
      assert.equal((await reserve(c, late, "PIONEROS")).status, "exhausted");
      assert.equal(await usedCount(c, "PIONEROS"), 20);
      const s = await summary(c, "PIONEROS");
      assert.deepEqual([s.confirmed, s.available, s.over_limit], [20, 0, 0]);
      await c.end();
    });

    await test("el último cupo con varios pagos simultáneos: todos los que pagaron quedan honrados, ninguno se rechaza y el exceso queda visible", async () => {
      const { c, name } = await setup();
      await promo(c, 20);
      for (let i = 0; i < 19; i += 1) {
        const { attempt } = await buyWithCode(c, await newUser(c), "PIONEROS");
        await pay(c, attempt);
        assert.equal((await confirm(c, attempt.preapprovalId)).status, "confirmed");
      }
      assert.equal(await seatsLeft(c, "PIONEROS"), 1);

      // Three people started their checkout while a seat was still available; all three get charged by Mercado Pago.
      const racers = [];
      for (let i = 0; i < 3; i += 1) {
        const uid = await newUser(c);
        racers.push({ uid, attempt: (await buyWithCode(c, uid, "PIONEROS")).attempt });
      }
      for (const r of racers) await pay(c, r.attempt);

      const conns = await Promise.all(racers.map(() => connect(name)));
      const statuses = await Promise.all(
        racers.map((r, i) => conns[i].query(`select public.confirm_discount_reservation($1) as r`, [r.attempt.preapprovalId]).then((x) => x.rows[0].r.status)),
      );
      await Promise.all(conns.map((x) => x.end()));

      // Exactly one takes the last seat inside the limit; the other two are honoured and flagged. Nobody is refused.
      assert.deepEqual(statuses.slice().sort(), ["confirmed", "confirmed_over_limit", "confirmed_over_limit"]);
      for (const r of racers) {
        const row = (await reservationRows(c, r.uid))[0];
        assert.equal(row.status, "confirmed");
        assert.equal(Number(row.final_amount), 9900, "the contracted price is kept");
      }
      assert.equal((await c.query(`select count(*)::int n from public.invite_code_redemptions`)).rows[0].n, 22);
      const s = await summary(c, "PIONEROS");
      assert.deepEqual([s.confirmed, s.available, s.over_limit], [22, 0, 2]);
      // Late / duplicated notifications of the same payers change nothing.
      for (const r of racers) assert.equal((await confirm(c, r.attempt.preapprovalId)).status, "already_confirmed");
      assert.equal(await usedCount(c, "PIONEROS"), 22);
      assert.equal((await reserve(c, await newUser(c), "PIONEROS")).status, "exhausted");
      await c.end();
    });

    await test("pago aprobado de un checkout cuya reserva ya fue liberada: se honra siempre (sobre el límite si el código está lleno)", async () => {
      const { c } = await setup();
      await promo(c, 1);
      const a = await newUser(c);
      const b = await newUser(c);
      const { attempt: first } = await buyWithCode(c, a, "PIONEROS");
      const { attempt: second } = await buyWithCode(c, b, "PIONEROS");
      await pay(c, second);
      assert.equal((await confirm(c, second.preapprovalId)).status, "confirmed");
      assert.equal((await reserve(c, await newUser(c), "PIONEROS")).status, "exhausted", "the code is no longer offered");

      // A was charged before its checkout was cancelled: the reservation is already released when the payment arrives.
      await cancelAtProvider(c, first.preapprovalId);
      assert.equal((await reservationRows(c, a))[0].status, "released");
      await recordPayment(c, first.preapprovalId, "approved");
      assert.equal((await confirm(c, first.preapprovalId)).status, "confirmed_over_limit");
      assert.equal((await reservationRows(c, a))[0].status, "confirmed");
      const s = await summary(c, "PIONEROS");
      assert.deepEqual([s.confirmed, s.available, s.over_limit], [2, 0, 1]);
      await c.end();
    });

    await test("cambiar de código o quitarlo no consume ni reduce cupos", async () => {
      const { c } = await setup();
      await promo(c, 1);
      await insertCode(c, "DESC10", { code_type: "discount_percent", discount_value: 10 });
      const a = await newUser(c);
      const r1 = await reserve(c, a, "PIONEROS");
      assert.equal(r1.status, "reserved");
      assert.equal(await seatsLeft(c, "PIONEROS"), 1);
      assert.equal((await reserve(c, a, "DESC10")).status, "reserved");
      assert.equal(await seatsLeft(c, "PIONEROS"), 1);
      assert.equal(await usedCount(c, "PIONEROS"), 0);
      await c.end();
    });

    await test("compatibilidad: códigos sin límite, suscripción sin código y usos confirmados por la regla anterior", async () => {
      const { c } = await setup();
      await insertCode(c, "DESC20", { code_type: "discount_percent", discount_value: 20 });
      const u1 = await newUser(c);
      const u2 = await newUser(c);
      const p1 = (await buyWithCode(c, u1, "DESC20")).attempt;
      await pay(c, p1);
      assert.equal((await confirm(c, p1.preapprovalId)).status, "confirmed");
      const s = await summary(c, "DESC20");
      assert.deepEqual([s.confirmed, s.available, s.over_limit], [1, null, 0]);

      // A subscription without code has nothing to confirm.
      const plain = await db.checkout(c, u2, 19900);
      await pay(c, plain);
      assert.equal((await confirm(c, plain.preapprovalId)).status, "none");

      // A use confirmed under a previous rule stays confirmed (the migration moves no data).
      await insertCode(c, "HISTORICO", { code_type: "fixed_price", discount_value: 250, max_uses: 1 });
      const u3 = await newUser(c);
      const old = await buyWithCode(c, u3, "HISTORICO");
      await c.query(`update public.discount_code_reservations set status='confirmed', confirmed_at=now() where id=$1`, [old.reservation.reservation_id]);
      await c.query(`update public.invite_codes set used_count = 1 where code='HISTORICO'`);
      assert.equal((await confirm(c, old.attempt.preapprovalId)).status, "already_confirmed");
      assert.equal((await reserve(c, u3, "HISTORICO")).status, "already_used");
      assert.equal((await reserve(c, await newUser(c), "HISTORICO")).status, "exhausted");
      await c.end();
    });

    await test("privilegios, sin cambios de datos y re-ejecutable", async () => {
      const { c } = await setup();
      for (const fn of ["reserve_discount_code(uuid,text,numeric,text,boolean,integer)", "confirm_discount_reservation(text)", "discount_code_seat_summary()"]) {
        const row = (await c.query(
          `select has_function_privilege('authenticated', $1, 'execute') as auth, has_function_privilege('anon', $1, 'execute') as anon,
                  has_function_privilege('service_role', $1, 'execute') as svc`,
          [`public.${fn}`],
        )).rows[0];
        assert.deepEqual(row, { auth: false, anon: false, svc: true }, fn);
      }
      const sql = read("supabase/migrations/20261116120000_discount_seats_confirmed_only.sql");
      const topLevel = sql
        .replace(/--.*$/gm, "")
        .replace(/\$\$[\s\S]*?\$\$/g, "")
        .replace(/\$(\w+)\$[\s\S]*?\$\1\$/g, "");
      assert.doesNotMatch(topLevel, /\b(insert into|delete from|update public|truncate|drop table|alter table)\b/i, "no data or table changes");
      // The capacity of the code no longer adds reservations: the only counters are used_count and the redemptions.
      const reserveBody = sql.slice(sql.indexOf("create or replace function public.reserve_discount_code"), sql.indexOf("create or replace function public.confirm_discount_reservation"));
      assert.doesNotMatch(reserveBody.replace(/--.*$/gm, ""), /user_id <> p_user_id/);
      await c.query(sql);
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
  test("discount confirmed-only db tests (skipped: npm i --no-save embedded-postgres pg)", { skip: true }, () => {});
}
