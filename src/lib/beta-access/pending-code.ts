/**
 * Client-only: remembers a beta code typed at signup until the user has a session (email
 * confirmation). It lives only in this browser's localStorage and is discarded after any definitive
 * outcome or after 7 days. It is never written to the database or to auth user metadata.
 */

const STORAGE_KEY = "stampa_pending_beta_code";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function savePendingBetaCode(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, savedAt: Date.now() }));
  } catch {}
}

export function readPendingBetaCode(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: unknown; savedAt?: unknown };
    if (
      typeof parsed.code !== "string" ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > MAX_AGE_MS
    ) {
      clearPendingBetaCode();
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}

export function clearPendingBetaCode(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
