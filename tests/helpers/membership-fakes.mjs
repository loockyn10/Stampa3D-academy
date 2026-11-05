// In-memory Mercado Pago + Supabase doubles for the membership cycle tests. No network, no real charges.
import crypto from "node:crypto";
import { loadTs } from "./load-ts.mjs";

const cache = new Map();
const mocks = { "node:crypto": crypto };
export const billing = loadTs("src/lib/mercadopago/membership-billing.ts", mocks, cache);
export const sync = loadTs("src/lib/mercadopago/membership-sync.ts", mocks, cache);
export const reconcile = loadTs("src/lib/mercadopago/membership-reconcile.ts", mocks, cache);
export const cronAuth = loadTs("src/lib/mercadopago/cron-auth.ts", mocks, cache);
export const webhook = loadTs("src/lib/mercadopago/membership-webhook.ts", mocks, cache);
export const signature = loadTs("src/lib/mercadopago/webhook-signature.ts", mocks, cache);
export const http = loadTs("src/lib/mercadopago/membership-http.ts", mocks, cache);

export const USER_A = "10000000-0000-4000-8000-00000000000a";
export const USER_B = "10000000-0000-4000-8000-00000000000b";
export const SECRET = "test-webhook-secret";
export const NOW = new Date("2026-11-10T12:00:00.000Z");

const transient = (code = "provider_unreachable") => new sync.MembershipSyncError(code, `simulated ${code}`, true);

export class FakeMercadoPago {
  preapprovals = new Map();
  invoices = new Map();
  payments = new Map();
  calls = [];
  failNext = new Map(); // method -> error to throw once
  searchFails = false;
  /** Real behaviour seen in production on 2026-11-05: the installment search answers HTTP 400 (permanent). */
  invoiceSearchHttp400 = false;
  paymentSearchFails = false;
  cancelLeavesStatus = null; // simulate a PUT that "succeeds" but the preapproval is not cancelled

  addPreapproval(id, fields = {}) {
    const raw = {
      id,
      status: "pending",
      external_reference: null,
      payer_email: "member@example.com",
      next_payment_date: null,
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 19900, currency_id: "ARS" },
      ...fields,
    };
    this.preapprovals.set(id, raw);
    return raw;
  }

  addInvoice(id, preapprovalId, { paymentStatus = "approved", status = "processed", debitDate, amount = 19900 } = {}) {
    const raw = {
      id: Number(id),
      type: "scheduled",
      preapproval_id: preapprovalId,
      status,
      debit_date: debitDate ?? NOW.toISOString(),
      date_created: debitDate ?? NOW.toISOString(),
      transaction_amount: String(amount),
      currency_id: "ARS",
      payment: paymentStatus ? { id: Number(id) * 10, status: paymentStatus, status_detail: paymentStatus === "approved" ? "accredited" : "cc_rejected_other_reason" } : undefined,
    };
    this.invoices.set(String(id), raw);
    return raw;
  }

  maybeFail(method) {
    const error = this.failNext.get(method);
    if (error) {
      this.failNext.delete(method);
      throw error;
    }
  }

  async getPreapproval(id) {
    this.calls.push(`getPreapproval:${id}`);
    this.maybeFail("getPreapproval");
    const raw = this.preapprovals.get(id);
    if (!raw) throw new sync.MembershipSyncError("provider_not_found", "not found", false);
    return structuredClone(raw);
  }

  async getInvoice(id) {
    this.calls.push(`getInvoice:${id}`);
    this.maybeFail("getInvoice");
    const raw = this.invoices.get(String(id));
    if (!raw) throw new sync.MembershipSyncError("provider_not_found", "not found", false);
    return structuredClone(raw);
  }

  /** A subscription payment as /v1/payments returns it (linked through point_of_interaction). */
  addSubscriptionPayment(id, preapprovalId, { status = "approved", externalReference = null, invoiceId = null, dateApproved, amount = 19900, linked = true } = {}) {
    const raw = {
      id: Number(id),
      status,
      status_detail: status === "approved" ? "accredited" : "cc_rejected_other_reason",
      external_reference: externalReference,
      date_created: dateApproved ?? NOW.toISOString(),
      date_approved: status === "approved" ? dateApproved ?? NOW.toISOString() : null,
      transaction_amount: amount,
      currency_id: "ARS",
      payer: { email: "other-mp-account@example.com" },
      point_of_interaction: linked
        ? { type: "SUBSCRIPTIONS", transaction_data: { subscription_id: preapprovalId, ...(invoiceId ? { invoice_id: String(invoiceId) } : {}) } }
        : {},
    };
    this.payments.set(String(id), raw);
    return raw;
  }

  async searchPayments(externalReference) {
    this.calls.push(`searchPayments:${externalReference}`);
    if (this.paymentSearchFails) throw transient();
    return [...this.payments.values()].filter((raw) => raw.external_reference === externalReference).map((raw) => structuredClone(raw));
  }

  async searchInvoices(preapprovalId) {
    this.calls.push(`searchInvoices:${preapprovalId}`);
    if (this.invoiceSearchHttp400) throw new sync.MembershipSyncError("provider_http_400", "Mercado Pago respondió HTTP 400 (simulated)", false);
    if (this.searchFails) throw transient();
    return [...this.invoices.values()].filter((raw) => raw.preapproval_id === preapprovalId).map((raw) => structuredClone(raw));
  }

  async getPayment(id) {
    this.calls.push(`getPayment:${id}`);
    this.maybeFail("getPayment");
    const raw = this.payments.get(String(id));
    if (!raw) throw new sync.MembershipSyncError("provider_not_found", "not found", false);
    return structuredClone(raw);
  }

  async cancelPreapproval(id) {
    this.calls.push(`cancelPreapproval:${id}`);
    this.maybeFail("cancelPreapproval");
    const raw = this.preapprovals.get(id);
    if (!raw) throw new sync.MembershipSyncError("provider_not_found", "not found", false);
    raw.status = this.cancelLeavesStatus ?? "cancelled";
    return raw.status;
  }
}

