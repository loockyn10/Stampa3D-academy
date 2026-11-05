import {
  computePaidThrough,
  decideMembershipExtension,
  parseInvoice,
  parsePreapproval,
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
}

export interface CheckoutAttemptOwner {
  userId: string;
  preapprovalId: string | null;
}

export interface MembershipStore {
  findSubscriptionByPreapprovalId(preapprovalId: string): Promise<StoredSubscription | null>;
  findSubscriptionForUser(userId: string, subscriptionId?: string | null): Promise<StoredSubscription | null>;
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
  summary: MembershipSummary;
}

const PROFILE_WRITE_ATTEMPTS = 4;

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
 * `invoices`: installments already fetched by the caller (webhook). When omitted, the installments are searched in
 * Mercado Pago (best effort: if the search fails, the installment webhook still covers it).
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

  let invoices = input.invoices;
  if (!invoices) {
    try {
      invoices = (await deps.provider.searchInvoices(preapproval.id))
        .map(parseInvoice)
        .filter((invoice): invoice is InvoiceSnapshot => invoice !== null);
    } catch (error) {
      deps.log?.("invoice search failed", { preapprovalId: preapproval.id, error: error instanceof Error ? error.message : "error" });
      invoices = [];
    }
  }

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
    summary,
  };
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

/** Authenticated "check my payment" (return from checkout, /pago/estado, Mi membresía). */
export async function syncUserMembership(
  userId: string,
  deps: MembershipDependencies,
): Promise<{ summary: MembershipSummary; synced: boolean }> {
  const subscription = await storeCall("subscription lookup", () => deps.store.findSubscriptionForUser(userId));
  if (!subscription?.preapprovalId) {
    return { summary: await readMembershipSummary(userId, deps), synced: false };
  }
  const result = await syncPreapproval({ preapprovalId: subscription.preapprovalId, expectedUserId: userId }, deps);
  return { summary: result.summary, synced: true };
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
    return { kind: "processed", userId: result.userId, preapprovalId: result.preapproval.id, membershipExtended: result.membershipExtended };
  }

  if (topic === "subscription_authorized_payment" || topic === "authorized_payment") {
    const invoice = parseInvoice(await deps.provider.getInvoice(input.dataId));
    if (!invoice) throw new MembershipSyncError("invalid_provider_response", "Mercado Pago devolvió un cobro inválido.", true);
    if (!invoice.preapprovalId) return { kind: "ignored", reason: "invoice_without_preapproval" };
    const result = await syncPreapproval({ preapprovalId: invoice.preapprovalId, invoices: [invoice] }, deps);
    return { kind: "processed", userId: result.userId, preapprovalId: result.preapproval.id, membershipExtended: result.membershipExtended };
  }

  if (topic === "payment") {
    // A plain payment notification is never proof of a membership by itself: it only triggers a re-sync of the
    // subscription it belongs to (the old flow that activated by `external_reference = user id` is retired).
    const preapprovalId = preapprovalIdFromPayment(await deps.provider.getPayment(input.dataId));
    if (!preapprovalId) return { kind: "ignored", reason: "payment_without_subscription" };
    const known = await storeCall("subscription lookup", () => deps.store.findSubscriptionByPreapprovalId(preapprovalId));
    if (!known) return { kind: "ignored", reason: "payment_of_unknown_subscription" };
    const result = await syncPreapproval({ preapprovalId }, deps);
    return { kind: "processed", userId: result.userId, preapprovalId: result.preapproval.id, membershipExtended: result.membershipExtended };
  }

  return { kind: "ignored", reason: `unsupported_topic:${topic || "none"}` };
}
