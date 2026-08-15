/**
 * Referral code utilities for Academia Stampa.
 * Generates and manages unique per-user referral codes.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0, O, I, 1 for clarity

/**
 * Generate a random referral code in format STAMPA + 6 random chars
 */
export function generateReferralCode(): string {
  let suffix = "";
  const array = new Uint8Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Node.js fallback
    for (let i = 0; i < 6; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[array[i] % ALPHABET.length];
  }
  return `STAMPA${suffix}`;
}

/**
 * Server-side: ensure the user has a referral_code, generating one if needed.
 * Returns the code (existing or newly created).
 */
export async function getOrCreateReferralCode(
  supabase: any,
  userId: string,
  existingCode?: string | null
): Promise<string> {
  if (existingCode && existingCode.trim() !== "") {
    return existingCode;
  }

  // Generate a unique code (retry up to 5 times in case of collision)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    const { error } = await supabase
      .from("profiles")
      .update({ referral_code: code })
      .eq("id", userId)
      .is("referral_code", null); // only update if still null (avoid race)

    if (!error) {
      return code;
    }
    // If collision (unique constraint), try again
  }

  // Last resort: read whatever is now in DB
  const { data } = await supabase
    .from("profiles")
    .select("referral_code")
    .eq("id", userId)
    .single();
  return data?.referral_code ?? generateReferralCode();
}
