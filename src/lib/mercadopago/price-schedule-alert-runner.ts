import {
  alertEventName,
  attentionEventName,
  attentionSchedules,
  computeValidationAlert,
  type ScheduleOverviewRow,
  type ValidationAlert,
} from "@/lib/mercadopago/price-schedule-alerts";

/**
 * Sends the administrator alerts (once per level / per case) and logs them every run. Never throws into the cron: an
 * alert failure must not hide itself behind a failed reconciliation.
 */

export interface PriceAlertStore {
  overview(): Promise<ScheduleOverviewRow[]>;
  hasEvent(scheduleId: string, event: string): Promise<boolean>;
  addEvent(scheduleId: string, event: string, detail?: Record<string, unknown>): Promise<void>;
}

export interface AdminAlertMailer {
  send(input: { subject: string; text: string }): Promise<{ ok: boolean; error?: string }>;
}

export interface PriceAlertReport {
  alert: ValidationAlert;
  attention: number;
  emailsSent: number;
  mailerMissing: boolean;
  errors: number;
}

export async function runPriceScheduleAlerts(deps: {
  store: PriceAlertStore;
  mailer: AdminAlertMailer | null;
  stepUpEnabled: boolean;
  now?: () => Date;
  log?: (message: string, details?: Record<string, unknown>) => void;
}): Promise<PriceAlertReport> {
  const now = deps.now ? deps.now() : new Date();
  const log = deps.log ?? (() => undefined);
  const schedules = await deps.store.overview();
  const alert = computeValidationAlert({ stepUpEnabled: deps.stepUpEnabled, schedules, now });
  const attention = attentionSchedules(schedules);
  const report: PriceAlertReport = { alert, attention: attention.length, emailsSent: 0, mailerMissing: false, errors: 0 };

  // Logged on every run from "near" on: visible in the deployment logs even without an e-mail provider.
  if (alert.level === "near" || alert.level === "urgent" || alert.level === "overdue") {
    log(`ALERTA: ${alert.message}`, { level: alert.level, daysLeft: alert.daysLeft });
  }
  for (const row of attention) log("agenda de precio que necesita revisión", { scheduleId: row.id, status: row.status, error: row.lastError });

  const pending: { scheduleId: string; event: string; subject: string; text: string }[] = [];

  const validationEvent = alertEventName(alert.level);
  if (validationEvent && alert.scheduleId) {
    pending.push({
      scheduleId: alert.scheduleId,
      event: validationEvent,
      subject:
        alert.level === "overdue"
          ? "URGENTE — Pioneros: la promoción terminó y el cambio de importe no está habilitado"
          : `Pioneros: validá el cambio de importe con Mercado Pago (faltan ${alert.daysLeft} días)`,
      text: alert.message,
    });
  }
  for (const row of attention) {
    const status = row.status === "needs_reauth" ? "requiere que el cliente autorice de nuevo" : row.status === "failed" ? "agotó los reintentos" : "necesita revisión";
    pending.push({
      scheduleId: row.id,
      event: attentionEventName(row),
      subject: `Agenda de precio: una suscripción ${status}`,
      text: `Una suscripción promocional ${status}. Estado: ${row.status}. Último error: ${row.lastError ?? "—"}. Revisala en /admin/promociones.`,
    });
  }

  for (const item of pending) {
    try {
      if (await deps.store.hasEvent(item.scheduleId, item.event)) continue;
      if (!deps.mailer) {
        report.mailerMissing = true;
        continue;
      }
      const sent = await deps.mailer.send({ subject: item.subject, text: item.text });
      if (!sent.ok) {
        report.errors += 1;
        log("no se pudo enviar la alerta", { event: item.event, error: sent.error });
        continue;
      }
      await deps.store.addEvent(item.scheduleId, item.event, { level_or_case: item.event });
      report.emailsSent += 1;
    } catch (error) {
      report.errors += 1;
      log("alerta: error inesperado", { event: item.event, error: error instanceof Error ? error.name : "error" });
    }
  }
  return report;
}
