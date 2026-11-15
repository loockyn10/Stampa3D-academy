/**
 * Client-side wait between auth e-mails (confirmation resend, password recovery). It only avoids repeated clicks and
 * confusing rate-limit errors: Supabase Auth keeps enforcing its own limits on the server and nothing here bypasses them.
 *
 * The deadline is kept in sessionStorage (per tab, never sent anywhere) so reloading the page does not reset the wait.
 */

/** Supabase allows one e-mail of each kind per address every 60 s by default (Auth → Rate Limits). */
export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;

/**
 * After a project-wide send limit (`over_email_send_rate_limit`) a minute is not enough: with Supabase's built-in SMTP
 * the limit is a few e-mails per HOUR; with a custom SMTP (Resend) it is configurable in Auth → Rate Limits.
 */
export const EMAIL_SEND_LIMIT_COOLDOWN_SECONDS = 300;

export type EmailCooldownAction = "signup_resend" | "password_recovery";

const KEY_PREFIX = "stampa_email_cooldown_";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Seconds left before another e-mail of this kind may be requested from this tab (0 when free). */
export function remainingEmailCooldown(action: EmailCooldownAction, now: number = Date.now(), store: StorageLike | null = storage()): number {
  if (!store) return 0;
  try {
    const deadline = Number(store.getItem(`${KEY_PREFIX}${action}`));
    if (!Number.isFinite(deadline) || deadline <= now) return 0;
    // A deadline further than the longest wait is not ours (tampered or clock change): ignore it.
    const seconds = Math.ceil((deadline - now) / 1000);
    return seconds > EMAIL_SEND_LIMIT_COOLDOWN_SECONDS ? 0 : seconds;
  } catch {
    return 0;
  }
}

/** Starts (or extends) the wait and returns it in seconds. */
export function startEmailCooldown(
  action: EmailCooldownAction,
  seconds: number,
  now: number = Date.now(),
  store: StorageLike | null = storage(),
): number {
  const wait = Math.max(0, Math.min(Math.round(seconds), EMAIL_SEND_LIMIT_COOLDOWN_SECONDS));
  try {
    store?.setItem(`${KEY_PREFIX}${action}`, String(now + wait * 1000));
  } catch {
    // storage unavailable: the in-memory countdown of the page still applies
  }
  return wait;
}

/** "Podés pedir otro en 45 s" / "… en 4 min". */
export function formatCooldown(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.ceil(seconds / 60)} min`;
}
