// Discount codes in the membership checkout: orchestration with fakes (no payments, no Supabase, no real codes),
// DTO parsing and static guards. Database behaviour lives in tests/discount-codes-db.test.mjs (opt-in, real Postgres).
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const { executeDiscountedCheckout, executePlainCheckout, sameAmount } = loadTs("src/lib/mercadopago/discount-checkout.ts");
const discounts = loadTs("src/lib/discounts/discount-codes.ts");

const USER = "10000000-0000-4000-8000-000000000001";
const input = {
  userId: USER,
  idempotencyKey: "20000000-0000-4000-8000-000000000001",
  amount: 19900,
  currency: "ARS",
  payerEmail: "member@example.com",
  reason: "Membresía Academia Stampa",
  backUrl: "https://example.com/pago/estado",
};

const reserved = (overrides = {}) => ({
  ok: true,
  status: "reserved",
  message: "Código aplicado.",
  baseAmount: 19900,
  finalAmount: 15920,
  discountAmount: 3980,
  reservationId: "r1",
  ...overrides,
});
const ready = (attemptId = "a1") => ({ kind: "ready", attemptId, preapprovalId: "pre_1", initPoint: "https://mp.test/1", reused: false });

function makeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    calls,
    reserve: async () => { calls.push("reserve"); return reserved(); },
    checkout: async (checkoutInput) => { calls.push(`checkout:${checkoutInput.amount}:${checkoutInput.idempotencyKey}`); return ready(); },
    attach: async () => { calls.push("attach"); return "attached"; },
    release: async (id) => { calls.push(`release:${id}`); },
    describeOpenCheckout: async () => { calls.push("describe"); return { attemptId: "a1", state: "completed", amount: 19900, preapprovalId: "pre_old", subscriptionStatus: "pending" }; },
    cancelPreapproval: async (id) => { calls.push(`cancel:${id}`); return true; },
    closePendingCheckout: async (id) => { calls.push(`close:${id}`); return true; },
    newIdempotencyKey: () => "30000000-0000-4000-8000-000000000009",
    ...overrides,
  };
  return deps;
}

test("valid code: the checkout is created at the amount reserved by the database, never at the client's price", async () => {
  const deps = makeDeps();
  const out = await executeDiscountedCheckout(input, deps);
  assert.equal(out.kind, "checkout");
  assert.equal(out.result.kind, "ready");
  assert.deepEqual(out.discount, { baseAmount: 19900, finalAmount: 15920 });
  assert.deepEqual(deps.calls, ["reserve", `checkout:15920:${input.idempotencyKey}`, "attach"]);
});

test("every rejected code stops before any checkout or provider call", async () => {
  for (const status of ["invalid", "expired", "exhausted", "unsupported", "no_benefit", "already_used", "rate_limited"]) {
    const deps = makeDeps({ reserve: async () => { deps.calls.push("reserve"); return discounts.discountFailure(status); } });
    const out = await executeDiscountedCheckout(input, deps);
    assert.equal(out.kind, "discount_rejected", status);
    assert.equal(out.status, status);
    assert.deepEqual(deps.calls, ["reserve"], status);
  }
});

test("an unavailable discount service never falls back to charging the full price silently", async () => {
  const deps = makeDeps({ reserve: async () => { throw new Error("db down"); } });
  const out = await executeDiscountedCheckout(input, deps);
  assert.equal(out.kind, "discount_unavailable");
  assert.deepEqual(deps.calls, []);
});

test("a reservation without id or with a non-lower price is not trusted", async () => {
  for (const bad of [reserved({ reservationId: null }), reserved({ finalAmount: 19900 }), reserved({ finalAmount: null }), reserved({ ok: false })]) {
    const deps = makeDeps({ reserve: async () => bad });
    const out = await executeDiscountedCheckout(input, deps);
    assert.equal(out.kind, "discount_rejected");
    assert.equal(deps.calls.includes(`checkout:${bad.finalAmount}:${input.idempotencyKey}`), false);
    assert.equal(deps.calls.some((c) => c.startsWith("checkout")), false);
  }
});

