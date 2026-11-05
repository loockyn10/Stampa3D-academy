/**
 * Pure rules of the membership billing cycle (no I/O). See docs/DECISIONS.md D044 and docs/DEPLOY_MEMBERSHIP_BILLING.md.
 *
 * - Premium access comes only from an APPROVED charge: a charge covers one billing period (the preapproval frequency)
 *   from its debit date, plus a short grace for the next renewal to be processed. An `authorized` preapproval alone
 *   (card linked, first charge not approved yet), a pending checkout or a rejected charge never grants access.
 * - Mercado Pago marks an installment `processed` also when its last retry was REJECTED, so the installment status is
 *   never used as proof of payment: only `payment.status === "approved"`.
 * - Cancelling or pausing stops renewals; the period already paid is kept. Access then ends at
 *   `membership_expires_at`, which the access policy already enforces. Nothing here ever shortens an expiry.
 * - A membership the team granted on purpose (active without expiry) is never modified by billing.
 */

export const MEMBERSHIP_RENEWAL_GRACE_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PreapprovalStatus = "pending" | "authorized" | "paused" | "cancelled" | string;

export interface PreapprovalSnapshot {
  id: string;
  status: PreapprovalStatus;
  externalReference: string | null;
  payerEmail: string | null;
  nextPaymentDate: string | null;
  amount: number | null;
  currency: string | null;
  frequency: number;
  frequencyType: "months" | "days";
  raw: Record<string, unknown>;
}

export interface InvoiceSnapshot {
  /** Authorized payment ("factura") id: one per installment, updated on every retry. */
  id: string;
  preapprovalId: string | null;
  /** Installment status: scheduled / processed / recycling / cancelled / ... (not proof of payment). */
  status: string | null;
  paymentId: string | null;
  /** Status of the payment behind the installment: approved / rejected / in_process / ... */
  paymentStatus: string | null;
  chargeDate: string | null;
  amount: number | null;
  currency: string | null;
  raw: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function amount(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function validDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return Number.isFinite(new Date(raw).getTime()) ? raw : null;
}

/** Normalizes Mercado Pago's two spellings of the terminal state. */
export function normalizePreapprovalStatus(status: unknown): PreapprovalStatus {
  const value = (text(status) ?? "unknown").toLowerCase();
  return value === "canceled" ? "cancelled" : value;
}

export function parsePreapproval(rawValue: unknown): PreapprovalSnapshot | null {
  const raw = asRecord(rawValue);
  const id = raw ? text(raw.id) : null;
  if (!raw || !id) return null;
  const recurring = asRecord(raw.auto_recurring) ?? {};
  const frequency = Number(recurring.frequency);
  const frequencyType = recurring.frequency_type === "days" ? "days" : "months";
  return {
    id,
    status: normalizePreapprovalStatus(raw.status),
    externalReference: text(raw.external_reference),
    payerEmail: text(raw.payer_email),
    nextPaymentDate: validDate(raw.next_payment_date),
    amount: amount(recurring.transaction_amount),
    currency: text(recurring.currency_id),
    frequency: Number.isInteger(frequency) && frequency > 0 && frequency <= 36 ? frequency : 1,
    frequencyType,
    raw,
  };
}

export function parseInvoice(rawValue: unknown): InvoiceSnapshot | null {
  const raw = asRecord(rawValue);
  const id = raw ? text(raw.id) : null;
  if (!raw || !id) return null;
  const payment = asRecord(raw.payment) ?? {};
  return {
    id,
    preapprovalId: text(raw.preapproval_id),
    status: text(raw.status)?.toLowerCase() ?? null,
    paymentId: text(payment.id),
    paymentStatus: text(payment.status)?.toLowerCase() ?? null,
    chargeDate: validDate(raw.debit_date) ?? validDate(raw.date_created),
    amount: amount(raw.transaction_amount),
    currency: text(raw.currency_id),
    raw,
  };
}

/** The only proof of payment. */
export function invoiceIsPaid(invoice: Pick<InvoiceSnapshot, "paymentStatus">): boolean {
  return invoice.paymentStatus === "approved";
}

/** Status stored in `payments.status`: the payment's when there is one, otherwise the installment's. */
export function invoiceStoredStatus(invoice: Pick<InvoiceSnapshot, "paymentStatus" | "status">): string {
  return invoice.paymentStatus ?? invoice.status ?? "unknown";
}

function addPeriod(from: Date, frequency: number, frequencyType: "months" | "days"): Date {
  const result = new Date(from.getTime());
  if (frequencyType === "days") {
    result.setTime(result.getTime() + frequency * DAY_MS);
  } else {
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + frequency);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
  }
  return result;
}

/**
 * Last moment the approved charges pay for. A charge date in the future is clamped to `now` (an approved charge was
 * made at the latest now), so a malformed date can never buy extra time.
 */
export function computePaidThrough(input: {
  approvedChargeDates: (string | null)[];
  frequency: number;
  frequencyType: "months" | "days";
  now: Date;
}): Date | null {
  let latest: number | null = null;
  for (const value of input.approvedChargeDates) {
    const ms = value ? new Date(value).getTime() : NaN;
    if (!Number.isFinite(ms)) continue;
    const clamped = Math.min(ms, input.now.getTime());
    if (latest === null || clamped > latest) latest = clamped;
  }
  if (latest === null) return null;
  const end = addPeriod(new Date(latest), input.frequency, input.frequencyType);
  return new Date(end.getTime() + MEMBERSHIP_RENEWAL_GRACE_DAYS * DAY_MS);
}

