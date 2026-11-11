import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const spike = await import(pathToFileURL(path.resolve("scripts/mp-spike/price-change-spike.mjs")).href);
const { run, SpikeError, SPIKE_REF_PREFIX, assertSafeEnv, snapshotPreapproval } = spike;

const TEST_ENV = {
  MP_SPIKE_ACCESS_TOKEN: "TEST-token-de-prueba",
  MP_SPIKE_CONFIRM_TEST_ACCOUNT: "yes",
  MP_SPIKE_EXPECTED_USER_ID: "123456789",
};

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? "" : JSON.stringify(body)) };
}

/** `fetch` falso: registra cada llamada y responde según el método y la ruta. */
function fakeMp({ userId = "123456789", preapproval: initial = null, invoices = { results: [] } } = {}) {
  let preapproval = initial; // con estado: un PUT cambia lo que devuelven los GET siguientes
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const route = String(url).replace("https://api.mercadopago.com", "");
    calls.push({ method, route, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    if (method === "GET" && route === "/users/me") return reply(200, { id: Number(userId), nickname: "TESTUSER1", site_id: "MLA" });
    if (method === "GET" && route.startsWith("/preapproval/")) return preapproval ? reply(200, preapproval) : reply(404, { message: "not found" });
    if (method === "GET" && route.startsWith("/authorized_payments/search")) return reply(200, invoices);
    if (method === "POST" && route === "/preapproval") return reply(201, { id: "pre_abcdef123456", status: "pending", init_point: "https://mp.example/init", external_reference: JSON.parse(init.body).external_reference, auto_recurring: JSON.parse(init.body).auto_recurring });
    if (method === "PUT" && route.startsWith("/preapproval/")) {
      const body = JSON.parse(init.body);
      preapproval = { ...preapproval, status: body.status ?? preapproval.status, auto_recurring: { ...preapproval.auto_recurring, ...(body.auto_recurring ?? {}) } };
      return reply(200, preapproval);
    }
    return reply(500, { message: "unexpected" });
  };
  return { calls, fetchImpl };
}

const authorized = (extra = {}) => ({
  id: "pre_abcdef123456",
  status: "authorized",
  version: 1,
  external_reference: `${SPIKE_REF_PREFIX}1700000000000`,
  payer_email: "buyer@testuser.com",
  auto_recurring: { transaction_amount: 9900, currency_id: "ARS", frequency: 1, frequency_type: "days" },
  summarized: { charged_quantity: 6, charged_amount: 59400 },
  ...extra,
});

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mp-spike-test-"));
const quiet = () => undefined;
const writes = (calls) => calls.filter((c) => c.method !== "GET");

test("sin token, sin confirmación o sin id esperado: aborta antes de llamar a Mercado Pago", async () => {
  for (const env of [{}, { ...TEST_ENV, MP_SPIKE_ACCESS_TOKEN: "" }, { ...TEST_ENV, MP_SPIKE_CONFIRM_TEST_ACCOUNT: "si" }, { ...TEST_ENV, MP_SPIKE_EXPECTED_USER_ID: "" }]) {
    const mp = fakeMp();
    await assert.rejects(run({ argv: ["whoami"], env, fetchImpl: mp.fetchImpl, log: quiet }), SpikeError);
    assert.equal(mp.calls.length, 0);
  }
});

test("se niega a usar el token de producción de la app y a correr en producción de Vercel", () => {
  assert.throws(() => assertSafeEnv({ ...TEST_ENV, MERCADO_PAGO_ACCESS_TOKEN: TEST_ENV.MP_SPIKE_ACCESS_TOKEN }), /producción/);
  assert.throws(() => assertSafeEnv({ ...TEST_ENV, VERCEL_ENV: "production" }), /producción/);
  assert.doesNotThrow(() => assertSafeEnv({ ...TEST_ENV, MERCADO_PAGO_ACCESS_TOKEN: "otro-token-distinto" }));
});

test("si el token pertenece a otra cuenta no hace NADA (solo consulta /users/me)", async () => {
  const mp = fakeMp({ userId: "999999999", preapproval: authorized() });
  await assert.rejects(
    run({ argv: ["put-amount", "pre_abcdef123456", "--amount", "19900", "--execute"], env: TEST_ENV, fetchImpl: mp.fetchImpl, log: quiet, outDir: tmp() }),
    /OTRA cuenta/,
  );
  assert.deepEqual(mp.calls.map((c) => `${c.method} ${c.route}`), ["GET /users/me"]);
});

test("create: por defecto es DRY-RUN; con --execute crea una suscripción de spike en DÍAS", async () => {
  const dry = fakeMp();
  const dryResult = await run({ argv: ["create", "--amount", "9900", "--email", "buyer@testuser.com"], env: TEST_ENV, fetchImpl: dry.fetchImpl, log: quiet });
  assert.equal(dryResult.dryRun, true);
  assert.equal(writes(dry.calls).length, 0);

  const real = fakeMp();
  const result = await run({ argv: ["create", "--amount", "9900", "--email", "buyer@testuser.com", "--days", "1", "--execute"], env: TEST_ENV, fetchImpl: real.fetchImpl, log: quiet, outDir: tmp() });
  const [post] = writes(real.calls);
  assert.equal(post.method, "POST");
  assert.ok(post.body.external_reference.startsWith(SPIKE_REF_PREFIX));
  assert.equal(post.body.auto_recurring.frequency_type, "days");
  assert.equal(post.body.auto_recurring.transaction_amount, 9900);
  assert.equal(post.body.status, "pending");
  assert.equal(result.init_point, "https://mp.example/init");
  assert.ok(real.calls.every((c) => c.auth === `Bearer ${TEST_ENV.MP_SPIKE_ACCESS_TOKEN}`));
});

test("create rechaza frecuencias fuera de 1–30 días y montos absurdos", async () => {
  for (const extra of [["--days", "0"], ["--days", "31"], ["--days", "1.5"], ["--amount", "0"]]) {
    const mp = fakeMp();
    const argv = ["create", "--amount", "9900", "--email", "buyer@testuser.com", ...extra, "--execute"];
    await assert.rejects(run({ argv, env: TEST_ENV, fetchImpl: mp.fetchImpl, log: quiet, outDir: tmp() }), SpikeError);
    assert.equal(writes(mp.calls).length, 0);
  }
});

test("put-amount y cancel NUNCA tocan una suscripción que no creó el spike", async () => {
  const real = authorized({ external_reference: "stampa_checkout_abc123" });
  for (const argv of [["put-amount", "pre_abcdef123456", "--amount", "19900", "--execute"], ["cancel", "pre_abcdef123456", "--execute"]]) {
    const mp = fakeMp({ preapproval: real });
    await assert.rejects(run({ argv, env: TEST_ENV, fetchImpl: mp.fetchImpl, log: quiet, outDir: tmp() }), /NO fue creada por este spike/);
    assert.equal(writes(mp.calls).length, 0);
  }
});

test("put-amount: DRY-RUN por defecto; --execute envía SOLO el monto; --require-charged bloquea un cambio anticipado", async () => {
  const dry = fakeMp({ preapproval: authorized() });
  await run({ argv: ["put-amount", "pre_abcdef123456", "--amount", "19900"], env: TEST_ENV, fetchImpl: dry.fetchImpl, log: quiet });
  assert.equal(writes(dry.calls).length, 0);

  const early = fakeMp({ preapproval: authorized({ summarized: { charged_quantity: 3 } }) });
  await assert.rejects(
    run({ argv: ["put-amount", "pre_abcdef123456", "--amount", "19900", "--require-charged", "6", "--execute"], env: TEST_ENV, fetchImpl: early.fetchImpl, log: quiet, outDir: tmp() }),
    /Solo hay 3 cobros/,
  );
  assert.equal(writes(early.calls).length, 0);

  const ok = fakeMp({ preapproval: authorized() });
  const outDir = tmp();
  const result = await run({ argv: ["put-amount", "pre_abcdef123456", "--amount", "19900", "--require-charged", "6", "--execute"], env: TEST_ENV, fetchImpl: ok.fetchImpl, log: quiet, outDir });
  const [put] = writes(ok.calls);
  assert.equal(put.method, "PUT");
  assert.deepEqual(put.body, { auto_recurring: { transaction_amount: 19900, currency_id: "ARS" } });
  assert.equal(result.after.preapproval.auto_recurring.transaction_amount, 19900);
  assert.equal(result.before.preapproval.auto_recurring.transaction_amount, 9900);
});

test("put-amount no cambia el monto de una suscripción cancelada o pausada", async () => {
  for (const status of ["cancelled", "paused"]) {
    const mp = fakeMp({ preapproval: authorized({ status }) });
    await assert.rejects(run({ argv: ["put-amount", "pre_abcdef123456", "--amount", "19900", "--execute"], env: TEST_ENV, fetchImpl: mp.fetchImpl, log: quiet, outDir: tmp() }), /no se cambia el monto/);
    assert.equal(writes(mp.calls).length, 0);
  }
});

test("cancel: DRY-RUN por defecto", async () => {
  const mp = fakeMp({ preapproval: authorized() });
  const result = await run({ argv: ["cancel", "pre_abcdef123456"], env: TEST_ENV, fetchImpl: mp.fetchImpl, log: quiet });
  assert.equal(result.dryRun, true);
  assert.equal(writes(mp.calls).length, 0);
});

test("inspect solo usa el filtro documentado de cuotas (sin limit) y el resumen no contiene datos personales", async () => {
  const mp = fakeMp({ preapproval: authorized(), invoices: { results: [{ id: 1, status: "processed", transaction_amount: 9900, payment: { id: 5, status: "approved" } }] } });
  const result = await run({ argv: ["inspect", "pre_abcdef123456"], env: TEST_ENV, fetchImpl: mp.fetchImpl, log: quiet, outDir: tmp() });
  const search = mp.calls.find((c) => c.route.startsWith("/authorized_payments/search"));
  assert.equal(search.route, "/authorized_payments/search?preapproval_id=pre_abcdef123456");
  assert.equal(result.invoices[0].payment_status, "approved");
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("buyer@testuser.com"));
  assert.equal(snapshotPreapproval(authorized()).payer_email_masked, "bu***@testuser.com");
});

