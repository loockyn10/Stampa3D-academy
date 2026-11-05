// P0 Mercado Pago: "empezar un pago nuevo" y correo de la cuenta pagadora. Dobles en memoria: no hay pagos reales.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const { restartPendingCheckout, normalizePayerEmail } = loadTs("src/lib/mercadopago/checkout-restart.ts");

function deps(overrides = {}) {
  const calls = { cancel: [], close: [] };
  const base = {
    calls,
    describeOpenCheckout: async () => ({ attemptId: "a1", state: "completed", amount: 19900, preapprovalId: "pre1", subscriptionStatus: "pending" }),
    getPreapprovalStatus: async () => "pending",
    cancelPreapproval: async (id) => { calls.cancel.push(id); return true; },
    closePendingCheckout: async (id) => { calls.close.push(id); return true; },
  };
  return { ...base, ...overrides, calls };
}

test("pending checkout rejected by the provider: cancelled at MP, closed locally, new attempt allowed", async () => {
  const d = deps();
  assert.deepEqual(await restartPendingCheckout(d), { kind: "proceed" });
  assert.deepEqual(d.calls.cancel, ["pre1"]);
  assert.deepEqual(d.calls.close, ["a1"]);
});

test("user without any checkout: nothing is cancelled", async () => {
  const d = deps({ describeOpenCheckout: async () => null });
  assert.deepEqual(await restartPendingCheckout(d), { kind: "proceed" });
  assert.equal(d.calls.cancel.length, 0);
});

test("never cancels an already approved subscription (local state)", async () => {
  const d = deps({ describeOpenCheckout: async () => ({ attemptId: "a1", state: "completed", amount: 1, preapprovalId: "pre1", subscriptionStatus: "authorized" }) });
  assert.equal((await restartPendingCheckout(d)).kind, "already_subscribed");
  assert.equal(d.calls.cancel.length, 0);
  assert.equal(d.calls.close.length, 0);
});

test("webhook delayed: local pending but authorized at MP -> not cancelled, no double charge", async () => {
  const d = deps({ getPreapprovalStatus: async () => "authorized" });
  const outcome = await restartPendingCheckout(d);
  assert.deepEqual(outcome, { kind: "already_subscribed", status: "authorized" });
  assert.equal(d.calls.cancel.length, 0);
});

test("Mercado Pago status unreadable (temporary error): nothing changes", async () => {
  for (const status of [null]) {
    const d = deps({ getPreapprovalStatus: async () => status });
    assert.deepEqual(await restartPendingCheckout(d), { kind: "failed", reason: "status_unreadable" });
    assert.equal(d.calls.cancel.length, 0);
  }
  const thrown = deps({ getPreapprovalStatus: async () => { throw new Error("boom"); } });
  assert.equal((await restartPendingCheckout(thrown)).kind, "failed");
  assert.equal(thrown.calls.cancel.length, 0);
});

test("cancel not confirmed by MP: local attempt is kept (never two live preapprovals)", async () => {
  const d = deps({ cancelPreapproval: async () => false });
  assert.deepEqual(await restartPendingCheckout(d), { kind: "failed", reason: "cancel_failed" });
  assert.equal(d.calls.close.length, 0);
});

test("Supabase unavailable: fails closed without touching MP", async () => {
  const d = deps({ describeOpenCheckout: async () => { throw new Error("db down"); } });
  assert.deepEqual(await restartPendingCheckout(d), { kind: "failed", reason: "storage_unavailable" });
  assert.equal(d.calls.cancel.length, 0);
});

test("attempt still being created (provider call in flight) is never replaced", async () => {
  const d = deps({ describeOpenCheckout: async () => ({ attemptId: "a1", state: "creating", amount: 1, preapprovalId: null, subscriptionStatus: null }) });
  assert.deepEqual(await restartPendingCheckout(d), { kind: "in_progress" });
  assert.equal(d.calls.cancel.length, 0);
});

test("double click on restart: the concurrent request already closed it -> proceeds, cancel is idempotent", async () => {
  let describes = 0;
  const d = deps({
    describeOpenCheckout: async () => (describes++ === 0 ? { attemptId: "a1", state: "completed", amount: 1, preapprovalId: "pre1", subscriptionStatus: "pending" } : null),
    closePendingCheckout: async () => false,
  });
  assert.deepEqual(await restartPendingCheckout(d), { kind: "proceed" });
});

test("close failure with the old attempt still open does not continue", async () => {
  const d = deps({ closePendingCheckout: async () => false });
  assert.deepEqual(await restartPendingCheckout(d), { kind: "failed", reason: "close_failed" });
});

test("payer email: optional, normalised, malformed values rejected", () => {
  assert.equal(normalizePayerEmail("  Pagador@Gmail.com "), "pagador@gmail.com");
  assert.equal(normalizePayerEmail("no-es-un-email"), null);
  assert.equal(normalizePayerEmail(42), null);
  assert.equal(normalizePayerEmail(`${"a".repeat(260)}@x.com`), null);
});

test("route wiring: payer email defaults to the Universo email, restart re-keys the attempt, member comes from the attempt", async () => {
  const route = await readRepoFile("src/app/api/mercadopago/create-subscription/route.ts");
  assert.match(route, /payerEmail: body\.payerEmail \?\? user\.email/);
  assert.match(route, /restartPendingCheckout\(/);
  assert.match(route, /checkoutInput\.idempotencyKey = randomUUID\(\)/);
  // The restart must run before any checkout is created.
  assert.ok(route.indexOf("restartPendingCheckout(") < route.indexOf("executePlainCheckout(checkoutInput"));
  const sync = await readRepoFile("src/lib/mercadopago/membership-sync.ts");
  assert.match(sync, /findCheckoutAttemptByExternalReference/);
  assert.doesNotMatch(sync, /payer_email/);
});
