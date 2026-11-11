import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/mercadopago/cron-auth";
import { createMembershipDependencies } from "@/lib/mercadopago/membership-server";
import { reconcileMemberships } from "@/lib/mercadopago/membership-reconcile";
import { createPriceAlertDeps, createPriceScheduleRunnerDeps } from "@/lib/mercadopago/price-schedule-server";
import { runPriceScheduleAlerts } from "@/lib/mercadopago/price-schedule-alert-runner";
import { runPriceSchedules } from "@/lib/mercadopago/price-schedule-runner";

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

    // Promotional price schedules (notices + automatic change). Off unless PRICE_SCHEDULES_ENABLED = "true". Isolated:
    // a failure here never fails the membership reconciliation above.
    let priceSchedules: unknown = null;
    const runnerDeps = createPriceScheduleRunnerDeps({
      admin: deps.admin,
      provider: deps.provider,
      accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN as string,
    });
    if (runnerDeps) {
      try {
        priceSchedules = await runPriceSchedules({ shouldStop: () => Date.now() - startedAt > TIME_BUDGET_MS + 10_000 }, runnerDeps);
        console.info("[price schedules]", JSON.stringify(priceSchedules));
      } catch (error) {
        console.error("[price schedules] falló", error instanceof Error ? error.message : "error");
        priceSchedules = { error: "run_failed" };
      }
    }

    // Alerts for the administrator (validation of the price change pending, schedules needing review). Isolated too.
    let priceAlerts: unknown = null;
    const alertDeps = createPriceAlertDeps(deps.admin);
    if (alertDeps) {
      try {
        priceAlerts = await runPriceScheduleAlerts(alertDeps);
      } catch (error) {
        console.error("[price alerts] falló", error instanceof Error ? error.message : "error");
        priceAlerts = { error: "alerts_failed" };
      }
    }
    return NextResponse.json(priceSchedules ? { ...report, priceSchedules, priceAlerts } : report, { headers: noStore });
  } catch (error) {
    console.error("[membership reconcile] falló", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "No se pudo conciliar" }, { status: 500, headers: noStore });
  }
}
