// Sprint 1 — membership billing cycle: checkout → payment → webhook → Premium → renewal → cancellation → expiry.
// Mercado Pago and Supabase are in-memory doubles (tests/helpers/membership-fakes.mjs): no network, no real charges.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  NOW,
  SECRET,
  USER_A,
  USER_B,
  addMonthsIso,
  billing,
  http,
  signature,
  signedRequest,
  sync,
  webhook,
  world,
} from "./helpers/membership-fakes.mjs";

const PRE = "2c9380848f5e2a6a018f6a0000000001";
const REF = "stampa_checkout_00000000000040008000000000000001";

/** A Free user who just created a checkout (row left by complete_membership_checkout). */
function freeUserWithCheckout(options = {}) {
  const w = world(options);
  w.store.addProfile(USER_A);
  w.store.addPendingSubscription(USER_A, PRE, REF);
  w.mp.addPreapproval(PRE, { external_reference: REF, status: "pending" });
  return w;
}

function authorize(w, { nextPaymentDate = addMonthsIso(NOW.toISOString(), 1, 0) } = {}) {
  const raw = w.mp.preapprovals.get(PRE);
  raw.status = "authorized";
  raw.next_payment_date = nextPaymentDate;
}

const deliver = (w, request) =>
  webhook.handleMembershipWebhook(request, { secret: SECRET, dependencies: { ...w.deps, eventLog: w.eventLog } });

// ---------------------------------------------------------------------------------------------------------------
// 1–4: checkout, approved, pending and rejected payments
// ---------------------------------------------------------------------------------------------------------------

test("1. a Free user who starts a checkout stays Free while the preapproval is pending", async () => {
  const w = freeUserWithCheckout();
  const { summary } = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(summary.state, "pending");
  assert.equal(summary.hasAccess, false);
  assert.equal(summary.canCancel, true);
  assert.equal(w.profile(USER_A).membershipStatus, "inactive");
});

test("2. an authorized subscription with an approved first charge activates Premium for one period (+ grace)", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE, { paymentStatus: "approved", debitDate: NOW.toISOString() });

  const { summary } = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(summary.state, "active");
  assert.equal(summary.hasAccess, true);
  assert.equal(w.profile(USER_A).membershipStatus, "active");
  assert.equal(w.profile(USER_A).membershipExpiresAt, addMonthsIso(NOW.toISOString(), 1));
  assert.equal(w.profile(USER_A).membershipStartedAt, NOW.toISOString());
  assert.deepEqual(w.store.sideEffects, [["authorized", PRE]], "discount use / founder slot confirmed on authorization");
  // The access goes to the user who bought it (resolved from the checkout, not from external_reference).
  assert.equal(w.store.subscriptions[0].userId, USER_A);
});

test("3. pending payment: authorized preapproval whose charge is still in process grants NO access", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE, { paymentStatus: "in_process", status: "waiting for gateway" });

  const { summary } = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(summary.hasAccess, false);
  assert.equal(summary.state, "pending");
  assert.equal(w.profile(USER_A).membershipStatus, "inactive");
});

test("4. rejected payment grants NO access, even when Mercado Pago marks the installment `processed`", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  // Official docs: after the 4th failed retry the installment ends `processed` with a REJECTED payment.
  w.mp.addInvoice("7001", PRE, { paymentStatus: "rejected", status: "processed" });

  const { summary } = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(summary.hasAccess, false);
  assert.equal(summary.state, "payment_issue");
  assert.equal(w.profile(USER_A).membershipStatus, "inactive");
  assert.equal(w.store.payments[0].status, "rejected");
});

// ---------------------------------------------------------------------------------------------------------------
// 5–8: webhook authenticity, duplicates and ordering
// ---------------------------------------------------------------------------------------------------------------

test("5. a valid signed webhook processes the charge and activates Premium (200)", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE);

  const result = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001" }));
  assert.equal(result.status, 200);
  assert.equal(result.body.processed, true);
  assert.equal(w.profile(USER_A).membershipStatus, "active");
  assert.equal(w.eventLog.events.length, 1);
  assert.equal(w.eventLog.events[0].processed, true);
});

