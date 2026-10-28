import type { BeginCheckoutInput, CheckoutFlowResult } from "@/lib/mercadopago/checkout-flow";
import type { DiscountReservation } from "@/lib/discounts/discount-codes";
import type { AttachResult, OpenCheckout } from "@/lib/discounts/repository";

/**
 * A membership checkout must always carry the price (and discount) that was confirmed for THIS purchase attempt.
 *
 * Discounted flow:
 *   reserve (DB: validates + prices + holds a seat) -> executeCheckout at the reserved amount -> attach (DB checks that
 *   the attempt carries exactly that amount). The seat is consumed when Mercado Pago authorizes the preapproval
 *   (webhook). Any failure releases the reservation, so an unused checkout never burns a seat.
 *
 * Plain flow (no code): if the user's still-pending checkout carries ANOTHER amount (typically: they applied a code,
 * got a checkout, then removed the code) it is replaced instead of being handed back with the old discount.
 *
 * Replacing a pending checkout: the old preapproval is cancelled at Mercado Pago FIRST and only then closed locally.
 * If that cancellation is not confirmed nothing is changed (never two live preapprovals, never a silent downgrade).
 * Only a completed attempt whose subscription is still `pending` (never authorized) can be replaced.
 */

export type CheckoutConflictReason = "amount_mismatch" | "in_progress" | "supersede_failed" | "reservation_lost";

export interface CheckoutReplacementDependencies {
  checkout(input: BeginCheckoutInput): Promise<CheckoutFlowResult>;
  describeOpenCheckout(): Promise<OpenCheckout | null>;
  cancelPreapproval(preapprovalId: string): Promise<boolean>;
  closePendingCheckout(attemptId: string): Promise<boolean>;
  newIdempotencyKey(): string;
}

export interface DiscountCheckoutDependencies extends CheckoutReplacementDependencies {
  reserve(): Promise<DiscountReservation>;
  attach(input: { reservationId: string; attemptId: string }): Promise<AttachResult>;
  release(reservationId: string): Promise<void>;
}

export type DiscountCheckoutResult =
  | { kind: "checkout"; result: CheckoutFlowResult; discount: { baseAmount: number; finalAmount: number } | null }
  | { kind: "discount_rejected"; status: DiscountReservation["status"]; message: string }
  | { kind: "discount_unavailable" }
  | { kind: "checkout_conflict"; reason: CheckoutConflictReason }
  | { kind: "discount_persistence_pending" };

export type PlainCheckoutResult =
  | { kind: "checkout"; result: CheckoutFlowResult }
  | { kind: "checkout_conflict"; reason: CheckoutConflictReason };

/** checkout_attempts.amount is numeric(12,2): compare to the cent, never with ===. */
export function sameAmount(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;
}

type ReplacementOutcome =
  | { kind: "replaced"; result: CheckoutFlowResult }
  | { kind: "not_pending"; subscriptionStatus: string | null; preapprovalId: string | null }
  | { kind: "conflict"; reason: CheckoutConflictReason };

async function replacePendingCheckout(
  input: BeginCheckoutInput,
  open: OpenCheckout,
  expectedAmount: number,
  deps: CheckoutReplacementDependencies,
): Promise<ReplacementOutcome> {
  if (open.state !== "completed" || !open.preapprovalId) {
    // A provider call may still be in flight: never replace it.
    return { kind: "conflict", reason: "in_progress" };
  }

  if ((open.subscriptionStatus ?? "").toLowerCase() !== "pending") {
    // Authorized / active / paused: the user already subscribed, so this is not a checkout to rewrite.
    return { kind: "not_pending", subscriptionStatus: open.subscriptionStatus, preapprovalId: open.preapprovalId };
  }

  let cancelled = false;
  try {
    cancelled = await deps.cancelPreapproval(open.preapprovalId);
  } catch {
    cancelled = false;
  }
  if (!cancelled) return { kind: "conflict", reason: "supersede_failed" };

  let closed = false;
  try {
    closed = await deps.closePendingCheckout(open.attemptId);
  } catch {
    closed = false;
  }

  if (!closed) {
    // A concurrent request may have replaced it already (cancelling twice is harmless). If the old attempt is gone,
    // continue: the database hands back whatever open attempt now exists, and the caller verifies its amount.
    let current: OpenCheckout | null;
    try {
      current = await deps.describeOpenCheckout();
    } catch {
      return { kind: "conflict", reason: "supersede_failed" };
    }
    if (current && current.attemptId === open.attemptId) return { kind: "conflict", reason: "supersede_failed" };
  }

  // The previous attempt is closed: its idempotency key is spent, so the replacement uses a fresh one.
  const result = await deps.checkout({ ...input, idempotencyKey: deps.newIdempotencyKey(), amount: expectedAmount });
  return { kind: "replaced", result };
}

async function safeRelease(deps: DiscountCheckoutDependencies, reservationId: string): Promise<void> {
  try {
    await deps.release(reservationId);
  } catch {
    // The reservation retires by itself; a failed release must never hide the real outcome.
  }
}

