// Comportamiento REAL en PostgreSQL de supabase/migrations/20261111120000_pioneer_edition.sql (M1, Edición Pioneros).
// Postgres embebido, descartable y local: NUNCA toca Supabase ni Mercado Pago. Opt-in, como los otros *-db tests:
//
//   npm i --no-save embedded-postgres pg && node --test tests/pioneer-seats-db.test.mjs
//
// La concurrencia se prueba con conexiones reales simultáneas (una por "comprador"); los mocks no sirven para
// validar atomicidad. Se aplica la migration real de checkout_attempts; auth, roles, subscriptions, payments y
// founder_members (no versionadas en el repo) son stubs con la forma observada en M0. Todos los datos son ficticios.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireEmbeddedPgLock } from "./helpers/embedded-pg-lock.mjs";
import { migrations, stub } from "./helpers/discount-db-fixtures.mjs";

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  ({ default: pg } = await import("pg"));
} catch {
  // optional dev tooling not installed
}

const pioneerMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261111120000_pioneer_edition.sql"), "utf8");
const PORT = Number(process.env.PIONEER_TEST_PG_PORT) || 54377;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-pioneer-pg-"));
const mk = (database = "postgres") => new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database });

// Piezas de Supabase / legado que M1 solo lee. Forma tomada del diagnóstico M0.
const extras = `
create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.payments (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id),
  subscription_id uuid references public.subscriptions(id), mercado_pago_preapproval_id text,
  mercado_pago_payment_id text, status text, amount numeric, currency text, paid_at timestamptz, raw_data jsonb,
  created_at timestamptz default now());
create table public.founder_members (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  founder_number integer, status text not null default 'active', created_at timestamptz default now());
create unique index founder_members_user_unique_idx on public.founder_members (user_id);
create table public.founder_pricing_tiers (id uuid primary key default gen_random_uuid(), from_number integer, to_number integer, price numeric);
insert into public.founder_pricing_tiers (from_number, to_number, price) values (1, 25, 9900), (26, 50, 14900);
`;
const stateDiagnostic = fs.readFileSync(path.join(process.cwd(), "supabase/diagnostics/20261111_pioneer_m1_state.sql"), "utf8");
const postCheck = fs.readFileSync(path.join(process.cwd(), "supabase/diagnostics/20261111_pioneer_m1_postcheck.sql"), "utf8");
const compatCheck = fs.readFileSync(path.join(process.cwd(), "supabase/diagnostics/20261111_pioneer_m1_compat.sql"), "utf8");
const dataShape = fs.readFileSync(path.join(process.cwd(), "supabase/diagnostics/20261111_pioneer_m1_data_shape.sql"), "utf8");
async function readOnly(c, text) {
  await c.query("begin read only");
  try {
    return (await c.query(text)).rows;
  } finally {
    await c.query("rollback");
  }
}

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

async function createDb(name) {
  const admin = mk();
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
  await admin.end();
  const c = mk(name);
  await c.connect();
  await c.query(stub);
  await c.query(extras);
  await c.query(migrations.checkout);
  return c;
}

/** Base lista: migration aplicada, edición habilitada con términos 'v1'. */
async function freshDb(name, { enable = true } = {}) {
  const c = await createDb(name);
  await c.query(pioneerMigration);
  if (enable) await c.query(`update public.pioneer_edition set enabled = true, terms_version = 'v1' where id = 'default'`);
  return c;
}

const connect = async (database) => {
  const x = mk(database);
  await x.connect();
  return x;
};
const newUser = async (c) => (await c.query(`insert into auth.users (email) values ($1) returning id`, [`u${Math.random()}@x.test`])).rows[0].id;
const REGULAR = 19900;
const PROMO = 9900;
const reserve = async (c, uid, { regular = REGULAR, currency = "ARS", terms = "v1" } = {}) =>
  (await c.query(`select public.reserve_pioneer_seat($1,$2,$3,$4) as r`, [uid, regular, currency, terms])).rows[0].r;
const sync = async (c, preapprovalId, providerStatus = null) =>
  (await c.query(`select public.sync_pioneer_seat($1,$2) as r`, [preapprovalId, providerStatus])).rows[0].r;
const state = async (c) => (await c.query(`select public.pioneer_offer_state() as r`)).rows[0].r;
const seatOf = async (c, uid) => (await c.query(`select * from public.pioneer_members where user_id=$1 order by created_at desc limit 1`, [uid])).rows[0];
const events = async (c, seatId) => (await c.query(`select event from public.pioneer_seat_events where seat_id=$1 order by id`, [seatId])).rows.map((r) => r.event);

