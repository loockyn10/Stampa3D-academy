import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptBusinessSecret, encryptBusinessSecret } from "./payment-crypto";
import { businessLiveModeAllowed } from "./server";

type AccountRow = {
  user_id: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  live_mode: boolean;
  status: string;
  token_expires_at: string | null;
};

export async function getValidMercadoPagoSellerToken(admin: SupabaseClient, userId: string): Promise<{ accessToken: string; liveMode: boolean; providerUserId: string }> {
  const { data, error } = await admin.from("business_payment_accounts")
    .select("user_id, access_token_encrypted, refresh_token_encrypted, provider_user_id, live_mode, status, token_expires_at")
    .eq("user_id", userId).eq("provider", "mercado_pago").single();
  const account = data as (AccountRow & { provider_user_id: string | null }) | null;
  if (error || !account || account.status !== "connected" || !account.access_token_encrypted || !account.refresh_token_encrypted || !account.provider_user_id) {
    throw new Error("El vendedor debe conectar Mercado Pago");
  }
  if (account.live_mode && !businessLiveModeAllowed()) throw new Error("Los pagos productivos todavía no están habilitados");
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 24 * 60 * 60_000) {
    return { accessToken: decryptBusinessSecret(account.access_token_encrypted), liveMode: account.live_mode, providerUserId: account.provider_user_id };
  }
  const clientId = process.env.MERCADO_PAGO_MARKETPLACE_CLIENT_ID;
  const clientSecret = process.env.MERCADO_PAGO_MARKETPLACE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Credenciales OAuth incompletas");
  const response = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: decryptBusinessSecret(account.refresh_token_encrypted) }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const token = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    await admin.from("business_payment_accounts").update({ status: "error", last_error: "OAuth refresh failed" }).eq("user_id", userId);
    throw new Error("La conexión con Mercado Pago venció; el vendedor debe reconectarla");
  }
  const accessToken = typeof token.access_token === "string" ? token.access_token : "";
  const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : "";
  const providerUserId = typeof token.user_id === "string" || typeof token.user_id === "number" ? String(token.user_id) : account.provider_user_id;
  const expiresIn = Number(token.expires_in);
  const liveMode = token.live_mode === true;
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || providerUserId !== account.provider_user_id || (liveMode && !businessLiveModeAllowed())) {
    throw new Error("Mercado Pago devolvió una renovación inválida");
  }
  const { error: updateError } = await admin.from("business_payment_accounts").update({
    access_token_encrypted: encryptBusinessSecret(accessToken), refresh_token_encrypted: encryptBusinessSecret(refreshToken),
    token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(), live_mode: liveMode, status: "connected", last_error: null,
  }).eq("user_id", userId).eq("provider", "mercado_pago");
  if (updateError) throw updateError;
  return { accessToken, liveMode, providerUserId };
}

