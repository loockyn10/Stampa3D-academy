/**
 * Founder pricing logic for Academia Stampa.
 * Calls a Supabase RPC that atomically reserves a founder slot.
 *
 * Returns the price to charge (founder tier or normal) for checkout.
 */

export interface CheckoutPrice {
  price: number;
  currency: string;
  isFounderPrice: boolean;
  founderNumber: number | null;
  founderTierName: string | null;
}

/**
 * Get the correct checkout price for a user.
 * Uses a Supabase RPC to atomically reserve a founder slot if available.
 *
 * @param supabaseAdmin - Supabase admin client (service role)
 * @param userId - The authenticated user's UUID
 * @param normalPrice - Fallback price if no founder slot available
 * @param currency - Currency code (default ARS)
 */
export async function getMembershipCheckoutPrice(
  supabaseAdmin: any,
  userId: string,
  normalPrice: number,
  currency: string = "ARS"
): Promise<CheckoutPrice> {
  try {
    // Call the atomic RPC to reserve a founder slot
    const { data, error } = await supabaseAdmin.rpc("reserve_founder_slot", {
      p_user_id: userId,
    });

    if (error) {
      console.error("[founder-pricing] RPC error:", error.message);
      // Safe fallback — use normal price
      return {
        price: normalPrice,
        currency,
        isFounderPrice: false,
        founderNumber: null,
        founderTierName: null,
      };
    }

    // RPC returns a table — data is an array
    const row = Array.isArray(data) ? data[0] : data;

    if (!row || !row.reserved_number) {
      // No slots available — normal price
      return {
        price: normalPrice,
        currency,
        isFounderPrice: false,
        founderNumber: null,
        founderTierName: null,
      };
    }

    return {
      price: Number(row.price),
      currency: row.currency || currency,
      isFounderPrice: true,
      founderNumber: row.reserved_number,
      founderTierName: row.tier_name,
    };
  } catch (err: any) {
    console.error("[founder-pricing] Unexpected error:", err.message);
    return {
      price: normalPrice,
      currency,
      isFounderPrice: false,
      founderNumber: null,
      founderTierName: null,
    };
  }
}
