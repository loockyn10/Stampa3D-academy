import type { BeginCheckoutInput, CheckoutFlowResult } from "@/lib/mercadopago/checkout-flow";
import type { DiscountReservation } from "@/lib/discounts/discount-codes";
import type { AttachResult, OpenCheckout } from "@/lib/discounts/repository";

/**
 * Membership checkout with a discount code.
 *
 *   reserve (DB: validates + prices + holds a use) -> executeCheckout at the reserved amount -> attach (DB checks that
 *   the attempt carries exactly that amount). The use becomes consumed later, when Mercado Pago authorizes the
 *   preapproval (webhook). Any failure releases the reservation, so an unused checkout never burns a use.
 *
 * A user who already has a still-pending (never authorized) checkout at another price gets it replaced: the old
 * preapproval is cancelled at Mercado Pago FIRST and only then closed locally. If that cancellation fails nothing is
 * changed and the discount is not applied (never two live preapprovals).
 */

export interface DiscountCheckoutDependencies {
  reserve(): Promise<DiscountReservation>;
  checkout(input: BeginCheckoutInput): Promise<CheckoutFlowResult>;
  attach(input: { reservationId: string; attemptId: string }): Promise<AttachResult>;
  release(reservationId: string): Promise<void>;
  describeOpenCheckout(): Promise<OpenCheckout | null>;
  cancelPreapproval(preapprovalId: string): Promise<boolean>;
  closePendingCheckout(attemptId: string): Promise<boolean>;
  newIdempotencyKey(): string;
}

export type DiscountCheckoutResult =
  | { kind: "checkout"; result: CheckoutFlowResult; discount: { baseAmount: number; finalAmount: number } | null }
  | { kind: "discount_rejected"; status: DiscountReservation["status"]; message: string }
  | { kind: "discount_unavailable" }
  | { kind: "checkout_conflict"; reason: "amount_mismatch" | "in_progress" | "supersede_failed" }
  | { kind: "discount_persistence_pending" };

async function safeRelease(deps: DiscountCheckoutDependencies, reservationId: string): Promise<void> {
  try {
    await deps.release(reservationId);
  } catch {
    // The reservation expires by itself (TTL); a failed release must never hide the real outcome.
  }
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

  const settle = async (result: CheckoutFlowResult, allowSupersede: boolean): Promise<DiscountCheckoutResult> => {
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

    // The attempt that answered was created with another amount (e.g. a pending checkout without the code).
    if (!allowSupersede || attached !== "amount_mismatch") {
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

    if (open.state !== "completed" || !open.preapprovalId) {
      // A provider call may still be in flight: never replace it.
      await safeRelease(deps, reservationId);
      return { kind: "checkout_conflict", reason: "in_progress" };
    }

    if ((open.subscriptionStatus ?? "").toLowerCase() !== "pending") {
      // Already authorized / active / paused: this is not a new checkout, so no discount applies.
      await safeRelease(deps, reservationId);
      return {
        kind: "checkout",
        result: {
          kind: "blocked_existing_subscription",
          subscriptionId: open.attemptId,
          subscriptionStatus: open.subscriptionStatus ?? "unknown",
          preapprovalId: open.preapprovalId,
        },
        discount: null,
      };
    }

    let cancelled = false;
    try {
      cancelled = await deps.cancelPreapproval(open.preapprovalId);
    } catch {
      cancelled = false;
    }
    if (!cancelled) {
      await safeRelease(deps, reservationId);
      return { kind: "checkout_conflict", reason: "supersede_failed" };
    }

    let closed = false;
    try {
      closed = await deps.closePendingCheckout(open.attemptId);
    } catch {
      closed = false;
    }
    if (!closed) {
      await safeRelease(deps, reservationId);
      return { kind: "checkout_conflict", reason: "supersede_failed" };
    }

    // The previous attempt is closed: its idempotency key is spent, so the discounted checkout uses a fresh one.
    const replacement = await deps.checkout({
      ...input,
      idempotencyKey: deps.newIdempotencyKey(),
      amount: discount.finalAmount,
    });
    return settle(replacement, false);
  };

  const first = await deps.checkout({ ...input, amount: discount.finalAmount });
  return settle(first, true);
}
