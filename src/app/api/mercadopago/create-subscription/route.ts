import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { SupabaseCheckoutAttemptRepository } from "@/lib/mercadopago/checkout-attempt-repository";
import { executeCheckout } from "@/lib/mercadopago/checkout-flow";
import { MercadoPagoPreapprovalClient } from "@/lib/mercadopago/preapproval-client";

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

async function readIdempotencyKey(request: Request): Promise<string> {
  const rawBody = await request.text();

  // Temporary compatibility for an already-open tab running the previous UI.
  // Per-user serialization in PostgreSQL still protects this generated key.
  if (!rawBody) {
    return randomUUID();
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

  return key;
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

export async function POST(request: Request) {
  let idempotencyKey: string;

  try {
    idempotencyKey = await readIdempotencyKey(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_request";
    return response(
      {
        error:
          code === "invalid_json"
            ? "El cuerpo del request no es JSON válido."
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

  const fallbackPrice = process.env.MEMBERSHIP_MONTHLY_PRICE;
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

  const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("membership_settings")
    .select("monthly_price, currency")
    .eq("id", "default")
    .single();

  if (settingsError && !fallbackPrice) {
    console.error(
      "[MP create-subscription] membership settings unavailable",
      settingsError.message,
    );
    return response({ error: "No se pudo obtener el precio de membresía." }, 503);
  }

  const price = settings?.monthly_price
    ? Number(settings.monthly_price)
    : Number(fallbackPrice);
  const currency = String(settings?.currency || "ARS").toUpperCase();

  if (!Number.isFinite(price) || price <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    return response(
      { error: "Precio o moneda de membresía inválidos o no configurados" },
      500,
    );
  }

  const checkoutResult = await executeCheckout(
    {
      userId: user.id,
      idempotencyKey,
      amount: price,
      currency,
      payerEmail: user.email,
      reason: CHECKOUT_REASON,
      backUrl: checkoutBackUrl(appUrl),
    },
    {
      repository: new SupabaseCheckoutAttemptRepository(supabaseAdmin),
      provider: new MercadoPagoPreapprovalClient(accessToken),
    },
  );

  if (checkoutResult.kind === "ready") {
    return response({
      attempt_id: checkoutResult.attemptId,
      init_point: checkoutResult.initPoint,
      preapproval_id: checkoutResult.preapprovalId,
      reused: checkoutResult.reused,
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
