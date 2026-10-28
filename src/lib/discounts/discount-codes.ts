/**
 * Discount codes in the membership checkout — pure helpers shared by the server action, the checkout route and the UI.
 *
 * The database is the only authority (public.reserve_discount_code): it validates the code, computes the price
 * (public.discount_code_final_amount) and reserves a use. Nothing here computes or trusts a discounted price.
 */

export const DISCOUNT_CODE_MAX_INPUT_LENGTH = 64;

export type DiscountStatus =
  | "ok"
  | "reserved"
  | "invalid"
  | "expired"
  | "exhausted"
  | "unsupported"
  | "no_benefit"
  | "already_used"
  | "rate_limited"
  | "disabled"
  | "unauthenticated"
  | "error";

export const DISCOUNT_MESSAGES: Record<DiscountStatus, string> = {
  ok: "Código aplicado.",
  reserved: "Código aplicado.",
  invalid: "Código inválido.",
  expired: "Este código venció.",
  exhausted: "Este código ya alcanzó el límite de usos.",
  unsupported: "Este código todavía no se puede aplicar al pago. Escribinos si necesitás ayuda.",
  no_benefit: "Este código no mejora el precio actual de la membresía.",
  already_used: "Ya usaste este código.",
  rate_limited: "Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.",
  disabled: "Los códigos de descuento no están disponibles por ahora.",
  unauthenticated: "Iniciá sesión para aplicar un código.",
  error: "No pudimos validar el código. Probá de nuevo en unos minutos.",
};

const KNOWN_STATUSES = new Set<string>(Object.keys(DISCOUNT_MESSAGES));

/** Safe DTO for the browser: never a reservation id, a code id or a raw RPC payload. */
export interface DiscountPreview {
  ok: boolean;
  status: DiscountStatus;
  message: string;
  baseAmount: number | null;
  finalAmount: number | null;
  discountAmount: number | null;
}

/** Server-only result of a reservation (carries the reservation id the checkout needs). */
export interface DiscountReservation extends DiscountPreview {
  reservationId: string | null;
}

/** Same normalization as the admin page and normalizeRegistrationCode: trim, upper case, spaces to "-". */
export function normalizeDiscountCode(value: string): string {
  return value.replace(/^\s+|\s+$/g, "").replace(/\s+/g, "-").toUpperCase();
}

function amountOrNull(value: unknown): number | null {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Status without a benefit: a failure DTO with the known message. */
export function discountFailure(status: DiscountStatus): DiscountReservation {
  return { ok: false, status, message: DISCOUNT_MESSAGES[status], baseAmount: null, finalAmount: null, discountAmount: null, reservationId: null };
}

/** Maps the raw RPC payload to the known statuses; anything unexpected degrades to a generic error. */
export function toDiscountReservation(raw: unknown): DiscountReservation {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const status = (
    typeof record.status === "string" && KNOWN_STATUSES.has(record.status) ? record.status : "error"
  ) as DiscountStatus;

  if (status !== "ok" && status !== "reserved") return discountFailure(status);

  const baseAmount = amountOrNull(record.base_amount);
  const finalAmount = amountOrNull(record.final_amount);
  const reservationId = typeof record.reservation_id === "string" ? record.reservation_id : null;

  // A benefit is only real with two valid amounts, a strictly lower final price and (when reserving) a reservation id.
  if (baseAmount === null || finalAmount === null || finalAmount >= baseAmount || (status === "reserved" && !reservationId)) {
    return discountFailure("error");
  }

  return {
    ok: true,
    status,
    message: DISCOUNT_MESSAGES[status],
    baseAmount,
    finalAmount,
    discountAmount: Math.round((baseAmount - finalAmount) * 100) / 100,
    reservationId: status === "reserved" ? reservationId : null,
  };
}

export function toDiscountPreview(reservation: DiscountReservation): DiscountPreview {
  return {
    ok: reservation.ok,
    status: reservation.status,
    message: reservation.message,
    baseAmount: reservation.baseAmount,
    finalAmount: reservation.finalAmount,
    discountAmount: reservation.discountAmount,
  };
}

/**
 * Kill switch. Discount codes only change a checkout when DISCOUNT_CODES_ENABLED is exactly "true" on the server.
 * Off (default): the checkout charges the normal price and rejects any discount_code instead of ignoring it silently.
 */
export function discountCodesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DISCOUNT_CODES_ENABLED === "true";
}
