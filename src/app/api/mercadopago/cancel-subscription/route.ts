import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createMembershipDependencies } from "@/lib/mercadopago/membership-server";
import { cancelUserSubscription } from "@/lib/mercadopago/membership-sync";
import { membershipDto, membershipErrorResponse } from "@/lib/mercadopago/membership-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Cancels the session user's subscription in Mercado Pago (no more charges) and keeps the paid period.
 * Body: { subscription_id, confirm: true }. The subscription must belong to the session user; another user's id is
 * answered exactly like a missing one. Nothing is changed locally unless Mercado Pago confirms the cancellation.
 */
export async function POST(request: Request) {
  // JSON only: a cross-site form cannot send it without a CORS preflight.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return reply({ error: "Formato de solicitud inválido." }, 415);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as Record<string, unknown>;
  } catch {
    return reply({ error: "Solicitud inválida." }, 400);
  }

  const subscriptionId = body.subscription_id;
  if (typeof subscriptionId !== "string" || !UUID_PATTERN.test(subscriptionId) || body.confirm !== true) {
    return reply({ error: "Falta confirmar la cancelación." }, 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return reply({ error: "Unauthorized" }, 401);

  const deps = createMembershipDependencies();
  if (!deps) return reply({ error: "Configuración incompleta" }, 500);

  try {
    const outcome = await cancelUserSubscription({ userId: user.id, subscriptionId }, deps);
    if (outcome.kind === "not_found") {
      return reply({ code: "subscription_not_found", error: "No encontramos esa suscripción en tu cuenta." }, 404);
    }
    if (outcome.kind === "not_cancellable") {
      return reply(
        { code: "subscription_not_cancellable", error: "Esta suscripción ya no tiene renovaciones para cancelar.", membership: membershipDto(outcome.summary) },
        409,
      );
    }
    if (outcome.kind === "not_confirmed") {
      return reply(
        {
          code: "cancellation_not_confirmed",
          retryable: true,
          error: "Mercado Pago todavía no confirmó la cancelación. Probá de nuevo en unos minutos.",
          membership: membershipDto(outcome.summary),
        },
        502,
      );
    }
    return reply({ cancelled: true, already_cancelled: outcome.alreadyCancelled, membership: membershipDto(outcome.summary) });
  } catch (error) {
    console.error("[MP cancel-subscription]", error instanceof Error ? error.message : "error");
    const failure = membershipErrorResponse(error);
    return reply(failure.body, failure.status);
  }
}
