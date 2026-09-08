import { NextResponse } from "next/server";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { createBusinessAdminClient } from "@/lib/business/server";
import { createClient } from "@/utils/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  if (!access.userId) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  if (!access.capabilities.accessPlatform) return NextResponse.json({ error: "No tenés acceso a esta operación." }, { status: 403 });
  try {
    const { error } = await createBusinessAdminClient().from("business_payment_accounts").upsert({
      user_id: access.userId, provider: "mercado_pago", status: "disconnected",
      provider_user_id: null, access_token_encrypted: null, refresh_token_encrypted: null,
      public_key: null, scope: null, token_expires_at: null, connected_at: null,
      disconnected_at: new Date().toISOString(), last_error: null, live_mode: false,
    }, { onConflict: "user_id" });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Business OAuth] No se pudo desconectar", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No pudimos desconectar Mercado Pago." }, { status: 500 });
  }
}

