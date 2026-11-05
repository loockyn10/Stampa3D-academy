import {
  computePaidThrough,
  decideMembershipExtension,
  invoiceIsPaid,
  membershipIsValid,
  parseInvoice,
  parsePreapproval,
  parseSubscriptionPayment,
  providerReportedCharge,
  summarizeMembership,
  type InvoiceSnapshot,
  type MembershipSummary,
  type PreapprovalSnapshot,
  type ProfileMembership,
  type SubscriptionFacts,
} from "@/lib/mercadopago/membership-billing";

/**
 * Orchestration of the membership billing cycle: webhook, sync after checkout, cancellation.
 *
 * Mercado Pago is the source of truth for what was charged; every entry point re-reads the current preapproval (and
 * installment) from the API instead of trusting a notification body, so a duplicated, replayed or out-of-order
 * notification converges to the same result. Supabase is written with idempotent operations only.
 */

export class MembershipSyncError extends Error {
  /** true → transient (Mercado Pago or Supabase unavailable): the webhook answers 5xx so Mercado Pago retries. */
  readonly retryable: boolean;
  readonly code: string;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "MembershipSyncError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface StoredSubscription {
  id: string;
  userId: string;
  preapprovalId: string | null;
  status: string | null;
  startedAt: string | null;
  cancelledAt: string | null;
  nextPaymentAt: string | null;
  amount: number | null;
  currency: string | null;
  /** Creation time of the local row (ISO), when known. */
  createdAt?: string | null;
  /** `summarized.charged_amount` of the last preapproval snapshot stored (money Mercado Pago reported as collected). */
  providerChargedAmount?: number | null;
}

export interface CheckoutAttemptOwner {
  userId: string;
  preapprovalId: string | null;
}

export interface MembershipStore {
  findSubscriptionByPreapprovalId(preapprovalId: string): Promise<StoredSubscription | null>;
  findSubscriptionForUser(userId: string, subscriptionId?: string | null): Promise<StoredSubscription | null>;
  /** The user's subscriptions, newest first. */
  listSubscriptionsForUser(userId: string, limit: number): Promise<StoredSubscription[]>;
  findCheckoutAttemptByExternalReference(externalReference: string): Promise<CheckoutAttemptOwner | null>;
  saveSubscription(input: {
    existingId: string | null;
    userId: string;
    preapproval: PreapprovalSnapshot;
    startedAt: string | null;
    cancelledAt: string | null;
    now: Date;
  }): Promise<StoredSubscription>;
  recordInvoice(input: { userId: string; subscriptionId: string; invoice: InvoiceSnapshot; now: Date }): Promise<void>;
  listApprovedChargeDates(subscriptionId: string): Promise<string[]>;
  latestInvoiceStatus(subscriptionId: string): Promise<string | null>;
  getProfileMembership(userId: string): Promise<ProfileMembership | null>;
  /** Compare-and-set write of the membership columns; false when the row changed since `expected` was read. */
  writeProfileMembership(
    userId: string,
    expected: ProfileMembership,
    fields: { membership_status: "active"; membership_expires_at: string; membership_started_at: string },
  ): Promise<boolean>;
  /** Non-critical side effects (discount codes, founder slot). Must never throw. */
  onSubscriptionAuthorized(input: { userId: string; preapprovalId: string }): Promise<void>;
  onSubscriptionCancelled(input: { userId: string; preapprovalId: string }): Promise<void>;
}

export interface MembershipProvider {
  getPreapproval(id: string): Promise<unknown>;
  getInvoice(id: string): Promise<unknown>;
  searchInvoices(preapprovalId: string): Promise<unknown[]>;
  /** Payments whose `external_reference` is the checkout's (second, independent way to find a subscription charge). */
  searchPayments(externalReference: string): Promise<unknown[]>;
  getPayment(id: string): Promise<unknown>;
  /** PUT status=cancelled. Returns the provider's resulting status (or throws MembershipSyncError). */
  cancelPreapproval(id: string): Promise<string | null>;
}

export interface MembershipDependencies {
  store: MembershipStore;
  provider: MembershipProvider;
  now?: () => Date;
  log?: (message: string, details?: Record<string, unknown>) => void;
}

