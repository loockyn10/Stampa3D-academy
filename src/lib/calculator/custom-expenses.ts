/**
 * Gastos adicionales personalizados (D059): conceptos con nombre e importe que el usuario agrega a un cálculo
 * o a un producto («Tratamiento especial $500», «Diseño personalizado $1.200»).
 *
 * Reemplazan al monto genérico «Otros costos adicionales» sin cambiar el motor: su suma entra como `otherCost`
 * en `calculateCalculatorPricing` (costo real, sin markup ni contingencias). Puro: sin React ni Supabase.
 */
import { parseDecimalInput, roundMoney } from "./supplies";

export interface CustomExpense {
  id: string;
  name: string;
  amount: number;
}

/** Borrador editable en la UI (el importe se edita como texto: "1200,50", "1500"). */
export interface CustomExpenseDraft {
  id: string;
  name: string;
  amount: string;
}

export const CUSTOM_EXPENSE_LIMITS = {
  nameMaxLength: 60,
  maxAmount: 1_000_000_000,
  maxItems: 30,
} as const;

/** Nombre del gasto que conserva el antiguo monto genérico «Otros costos» de cálculos guardados. */
export const LEGACY_OTHER_COSTS_NAME = "Otros costos";
export const LEGACY_OTHER_COSTS_ID = "legacy-other-costs";

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** Importe en pesos ≥ 0 redondeado al centavo; null si no es válido. */
export function parseExpenseAmount(value: unknown): number | null {
  const parsed = parseDecimalInput(typeof value === "number" || typeof value === "string" ? value : "");
  if (parsed === null || parsed < 0 || parsed > CUSTOM_EXPENSE_LIMITS.maxAmount) return null;
  return roundMoney(parsed);
}

export type CustomExpenseValidation =
  | { ok: true; value: { name: string; amount: number } }
  | { ok: false; errors: Partial<Record<"name" | "amount", string>> };

/** Valida un gasto antes de agregarlo o editarlo. */
export function validateCustomExpense(name: unknown, amount: unknown): CustomExpenseValidation {
  const errors: Partial<Record<"name" | "amount", string>> = {};
  const normalizedName = normalizeName(name);
  if (!normalizedName) errors.name = "Escribí el concepto.";
  else if (normalizedName.length > CUSTOM_EXPENSE_LIMITS.nameMaxLength) {
    errors.name = `Máximo ${CUSTOM_EXPENSE_LIMITS.nameMaxLength} caracteres.`;
  }
  const parsedAmount = parseExpenseAmount(typeof amount === "string" && amount.trim() === "" ? "0" : amount);
  if (parsedAmount === null) errors.amount = "Ingresá un importe válido (0 o más).";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name: normalizedName, amount: parsedAmount as number } };
}

/**
 * Lee defensivamente una lista de gastos (snapshot JSON, borrador o estado de la UI). Descarta filas sin
 * nombre o con importe inválido, ids repetidos y lo que exceda el máximo. Importes al centavo.
 */
export function normalizeCustomExpenses(value: unknown): CustomExpense[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: CustomExpense[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = normalizeName(row.name);
    const amount = parseExpenseAmount(row.amount);
    if (!name || name.length > CUSTOM_EXPENSE_LIMITS.nameMaxLength || amount === null) continue;
    const baseId = typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 64) : `expense-${result.length + 1}`;
    let id = baseId;
    for (let suffix = 2; seen.has(id); suffix += 1) id = `${baseId}-${suffix}`;
    seen.add(id);
    result.push({ id, name, amount });
    if (result.length >= CUSTOM_EXPENSE_LIMITS.maxItems) break;
  }
  return result;
}

/** Suma exacta en centavos (el total coincide con la suma de lo que se muestra). */
export function sumCustomExpenses(expenses: CustomExpense[]): number {
  const cents = expenses.reduce((total, expense) => total + Math.round(expense.amount * 100), 0);
  return cents / 100;
}

/**
 * Gastos de un cálculo guardado. Snapshots D059 guardan `custom_expenses`; los anteriores solo tenían el
 * monto genérico `other_costs`, que se conserva como un único gasto «Otros costos» (nunca se pierde ni se
 * cuenta dos veces: si hay `custom_expenses`, `other_costs` es su suma).
 */
export function readSnapshotCustomExpenses(snapshot: Record<string, unknown> | null | undefined): CustomExpense[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  if (Array.isArray(snapshot.custom_expenses)) return normalizeCustomExpenses(snapshot.custom_expenses);
  const legacy = parseExpenseAmount(snapshot.other_costs);
  return legacy && legacy > 0 ? [{ id: LEGACY_OTHER_COSTS_ID, name: LEGACY_OTHER_COSTS_NAME, amount: legacy }] : [];
}

/** Borradores de la UI → gastos válidos (los incompletos no suman; un importe vacío cuenta como 0). */
export function expensesFromDrafts(drafts: CustomExpenseDraft[]): CustomExpense[] {
  return normalizeCustomExpenses(drafts.map((draft) => ({
    id: draft.id,
    name: draft.name,
    amount: typeof draft.amount === "string" && draft.amount.trim() === "" ? "0" : draft.amount,
  })));
}

export function expensesToDrafts(expenses: CustomExpense[]): CustomExpenseDraft[] {
  return expenses.map((expense) => ({ id: expense.id, name: expense.name, amount: String(expense.amount) }));
}

/** Id para un gasto nuevo. */
export function newCustomExpenseId(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `expense-${random}`;
}
