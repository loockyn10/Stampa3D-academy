// Sprint 1.1 — automatic reconciliation (Vercel Cron) of memberships with Mercado Pago, for lost webhooks.
// Mercado Pago and Supabase are in-memory doubles: no network, no real charges.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  NOW,
  SECRET,
  USER_A,
  USER_B,
  addMonthsIso,
  billing,
  cronAuth,
  reconcile,
  signedRequest,
  sync,
  webhook,
  world,
} from "./helpers/membership-fakes.mjs";

const PRE = "2c9380848f5e2a6a018f6a0000000001";
const REF = "stampa_checkout_00000000000040008000000000000001";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const firstCharge = NOW.toISOString();
const renewalDate = addMonthsIso(firstCharge, 1, 0);

/** A member who paid the first month (activated by webhook), as of NOW. */
async function paidMember() {
  const w = world();
  w.store.addProfile(USER_A);
  w.store.addPendingSubscription(USER_A, PRE, REF);
  w.mp.addPreapproval(PRE, { external_reference: REF, status: "authorized", next_payment_date: renewalDate });
  w.mp.addInvoice("7001", PRE, { debitDate: firstCharge });
  await webhook.handleMembershipWebhook(signedRequest({ topic: "subscription_authorized_payment", dataId: "7001" }), {
    secret: SECRET,
    dependencies: { ...w.deps, eventLog: w.eventLog },
  });
  assert.equal(w.profile(USER_A).membershipExpiresAt, addMonthsIso(firstCharge, 1));
  return w;
}

/** Mercado Pago charged the renewal (approved or rejected) but the webhook never arrived. */
function renewalWithoutWebhook(w, paymentStatus = "approved") {
  w.setNow(new Date(new Date(renewalDate).getTime() + 2 * HOUR));
  w.mp.addInvoice("7002", PRE, { debitDate: renewalDate, paymentStatus, status: paymentStatus === "approved" ? "processed" : "recycling" });
  w.mp.preapprovals.get(PRE).next_payment_date = addMonthsIso(renewalDate, 1, 0);
}

const run = (w, input = {}) => reconcile.reconcileMemberships(input, w.deps);

test("lost renewal webhook: the cron finds the approved charge and extends the membership", async () => {
  const w = await paidMember();
  renewalWithoutWebhook(w, "approved");

  const report = await run(w);
  assert.equal(report.selected, 1);
  assert.equal(report.synced, 1);
  assert.equal(report.extended, 1);
  assert.equal(report.stoppedReason, "completed");
  assert.equal(w.profile(USER_A).membershipExpiresAt, addMonthsIso(renewalDate, 1));
  assert.equal(w.store.payments.filter((p) => p.status === "approved").length, 2);
});

test("rejected renewal without webhook: recorded, NOT extended, shown as a payment problem", async () => {
  const w = await paidMember();
  const paidThrough = w.profile(USER_A).membershipExpiresAt;
  renewalWithoutWebhook(w, "rejected");

  const report = await run(w);
  assert.equal(report.synced, 1);
  assert.equal(report.extended, 0);
  assert.equal(w.profile(USER_A).membershipExpiresAt, paidThrough);
  const summary = await sync.readMembershipSummary(USER_A, w.deps);
  assert.equal(summary.state, "payment_issue");
});

test("lost first-charge webhook: a recent pending checkout is re-synced and activated", async () => {
  const w = world();
  w.store.addProfile(USER_A);
  w.store.addPendingSubscription(USER_A, PRE, REF, new Date(NOW.getTime() - 30 * 60_000).toISOString());
  w.mp.addPreapproval(PRE, { external_reference: REF, status: "authorized", next_payment_date: renewalDate });
  w.mp.addInvoice("7001", PRE, { debitDate: new Date(NOW.getTime() - 25 * 60_000).toISOString() });

  const report = await run(w);
  assert.equal(report.extended, 1);
  assert.equal(w.profile(USER_A).membershipStatus, "active");
});

