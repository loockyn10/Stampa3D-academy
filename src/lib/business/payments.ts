export type SalePaymentMethod = "cash" | "transfer";

export interface SalePaymentAllocationInput {
  method: SalePaymentMethod;
  amount: number;
}

export interface SalePaymentSplit {
  payments: SalePaymentAllocationInput[];
  debt: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Derives the payment split for a sale from a single base method and an
 * optional immediate amount. Never asks the operator for both the immediate
 * amount and the debt: whichever one isn't entered is always the remainder.
 *
 * `immediateAmount === null` means "leave the whole total as debt".
 */
export function computeSalePaymentSplit(
  total: number,
  method: SalePaymentMethod,
  immediateAmount: number | null,
): SalePaymentSplit {
  const safeTotal = Number.isFinite(total) && total > 0 ? roundMoney(total) : 0;
  if (immediateAmount === null) {
    return { payments: [], debt: safeTotal };
  }
  const clamped = Math.min(Math.max(0, roundMoney(immediateAmount)), safeTotal);
  const debt = roundMoney(safeTotal - clamped);
  return {
    payments: clamped > 0 ? [{ method, amount: clamped }] : [],
    debt,
  };
}

export interface SalePaymentValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Mirrors the backend validation in confirm_business_sale so the UI can block
 * "Confirmar venta" before making the round trip. The RPC always revalidates
 * independently; this is advisory only.
 */
export function validateSalePaymentInput(
  total: number,
  payments: readonly SalePaymentAllocationInput[],
  hasClient: boolean,
): SalePaymentValidationResult {
  if (payments.some((payment) => !Number.isFinite(payment.amount) || payment.amount <= 0)) {
    return { valid: false, error: "Los montos de pago deben ser mayores a cero." };
  }
  if (payments.some((payment) => payment.method !== "cash" && payment.method !== "transfer")) {
    return { valid: false, error: "El método de pago no es válido." };
  }
  const sumPayments = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const safeTotal = roundMoney(total);
  if (sumPayments > safeTotal) {
    return { valid: false, error: "El pago inmediato no puede superar el total de la venta." };
  }
  const debt = roundMoney(safeTotal - sumPayments);
  if (debt > 0 && !hasClient) {
    return { valid: false, error: "Para vender con saldo pendiente necesitás seleccionar un cliente." };
  }
  return { valid: true };
}
