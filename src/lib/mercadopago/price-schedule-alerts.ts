import { DAY_MS } from "@/lib/mercadopago/price-schedule";

/**
 * Alerts so that validating the automatic price change with Mercado Pago never stays pending until the first
 * promotional subscriptions reach their regular price. Pure: the cron sends them (once per level) and the admin page
 * shows them while they apply.
 *
 * While PRICE_STEP_UP_ENABLED is off the system keeps charging the promotional price. The alert levels count down to the
 * first end of promotion (the notice must go out `noticeDays` before, so "urgent" leaves a few days of margin).
 */

export type ValidationAlertLevel = "none" | "far" | "mid" | "near" | "urgent" | "overdue";

/** Days before the first promotion ends at which each level starts. */
export const VALIDATION_ALERT_DAYS = { far: 120, mid: 75, near: 45, urgent: 28 } as const;

export interface ScheduleOverviewRow {
  id: string;
  userId: string;
  status: string;
  promoPrice: number;
  postPrice: number;
  promoEndsAt: string | null;
  noticeEmailSentAt: string | null;
  attempts: number;
  lastError: string | null;
}

export interface ValidationAlert {
  level: ValidationAlertLevel;
  /** Days until the first promotion ends (negative when it already ended). Null when there is no active schedule with a calendar. */
  daysLeft: number | null;
  /** Schedule the alert is attached to (the first one to reach the regular price). */
  scheduleId: string | null;
  activeSchedules: number;
  message: string;
}

export function computeValidationAlert(input: { stepUpEnabled: boolean; schedules: readonly ScheduleOverviewRow[]; now: Date }): ValidationAlert {
  const active = input.schedules.filter((row) => row.status === "scheduled");
  const withCalendar = active
    .filter((row) => row.promoEndsAt && Number.isFinite(new Date(row.promoEndsAt).getTime()))
    .sort((a, b) => new Date(a.promoEndsAt as string).getTime() - new Date(b.promoEndsAt as string).getTime());
  const first = withCalendar[0] ?? null;

  if (input.stepUpEnabled) {
    return { level: "none", daysLeft: null, scheduleId: first?.id ?? null, activeSchedules: active.length, message: "El cambio automático de importe está habilitado." };
  }
  if (!first) {
    return {
      level: "none",
      daysLeft: null,
      scheduleId: null,
      activeSchedules: active.length,
      message: active.length > 0 ? "Hay suscripciones promocionales sin calendario todavía (esperando su primer cobro)." : "No hay suscripciones promocionales activas.",
    };
  }

  const daysLeft = Math.ceil((new Date(first.promoEndsAt as string).getTime() - input.now.getTime()) / DAY_MS);
  let level: ValidationAlertLevel = "none";
  if (daysLeft < 0) level = "overdue";
  else if (daysLeft <= VALIDATION_ALERT_DAYS.urgent) level = "urgent";
  else if (daysLeft <= VALIDATION_ALERT_DAYS.near) level = "near";
  else if (daysLeft <= VALIDATION_ALERT_DAYS.mid) level = "mid";
  else if (daysLeft <= VALIDATION_ALERT_DAYS.far) level = "far";

  const message =
    level === "none"
      ? `La primera promoción termina en ${daysLeft} días. El cambio de importe sigue sin validar con Mercado Pago.`
      : level === "overdue"
        ? `La primera promoción terminó hace ${Math.abs(daysLeft)} días y el cambio de importe NO está habilitado: se siguen cobrando $${first.promoPrice} en vez de $${first.postPrice}. Validá con Mercado Pago y habilitá PRICE_STEP_UP_ENABLED.`
        : `La primera promoción termina en ${daysLeft} días (${active.length} suscripciones promocionales activas) y el cambio de importe todavía NO está validado con Mercado Pago ni habilitado (PRICE_STEP_UP_ENABLED). El aviso al cliente necesita al menos 20 días de anticipación: sin validación, pasado ese plazo cada período extra se cobra a precio promocional.`;
  return { level, daysLeft, scheduleId: first.id, activeSchedules: active.length, message };
}

/** Schedules that need a person (the runner leaves them alone until someone looks). */
export function attentionSchedules(schedules: readonly ScheduleOverviewRow[]): ScheduleOverviewRow[] {
  return schedules.filter((row) => row.status === "needs_review" || row.status === "needs_reauth" || row.status === "failed");
}

/** Event name stored once per level (snake_case only: the database accepts `[a-z_]{3,40}`). */
export function alertEventName(level: ValidationAlertLevel): string | null {
  return level === "none" ? null : `validation_alert_${level}`;
}

export function attentionEventName(schedule: Pick<ScheduleOverviewRow, "status">): string {
  return `admin_attention_${schedule.status}`;
}