test("an abandoned checkout (pending, never paid) does not grant access and stops being retried after 3 days", async () => {
  const w = world();
  w.store.addProfile(USER_A);
  w.store.addPendingSubscription(USER_A, PRE, REF, new Date(NOW.getTime() - 2 * HOUR).toISOString());
  w.mp.addPreapproval(PRE, { external_reference: REF, status: "pending" });

  assert.equal((await run(w)).synced, 1);
  assert.equal(w.profile(USER_A).membershipStatus, "inactive");

  w.setNow(new Date(NOW.getTime() + 4 * DAY));
  assert.equal((await run(w)).selected, 0);
});

test("cancellation made in Mercado Pago with the webhook lost: reflected by the weekly safety net, paid period kept", async () => {
  const w = await paidMember();
  const paidThrough = w.profile(USER_A).membershipExpiresAt;
  w.mp.preapprovals.get(PRE).status = "cancelled";

  w.setNow(new Date(NOW.getTime() + 8 * DAY));
  const report = await run(w);
  assert.equal(report.synced, 1);
  assert.equal(w.store.subscriptions[0].status, "cancelled");
  assert.equal(w.profile(USER_A).membershipExpiresAt, paidThrough, "cancelling never shortens access");

  // Cancelled subscriptions are never selected again.
  w.setNow(new Date(NOW.getTime() + 40 * DAY));
  assert.equal((await run(w)).selected, 0);
});

test("idempotent: a second run right after does nothing; a later one converges to the same state", async () => {
  const w = await paidMember();
  renewalWithoutWebhook(w, "approved");
  await run(w);
  const expiry = w.profile(USER_A).membershipExpiresAt;
  const saves = w.store.saves;

  const again = await run(w);
  assert.equal(again.selected, 0, "synced less than 6 h ago");
  assert.equal(w.store.saves, saves, "no writes");

  // A webhook for the same charge arriving late changes nothing.
  await webhook.handleMembershipWebhook(signedRequest({ topic: "subscription_authorized_payment", dataId: "7002", requestId: "late" }), {
    secret: SECRET,
    dependencies: { ...w.deps, eventLog: w.eventLog },
  });
  assert.equal(w.profile(USER_A).membershipExpiresAt, expiry);
  assert.equal(w.store.payments.length, 2);
});

test("Mercado Pago temporarily down: the run stops after 3 consecutive failures and the next run recovers", async () => {
  const w = world();
  for (let i = 0; i < 5; i += 1) {
    const user = `10000000-0000-4000-8000-00000000010${i}`;
    const pre = `pre-${i}`;
    w.store.addProfile(user);
    w.store.addPendingSubscription(user, pre, `ref-${i}`);
    w.mp.addPreapproval(pre, { external_reference: `ref-${i}`, status: "authorized" });
    w.mp.addInvoice(String(8000 + i), pre);
  }
  const down = new sync.MembershipSyncError("provider_unreachable", "timeout", true);
  const original = w.mp.getPreapproval.bind(w.mp);
  let failing = true;
  w.mp.getPreapproval = async (id) => {
    if (failing) throw down;
    return original(id);
  };

  const first = await run(w);
  assert.equal(first.stoppedReason, "transient_failures");
  assert.equal(first.retryableFailures, 3);
  assert.equal(first.notProcessed, 2);
  assert.equal([...w.store.profiles.values()].filter((p) => p.membershipStatus === "active").length, 0);

  failing = false;
  const second = await run(w);
  assert.equal(second.synced, 5, "failed rows were not marked as synced, so they are retried");
  assert.equal([...w.store.profiles.values()].filter((p) => p.membershipStatus === "active").length, 5);
});

