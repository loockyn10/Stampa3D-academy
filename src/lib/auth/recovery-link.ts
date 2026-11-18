/**
 * Password-recovery link of the e-mail: `/auth/confirm?token_hash=<hash>&type=recovery` (Supabase `{{ .TokenHash }}`).
 * Pure parsing, no side effects: the token is only ever passed to `verifyOtp`, never logged, stored or shown.
 */

/** Where a verified recovery session goes: the form that sets the new password. */
export const RECOVERY_NEXT_PATH = "/actualizar-password";

export interface RecoveryLink {
  tokenHash: string;
}

interface SearchParamsLike {
  get(name: string): string | null;
}

/** Supabase token hashes are URL-safe strings; anything else (empty, huge, odd characters) is rejected. */
const TOKEN_HASH_SHAPE = /^[A-Za-z0-9_-]{8,256}$/;

export function parseRecoveryLink(params: SearchParamsLike | null | undefined): RecoveryLink | null {
  if (!params) return null;
  if (params.get("type") !== "recovery") return null;
  const tokenHash = params.get("token_hash")?.trim() ?? "";
  return TOKEN_HASH_SHAPE.test(tokenHash) ? { tokenHash } : null;
}
