/**
 * Validation of the promotion terms an administrator attaches to a fixed-price discount code
 * ("9.900 for 6 monthly billing periods, then 19.900"). Pure; the database enforces the same limits.
 */

export interface PromoTermsInput {
  promoCycles: number;
  postPrice: number;
  noticeDays: number;
}

export type PromoTermsValidation =
  | { ok: true; terms: PromoTermsInput & { noticeLeadDays: number; termsVersion: string } }
  | { ok: false; error: string };

export const DEFAULT_NOTICE_DAYS = 20;

/**
 * `promoPrice` is the code's own fixed price (invite_codes.discount_value); the later price must be higher, otherwise it
 * would not be a "later" price. The terms version identifies exactly what the buyer accepts: it changes whenever any term does.
 */
export function validatePromoTerms(
  raw: { promoCycles: unknown; postPrice: unknown; noticeDays?: unknown },
  context: { promoPrice: number; today?: Date },
): PromoTermsValidation {
  const promoCycles = Number(raw.promoCycles);
  const postPrice = Number(raw.postPrice);
  const noticeDays = raw.noticeDays === undefined || raw.noticeDays === null || raw.noticeDays === "" ? DEFAULT_NOTICE_DAYS : Number(raw.noticeDays);

  if (!Number.isInteger(promoCycles) || promoCycles < 1 || promoCycles > 24) {
    return { ok: false, error: "Los períodos deben ser un número entero entre 1 y 24." };
  }
  if (!Number.isFinite(postPrice) || postPrice <= 0 || postPrice > 10_000_000) {
    return { ok: false, error: "El precio posterior no es válido." };
  }
  if (!Number.isFinite(context.promoPrice) || context.promoPrice <= 0) {
    return { ok: false, error: "El precio promocional del código no es válido." };
  }
  if (Math.round(postPrice * 100) <= Math.round(context.promoPrice * 100)) {
    return { ok: false, error: "El precio posterior debe ser mayor que el precio promocional." };
  }
  if (!Number.isInteger(noticeDays) || noticeDays < 7 || noticeDays > 60) {
    return { ok: false, error: "El aviso previo debe ser de 7 a 60 días." };
  }

  const noticeLeadDays = noticeDays <= 30 ? 30 : Math.min(noticeDays + 10, 90);
  const day = (context.today ?? new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  const termsVersion = `${day}-${promoCycles}x${Math.round(context.promoPrice)}-then${Math.round(postPrice)}`;
  return { ok: true, terms: { promoCycles, postPrice: Math.round(postPrice * 100) / 100, noticeDays, noticeLeadDays, termsVersion } };
}
