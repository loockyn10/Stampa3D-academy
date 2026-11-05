// P0 incident 2026-11-05: a user paid $250 ARS (approved charge in Mercado Pago) and Universo never granted Premium.
// Root cause reproduced here: the only lookup the sync/cron had for a subscription's charges,
// `GET /authorized_payments/search`, answers HTTP 400 in production and the error was swallowed ("nothing to do");
// without the installment webhook nothing else could find the payment, and after a cancel + retry the paid
// subscription was never re-read again.
// Mercado Pago and Supabase are in-memory doubles that now model that real behaviour: no network, no real charges.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";
import {
  SECRET,
  USER_A,
  USER_B,
  addMonthsIso,
  billing,
  reconcile,
  signedRequest,
  sync,
  webhook,
  world,
} from "./helpers/membership-fakes.mjs";

const accessPolicy = loadTs("src/lib/auth/access-policy.ts");
const providerModule = loadTs("src/lib/mercadopago/membership-provider.ts", { "node:crypto": crypto });

// Shapes taken from the real incident (ids are fake).
const PRE_1 = "6248ec22c52f4079b9a3894c16a95000";
const REF_1 = "stampa_checkout_dc7cc1e550d6460ea6a9b17c9620d000";
const PRE_2 = "58a1029cc7ee43ed9e086b08c9476000";
const REF_2 = "stampa_checkout_b7dcb08524d04cc6a56b9eb6a4b56000";
const CREATED_1 = "2026-11-05T17:13:36.000Z";
const CHARGED_AT = "2026-11-05T13:19:52.000-04:00"; // = 17:19:52Z
const CREATED_2 = "2026-11-05T18:40:08.000Z";
const AFTER_PAYMENT = new Date("2026-11-05T17:25:00.000Z");
const PAID_THROUGH = addMonthsIso(new Date(CHARGED_AT).toISOString(), 1); // charge + 1 month + 2 days grace

const preapprovalRaw = (fields = {}) => ({
  external_reference: REF_1,
  payer_email: "cuenta-mp-personal@example.com", // NOT the Universo email: identity comes from the checkout
  auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 250, currency_id: "ARS" },
  ...fields,
});

/** The user's first subscription, paid in Mercado Pago, as production had it: local row still `pending`. */
function paidButNotActivated({ now = AFTER_PAYMENT, invoiceSearch400 = true, paymentLinked = true } = {}) {
  const w = world({ now });
  w.store.addProfile(USER_A);
  w.store.addProfile(USER_B);
  w.store.addPendingSubscription(USER_A, PRE_1, REF_1, CREATED_1);
  w.mp.addPreapproval(
    PRE_1,
    preapprovalRaw({
      status: "authorized",
      next_payment_date: "2026-12-05T13:19:52.000-04:00",
      summarized: { charged_quantity: 1, charged_amount: 250, last_charged_date: CHARGED_AT, last_charged_amount: 250 },
    }),
  );
  w.mp.addSubscriptionPayment("150000000001", PRE_1, {
    externalReference: REF_1,
    invoiceId: paymentLinked ? "7700001" : null,
    dateApproved: CHARGED_AT,
    amount: 250,
    linked: paymentLinked,
  });
  w.mp.invoiceSearchHttp400 = invoiceSearch400;
  return w;
}

const deliver = (w, request) =>
  webhook.handleMembershipWebhook(request, { secret: SECRET, dependencies: { ...w.deps, eventLog: w.eventLog } });

function assertPremium(w, userId = USER_A) {
  const profile = w.profile(userId);
  assert.equal(profile.membershipStatus, "active");
  assert.equal(profile.membershipExpiresAt, PAID_THROUGH);
  const access = accessPolicy.evaluateAccessPolicy(
    { authenticated: true, role: null, membershipStatus: profile.membershipStatus, membershipExpiresAt: profile.membershipExpiresAt, onboardingCompleted: true, grants: [] },
    w.deps.now(),
  );
  assert.equal(access.capabilities.accessPlatform, true, "the proxy policy lets the user into Universo");
}

function assertFree(w, userId = USER_A) {
  assert.notEqual(w.profile(userId).membershipStatus, "active");
}