test("checkout failures release the reserved use (an unpaid checkout never burns a use)", async () => {
  for (const result of [
    { kind: "provider_error", code: "mp_http_400", message: "x" },
    { kind: "blocked_existing_subscription", subscriptionId: "s", subscriptionStatus: "authorized", preapprovalId: "p" },
    { kind: "closed_attempt", attemptId: "a" },
    { kind: "storage_error", phase: "before_provider", message: "x" },
  ]) {
    const deps = makeDeps({ checkout: async () => { deps.calls.push("checkout"); return result; } });
    const out = await executeDiscountedCheckout(input, deps);
    assert.equal(out.kind, "checkout");
    assert.equal(out.result.kind, result.kind);
    assert.equal(out.discount, null);
    assert.deepEqual(deps.calls, ["reserve", "checkout", "release:r1"], result.kind);
  }
});

test("a checkout waiting for reconciliation keeps its reservation attached", async () => {
  const deps = makeDeps({ checkout: async () => ({ kind: "reconciliation_pending", attemptId: "a9", message: "m" }) });
  const out = await executeDiscountedCheckout(input, deps);
  assert.equal(out.kind, "checkout");
  assert.equal(out.result.kind, "reconciliation_pending");
  assert.deepEqual(out.discount, { baseAmount: 19900, finalAmount: 15920 });
  assert.deepEqual(deps.calls, ["reserve", "attach"]);
});

test("if the discount cannot be recorded the request fails closed and keeps the reservation for the idempotent retry", async () => {
  const deps = makeDeps({ attach: async () => { throw new Error("db down"); } });
  const out = await executeDiscountedCheckout(input, deps);
  assert.equal(out.kind, "discount_persistence_pending");
  assert.equal(deps.calls.some((c) => c.startsWith("release")), false);
});

test("a pending checkout without the discount is replaced: cancelled at Mercado Pago first, then closed, then recreated", async () => {
  let attaches = 0;
  let checkouts = 0;
  const deps = makeDeps({
    checkout: async (checkoutInput) => {
      deps.calls.push(`checkout:${checkoutInput.amount}:${checkoutInput.idempotencyKey}`);
      checkouts += 1;
      return ready(checkouts === 1 ? "a1" : "a2");
    },
    attach: async () => { deps.calls.push("attach"); attaches += 1; return attaches === 1 ? "amount_mismatch" : "attached"; },
  });
  const out = await executeDiscountedCheckout(input, deps);
  assert.equal(out.kind, "checkout");
  assert.equal(out.result.attemptId, "a2");
  assert.deepEqual(out.discount, { baseAmount: 19900, finalAmount: 15920 });
  assert.deepEqual(deps.calls, [
    "reserve",
    `checkout:15920:${input.idempotencyKey}`,
    "attach",
    "describe",
    "cancel:pre_old",
    "close:a1",
    "checkout:15920:30000000-0000-4000-8000-000000000009",
    "attach",
  ]);
});

test("if Mercado Pago does not confirm the cancellation nothing is closed or recreated and the use is released", async () => {
  for (const cancelPreapproval of [async () => false, async () => { throw new Error("timeout"); }]) {
    let attaches = 0;
    const deps = makeDeps({
      attach: async () => { deps.calls.push("attach"); attaches += 1; return "amount_mismatch"; },
      cancelPreapproval: async (id) => { deps.calls.push(`cancel:${id}`); return cancelPreapproval(); },
    });
    const out = await executeDiscountedCheckout(input, deps);
    assert.equal(out.kind, "checkout_conflict");
    assert.equal(out.reason, "supersede_failed");
    assert.equal(deps.calls.some((c) => c.startsWith("close")), false);
    assert.equal(deps.calls.filter((c) => c.startsWith("checkout")).length, 1);
    assert.equal(deps.calls.at(-1), "release:r1");
    assert.equal(attaches, 1);
  }
});

test("an authorized, active or paused subscription is never replaced and gets no discount", async () => {
  for (const subscriptionStatus of ["authorized", "active", "paused", null]) {
    const deps = makeDeps({
      attach: async () => { deps.calls.push("attach"); return "amount_mismatch"; },
      describeOpenCheckout: async () => ({ attemptId: "a1", state: "completed", amount: 19900, preapprovalId: "pre_old", subscriptionStatus }),
    });
    const out = await executeDiscountedCheckout(input, deps);
    assert.equal(out.kind, "checkout");
    assert.equal(out.result.kind, "blocked_existing_subscription");
    assert.equal(out.discount, null);
    assert.equal(deps.calls.some((c) => c.startsWith("cancel") || c.startsWith("close")), false);
    assert.equal(deps.calls.at(-1), "release:r1");
  }
});