test("bad credentials (401) stop the run at once; storage down fails the run so Vercel logs it", async () => {
  const w = await paidMember();
  renewalWithoutWebhook(w);
  w.mp.failNext.set("getPreapproval", new sync.MembershipSyncError("provider_http_401", "unauthorized", true));
  const report = await run(w);
  assert.equal(report.stoppedReason, "provider_credentials");

  w.store.failing = true;
  await assert.rejects(run(w), (error) => error.code === "storage_unavailable" && error.retryable);
});

test("time budget: stops before the function times out and leaves the rest for the next run", async () => {
  const w = world();
  for (let i = 0; i < 4; i += 1) {
    w.store.addProfile(`u${i}`);
    w.store.addPendingSubscription(`u${i}`, `pre-${i}`, `ref-${i}`);
    w.mp.addPreapproval(`pre-${i}`, { external_reference: `ref-${i}`, status: "pending" });
  }
  let calls = 0;
  const report = await run(w, { shouldStop: () => ++calls > 2 });
  assert.equal(report.synced, 2);
  assert.equal(report.notProcessed, 2);
  assert.equal(report.stoppedReason, "time_budget");
});

test("special access granted by the team is never modified by the cron", async () => {
  const w = await paidMember();
  Object.assign(w.profile(USER_A), { membershipStatus: "active", membershipExpiresAt: null });
  renewalWithoutWebhook(w, "approved");
  await run(w);
  assert.equal(w.profile(USER_A).membershipStatus, "active");
  assert.equal(w.profile(USER_A).membershipExpiresAt, null);

  // A user with only a Beta/manual grant and no subscription is not even a candidate.
  w.store.addProfile(USER_B, { membershipStatus: "active", membershipExpiresAt: null });
  assert.equal(w.store.subscriptions.filter((s) => s.userId === USER_B).length, 0);
});

test("consistency: whatever the order of webhooks and runs, expiry = last approved charge + period + grace", async () => {
  const w = await paidMember();
  renewalWithoutWebhook(w, "approved");
  // Out of order: stale preapproval webhook, then the cron, then the first-charge webhook again.
  const deliver = (topic, dataId, requestId) =>
    webhook.handleMembershipWebhook(signedRequest({ topic, dataId, requestId }), { secret: SECRET, dependencies: { ...w.deps, eventLog: w.eventLog } });
  await deliver("subscription_preapproval", PRE, "a");
  await run(w);
  await deliver("subscription_authorized_payment", "7001", "b");

  const approved = w.store.payments.filter((p) => p.status === "approved").map((p) => p.paidAt);
  const expected = billing.computePaidThrough({ approvedChargeDates: approved, frequency: 1, frequencyType: "months", now: w.deps.now() });
  assert.equal(w.profile(USER_A).membershipExpiresAt, expected.toISOString());
  assert.equal(new Set(w.store.payments.map((p) => p.invoiceId)).size, w.store.payments.length, "one row per installment");
});

test("selection rules: due before pending before stale, recent and cancelled skipped, limit respected", () => {
  const iso = (offset) => new Date(NOW.getTime() + offset).toISOString();
  const row = (id, fields) => ({ id, userId: "u", preapprovalId: `p-${id}`, status: "authorized", nextPaymentAt: null, updatedAt: iso(-8 * DAY), createdAt: iso(-60 * DAY), ...fields });
  const candidates = [
    row("stale", {}),
    row("pending", { status: "pending", createdAt: iso(-HOUR), updatedAt: iso(-HOUR) }),
    row("too-new-pending", { status: "pending", createdAt: iso(-60_000), updatedAt: iso(-60_000) }),
    row("due-late", { nextPaymentAt: iso(-HOUR), updatedAt: iso(-DAY) }),
    row("due-early", { nextPaymentAt: iso(-5 * DAY), updatedAt: iso(-DAY) }),
    row("recent", { nextPaymentAt: iso(-HOUR), updatedAt: iso(-HOUR) }),
    row("cancelled", { status: "cancelled" }),
    row("future", { nextPaymentAt: iso(10 * DAY), updatedAt: iso(-DAY) }),
    row("no-preapproval", { preapprovalId: null }),
    row("stale", {}), // duplicated by two queries
  ];
  const batch = reconcile.selectReconciliationBatch(candidates, NOW, 10);
  assert.deepEqual(batch.map((i) => `${i.reason}:${i.candidate.id}`), ["due:due-early", "due:due-late", "pending:pending", "stale:stale"]);
  assert.equal(reconcile.selectReconciliationBatch(candidates, NOW, 2).length, 2);
});