const approvedRows = (w) => w.store.payments.filter((p) => p.status === "approved");

// ---------------------------------------------------------------------------------------------------------------
// Reproduction of the incident and the recovery paths
// ---------------------------------------------------------------------------------------------------------------

test("incident: approved charge + installment search answering 400 → /pago/estado now finds the payment and grants Premium", async () => {
  const w = paidButNotActivated();
  const { summary, chargeUnverified } = await sync.syncUserMembership(USER_A, w.deps);

  assert.equal(summary.hasAccess, true);
  assert.equal(summary.state, "active");
  assert.equal(chargeUnverified, false);
  assertPremium(w);
  assert.equal(approvedRows(w).length, 1, "one approved payment recorded");
  assert.equal(approvedRows(w)[0].invoiceId, "7700001", "keyed by the installment id, so the installment webhook merges into it");
  assert.ok(w.mp.calls.includes(`searchPayments:${REF_1}`), "second, independent lookup used when the first answers 400");
});

test("previous behaviour is no longer possible: a broken lookup with a reported charge is never 'processed' silently", async () => {
  const w = paidButNotActivated();
  w.mp.paymentSearchFails = true; // both lookups down

  const result = await sync.syncPreapproval({ preapprovalId: PRE_1 }, w.deps);
  assert.equal(result.chargeUnverified, true);
  assert.deepEqual(result.lookupFailures, ["invoice_search:provider_http_400", "payment_search:provider_unreachable"]);
  assertFree(w); // still no access without an approved payment

  const response = await deliver(w, signedRequest({ topic: "subscription_preapproval", dataId: PRE_1 }));
  assert.equal(response.status, 500, "Mercado Pago must retry");
  assert.equal(w.eventLog.events.at(-1).processed, false);
  assert.match(w.eventLog.events.at(-1).errorMessage, /^charge_unverified/);
});

test("approved payment arriving by webhook (installment topic) grants Premium even with the search broken", async () => {
  const w = paidButNotActivated();
  w.mp.addInvoice("7700001", PRE_1, { paymentStatus: "approved", debitDate: CHARGED_AT, amount: 250 });

  const response = await deliver(w, signedRequest({ topic: "subscription_authorized_payment", dataId: "7700001" }));
  assert.equal(response.status, 200);
  assert.equal(w.eventLog.events[0].processed, true);
  assertPremium(w);
  assert.equal(w.store.subscriptions[0].status, "authorized");
});

test("approved payment arriving by the `payment` topic is used as evidence and grants Premium", async () => {
  const w = paidButNotActivated();
  const response = await deliver(w, signedRequest({ topic: "payment", dataId: "150000000001" }));
  assert.equal(response.status, 200);
  assertPremium(w);
  assert.ok(!w.mp.calls.some((call) => call.startsWith("searchInvoices")), "the payment itself is the evidence");
});

test("approved payment recovered ONLY by the reconciliation (no webhook at all, user never returns)", async () => {
  const w = paidButNotActivated({ now: new Date("2026-11-06T09:15:00.000Z") }); // next cron run
  const report = await reconcile.reconcileMemberships({}, w.deps);
  assert.equal(report.selected, 1);
  assert.equal(report.extended, 1);
  assert.equal(report.unverified, 0);
  assert.equal(w.profile(USER_A).membershipStatus, "active");
  assert.equal(w.profile(USER_A).membershipExpiresAt, PAID_THROUGH);
});