export class MemoryMembershipStore {
  subscriptions = [];
  attempts = [];
  payments = [];
  profiles = new Map();
  sideEffects = [];
  failing = false;
  /** Simulates a concurrent writer: called once right before the next compare-and-set. */
  beforeProfileWrite = null;
  seq = 0;

  check() {
    if (this.failing) throw new Error("Supabase unavailable (simulated)");
  }

  addProfile(userId, fields = {}) {
    this.profiles.set(userId, { membershipStatus: "inactive", membershipExpiresAt: null, membershipStartedAt: null, ...fields });
  }

  addAttempt(userId, externalReference, preapprovalId = null) {
    this.attempts.push({ userId, externalReference, preapprovalId });
  }

  /** What complete_membership_checkout leaves behind after a successful checkout creation. */
  addPendingSubscription(userId, preapprovalId, externalReference, createdAtIso = new Date(NOW.getTime() - 60 * 60_000).toISOString()) {
    this.addAttempt(userId, externalReference, preapprovalId);
    const row = { id: `sub-${++this.seq}`, userId, preapprovalId, status: "pending", startedAt: null, cancelledAt: null, nextPaymentAt: null, amount: 19900, currency: "ARS", createdAt: this.seq, createdAtIso, updatedAtIso: createdAtIso };
    this.subscriptions.push(row);
    return row;
  }

  /** Rows as the real store returns them (createdAt = ISO creation time). */
  view(row) {
    return { ...row, createdAt: row.createdAtIso ?? null };
  }

  async findSubscriptionByPreapprovalId(preapprovalId) {
    this.check();
    const row = this.subscriptions.find((sub) => sub.preapprovalId === preapprovalId);
    return row ? this.view(row) : null;
  }

  async findSubscriptionForUser(userId, subscriptionId) {
    this.check();
    const rows = this.subscriptions
      .filter((sub) => sub.userId === userId && (!subscriptionId || sub.id === subscriptionId))
      .sort((a, b) => b.createdAt - a.createdAt);
    return rows[0] ? this.view(rows[0]) : null;
  }

