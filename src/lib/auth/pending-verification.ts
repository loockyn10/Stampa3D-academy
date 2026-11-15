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

/**
 * E-mail used to create the account, remembered in THIS browser (localStorage, never in a URL or a cookie) so /login can
 * pre-fill it after the confirmation link opens in a new tab. Only the address, never a password; expires in 14 days
 * and is forgotten after a successful sign-in.
 */
const REMEMBER_KEY = "stampa_signup_email";
export const REMEMBER_SIGNUP_EMAIL_MS = 14 * 24 * 60 * 60 * 1000;

export function rememberSignupEmail(email: string, now: number = Date.now()): void {
  const value = email.trim();
  if (!value.includes("@")) return;
  try {
    window.localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email: value, at: now }));
  } catch {
    // storage unavailable: the field simply starts empty
  }
}

export function readRememberedSignupEmail(now: number = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: unknown; at?: unknown };
    if (typeof parsed.email !== "string" || !parsed.email.includes("@") || typeof parsed.at !== "number") return null;
    if (now - parsed.at > REMEMBER_SIGNUP_EMAIL_MS || parsed.at > now + 60_000) return null;
    return parsed.email;
  } catch {
    return null;
  }
}

export function forgetSignupEmail(): void {
  try {
    window.localStorage.removeItem(REMEMBER_KEY);
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
