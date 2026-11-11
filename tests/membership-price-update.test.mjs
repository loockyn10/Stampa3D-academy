// Mass price update protection: only subscriptions that pay the PREVIOUS list price are repriced.
// Everything runs against fakes: no Mercado Pago, no Supabase, no real subscription is read or changed.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const { applyListPriceToExisting, createMercadoPagoPriceGateway } = loadTs("src/lib/mercadopago/membership-price-update.ts");

const PREVIOUS = 19900;
const NEXT = 24900;

/** Gateway falso con estado: `provider` mapea preapprovalId → {status, amount, currency}. Registra cada llamada. */
function fakeGateway(provider, { updateResult } = {}) {
  const calls = [];
  return {
    calls,
    writes: () => calls.filter((c) => c.op === "update"),
    gateway: {
      async read(id) {
        calls.push({ op: "read", id });
        if (!(id in provider)) return null;
        if (provider[id] instanceof Error) throw provider[id];
        return provider[id];
      },
      async updateAmount(id, amount, currency) {
        calls.push({ op: "update", id, amount, currency });
        if (updateResult) return updateResult(id, amount, currency);
        provider[id] = { ...provider[id], amount };
        return { ok: true, httpStatus: 200, confirmed: provider[id] };
      },
    },
  };
}

const live = (amount, extra = {}) => ({ status: "authorized", amount, currency: "ARS", ...extra });
const sub = (id, amount, preapprovalId = `pre_${id}`) => ({ id, preapprovalId, localAmount: amount });

async function run({ provider, subs, updateResult, previousPrice = PREVIOUS, newPrice = NEXT, onUpdated }) {
  const fake = fakeGateway(provider, { updateResult });
  const persisted = [];
  const summary = await applyListPriceToExisting({
    previousPrice,
    newPrice,
    currency: "ARS",
    subscriptions: subs,
    gateway: fake.gateway,
    onUpdated: onUpdated ?? (async (id, amount) => void persisted.push({ id, amount })),
  });
  return { summary, fake, persisted };
}

test("una suscripción regular (monto de lista anterior en MP y en la base) se actualiza una sola vez", async () => {
  const { summary, fake, persisted } = await run({ provider: { pre_a: live(PREVIOUS) }, subs: [sub("a", "19900.00")] });
  assert.deepEqual(fake.writes(), [{ op: "update", id: "pre_a", amount: NEXT, currency: "ARS" }]);
  assert.deepEqual(persisted, [{ id: "a", amount: NEXT }]);
  assert.equal(summary.updated, 1);
  assert.equal(summary.failed, 0);
});

test("NO toca precios promocionales, suscripciones con descuento ni las pruebas internas de $250", async () => {
  const provider = { pre_promo: live(9900), pre_test1: live(250), pre_test2: live(250), pre_disc: live(15920) };
  const subs = [sub("promo", 9900), sub("test1", "250.00"), sub("test2", "250.00"), sub("disc", 15920)];
  const { summary, fake, persisted } = await run({ provider, subs });
  assert.equal(fake.writes().length, 0, "ningún PUT");
  assert.equal(fake.calls.length, 0, "ni siquiera se consulta a MP: el monto local ya las descarta");
  assert.equal(persisted.length, 0);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 4);
  assert.equal(summary.skippedByReason.local_amount_differs, 4);
});

test("si la base dice precio de lista pero MP informa otro monto, gana MP y no se toca", async () => {
  const { summary, fake } = await run({ provider: { pre_x: live(9900) }, subs: [sub("x", 19900)] });
  assert.equal(fake.writes().length, 0);
  assert.equal(summary.skippedByReason.special_amount, 1);
});

test("lote mixto: solo se envía PUT a las regulares y el resumen cuenta cada caso", async () => {
  const provider = {
    pre_r1: live(PREVIOUS),
    pre_r2: live(PREVIOUS),
    pre_pioneer: live(9900),
    pre_test: live(250),
    pre_paused: { status: "paused", amount: PREVIOUS, currency: "ARS" },
    pre_gone: undefined,
  };
  delete provider.pre_gone;
  const subs = [sub("r1", 19900), sub("pioneer", 9900), sub("r2", 19900), sub("test", 250), sub("paused", 19900), sub("gone", 19900)];
  const { summary, fake } = await run({ provider, subs });
  assert.deepEqual(fake.writes().map((c) => c.id), ["pre_r1", "pre_r2"]);
  assert.equal(summary.updated, 2);
  assert.equal(summary.skipped, 4);
  assert.deepEqual(summary.skippedByReason, { local_amount_differs: 2, provider_not_authorized: 1, provider_unreadable: 1 });
});

test("no actualiza si MP no está autorizada, no se puede leer, falla la lectura o la moneda difiere", async () => {
  const provider = {
    pre_pending: { status: "pending", amount: PREVIOUS, currency: "ARS" },
    pre_cancelled: { status: "cancelled", amount: PREVIOUS, currency: "ARS" },
    pre_usd: { status: "authorized", amount: PREVIOUS, currency: "USD" },
    pre_boom: new Error("network"),
  };
  const subs = [sub("pending", 19900), sub("cancelled", 19900), sub("usd", 19900), sub("boom", 19900), sub("missing", 19900)];
  const { summary, fake } = await run({ provider, subs });
  assert.equal(fake.writes().length, 0);
  assert.deepEqual(summary.skippedByReason, { provider_not_authorized: 2, provider_currency_differs: 1, provider_unreadable: 2 });
});

