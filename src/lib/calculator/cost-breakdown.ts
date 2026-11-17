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

export type CostGroupId = "printing" | "components" | "packaging" | "other";

export interface CostBreakdownItem {
  key: string;
  label: string;
  group: CostGroupId;
  amount: number;
  /** Detalle opcional ("1,5 m × $300"). */
  detail?: string;
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
  other: "Otros gastos",
};

export interface CostBreakdownInput {
  pricing: CalculatorPricingResult;
  /** Mano de obra (no recibe contingencias ni markup). */
  laborCost?: number;
  /** "Otros costos adicionales" cargados a mano en el cálculo. */
  otherCost?: number;
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
  supplies,
  formatSupplyDetail,
}: CostBreakdownInput): CostBreakdown {
  const items: CostBreakdownItem[] = [
    { key: "filament", label: "Filamento", group: "printing", amount: safe(pricing.filamentCost) },
    { key: "electricity", label: "Electricidad", group: "printing", amount: safe(pricing.electricityCost) },
    { key: "maintenance", label: "Desgaste de impresora", group: "printing", amount: safe(pricing.maintenanceCost) },
  ];

  for (const line of supplies?.lines ?? []) {
    if (!line.valid) continue;
    items.push({
      key: `supply:${line.supplyId}`,
      label: line.name,
      group: line.category === "packaging" ? "packaging" : "components",
      amount: line.cost,
      detail: formatSupplyDetail?.(line),
    });
  }

  if (safe(pricing.fixedCost) > 0) {
    items.push({ key: "type_extras", label: "Insumos extra del tipo", group: "other", amount: safe(pricing.fixedCost) });
  }
  if (safe(otherCost) > 0) items.push({ key: "other", label: "Otros costos", group: "other", amount: safe(otherCost) });
  if (safe(laborCost) > 0) items.push({ key: "labor", label: "Mano de obra", group: "other", amount: safe(laborCost) });

  const realCost = safe(pricing.realCost);
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
