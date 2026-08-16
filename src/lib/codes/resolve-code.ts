/**
 * Helper to resolve registration codes (invite codes or referral codes).
 * It can be used both client-side and server-side.
 */

export type CodeResolutionType = 'beta_tester' | 'manual_free_access' | 'promo' | 'referral' | 'invalid';

export interface CodeResolutionResult {
  type: CodeResolutionType;
  isValid: boolean;
  code: string;
  data: any; // The raw DB row (invite_codes or profiles)
  errorMessage?: string;
}

/**
 * Resolves a code against invite_codes and profiles tables.
 * @param code The raw code string provided by the user.
 * @param supabase The initialized Supabase client (client or server/admin).
 * @returns A promise that resolves to the CodeResolutionResult.
 */
export async function resolveRegistrationCode(
  code: string,
  supabase: any
): Promise<CodeResolutionResult> {
  if (!code || code.trim() === "") {
    return { type: 'invalid', isValid: false, code: '', data: null, errorMessage: 'Código vacío.' };
  }

  const normalizedCode = code.toUpperCase().trim();

  // 1. Check invite_codes first (beta or promo)
  const { data: inviteData, error: inviteError } = await supabase
    .from("invite_codes")
    .select("*")
    .eq("code", normalizedCode)
    .single();

  if (inviteData && !inviteError) {
    const isStatusActive = inviteData.status === "active";
    const hasStarted = !inviteData.starts_at || new Date(inviteData.starts_at) <= new Date();
    const isNotExpired = !inviteData.expires_at || new Date(inviteData.expires_at) > new Date();
    const hasUsesLeft = inviteData.max_uses === null || inviteData.used_count < inviteData.max_uses;

    if (isStatusActive && hasStarted && isNotExpired && hasUsesLeft) {
      let resolvedType: CodeResolutionType = 'promo';
      if (inviteData.code_type === 'beta_tester') resolvedType = 'beta_tester';
      if (inviteData.code_type === 'manual_free_access') resolvedType = 'manual_free_access';
      
      return {
        type: resolvedType,
        isValid: true,
        code: normalizedCode,
        data: inviteData
      };
    }
  }

  // 2. Check profiles for normal referral
  const { data: refProfile, error: refError } = await supabase
    .from("profiles")
    .select("id")
    .eq("referral_code", normalizedCode)
    .single();

  if (refProfile && !refError) {
    return {
      type: 'referral',
      isValid: true,
      code: normalizedCode,
      data: refProfile
    };
  }

  // 3. Not found or invalid
  return {
    type: 'invalid',
    isValid: false,
    code: normalizedCode,
    data: null,
    errorMessage: 'El código ingresado no existe, está inactivo o agotó sus usos.'
  };
}