test("sin precio de lista anterior confiable no se cambia nada", async () => {
  for (const previousPrice of [0, NaN, -1]) {
    const { summary, fake } = await run({ provider: { pre_a: live(19900) }, subs: [sub("a", 19900)], previousPrice });
    assert.equal(fake.calls.length, 0);
    assert.equal(summary.skippedByReason.previous_price_unknown, 1);
  }
});

test("es idempotente: repetir la operación no vuelve a escribir las que ya están al precio nuevo", async () => {
  const provider = { pre_a: live(PREVIOUS), pre_b: live(PREVIOUS) };
  const subs = [sub("a", 19900), sub("b", 19900)];
  const first = await run({ provider, subs });
  assert.equal(first.summary.updated, 2);
  // Segunda pasada: MP ya informa el monto nuevo; la base todavía tiene el anterior (sincronización pendiente).
  const second = await run({ provider, subs });
  assert.equal(second.fake.writes().length, 0);
  assert.equal(second.summary.skippedByReason.already_at_new_price, 2);
  // Y con la base ya sincronizada, tampoco se consulta a MP.
  const third = await run({ provider, subs: [sub("a", NEXT), sub("b", NEXT)] });
  assert.equal(third.fake.calls.length, 0);
  assert.equal(third.summary.skippedByReason.already_at_new_price, 2);
});

test("un PUT rechazado, con error o con respuesta inesperada no se cuenta ni se guarda como actualizado", async () => {
  const cases = [
    [{ ok: false, httpStatus: 400, confirmed: null }, "provider_rejected"],
    [{ ok: true, httpStatus: 200, confirmed: live(PREVIOUS) }, "provider_unexpected_response"],
    [{ ok: true, httpStatus: 200, confirmed: { status: "pending", amount: NEXT, currency: "ARS" } }, "provider_unexpected_response"],
    [{ ok: true, httpStatus: 200, confirmed: null }, "provider_unexpected_response"],
  ];
  for (const [result, reason] of cases) {
    const { summary, persisted } = await run({ provider: { pre_a: live(PREVIOUS) }, subs: [sub("a", 19900)], updateResult: async () => result });
    assert.equal(summary.updated, 0);
    assert.equal(summary.failed, 1);
    assert.equal(summary.items[0].reason, reason);
    assert.equal(persisted.length, 0);
  }

  const thrown = await run({
    provider: { pre_a: live(PREVIOUS) },
    subs: [sub("a", 19900)],
    updateResult: async () => {
      throw new Error("timeout");
    },
  });
  assert.equal(thrown.summary.items[0].reason, "provider_error");
});

test("un fallo en una suscripción no detiene al resto, y un error al guardar en la base no la marca como fallida", async () => {
  const provider = { pre_a: live(PREVIOUS), pre_b: live(PREVIOUS), pre_c: live(PREVIOUS) };
  const { summary } = await run({
    provider,
    subs: [sub("a", 19900), sub("b", 19900), sub("c", 19900)],
    updateResult: async (id, amount) => (id === "pre_b" ? { ok: false, httpStatus: 500, confirmed: null } : { ok: true, httpStatus: 200, confirmed: live(amount) }),
    onUpdated: async () => {
      throw new Error("db down");
    },
  });
  assert.deepEqual(summary.items.map((item) => item.outcome), ["updated", "failed", "updated"]);
});

test("el gateway real solo hace GET de lectura y un PUT con SOLO el importe y la moneda", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
    const body = { id: "pre_a", status: "authorized", auto_recurring: { transaction_amount: init.method === "PUT" ? NEXT : PREVIOUS, currency_id: "ARS" } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const gateway = createMercadoPagoPriceGateway("token-falso", fetchImpl);
  const current = await gateway.read("pre_a");
  assert.deepEqual(current, { status: "authorized", amount: PREVIOUS, currency: "ARS" });
  const updated = await gateway.updateAmount("pre_a", NEXT, "ARS");
  assert.equal(updated.ok, true);
  assert.equal(updated.confirmed.amount, NEXT);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    "GET https://api.mercadopago.com/preapproval/pre_a",
    "PUT https://api.mercadopago.com/preapproval/pre_a",
  ]);
  assert.deepEqual(calls[1].body, { auto_recurring: { transaction_amount: NEXT, currency_id: "ARS" } });

  const failing = createMercadoPagoPriceGateway("token-falso", async () => ({ ok: false, status: 404, text: async () => "" }));
  assert.equal(await failing.read("pre_x"), null);
});

test("la ruta delega en el módulo protegido, no reintroduce un PUT directo y bloquea si falta el precio anterior", () => {
  const route = readRepoFile("src/app/api/admin/membership/update-price/route.ts");
  assert.ok(route.includes("applyListPriceToExisting"));
  assert.ok(!/fetch\(/.test(route), "la ruta no debe llamar a Mercado Pago directamente");
  assert.ok(route.includes("status: 409"));
  assert.ok(route.indexOf("status: 409") < route.indexOf(".upsert("), "el bloqueo ocurre antes de cambiar el precio de lista");
  assert.ok(route.includes("skipped_subscriptions"));

  const page = readRepoFile("src/app/admin/membresia/page.tsx");
  assert.ok(!page.includes("para todos los usuarios actuales"));
  assert.ok(page.includes("importe especial"));
});
