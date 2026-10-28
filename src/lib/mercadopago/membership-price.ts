import type { SupabaseClient } from "@supabase/supabase-js";

export type MembershipPriceResult =
  | { ok: true; price: number; currency: string }
  | { ok: false; status: number; error: string };

/**
 * The membership list price: the ONLY pricing source of the checkout (membership_settings, with
 * MEMBERSHIP_MONTHLY_PRICE as fallback). Discount codes never replace it: the database derives a discounted amount
 * from this value (public.discount_code_final_amount).
 */
export async function loadMembershipPrice(
  supabaseAdmin: SupabaseClient,
  fallbackPrice: string | undefined = process.env.MEMBERSHIP_MONTHLY_PRICE,
): Promise<MembershipPriceResult> {
  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("membership_settings")
    .select("monthly_price, currency")
    .eq("id", "default")
    .single();

  if (settingsError && !fallbackPrice) {
    console.error("[MP create-subscription] membership settings unavailable", settingsError.message);
    return { ok: false, status: 503, error: "No se pudo obtener el precio de membresía." };
  }

  const price = settings?.monthly_price ? Number(settings.monthly_price) : Number(fallbackPrice);
  const currency = String(settings?.currency || "ARS").toUpperCase();

  if (!Number.isFinite(price) || price <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, status: 500, error: "Precio o moneda de membresía inválidos o no configurados" };
  }

  return { ok: true, price, currency };
}