test("an attempt that is still being created is never replaced", async () => {
  const deps = makeDeps({
    attach: async () => "amount_mismatch",
    describeOpenCheckout: async () => ({ attemptId: "a1", state: "creating", amount: 19900, preapprovalId: null, subscriptionStatus: null }),
  });
  const out = await executeDiscountedCheckout(input, deps);
  assert.deepEqual(out, { kind: "checkout_conflict", reason: "in_progress" });
  assert.equal(deps.calls.some((c) => c.startsWith("cancel") || c.startsWith("close")), false);
});

test("the replacement never loops: a second amount mismatch ends in a conflict", async () => {
  const deps = makeDeps({ attach: async () => { deps.calls.push("attach"); return "amount_mismatch"; } });
  const out = await executeDiscountedCheckout(input, deps);
  assert.equal(out.kind, "checkout_conflict");
  assert.equal(deps.calls.filter((c) => c === "attach").length, 2);
  assert.equal(deps.calls.filter((c) => c.startsWith("cancel")).length, 1);
});

test("a reservation that no longer holds its seat is reported, never silently kept (no discounted checkout without a seat)", async () => {
  for (const attached of ["not_reservable", "not_found"]) {
    const deps = makeDeps({ attach: async () => { deps.calls.push("attach"); return attached; } });
    const out = await executeDiscountedCheckout(input, deps);
    assert.deepEqual(out, { kind: "checkout_conflict", reason: "reservation_lost" }, attached);
    assert.equal(deps.calls.at(-1), "release:r1");
    assert.equal(deps.calls.some((c) => c.startsWith("cancel") || c.startsWith("close")), false);
  }
});

// ---------------------------------------------------------------------------
// A tiny model of "begin_membership_checkout + Mercado Pago": ONE open attempt per user, handed back whatever the key
// is (exactly what the database does), plus the cancel / close semantics of the real flow.
// ---------------------------------------------------------------------------

function world({ openAmount = null, subscriptionStatus = "pending", cancelOk = true, closeOk = true, describeThrows = false } = {}) {
  const calls = [];
  const attempts = [];
  if (openAmount !== null) attempts.push({ id: "a1", amount: openAmount, state: "completed", sub: subscriptionStatus, pre: "pre_a1", open: true });
  const open = () => attempts.find((a) => a.open);
  const deps = {
    calls,
    attempts,
    cancelled: [],
    checkout: async (checkoutInput) => {
      calls.push(`checkout:${checkoutInput.amount}:${checkoutInput.idempotencyKey.slice(-2)}`);
      const current = open();
      if (current) return { kind: "ready", attemptId: current.id, preapprovalId: current.pre, initPoint: `https://mp.test/${current.id}`, reused: true };
      const id = `a${attempts.length + 1}`;
      attempts.push({ id, amount: checkoutInput.amount, state: "completed", sub: "pending", pre: `pre_${id}`, open: true });
      return { kind: "ready", attemptId: id, preapprovalId: `pre_${id}`, initPoint: `https://mp.test/${id}`, reused: false };
    },
    describeOpenCheckout: async () => {
      calls.push("describe");
      if (describeThrows) throw new Error("rpc missing");
      const current = open();
      return current ? { attemptId: current.id, state: current.state, amount: current.amount, preapprovalId: current.pre, subscriptionStatus: current.sub } : null;
    },
    cancelPreapproval: async (id) => {
      calls.push(`cancel:${id}`);
      if (cancelOk) deps.cancelled.push(id);
      return cancelOk;
    },
    closePendingCheckout: async (id) => {
      calls.push(`close:${id}`);
      const attempt = attempts.find((a) => a.id === id);
      if (!closeOk || !attempt || !attempt.open) return false;
      attempt.open = false;
      return true;
    },
    newIdempotencyKey: (() => { let n = 0; return () => `40000000-0000-4000-8000-0000000000${String(++n).padStart(2, "0")}`; })(),
    openAttempts: () => attempts.filter((a) => a.open),
  };
  return deps;
}

test("code removed: the checkout that carried the discount is replaced by one at the list price (no reuse of the old link)", async () => {
  const w = world({ openAmount: 15920 });
  const out = await executePlainCheckout(input, w);
  assert.equal(out.kind, "checkout");
  assert.equal(out.result.kind, "ready");
  assert.equal(out.result.attemptId, "a2");
  assert.equal(out.result.initPoint, "https://mp.test/a2");
  assert.deepEqual(w.calls, ["checkout:19900:01", "describe", "cancel:pre_a1", "close:a1", "checkout:19900:01", "describe"]);
  // Exactly one live checkout, at the list price; the old preapproval was cancelled before anything new was created.
  assert.deepEqual(w.openAttempts().map((a) => [a.id, a.amount]), [["a2", 19900]]);
  assert.deepEqual(w.cancelled, ["pre_a1"]);
  assert.ok(w.calls.indexOf("cancel:pre_a1") < w.calls.lastIndexOf("checkout:19900:01"));
});

