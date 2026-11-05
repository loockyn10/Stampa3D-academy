import type { OpenCheckout } from "@/lib/discounts/repository";

/**
 * "Empezar un pago nuevo": the user is stuck on a pending checkout whose payment Mercado Pago will not take (wrong
 * account, rejected card, "Algo salió mal") or wants to pay with ANOTHER Mercado Pago account.
 *
 * A pending preapproval keeps handing back the same link, so a retry never reaches a new form. Restarting replaces it:
 *   1. the old preapproval is read at Mercado Pago; if it is anything but `pending` (authorized, paused...) NOTHING is
 *      touched - the user may have just paid and the webhook may not have arrived yet;
 *   2. it is cancelled at Mercado Pago (only a confirmed cancellation continues);
 *   3. the local attempt is closed, so the normal flow creates a fresh preapproval with a new idempotency key.
 * Premium is never activated or removed here.
 */

export type RestartOutcome =
  | { kind: "proceed" } // nothing to replace, or the old one was cancelled and closed
  | { kind: "already_subscribed"; status: string }
  | { kind: "in_progress" }
  | { kind: "failed"; reason: "status_unreadable" | "cancel_failed" | "close_failed" | "storage_unavailable" };

export interface RestartDependencies {
  describeOpenCheckout(): Promise<OpenCheckout | null>;
  getPreapprovalStatus(preapprovalId: string): Promise<string | null>;
  cancelPreapproval(preapprovalId: string): Promise<boolean>;
  closePendingCheckout(attemptId: string): Promise<boolean>;
}

export async function restartPendingCheckout(deps: RestartDependencies): Promise<RestartOutcome> {
  let open: OpenCheckout | null;
  try {
    open = await deps.describeOpenCheckout();
  } catch {
    return { kind: "failed", reason: "storage_unavailable" };
  }

  if (!open) return { kind: "proceed" };
  if (open.state !== "completed" || !open.preapprovalId) return { kind: "in_progress" };

  const local = (open.subscriptionStatus ?? "").toLowerCase();
  if (local && local !== "pending") return { kind: "already_subscribed", status: local };

  let remote: string | null;
  try {
    remote = await deps.getPreapprovalStatus(open.preapprovalId);
  } catch {
    remote = null;
  }
  if (!remote) return { kind: "failed", reason: "status_unreadable" };
  if (remote !== "pending") return { kind: "already_subscribed", status: remote };

  let cancelled = false;
  try {
    cancelled = await deps.cancelPreapproval(open.preapprovalId);
  } catch {
    cancelled = false;
  }
  if (!cancelled) return { kind: "failed", reason: "cancel_failed" };

  try {
    if (await deps.closePendingCheckout(open.attemptId)) return { kind: "proceed" };
  } catch {
    // fall through to the re-check below
  }

  // A concurrent request may have closed it already (cancelling twice is harmless).
  try {
    const current = await deps.describeOpenCheckout();
    if (!current || current.attemptId !== open.attemptId) return { kind: "proceed" };
  } catch {
    // unknown
  }
  return { kind: "failed", reason: "close_failed" };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The Mercado Pago account email is optional; when absent the Universo email is used. Never trusted beyond shape. */
export function normalizePayerEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value || value.length > 254 || !EMAIL_PATTERN.test(value)) return null;
  return value;
}