test("preapproval webhook processed but payment webhook lost: authorized-without-payment is reconciled (was skipped for a month)", async () => {
  const w = paidButNotActivated();
  // The preapproval notification arrived BEFORE the charge was collected (summarized still empty).
  const early = w.mp.preapprovals.get(PRE_1);
  const summarized = early.summarized;
  early.summarized = { charged_quantity: 0, charged_amount: 0 };
  w.mp.payments.clear();
  const first = await deliver(w, signedRequest({ topic: "subscription_preapproval", dataId: PRE_1 }));
  assert.equal(first.status, 200);
  assert.equal(w.store.subscriptions[0].status, "authorized");
  assertFree(w);

  // Then Mercado Pago collected and the payment notification never arrived.
  early.summarized = summarized;
  w.mp.addSubscriptionPayment("150000000001", PRE_1, { externalReference: REF_1, invoiceId: "7700001", dateApproved: CHARGED_AT, amount: 250 });
  w.setNow(new Date("2026-11-05T18:00:00.000Z"));
  const selection = reconcile.selectReconciliationBatch(await w.store.listReconciliationCandidates(), w.deps.now(), 10);
  assert.deepEqual(selection.map((item) => item.reason), ["pending"]);

  const report = await reconcile.reconcileMemberships({}, w.deps);
  assert.equal(report.extended, 1);
  assertPremium(w);
});

test("duplicated webhooks (payment, installment, preapproval, twice each) → one payment row, same expiry", async () => {
  const w = paidButNotActivated();
  w.mp.addInvoice("7700001", PRE_1, { paymentStatus: "approved", debitDate: CHARGED_AT, amount: 250 });
  w.mp.invoices.get("7700001").payment.id = 150000000001;
  for (let round = 0; round < 2; round += 1) {
    for (const [topic, dataId] of [["payment", "150000000001"], ["subscription_authorized_payment", "7700001"], ["subscription_preapproval", PRE_1]]) {
      const response = await deliver(w, signedRequest({ topic, dataId, requestId: `${topic}-${round}` }));
      assert.equal(response.status, 200, `${topic} round ${round}`);
    }
  }
  assert.equal(w.store.payments.length, 1);
  assertPremium(w);
});

test("out of order: the cancellation notification arrives before any payment notification → the paid period is still granted", async () => {
  const w = paidButNotActivated();
  w.mp.preapprovals.get(PRE_1).status = "cancelled";
  const response = await deliver(w, signedRequest({ topic: "subscription_preapproval", dataId: PRE_1 }));
  assert.equal(response.status, 200);
  assert.equal(w.store.subscriptions[0].status, "cancelled");
  assertPremium(w);
  const { summary } = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(summary.state, "cancelled_with_access");
});

test("pending payment (in process) grants no access and is not flagged as a charge to chase", async () => {
  const w = paidButNotActivated();
  w.mp.preapprovals.get(PRE_1).summarized = { charged_quantity: 1, charged_amount: 0 };
  w.mp.payments.clear();
  w.mp.addSubscriptionPayment("150000000002", PRE_1, { externalReference: REF_1, status: "in_process" });

  const { summary, chargeUnverified } = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(summary.hasAccess, false);
  assert.equal(summary.state, "pending");
  assert.equal(chargeUnverified, false);
  assertFree(w);
});

test("rejected payment grants no access and the user can start a new payment (not trapped)", async () => {
  const w = paidButNotActivated();
  // Second attempt of the incident: charged_quantity 1, charged_amount 0, no card.
  w.mp.preapprovals.get(PRE_1).summarized = { charged_quantity: 1, charged_amount: 0 };
  w.mp.payments.clear();
  w.mp.addSubscriptionPayment("150000000003", PRE_1, { externalReference: REF_1, status: "rejected" });

  await sync.syncUserMembership(USER_A, w.deps);
  assertFree(w);
  assert.equal(approvedRows(w).length, 0);
  assert.deepEqual(await sync.assessCheckoutEligibility(USER_A, w.deps), { kind: "eligible" });
});

test("approved then cancelled from the app: Mercado Pago is cancelled, the period paid is recorded and kept", async () => {
  const w = paidButNotActivated();
  const outcome = await sync.cancelUserSubscription({ userId: USER_A, subscriptionId: w.store.subscriptions[0].id }, w.deps);
  assert.equal(outcome.kind, "cancelled");
  assert.equal(w.mp.preapprovals.get(PRE_1).status, "cancelled");
  assertPremium(w);
  assert.equal(outcome.summary.state, "cancelled_with_access");
  assert.equal(outcome.summary.accessUntil, PAID_THROUGH);
});