test("retries after the replacement are idempotent: same checkout, no second cancellation, no duplicate charge", async () => {
  const w = world({ openAmount: 15920 });
  await executePlainCheckout(input, w);
  w.calls.length = 0;
  for (let i = 0; i < 3; i++) {
    const out = await executePlainCheckout(input, w);
    assert.equal(out.result.attemptId, "a2");
    assert.equal(out.result.reused, true);
  }
  assert.equal(w.calls.some((c) => c.startsWith("cancel") || c.startsWith("close")), false);
  assert.equal(w.openAttempts().length, 1);
  assert.equal(w.cancelled.length, 1);
});

test("a double click while replacing yields one live checkout at the list price for both requests", async () => {
  const w = world({ openAmount: 15920 });
  const [a, b] = await Promise.all([executePlainCheckout(input, w), executePlainCheckout(input, w)]);
  for (const out of [a, b]) {
    assert.equal(out.kind, "checkout");
    assert.equal(out.result.kind, "ready");
    assert.equal(w.attempts.find((x) => x.id === out.result.attemptId).amount, 19900);
  }
  assert.equal(a.result.attemptId, b.result.attemptId);
  assert.equal(w.openAttempts().length, 1);
  assert.equal(w.attempts.length, 2, "only one replacement was created");
});

test("checkout without discount and nothing stale is the unchanged flow: one lookup, no cancellation", async () => {
  const w = world({ openAmount: 19900 });
  const out = await executePlainCheckout(input, w);
  assert.equal(out.result.attemptId, "a1");
  assert.deepEqual(w.calls, ["checkout:19900:01", "describe"]);
  assert.equal(w.attempts.length, 1);
});

test("a brand-new checkout (nothing reused) never needs the extra lookup", async () => {
  const w = world();
  const out = await executePlainCheckout(input, w);
  assert.equal(out.result.reused, false);
  assert.deepEqual(w.calls, ["checkout:19900:01"]);
});

test("without the discount migration (lookup unavailable) the plain checkout behaves exactly as before", async () => {
  const w = world({ openAmount: 15920, describeThrows: true });
  const out = await executePlainCheckout(input, w);
  assert.equal(out.kind, "checkout");
  assert.equal(out.result.attemptId, "a1");
  assert.equal(w.calls.some((c) => c.startsWith("cancel") || c.startsWith("close")), false);
});

test("an authorized / active / paused subscription is never rewritten, even when its amount differs", async () => {
  for (const subscriptionStatus of ["authorized", "active", "paused", null]) {
    const w = world({ openAmount: 15920, subscriptionStatus });
    const out = await executePlainCheckout(input, w);
    assert.equal(out.kind, "checkout");
    assert.equal(out.result.attemptId, "a1");
    assert.equal(w.calls.some((c) => c.startsWith("cancel") || c.startsWith("close")), false, String(subscriptionStatus));
    assert.equal(w.openAttempts().length, 1);
  }
});

test("attempts still being created or reconciled are never touched", async () => {
  const w = world({ openAmount: 15920 });
  w.checkout = async () => { w.calls.push("checkout"); return { kind: "reconciliation_pending", attemptId: "a1", message: "m" }; };
  const out = await executePlainCheckout(input, w);
  assert.equal(out.result.kind, "reconciliation_pending");
  assert.deepEqual(w.calls, ["checkout"]);

  const creating = world({ openAmount: 15920 });
  creating.attempts[0].state = "creating";
  const outCreating = await executePlainCheckout(input, creating);
  assert.deepEqual(outCreating, { kind: "checkout_conflict", reason: "in_progress" });
  assert.equal(creating.calls.some((c) => c.startsWith("cancel") || c.startsWith("close")), false);
});

test("if Mercado Pago does not confirm the cancellation nothing changes and no new checkout is created", async () => {
  const w = world({ openAmount: 15920, cancelOk: false });
  const out = await executePlainCheckout(input, w);
  assert.deepEqual(out, { kind: "checkout_conflict", reason: "supersede_failed" });
  assert.equal(w.calls.some((c) => c.startsWith("close")), false);
  assert.equal(w.attempts.length, 1);
  assert.equal(w.openAttempts().length, 1);
  assert.equal(w.calls.filter((c) => c.startsWith("checkout")).length, 1);
});

