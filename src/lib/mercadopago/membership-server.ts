import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { MercadoPagoMembershipProvider } from "@/lib/mercadopago/membership-provider";
import { SupabaseMembershipStore } from "@/lib/mercadopago/membership-store";
import type { MembershipDependencies } from "@/lib/mercadopago/membership-sync";
import type { WebhookEventLog } from "@/lib/mercadopago/membership-webhook";

/** Server-only wiring of the membership cycle (service role + Mercado Pago access token). Null when misconfigured. */
export function createMembershipDependencies(): (MembershipDependencies & { admin: SupabaseClient; store: SupabaseMembershipStore }) | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!supabaseUrl || !serviceRoleKey || !accessToken) return null;

  const admin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    admin,
    store: new SupabaseMembershipStore(admin),
    provider: new MercadoPagoMembershipProvider(accessToken),
    log: (message, details) => console.error(`[membership] ${message}`, details ?? {}),
  };
}

export function createWebhookEventLog(admin: SupabaseClient): WebhookEventLog {
  return {
    async insert(event) {
      const { data, error } = await admin
        .from("mercado_pago_webhook_events")
        .insert({
          event_type: event.eventType,
          action: event.action,
          data_id: event.dataId,
          processed: false,
          payload: event.payload,
          error_message: null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`mercado_pago_webhook_events insert: ${error.message}`);
      return (data?.id as string | undefined) ?? null;
    },
    async finish(id, result) {
      const { error } = await admin
        .from("mercado_pago_webhook_events")
        .update({ processed: result.processed, error_message: result.errorMessage })
        .eq("id", id);
      if (error) throw new Error(`mercado_pago_webhook_events update: ${error.message}`);
    },
  };
}
