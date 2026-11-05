"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { resolvePostAccessDestination } from "@/lib/auth/access-destination";
import { createClient } from "@/utils/supabase/server";
import {
  DISCOUNT_CODE_MAX_INPUT_LENGTH,
  discountCodesEnabled,
  discountFailure,
  normalizeDiscountCode,
  toDiscountPreview,
  type DiscountPreview,
} from "@/lib/discounts/discount-codes";
import { reserveDiscountCode } from "@/lib/discounts/repository";
import { loadMembershipPrice } from "@/lib/mercadopago/membership-price";
import { createMembershipDependencies } from "@/lib/mercadopago/membership-server";
import { syncUserMembership } from "@/lib/mercadopago/membership-sync";

export interface RefreshAccessResult {
  hasAccess: boolean;
  destination: string | null;
}

/**
 * Re-resolves access server-side (fresh query, session user only) for /sin-acceso. A Free user who already paid is
 * first re-synced with Mercado Pago (best effort), so "Actualizar acceso" recovers a payment whose webhook was lost
 * instead of only re-reading the same profile row (incident 2026-11-05).
 */
export async function refreshAccessAction(): Promise<RefreshAccessResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const deps = createMembershipDependencies();
    if (deps) {
      try {
        await syncUserMembership(user.id, deps);
      } catch (error) {
        console.error("[membership] refresh access sync failed", error instanceof Error ? error.message : "error");
      }
    }
  }
  const { access } = await getCurrentUserAccess(supabase);
  const destination = resolvePostAccessDestination(access);
  return { hasAccess: destination !== null, destination };
}

/**
 * Price preview for a discount code. Dry run: validates the code and returns the final price computed by the database
 * for the CURRENT session user; it reserves nothing. The user id is never taken from the client, and only a safe DTO
 * (status, message and amounts) goes back. The real discount is decided again, atomically, when the checkout is created.
 */
export async function previewDiscountCodeAction(rawCode: unknown): Promise<DiscountPreview> {
  if (!discountCodesEnabled()) return toDiscountPreview(discountFailure("disabled"));
  if (typeof rawCode !== "string") return toDiscountPreview(discountFailure("invalid"));

  const code = normalizeDiscountCode(rawCode);
  if (!code || code.length > DISCOUNT_CODE_MAX_INPUT_LENGTH) return toDiscountPreview(discountFailure("invalid"));

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return toDiscountPreview(discountFailure("unauthenticated"));

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!serviceRoleKey || !supabaseUrl) return toDiscountPreview(discountFailure("error"));

    const admin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const membershipPrice = await loadMembershipPrice(admin);
    if (!membershipPrice.ok) return toDiscountPreview(discountFailure("error"));

    const reservation = await reserveDiscountCode(admin, {
      userId: user.id,
      code,
      baseAmount: membershipPrice.price,
      currency: membershipPrice.currency,
      dryRun: true,
    });
    return toDiscountPreview(reservation);
  } catch (caught) {
    console.error("[discount] preview failed", caught instanceof Error ? caught.name : "unknown_error");
    return toDiscountPreview(discountFailure("error"));
  }
}
