/**
 * Desglose de costos y rentabilidad de un cálculo. Puro: solo reorganiza lo que ya calculó el motor
 * (`calculateCalculatorPricing`), no tiene fórmulas de precio propias.
 *
 *   costo real      = impresión + componentes + embalaje + otros gastos   (lo que efectivamente se paga)
 *   contingencias   = % opcional (0 % por defecto) solo sobre insumos: insumos extra del tipo + catálogo
 *   costo base      = costo real + contingencias                            (con 0 % es igual al costo real)
 *   ganancia        = precio sugerido − costo base
 *   margen          = ganancia / precio sugerido                             (no confundir con el markup)
 */
import type { CalculatorPricingResult } from "./pricing";
import type { PricedSupplyLine, SupplyLinesPricing } from "./supplies";
import type { CustomExpense } from "./custom-expenses";

export type CostGroupId = "printing" | "components" | "packaging" | "other";

export interface CostBreakdownItem {
  key: string;
  label: string;
  group: CostGroupId;
  amount: number;
  /**
   * Importe para mostrar, en centavos exactos: se reparte el redondeo para que la suma de las filas sea
   * exactamente el costo real mostrado (D059, «Desglose de costos»).
   */
  displayAmount: number;
  /** Detalle opcional ("1,5 m × $300"). */
  detail?: string;
  /** Aclaraciones de la fila: «Solo este producto», «Cantidad propia», «Archivado», «Sin costo cargado», etc. */
  notes?: string[];
}

export interface CostBreakdownGroup {
  id: CostGroupId;
  label: string;
  amount: number;
  /** Proporción del costo real (0–1). */
  share: number;
  items: CostBreakdownItem[];
}

export interface CostBreakdownWarning {
  code: "zero_cost_supplies" | "archived_supplies" | "invalid_supplies" | "negative_profit" | "legacy_extras_with_supplies";
  message: string;
}

export interface CostBreakdown {
  groups: CostBreakdownGroup[];
  /** Todas las filas del desglose, en orden (impresión, componentes, embalaje, mano de obra y gastos). */
  items: CostBreakdownItem[];
  /** Suma exacta de las filas; coincide con `realCost` del motor (ver `matchesEngine`). */
  itemsTotal: number;
  /** true si las filas suman exactamente el costo real del motor (tolerancia de medio centavo). */
  matchesEngine: boolean;
  realCost: number;
  /** Contingencias sobre insumos (concepto separado del costo real). */
  contingencyAmount: number;
  /** Porcentaje configurado (0–100). */
  contingencyPercent: number;
  /** Insumos sobre los que se calcularon las contingencias. */
  contingencyBase: number;
  baseCost: number;
  salePrice: number;
  profit: number;
  marginPercent: number | null;
  multiplier: number;
  topItem: CostBreakdownItem | null;
  /** true si la ganancia depende de costos que pueden faltar (insumos en $0, archivados o inválidos). */
  isProvisional: boolean;
  warnings: CostBreakdownWarning[];
}

export const COST_GROUP_LABELS: Record<CostGroupId, string> = {
  printing: "Impresión",
  components: "Componentes",
  packaging: "Embalaje",
  other: "Mano de obra y otros gastos",
};

export interface CostBreakdownInput {
  pricing: CalculatorPricingResult;
  /** Mano de obra (no recibe contingencias ni markup). */
  laborCost?: number;
  /** "Otros costos adicionales" cargados a mano en el cálculo (suma de los gastos personalizados). */
  otherCost?: number;
  /**
   * D059: gastos adicionales con nombre. Si se pasan, cada uno es una fila; su suma debe ser `otherCost`
   * (si no coincide, la diferencia aparece como «Otros costos» para que el desglose cierre con el motor).
   */
  customExpenses?: CustomExpense[] | null;
  supplies?: SupplyLinesPricing | null;
  /** Formatea el detalle de una línea de insumo; opcional para que el módulo siga siendo puro. */
  formatSupplyDetail?: (line: PricedSupplyLine) => string;
}

const safe = (value: number | undefined | null) => (Number.isFinite(value) ? Math.max(0, value as number) : 0);
const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