/** Checkout without a discount code. Behaves exactly like executeCheckout unless a stale-priced pending checkout is handed back. */
export async function executePlainCheckout(
  input: BeginCheckoutInput,
  deps: CheckoutReplacementDependencies,
): Promise<PlainCheckoutResult> {
  const result = await deps.checkout(input);

  // A freshly created attempt carries `input.amount` by construction; only a reused one can be stale.
  if (result.kind !== "ready" || !result.reused) return { kind: "checkout", result };

  let open: OpenCheckout | null;
  try {
    open = await deps.describeOpenCheckout();
  } catch {
    // Discount support is not deployed in the database yet: keep the previous behaviour untouched.
    return { kind: "checkout", result };
  }

  if (!open || open.attemptId !== result.attemptId || sameAmount(open.amount, input.amount)) {
    return { kind: "checkout", result };
  }

  const replacement = await replacePendingCheckout(input, open, input.amount, deps);

  if (replacement.kind === "conflict") return { kind: "checkout_conflict", reason: replacement.reason };
  if (replacement.kind === "not_pending") return { kind: "checkout", result };

  if (replacement.result.kind !== "ready") return { kind: "checkout", result: replacement.result };

  // Whatever answered must really carry the list price.
  let verified: OpenCheckout | null;
  try {
    verified = await deps.describeOpenCheckout();
  } catch {
    return { kind: "checkout_conflict", reason: "amount_mismatch" };
  }
  if (!verified || verified.attemptId !== replacement.result.attemptId || !sameAmount(verified.amount, input.amount)) {
    return { kind: "checkout_conflict", reason: "amount_mismatch" };
  }

  return { kind: "checkout", result: replacement.result };
}

export async function executeDiscountedCheckout(
  input: BeginCheckoutInput,
  deps: DiscountCheckoutDependencies,
): Promise<DiscountCheckoutResult> {
  let reservation: DiscountReservation;

  try {
    reservation = await deps.reserve();
  } catch {
    return { kind: "discount_unavailable" };
  }

  if (!reservation.ok || reservation.status !== "reserved" || !reservation.reservationId || reservation.finalAmount === null || reservation.baseAmount === null) {
    return { kind: "discount_rejected", status: reservation.status, message: reservation.message };
  }

  // Defence in depth: whatever the database answered, the checkout never charges more than the list price.
  if (reservation.finalAmount <= 0 || reservation.finalAmount >= input.amount) {
    await safeRelease(deps, reservation.reservationId);
    return { kind: "discount_rejected", status: "error", message: reservation.message };
  }

  const reservationId = reservation.reservationId;
  const discount = { baseAmount: reservation.baseAmount, finalAmount: reservation.finalAmount };

  const settle = async (result: CheckoutFlowResult, allowReplace: boolean): Promise<DiscountCheckoutResult> => {
    if (result.kind !== "ready" && result.kind !== "reconciliation_pending") {
      await safeRelease(deps, reservationId);
      return { kind: "checkout", result, discount: null };
    }

    let attached: AttachResult;
    try {
      attached = await deps.attach({ reservationId, attemptId: result.attemptId });
    } catch {
      // The checkout exists (idempotent retry returns it) but its discount is not recorded yet: fail closed.
      return { kind: "discount_persistence_pending" };
    }

    if (attached === "attached") return { kind: "checkout", result, discount };

    if (attached !== "amount_mismatch") {
      // The reservation no longer holds its seat (retired by another request): the checkout is not discounted.
      await safeRelease(deps, reservationId);
      return { kind: "checkout_conflict", reason: "reservation_lost" };
    }

    // The attempt that answered was created with another amount (e.g. a pending checkout without the code).
    if (!allowReplace) {
      await safeRelease(deps, reservationId);
      return { kind: "checkout_conflict", reason: "amount_mismatch" };
    }

    let open: OpenCheckout | null;
    try {
      open = await deps.describeOpenCheckout();
    } catch {
      await safeRelease(deps, reservationId);
      return { kind: "checkout_conflict", reason: "supersede_failed" };
    }

    if (!open || open.attemptId !== result.attemptId) {
      await safeRelease(deps, reservationId);
      return { kind: "checkout_conflict", reason: "amount_mismatch" };
    }

    const replacement = await replacePendingCheckout(input, open, discount.finalAmount, deps);

    if (replacement.kind === "conflict") {
      await safeRelease(deps, reservationId);
      return { kind: "checkout_conflict", reason: replacement.reason };
    }

    if (replacement.kind === "not_pending") {
      await safeRelease(deps, reservationId);
      return {
        kind: "checkout",
        result: {
          kind: "blocked_existing_subscription",
          subscriptionId: open.attemptId,
          subscriptionStatus: replacement.subscriptionStatus ?? "unknown",
          preapprovalId: replacement.preapprovalId,
        },
        discount: null,
      };
    }

    return settle(replacement.result, false);
  };

  const first = await deps.checkout({ ...input, amount: discount.finalAmount });
  return settle(first, true);
}