test("6. invalid webhooks: bad/missing signature → 401 and nothing stored; no secret configured → 503", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE);

  const tampered = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001", tamper: true }));
  assert.equal(tampered.status, 401);

  const otherSecret = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001", secret: "attacker" }));
  assert.equal(otherSecret.status, 401);

  const request = signedRequest({ topic: "subscription_authorized_payment", dataId: "7001" });
  const unsigned = await deliver(w, { ...request, headers: { get: () => null } });
  assert.equal(unsigned.status, 401);

  // A valid signature for another id cannot be replayed onto a different resource.
  const moved = signedRequest({ topic: "subscription_authorized_payment", dataId: "7001" });
  const replayed = await deliver(w, { ...moved, url: moved.url.replace("data.id=7001", "data.id=7002") });
  assert.equal(replayed.status, 401);

  const noSecret = await webhook.handleMembershipWebhook(request, { secret: undefined, dependencies: { ...w.deps, eventLog: w.eventLog } });
  assert.equal(noSecret.status, 503);

  assert.equal(w.eventLog.events.length, 0, "unauthenticated requests are not persisted");
  assert.equal(w.mp.calls.length, 0, "no Mercado Pago call for unauthenticated requests");
  assert.equal(w.profile(USER_A).membershipStatus, "inactive");
});

test("7. a duplicated webhook is idempotent: one payment row, same expiry, 200 every time", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE);

  const first = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001" }));
  const expiry = w.profile(USER_A).membershipExpiresAt;
  w.setNow(new Date(NOW.getTime() + 15 * 60_000)); // Mercado Pago retries 15 minutes later
  const second = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001", requestId: "req-2" }));
  const third = await deliver(w, signedRequest({ topic: "subscription_preapproval", dataId: PRE, requestId: "req-3" }));

  assert.deepEqual([first.status, second.status, third.status], [200, 200, 200]);
  assert.equal(w.store.payments.length, 1);
  assert.equal(w.store.subscriptions.length, 1);
  assert.equal(w.profile(USER_A).membershipExpiresAt, expiry, "a re-delivery never buys extra time");
});

test("8. out-of-order events converge and never shorten an expiry", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  const firstCharge = NOW.toISOString();
  const renewal = addMonthsIso(firstCharge, 1, 0);
  w.mp.addInvoice("7001", PRE, { debitDate: firstCharge });
  w.mp.addInvoice("7002", PRE, { debitDate: renewal });
  w.setNow(new Date(new Date(renewal).getTime() + 3_600_000));

  // The renewal arrives first, then the (older) first charge, then a stale preapproval notification.
  await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7002" }));
  const afterRenewal = w.profile(USER_A).membershipExpiresAt;
  await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001", requestId: "r2" }));
  await deliver(w, signedRequest({ topic: "subscription_preapproval", dataId: PRE, requestId: "r3" }));

  assert.equal(afterRenewal, addMonthsIso(renewal, 1));
  assert.equal(w.profile(USER_A).membershipExpiresAt, afterRenewal);
  assert.equal(w.store.payments.length, 2);
});

test("8b. a concurrent writer between read and write is never overwritten (compare-and-set + re-read)", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE);
  const later = new Date(NOW.getTime() + 90 * 86_400_000).toISOString();
  // Another notification extends the membership further while this one is deciding.
  w.store.beforeProfileWrite = (store) => {
    Object.assign(store.profiles.get(USER_A), { membershipStatus: "active", membershipExpiresAt: later });
  };
  await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(w.profile(USER_A).membershipExpiresAt, later);
});

// ---------------------------------------------------------------------------------------------------------------
// 9–12: renewals and cancellation
// ---------------------------------------------------------------------------------------------------------------

test("9. a successful renewal extends access by one more period", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE, { debitDate: NOW.toISOString() });
  await sync.syncUserMembership(USER_A, w.deps);

  const renewalDate = addMonthsIso(NOW.toISOString(), 1, 0);
  w.setNow(new Date(renewalDate));
  w.mp.addInvoice("7002", PRE, { debitDate: renewalDate });
  await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7002" }));

  assert.equal(w.profile(USER_A).membershipExpiresAt, addMonthsIso(renewalDate, 1));
});