test("the full incident: paid, never activated, cancelled, retried with a second subscription → the first one's period is recovered", async () => {
  const w = paidButNotActivated({ now: new Date("2026-11-05T19:00:00.000Z") });
  // As production had it: subscription 1 cancelled locally (synced while the lookup was broken) with no payment row.
  w.mp.preapprovals.get(PRE_1).status = "cancelled";
  w.mp.paymentSearchFails = true;
  await sync.syncPreapproval({ preapprovalId: PRE_1, expectedUserId: USER_A }, w.deps);
  assert.equal(w.store.subscriptions[0].status, "cancelled");
  assert.equal(w.store.subscriptions[0].providerChargedAmount, 250);
  assertFree(w);
  // Subscription 2: never charged, cancelled in Mercado Pago, still pending locally.
  w.store.addPendingSubscription(USER_A, PRE_2, REF_2, CREATED_2);
  w.mp.addPreapproval(PRE_2, preapprovalRaw({ external_reference: REF_2, status: "cancelled", summarized: { charged_quantity: 1, charged_amount: 0 } }));
  w.mp.paymentSearchFails = false;

  // Before: only the latest subscription (2) was synced, so the $250 period was unreachable from the app.
  const { summary } = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(summary.hasAccess, true);
  assert.equal(summary.state, "cancelled_with_access", "no renewal will be charged");
  assertPremium(w);
  assert.equal(w.store.subscriptions[1].status, "cancelled", "subscription 2 converged with Mercado Pago");
});

test("the cron also chases a CANCELLED subscription whose reported charge is not recorded (was never re-synced)", async () => {
  const w = paidButNotActivated();
  w.mp.preapprovals.get(PRE_1).status = "cancelled";
  w.mp.paymentSearchFails = true;
  await sync.syncPreapproval({ preapprovalId: PRE_1 }, w.deps);
  assertFree(w);
  w.mp.paymentSearchFails = false;

  w.setNow(new Date("2026-11-06T09:15:00.000Z"));
  const items = reconcile.selectReconciliationBatch(await w.store.listReconciliationCandidates(), w.deps.now(), 10);
  assert.deepEqual(items.map((item) => item.reason), ["unverified"]);
  const report = await reconcile.reconcileMemberships({}, w.deps);
  assert.equal(report.extended, 1);
  assertPremium(w);
  // Once recorded, it is no longer selected.
  w.setNow(new Date("2026-11-06T12:00:00.000Z"));
  assert.equal(reconcile.selectReconciliationBatch(await w.store.listReconciliationCandidates(), w.deps.now(), 10).length, 0);
});