test("if the old attempt cannot be closed and is still open, no second checkout is created", async () => {
  const w = world({ openAmount: 15920, closeOk: false });
  const out = await executePlainCheckout(input, w);
  assert.deepEqual(out, { kind: "checkout_conflict", reason: "supersede_failed" });
  assert.equal(w.attempts.length, 1);
  assert.equal(w.calls.filter((c) => c.startsWith("checkout")).length, 1);
});

test("a replacement that cannot be created reports the provider outcome and leaves no live checkout behind", async () => {
  const w = world({ openAmount: 15920 });
  const original = w.checkout;
  w.checkout = async (checkoutInput) => {
    if (!w.openAttempts().length) { w.calls.push("checkout:fail"); return { kind: "provider_error", code: "mp_http_400", message: "x" }; }
    return original(checkoutInput);
  };
  const out = await executePlainCheckout(input, w);
  assert.equal(out.kind, "checkout");
  assert.equal(out.result.kind, "provider_error");
  assert.equal(w.openAttempts().length, 0);
});

test("whatever answers after a replacement must really carry the list price", async () => {
  const w = world({ openAmount: 15920 });
  const describe = w.describeOpenCheckout;
  let lookups = 0;
  w.describeOpenCheckout = async () => {
    lookups += 1;
    const answer = await describe();
    return lookups >= 2 && answer ? { ...answer, amount: 15920 } : answer;
  };
  const out = await executePlainCheckout(input, w);
  assert.deepEqual(out, { kind: "checkout_conflict", reason: "amount_mismatch" });
});

test("apply code → remove code → apply again: one live checkout at a time, always matching what the user confirmed", async () => {
  const w = world();
  let reservations = 0;
  const discountDeps = () => ({
    ...w,
    reserve: async () => { reservations += 1; return reserved({ reservationId: `r${reservations}` }); },
    attach: async ({ attemptId }) => (w.attempts.find((a) => a.id === attemptId).amount === 15920 ? "attached" : "amount_mismatch"),
    release: async () => {},
  });
  const liveAmount = () => w.openAttempts().map((a) => a.amount);

  const plain = await executePlainCheckout(input, w);
  assert.equal(plain.result.reused, false);
  assert.deepEqual(liveAmount(), [19900]);

  const withCode = await executeDiscountedCheckout(input, discountDeps());
  assert.equal(withCode.kind, "checkout");
  assert.deepEqual(withCode.discount, { baseAmount: 19900, finalAmount: 15920 });
  assert.deepEqual(liveAmount(), [15920]);

  const removed = await executePlainCheckout(input, w);
  assert.equal(removed.kind, "checkout");
  assert.deepEqual(liveAmount(), [19900]);

  const again = await executeDiscountedCheckout(input, discountDeps());
  assert.equal(again.kind, "checkout");
  assert.deepEqual(liveAmount(), [15920]);

  // Two replacements = two cancellations of never-authorized preapprovals; never more than one live preapproval.
  assert.equal(w.cancelled.length, 3);
  assert.equal(new Set(w.cancelled).size, 3);
  assert.equal(w.openAttempts().length, 1);
});

test("amounts are compared to the cent", () => {
  assert.equal(sameAmount(19900, 19900), true);
  assert.equal(sameAmount(15920, 15920.0), true);
  assert.equal(sameAmount(19900.001, 19900), true);
  assert.equal(sameAmount(15920, 19900), false);
  assert.equal(sameAmount(19900, 19900.01), false);
  assert.equal(sameAmount(Number.NaN, 19900), false);
});

// ---------------------------------------------------------------------------
// DTOs and switches
// ---------------------------------------------------------------------------