test("el spike no usa la base de la app, el token de producción ni la frecuencia mensual", () => {
  const source = readFileSync("scripts/mp-spike/price-change-spike.mjs", "utf8");
  assert.ok(!/supabase/i.test(source.replace(/Sin Supabase[^\n]*/g, "")));
  assert.ok(!source.includes("process.env.MERCADO_PAGO_ACCESS_TOKEN"));
  assert.ok(!/frequency_type:\s*"months"/.test(source));
});

// ---------------------------------------------------------------------------------------------------------------
// Escenarios A (inmediato) y B (renovación): procedimiento independiente, sin exigir dos cobros.
// ---------------------------------------------------------------------------------------------------------------

test("escenario A: put-amount funciona sin --require-charged, incluso con 0 cobros, y devuelve el veredicto completo", async () => {
  const mp = fakeMp({ preapproval: authorized({ summarized: { charged_quantity: 0 }, next_payment_date: "2026-11-12T12:00:00.000Z" }) });
  const outDir = tmp();
  const result = await run({ argv: ["put-amount", "pre_abcdef123456", "--amount", "19900", "--scenario", "A", "--execute"], env: TEST_ENV, fetchImpl: mp.fetchImpl, log: quiet, outDir });
  assert.equal(writes(mp.calls).length, 1);
  assert.deepEqual(result.verdict, {
    put_accepted: true,
    still_authorized: true,
    amount_applied: true,
    reauthorization_suspected: false,
    next_payment_date_before: "2026-11-12T12:00:00.000Z",
    next_payment_date_after: "2026-11-12T12:00:00.000Z",
    next_payment_date_changed: false,
    status_before: "authorized",
    status_after: "authorized",
  });
});