test("10. a failed renewal does not extend access; it ends when the paid period (+ grace) ends", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE, { debitDate: NOW.toISOString() });
  await sync.syncUserMembership(USER_A, w.deps);
  const paidThrough = w.profile(USER_A).membershipExpiresAt;

  const renewalDate = addMonthsIso(NOW.toISOString(), 1, 0);
  w.setNow(new Date(renewalDate));
  w.mp.addInvoice("7002", PRE, { debitDate: renewalDate, paymentStatus: "rejected", status: "recycling" });
  await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7002" }));

  assert.equal(w.profile(USER_A).membershipExpiresAt, paidThrough, "no extra month for a rejected renewal");
  let summary = await sync.readMembershipSummary(USER_A, w.deps);
  assert.equal(summary.state, "payment_issue");
  assert.equal(summary.hasAccess, true, "still inside the grace period");

  w.setNow(new Date(new Date(paidThrough).getTime() + 1000));
  summary = await sync.readMembershipSummary(USER_A, w.deps);
  assert.equal(summary.hasAccess, false, "no perpetual access: expires by itself");
  assert.equal(summary.state, "payment_issue");
});

test("11. the user cancels: Mercado Pago is cancelled for real, the paid period is kept", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE);
  await sync.syncUserMembership(USER_A, w.deps);
  const paidThrough = w.profile(USER_A).membershipExpiresAt;
  const subscriptionId = w.store.subscriptions[0].id;

  const outcome = await sync.cancelUserSubscription({ userId: USER_A, subscriptionId }, w.deps);
  assert.equal(outcome.kind, "cancelled");
  assert.equal(outcome.alreadyCancelled, false);
  assert.ok(w.mp.calls.includes(`cancelPreapproval:${PRE}`));
  assert.equal(w.mp.preapprovals.get(PRE).status, "cancelled");
  assert.equal(w.store.subscriptions[0].status, "cancelled");
  assert.equal(w.store.subscriptions[0].cancelledAt, NOW.toISOString());
  assert.equal(outcome.summary.state, "cancelled_with_access");
  assert.equal(outcome.summary.accessUntil, paidThrough);
  assert.equal(outcome.summary.canCancel, false);
  assert.equal(w.profile(USER_A).membershipExpiresAt, paidThrough, "cancelling never removes the paid period");

  const dto = http.membershipDto(outcome.summary);
  assert.equal(dto.state, "cancelled_with_access");
  assert.equal("raw" in dto, false);
});

test("12. the cancellation confirmed by webhook (e.g. from the Mercado Pago app) is reflected; cancelling again is idempotent", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE);
  await sync.syncUserMembership(USER_A, w.deps);
  const paidThrough = w.profile(USER_A).membershipExpiresAt;

  w.mp.preapprovals.get(PRE).status = "cancelled"; // cancelled outside the app
  const result = await deliver(w, signedRequest({ topic: "subscription_preapproval", dataId: PRE }));
  assert.equal(result.status, 200);
  assert.equal(w.store.subscriptions[0].status, "cancelled");
  assert.ok(w.store.sideEffects.some(([kind]) => kind === "cancelled"), "unused discount reservation released");
  assert.equal(w.profile(USER_A).membershipExpiresAt, paidThrough);

  const again = await sync.cancelUserSubscription({ userId: USER_A, subscriptionId: w.store.subscriptions[0].id }, w.deps);
  assert.equal(again.kind, "cancelled");
  assert.equal(again.alreadyCancelled, true);
  assert.equal(w.mp.calls.filter((c) => c.startsWith("cancelPreapproval")).length, 0, "no second PUT");
});

test("12b. a cancellation Mercado Pago does not confirm is reported as not confirmed, not as done", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.cancelLeavesStatus = "authorized";
  const outcome = await sync.cancelUserSubscription({ userId: USER_A, subscriptionId: w.store.subscriptions[0].id }, w.deps);
  assert.equal(outcome.kind, "not_confirmed");
  assert.equal(w.store.subscriptions[0].status, "authorized");
});

test("12c. a pending checkout can be cancelled too (no access to keep)", async () => {
  const w = freeUserWithCheckout();
  const outcome = await sync.cancelUserSubscription({ userId: USER_A, subscriptionId: w.store.subscriptions[0].id }, w.deps);
  assert.equal(outcome.kind, "cancelled");
  assert.equal(outcome.summary.hasAccess, false);
  assert.equal(outcome.summary.state, "expired");
});

// ---------------------------------------------------------------------------------------------------------------
// 13–14: abuse
// ---------------------------------------------------------------------------------------------------------------

