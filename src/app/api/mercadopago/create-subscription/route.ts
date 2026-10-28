import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { SupabaseCheckoutAttemptRepository } from "@/lib/mercadopago/checkout-attempt-repository";
import { executeCheckout, type CheckoutFlowResult } from "@/lib/mercadopago/checkout-flow";
import { MercadoPagoPreapprovalClient } from "@/lib/mercadopago/preapproval-client";
import { loadMembershipPrice } from "@/lib/mercadopago/membership-price";
import { executeDiscountedCheckout, executePlainCheckout } from "@/lib/mercadopago/discount-checkout";
import {
  DISCOUNT_CODE_MAX_INPUT_LENGTH,
  DISCOUNT_MESSAGES,
  discountCodesEnabled,
  normalizeDiscountCode,
} from "@/lib/discounts/discount-codes";
import {
  attachDiscountReservation,
  closePendingCheckout,
  describeOpenCheckout,
  releaseDiscountReservation,
  reserveDiscountCode,
} from "@/lib/discounts/repository";

export const runtime = "nodejs";

const CHECKOUT_REASON = "Membresía Academia Stampa";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

interface CheckoutRequestBody {
  idempotencyKey: string;
  discountCode: string | null;
}

/**
 * The body only carries the idempotency key and, optionally, the TEXT of a discount code. A price, a percentage or any
 * other amount sent by the client is never read: the discounted amount comes from the database.
 */
async function readCheckoutBody(request: Request): Promise<CheckoutRequestBody> {
  const rawBody = await request.text();

  // Temporary compatibility for an already-open tab running the previous UI.
  // Per-user serialization in PostgreSQL still protects this generated key.
  if (!rawBody) {
    return { idempotencyKey: randomUUID(), discountCode: null };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new Error("invalid_json");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("invalid_idempotency_key");
  }

  const key = (body as Record<string, unknown>).idempotency_key;
  if (typeof key !== "string" || !UUID_PATTERN.test(key)) {
    throw new Error("invalid_idempotency_key");
  }

  const rawCode = (body as Record<string, unknown>).discount_code;
  let discountCode: string | null = null;
  if (rawCode !== undefined && rawCode !== null && rawCode !== "") {
    if (typeof rawCode !== "string" || rawCode.length > DISCOUNT_CODE_MAX_INPUT_LENGTH * 2) {
      throw new Error("invalid_discount_code");
    }
    discountCode = normalizeDiscountCode(rawCode) || null;
  }

  return { idempotencyKey: key, discountCode };
}

function checkoutBackUrl(appUrl: string): string {
  try {
    return new URL("/pago/estado", appUrl).toString();
  } catch {
    return new URL(
      "/pago/estado",
      `https://${appUrl.replace(/^https?:\/\//, "")}`,
    ).toString();
  }
}

function respondToCheckoutResult(
  checkoutResult: CheckoutFlowResult,
  extra: Record<string, unknown> = {},
) {
  if (checkoutResult.kind === "ready") {
    return response({
      attempt_id: checkoutResult.attemptId,
      init_point: checkoutResult.initPoint,
      preapproval_id: checkoutResult.preapprovalId,
      reused: checkoutResult.reused,
      ...extra,
    });
  }

  if (checkoutResult.kind === "reconciliation_pending") {
    return response(
      {
        code: "checkout_reconciliation_pending",
        status: "reconciliation_pending",
        attempt_id: checkoutResult.attemptId,
        retryable: true,
        error: checkoutResult.message,
      },
      202,
    );
  }

  if (checkoutResult.kind === "blocked_existing_subscription") {
    return response(
      {
        code: "existing_subscription",
        error:
          "Ya existe una suscripción activa o pendiente para esta cuenta. No se creó otra.",
        subscription_status: checkoutResult.subscriptionStatus,
        preapproval_id: checkoutResult.preapprovalId,
      },
      409,
    );
  }

  if (checkoutResult.kind === "closed_attempt") {
    return response(
      {
        code: "checkout_attempt_closed",
        error:
          "Este intento ya está cerrado. Volvé a intentar para iniciar una nueva suscripción.",
        new_attempt_required: true,
      },
      409,
    );
  }

  if (checkoutResult.kind === "provider_error") {
    console.error(
      "[MP create-subscription] definite provider rejection",
      checkoutResult.code,
    );
    return response(
      { error: "Mercado Pago rechazó la creación. Probá nuevamente." },
      502,
    );
  }

  console.error(
    "[MP create-subscription] durable storage error",
    checkoutResult.phase,
    checkoutResult.message,
  );
  return response(
    {
      error:
        checkoutResult.phase === "after_provider"
          ? "Mercado Pago respondió, pero el resultado local aún debe reconciliarse. No vuelvas a iniciar otro checkout."
          : "No pudimos iniciar el checkout de forma segura. Probá nuevamente.",
      code:
        checkoutResult.phase === "after_provider"
          ? "checkout_persistence_pending"
          : "checkout_storage_unavailable",
    },
    503,
  );
}

