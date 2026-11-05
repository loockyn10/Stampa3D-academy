import {
  MembershipSyncError,
  syncPreapproval,
  type MembershipDependencies,
  type MembershipStore,
} from "@/lib/mercadopago/membership-sync";

/**
 * Automatic reconciliation (safety net for lost or never-configured webhooks). A scheduled job re-syncs, with the
 * same idempotent pipeline as the webhook, only the subscriptions that can have changed:
 *
 * 0. `unverified` — Mercado Pago reported money collected (`summarized.charged_amount > 0` in the stored snapshot) but
 *                  no approved payment is recorded, in ANY status (cancelled included): somebody paid and has no access
 *                  (incident 2026-11-05). Highest priority, retried every 30 minutes while recent.
 * 1. `due`     — authorized with `next_payment_at` reached (renewal charged or being retried by Mercado Pago).
 * 2. `pending` — checkouts created in the last 3 days still pending, or authorized without an approved payment yet
 *                (first charge whose webhook may have been lost).
 * 3. `stale`   — authorized / paused not synced for 7 days (cancellations or pauses made in Mercado Pago).
 *
 * Nothing synced in the last 6 hours (30 minutes for a first charge) is taken again, so the job can run as often as the
 * plan allows without hammering Mercado Pago. A cancelled subscription is re-synced only in case 0 (it cannot charge
 * again, but the period it already paid must be recorded). Accesses granted by the team are untouched.
 */

export const RECONCILE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A first charge is time-sensitive (the user is waiting for access): pending checkouts are retried sooner. */
export const RECONCILE_PENDING_MIN_INTERVAL_MS = 30 * 60 * 1000;
export const RECONCILE_DUE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
export const RECONCILE_PENDING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const RECONCILE_PENDING_MIN_AGE_MS = 10 * 60 * 1000;
export const RECONCILE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** A charge reported by Mercado Pago but not recorded is chased while the subscription is this recent. */
export const RECONCILE_UNVERIFIED_WINDOW_MS = 40 * 24 * 60 * 60 * 1000;
export const RECONCILE_DEFAULT_LIMIT = 40;
const MAX_CONSECUTIVE_TRANSIENT_FAILURES = 3;

export interface ReconciliationCandidate {
  id: string;
  userId: string;
  preapprovalId: string | null;
  status: string | null;
  nextPaymentAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  /** `summarized.charged_amount` of the stored preapproval snapshot (null when unknown). */
  providerChargedAmount?: number | null;
  /** Whether an approved payment is recorded for this subscription (undefined when not looked up). */
  hasApprovedPayment?: boolean;
}

export interface ReconciliationStore {
  /** Rows that MAY need a re-sync (superset); the selection below decides. */
  listReconciliationCandidates(input: { now: Date; limit: number }): Promise<ReconciliationCandidate[]>;
}

export type ReconcileReason = "unverified" | "due" | "pending" | "stale";

export interface ReconcileItem {
  candidate: ReconciliationCandidate;
  reason: ReconcileReason;
}