export interface PreapprovalSyncResult {
  userId: string;
  subscription: StoredSubscription;
  preapproval: PreapprovalSnapshot;
  paidThrough: string | null;
  membershipExtended: boolean;
  /**
   * Mercado Pago reports money collected for this subscription but no approved payment could be located (lookups
   * failed or returned nothing). Never "nothing to do": the webhook asks for a retry, the cron retries and the user is
   * told not to pay again. Access is still NOT granted without an approved payment.
   */
  chargeUnverified: boolean;
  /** Codes of the charge lookups that failed (diagnostics only). */
  lookupFailures: string[];
  summary: MembershipSummary;
}

const PROFILE_WRITE_ATTEMPTS = 4;
/** Older subscriptions of a user re-read by "check my payment" (besides the latest one). */
const USER_SYNC_MAX_SUBSCRIPTIONS = 5;
/** An older subscription without any approved payment is re-read while it is this recent. */
const USER_SYNC_RECENT_MS = 40 * 24 * 60 * 60 * 1000;

function nowOf(deps: MembershipDependencies): Date {
  return deps.now ? deps.now() : new Date();
}

async function storeCall<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MembershipSyncError) throw error;
    throw new MembershipSyncError("storage_unavailable", `${label}: ${error instanceof Error ? error.message : "error"}`, true);
  }
}

/** Resolves who paid for a preapproval. Never trusts `external_reference` as a user id. */
async function resolveOwner(
  preapproval: PreapprovalSnapshot,
  deps: MembershipDependencies,
): Promise<{ userId: string; existing: StoredSubscription | null }> {
  const existing = await storeCall("subscription lookup", () =>
    deps.store.findSubscriptionByPreapprovalId(preapproval.id),
  );
  const attempt = preapproval.externalReference
    ? await storeCall("checkout attempt lookup", () =>
        deps.store.findCheckoutAttemptByExternalReference(preapproval.externalReference as string),
      )
    : null;

  if (attempt?.preapprovalId && attempt.preapprovalId !== preapproval.id) {
    throw new MembershipSyncError(
      "external_reference_conflict",
      "La referencia externa pertenece a otro checkout.",
      false,
    );
  }
  if (existing && attempt && existing.userId !== attempt.userId) {
    throw new MembershipSyncError("owner_mismatch", "La suscripción y el checkout pertenecen a usuarios distintos.", false);
  }

  const userId = existing?.userId ?? attempt?.userId ?? null;
  if (!userId) {
    throw new MembershipSyncError("unlinked_preapproval", "La preapproval no corresponde a ningún checkout de la plataforma.", false);
  }
  return { userId, existing };
}

async function extendMembership(
  userId: string,
  paidThrough: Date | null,
  deps: MembershipDependencies,
  now: Date,
): Promise<boolean> {
  for (let attempt = 0; attempt < PROFILE_WRITE_ATTEMPTS; attempt += 1) {
    const current = await storeCall("profile read", () => deps.store.getProfileMembership(userId));
    if (!current) {
      throw new MembershipSyncError("profile_not_found", "No existe el perfil del pagador.", false);
    }
    const decision = decideMembershipExtension(current, paidThrough, now);
    if (!decision.update) return false;
    const written = await storeCall("profile write", () => deps.store.writeProfileMembership(userId, current, decision.fields));
    if (written) return true;
    // Someone else changed the row in between: re-read and decide again (never overwrite blindly).
  }
  throw new MembershipSyncError("profile_write_conflict", "El perfil cambió durante la actualización.", true);
}

/**
 * Re-reads a preapproval from Mercado Pago and converges Supabase to it.
 * `invoices`: installments already fetched by the caller (webhook). The charges are also looked up in Mercado Pago
 * when needed (see collectInvoices); a charge Mercado Pago reports but nobody could locate comes back as
 * `chargeUnverified`, never as a silent success.
 */
