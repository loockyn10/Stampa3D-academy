import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { createPkcePair, encryptBusinessSecret, sha256 } from "@/lib/business/payment-crypto";
import { createBusinessAdminClient, requireBusinessAppUrl } from "@/lib/business/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = await createClient();
    const { access } = await getCurrentUserAccess(supabase);
    if (!access.userId || !access.capabilities.accessPlatform) return NextResponse.redirect(`${requireBusinessAppUrl()}/login`);
    const clientId = process.env.MERCADO_PAGO_MARKETPLACE_CLIENT_ID;
    const redirectUri = process.env.MERCADO_PAGO_MARKETPLACE_REDIRECT_URI;
    if (!clientId || !redirectUri) throw new Error("OAuth de Mercado Pago no configurado");
    const state = crypto.randomBytes(32).toString("base64url");
    const { verifier, challenge } = createPkcePair();
    const admin = createBusinessAdminClient();
    const { error } = await admin.from("business_payment_oauth_states").insert({
      user_id: access.userId,
      state_hash: sha256(state),
      code_verifier_encrypted: encryptBusinessSecret(verifier),
      redirect_uri: redirectUri,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) throw error;
    const cookieStore = await cookies();
    cookieStore.set("stampa_mp_oauth_state", state, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/api/business/mercadopago/callback", maxAge: 600,
    });
    const authorization = new URL("https://auth.mercadopago.com.ar/authorization");
    authorization.searchParams.set("client_id", clientId);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("platform_id", "mp");
    authorization.searchParams.set("redirect_uri", redirectUri);
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    return NextResponse.redirect(authorization);
  } catch (error) {
    console.error("[Business OAuth] No se pudo iniciar la conexión", error instanceof Error ? error.message : "unknown");
    const fallback = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
    return NextResponse.redirect(`${fallback}/mi-negocio/tienda?mercadopago=configuration_error`);
  }
}