test("cron endpoint auth: fails closed, constant time, Bearer only", () => {
  const ok = "x".repeat(32);
  assert.equal(cronAuth.isAuthorizedCronRequest(`Bearer ${ok}`, ok), true);
  assert.equal(cronAuth.isAuthorizedCronRequest(`bearer ${ok}`, ok), true);
  assert.equal(cronAuth.isAuthorizedCronRequest(`Bearer ${ok}x`, ok), false);
  assert.equal(cronAuth.isAuthorizedCronRequest(ok, ok), false, "no Bearer prefix");
  assert.equal(cronAuth.isAuthorizedCronRequest(null, ok), false);
  assert.equal(cronAuth.isAuthorizedCronRequest(`Bearer ${ok}`, undefined), false, "no secret configured");
  assert.equal(cronAuth.isAuthorizedCronRequest("Bearer short", "short"), false, "too short to be a real secret");
});

test("wiring: Vercel Cron schedules the route, which requires CRON_SECRET and has a time budget", () => {
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  assert.ok(config.crons.some((cron) => cron.path === "/api/mercadopago/reconcile"));
  const route = fs.readFileSync("src/app/api/mercadopago/reconcile/route.ts", "utf8");
  assert.match(route, /isAuthorizedCronRequest\(request\.headers\.get\("authorization"\), process\.env\.CRON_SECRET\)/);
  assert.match(route, /export const maxDuration = 60/);
  assert.match(route, /shouldStop: \(\) => Date\.now\(\) - startedAt > TIME_BUDGET_MS/);
  // Unauthenticated requests reach the route (the proxy lets /api/mercadopago through) and are rejected there.
  assert.match(fs.readFileSync("src/utils/supabase/middleware.ts", "utf8"), /!pathname\.startsWith\('\/api\/mercadopago'\)/);
});

test("test billing frequency: only honoured in an isolated environment, never in production", async () => {
  const { loadTs } = await import("./helpers/load-ts.mjs");
  const { resolveBillingFrequency, MONTHLY_BILLING } = loadTs("src/lib/mercadopago/billing-frequency.ts");
  const days = (n) => ({ frequency: n, frequencyType: "days" });
  assert.deepEqual(resolveBillingFrequency({}), MONTHLY_BILLING);
  assert.deepEqual(resolveBillingFrequency({ MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS: "1", VERCEL_ENV: "preview" }), days(1));
  assert.deepEqual(resolveBillingFrequency({ MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS: "2", NODE_ENV: "development" }), days(2));
  assert.deepEqual(resolveBillingFrequency({ MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS: "1", VERCEL_ENV: "production" }), MONTHLY_BILLING);
  assert.deepEqual(resolveBillingFrequency({ MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS: "1", NODE_ENV: "production" }), MONTHLY_BILLING, "self-hosted prod build");
  for (const bad of ["0", "31", "1.5", "x"]) {
    assert.deepEqual(resolveBillingFrequency({ MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS: bad, VERCEL_ENV: "preview" }), MONTHLY_BILLING, bad);
  }
  // The period paid by a daily test charge is one day (+ grace), read from the preapproval itself.
  const paid = billing.computePaidThrough({ approvedChargeDates: [NOW.toISOString()], frequency: 1, frequencyType: "days", now: NOW });
  assert.equal(paid.toISOString(), new Date(NOW.getTime() + 3 * DAY).toISOString());
});