test("escenario A: si Mercado Pago deja la suscripción fuera de 'authorized' el veredicto lo marca como reautorización", async () => {
  const pending = { ...authorized({ summarized: { charged_quantity: 0 } }) };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const route = String(url).replace("https://api.mercadopago.com", "");
    calls.push({ method, route });
    if (route === "/users/me") return reply(200, { id: 123456789, nickname: "T", site_id: "MLA" });
    if (method === "PUT") {
      pending.status = "pending";
      pending.auto_recurring = { ...pending.auto_recurring, ...JSON.parse(init.body).auto_recurring };
      return reply(200, pending);
    }
    if (route.startsWith("/authorized_payments/search")) return reply(200, { results: [] });
    return reply(200, pending);
  };
  const result = await run({ argv: ["put-amount", "pre_abcdef123456", "--amount", "19900", "--execute"], env: TEST_ENV, fetchImpl, log: quiet, outDir: tmp() });
  assert.equal(result.verdict.put_accepted, true);
  assert.equal(result.verdict.still_authorized, false);
  assert.equal(result.verdict.reauthorization_suspected, true);
});

test("escenario B: --require-charged 1 espera el primer cobro; inspect resume el monto de cada cuota", async () => {
  const noCharge = fakeMp({ preapproval: authorized({ summarized: { charged_quantity: 0 } }) });
  await assert.rejects(
    run({ argv: ["put-amount", "pre_abcdef123456", "--amount", "19900", "--require-charged", "1", "--scenario", "B", "--execute"], env: TEST_ENV, fetchImpl: noCharge.fetchImpl, log: quiet, outDir: tmp() }),
    /Solo hay 0 cobros/,
  );
  assert.equal(writes(noCharge.calls).length, 0);

  const invoices = {
    results: [
      { id: "i2", status: "scheduled", transaction_amount: 19900, currency_id: "ARS", debit_date: "2026-11-14T12:00:00.000Z" },
      { id: "i1", status: "processed", transaction_amount: 9900, currency_id: "ARS", debit_date: "2026-11-12T12:00:00.000Z", payment: { id: 1, status: "approved" } },
    ],
  };
  const mp = fakeMp({ preapproval: authorized(), invoices });
  const result = await run({ argv: ["inspect", "pre_abcdef123456", "--scenario", "B"], env: TEST_ENV, fetchImpl: mp.fetchImpl, log: quiet, outDir: tmp() });
  assert.deepEqual(result.amounts.approved_amounts, [9900]);
  assert.deepEqual(result.amounts.open_amounts, [19900]);
  assert.deepEqual(result.amounts.installments.map((row) => row.debit_date), ["2026-11-12T12:00:00.000Z", "2026-11-14T12:00:00.000Z"]);
});