export async function POST(request: Request) {
  let body: CheckoutRequestBody;

  try {
    body = await readCheckoutBody(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_request";
    return response(
      {
        error:
          code === "invalid_json"
            ? "El cuerpo del request no es JSON válido."
            : code === "invalid_discount_code"
              ? "El código de descuento no es válido."
              : "idempotency_key debe ser un UUID válido.",
      },
      400,
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return response({ error: "Unauthorized" }, 401);
  }

  if (!user.email) {
    return response({ error: "Usuario sin email configurado" }, 400);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!accessToken) {
    return response({ error: "Falta configurar Mercado Pago." }, 500);
  }
  if (!appUrl) {
    return response({ error: "NEXT_PUBLIC_APP_URL no configurado" }, 500);
  }
  if (!serviceRoleKey || !supabaseUrl) {
    return response({ error: "Configuración de Supabase incompleta" }, 500);
  }

  // A code is never ignored silently: with the kill switch off the request is refused, not charged at full price.
  if (body.discountCode && !discountCodesEnabled()) {
    return response(
      { code: "discount_codes_disabled", error: DISCOUNT_MESSAGES.disabled },
      409,
    );
  }

  const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const membershipPrice = await loadMembershipPrice(supabaseAdmin);

  if (!membershipPrice.ok) {
    return response({ error: membershipPrice.error }, membershipPrice.status);
  }

  const { price, currency } = membershipPrice;
  const provider = new MercadoPagoPreapprovalClient(accessToken);
  const dependencies = {
    repository: new SupabaseCheckoutAttemptRepository(supabaseAdmin),
    provider,
  };
  const checkoutInput = {
    userId: user.id,
    idempotencyKey: body.idempotencyKey,
    amount: price,
    currency,
    payerEmail: user.email,
    reason: CHECKOUT_REASON,
    backUrl: checkoutBackUrl(appUrl),
  };

  const replacementDependencies = {
    checkout: (input: typeof checkoutInput) => executeCheckout(input, dependencies),
    describeOpenCheckout: () => describeOpenCheckout(supabaseAdmin, user.id),
    cancelPreapproval: (preapprovalId: string) => provider.cancel(preapprovalId),
    closePendingCheckout: (attemptId: string) => closePendingCheckout(supabaseAdmin, { userId: user.id, attemptId }),
    newIdempotencyKey: () => randomUUID(),
  };

  if (!body.discountCode) {
    // Same flow as always, except that a still-pending checkout created with another amount (e.g. with a discount the
    // user has since removed) is replaced instead of being handed back.
    const plain = await executePlainCheckout(checkoutInput, replacementDependencies);
    if (plain.kind === "checkout") return respondToCheckoutResult(plain.result);
    return conflictResponse(plain.reason, false);
  }

  const code = body.discountCode;
  const outcome = await executeDiscountedCheckout(checkoutInput, {
    ...replacementDependencies,
    reserve: () => reserveDiscountCode(supabaseAdmin, { userId: user.id, code, baseAmount: price, currency }),
    attach: ({ reservationId, attemptId }) =>
      attachDiscountReservation(supabaseAdmin, { userId: user.id, reservationId, attemptId }),
    release: (reservationId) => releaseDiscountReservation(supabaseAdmin, { userId: user.id, reservationId }),
  });

  if (outcome.kind === "checkout") {
    return respondToCheckoutResult(
      outcome.result,
      outcome.discount
        ? {
            discount: {
              base_amount: outcome.discount.baseAmount,
              final_amount: outcome.discount.finalAmount,
            },
          }
        : {},
    );
  }

  if (outcome.kind === "discount_rejected") {
    return response(
      { code: `discount_${outcome.status}`, error: outcome.message },
      outcome.status === "rate_limited" ? 429 : 422,
    );
  }

  if (outcome.kind === "discount_unavailable") {
    return response(
      { code: "discount_unavailable", error: DISCOUNT_MESSAGES.error },
      503,
    );
  }

  if (outcome.kind === "discount_persistence_pending") {
    return response(
      {
        code: "discount_persistence_pending",
        error:
          "Tu checkout quedó creado pero el descuento todavía no se registró. Volvé a intentar: no se cobrará dos veces.",
        retryable: true,
      },
      503,
    );
  }

  return conflictResponse(outcome.reason, true);
}

function conflictResponse(
  reason: "amount_mismatch" | "in_progress" | "supersede_failed" | "reservation_lost",
  withDiscount: boolean,
) {
  const message =
    reason === "in_progress"
      ? "Tenés un checkout en verificación. Esperá unos instantes y volvé a intentar."
      : reason === "reservation_lost"
        ? "El descuento ya no está disponible. Volvé a aplicar el código o continuá sin descuento."
        : withDiscount
          ? "No pudimos reemplazar tu checkout pendiente para aplicar el descuento. No se cambió nada ni se cobró. Probá de nuevo o continuá sin código."
          : "No pudimos actualizar tu checkout pendiente al precio actual. No se cambió nada ni se cobró. Probá de nuevo en unos minutos.";

  return response({ code: `checkout_${reason}`, error: message, new_attempt_required: false }, 409);
}
