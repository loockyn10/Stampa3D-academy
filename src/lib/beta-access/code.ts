/**
 * Beta access by invitation code — pure helpers shared by the server action and the UI.
 *
 * Beta access is NOT a paid subscription: a redeemed code only creates a `beta_tester` access grant.
 * The database (redeem_beta_access_code) is the only authority; nothing here validates a code.
 * The normalization MUST stay equivalent to public.normalize_beta_access_code in
 * supabase/migrations/20261005120000_beta_access_codes.sql.
 */

export const BETA_CODE_MAX_INPUT_LENGTH = 100;

/** Same shape the database enforces (8-64 chars: letters, digits, "-" or "_"). */
export const BETA_CODE_SHAPE = /^[A-Z0-9][A-Z0-9_-]{7,63}$/;

export type BetaRedeemStatus =
  | "redeemed"
  | "already_redeemed"
  | "invalid"
  | "expired"
  | "exhausted"
  | "revoked"
  | "rate_limited"
  | "unauthenticated"
  | "error";

export interface BetaRedeemResult {
  /** true when the user ends up with the beta grant from this code (new or already redeemed). */
  ok: boolean;
  status: BetaRedeemStatus;
  message: string;
  accessExpiresAt: string | null;
}

export const BETA_REDEEM_MESSAGES: Record<BetaRedeemStatus, string> = {
  redeemed: "Acceso Beta activado.",
  already_redeemed: "Ya canjeaste este código.",
  invalid: "Código inválido.",
  expired: "Este código venció.",
  exhausted: "Este código ya alcanzó el límite de usos.",
  revoked: "Tu acceso Beta con este código fue revocado. Escribinos si creés que es un error.",
  rate_limited: "Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.",
  unauthenticated: "Iniciá sesión para canjear tu código.",
  error: "No pudimos canjear el código. Probá de nuevo en unos minutos.",
};

export const BETA_EMPTY_CODE_MESSAGE = "Ingresá tu código de invitación.";

const KNOWN_STATUSES = new Set<string>(Object.keys(BETA_REDEEM_MESSAGES));

export function normalizeBetaAccessCode(value: string): string {
  return value
    .replace(/^\s+|\s+$/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, "-")
    .toUpperCase();
}

/** Maps the raw RPC payload to a safe DTO: only a known status and an optional ISO date reach the UI. */
export function toBetaRedeemResult(raw: unknown): BetaRedeemResult {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const status = (
    typeof record.status === "string" && KNOWN_STATUSES.has(record.status) ? record.status : "error"
  ) as BetaRedeemStatus;
  const expiresAt = typeof record.access_expires_at === "string" ? record.access_expires_at : null;

  return {
    ok: status === "redeemed" || status === "already_redeemed",
    status,
    message: BETA_REDEEM_MESSAGES[status],
    accessExpiresAt: expiresAt,
  };
}

/** Outcomes after which a stored pending code is useless and must be discarded. */
export function isDefinitiveBetaOutcome(status: BetaRedeemStatus): boolean {
  return status !== "rate_limited" && status !== "unauthenticated" && status !== "error";
}