  async listSubscriptionsForUser(userId, limit) {
    this.check();
    return this.subscriptions
      .filter((sub) => sub.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((row) => this.view(row));
  }

  async findCheckoutAttemptByExternalReference(externalReference) {
    this.check();
    const attempt = this.attempts.find((a) => a.externalReference === externalReference);
    return attempt ? { userId: attempt.userId, preapprovalId: attempt.preapprovalId } : null;
  }

  async saveSubscription({ existingId, userId, preapproval, startedAt, cancelledAt, now }) {
    this.check();
    let row = existingId ? this.subscriptions.find((sub) => sub.id === existingId && sub.userId === userId) : null;
    if (existingId && !row) throw new Error("subscription not found");
    if (!row) {
      row = { id: `sub-${++this.seq}`, userId, preapprovalId: preapproval.id, createdAt: this.seq, createdAtIso: now.toISOString() };
      this.subscriptions.push(row);
    }
    Object.assign(row, {
      status: preapproval.status,
      startedAt,
      cancelledAt,
      nextPaymentAt: preapproval.nextPaymentDate ?? row.nextPaymentAt ?? null,
      amount: preapproval.amount ?? row.amount ?? null,
      currency: preapproval.currency ?? row.currency ?? null,
      providerChargedAmount: preapproval.raw?.summarized?.charged_amount ?? null,
      updatedAtIso: now.toISOString(),
    });
    this.saves = (this.saves ?? 0) + 1;
    return this.view(row);
  }

  async recordInvoice({ userId, subscriptionId, invoice, now }) {
    this.check();
    const fields = {
      userId,
      subscriptionId,
      status: billing.invoiceStoredStatus(invoice),
      paidAt: invoice.chargeDate ?? now.toISOString(),
    };
    const rows = this.payments.filter(
      (p) => p.invoiceId === invoice.id || (invoice.paymentId && p.invoiceId === invoice.paymentId && p.subscriptionId === subscriptionId),
    );
    if (rows.some((p) => p.userId !== userId)) throw new Error("payment owned by another user");
    if (rows.length) rows.forEach((p) => Object.assign(p, fields));
    else this.payments.push({ invoiceId: invoice.id, ...fields });
  }

  async listApprovedChargeDates(subscriptionId) {
    this.check();
    return this.payments.filter((p) => p.subscriptionId === subscriptionId && p.status === "approved").map((p) => p.paidAt);
  }

  async latestInvoiceStatus(subscriptionId) {
    this.check();
    const rows = this.payments.filter((p) => p.subscriptionId === subscriptionId).sort((a, b) => b.paidAt.localeCompare(a.paidAt));
    return rows[0]?.status ?? null;
  }

  async getProfileMembership(userId) {
    this.check();
    const profile = this.profiles.get(userId);
    return profile ? { ...profile } : null;
  }

  async writeProfileMembership(userId, expected, fields) {
    this.check();
    if (this.beforeProfileWrite) {
      const run = this.beforeProfileWrite;
      this.beforeProfileWrite = null;
      run(this);
    }
    const current = this.profiles.get(userId);
    if (!current || current.membershipStatus !== expected.membershipStatus || current.membershipExpiresAt !== expected.membershipExpiresAt) {
      return false;
    }
    current.membershipStatus = fields.membership_status;
    current.membershipExpiresAt = fields.membership_expires_at;
    current.membershipStartedAt = fields.membership_started_at;
    return true;
  }

  async listReconciliationCandidates() {
    this.check();
    return this.subscriptions.map((sub) => ({
      id: sub.id,
      userId: sub.userId,
      preapprovalId: sub.preapprovalId ?? null,
      status: sub.status ?? null,
      nextPaymentAt: sub.nextPaymentAt ?? null,
      updatedAt: sub.updatedAtIso ?? null,
      createdAt: sub.createdAtIso ?? null,
      providerChargedAmount: sub.providerChargedAmount ?? null,
      hasApprovedPayment: this.payments.some((p) => p.subscriptionId === sub.id && p.status === "approved"),
    }));
  }

  async onSubscriptionAuthorized(input) {
    this.sideEffects.push(["authorized", input.preapprovalId]);
  }

  async onSubscriptionCancelled(input) {
    this.sideEffects.push(["cancelled", input.preapprovalId]);
  }
}

export class MemoryEventLog {
  events = [];
  failInsert = false;
  async insert(event) {
    if (this.failInsert) throw new Error("Supabase unavailable (simulated)");
    const id = `evt-${this.events.length + 1}`;
    this.events.push({ id, ...event, processed: false, errorMessage: null });
    return id;
  }
  async finish(id, result) {
    const event = this.events.find((e) => e.id === id);
    Object.assign(event, result);
  }
}

export function world({ now = NOW } = {}) {
  const mp = new FakeMercadoPago();
  const store = new MemoryMembershipStore();
  const eventLog = new MemoryEventLog();
  let clock = now;
  const deps = { store, provider: mp, now: () => clock };
  return {
    mp,
    store,
    eventLog,
    deps,
    setNow(value) {
      clock = value;
    },
    profile: (userId) => store.profiles.get(userId),
  };
}

export function signedRequest({ topic, dataId, requestId = "req-1", secret = SECRET, body, tamper = false }) {
  const ts = "1762776000";
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  let v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  if (tamper) v1 = v1.replace(/^./, (c) => (c === "a" ? "b" : "a"));
  const headers = new Map([
    ["x-signature", `ts=${ts},v1=${v1}`],
    ["x-request-id", requestId],
  ]);
  return {
    url: `https://app.example.com/api/mercadopago/webhook?data.id=${encodeURIComponent(dataId)}&type=${topic}`,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    bodyText: JSON.stringify(body ?? { action: `${topic}.updated`, type: topic, data: { id: String(dataId) } }),
  };
}

export const addMonthsIso = (iso, months, graceDays = billing.MEMBERSHIP_RENEWAL_GRACE_DAYS) => {
  const date = new Date(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return new Date(date.getTime() + graceDays * 86_400_000).toISOString();
};
