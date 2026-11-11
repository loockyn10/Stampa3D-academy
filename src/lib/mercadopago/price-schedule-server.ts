import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMercadoPagoPriceGateway } from "@/lib/mercadopago/membership-price-update";
import type { MembershipProvider } from "@/lib/mercadopago/membership-sync";
import { createResendAdminMailer, createResendPriceNoticeMailer } from "@/lib/mercadopago/price-notice";
import { SupabasePriceScheduleStore, priceSchedulesEnabled, priceStepUpEnabled } from "@/lib/mercadopago/price-schedule-store";
import type { PriceAlertStore, AdminAlertMailer } from "@/lib/mercadopago/price-schedule-alert-runner";
import type { PriceScheduleRunnerDeps } from "@/lib/mercadopago/price-schedule-runner";

/**
 * Server-only wiring of the automatic price change. Null unless PRICE_SCHEDULES_ENABLED is exactly "true".
 * Real PUTs and the customer notices need PRICE_STEP_UP_ENABLED = "true" (otherwise the runner only reports what it would do).
 * Contracting with the promotion needs only PRICE_SCHEDULES_ENABLED. Without RESEND_API_KEY + PRICE_NOTICE_FROM no notice
 * goes out and, because the runner requires a sent notice, the price is never raised.
 */
export function createPriceScheduleRunnerDeps(input: {
  admin: SupabaseClient;
  provider: Pick<MembershipProvider, "getPreapproval" | "searchInvoices">;
  accessToken: string;
}): PriceScheduleRunnerDeps | null {
  if (!priceSchedulesEnabled()) return null;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PRICE_NOTICE_FROM;
  return {
    store: new SupabasePriceScheduleStore(input.admin),
    provider: input.provider,
    writer: createMercadoPagoPriceGateway(input.accessToken),
    mailer:
      apiKey && from
        ? createResendPriceNoticeMailer({
            admin: input.admin as unknown as Parameters<typeof createResendPriceNoticeMailer>[0]["admin"],
            apiKey,
            from,
            appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
          })
        : null,
    stepUpEnabled: priceStepUpEnabled(),
    log: (message, details) => console.error(`[price schedule] ${message}`, details ?? {}),
  };
}

/** Admin alerts (validation pending, schedules needing review). Mail goes to PRICE_ALERT_EMAIL; without it the alerts are only logged and shown in /admin. */
export function createPriceAlertDeps(admin: SupabaseClient): {
  store: PriceAlertStore;
  mailer: AdminAlertMailer | null;
  stepUpEnabled: boolean;
  log: (message: string, details?: Record<string, unknown>) => void;
} | null {
  if (!priceSchedulesEnabled()) return null;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PRICE_NOTICE_FROM;
  const to = process.env.PRICE_ALERT_EMAIL;
  return {
    store: new SupabasePriceScheduleStore(admin),
    mailer: apiKey && from && to ? createResendAdminMailer({ apiKey, from, to }) : null,
    stepUpEnabled: priceStepUpEnabled(),
    log: (message, details) => console.error("[price schedule alert] " + message, details ?? {}),
  };
}