function ms(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure: which candidates to sync now, in priority order. */
export function selectReconciliationBatch(candidates: ReconciliationCandidate[], now: Date, limit: number): ReconcileItem[] {
  const nowMs = now.getTime();
  const seen = new Set<string>();
  const items: (ReconcileItem & { rank: number; sortKey: number })[] = [];

  for (const candidate of candidates) {
    if (!candidate.preapprovalId || seen.has(candidate.id)) continue;
    seen.add(candidate.id);

    const status = (candidate.status ?? "").toLowerCase();
    const updated = ms(candidate.updatedAt);
    const created = ms(candidate.createdAt);
    const next = ms(candidate.nextPaymentAt);
    const syncedRecently = (interval: number) => updated !== null && nowMs - updated < interval;
    const unpaid = candidate.hasApprovedPayment === false;
    const firstChargeWindow =
      created !== null && nowMs - created <= RECONCILE_PENDING_WINDOW_MS && nowMs - created >= RECONCILE_PENDING_MIN_AGE_MS;

    if (
      unpaid &&
      (candidate.providerChargedAmount ?? 0) > 0 &&
      created !== null &&
      nowMs - created <= RECONCILE_UNVERIFIED_WINDOW_MS
    ) {
      if (syncedRecently(RECONCILE_PENDING_MIN_INTERVAL_MS)) continue;
      items.push({ candidate, reason: "unverified", rank: -1, sortKey: created });
    } else if (status === "authorized" && unpaid && firstChargeWindow) {
      // Authorized (card linked) but its first charge is not recorded: the payment webhook may have been lost.
      if (syncedRecently(RECONCILE_PENDING_MIN_INTERVAL_MS)) continue;
      items.push({ candidate, reason: "pending", rank: 1, sortKey: created as number });
    } else if (status === "authorized" && next !== null && next <= nowMs + RECONCILE_DUE_LOOKAHEAD_MS) {
      if (syncedRecently(RECONCILE_MIN_INTERVAL_MS)) continue;
      items.push({ candidate, reason: "due", rank: 0, sortKey: next });
    } else if (
      status === "pending" &&
      created !== null &&
      nowMs - created <= RECONCILE_PENDING_WINDOW_MS &&
      nowMs - created >= RECONCILE_PENDING_MIN_AGE_MS
    ) {
      if (syncedRecently(RECONCILE_PENDING_MIN_INTERVAL_MS)) continue;
      items.push({ candidate, reason: "pending", rank: 1, sortKey: created });
    } else if (
      (status === "authorized" || status === "paused") &&
      (updated === null || nowMs - updated >= RECONCILE_STALE_AFTER_MS)
    ) {
      items.push({ candidate, reason: "stale", rank: 2, sortKey: updated ?? 0 });
    }
  }

  return items
    .sort((a, b) => a.rank - b.rank || a.sortKey - b.sortKey)
    .slice(0, Math.max(0, limit))
    .map(({ candidate, reason }) => ({ candidate, reason }));
}

export interface ReconcileReport {
  selected: number;
  synced: number;
  extended: number;
  retryableFailures: number;
  permanentFailures: number;
  /** Synced, but Mercado Pago reports a charge that could not be matched to an approved payment (retried next run). */
  unverified: number;
  notProcessed: number;
  stoppedReason: "completed" | "time_budget" | "transient_failures" | "provider_credentials";
  failures: { subscriptionId: string; code: string }[];
}

export async function reconcileMemberships(
  input: { limit?: number; shouldStop?: () => boolean },
  deps: MembershipDependencies & { store: MembershipStore & ReconciliationStore },
): Promise<ReconcileReport> {
  const now = deps.now ? deps.now() : new Date();
  const limit = input.limit ?? RECONCILE_DEFAULT_LIMIT;

  let candidates: ReconciliationCandidate[];
  try {
    candidates = await deps.store.listReconciliationCandidates({ now, limit: limit * 3 });
  } catch (error) {
    throw new MembershipSyncError("storage_unavailable", error instanceof Error ? error.message : "error", true);
  }

  const batch = selectReconciliationBatch(candidates, now, limit);
  const report: ReconcileReport = {
    selected: batch.length,
    synced: 0,
    extended: 0,
    retryableFailures: 0,
    permanentFailures: 0,
    unverified: 0,
    notProcessed: 0,
    stoppedReason: "completed",
    failures: [],
  };

  let consecutiveTransient = 0;
  for (let index = 0; index < batch.length; index += 1) {
    if (input.shouldStop?.()) {
      report.stoppedReason = "time_budget";
      report.notProcessed = batch.length - index;
      break;
    }
    const { candidate } = batch[index];
    try {
      const result = await syncPreapproval(
        { preapprovalId: candidate.preapprovalId as string, expectedUserId: candidate.userId },
        deps,
      );
      report.synced += 1;
      if (result.membershipExtended) report.extended += 1;
      if (result.chargeUnverified) {
        report.unverified += 1;
        report.failures.push({ subscriptionId: candidate.id, code: "charge_unverified" });
        deps.log?.("reconcile: charge reported by Mercado Pago not verified", {
          subscriptionId: candidate.id,
          lookupFailures: result.lookupFailures,
        });
      }
      consecutiveTransient = 0;
    } catch (error) {
      const syncError =
        error instanceof MembershipSyncError
          ? error
          : new MembershipSyncError("unexpected_error", error instanceof Error ? error.message : "error", true);
      report.failures.push({ subscriptionId: candidate.id, code: syncError.code });
      deps.log?.("reconcile: subscription not synced", { subscriptionId: candidate.id, code: syncError.code });

      if (!syncError.retryable) {
        report.permanentFailures += 1;
        consecutiveTransient = 0;
        continue;
      }
      report.retryableFailures += 1;
      consecutiveTransient += 1;

      // Credentials problem: every call would fail the same way. Stop and leave the rest for the next run.
      if (syncError.code === "provider_http_401" || syncError.code === "provider_http_403") {
        report.stoppedReason = "provider_credentials";
        report.notProcessed = batch.length - index - 1;
        break;
      }
      if (consecutiveTransient >= MAX_CONSECUTIVE_TRANSIENT_FAILURES) {
        report.stoppedReason = "transient_failures";
        report.notProcessed = batch.length - index - 1;
        break;
      }
    }
  }

  return report;
}
