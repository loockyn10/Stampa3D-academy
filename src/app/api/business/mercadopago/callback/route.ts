import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { decryptBusinessSecret, encryptBusinessSecret, sha256 } from "@/lib/business/payment-crypto";
import { businessLiveModeAllowed, createBusinessAdminClient } from "@/lib/business/server";

export const runtime = "nodejs";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
  const destination = new URL("/mi-negocio/tienda", appUrl);
  const cookieStore = await cookies();
  try {
    const state = request.nextUrl.searchParams.get("state") || "";
    const code = request.nextUrl.searchParams.get("code") || "";
    const cookieState = cookieStore.get("stampa_mp_oauth_state")?.value || "";
    if (!state || !code || !cookieState || !safeEqual(state, cookieState)) throw new Error("Estado OAuth inválido");
    const admin = createBusinessAdminClient();
    const { data: stateRow, error: stateError } = await admin.from("business_payment_oauth_states")
      .select("id, user_id, code_verifier_encrypted, redirect_uri, expires_at, consumed_at")
      .eq("state_hash", sha256(state)).is("consumed_at", null).gt("expires_at", new Date().toISOString()).single();
    if (stateError || !stateRow) throw new Error("La autorización venció o ya fue utilizada");
    const clientId = process.env.MERCADO_PAGO_MARKETPLACE_CLIENT_ID;
    const clientSecret = process.env.MERCADO_PAGO_MARKETPLACE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Credenciales OAuth incompletas");
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: stateRow.redirect_uri,
      state,
      code_verifier: decryptBusinessSecret(stateRow.code_verifier_encrypted),
    });
    const response = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body, cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    const token = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof token.message === "string" ? token.message : `OAuth respondió HTTP ${response.status}`);
    const accessToken = typeof token.access_token === "string" ? token.access_token : "";
    const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : "";
    const providerUserId = typeof token.user_id === "string" || typeof token.user_id === "number" ? String(token.user_id) : "";
    const expiresIn = Number(token.expires_in);
    const liveMode = token.live_mode === true;
    if (!accessToken || !refreshToken || !providerUserId || !Number.isFinite(expiresIn)) throw new Error("Mercado Pago devolvió credenciales incompletas");
    if (liveMode && !businessLiveModeAllowed()) throw new Error("La integración está limitada a cuentas de prueba");
    const { error: accountError } = await admin.from("business_payment_accounts").upsert({
      user_id: stateRow.user_id,
      provider: "mercado_pago",
      provider_user_id: providerUserId,
      access_token_encrypted: encryptBusinessSecret(accessToken),
      refresh_token_encrypted: encryptBusinessSecret(refreshToken),
      public_key: typeof token.public_key === "string" ? token.public_key : null,
      scope: typeof token.scope === "string" ? token.scope : null,
      live_mode: liveMode,
      status: "connected",
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      last_error: null,
    }, { onConflict: "user_id" });
    if (accountError) throw accountError;
    await admin.from("business_payment_oauth_states").update({ consumed_at: new Date().toISOString() }).eq("id", stateRow.id).is("consumed_at", null);
    destination.searchParams.set("mercadopago", "connected");
  } catch (error) {
    console.error("[Business OAuth] Falló el callback", error instanceof Error ? error.message : "unknown");
    destination.searchParams.set("mercadopago", "error");
  }
  cookieStore.delete("stampa_mp_oauth_state");
  return NextResponse.redirect(destination);
}