test("13. Premium cannot be obtained without an approved charge", async () => {
  // a) authorized preapproval but no charge at all
  const w = freeUserWithCheckout();
  authorize(w);
  let summary = (await sync.syncUserMembership(USER_A, w.deps)).summary;
  assert.equal(summary.hasAccess, false);

  // b) a preapproval whose external_reference is a user's UUID (old flow) and no checkout behind it is not trusted
  const preB = "2c9380848f5e2a6a018f6a00000000bb";
  w.store.addProfile(USER_B);
  w.mp.addPreapproval(preB, { status: "authorized", external_reference: USER_B });
  w.mp.addInvoice("7100", preB);
  const forged = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7100" }));
  assert.equal(forged.status, 200, "permanent error: acknowledged, not retried");
  assert.equal(forged.body.error, "unlinked_preapproval");
  assert.equal(w.profile(USER_B).membershipStatus, "inactive");
  assert.equal(w.eventLog.events.at(-1).processed, false, "left for review");

  // c) a `payment` notification no longer activates by external_reference = user id (legacy flow retired)
  w.mp.payments.set("555", { id: 555, status: "approved", external_reference: USER_B, metadata: {} });
  const legacy = await deliver(w, signedRequest({ topic: "payment", dataId: "555" }));
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.ignored, "payment_without_subscription");
  assert.equal(w.profile(USER_B).membershipStatus, "inactive");

  // d) the client never chooses the subscription to sync: only its own row is read
  summary = (await sync.syncUserMembership(USER_B, w.deps)).summary;
  assert.equal(summary.state, "none");
});

test("14. a user cannot cancel or sync somebody else's subscription", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE);
  await sync.syncUserMembership(USER_A, w.deps);
  w.store.addProfile(USER_B);

  const outcome = await sync.cancelUserSubscription({ userId: USER_B, subscriptionId: w.store.subscriptions[0].id }, w.deps);
  assert.equal(outcome.kind, "not_found", "indistinguishable from a missing subscription");
  assert.equal(w.mp.calls.filter((c) => c.startsWith("cancelPreapproval")).length, 0);
  assert.equal(w.mp.preapprovals.get(PRE).status, "authorized");

  // A subscription row whose checkout belongs to another user is never applied to either of them.
  const preX = "2c9380848f5e2a6a018f6a00000000cc";
  w.store.addAttempt(USER_A, "stampa_checkout_x", preX);
  w.store.subscriptions.push({ id: "sub-x", userId: USER_B, preapprovalId: preX, status: "pending", createdAt: 99 });
  w.mp.addPreapproval(preX, { status: "authorized", external_reference: "stampa_checkout_x" });
  await assert.rejects(
    sync.syncPreapproval({ preapprovalId: preX }, w.deps),
    (error) => error instanceof sync.MembershipSyncError && error.code === "owner_mismatch" && error.retryable === false,
  );
  await assert.rejects(
    sync.syncPreapproval({ preapprovalId: PRE, expectedUserId: USER_B }, w.deps),
    (error) => error.code === "owner_mismatch",
  );
});

// ---------------------------------------------------------------------------------------------------------------
// 15–17: transient failures and recovery
// ---------------------------------------------------------------------------------------------------------------

test("15. Mercado Pago temporarily down: webhook answers 500 (retry), cancel fails safely and changes nothing", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE);

  w.mp.failNext.set("getInvoice", new sync.MembershipSyncError("provider_unreachable", "timeout", true));
  const result = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001" }));
  assert.equal(result.status, 500);
  assert.equal(result.body.retry, true);
  assert.equal(w.eventLog.events[0].processed, false);
  assert.match(w.eventLog.events[0].errorMessage, /provider_unreachable/);
  assert.equal(w.profile(USER_A).membershipStatus, "inactive");

  w.mp.failNext.set("cancelPreapproval", new sync.MembershipSyncError("provider_unreachable", "timeout", true));
  await assert.rejects(
    sync.cancelUserSubscription({ userId: USER_A, subscriptionId: w.store.subscriptions[0].id }, w.deps),
    (error) => error.retryable === true,
  );
  assert.equal(w.store.subscriptions[0].status, "pending", "no fake local cancellation");
  assert.equal(http.membershipErrorResponse(new sync.MembershipSyncError("provider_unreachable", "x", true)).status, 503);

  // A Mercado Pago 404 (e.g. the panel's test notification with a fake id) is acknowledged, not retried forever.
  const missing = await deliver(w, signedRequest({ topic: "subscription_preapproval", dataId: "does-not-exist" }));
  assert.equal(missing.status, 200);
  assert.equal(missing.body.error, "provider_not_found");
});

