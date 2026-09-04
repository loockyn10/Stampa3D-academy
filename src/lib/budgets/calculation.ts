export const BUDGET_TAX_RATES = [0, 10.5, 21] as const;

export type BudgetTaxRate = (typeof BUDGET_TAX_RATES)[number];
export type BudgetMode = "quick" | "professional";
export type BudgetDepositType = "none" | "percent" | "fixed";

interface BudgetTotalsInput {
  subtotal: number;
  discountPercent: number;
  taxRate: number;
  additionalCharges?: number;
}

export interface BudgetTotals {
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  netAmount: number;
  taxRate: BudgetTaxRate;
  taxAmount: number;
  additionalCharges: number;
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
  additionalCharges = 0,
}: BudgetTotalsInput): BudgetTotals {
  const safeSubtotal = Math.max(0, finiteOrZero(subtotal));
  const safeDiscountPercent = Math.min(100, Math.max(0, finiteOrZero(discountPercent)));
  const safeTaxRate = normalizeBudgetTaxRate(taxRate);
  const discountAmount = safeSubtotal * (safeDiscountPercent / 100);
  const netAmount = Math.max(0, safeSubtotal - discountAmount);
  const taxAmount = netAmount * (safeTaxRate / 100);
  const safeAdditionalCharges = Math.max(0, finiteOrZero(additionalCharges));

  return {
    subtotal: safeSubtotal,
    discountPercent: safeDiscountPercent,
    discountAmount,
    netAmount,
    taxRate: safeTaxRate,
    taxAmount,
    additionalCharges: safeAdditionalCharges,
    total: netAmount + taxAmount + safeAdditionalCharges,
  };
}

export function calculateBudgetDeposit(
  total: number,
  depositType: BudgetDepositType,
  depositValue: number,
): { requiredAmount: number; remainingAmount: number } {
  const safeTotal = Math.max(0, finiteOrZero(total));
  const safeValue = Math.max(0, finiteOrZero(depositValue));
  const requestedAmount = depositType === "percent"
    ? safeTotal * (Math.min(100, safeValue) / 100)
    : depositType === "fixed" ? safeValue : 0;
  const requiredAmount = Math.min(safeTotal, requestedAmount);
  return { requiredAmount, remainingAmount: safeTotal - requiredAmount };
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  transfer: "Transferencia",
  cash: "Efectivo",
  cash_payment: "Contado",
  prepaid: "100% anticipado",
  half_upfront: "50% anticipo / 50% contra entrega",
  to_agree: "A convenir",
};

export function getBudgetPaymentLabel(method: unknown, customTerms?: unknown): string {
  if (method === "custom") return typeof customTerms === "string" ? customTerms.trim() : "";
  const knownLabel = typeof method === "string" ? PAYMENT_METHOD_LABELS[method] || "" : "";
  if (knownLabel) return knownLabel;
  return typeof customTerms === "string" ? customTerms.trim() : "";
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
