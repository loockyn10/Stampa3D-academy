export interface CheckoutAttemptRef {
  attemptId: string;
  idempotencyKey: string;
  externalReference: string;
  claimToken: string;
  payerEmail: string;
}

export type BeginCheckoutResult =
  | { action: "call_provider"; attempt: CheckoutAttemptRef }
  | { action: "reconcile"; attempt: CheckoutAttemptRef }
  | {
      action: "return_ready";
      attemptId: string;
      preapprovalId: string;
      initPoint: string;
    }
  | {
      action: "blocked_existing_subscription";
      subscriptionId: string;
      subscriptionStatus: string;
      preapprovalId: string | null;
    }
  | { action: "closed_attempt"; attemptId: string };

export interface BeginCheckoutInput {
  userId: string;
  idempotencyKey: string;
  amount: number;
  currency: string;
  payerEmail: string;
  reason: string;
  backUrl: string;
}

export interface ProviderPreapproval {
  id: string;
  initPoint: string;
  status: string;
  raw: Record<string, unknown>;
}

export interface CheckoutAttemptRepository {
  begin(input: BeginCheckoutInput): Promise<BeginCheckoutResult>;
  complete(
    attempt: CheckoutAttemptRef,
    preapproval: ProviderPreapproval,
  ): Promise<void>;
  markProviderError(
    attempt: CheckoutAttemptRef,
    error: CheckoutProviderError,
  ): Promise<void>;
  markReconciliationRequired(
    attempt: CheckoutAttemptRef,
    code: string,
    message: string,
  ): Promise<void>;
}

export interface PreapprovalProvider {
  create(input: {
    attempt: CheckoutAttemptRef;
    amount: number;
    currency: string;
    reason: string;
    backUrl: string;
  }): Promise<ProviderPreapproval>;
  findByExternalReference(input: {
    externalReference: string;
    payerEmail: string;
  }): Promise<ProviderPreapproval | null>;
}

export type CheckoutFlowResult =
  | {
      kind: "ready";
      attemptId: string;
      preapprovalId: string;
      initPoint: string;
      reused: boolean;
    }
  | {
      kind: "reconciliation_pending";
      attemptId: string;
      message: string;
    }
  | {
      kind: "blocked_existing_subscription";
      subscriptionId: string;
      subscriptionStatus: string;
      preapprovalId: string | null;
    }
  | { kind: "closed_attempt"; attemptId: string }
  | {
      kind: "provider_error";
      code: string;
      message: string;
    }
  | {
      kind: "storage_error";
      phase: "before_provider" | "after_provider" | "recording_provider_error";
      message: string;
    };

export class CheckoutProviderError extends Error {
  readonly ambiguous: boolean;
  readonly code: string;
  readonly providerResponse: Record<string, unknown> | null;

  constructor(input: {
    message: string;
    code: string;
    ambiguous: boolean;
    providerResponse?: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = "CheckoutProviderError";
    this.ambiguous = input.ambiguous;
    this.code = input.code;
    this.providerResponse = input.providerResponse ?? null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido";
}

async function persistAndReturnReady(
  repository: CheckoutAttemptRepository,
  attempt: CheckoutAttemptRef,
  preapproval: ProviderPreapproval,
  reused: boolean,
): Promise<CheckoutFlowResult> {
  try {
    await repository.complete(attempt, preapproval);
  } catch (error) {
    return {
      kind: "storage_error",
      phase: "after_provider",
      message: errorMessage(error),
    };
  }

  return {
    kind: "ready",
    attemptId: attempt.attemptId,
    preapprovalId: preapproval.id,
    initPoint: preapproval.initPoint,
    reused,
  };
}

export async function executeCheckout(
  input: BeginCheckoutInput,
  dependencies: {
    repository: CheckoutAttemptRepository;
    provider: PreapprovalProvider;
  },
): Promise<CheckoutFlowResult> {
  let beginResult: BeginCheckoutResult;

  try {
    beginResult = await dependencies.repository.begin(input);
  } catch (error) {
    return {
      kind: "storage_error",
      phase: "before_provider",
      message: errorMessage(error),
    };
  }

  if (beginResult.action === "return_ready") {
    return {
      kind: "ready",
      attemptId: beginResult.attemptId,
      preapprovalId: beginResult.preapprovalId,
      initPoint: beginResult.initPoint,
      reused: true,
    };
  }

  if (beginResult.action === "blocked_existing_subscription") {
    return {
      kind: "blocked_existing_subscription",
      subscriptionId: beginResult.subscriptionId,
      subscriptionStatus: beginResult.subscriptionStatus,
      preapprovalId: beginResult.preapprovalId,
    };
  }

  if (beginResult.action === "closed_attempt") {
    return {
      kind: "closed_attempt",
      attemptId: beginResult.attemptId,
    };
  }

  if (beginResult.action === "reconcile") {
    let recovered: ProviderPreapproval | null;

    try {
      recovered = await dependencies.provider.findByExternalReference({
        externalReference: beginResult.attempt.externalReference,
        payerEmail: beginResult.attempt.payerEmail,
      });
    } catch {
      return {
        kind: "reconciliation_pending",
        attemptId: beginResult.attempt.attemptId,
        message:
          "El intento sigue protegido, pero Mercado Pago todavía no pudo ser consultado.",
      };
    }

    if (!recovered) {
      return {
        kind: "reconciliation_pending",
        attemptId: beginResult.attempt.attemptId,
        message:
          "El intento sigue en verificación. No se creará otra suscripción mientras el resultado sea ambiguo.",
      };
    }

    return persistAndReturnReady(
      dependencies.repository,
      beginResult.attempt,
      recovered,
      true,
    );
  }

  try {
    const preapproval = await dependencies.provider.create({
      attempt: beginResult.attempt,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
      backUrl: input.backUrl,
    });

    return persistAndReturnReady(
      dependencies.repository,
      beginResult.attempt,
      preapproval,
      false,
    );
  } catch (error) {
    const providerError =
      error instanceof CheckoutProviderError
        ? error
        : new CheckoutProviderError({
            message: errorMessage(error),
            code: "provider_transport_error",
            ambiguous: true,
          });

    if (providerError.ambiguous) {
      try {
        await dependencies.repository.markReconciliationRequired(
          beginResult.attempt,
          providerError.code,
          providerError.message,
        );
      } catch {
        // The durable attempt was committed before the provider call. If this
        // update also fails, its existing `creating` state still prevents a
        // second provider call and is reconciled by the next retry.
      }

      return {
        kind: "reconciliation_pending",
        attemptId: beginResult.attempt.attemptId,
        message:
          "Mercado Pago pudo haber recibido la solicitud. El intento quedó protegido y debe reconciliarse antes de reintentar.",
      };
    }

    try {
      await dependencies.repository.markProviderError(
        beginResult.attempt,
        providerError,
      );
    } catch (storageError) {
      return {
        kind: "storage_error",
        phase: "recording_provider_error",
        message: errorMessage(storageError),
      };
    }

    return {
      kind: "provider_error",
      code: providerError.code,
      message: providerError.message,
    };
  }
}