test("--scenario solo etiqueta (A|B): marca el resultado guardado y el external_reference, y rechaza otros valores antes de llamar a MP", async () => {
  const mp = fakeMp();
  const outDir = tmp();
  await run({ argv: ["create", "--amount", "9900", "--email", "buyer@testuser.com", "--days", "2", "--scenario", "B", "--execute"], env: TEST_ENV, fetchImpl: mp.fetchImpl, log: quiet, outDir });
  const created = mp.calls.find((c) => c.method === "POST");
  assert.ok(created.body.external_reference.startsWith(`${SPIKE_REF_PREFIX}B_`), created.body.external_reference);
  assert.ok(/^[0-9]+$/.test(created.body.external_reference.slice(`${SPIKE_REF_PREFIX}B_`.length)));
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(outDir);
  assert.ok(files.some((name) => name.endsWith("_B_create.json")), files.join(","));
  assert.equal(JSON.parse(readFileSync(path.join(outDir, files[0]), "utf8")).scenario, "B");

  const bad = fakeMp();
  await assert.rejects(run({ argv: ["whoami", "--scenario", "C"], env: TEST_ENV, fetchImpl: bad.fetchImpl, log: quiet }), /--scenario debe ser A o B/);
  assert.equal(bad.calls.length, 0);
});