test("RPC payloads map to known statuses and a benefit needs two valid amounts with a lower final price", () => {
  const ok = discounts.toDiscountReservation({ status: "reserved", reservation_id: "r", base_amount: "19900.00", final_amount: "15920.00" });
  assert.equal(ok.ok, true);
  assert.equal(ok.finalAmount, 15920);
  assert.equal(ok.discountAmount, 3980);
  assert.equal(ok.reservationId, "r");

  for (const bad of [
    { status: "reserved", base_amount: 100, final_amount: 100, reservation_id: "r" },
    { status: "reserved", base_amount: 100, final_amount: 120, reservation_id: "r" },
    { status: "reserved", base_amount: 100, final_amount: 50 },
    { status: "ok", base_amount: 100, final_amount: 0 },
    { status: "weird" },
    null,
    "x",
  ]) {
    const out = discounts.toDiscountReservation(bad);
    assert.equal(out.ok, false);
    assert.equal(out.finalAmount, null);
  }
  assert.equal(discounts.toDiscountReservation({ status: "weird" }).status, "error");
  for (const status of ["invalid", "expired", "exhausted", "unsupported", "no_benefit", "already_used", "rate_limited"]) {
    const out = discounts.toDiscountReservation({ status, final_amount: 1 });
    assert.equal(out.ok, false);
    assert.equal(out.finalAmount, null);
    assert.ok(out.message.length > 5);
  }
});

test("the browser DTO never carries the reservation id", () => {
  const preview = discounts.toDiscountPreview(discounts.toDiscountReservation({ status: "ok", base_amount: 100, final_amount: 80 }));
  assert.deepEqual(Object.keys(preview).sort(), ["baseAmount", "discountAmount", "finalAmount", "message", "ok", "status"]);
  assert.equal(preview.finalAmount, 80);
});

test("codes normalize like the admin panel and the kill switch is only on for the exact string 'true'", () => {
  assert.equal(discounts.normalizeDiscountCode("  promo 20  "), "PROMO-20");
  assert.equal(discounts.discountCodesEnabled({ DISCOUNT_CODES_ENABLED: "true" }), true);
  for (const value of [undefined, "", "false", "TRUE", "1", "yes"]) {
    assert.equal(discounts.discountCodesEnabled({ DISCOUNT_CODES_ENABLED: value }), false, String(value));
  }
});

// ---------------------------------------------------------------------------
// Static guards: wiring, security and non-regression of the plain checkout
// ---------------------------------------------------------------------------

const route = readRepoFile("src/app/api/mercadopago/create-subscription/route.ts");
const priceHelper = readRepoFile("src/lib/mercadopago/membership-price.ts");
const webhook = readRepoFile("src/app/api/mercadopago/webhook/route.ts");
const sync = readRepoFile("src/app/api/mercadopago/sync-subscription/route.ts");
const actions = readRepoFile("src/app/sin-acceso/actions.ts");
const client = readRepoFile("src/app/sin-acceso/sin-acceso-client.tsx");
const field = readRepoFile("src/components/membership/DiscountCodeField.tsx");
const repository = readRepoFile("src/lib/discounts/repository.ts");
const orchestrator = readRepoFile("src/lib/mercadopago/discount-checkout.ts");
const admin = readRepoFile("src/app/admin/codigos/page.tsx");
const migration = readRepoFile("supabase/migrations/20261029120000_discount_code_checkout.sql").replace(/--.*$/gm, "");

test("checkout: the list price comes only from membership_settings / the env fallback, and the body never carries an amount", () => {
  assert.match(priceHelper, /from\("membership_settings"\)\s*\.select\("monthly_price, currency"\)/);
  assert.match(priceHelper, /process\.env\.MEMBERSHIP_MONTHLY_PRICE/);
  assert.match(route, /loadMembershipPrice\(supabaseAdmin\)/);
  assert.match(route, /\(body as Record<string, unknown>\)\.idempotency_key/);
  assert.match(route, /\(body as Record<string, unknown>\)\.discount_code/);
  // Nothing else is read from the request: no price, amount, percentage or reservation.
  const bodyReads = [...route.matchAll(/\(body as Record<string, unknown>\)\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(bodyReads)].sort(), ["discount_code", "idempotency_key"]);
  assert.doesNotMatch(route, /request\.json\(\)|searchParams|formData/);
});