export async function syncPreapproval(
  input: { preapprovalId: string; invoices?: InvoiceSnapshot[]; expectedUserId?: string },
  deps: MembershipDependencies,
): Promise<PreapprovalSyncResult> {
  const now = nowOf(deps);
  const preapproval = parsePreapproval(await deps.provider.getPreapproval(input.preapprovalId));
  if (!preapproval || preapproval.id !== input.preapprovalId) {
    throw new MembershipSyncError("invalid_provider_response", "Mercado Pago devolvió una suscripción inválida.", true);
  }

  const { userId, existing } = await resolveOwner(preapproval, deps);
  if (input.expectedUserId && input.expectedUserId !== userId) {
    throw new MembershipSyncError("owner_mismatch", "La suscripción pertenece a otra cuenta.", false);
  }

  const startedAt = existing?.startedAt ?? (preapproval.status === "authorized" ? now.toISOString() : null);
  const cancelledAt = existing?.cancelledAt ?? (preapproval.status === "cancelled" ? now.toISOString() : null);
  const subscription = await storeCall("subscription write", () =>
    deps.store.saveSubscription({ existingId: existing?.id ?? null, userId, preapproval, startedAt, cancelledAt, now }),
  );

  const { invoices, lookupFailures } = await collectInvoices(preapproval, input.invoices, deps);

  for (const invoice of invoices) {
    // An installment of another subscription is never attached here.
    if (invoice.preapprovalId !== preapproval.id) continue;
    await storeCall("payment write", () => deps.store.recordInvoice({ userId, subscriptionId: subscription.id, invoice, now }));
  }

  const approvedDates = await storeCall("payments read", () => deps.store.listApprovedChargeDates(subscription.id));
  const paidThroughDate = computePaidThrough({
    approvedChargeDates: approvedDates,
    frequency: preapproval.frequency,
    frequencyType: preapproval.frequencyType,
    now,
  });
  const membershipExtended = await extendMembership(userId, paidThroughDate, deps, now);

  const reportedCharge = providerReportedCharge(preapproval);
  const chargeUnverified = reportedCharge !== null && approvedDates.length === 0;
  if (chargeUnverified || lookupFailures.length > 0) {
    deps.log?.(chargeUnverified ? "charge reported by Mercado Pago but no approved payment located" : "charge lookup degraded", {
      preapprovalId: preapproval.id,
      subscriptionId: subscription.id,
      preapprovalStatus: preapproval.status,
      reportedChargedAmount: reportedCharge?.chargedAmount ?? null,
      lookupFailures,
    });
  }

  if (preapproval.status === "authorized") {
    await deps.store.onSubscriptionAuthorized({ userId, preapprovalId: preapproval.id });
  } else if (preapproval.status === "cancelled") {
    await deps.store.onSubscriptionCancelled({ userId, preapprovalId: preapproval.id });
  }

  const summary = await buildSummary(userId, subscription, deps, now);
  return {
    userId,
    subscription,
    preapproval,
    paidThrough: paidThroughDate ? paidThroughDate.toISOString() : null,
    membershipExtended,
    chargeUnverified,
    lookupFailures,
    summary,
  };
}

/**
 * Installments to record for a preapproval: the ones given by the caller (webhook) plus, when they are needed, the
 * ones Mercado Pago lists. Two independent lookups, so a single broken endpoint can never hide an approved charge
 * again (incident 2026-11-05: `/authorized_payments/search` answered 400 and the error was swallowed):
 *   1. `/authorized_payments/search?preapproval_id=...` (installments, the canonical source);
 *   2. `/v1/payments/search?external_reference=...` (payments of the subscription), when (1) failed or found no
 *      approved charge although Mercado Pago reports money collected.
 * Lookups are best effort: failures are reported, never thrown (the caller decides with `chargeUnverified`).
 */
