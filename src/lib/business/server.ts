import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createBusinessAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuración server-only de Supabase incompleta");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function requireBusinessAppUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!value || !value.startsWith("https://")) throw new Error("NEXT_PUBLIC_APP_URL debe ser una URL HTTPS pública");
  return value;
}

export function businessLiveModeAllowed(): boolean {
  return process.env.BUSINESS_MERCADO_PAGO_ALLOW_LIVE === "true";
}

