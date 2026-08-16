/**
 * Referral code utilities for Academia Stampa.
 * Generates and manages unique per-user referral codes.
 */

function getReferralBase(profile: any): string {
  let raw = profile?.display_name || profile?.full_name || profile?.email?.split('@')[0] || "STAMPA";
  
  // Normalize
  raw = raw.trim();
  // Take first word
  raw = raw.split(/\s+/)[0];
  // Remove accents
  raw = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Remove non-alphanumeric
  raw = raw.replace(/[^a-zA-Z0-9]/g, "");
  // Uppercase
  raw = raw.toUpperCase();
  // Limit length
  if (raw.length > 12) raw = raw.substring(0, 12);
  
  if (!raw) raw = "STAMPA";
  return raw;
}

export async function generateUniqueReferralCode(supabase: any, profile: any): Promise<string> {
  const base = getReferralBase(profile);

  // Helper to check existence
  const exists = async (code: string) => {
    const { data } = await supabase.from('profiles').select('id').eq('referral_code', code).single();
    return !!data;
  };

  // 1. Random attempts (10-99)
  const tried = new Set<number>();
  for (let attempt = 0; attempt < 30; attempt++) {
    const n = Math.floor(Math.random() * 90) + 10; // 10 to 99
    if (tried.has(n)) continue;
    tried.add(n);
    
    const code = `${base}${n}`;
    if (!(await exists(code))) return code;
  }

  // 2. Fallback incremental
  for (let n = 10; n <= 99; n++) {
    const code = `${base}${n}`;
    if (!(await exists(code))) return code;
  }

  // 3. 3-digit fallback
  for (let n = 100; n <= 999; n++) {
    const code = `${base}${n}`;
    if (!(await exists(code))) return code;
  }

  throw new Error("No se pudo generar un código de referido único");
}

/**
 * Server-side or client-side: ensure the user has a referral_code, generating one if needed.
 * Returns the code (existing or newly created).
 */
export async function getOrCreateReferralCode(
  supabase: any,
  userId: string,
  existingCode?: string | null,
  profileData?: any
): Promise<string> {
  if (existingCode && existingCode.trim() !== "") {
    return existingCode;
  }

  // Need profile data if not provided
  let pData = profileData;
  if (!pData) {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    pData = data || {};
  }

  // Generate a unique code (retry up to 5 times in case of collision)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const code = await generateUniqueReferralCode(supabase, pData);
      
      const { error } = await supabase
        .from("profiles")
        .update({ referral_code: code })
        .eq("id", userId)
        .is("referral_code", null); // only update if still null (avoid race)

      if (!error) {
        return code;
      }
      // If collision (unique constraint), try again
    } catch (err) {
      break;
    }
  }

  // Last resort: read whatever is now in DB
  const { data } = await supabase
    .from("profiles")
    .select("referral_code")
    .eq("id", userId)
    .single();
  return data?.referral_code ?? "STAMPA00";
}
