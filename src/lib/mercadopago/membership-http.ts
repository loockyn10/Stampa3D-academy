import type { MembershipSummary } from "@/lib/mercadopago/membership-billing";
import { MembershipSyncError } from "@/lib/mercadopago/membership-sync";

/** Minimal DTO of "Mi membresía" sent to the browser (no raw provider data, no ids other than the subscription's). */
export function membershipDto(summary: MembershipSummary) {
  return {
    state: summary.state,
    has_access: summary.hasAccess,
    access_until: summary.accessUntil,
    next_charge_at: summary.nextChargeAt,
    amount: summary.amount,
    currency: summary.currency,
    subscription_id: summary.subscriptionId,
    subscription_status: summary.subscriptionStatus,
    can_cancel: summary.canCancel,
    last_payment_status: summary.lastPaymentStatus,
  };
}

export type MembershipDto = ReturnType<typeof membershipDto>;

/** User-facing error for a failed sync/cancel. Never exposes provider details. */
export function membershipErrorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof MembershipSyncError) {
    if (error.code === "owner_mismatch" || error.code === "external_reference_conflict" || error.code === "unlinked_preapproval") {
      return { status: 409, body: { code: "subscription_needs_review", error: "No pudimos verificar esta suscripción. Escribinos y la revisamos." } };
    }
    if (error.retryable) {
      return {
        status: 503,
        body: { code: "provider_unavailable", retryable: true, error: "Mercado Pago no respondió. No se cambió nada; probá de nuevo en unos minutos." },
      };
    }
  }
  return { status: 500, body: { code: "membership_error", retryable: true, error: "No pudimos consultar tu membresía. Probá de nuevo en unos minutos." } };
}