test("checkout without a code is the unchanged flow (same input, same result mapping)", () => {
  assert.match(route, /if \(!body\.discountCode\) \{[\s\S]*?executePlainCheckout\(checkoutInput, replacementDependencies\)[\s\S]*?respondToCheckoutResult\(plain\.result\)/);
  assert.match(route, /checkout: \(input: typeof checkoutInput\) => executeCheckout\(input, dependencies\)/);
  assert.match(route, /amount: price,/);
  for (const code of ["checkout_reconciliation_pending", "existing_subscription", "checkout_attempt_closed", "checkout_persistence_pending", "checkout_storage_unavailable"]) {
    assert.ok(route.includes(code), code);
  }
});

test("kill switch: with it off a code is refused before anything is reserved, never ignored", () => {
  const guard = route.indexOf("body.discountCode && !discountCodesEnabled()");
  assert.ok(guard > 0);
  assert.match(route.slice(guard, guard + 300), /discount_codes_disabled[\s\S]*409/);
  assert.ok(guard < route.indexOf("reserveDiscountCode(supabaseAdmin"));
  assert.ok(guard < route.indexOf("createSupabaseClient(supabaseUrl"));
});

test("checkout: identity comes from the session, the code is reserved server-side and only the text is trusted", () => {
  assert.match(route, /reserveDiscountCode\(supabaseAdmin, \{ userId: user\.id, code, baseAmount: price, currency \}\)/);
  assert.doesNotMatch(route, /userId: body|user_id: body/);
  assert.match(orchestrator, /amount: discount\.finalAmount/);
  assert.match(orchestrator, /reservation\.status !== "reserved"/);
  assert.match(route, /outcome\.status === "rate_limited" \? 429 : 422/);
});

test("webhook and sync-subscription consume the use on authorization and free it on cancellation, without blocking the membership update", () => {
  for (const source of [webhook, sync]) {
    assert.match(source, /confirmDiscountReservation\(supabaseAdmin, String\(preapproval/);
    assert.match(source, /releaseDiscountForPreapproval\(supabaseAdmin, String\(preapproval/);
    assert.match(source, /"authorized"/);
  }
  // Inside try/catch and after the profile update: a failure only logs.
  assert.match(webhook, /try \{\s*if \(status === "authorized"\) \{\s*await confirmDiscountReservation[\s\S]*?\} catch \(discountErr/);
  assert.ok(webhook.indexOf("confirmDiscountReservation(supabaseAdmin") > webhook.indexOf("profileUpdates.membership_status = \"active\""));
  assert.match(sync, /try \{\s*if \(mpStatus === "authorized"\)[\s\S]*?\} catch \(discountError\)/);
});

test("preview action: session user only, dry run, safe DTO, kill switch", () => {
  assert.match(actions, /discountCodesEnabled\(\)\) return toDiscountPreview\(discountFailure\("disabled"\)\)/);
  assert.match(actions, /supabase\.auth\.getUser\(\)/);
  assert.match(actions, /userId: user\.id/);
  assert.match(actions, /dryRun: true/);
  assert.doesNotMatch(actions, /previewDiscountCodeAction\([^)]*userId/);
  assert.doesNotMatch(actions, /reservationId/);
  assert.match(actions, /return toDiscountPreview\(reservation\)/);
});

test("UI: the field only exists with the switch on; the request carries the code text and a key per code", () => {
  assert.match(client, /discountCodesEnabled && !loadingPrice && price && \(/);
  assert.match(client, /JSON\.stringify\(discountCode \? \{ idempotency_key: idempotencyKey, discount_code: discountCode \} : \{ idempotency_key: idempotencyKey \}\)/);
  assert.match(client, /getCheckoutIdempotencyKey\(discountCode\)/);
  assert.match(client, /\(stored\.code \?\? null\) === discountCode/);
  assert.doesNotMatch(client, /final_amount|"amount"|price: /);
  assert.match(field, /aria-live="polite"/);
  assert.match(field, /htmlFor="discount-code"/);
  assert.match(field, /text-base[^"]*sm:text-sm/);
  assert.match(field, /min-w-0/);
  assert.match(read("src/app/sin-acceso/page.tsx"), /discountCodesEnabled=\{discountCodesEnabled\(\)\}/);
});

function read(file) {
  return readRepoFile(file);
}

test("database RPCs are called with service-level wrappers only and never expose raw errors", () => {
  for (const rpc of ["reserve_discount_code", "attach_discount_reservation", "release_discount_reservation", "describe_open_checkout", "close_pending_checkout", "confirm_discount_reservation", "release_discount_reservation_for_preapproval"]) {
    assert.ok(repository.includes(`"${rpc}"`), rpc);
  }
  assert.doesNotMatch(repository, /error\.message|error\.details|error\.hint/);
});

test("migration: service_role only, RLS on, additive, no weakened policies", () => {
  assert.doesNotMatch(migration, /grant execute on function[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i);
  assert.doesNotMatch(migration, /grant (select|insert|update|delete|all)[^;]*\bto\b[^;]*\b(anon|authenticated)\b/i);
  assert.match(migration, /alter table public\.discount_code_reservations enable row level security/);
  assert.match(migration, /revoke all on table public\.discount_code_reservations from anon, authenticated/);
  const withoutStrings = migration.replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(withoutStrings, /\b(drop\s+(table|function|policy|index)|truncate\s|create\s+policy|alter\s+table\s+public\.(invite_codes|checkout_attempts|subscriptions|profiles))/i);
  assert.doesNotMatch(migration, /update\s+public\.profiles|has_platform_access/i);
  // Only the documented, same-user supersede closes a checkout; nothing deletes data.
  assert.doesNotMatch(withoutStrings, /delete\s+from\s+public\.(invite_codes|invite_code_redemptions|checkout_attempts|subscriptions|discount_code_reservations)/i);
  assert.match(migration, /lower\(coalesce\(v_sub\.status, ''\)\) <> 'pending'/);
});

test("admin panel: first-month-only codes cannot be saved and the 100% / invalid cases are refused", () => {
  assert.match(admin, /discountDuration === "once"/);
  assert.match(admin, /<option value="once" disabled>/);
  assert.match(admin, /codeType === "discount_percent" && val >= 100/);
  assert.match(admin, /DISCOUNT_CODES_ENABLED=true/);
});

// ---------------------------------------------------------------------------
// Seat accounting migration (20261030120000) and wiring of the review fixes
// ---------------------------------------------------------------------------

const consistency = readRepoFile("supabase/migrations/20261030120000_discount_checkout_consistency.sql").replace(/--.*$/gm, "");

test("seat accounting migration: requires the base migration, additive, service_role only, previous migration untouched", () => {
  assert.match(consistency, /Apply 20261029120000_discount_code_checkout\.sql first/);
  assert.match(consistency, /add column if not exists over_limit boolean not null default false/);
  const withoutStrings = consistency.replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(withoutStrings, /\b(drop\s+(table|function|policy|index|column)|truncate\s|create\s+policy|alter\s+table\s+public\.(invite_codes|checkout_attempts|subscriptions|profiles))/i);
  assert.doesNotMatch(withoutStrings, /delete\s+from\s+public\.(invite_codes|invite_code_redemptions|checkout_attempts|subscriptions|discount_code_reservations)/i);
  assert.doesNotMatch(consistency, /grant execute on function[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i);
  assert.match(consistency, /revoke all on function public\.discount_reservation_holds_seat\(text, uuid, timestamptz, timestamptz\) from public, anon, authenticated/);
  // The already-delivered migration is not edited: the fix ships as a new file.
  assert.doesNotMatch(migration, /discount_reservation_holds_seat|over_limit/);
});

test("seat accounting: one definition of 'holds its seat' shared by reserve and confirm; the clock only applies to unattached reservations", () => {
  assert.match(consistency, /when p_attempt_id is null then p_expires_at > p_now/);
  assert.match(consistency, /a\.state in \('creating', 'reconciliation_required', 'completed'\)/);
  const uses = consistency.match(/discount_reservation_holds_seat\(/g) ?? [];
  assert.ok(uses.length >= 5, "used by capacity, sweep, own-reservation reuse and confirm");
  // Lock order: the code row first, then the reservation (same as reserve).
  assert.ok(consistency.indexOf("from public.invite_codes where id = v_res.invite_code_id for update") < consistency.indexOf("from public.discount_code_reservations where id = v_res.id for update"));
  // A late authorization is never refused or cancelled: it is recorded, flagged when the limit was reached.
  assert.match(consistency, /confirmed_over_limit/);
  assert.match(consistency, /over_limit = v_over/);
  assert.doesNotMatch(consistency, /raise exception[^;]*(limit|exhaust)/i);
});

test("late authorizations over the limit are logged for the commercial decision, never swallowed or turned into an error", () => {
  assert.match(repository, /confirmed_over_limit/);
  assert.match(repository, /console\.warn\("\[discount\] authorization confirmed beyond the code limit"/);
});

test("route: plain checkout goes through the stale-price guard and conflicts never charge anything", () => {
  assert.match(route, /executePlainCheckout/);
  assert.match(route, /conflictResponse\(plain\.reason, false\)/);
  assert.match(route, /No se cambió nada ni se cobró/);
  assert.match(route, /reservation_lost/);
  assert.match(orchestrator, /return \{ kind: "checkout", result \};\s*\n\s*\n\s*let open/);
});