test("an old session is not a problem: access is read from the profile on every request, so Premium shows right after the sync", async () => {
  const w = paidButNotActivated();
  const before = accessPolicy.evaluateAccessPolicy({ authenticated: true, role: null, ...w.profile(USER_A), onboardingCompleted: true, grants: [] }, w.deps.now());
  assert.equal(before.capabilities.accessPlatform, false);
  await sync.syncUserMembership(USER_A, w.deps);
  assertPremium(w);
  // The proxy resolves access from `profiles` per request (no membership claim cached in the session cookie).
  const proxyMiddleware = readRepoFile("src/utils/supabase/middleware.ts");
  assert.match(proxyMiddleware, /resolveUserAccess\(supabase, user\.id/);
  assert.match(readRepoFile("src/lib/auth/user-access.ts"), /\.from\("profiles"\)[\s\S]*membership_status, membership_expires_at/);
  // /sin-acceso "Actualizar acceso" now re-syncs with Mercado Pago before re-reading.
  assert.match(readRepoFile("src/app/sin-acceso/actions.ts"), /await syncUserMembership\(user\.id, deps\)[\s\S]*getCurrentUserAccess/);
});

test("paid with a Mercado Pago account whose email differs from Universo: Premium goes to the Universo account that checked out", async () => {
  const w = paidButNotActivated();
  // USER_B owns nothing here, whatever email the payer used.
  await sync.syncUserMembership(USER_A, w.deps);
  assertPremium(w, USER_A);
  assertFree(w, USER_B);
  assert.equal(w.store.subscriptions[0].userId, USER_A);
  // USER_B asking to sync cannot reach USER_A's subscription.
  const other = await sync.syncUserMembership(USER_B, w.deps);
  assert.equal(other.synced, false);
});

test("repeated attempt after a successful payment never creates a second charge", async () => {
  // a) the payment was recorded: the guard sees the access.
  const w = paidButNotActivated();
  await sync.syncUserMembership(USER_A, w.deps);
  assert.deepEqual(await sync.assessCheckoutEligibility(USER_A, w.deps), { kind: "has_access", accessUntil: PAID_THROUGH });

  // b) the payment was NOT recorded yet (webhook lost): the guard recovers it before deciding.
  const w2 = paidButNotActivated();
  assert.deepEqual(await sync.assessCheckoutEligibility(USER_A, w2.deps), { kind: "has_access", accessUntil: PAID_THROUGH });
  assertPremium(w2);

  // c) Mercado Pago reports the charge but it cannot be verified: a new checkout is refused.
  const w3 = paidButNotActivated();
  w3.mp.paymentSearchFails = true;
  assert.deepEqual(await sync.assessCheckoutEligibility(USER_A, w3.deps), { kind: "charge_unverified" });
  assertFree(w3);

  // The route applies the guard before creating or restarting any checkout.
  const route = readRepoFile("src/app/api/mercadopago/create-subscription/route.ts");
  const guard = route.indexOf("assessCheckoutEligibility(user.id");
  assert.ok(guard > 0 && guard < route.indexOf("if (body.restart)") && guard < route.indexOf("executePlainCheckout("));
  assert.match(route, /code: "already_member"[\s\S]*409/);
  assert.match(route, /code: "charge_under_verification"[\s\S]*409/);
});

test("temporary Mercado Pago error: the webhook asks for a retry and the retry activates", async () => {
  const w = paidButNotActivated();
  w.mp.paymentSearchFails = true;
  const failed = await deliver(w, signedRequest({ topic: "subscription_preapproval", dataId: PRE_1, requestId: "r1" }));
  assert.equal(failed.status, 500);
  assertFree(w);

  w.mp.paymentSearchFails = false;
  const retried = await deliver(w, signedRequest({ topic: "subscription_preapproval", dataId: PRE_1, requestId: "r2" }));
  assert.equal(retried.status, 200);
  assertPremium(w);
});

test("Supabase write failure: 500 (retry), nothing half-granted; the retried sync converges without duplicates", async () => {
  const w = paidButNotActivated();
  const original = w.store.recordInvoice.bind(w.store);
  let failOnce = true;
  w.store.recordInvoice = async (input) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("Supabase unavailable (simulated)");
    }
    return original(input);
  };
  const failed = await deliver(w, signedRequest({ topic: "payment", dataId: "150000000001", requestId: "r1" }));
  assert.equal(failed.status, 500);
  assertFree(w);

  // The user's "Verificar de nuevo" (or Mercado Pago's retry) recovers it.
  const { summary } = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(summary.hasAccess, true);
  assert.equal(w.store.payments.length, 1);
  assertPremium(w);
});

test("sync retried after a failure: an outage throws (shown as 'probá de nuevo'), the next call activates", async () => {
  const w = paidButNotActivated();
  w.store.failing = true;
  await assert.rejects(() => sync.syncUserMembership(USER_A, w.deps), (error) => error.retryable === true);
  w.store.failing = false;
  const { summary } = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(summary.hasAccess, true);
});

test("no duplicate activation: repeated syncs, webhooks and cron runs never extend the paid period twice", async () => {
  const w = paidButNotActivated();
  await sync.syncUserMembership(USER_A, w.deps);
  await sync.syncUserMembership(USER_A, w.deps);
  await deliver(w, signedRequest({ topic: "payment", dataId: "150000000001" }));
  w.setNow(new Date("2026-11-06T09:15:00.000Z"));
  const report = await reconcile.reconcileMemberships({}, w.deps);
  assert.equal(report.extended, 0);
  assert.equal(w.store.payments.length, 1);
  assertPremium(w);
});

// ---------------------------------------------------------------------------------------------------------------
// Pure rules and the real HTTP client
// ---------------------------------------------------------------------------------------------------------------