export function buildCostBreakdown({
  pricing,
  laborCost = 0,
  otherCost = 0,
  customExpenses,
  supplies,
  formatSupplyDetail,
}: CostBreakdownInput): CostBreakdown {
  type DraftItem = Omit<CostBreakdownItem, "displayAmount">;
  const draftItems: DraftItem[] = [
    { key: "filament", label: "Filamento", group: "printing", amount: safe(pricing.filamentCost) },
    { key: "electricity", label: "Electricidad", group: "printing", amount: safe(pricing.electricityCost) },
    { key: "maintenance", label: "Desgaste de impresora", group: "printing", amount: safe(pricing.maintenanceCost) },
  ];

  for (const line of supplies?.lines ?? []) {
    if (!line.valid) continue;
    const extra = line as PricedSupplyLine & { origin?: string; adjusted?: boolean; missing?: boolean };
    const notes: string[] = [];
    if (extra.origin === "product") notes.push("Solo este producto");
    if (extra.adjusted) notes.push("Cantidad propia");
    if (line.archived) notes.push("Archivado");
    if (extra.missing) notes.push("Ya no está en el catálogo: costo guardado");
    if (line.unitCost === 0) notes.push("Sin costo cargado");
    draftItems.push({
      key: `supply:${line.supplyId}`,
      label: line.name,
      group: line.category === "packaging" ? "packaging" : "components",
      amount: line.cost,
      detail: formatSupplyDetail?.(line),
      ...(notes.length > 0 ? { notes } : {}),
    });
  }

  if (safe(laborCost) > 0) draftItems.push({ key: "labor", label: "Mano de obra", group: "other", amount: safe(laborCost) });
  if (safe(pricing.fixedCost) > 0) {
    draftItems.push({ key: "type_extras", label: "Insumos extra del tipo", group: "other", amount: safe(pricing.fixedCost) });
  }
  if (customExpenses) {
    const named = customExpenses.filter((expense) => safe(expense.amount) > 0);
    for (const expense of named) {
      draftItems.push({ key: `expense:${expense.id}`, label: expense.name, group: "other", amount: safe(expense.amount), notes: ["Gasto adicional"] });
    }
    const expensesCents = named.reduce((total, expense) => total + Math.round(safe(expense.amount) * 100), 0);
    const remainder = (Math.round(safe(otherCost) * 100) - expensesCents) / 100;
    if (remainder > 0.004) draftItems.push({ key: "other", label: "Otros costos", group: "other", amount: remainder });
  } else if (safe(otherCost) > 0) {
    draftItems.push({ key: "other", label: "Otros costos", group: "other", amount: safe(otherCost) });
  }

  const realCost = safe(pricing.realCost);
  const itemsTotal = draftItems.reduce((total, item) => total + item.amount, 0);
  const matchesEngine = Math.abs(itemsTotal - realCost) < 0.005;
  const displayCents = allocateCents(draftItems.map((item) => item.amount), matchesEngine ? realCost : itemsTotal);
  const items: CostBreakdownItem[] = draftItems.map((item, index) => ({ ...item, displayAmount: displayCents[index] / 100 }));
  const groups: CostBreakdownGroup[] = (Object.keys(COST_GROUP_LABELS) as CostGroupId[]).map((id) => {
    const groupItems = items.filter((item) => item.group === id && item.amount > 0);
    const amount = groupItems.reduce((total, item) => total + item.amount, 0);
    return {
      id,
      label: COST_GROUP_LABELS[id],
      amount,
      share: realCost > 0 ? amount / realCost : 0,
      items: groupItems,
    };
  });

  const topItem = items.reduce<CostBreakdownItem | null>(
    (top, item) => (item.amount > 0 && (!top || item.amount > top.amount) ? item : top),
    null,
  );

  const warnings: CostBreakdownWarning[] = [];
  if (supplies?.zeroCostCount) {
    warnings.push({
      code: "zero_cost_supplies",
      message: `${plural(supplies.zeroCostCount, "insumo tiene", "insumos tienen")} costo $0. Si falta cargar su precio, la ganancia real será menor.`,
    });
  }
  if (supplies?.archivedCount) {
    warnings.push({
      code: "archived_supplies",
      message: `${plural(supplies.archivedCount, "insumo archivado sigue", "insumos archivados siguen")} en este tipo de producto y se cuenta con su último costo.`,
    });
  }
  if (supplies?.invalidCount) {
    warnings.push({
      code: "invalid_supplies",
      message: `${plural(supplies.invalidCount, "insumo tiene", "insumos tienen")} una cantidad o unidad inválida y no se sumó.`,
    });
  }
  if ((supplies?.total ?? 0) > 0 && safe(pricing.fixedCost) > 0) {
    warnings.push({
      code: "legacy_extras_with_supplies",
      message: "Este tipo también suma «Insumos extra». Si ese monto ya cubría componentes o embalaje cargados en el catálogo, ponelo en 0 para no contarlos dos veces.",
    });
  }
  if (pricing.salePrice > 0 && pricing.profit < 0) {
    warnings.push({ code: "negative_profit", message: "Con este markup el precio sugerido no cubre el costo base." });
  }

  return {
    groups,
    items,
    itemsTotal,
    matchesEngine,
    realCost,
    contingencyAmount: safe(pricing.suppliesContingencyAmount),
    contingencyPercent: safe(pricing.suppliesContingencyPercent),
    contingencyBase: safe(pricing.suppliesContingencyBase),
    baseCost: pricing.baseCost,
    salePrice: pricing.salePrice,
    profit: pricing.profit,
    marginPercent: pricing.marginPercent,
    multiplier: pricing.multiplier,
    topItem,
    isProvisional: Boolean(supplies && (supplies.zeroCostCount || supplies.invalidCount)),
    warnings,
  };
}

/**
 * Reparte el redondeo al centavo (método del mayor resto) para que la suma de las filas mostradas sea
 * exactamente el total mostrado. Devuelve centavos enteros por fila.
 */
export function allocateCents(amounts: number[], total: number): number[] {
  const targetCents = Math.round(safe(total) * 100);
  const exact = amounts.map((amount) => safe(amount) * 100);
  const floors = exact.map((value) => Math.floor(value + 1e-7));
  let missing = targetCents - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const result = [...floors];
  for (let step = 0; missing > 0 && order.length > 0; step += 1, missing -= 1) {
    result[order[step % order.length].index] += 1;
  }
  return result;
}
