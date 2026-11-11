import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMercadoPagoPriceGateway } from "@/lib/mercadopago/membership-price-update";
import type { MembershipProvider } from "@/lib/mercadopago/membership-sync";
import { createResendPriceNoticeMailer } from "@/lib/mercadopago/price-notice";
import { SupabasePriceScheduleStore, priceSchedulesEnabled, priceStepUpEnabled } from "@/lib/mercadopago/price-schedule-store";
import type { PriceScheduleRunnerDeps } from "@/lib/mercadopago/price-schedule-runner";

/**
 * Server-only wiring of the automatic price change. Null unless PRICE_SCHEDULES_ENABLED is exactly "true".
 * Real PUTs additionally need PRICE_STEP_UP_ENABLED = "true" (otherwise the runner only reports, and still sends notices).
 * The e-mail provider is optional here: without RESEND_API_KEY + PRICE_NOTICE_FROM no notice goes out and, because the
 * runner requires a sent notice, the price is never raised.
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
