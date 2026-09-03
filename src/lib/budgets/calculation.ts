export const BUDGET_TAX_RATES = [0, 10.5, 21] as const;

export type BudgetTaxRate = (typeof BUDGET_TAX_RATES)[number];
export type BudgetMode = "quick" | "professional";

interface BudgetTotalsInput {
  subtotal: number;
  discountPercent: number;
  taxRate: number;
}

export interface BudgetTotals {
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  netAmount: number;
  taxRate: BudgetTaxRate;
  taxAmount: number;
  total: number;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function normalizeBudgetMode(value: unknown): BudgetMode {
  return value === "professional" ? "professional" : "quick";
}

export function normalizeBudgetTaxRate(value: unknown): BudgetTaxRate {
  const parsed = typeof value === "number" ? value : Number(value);
  return BUDGET_TAX_RATES.find((rate) => rate === parsed) ?? 0;
}

export function calculateBudgetTotals({
  subtotal,
  discountPercent,
  taxRate,
}: BudgetTotalsInput): BudgetTotals {
  const safeSubtotal = Math.max(0, finiteOrZero(subtotal));
  const safeDiscountPercent = Math.min(100, Math.max(0, finiteOrZero(discountPercent)));
  const safeTaxRate = normalizeBudgetTaxRate(taxRate);
  const discountAmount = safeSubtotal * (safeDiscountPercent / 100);
  const netAmount = Math.max(0, safeSubtotal - discountAmount);
  const taxAmount = netAmount * (safeTaxRate / 100);

  return {
    subtotal: safeSubtotal,
    discountPercent: safeDiscountPercent,
    discountAmount,
    netAmount,
    taxRate: safeTaxRate,
    taxAmount,
    total: netAmount + taxAmount,
  };
}

export function formatBudgetNumber(value: unknown): string {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return "PRES-PENDIENTE";
  return `PRES-${String(parsed).padStart(6, "0")}`;
}