export interface ProfileMembership {
  membershipStatus: string | null;
  membershipExpiresAt: string | null;
  membershipStartedAt: string | null;
}

export type MembershipExtension =
  | { update: false; reason: "no_paid_period" | "expired_period" | "manual_access" | "already_covered" }
  | { update: true; fields: { membership_status: "active"; membership_expires_at: string; membership_started_at: string } };

/**
 * Whether billing must write the profile. Only ever activates or EXTENDS: it never shortens an expiry and never touches
 * a membership that is active without expiry (granted by the team).
 */
export function decideMembershipExtension(current: ProfileMembership, paidThrough: Date | null, now: Date): MembershipExtension {
  if (!paidThrough) return { update: false, reason: "no_paid_period" };
  if (paidThrough.getTime() <= now.getTime()) return { update: false, reason: "expired_period" };

  const isActive = current.membershipStatus === "active";
  if (isActive && !current.membershipExpiresAt) return { update: false, reason: "manual_access" };

  const currentExpiry = current.membershipExpiresAt ? new Date(current.membershipExpiresAt).getTime() : NaN;
  if (isActive && Number.isFinite(currentExpiry) && currentExpiry >= paidThrough.getTime()) {
    return { update: false, reason: "already_covered" };
  }

  return {
    update: true,
    fields: {
      membership_status: "active",
      membership_expires_at: paidThrough.toISOString(),
      membership_started_at: current.membershipStartedAt ?? now.toISOString(),
    },
  };
}

export function membershipIsValid(current: Pick<ProfileMembership, "membershipStatus" | "membershipExpiresAt">, now: Date): boolean {
  if (current.membershipStatus !== "active") return false;
  if (!current.membershipExpiresAt) return true;
  const expiry = new Date(current.membershipExpiresAt).getTime();
  return Number.isFinite(expiry) && expiry > now.getTime();
}

// ---------------------------------------------------------------------------------------------------------------
// User-facing summary ("Mi membresía"). Server-derived; the UI only renders it.
// ---------------------------------------------------------------------------------------------------------------

export type MembershipState =
  | "active" // renews automatically
  | "payment_issue" // renewal charge rejected / being retried by Mercado Pago
  | "pending" // checkout started, payment not confirmed: no access
  | "cancelled_with_access" // will not renew, keeps the paid period
  | "paused_with_access"
  | "paused"
  | "manual" // access granted by the team, no Mercado Pago billing
  | "expired"
  | "none";

export interface MembershipSummary {
  state: MembershipState;
  hasAccess: boolean;
  accessUntil: string | null;
  nextChargeAt: string | null;
  amount: number | null;
  currency: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  canCancel: boolean;
  lastPaymentStatus: string | null;
}

export interface SubscriptionFacts {
  id: string;
  status: string | null;
  nextPaymentAt: string | null;
  amount: number | null;
  currency: string | null;
}

const PAYMENT_PROBLEM_STATUSES = new Set(["rejected", "cancelled", "refunded", "charged_back"]);

export function summarizeMembership(input: {
  profile: ProfileMembership | null;
  subscription: SubscriptionFacts | null;
  latestInvoiceStatus: string | null;
  now: Date;
}): MembershipSummary {
  const profile = input.profile ?? { membershipStatus: null, membershipExpiresAt: null, membershipStartedAt: null };
  const hasAccess = membershipIsValid(profile, input.now);
  const sub = input.subscription;
  const subStatus = sub ? normalizePreapprovalStatus(sub.status) : null;
  const accessUntil = hasAccess ? profile.membershipExpiresAt : null;
  const base = {
    hasAccess,
    accessUntil,
    nextChargeAt: null as string | null,
    amount: sub?.amount ?? null,
    currency: sub?.currency ?? null,
    subscriptionId: sub?.id ?? null,
    subscriptionStatus: subStatus,
    canCancel: subStatus === "authorized" || subStatus === "paused" || subStatus === "pending",
    lastPaymentStatus: input.latestInvoiceStatus,
  };

  if (hasAccess && !profile.membershipExpiresAt) return { ...base, state: "manual" };

  if (subStatus === "authorized") {
    const issue = input.latestInvoiceStatus !== null && PAYMENT_PROBLEM_STATUSES.has(input.latestInvoiceStatus);
    if (hasAccess) {
      return { ...base, state: issue ? "payment_issue" : "active", nextChargeAt: sub?.nextPaymentAt ?? null };
    }
    // Card linked but no approved charge covers today: first charge in process, or renewals failing.
    return { ...base, state: issue ? "payment_issue" : "pending", nextChargeAt: sub?.nextPaymentAt ?? null };
  }
  if (subStatus === "pending") return { ...base, state: hasAccess ? "manual" : "pending" };
  if (subStatus === "paused") return { ...base, state: hasAccess ? "paused_with_access" : "paused" };
  if (subStatus === "cancelled") return { ...base, state: hasAccess ? "cancelled_with_access" : "expired" };

  if (hasAccess) return { ...base, state: "manual" };
  return { ...base, state: sub ? "expired" : "none" };
}