test("a payment is accepted as evidence only when it belongs to the subscription", () => {
  const base = { id: 1, status: "approved", date_approved: CHARGED_AT, transaction_amount: 250, currency_id: "ARS" };
  const expected = { preapprovalId: PRE_1, externalReference: REF_1 };
  const linked = { ...base, point_of_interaction: { transaction_data: { subscription_id: PRE_1, invoice_id: "7700001" } } };
  assert.equal(billing.parseSubscriptionPayment(linked, expected).id, "7700001");
  assert.equal(billing.parseSubscriptionPayment(linked, expected).paymentStatus, "approved");
  // Linked to another subscription, even with our reference: rejected.
  const other = { ...base, external_reference: REF_1, point_of_interaction: { transaction_data: { subscription_id: PRE_2 } } };
  assert.equal(billing.parseSubscriptionPayment(other, expected), null);
  // No link at all: only the exact (server-generated) checkout reference is accepted.
  assert.equal(billing.parseSubscriptionPayment({ ...base, external_reference: REF_1 }, expected).id, "1");
  assert.equal(billing.parseSubscriptionPayment({ ...base, external_reference: REF_2 }, expected), null);
  assert.equal(billing.parseSubscriptionPayment({ ...base, metadata: { preapproval_id: PRE_1 } }, expected).preapprovalId, PRE_1);
  // A reported charge is a signal, never access.
  assert.deepEqual(billing.providerReportedCharge({ raw: { summarized: { charged_amount: 250, last_charged_date: CHARGED_AT } } }), { chargedAmount: 250, lastChargedDate: CHARGED_AT });
  assert.equal(billing.providerReportedCharge({ raw: { summarized: { charged_quantity: 1, charged_amount: 0 } } }), null);
});

test("HTTP client: installment search sends only the documented filter; Mercado Pago's reason is kept; payment search by reference", async () => {
  const requests = [];
  const fakeFetch = async (url) => {
    requests.push(url);
    if (url.includes("/authorized_payments/search")) {
      if (url.includes("limit=") || url.includes("offset=0")) {
        return new Response(JSON.stringify({ message: "The attribute limit is not a possible param", error: "bad_request" }), { status: 400 });
      }
      return new Response(JSON.stringify({ paging: { total: 1 }, results: [{ id: 1, preapproval_id: PRE_1 }] }), { status: 200 });
    }
    if (url.includes("/v1/payments/search")) {
      return new Response(JSON.stringify({ results: [{ id: 9 }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ message: "invalid", error: "bad_request" }), { status: 400 });
  };
  const client = new providerModule.MercadoPagoMembershipProvider("TEST-token", fakeFetch);

  const invoices = await client.searchInvoices(PRE_1);
  assert.equal(invoices.length, 1);
  assert.equal(new URL(requests[0]).search, `?preapproval_id=${PRE_1}`);

  const payments = await client.searchPayments(REF_1);
  assert.equal(payments.length, 1);
  const paymentUrl = new URL(requests[1]);
  assert.equal(paymentUrl.pathname, "/v1/payments/search");
  assert.equal(paymentUrl.searchParams.get("external_reference"), REF_1);

  await assert.rejects(
    () => client.getPreapproval("x"),
    (error) => error.code === "provider_http_400" && error.retryable === false && /bad_request · invalid/.test(error.message),
  );
});

test("webhook: an invalid signature is logged (it is never persisted) so a secret mismatch is diagnosable", async () => {
  const w = paidButNotActivated();
  const logs = [];
  const response = await webhook.handleMembershipWebhook(signedRequest({ topic: "payment", dataId: "150000000001", tamper: true }), {
    secret: SECRET,
    dependencies: { ...w.deps, eventLog: w.eventLog },
    log: (message, details) => logs.push({ message, details }),
  });
  assert.equal(response.status, 401);
  assert.equal(w.eventLog.events.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0].message, /invalid or missing signature/);
  assert.deepEqual(logs[0].details, { hasSignature: true, hasRequestId: true, topic: "payment", hasDataId: true });
  assertFree(w);
});