async function collectInvoices(
  preapproval: PreapprovalSnapshot,
  given: InvoiceSnapshot[] | undefined,
  deps: MembershipDependencies,
): Promise<{ invoices: InvoiceSnapshot[]; lookupFailures: string[] }> {
  const byId = new Map<string, InvoiceSnapshot>();
  const add = (invoice: InvoiceSnapshot | null) => {
    if (!invoice || invoice.preapprovalId !== preapproval.id) return;
    const previous = byId.get(invoice.id);
    // The approved reading of an installment wins over a stale one of the same installment.
    if (!previous || invoiceIsPaid(invoice) || !invoiceIsPaid(previous)) byId.set(invoice.id, invoice);
  };
  for (const invoice of given ?? []) add(invoice);

  const lookupFailures: string[] = [];
  const failureCode = (error: unknown) => (error instanceof MembershipSyncError ? error.code : "error");
  const hasApproved = () => [...byId.values()].some(invoiceIsPaid);
  const reported = providerReportedCharge(preapproval) !== null;
  // A preapproval still `pending` (no card authorized) cannot have been charged unless Mercado Pago says otherwise.
  const chargePossible = preapproval.status !== "pending" || reported;

  if (!given && chargePossible) {
    try {
      for (const raw of await deps.provider.searchInvoices(preapproval.id)) add(parseInvoice(raw));
    } catch (error) {
      lookupFailures.push(`invoice_search:${failureCode(error)}`);
      deps.log?.("invoice search failed", {
        preapprovalId: preapproval.id,
        code: failureCode(error),
        error: error instanceof Error ? error.message : "error",
      });
    }
  }

  // The payment search runs only when the installments did not already prove the charge and one may exist.
  const needPaymentSearch = !hasApproved() && chargePossible && (reported || (!given && lookupFailures.length > 0));
  if (needPaymentSearch && preapproval.externalReference) {
    try {
      for (const raw of await deps.provider.searchPayments(preapproval.externalReference)) {
        add(parseSubscriptionPayment(raw, { preapprovalId: preapproval.id, externalReference: preapproval.externalReference }));
      }
    } catch (error) {
      lookupFailures.push(`payment_search:${failureCode(error)}`);
      deps.log?.("payment search failed", {
        preapprovalId: preapproval.id,
        code: failureCode(error),
        error: error instanceof Error ? error.message : "error",
      });
    }
  }

  return { invoices: [...byId.values()], lookupFailures };
}

function subscriptionFacts(subscription: StoredSubscription | null): SubscriptionFacts | null {
  return subscription
    ? {
        id: subscription.id,
        status: subscription.status,
        nextPaymentAt: subscription.nextPaymentAt,
        amount: subscription.amount,
        currency: subscription.currency,
      }
    : null;
}

async function buildSummary(
  userId: string,
  subscription: StoredSubscription | null,
  deps: MembershipDependencies,
  now: Date,
): Promise<MembershipSummary> {
  const profile = await storeCall("profile read", () => deps.store.getProfileMembership(userId));
  const latestInvoiceStatus = subscription
    ? await storeCall("payments read", () => deps.store.latestInvoiceStatus(subscription.id))
    : null;
  return summarizeMembership({ profile, subscription: subscriptionFacts(subscription), latestInvoiceStatus, now });
}

/** Read-only summary from Supabase (no Mercado Pago call). */
export async function readMembershipSummary(userId: string, deps: MembershipDependencies): Promise<MembershipSummary> {
  const now = nowOf(deps);
  const subscription = await storeCall("subscription lookup", () => deps.store.findSubscriptionForUser(userId));
  return buildSummary(userId, subscription, deps, now);
}

/** Whether an older subscription of the user may still hold a paid period that is not recorded yet. */
async function mayHoldUnrecordedCharge(subscription: StoredSubscription, deps: MembershipDependencies, now: Date): Promise<boolean> {
  if (!subscription.preapprovalId) return false;
  const approved = await storeCall("payments read", () => deps.store.listApprovedChargeDates(subscription.id));
  if (approved.length > 0) return false; // its paid period is already counted
  const status = (subscription.status ?? "").toLowerCase();
  if (status === "authorized" || status === "paused" || status === "pending") return true;
  if ((subscription.providerChargedAmount ?? 0) > 0) return true;
  const created = subscription.createdAt ? new Date(subscription.createdAt).getTime() : NaN;
  return Number.isFinite(created) && now.getTime() - created <= USER_SYNC_RECENT_MS;
}

export interface UserSyncResult {
  summary: MembershipSummary;
  synced: boolean;
  /** Some subscription of the user has money collected per Mercado Pago that could not be matched to a payment yet. */
  chargeUnverified: boolean;
}

/**
 * Authenticated "check my payment" (return from checkout, /pago/estado, /sin-acceso, Mi membresía).
 * Re-reads the latest subscription AND every older one that may still hold a paid period not recorded locally: a user
 * who paid, cancelled and tried again (incident 2026-11-05) keeps the period the FIRST subscription paid for.
 * A failure on the latest subscription is reported; on an older one it is logged and the rest continues.
 */
