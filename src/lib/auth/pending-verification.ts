/**
 * The email waiting for confirmation is kept in sessionStorage (never in the URL) so /verificar-email can show it
 * masked and offer the resend without asking again.
 */
const KEY = "stampa_pending_verification_email";

export function savePendingVerificationEmail(email: string): void {
  try {
    window.sessionStorage.setItem(KEY, email.trim());
  } catch {
    // storage unavailable: the page asks for the email instead
  }
}

export function readPendingVerificationEmail(): string | null {
  try {
    const value = window.sessionStorage.getItem(KEY);
    return value && value.includes("@") ? value : null;
  } catch {
    return null;
  }
}

export function clearPendingVerificationEmail(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** "juan.perez@gmail.com" → "ju•••@gmail.com". */
export function maskEmail(email: string): string {
  const [local, domain] = email.trim().split("@");
  if (!local || !domain) return email;
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}•••@${domain}`;
}

/** Where Supabase sends the person after clicking the confirmation link. */
export function emailConfirmationRedirect(origin: string, returnTo: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}`;
}
