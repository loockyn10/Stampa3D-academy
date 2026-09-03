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

export function buildAutomaticBudgetTitle(clientName?: string | null, budgetNumber?: unknown): string {
  const parts = ["Presupuesto"];
  const normalizedClientName = clientName?.trim();
  if (normalizedClientName) parts.push(normalizedClientName);

  const parsedNumber = typeof budgetNumber === "number" ? budgetNumber : Number(budgetNumber);
  if (Number.isSafeInteger(parsedNumber) && parsedNumber > 0) {
    parts.push(formatBudgetNumber(parsedNumber));
  }

  return parts.join(" - ");
}

export function getDefaultBudgetValidUntil(issuedAt: Date = new Date()): string {
  const validUntil = new Date(issuedAt.getTime());
  validUntil.setDate(validUntil.getDate() + 7);

  const year = validUntil.getFullYear();
  const month = String(validUntil.getMonth() + 1).padStart(2, "0");
  const day = String(validUntil.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