export async function syncUserMembership(userId: string, deps: MembershipDependencies): Promise<UserSyncResult> {
  const now = nowOf(deps);
  const subscriptions = (
    await storeCall("subscription lookup", () => deps.store.listSubscriptionsForUser(userId, USER_SYNC_MAX_SUBSCRIPTIONS))
  ).filter((subscription) => subscription.userId === userId);
  const latest = subscriptions[0];
  if (!latest?.preapprovalId) {
    return { summary: await readMembershipSummary(userId, deps), synced: false, chargeUnverified: false };
  }

  let chargeUnverified = false;
  for (const older of subscriptions.slice(1)) {
    try {
      if (!(await mayHoldUnrecordedCharge(older, deps, now))) continue;
      const result = await syncPreapproval({ preapprovalId: older.preapprovalId as string, expectedUserId: userId }, deps);
      chargeUnverified ||= result.chargeUnverified;
    } catch (error) {
      deps.log?.("older subscription not synced", {
        subscriptionId: older.id,
        code: error instanceof MembershipSyncError ? error.code : "error",
      });
    }
  }

  // The latest one last, so the summary reflects every period recovered above.
  const result = await syncPreapproval({ preapprovalId: latest.preapprovalId, expectedUserId: userId }, deps);
  chargeUnverified ||= result.chargeUnverified;
  return { summary: result.summary, synced: true, chargeUnverified };
}

export type CheckoutEligibility =
  | { kind: "eligible" }
  | { kind: "has_access"; accessUntil: string | null }
  | { kind: "charge_unverified" };

/**
 * Guard before creating (or replacing) a checkout, so a retry never charges twice: the user's subscriptions are
 * re-synced first (a payment whose webhook was lost is recovered here), then
 * - a member with valid access never gets a second preapproval;
 * - a charge Mercado Pago reports but we could not verify yet blocks a new checkout until it is resolved.
 * If Mercado Pago cannot be read, the decision falls back to the stored profile (an outage alone never blocks).
 */
export async function assessCheckoutEligibility(userId: string, deps: MembershipDependencies): Promise<CheckoutEligibility> {
  const now = nowOf(deps);
  let chargeUnverified = false;
  try {
    chargeUnverified = (await syncUserMembership(userId, deps)).chargeUnverified;
  } catch (error) {
    deps.log?.("checkout guard: sync unavailable, using stored state", {
      code: error instanceof MembershipSyncError ? error.code : "error",
    });
  }
  const profile = await storeCall("profile read", () => deps.store.getProfileMembership(userId));
  if (profile && membershipIsValid(profile, now)) return { kind: "has_access", accessUntil: profile.membershipExpiresAt };
  if (chargeUnverified) return { kind: "charge_unverified" };
  return { kind: "eligible" };
}

export type CancelOutcome =
  | { kind: "cancelled"; alreadyCancelled: boolean; summary: MembershipSummary }
  | { kind: "not_found" }
  | { kind: "not_cancellable"; status: string | null; summary: MembershipSummary }
  | { kind: "not_confirmed"; summary: MembershipSummary };

/**
 * Cancels the user's subscription IN MERCADO PAGO (stops future charges) and reflects the provider's real result.
 * The already paid period is kept: access ends at `membership_expires_at`. Idempotent: cancelling twice is a success.
 */
export async function cancelUserSubscription(
  input: { userId: string; subscriptionId: string },
  deps: MembershipDependencies,
): Promise<CancelOutcome> {
  const subscription = await storeCall("subscription lookup", () =>
    deps.store.findSubscriptionForUser(input.userId, input.subscriptionId),
  );
  // Somebody else's subscription looks exactly like a missing one.
  if (!subscription || subscription.userId !== input.userId || !subscription.preapprovalId) {
    return { kind: "not_found" };
  }

  const current = parsePreapproval(await deps.provider.getPreapproval(subscription.preapprovalId));
  if (!current || current.id !== subscription.preapprovalId) {
    throw new MembershipSyncError("invalid_provider_response", "Mercado Pago devolvió una suscripción inválida.", true);
  }

  if (current.status === "cancelled") {
    const synced = await syncPreapproval({ preapprovalId: current.id, expectedUserId: input.userId }, deps);
    return { kind: "cancelled", alreadyCancelled: true, summary: synced.summary };
  }

  if (!["authorized", "paused", "pending"].includes(current.status)) {
    const synced = await syncPreapproval({ preapprovalId: current.id, expectedUserId: input.userId }, deps);
    return { kind: "not_cancellable", status: current.status, summary: synced.summary };
  }

  // Ownership is verified against the checkout that created the preapproval before any write to the provider.
  const owner = await resolveOwner(current, deps);
  if (owner.userId !== input.userId) {
    throw new MembershipSyncError("owner_mismatch", "La suscripción pertenece a otra cuenta.", false);
  }

  await deps.provider.cancelPreapproval(current.id);

  // Reflect what Mercado Pago really has now, not what the PUT answered.
  const synced = await syncPreapproval({ preapprovalId: current.id, expectedUserId: input.userId }, deps);
  if (synced.preapproval.status !== "cancelled") {
    return { kind: "not_confirmed", summary: synced.summary };
  }
  return { kind: "cancelled", alreadyCancelled: false, summary: synced.summary };
}