test("16. Supabase temporarily down: webhook answers 500 so Mercado Pago retries", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE);

  w.eventLog.failInsert = true;
  const notRecorded = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001" }));
  assert.equal(notRecorded.status, 500);
  w.eventLog.failInsert = false;

  w.store.failing = true;
  const failed = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001", requestId: "r2" }));
  assert.equal(failed.status, 500);
  assert.match(w.eventLog.events.at(-1).errorMessage, /storage_unavailable/);
});

test("17. after the failures, the retried notification and the user's sync converge to the right state", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE);

  w.store.failing = true;
  assert.equal((await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001" }))).status, 500);
  w.store.failing = false;

  w.setNow(new Date(NOW.getTime() + 15 * 60_000));
  const retried = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7001", requestId: "r2" }));
  assert.equal(retried.status, 200);
  assert.equal(w.profile(USER_A).membershipExpiresAt, addMonthsIso(NOW.toISOString(), 1), "period counted from the charge date, not the retry");

  // Lost webhook entirely: the user's own sync (return from checkout) finds the approved charge by searching.
  const w2 = freeUserWithCheckout();
  authorize(w2);
  w2.mp.addInvoice("8001", PRE);
  const { summary } = await sync.syncUserMembership(USER_A, w2.deps);
  assert.equal(summary.hasAccess, true);
  assert.ok(w2.mp.calls.includes(`searchInvoices:${PRE}`));

  // If the search itself fails, sync degrades to "pending" (no access granted, no error to the user).
  const w3 = freeUserWithCheckout();
  authorize(w3);
  w3.mp.addInvoice("9001", PRE);
  w3.mp.searchFails = true;
  const degraded = await sync.syncUserMembership(USER_A, w3.deps);
  assert.equal(degraded.summary.hasAccess, false);
  assert.equal(degraded.summary.state, "pending");
});

// ---------------------------------------------------------------------------------------------------------------
// Special access and pure rules
// ---------------------------------------------------------------------------------------------------------------

test("access granted on purpose by the team is never touched by billing", async () => {
  const w = freeUserWithCheckout();
  w.store.profiles.get(USER_A).membershipStatus = "active"; // active without expiry: manual / admin grant
  authorize(w);
  w.mp.addInvoice("7001", PRE);
  await sync.syncUserMembership(USER_A, w.deps);
  w.mp.preapprovals.get(PRE).status = "cancelled";
  await deliver(w, signedRequest({ topic: "subscription_preapproval", dataId: PRE }));
  assert.equal(w.profile(USER_A).membershipStatus, "active");
  assert.equal(w.profile(USER_A).membershipExpiresAt, null);
  assert.equal((await sync.readMembershipSummary(USER_A, w.deps)).state, "manual");

  // A longer expiry set by an admin is not shortened by a charge either.
  const far = new Date(NOW.getTime() + 365 * 86_400_000).toISOString();
  const decision = billing.decideMembershipExtension(
    { membershipStatus: "active", membershipExpiresAt: far, membershipStartedAt: null },
    new Date(NOW.getTime() + 30 * 86_400_000),
    NOW,
  );
  assert.deepEqual(decision, { update: false, reason: "already_covered" });
});

