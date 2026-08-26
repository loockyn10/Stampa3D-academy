import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type BeginCheckoutInput,
  type BeginCheckoutResult,
  type CheckoutAttemptRef,
  type CheckoutAttemptRepository,
  type CheckoutProviderError,
  type ProviderPreapproval,
} from "@/lib/mercadopago/checkout-flow";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("La RPC de checkout devolvió una respuesta inválida");
  }

  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`La RPC de checkout no devolvió ${key}`);
  }

  return value;
}

function nullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function attemptFromRpc(record: Record<string, unknown>): CheckoutAttemptRef {
  return {
    attemptId: requiredString(record, "attempt_id"),
    idempotencyKey: requiredString(record, "idempotency_key"),
    externalReference: requiredString(record, "external_reference"),
    claimToken: requiredString(record, "claim_token"),
    payerEmail: requiredString(record, "payer_email"),
  };
}

export class SupabaseCheckoutAttemptRepository
  implements CheckoutAttemptRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async begin(input: BeginCheckoutInput): Promise<BeginCheckoutResult> {
    const { data, error } = await this.client.rpc("begin_membership_checkout", {
      p_user_id: input.userId,
      p_idempotency_key: input.idempotencyKey,
      p_amount: input.amount,
      p_currency: input.currency,
      p_payer_email: input.payerEmail,
      p_reason: input.reason,
      p_back_url: input.backUrl,
    });

    if (error) {
      throw new Error(`No se pudo iniciar el checkout: ${error.message}`);
    }

    const record = asRecord(data);
    const action = requiredString(record, "action");

    if (action === "call_provider" || action === "reconcile") {
      return {
        action,
        attempt: attemptFromRpc(record),
      };
    }

    if (action === "return_ready") {
      return {
        action,
        attemptId: requiredString(record, "attempt_id"),
        preapprovalId: requiredString(record, "preapproval_id"),
        initPoint: requiredString(record, "init_point"),
      };
    }

    if (action === "blocked_existing_subscription") {
      return {
        action,
        subscriptionId: requiredString(record, "subscription_id"),
        subscriptionStatus: requiredString(record, "subscription_status"),
        preapprovalId: nullableString(record, "preapproval_id"),
      };
    }

    if (action === "closed_attempt") {
      return {
        action,
        attemptId: requiredString(record, "attempt_id"),
      };
    }

    throw new Error(`Acción de checkout desconocida: ${action}`);
  }

  async complete(
    attempt: CheckoutAttemptRef,
    preapproval: ProviderPreapproval,
  ): Promise<void> {
    const { error } = await this.client.rpc("complete_membership_checkout", {
      p_attempt_id: attempt.attemptId,
      p_claim_token: attempt.claimToken,
      p_preapproval_id: preapproval.id,
      p_init_point: preapproval.initPoint,
      p_provider_status: preapproval.status,
      p_provider_response: preapproval.raw,
    });

    if (error) {
      throw new Error(`No se pudo completar el checkout local: ${error.message}`);
    }
  }

  async markProviderError(
    attempt: CheckoutAttemptRef,
    error: CheckoutProviderError,
  ): Promise<void> {
    const { error: rpcError } = await this.client.rpc(
      "mark_membership_checkout_provider_error",
      {
        p_attempt_id: attempt.attemptId,
        p_claim_token: attempt.claimToken,
        p_error_code: error.code,
        p_error_message: error.message,
        p_provider_response: error.providerResponse,
      },
    );

    if (rpcError) {
      throw new Error(
        `No se pudo registrar el rechazo de Mercado Pago: ${rpcError.message}`,
      );
    }
  }

  async markReconciliationRequired(
    attempt: CheckoutAttemptRef,
    code: string,
    message: string,
  ): Promise<void> {
    const { error } = await this.client.rpc(
      "mark_membership_checkout_reconciliation",
      {
        p_attempt_id: attempt.attemptId,
        p_claim_token: attempt.claimToken,
        p_error_code: code,
        p_error_message: message,
      },
    );

    if (error) {
      throw new Error(
        `No se pudo marcar el checkout para reconciliación: ${error.message}`,
      );
    }
  }
}