// ---------------------------------------------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------------------------------------------

export type NotificationOutcome =
  | { kind: "processed"; userId: string; preapprovalId: string; membershipExtended: boolean }
  | { kind: "ignored"; reason: string };

/**
 * A notification whose subscription has money collected per Mercado Pago that we could not locate is NOT acknowledged
 * as processed: it answers 5xx so Mercado Pago retries, and stays recorded with `processed = false` for review.
 * (Everything that could be written was written: the retry is idempotent.)
 */
function processedOrRetry(result: PreapprovalSyncResult): NotificationOutcome {
  if (result.chargeUnverified) {
    throw new MembershipSyncError(
      "charge_unverified",
      `Mercado Pago informa un cobro de la suscripción que no pudimos verificar (${result.lookupFailures.join(", ") || "sin resultados"}).`,
      true,
    );
  }
  return { kind: "processed", userId: result.userId, preapprovalId: result.preapproval.id, membershipExtended: result.membershipExtended };
}

function preapprovalIdFromPayment(rawValue: unknown): string | null {
  if (typeof rawValue !== "object" || rawValue === null) return null;
  const raw = rawValue as Record<string, unknown>;
  const metadata = (raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}) as Record<string, unknown>;
  const poi = (raw.point_of_interaction && typeof raw.point_of_interaction === "object" ? raw.point_of_interaction : {}) as Record<string, unknown>;
  const transaction = (poi.transaction_data && typeof poi.transaction_data === "object" ? poi.transaction_data : {}) as Record<string, unknown>;
  for (const candidate of [metadata.preapproval_id, transaction.subscription_id]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * Processes one notification. Throws MembershipSyncError: `retryable` errors must be answered with 5xx (Mercado Pago
 * retries every 15 min, then less often); the others are acknowledged and left recorded for review.
 */
export async function processMembershipNotification(
  input: { topic: string | null; dataId: string },
  deps: MembershipDependencies,
): Promise<NotificationOutcome> {
  const topic = (input.topic ?? "").toLowerCase();

  if (topic === "subscription_preapproval" || topic === "preapproval") {
    const result = await syncPreapproval({ preapprovalId: input.dataId }, deps);
    return processedOrRetry(result);
  }

  if (topic === "subscription_authorized_payment" || topic === "authorized_payment") {
    const invoice = parseInvoice(await deps.provider.getInvoice(input.dataId));
    if (!invoice) throw new MembershipSyncError("invalid_provider_response", "Mercado Pago devolvió un cobro inválido.", true);
    if (!invoice.preapprovalId) return { kind: "ignored", reason: "invoice_without_preapproval" };
    const result = await syncPreapproval({ preapprovalId: invoice.preapprovalId, invoices: [invoice] }, deps);
    return processedOrRetry(result);
  }

  if (topic === "payment") {
    // A plain payment is never proof of a membership by itself (the old flow that activated by
    // `external_reference = user id` is retired). A payment OF ONE OF OUR SUBSCRIPTIONS is used as evidence of that
    // subscription's charge, and the subscription is re-synced from Mercado Pago.
    const rawPayment = await deps.provider.getPayment(input.dataId);
    const preapprovalId = preapprovalIdFromPayment(rawPayment);
    if (!preapprovalId) return { kind: "ignored", reason: "payment_without_subscription" };
    const known = await storeCall("subscription lookup", () => deps.store.findSubscriptionByPreapprovalId(preapprovalId));
    if (!known) return { kind: "ignored", reason: "payment_of_unknown_subscription" };
    const evidence = parseSubscriptionPayment(rawPayment, { preapprovalId, externalReference: null });
    const result = await syncPreapproval({ preapprovalId, invoices: evidence ? [evidence] : undefined }, deps);
    return processedOrRetry(result);
  }

  return { kind: "ignored", reason: `unsupported_topic:${topic || "none"}` };
}