test("pure rules: paid period, month ends, future dates, statuses", () => {
  const paid = (dates, frequency = 1, frequencyType = "months") =>
    billing.computePaidThrough({ approvedChargeDates: dates, frequency, frequencyType, now: NOW })?.toISOString() ?? null;

  assert.equal(paid([]), null);
  assert.equal(paid(["2026-11-01T10:00:00.000Z"]), "2026-12-03T10:00:00.000Z");
  assert.equal(paid(["2026-01-31T00:00:00.000Z"]), "2026-03-02T00:00:00.000Z", "Jan 31 + 1 month = Feb 28 (+2 days grace)");
  assert.equal(paid(["2027-06-01T00:00:00.000Z"]), addMonthsIso(NOW.toISOString(), 1), "a future charge date is clamped to now");
  assert.equal(paid(["2026-11-01T00:00:00.000Z"], 7, "days"), "2026-11-10T00:00:00.000Z");
  assert.equal(paid(["garbage", null, "2026-10-01T00:00:00.000Z"]), "2026-11-03T00:00:00.000Z");

  assert.equal(billing.normalizePreapprovalStatus("canceled"), "cancelled");
  assert.equal(billing.invoiceIsPaid({ paymentStatus: "approved" }), true);
  for (const status of ["rejected", "in_process", "pending", null]) {
    assert.equal(billing.invoiceIsPaid({ paymentStatus: status }), false, String(status));
  }
  assert.equal(billing.parsePreapproval({ status: "authorized" }), null, "no id → ignored");
  assert.equal(billing.parseInvoice({ id: 1, payment: { status: "APPROVED" } }).paymentStatus, "approved");

  const expired = billing.decideMembershipExtension(
    { membershipStatus: "inactive", membershipExpiresAt: null, membershipStartedAt: null },
    new Date(NOW.getTime() - 1000),
    NOW,
  );
  assert.deepEqual(expired, { update: false, reason: "expired_period" });
});

test("signature: official manifest, lowercase alphanumeric id, omitted missing pairs, constant-time compare", () => {
  const verify = signature.verifyMembershipWebhookSignature;
  const make = (manifest, secret = SECRET) => crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const v1 = make("id:abc123;request-id:req;ts:100;");
  assert.equal(verify({ secret: SECRET, xSignature: `ts=100,v1=${v1}`, xRequestId: "req", dataId: "ABC123" }), true, "data.id is lowercased");
  assert.equal(verify({ secret: SECRET, xSignature: ` ts=100 , v1=${v1.toUpperCase()} `, xRequestId: "req", dataId: "abc123" }), true, "spaces / hex case");
  const noRequestId = make("id:abc123;ts:100;");
  assert.equal(verify({ secret: SECRET, xSignature: `ts=100,v1=${noRequestId}`, xRequestId: null, dataId: "abc123" }), true, "missing pair omitted");
  assert.equal(verify({ secret: SECRET, xSignature: `ts=100,v1=${v1}`, xRequestId: "req", dataId: "abc124" }), false);
  assert.equal(verify({ secret: SECRET, xSignature: `ts=101,v1=${v1}`, xRequestId: "req", dataId: "abc123" }), false, "ts is signed");
  assert.equal(verify({ secret: SECRET, xSignature: "ts=100,v1=zz", xRequestId: "req", dataId: "abc123" }), false, "malformed v1");
  assert.equal(verify({ secret: SECRET, xSignature: `v1=${v1}`, xRequestId: "req", dataId: "abc123" }), false, "missing ts");
  assert.equal(verify({ secret: "", xSignature: `ts=100,v1=${v1}`, xRequestId: "req", dataId: "abc123" }), false, "fails closed without secret");
});

test("summary states shown in Mi membresía", () => {
  const s = (profile, subscription, latest = null) =>
    billing.summarizeMembership({ profile, subscription, latestInvoiceStatus: latest, now: NOW });
  const future = new Date(NOW.getTime() + 86_400_000).toISOString();
  const past = new Date(NOW.getTime() - 86_400_000).toISOString();
  const sub = (status) => ({ id: "s", status, nextPaymentAt: future, amount: 19900, currency: "ARS" });
  const active = { membershipStatus: "active", membershipExpiresAt: future, membershipStartedAt: null };
  const lapsed = { membershipStatus: "active", membershipExpiresAt: past, membershipStartedAt: null };

  assert.equal(s(active, sub("authorized")).state, "active");
  assert.equal(s(active, sub("authorized"), "rejected").state, "payment_issue");
  assert.equal(s(lapsed, sub("authorized"), "rejected").state, "payment_issue");
  assert.equal(s(active, sub("cancelled")).state, "cancelled_with_access");
  assert.equal(s(lapsed, sub("cancelled")).state, "expired");
  assert.equal(s(active, sub("paused")).state, "paused_with_access");
  assert.equal(s(null, null).state, "none");
  assert.equal(s(lapsed, sub("authorized")).hasAccess, false);
  assert.equal(s(active, sub("cancelled")).canCancel, false);
  assert.equal(s(active, sub("authorized")).canCancel, true);
});