let seq = 0;
async function checkout(c, uid, amount, { subscriptionStatus = "pending" } = {}) {
  seq += 1;
  const key = `70000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const begin = (await c.query(`select public.begin_membership_checkout($1,$2,$3,'ARS','p@x.test','Membresía','https://x.test/back') as r`, [uid, key, amount])).rows[0].r;
  assert.equal(begin.action, "call_provider", JSON.stringify(begin));
  const preapproval = `pre_${seq}_${Math.random().toString(36).slice(2, 8)}`;
  await c.query(`select public.complete_membership_checkout($1,$2,$3,'https://mp.test/init','pending','{}'::jsonb)`, [begin.attempt_id, begin.claim_token, preapproval]);
  if (subscriptionStatus !== "pending") await c.query(`update public.subscriptions set status=$2 where mercado_pago_preapproval_id=$1`, [preapproval, subscriptionStatus]);
  return { attemptId: begin.attempt_id, preapprovalId: preapproval };
}

/** reservar + checkout al monto bloqueado + vincular: lo que hace la ruta para un comprador. */
async function buy(c, uid, opts = {}) {
  const r = await reserve(c, uid, opts);
  assert.equal(r.status, "reserved", JSON.stringify(r));
  const attempt = await checkout(c, uid, Number(r.locked_price));
  const attached = (await c.query(`select public.attach_pioneer_seat($1,$2,$3) as r`, [uid, r.seat_id, attempt.attemptId])).rows[0].r;
  assert.equal(attached.status, "attached", JSON.stringify(attached));
  return { seatId: r.seat_id, number: r.pioneer_number, ...attempt };
}

let paySeq = 0;
async function pay(c, preapprovalId, { status = "approved", amount = PROMO, currency = "ARS" } = {}) {
  paySeq += 1;
  const sub = (await c.query(`select id, user_id from public.subscriptions where mercado_pago_preapproval_id=$1`, [preapprovalId])).rows[0];
  return (await c.query(
    `insert into public.payments (user_id, subscription_id, mercado_pago_preapproval_id, mercado_pago_payment_id, status, amount, currency, paid_at)
     values ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8)) returning id`,
    [sub.user_id, sub.id, preapprovalId, `mp_${paySeq}`, status, amount, currency, paySeq],
  )).rows[0].id;
}

/** Una persona con lugar ACTIVO (reservado, vinculado y con el primer pago aprobado verificado). */
async function activePioneer(c) {
  const uid = await newUser(c);
  const bought = await buy(c, uid);
  await pay(c, bought.preapprovalId);
  const synced = await sync(c, bought.preapprovalId, "authorized");
  assert.equal(synced.status, "active", JSON.stringify(synced));
  return { uid, ...bought };
}

const hashOf = async (c, table) =>
  (await c.query(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h, count(*)::int n from public.${table} t`)).rows[0];

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  const open = [];
  const track = (client) => (open.push(client), client);
  try {
    // =====================================================================================================
    // Migration: precondiciones, idempotencia y Fundadores intactos
    // =====================================================================================================
    await test("la migration aborta sin cambiar nada si falta una dependencia o una columna", async () => {
      const c = await createDb("pi_nodep");
      await c.query(`drop table public.founder_members`);
      await assert.rejects(c.query(pioneerMigration), /Missing dependency/);
      assert.equal((await c.query(`select to_regclass('public.pioneer_members') as t`)).rows[0].t, null);
      assert.equal((await c.query(`select to_regclass('public.pioneer_edition') as t`)).rows[0].t, null);
      await c.end();

      const d = await createDb("pi_badshape");
      await d.query(`alter table public.payments drop column paid_at`);
      await assert.rejects(d.query(pioneerMigration), /Missing expected columns: payments\.paid_at/);
      assert.equal((await d.query(`select to_regclass('public.pioneer_members') as t`)).rows[0].t, null);
      await d.end();
    });

    await test("la migration se puede re-ejecutar y deja una sola fila de configuración, apagada y sin términos", async () => {
      const c = await createDb("pi_rerun");
      await c.query(pioneerMigration);
      await c.query(pioneerMigration);
      const ed = (await c.query(`select * from public.pioneer_edition`)).rows;
      assert.equal(ed.length, 1);
      assert.equal(ed[0].enabled, false);
      assert.equal(ed[0].terms_version, null);
      assert.deepEqual(ed[0].early_access_features, []);
      assert.equal(Number(ed[0].promo_price), 9900);
      assert.equal(ed[0].capacity, 20);
      assert.equal(ed[0].price_cycles, 6);
      // Encender sin términos aprobados lo impide la base.
      await assert.rejects(c.query(`update public.pioneer_edition set enabled = true`), /pioneer_edition_enabled_needs_terms/);
      // Mientras esté apagada, nadie reserva.
      const u = await newUser(c);
      assert.equal((await reserve(c, u)).status, "disabled");
      assert.equal((await state(c)).enabled, false);
      await c.end();
    });

    await test("Fundadores: aplicar la migration y operar no cambia ni un byte de founder_members ni de las tablas existentes", async () => {
      const c = await createDb("pi_founders");
      const founders = [await newUser(c), await newUser(c), await newUser(c)];
      for (const [i, uid] of founders.entries()) {
        await c.query(`insert into public.founder_members (user_id, founder_number, status) values ($1,$2,'active')`, [uid, i + 1]);
      }
      // Una suscripción de prueba interna de $250 y una persona con cobro real: referencias de "tablas existentes".
      const internal = await newUser(c);
      const t250 = await checkout(c, internal, 250, { subscriptionStatus: "authorized" });
      await pay(c, t250.preapprovalId, { amount: 250 });

      const snapshot = async () => ({
        founders: await hashOf(c, "founder_members"),
        subscriptions: await hashOf(c, "subscriptions"),
        payments: await hashOf(c, "payments"),
        attempts: await hashOf(c, "checkout_attempts"),
        founderAcl: (await c.query(`select relacl::text a from pg_class where oid='public.founder_members'::regclass`)).rows[0].a,
        founderTriggers: (await c.query(`select count(*)::int n from pg_trigger where tgrelid='public.founder_members'::regclass and not tgisinternal`)).rows[0].n,
        founderIndexes: (await c.query(`select string_agg(indexdef, '|' order by indexname) d from pg_indexes where tablename='founder_members'`)).rows[0].d,
        founderPolicies: (await c.query(`select count(*)::int n from pg_policies where tablename='founder_members'`)).rows[0].n,
      });

      const before = await snapshot();
      await c.query(pioneerMigration);
      assert.deepEqual(await snapshot(), before, "aplicar M1 no toca nada existente");

      await c.query(`update public.pioneer_edition set enabled = true, terms_version = 'v1'`);
      for (const uid of founders) assert.equal((await reserve(c, uid)).status, "founder_excluded");
      assert.equal((await reserve(c, internal)).status, "not_eligible", "la cuenta de prueba interna no recibe cupo");
      const normal = await activePioneer(c);
      assert.ok(normal.number >= 1);
      assert.equal((await state(c)).held + (await state(c)).active, 1, "los fundadores no consumieron cupos");
      assert.equal((await c.query(`select count(*)::int n from public.pioneer_members where user_id = any($1)`, [founders])).rows[0].n, 0);

      const after = await snapshot();
      assert.equal(after.founders.h, before.founders.h, "founder_members idéntico");
      assert.equal(after.founderAcl, before.founderAcl);
      assert.equal(after.founderTriggers, before.founderTriggers);
      assert.equal(after.founderIndexes, before.founderIndexes);
      assert.equal(after.founderPolicies, before.founderPolicies);
      assert.equal(after.subscriptions.n, before.subscriptions.n + 1, "solo creó la suscripción de prueba del comprador nuevo (checkout)");
      assert.equal(Number((await c.query(`select amount from public.subscriptions where mercado_pago_preapproval_id=$1`, [t250.preapprovalId])).rows[0].amount), 250, "la suscripción de $250 no cambió");
      await c.end();
    });

    // =====================================================================================================
    // Reservas, capacidad y concurrencia
    // =====================================================================================================
    await test("validaciones de la oferta: moneda, términos y precio sin beneficio", async () => {
      const c = await freshDb("pi_validation");
      const u = await newUser(c);
      assert.equal((await reserve(c, u, { currency: "USD" })).status, "currency_mismatch");
      assert.equal((await reserve(c, u, { terms: "v0" })).status, "terms_mismatch");
      assert.equal((await reserve(c, u, { regular: 9900 })).status, "no_benefit");
      assert.equal((await reserve(c, u, { regular: 5000 })).status, "no_benefit");
      await assert.rejects(reserve(c, u, { regular: 0 }), /greater than zero/);
      await assert.rejects(reserve(c, u, { currency: "ars" }), /ISO-style/);
      assert.equal((await c.query(`select count(*)::int n from public.pioneer_members`)).rows[0].n, 0);
      await c.end();
    });

    await test("reservar es idempotente para la misma persona y guarda el precio bloqueado, no el que venga después", async () => {
      const c = await freshDb("pi_idem");
      const u = await newUser(c);
      const a = await reserve(c, u);
      const b = await reserve(c, u);
      assert.equal(a.status, "reserved");
      assert.equal(a.reused, false);
      assert.equal(b.reused, true);
      assert.equal(a.seat_id, b.seat_id);
      assert.equal(a.pioneer_number, 1);
      assert.equal(Number(a.locked_price), 9900);
      assert.equal(a.locked_cycles, 6);
      assert.equal((await c.query(`select count(*)::int n from public.pioneer_members`)).rows[0].n, 1);
      // El precio regular aceptado queda registrado.
      assert.equal(Number((await seatOf(c, u)).accepted_regular_price), REGULAR);

      // Con checkout en curso, un cambio de condiciones no reemplaza el lugar.
      const bought = await checkout(c, u, 9900);
      await c.query(`select public.attach_pioneer_seat($1,$2,$3)`, [u, a.seat_id, bought.attemptId]);
      assert.equal((await reserve(c, u, { regular: 24900 })).status, "checkout_in_progress");
      assert.equal(Number((await seatOf(c, u)).accepted_regular_price), REGULAR);
      await c.end();
    });

    await test("el límite es 20: 25 compradores secuenciales, 20 con número 1..20 y 5 agotados", async () => {
      const c = await freshDb("pi_limit");
      const results = [];
      for (let i = 0; i < 25; i += 1) results.push(await reserve(c, await newUser(c)));
      const reserved = results.filter((r) => r.status === "reserved");
      assert.equal(reserved.length, 20);
      assert.equal(results.filter((r) => r.status === "sold_out").length, 5);
      assert.deepEqual(reserved.map((r) => r.pioneer_number).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
      const s = await state(c);
      assert.equal(s.available, 0);
      assert.equal(s.held, 20);
      await c.end();
    });

    await test("CONCURRENCIA: 40 compradores simultáneos con conexiones reales -> exactamente 20 lugares, sin números repetidos", async () => {
      const name = "pi_race";
      const c = await freshDb(name);
      const users = [];
      for (let i = 0; i < 40; i += 1) users.push(await newUser(c));
      const clients = await Promise.all(users.map(() => connect(name).then(track)));
      const results = await Promise.all(users.map((uid, i) => reserve(clients[i], uid)));
      await Promise.all(clients.map((x) => x.end()));

      assert.equal(results.filter((r) => r.status === "reserved").length, 20);
      assert.equal(results.filter((r) => r.status === "sold_out").length, 20);
      const rows = (await c.query(`select pioneer_number from public.pioneer_members where status in ('reserved','active') order by 1`)).rows;
      assert.deepEqual(rows.map((r) => r.pioneer_number), Array.from({ length: 20 }, (_, i) => i + 1));
      assert.equal((await c.query(`select count(*)::int n from public.pioneer_members`)).rows[0].n, 20, "los agotados no dejan filas");
      await c.end();
    });

    await test("CONCURRENCIA: la misma persona reservando 12 veces a la vez ocupa un solo lugar", async () => {
      const name = "pi_race_same";
      const c = await freshDb(name);
      const u = await newUser(c);
      const clients = await Promise.all(Array.from({ length: 12 }, () => connect(name).then(track)));
      const results = await Promise.all(clients.map((x) => reserve(x, u)));
      await Promise.all(clients.map((x) => x.end()));
      assert.equal(new Set(results.map((r) => r.seat_id)).size, 1);
      assert.equal(results.filter((r) => r.reused === false).length, 1);
      assert.equal((await c.query(`select count(*)::int n from public.pioneer_members`)).rows[0].n, 1);
      await c.end();
    });

    await test("CONCURRENCIA: reservas, liberaciones y confirmaciones mezcladas nunca superan la capacidad configurada", async () => {
      const name = "pi_race_mix";
      const c = await freshDb(name);
      await c.query(`update public.pioneer_edition set capacity = 5`);
      const users = [];
      for (let i = 0; i < 30; i += 1) users.push(await newUser(c));
      const clients = await Promise.all(users.map(() => connect(name).then(track)));
      // Ronda 1: todos reservan; los que obtuvieron lugar, liberan la mitad mientras otros reservan.
      const first = await Promise.all(users.map((uid, i) => reserve(clients[i], uid)));
      const winners = first.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "reserved");
      assert.equal(winners.length, 5);
      await Promise.all([
        ...winners.slice(0, 3).map(({ r, i }) => clients[i].query(`select public.release_pioneer_seat($1,'checkout_abandoned',$2)`, [r.seat_id, users[i]])),
        ...users.slice(5).map((uid, k) => reserve(clients[k + 5], uid)),
      ]);
      const occupied = (await c.query(`select count(*)::int n, count(distinct pioneer_number)::int d from public.pioneer_members where status in ('reserved','active')`)).rows[0];
      assert.ok(occupied.n <= 5, `ocupados ${occupied.n}`);
      assert.equal(occupied.n, occupied.d);
      await Promise.all(clients.map((x) => x.end()));
      await c.end();
    });

    await test("integridad en la base: ni un superusuario puede crear el lugar 21, repetir un número ocupado o insertar un lugar ya activo", async () => {
      const c = await freshDb("pi_integrity");
      const u1 = await newUser(c);
      const u2 = await newUser(c);
      const r = await reserve(c, u1);
      const insert = (uid, number, status = "reserved") =>
        c.query(
          `insert into public.pioneer_members (user_id, pioneer_number, status, currency, locked_price, locked_cycles, accepted_regular_price, accepted_terms_version, reservation_expires_at)
           values ($1,$2,$3,'ARS',9900,6,19900,'v1', now() + interval '1 hour')`,
          [uid, number, status],
        );
      await assert.rejects(insert(u2, 21), /pioneer_members_number_check/);
      await assert.rejects(insert(u2, 0), /pioneer_members_number_check/);
      await assert.rejects(insert(u2, r.pioneer_number), /pioneer_members_number_occupied_idx/);
      await assert.rejects(insert(u1, 7), /pioneer_members_user_occupied_idx/);
      await assert.rejects(insert(u2, 9, "active"), /can only be created as reserved/);
      await c.end();
    });

    await test("la oferta pública solo expone agregados y la capacidad no se puede cambiar con lugares existentes", async () => {
      const c = await freshDb("pi_state");
      const u = await newUser(c);
      await reserve(c, u);
      const s = await state(c);
      assert.deepEqual(Object.keys(s).sort(), ["active", "available", "capacity", "currency", "enabled", "held", "held_expired", "hold_minutes", "price_cycles", "promo_price", "terms_version"]);
      assert.equal(s.available, 19);
      await assert.rejects(c.query(`update public.pioneer_edition set capacity = 30`), /capacity_check|cannot change/);
      await assert.rejects(c.query(`update public.pioneer_edition set capacity = 10`), /cannot change while there are/);
      await assert.rejects(c.query(`update public.pioneer_edition set promo_price = 100`), /cannot change while there are/);
      await assert.rejects(c.query(`update public.pioneer_edition set price_cycles = 3`), /cannot change while there are/);
      await assert.rejects(c.query(`delete from public.pioneer_edition`), /cannot be deleted/);
      await c.query(`update public.pioneer_edition set hold_minutes = 90, early_access_features = '{beta_tool}'`);
      await c.end();
    });

    await test("elegibilidad: quien ya pagó o tiene una suscripción viva queda fuera; un checkout pendiente abandonado no", async () => {
      const c = await freshDb("pi_eligibility");
      const paid = await newUser(c);
      const paidCheckout = await checkout(c, paid, 19900, { subscriptionStatus: "pending" });
      await pay(c, paidCheckout.preapprovalId, { amount: 19900 });
      assert.equal((await reserve(c, paid)).status, "not_eligible");

      const live = await newUser(c);
      await checkout(c, live, 250, { subscriptionStatus: "authorized" });
      assert.equal((await reserve(c, live)).status, "not_eligible");

      const pending = await newUser(c);
      await checkout(c, pending, 19900, { subscriptionStatus: "pending" });
      assert.equal((await reserve(c, pending)).status, "reserved");
      await c.end();
    });

    // =====================================================================================================
    // Vinculación y confirmación: solo con el primer pago aprobado verificado en payments
    // =====================================================================================================
    await test("attach: el intento debe ser de la persona y llevar exactamente el precio bloqueado", async () => {
      const c = await freshDb("pi_attach");
      const u = await newUser(c);
      const other = await newUser(c);
      const r = await reserve(c, u);
      const at = (uid, seat, attempt) => c.query(`select public.attach_pioneer_seat($1,$2,$3) as r`, [uid, seat, attempt]).then((x) => x.rows[0].r.status);

      const regular = await checkout(c, u, 19900);
      assert.equal(await at(u, r.seat_id, regular.attemptId), "amount_mismatch", "un checkout a precio regular no sirve para el cupo");
      await c.query(`update public.checkout_attempts set state='closed', closed_at=now() where id=$1`, [regular.attemptId]);
      await c.query(`update public.subscriptions set status='cancelled' where mercado_pago_preapproval_id=$1`, [regular.preapprovalId]);

      const promo = await checkout(c, u, 9900);
      assert.equal(await at(other, r.seat_id, promo.attemptId), "not_found", "otra persona no puede vincular mi lugar");
      assert.equal(await at(u, r.seat_id, promo.attemptId), "attached");
      assert.equal(await at(u, r.seat_id, promo.attemptId), "attached", "idempotente");
      const seat = await seatOf(c, u);
      assert.equal(seat.mercado_pago_preapproval_id, promo.preapprovalId);
      assert.equal(seat.status, "reserved", "vincular no confirma");
      await c.end();
    });

    await test("NO se confirma sin un pago aprobado verificado: ni con la suscripción autorizada, ni con pagos pendientes o rechazados", async () => {
      const c = await freshDb("pi_noconfirm");
      const u = await newUser(c);
      const bought = await buy(c, u);

      let r = await sync(c, bought.preapprovalId, "authorized");
      assert.equal(r.status, "reserved");
      assert.equal(r.event, "hold_extended", "autorizada sin pago: se retiene, no se confirma");
      await pay(c, bought.preapprovalId, { status: "pending" });
      await pay(c, bought.preapprovalId, { status: "rejected" });
      await pay(c, bought.preapprovalId, { status: "in_process" });
      r = await sync(c, bought.preapprovalId, "authorized");
      assert.equal(r.status, "reserved");
      assert.equal((await seatOf(c, u)).confirmed_at, null);
      assert.equal(await sync(c, "pre_desconocido", "authorized").then((x) => x.status), "none");
      await c.end();
    });

    await test("un pago aprobado con otro importe (precio regular, $250, otra moneda) o de otra persona no confirma el lugar", async () => {
      const c = await freshDb("pi_wrongpay");
      const u = await newUser(c);
      const bought = await buy(c, u);
      await pay(c, bought.preapprovalId, { amount: 19900 });
      await pay(c, bought.preapprovalId, { amount: 250 });
      await pay(c, bought.preapprovalId, { amount: PROMO, currency: "USD" });
      const r = await sync(c, bought.preapprovalId, "authorized");
      assert.equal(r.status, "reserved");
      assert.equal(r.approved_other_amount, 3, "se informan para revisión humana");

      // Un pago aprobado al precio correcto pero asociado a OTRA persona tampoco cuenta.
      const stranger = await newUser(c);
      const sub = (await c.query(`select id from public.subscriptions where mercado_pago_preapproval_id=$1`, [bought.preapprovalId])).rows[0];
      await c.query(`insert into public.payments (user_id, subscription_id, status, amount, currency, paid_at) values ($1,$2,'approved',9900,'ARS',now())`, [stranger, sub.id]);
      assert.equal((await sync(c, bought.preapprovalId, "authorized")).status, "reserved");
      await c.end();
    });

    await test("el primer pago aprobado confirma el lugar: queda activo, con insignia y numeración fija", async () => {
      const c = await freshDb("pi_confirm");
      const u = await newUser(c);
      const bought = await buy(c, u);
      const paymentId = await pay(c, bought.preapprovalId);
      const r = await sync(c, bought.preapprovalId, "authorized");
      assert.equal(r.status, "active");
      assert.equal(r.event, "confirmed");
      assert.equal(r.pioneer_number, bought.number);
      assert.equal(r.cycles_paid, 1);
      const seat = await seatOf(c, u);
      assert.equal(seat.status, "active");
      assert.equal(seat.first_payment_id, paymentId);
      assert.ok(seat.confirmed_at);
      assert.equal(seat.reservation_expires_at, null);
      assert.deepEqual(await events(c, seat.id), ["reserved", "attached", "confirmed"]);
      assert.equal((await state(c)).active, 1);
      await c.end();
    });

    await test("webhooks duplicados o desordenados: repetir la sincronización no cambia nada ni duplica eventos", async () => {
      const c = await freshDb("pi_dupe");
      const u = await newUser(c);
      const bought = await buy(c, u);
      await pay(c, bought.preapprovalId);
      await sync(c, bought.preapprovalId, "authorized");
      const before = await seatOf(c, u);
      for (const status of ["authorized", "authorized", "pending", null, "authorized"]) {
        const r = await sync(c, bought.preapprovalId, status);
        assert.equal(r.status, "active");
        assert.equal(r.event, "unchanged");
      }
      const after = await seatOf(c, u);
      assert.equal(after.confirmed_at.getTime(), before.confirmed_at.getTime());
      assert.equal(after.first_payment_id, before.first_payment_id);
      assert.equal(after.cycles_paid, 1);
      assert.deepEqual(await events(c, after.id), ["reserved", "attached", "confirmed"]);
      await c.end();
    });

    await test("CONCURRENCIA: 12 webhooks simultáneos del mismo pago confirman una sola vez", async () => {
      const name = "pi_race_sync";
      const c = await freshDb(name);
      const u = await newUser(c);
      const bought = await buy(c, u);
      await pay(c, bought.preapprovalId);
      const clients = await Promise.all(Array.from({ length: 12 }, () => connect(name).then(track)));
      const results = await Promise.all(clients.map((x) => sync(x, bought.preapprovalId, "authorized")));
      await Promise.all(clients.map((x) => x.end()));
      assert.equal(results.filter((r) => r.event === "confirmed").length, 1);
      assert.ok(results.every((r) => r.status === "active"));
      const seat = await seatOf(c, u);
      assert.equal((await events(c, seat.id)).filter((e) => e === "confirmed").length, 1);
      await c.end();
    });

    await test("ciclos: cuenta solo cobros aprobados al precio promocional, nunca decrece, y al sexto queda 'due'", async () => {
      const c = await freshDb("pi_cycles");
      const p = await activePioneer(c);
      for (let i = 0; i < 4; i += 1) await pay(c, p.preapprovalId);
      await pay(c, p.preapprovalId, { status: "rejected" });
      await pay(c, p.preapprovalId, { amount: 19900 });
      let r = await sync(c, p.preapprovalId, "authorized");
      assert.equal(r.cycles_paid, 5);
      assert.equal(r.step_up_status, "not_due");

      await pay(c, p.preapprovalId);
      r = await sync(c, p.preapprovalId, "authorized");
      assert.equal(r.cycles_paid, 6);
      assert.equal(r.step_up_status, "due");

      // Re-sincronizar no vuelve a contar, y borrar un pago no baja el contador (la base lo impide).
      assert.equal((await sync(c, p.preapprovalId, "authorized")).cycles_paid, 6);
      await c.query(`delete from public.payments where mercado_pago_preapproval_id=$1 and status='approved' and amount=9900 and id <> (select first_payment_id::uuid from public.pioneer_members where user_id=$2)`, [p.preapprovalId, p.uid]);
      assert.equal((await sync(c, p.preapprovalId, "authorized")).cycles_paid, 6, "monótono");
      await assert.rejects(c.query(`update public.pioneer_members set cycles_paid = 1 where user_id=$1`, [p.uid]), /never decreases/);
      await c.end();
    });

    // =====================================================================================================
    // Pagos rechazados, abandono, vencimiento y pagos tardíos
    // =====================================================================================================
    await test("pago rechazado y suscripción cancelada: el lugar se libera, no queda consumido y el número se reutiliza", async () => {
      const c = await freshDb("pi_rejected");
      const a = await newUser(c);
      const bought = await buy(c, a);
      await pay(c, bought.preapprovalId, { status: "rejected" });
      const r = await sync(c, bought.preapprovalId, "cancelled");
      assert.equal(r.status, "released");
      assert.equal(r.event, "released");
      assert.equal((await seatOf(c, a)).release_reason, "provider_cancelled");
      assert.equal((await state(c)).available, 20);

      const b = await newUser(c);
      const next = await reserve(c, b);
      assert.equal(next.status, "reserved");
      assert.equal(next.pioneer_number, bought.number, "el número vuelve a estar disponible");
      // La persona liberada puede intentar otra vez.
      assert.equal((await reserve(c, a)).status, "reserved");
      await c.end();
    });

    await test("abandono: una reserva vencida SIN nada que MP pueda cobrar se libera sola; el resto espera la verificación", async () => {
      const c = await freshDb("pi_expiry");
      await c.query(`update public.pioneer_edition set capacity = 2`);
      const a = await newUser(c);
      const b = await newUser(c);
      const boughtA = await buy(c, a); // checkout creado en MP (preapproval pendiente de autorizar)
      const resB = await reserve(c, b); // nunca llegó a Mercado Pago
      assert.equal((await reserve(c, await newUser(c))).status, "sold_out");

      await c.query(`update public.pioneer_members set reservation_expires_at = now() - interval '1 minute'`);
      const s = await state(c);
      assert.deepEqual([s.held, s.held_expired, s.available], [0, 2, 0], "vencidas sin resolver siguen ocupando");
      const job = (await c.query(`select public.release_expired_pioneer_holds() as r`)).rows[0].r;
      assert.deepEqual(job.released.map((x) => x.seat_id), [resB.seat_id], "solo la que nunca llegó a MP");
      assert.equal(job.needs_provider_check.length, 1);
      assert.equal(job.needs_provider_check[0].preapproval_id, boughtA.preapprovalId);
      assert.equal(job.needs_provider_check[0].local_subscription_status, "pending");
      assert.equal((await seatOf(c, b)).release_reason, "expired");
      assert.equal((await seatOf(c, a)).status, "reserved", "una suscripción pendiente todavía puede ser autorizada y cobrada");

      assert.equal((await reserve(c, await newUser(c))).status, "reserved", "el cupo de la que nunca llegó a MP quedó libre");
      const full = await reserve(c, await newUser(c));
      assert.equal(full.status, "sold_out");
      assert.equal(full.needs_provider_check, 1, "avisa que hay una verificación pendiente con MP");
      assert.equal((await c.query(`select public.release_pioneer_seat($1,'checkout_abandoned',$2) as r`, [(await seatOf(c, a)).id, a])).rows[0].r.status, "chargeable");

      // El servidor verifica en MP, la cancela y sincroniza 'cancelled': recién ahí se libera.
      const r = await sync(c, boughtA.preapprovalId, "cancelled");
      assert.equal(r.event, "released");
      assert.equal((await seatOf(c, a)).release_reason, "provider_cancelled");
      assert.equal((await reserve(c, await newUser(c))).status, "reserved");
      assert.deepEqual((await c.query(`select public.release_expired_pioneer_holds() as r`)).rows[0].r.released, [], "idempotente");
      await c.end();
    });

    await test("pagos tardíos: una suscripción autorizada, pendiente o con el checkout en curso NUNCA se libera por vencimiento", async () => {
      const c = await freshDb("pi_chargeable");
      const expireAll = () => c.query(`update public.pioneer_members set reservation_expires_at = now() - interval '1 hour' where status = 'reserved'`);
      const job = async () => (await c.query(`select public.release_expired_pioneer_holds() as r`)).rows[0].r;

      // 1) Autorizada sin cobro aprobado todavía (MP reintenta durante días).
      const authorized = await newUser(c);
      const boughtAuthorized = await buy(c, authorized);
      await c.query(`update public.subscriptions set status='authorized' where mercado_pago_preapproval_id=$1`, [boughtAuthorized.preapprovalId]);
      // 2) Checkout en curso: la llamada a MP no terminó (preapproval todavía desconocido).
      const inFlight = await newUser(c);
      const resInFlight = await reserve(c, inFlight);
      const begin = (await c.query(`select public.begin_membership_checkout($1,$2,9900,'ARS','p@x.test','Membresía','https://x.test/back') as r`, [inFlight, "71000000-0000-4000-8000-000000000001"])).rows[0].r;
      assert.equal((await c.query(`select public.attach_pioneer_seat($1,$2,$3) as r`, [inFlight, resInFlight.seat_id, begin.attempt_id])).rows[0].r.status, "attached");
      // 3) Preapproval cancelado en MP: ya no puede cobrar.
      const cancelled = await newUser(c);
      const boughtCancelled = await buy(c, cancelled);
      await c.query(`update public.subscriptions set status='cancelled' where mercado_pago_preapproval_id=$1`, [boughtCancelled.preapprovalId]);
      // 4) Sin fila local para el preapproval: no se sabe -> se asume que puede cobrar.
      const unknown = await newUser(c);
      const boughtUnknown = await buy(c, unknown);
      await c.query(`update public.subscriptions set mercado_pago_preapproval_id = null where mercado_pago_preapproval_id=$1`, [boughtUnknown.preapprovalId]);

      await expireAll();
      const result = await job();
      assert.deepEqual(result.released.map((x) => x.seat_id), [(await seatOf(c, cancelled)).id], "solo la cancelada se libera");
      const pending = result.needs_provider_check;
      assert.equal(pending.length, 3);
      assert.deepEqual(pending.map((x) => x.local_subscription_status ?? "none").sort(), ["authorized", "none", "none"]);
      for (const uid of [authorized, inFlight, unknown]) assert.equal((await seatOf(c, uid)).status, "reserved");
      assert.ok(pending.some((x) => x.attempt_state === "creating"), "el checkout en curso figura para verificar");

      // Ni el barrido de otra reserva ni la liberación manual las sueltan.
      await reserve(c, await newUser(c));
      for (const uid of [authorized, inFlight, unknown]) {
        const seat = await seatOf(c, uid);
        assert.equal(seat.status, "reserved");
        assert.equal((await c.query(`select public.release_pioneer_seat($1,'manual_check') as r`, [seat.id])).rows[0].r.status, "chargeable");
      }

      // La autorizada: MP todavía puede cobrar -> el servidor extiende la retención, no la cancela.
      const kept = await sync(c, boughtAuthorized.preapprovalId, "authorized");
      assert.equal(kept.event, "hold_extended");
      assert.equal((await job()).needs_provider_check.some((x) => x.preapproval_id === boughtAuthorized.preapprovalId), false);
      // ...y cuando MP cobra, se confirma con el número original.
      await pay(c, boughtAuthorized.preapprovalId);
      const confirmed = await sync(c, boughtAuthorized.preapprovalId, "authorized");
      assert.equal(confirmed.status, "active");
      assert.equal(confirmed.pioneer_number, boughtAuthorized.number);

      // Un intento de checkout cerrado (error del proveedor definitivo) sí deja de poder cobrar.
      await c.query(`update public.checkout_attempts set state='closed', closed_at=now() where id=$1`, [begin.attempt_id]);
      await expireAll();
      const after = await job();
      assert.ok(after.released.some((x) => x.seat_id === resInFlight.seat_id));
      await c.end();
    });

    await test("una reserva vencida PERO con pago aprobado verificado no se libera: espera la confirmación", async () => {
      const c = await freshDb("pi_expiry_paid");
      const u = await newUser(c);
      const bought = await buy(c, u);
      await pay(c, bought.preapprovalId);
      await c.query(`update public.pioneer_members set reservation_expires_at = now() - interval '1 hour' where user_id = $1`, [u]);
      assert.deepEqual((await c.query(`select public.release_expired_pioneer_holds() as r`)).rows[0].r.released, []);
      await reserve(c, await newUser(c)); // también el barrido interno la respeta
      assert.equal((await seatOf(c, u)).status, "reserved");
      const r = await sync(c, bought.preapprovalId, "authorized");
      assert.equal(r.status, "active");
      assert.equal(r.pioneer_number, bought.number);
      await c.end();
    });

    await test("red de seguridad ante una liberación equivocada (error operativo): el pago aprobado recupera el lugar si el número sigue libre; si no, NO se supera la capacidad", async () => {
      const c = await freshDb("pi_late");
      await c.query(`update public.pioneer_edition set capacity = 2`);
      // Simula un error operativo: alguien con SQL libera un lugar cuya suscripción sigue viva en MP.
      const forceRelease = (uid) =>
        c.query(`update public.pioneer_members set status='released', released_at=now(), release_reason='manual_error' where user_id=$1 and status='reserved'`, [uid]);
      const a = await newUser(c);
      const boughtA = await buy(c, a);
      await forceRelease(a);
      assert.equal((await seatOf(c, a)).status, "released");

      // Caso 1: nadie tomó el número -> se recupera el mismo.
      await pay(c, boughtA.preapprovalId);
      let r = await sync(c, boughtA.preapprovalId, "authorized");
      assert.equal(r.event, "late_reactivated");
      assert.equal(r.pioneer_number, boughtA.number);
      assert.equal((await seatOf(c, a)).release_reason, null);

      // Caso 2: otro tomó el lugar y se agotó; el pago tardío de un segundo comprador no puede ocupar un 3.º.
      const b = await newUser(c);
      const boughtB = await buy(c, b);
      await forceRelease(b);
      const x = await newUser(c);
      assert.equal((await reserve(c, x)).status, "reserved");
      await pay(c, boughtB.preapprovalId);
      r = await sync(c, boughtB.preapprovalId, "authorized");
      assert.equal(r.event, "no_seat_available");
      assert.equal(r.status, "released");
      assert.equal((await seatOf(c, b)).release_reason, "late_payment_no_seat");
      assert.equal((await c.query(`select count(*)::int n from public.pioneer_members where status in ('reserved','active')`)).rows[0].n, 2);
      assert.equal((await sync(c, boughtB.preapprovalId, "authorized")).event, "no_seat_available", "estable al repetir");
      assert.equal((await events(c, (await seatOf(c, b)).id)).filter((e) => e === "late_payment_no_seat").length, 1);
      await c.end();
    });

    await test("release_pioneer_seat: libera solo reservas sin pago; nunca un lugar activo ni de otra persona", async () => {
      const c = await freshDb("pi_release");
      const u = await newUser(c);
      const r = await reserve(c, u);
      const rel = (seat, reason = "checkout_failed", uid = null) => c.query(`select public.release_pioneer_seat($1,$2,$3) as r`, [seat, reason, uid]).then((x) => x.rows[0].r);
      await assert.rejects(rel(r.seat_id, "Bad Reason!"), /snake_case/);
      assert.equal((await rel(r.seat_id, "checkout_failed", await newUser(c))).status, "not_found");
      assert.equal((await rel(r.seat_id, "checkout_failed", u)).status, "released");
      assert.equal((await rel(r.seat_id)).status, "not_releasable");

      const paid = await newUser(c);
      const bought = await buy(c, paid);
      await pay(c, bought.preapprovalId);
      assert.equal((await rel(bought.seatId)).status, "paid", "con pago verificado no se libera aunque esté sin sincronizar");
      await sync(c, bought.preapprovalId, "authorized");
      assert.deepEqual(await rel(bought.seatId), { status: "not_releasable", seat_status: "active" });
      await c.end();
    });

    // =====================================================================================================
    // Cancelaciones y permanencia de la insignia
    // =====================================================================================================
    await test("cancelar: pierde promoción y acceso anticipado, pero conserva el lugar, el número y la insignia; no se libera ni se reasigna", async () => {
      const c = await freshDb("pi_cancel");
      await c.query(`update public.pioneer_edition set early_access_features = '{herramienta_beta}'`);
      const p = await activePioneer(c);
      const feats = async () => (await c.query(`select public.pioneer_early_access_features($1) as f`, [p.uid])).rows[0].f;
      assert.deepEqual(await feats(), ["herramienta_beta"]);

      let r = await sync(c, p.preapprovalId, "cancelled");
      assert.equal(r.event, "benefits_ended");
      assert.equal(r.status, "active");
      assert.equal(r.step_up_status, "void");
      assert.equal(r.pioneer_number, p.number);
      assert.deepEqual(await feats(), [], "sin acceso anticipado");
      const seat = await seatOf(c, p.uid);
      assert.ok(seat.benefits_ended_at);
      assert.equal(seat.benefits_end_reason, "cancelled");

      r = await sync(c, p.preapprovalId, "cancelled");
      assert.equal(r.event, "unchanged", "idempotente");
      assert.equal((await sync(c, p.preapprovalId, "authorized")).benefits_ended, true, "no se restauran solos");

      // El cupo no se libera: sigue ocupado y nadie hereda el número; la persona no recibe otra promoción.
      assert.equal((await state(c)).active, 1);
      assert.equal((await reserve(c, p.uid)).status, "already_pioneer");
      const other = await newUser(c);
      assert.notEqual((await reserve(c, other)).pioneer_number, p.number);
      await assert.rejects(c.query(`update public.pioneer_members set benefits_ended_at = null where user_id=$1`, [p.uid]), /cannot be restored/);
      await c.end();
    });

    await test("la insignia es permanente: un lugar activo no se libera, no cambia de número y no se borra, ni con SQL directo", async () => {
      const c = await freshDb("pi_permanent");
      const p = await activePioneer(c);
      const upd = (set) => c.query(`update public.pioneer_members set ${set} where user_id=$1`, [p.uid]);
      await assert.rejects(upd(`status='released', released_at=now()`), /permanent/);
      await assert.rejects(upd(`status='reserved', reservation_expires_at=now()`), /permanent/);
      await assert.rejects(upd(`pioneer_number = ${p.number === 20 ? 19 : 20}`), /numbering is permanent/);
      await assert.rejects(upd(`confirmed_at = now() + interval '1 day'`), /numbering is permanent/);
      await assert.rejects(upd(`first_payment_id = 'otro'`), /numbering is permanent/);
      await assert.rejects(upd(`locked_price = 1`), /immutable/);
      await assert.rejects(upd(`locked_cycles = 1`), /immutable/);
      await assert.rejects(upd(`accepted_regular_price = 1`), /immutable/);
      await assert.rejects(upd(`user_id = '${await newUser(c)}'`), /owner cannot change/);
      await assert.rejects(c.query(`delete from public.pioneer_members`), /never deleted/);
      assert.equal((await seatOf(c, p.uid)).status, "active");

      // Que venza o se cancele la membresía no toca la insignia ni la numeración.
      await sync(c, p.preapprovalId, "cancelled");
      assert.equal((await seatOf(c, p.uid)).pioneer_number, p.number);

      // Si se borra la cuenta, user_id pasa a null y el número NO se reasigna.
      await c.query(`update public.pioneer_members set user_id = null where id = $1`, [p.seatId]);
      const after = await newUser(c);
      for (let i = 0; i < 19; i += 1) await reserve(c, await newUser(c));
      assert.equal((await reserve(c, after)).status, "sold_out");
      const numbers = (await c.query(`select pioneer_number from public.pioneer_members where status in ('reserved','active') order by 1`)).rows.map((r) => r.pioneer_number);
      assert.equal(numbers.length, 20);
      assert.equal(new Set(numbers).size, 20);
      await c.end();
    });

    await test("al borrarse la cuenta (FK on delete set null) el lugar activo queda con su número y no se libera", async () => {
      const c = await freshDb("pi_account_delete");
      const p = await activePioneer(c);
      // Se retiran las filas que referencian a la persona (en producción dependen de su propio ON DELETE).
      await c.query(`delete from public.payments where user_id=$1`, [p.uid]);
      await c.query(`update public.pioneer_members set checkout_attempt_id = null where id=$1`, [p.seatId]);
      await c.query(`delete from public.checkout_attempts where user_id=$1`, [p.uid]);
      await c.query(`delete from public.subscriptions where user_id=$1`, [p.uid]);
      await c.query(`delete from auth.users where id=$1`, [p.uid]);
      const seat = (await c.query(`select * from public.pioneer_members where id=$1`, [p.seatId])).rows[0];
      assert.equal(seat.user_id, null);
      assert.equal(seat.status, "active");
      assert.equal(seat.pioneer_number, p.number);
      await c.end();
    });

    await test("acceso anticipado: vacío por defecto; solo para lugar activo con beneficios vigentes y funcionalidades con formato válido", async () => {
      const c = await freshDb("pi_early");
      const feats = async (uid) => (await c.query(`select public.pioneer_early_access_features($1) as f`, [uid])).rows[0].f;
      const reservedOnly = await newUser(c);
      await reserve(c, reservedOnly);
      const p = await activePioneer(c);
      assert.deepEqual(await feats(p.uid), [], "lista vacía por defecto: no se habilita nada solo");

      await assert.rejects(c.query(`update public.pioneer_edition set early_access_features = '{"Bad Id"}'`), /pioneer_edition_features_check/);
      await assert.rejects(c.query(`update public.pioneer_edition set early_access_features = array[null]::text[]`), /pioneer_edition_features_check/);
      await c.query(`update public.pioneer_edition set early_access_features = '{stampy,maker_beta}'`);
      assert.deepEqual(await feats(p.uid), ["stampy", "maker_beta"]);
      assert.deepEqual(await feats(reservedOnly), [], "un lugar solo reservado no da acceso anticipado");
      assert.deepEqual(await feats(await newUser(c)), []);
      await c.end();
    });

    // =====================================================================================================
    // Seguridad: privilegios, RLS y bitácora
    // =====================================================================================================
    await test("anon y authenticated no pueden ejecutar ninguna función ni escribir; service_role solo llama funciones", async () => {
      const c = await freshDb("pi_security");
      const p = await activePioneer(c);
      const stranger = await newUser(c);
      const calls = [
        `select public.pioneer_offer_state()`,
        `select public.reserve_pioneer_seat('${stranger}', 19900, 'ARS', 'v1')`,
        `select public.attach_pioneer_seat('${stranger}', '${p.seatId}', '${p.attemptId}')`,
        `select public.sync_pioneer_seat('${p.preapprovalId}', 'authorized')`,
        `select public.release_pioneer_seat('${p.seatId}', 'abuse_test', null)`,
        `select public.release_expired_pioneer_holds()`,
        `select public.pioneer_early_access_features('${p.uid}')`,
      ];
      for (const [role, uid] of [["anon", null], ["authenticated", stranger], ["authenticated", p.uid]]) {
        await asRole(c, role, uid);
        for (const call of calls) await assert.rejects(c.query(call), /permission denied/, `${role}: ${call}`);
        for (const write of [
          `insert into public.pioneer_members (pioneer_number, currency, locked_price, locked_cycles, accepted_regular_price, accepted_terms_version, reservation_expires_at) values (1,'ARS',1,6,1,'v1',now())`,
          `update public.pioneer_members set locked_price = 1`,
          `update public.pioneer_members set status = 'active'`,
          `delete from public.pioneer_members`,
          `update public.pioneer_edition set enabled = false`,
          `insert into public.pioneer_seat_events (seat_id, event) values ('${p.seatId}', 'x')`,
        ]) {
          await assert.rejects(c.query(write), /permission denied/, `${role}: ${write}`);
        }
        await asSuper(c);
      }

      await asRole(c, "service_role");
      for (const call of calls) await c.query(call); // service_role sí puede llamar las funciones
      for (const direct of [
        `insert into public.pioneer_members (pioneer_number, currency, locked_price, locked_cycles, accepted_regular_price, accepted_terms_version, reservation_expires_at) values (2,'ARS',1,6,1,'v1',now())`,
        `update public.pioneer_members set status = 'released'`,
        `delete from public.pioneer_members`,
        `truncate public.pioneer_members`,
        `insert into public.pioneer_seat_events (seat_id, event) values ('${p.seatId}', 'x')`,
        `delete from public.pioneer_edition`,
      ]) {
        await assert.rejects(c.query(direct), /permission denied/, `service_role: ${direct}`);
      }
      for (const internal of [`select public._pioneer_lock()`, `select public._pioneer_sweep_expired()`, `select * from public._pioneer_qualifying_payments('${p.seatId}')`]) {
        await assert.rejects(c.query(internal), /permission denied/, internal);
      }
      await asSuper(c);
      await c.end();
    });

    await test("RLS: cada persona ve solo su lugar y solo columnas no sensibles; nadie ve otros Pioneros ni la configuración", async () => {
      const c = await freshDb("pi_rls");
      const a = await activePioneer(c);
      const b = await activePioneer(c);
      const reservedUser = await newUser(c);
      await reserve(c, reservedUser);
      const outsider = await newUser(c);

      await asRole(c, "authenticated", a.uid);
      const mine = (await c.query(`select id, user_id, pioneer_number, status, cycles_paid from public.pioneer_members`)).rows;
      assert.deepEqual(mine.map((r) => r.user_id), [a.uid], "solo su fila");
      assert.equal(mine[0].pioneer_number, a.number);
      assert.equal((await c.query(`select count(*)::int n from public.pioneer_members where user_id = $1`, [b.uid])).rows[0].n, 0, "no ve a otro Pionero");
      await assert.rejects(c.query(`select * from public.pioneer_members`), /permission denied/, "select * incluiría columnas privadas");
      for (const column of ["mercado_pago_preapproval_id", "checkout_attempt_id", "first_payment_id", "release_reason", "step_up_error", "step_up_target"]) {
        await assert.rejects(c.query(`select ${column} from public.pioneer_members`), /permission denied/, column);
      }
      await assert.rejects(c.query(`select * from public.pioneer_edition`), /permission denied/);
      await assert.rejects(c.query(`select * from public.pioneer_seat_events`), /permission denied/);
      await asSuper(c);

      await asRole(c, "authenticated", outsider);
      assert.equal((await c.query(`select count(*)::int n from public.pioneer_members`)).rows[0].n, 0);
      await asSuper(c);

      await asRole(c, "anon");
      await assert.rejects(c.query(`select pioneer_number from public.pioneer_members`), /permission denied/);
      await asSuper(c);
      await c.end();
    });

    await test("la bitácora es append-only: no se puede modificar ni borrar, ni siquiera como superusuario", async () => {
      const c = await freshDb("pi_events");
      const u = await newUser(c);
      const r = await reserve(c, u);
      assert.deepEqual(await events(c, r.seat_id), ["reserved"]);
      await assert.rejects(c.query(`update public.pioneer_seat_events set event = 'x'`), /append-only/);
      await assert.rejects(c.query(`delete from public.pioneer_seat_events`), /append-only/);
      await c.end();
    });

    await test("CONCURRENCIA: liberar y confirmar a la vez un lugar con pago aprobado termina siempre activo, nunca liberado", async () => {
      const name = "pi_race_release";
      const c = await freshDb(name);
      for (let round = 0; round < 6; round += 1) {
        const u = await newUser(c);
        const bought = await buy(c, u);
        await pay(c, bought.preapprovalId);
        const [x, y] = await Promise.all([connect(name).then(track), connect(name).then(track)]);
        await Promise.all([
          x.query(`select public.release_pioneer_seat($1,'checkout_abandoned',$2)`, [bought.seatId, u]),
          sync(y, bought.preapprovalId, "authorized"),
        ]);
        await Promise.all([x.end(), y.end()]);
        const seat = await seatOf(c, u);
        // Si la liberación ganó la carrera, el pago ya estaba aprobado: 'paid' la rechaza; si ganó el sync, es activo.
        assert.equal(seat.status, "active", `ronda ${round}`);
        assert.equal(seat.release_reason, null);
      }
      await c.end();
    });

    await test("compatibilidad: una base con la forma esperada no da ningún MISMATCH; una con tipos, columnas o permisos distintos sí", async () => {
      const c = await createDb("pi_compat_ok");
      const rows = await readOnly(c, compatCheck);
      assert.deepEqual(rows.filter((r) => r.status === "MISMATCH"), [], "base conforme");
      assert.ok(rows.filter((r) => r.status === "ok").length >= 30);
      assert.ok(rows.some((r) => r.area === "relaciones" && r.status === "info"), "informa reglas de borrado");

      // Después de aplicar M1 los nombres aparecen como informativos, sin romper nada.
      await c.query(pioneerMigration);
      const after = await readOnly(c, compatCheck);
      assert.deepEqual(after.filter((r) => r.status === "MISMATCH"), []);
      assert.ok(after.some((r) => r.area === "nombres" && r.name.includes("pioneer_members")));
      await c.end();

      // Forma distinta: importe como texto, subscription_id como texto, sin paid_at y sin user_id de Fundadores.
      const d = await createDb("pi_compat_bad");
      await d.query(`alter table public.payments drop constraint payments_subscription_id_fkey`);
      await d.query(`alter table public.payments alter column subscription_id type text using subscription_id::text`);
      await d.query(`alter table public.payments alter column amount type text using amount::text`);
      await d.query(`alter table public.payments drop column paid_at`);
      await d.query(`alter table public.founder_members rename column user_id to owner_id`);
      const bad = (await readOnly(d, compatCheck)).filter((r) => r.status === "MISMATCH").map((r) => `${r.name}=${r.actual}`);
      assert.ok(bad.includes("public.payments.subscription_id=INCOMPATIBLE (text)"), bad.join(" | "));
      assert.ok(bad.includes("public.payments.amount=INCOMPATIBLE (text)"), bad.join(" | "));
      assert.ok(bad.includes("public.payments.paid_at=FALTA la columna"), bad.join(" | "));
      assert.ok(bad.includes("public.founder_members.user_id=FALTA la columna"), bad.join(" | "));
      await d.end();

      // Un rol sin privilegios (como el dueño equivocado de las funciones) no podría leer las tablas.
      const e = await createDb("pi_compat_role");
      await e.query(`create role pi_migrator nologin; grant usage on schema public, auth to pi_migrator`);
      await e.query(`set role pi_migrator`);
      const weak = (await readOnly(e, compatCheck)).filter((r) => r.status === "MISMATCH").map((r) => r.name);
      await e.query(`reset role`);
      assert.ok(weak.includes("el dueño lee todas las filas de payments"), weak.join(" | "));
      assert.ok(weak.includes("el dueño lee todas las filas de founder_members"), weak.join(" | "));
      await e.end();
    });

    await test("forma de los datos: solo conteos y valores de catálogo, sin datos personales; detecta estados que M1 no reconocería", async () => {
      const c = await createDb("pi_shape");
      const u = await newUser(c);
      const t = await checkout(c, u, 19900, { subscriptionStatus: "authorized" });
      await pay(c, t.preapprovalId, { amount: 19900 });
      await pay(c, t.preapprovalId, { status: "Approved", amount: 19900 }); // variante que M1 no reconocería
      await c.query(`update public.payments set user_id = null where id = (select id from public.payments order by id limit 1)`);
      const rows = await readOnly(c, dataShape);
      const find = (area) => rows.filter((r) => r.area.startsWith(area));
      assert.ok(find("payments.status").length >= 2);
      assert.equal(find("payments.status: variantes")[0].value, "Approved");
      assert.ok(Number(find("payments approved sin user_id")[0].n) >= 1);
      const text = JSON.stringify(rows);
      assert.ok(!text.includes(u) && !text.includes(t.preapprovalId) && !text.includes("@"), "no imprime ids, preapprovals ni correos");
      await c.end();
    });

    await test("los diagnósticos de compatibilidad y forma de datos son solo SELECT y se pueden correr en transacción de solo lectura", async () => {
      for (const file of [compatCheck, dataShape]) {
        const executable = file.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
        assert.ok(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(executable), "solo SELECT");
        assert.ok(/^\s*(with|select)\b/i.test(executable));
      }
      assert.ok(!/\bpayments\b[^;]*\b(email|payer_email|raw_data)\b/i.test(dataShape), "no toca columnas personales");
    });

    await test("diagnóstico M1: el estado de antes y después es idéntico para Fundadores y pruebas de $250, y la verificación posterior da todo OK", async () => {
      const c = await createDb("pi_diag");
      for (const [i, uid] of [await newUser(c), await newUser(c), await newUser(c)].entries()) {
        await c.query(`insert into public.founder_members (user_id, founder_number) values ($1,$2)`, [uid, i + 1]);
      }
      const internal = await newUser(c);
      const t = await checkout(c, internal, 250, { subscriptionStatus: "authorized" });
      await pay(c, t.preapprovalId, { amount: 250 });

      const asMap = (rows) => Object.fromEntries(rows.map((r) => [r.item, r.value]));
      const before = asMap(await readOnly(c, stateDiagnostic));
      assert.equal(before["pioneer_members.exists"], "false");
      assert.equal(before["founder_members.count"], "3");
      assert.equal(before["subscriptions_at_250.count"], "1");

      await c.query(pioneerMigration);
      const after = asMap(await readOnly(c, stateDiagnostic));
      assert.equal(after["pioneer_members.exists"], "true");
      for (const key of Object.keys(before).filter((k) => k.startsWith("founder_") || k.startsWith("subscriptions") || k.startsWith("payments") || k.startsWith("checkout_attempts"))) {
        assert.equal(after[key], before[key], `${key} no cambió`);
      }

      const verification = await readOnly(c, postCheck);
      const failed = verification.filter((r) => !r.ok);
      assert.deepEqual(failed, [], `verificación posterior: ${JSON.stringify(failed)}`);
      assert.ok(verification.length > 100);

      for (const file of [stateDiagnostic, postCheck]) {
        // Sin comentarios ni literales ('INSERT' como nombre de privilegio no es una sentencia).
        const executable = file.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
        assert.ok(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(executable), "los diagnósticos son solo SELECT");
        assert.ok(/^\s*(with|select)\b/i.test(executable), "empieza con SELECT/WITH");
      }
      await c.end();
    });

    await test("flujo completo de punta a punta con 20 Pioneros reales: todos confirman, el 21.º queda afuera y nada se asigna dos veces", async () => {
      const name = "pi_e2e";
      const c = await freshDb(name);
      const buyers = [];
      for (let i = 0; i < 24; i += 1) buyers.push(await newUser(c));
      const clients = await Promise.all(buyers.map(() => connect(name).then(track)));
      const reserved = await Promise.all(buyers.map((uid, i) => reserve(clients[i], uid)));
      const winners = reserved.map((r, i) => ({ r, uid: buyers[i], client: clients[i] })).filter(({ r }) => r.status === "reserved");
      assert.equal(winners.length, 20);

      const prepared = [];
      for (const w of winners) {
        const attempt = await checkout(c, w.uid, 9900);
        await c.query(`select public.attach_pioneer_seat($1,$2,$3)`, [w.uid, w.r.seat_id, attempt.attemptId]);
        await pay(c, attempt.preapprovalId);
        prepared.push({ ...w, ...attempt });
      }
      // Los webhooks llegan todos a la vez y repetidos.
      await Promise.all(prepared.flatMap((p) => [sync(p.client, p.preapprovalId, "authorized"), sync(p.client, p.preapprovalId, "authorized")]));
      await Promise.all(clients.map((x) => x.end()));

      const active = (await c.query(`select pioneer_number from public.pioneer_members where status='active' order by 1`)).rows.map((r) => r.pioneer_number);
      assert.deepEqual(active, Array.from({ length: 20 }, (_, i) => i + 1));
      const late = await newUser(c);
      assert.equal((await reserve(c, late)).status, "sold_out");
      const s = await state(c);
      assert.deepEqual([s.active, s.held, s.available], [20, 0, 0]);
      await c.end();
    });
  } finally {
    await Promise.allSettled(open.map((x) => x.end()));
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (!EmbeddedPostgres || !pg) {
  test("pioneer seats DB behaviour", { skip: "optional: npm i --no-save embedded-postgres pg" }, () => {});
} else {
  await main();
}
