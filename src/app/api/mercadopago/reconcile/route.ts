import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/mercadopago/cron-auth";
import { createMembershipDependencies } from "@/lib/mercadopago/membership-server";
import { reconcileMemberships } from "@/lib/mercadopago/membership-reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hobby allows up to 60 s; the loop stops by itself well before.
export const maxDuration = 60;

const TIME_BUDGET_MS = 40_000;
const noStore = { "Cache-Control": "no-store" };

/**
 * Scheduled reconciliation of memberships with Mercado Pago (vercel.json → crons). Safety net for lost webhooks:
 * renewals, rejected charges, first charges and cancellations made in Mercado Pago get reflected without the user
 * opening the app. Only Vercel Cron (CRON_SECRET) can call it. Idempotent; safe to run more often than scheduled.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: noStore });
  }

  const deps = createMembershipDependencies();
  if (!deps) {
    console.error("[membership reconcile] configuración incompleta");
    return NextResponse.json({ error: "Configuración incompleta" }, { status: 503, headers: noStore });
  }

  const startedAt = Date.now();
  try {
    const report = await reconcileMemberships({ shouldStop: () => Date.now() - startedAt > TIME_BUDGET_MS }, deps);
    console.info("[membership reconcile]", JSON.stringify({ ...report, durationMs: Date.now() - startedAt }));
    return NextResponse.json(report, { headers: noStore });
  } catch (error) {
    console.error("[membership reconcile] falló", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "No se pudo conciliar" }, { status: 500, headers: noStore });
  }
}
