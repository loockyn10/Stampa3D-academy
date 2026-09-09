export type BusinessInventoryPeriod = "week" | "month";

export interface BusinessLocationBalance {
  catalogItemId: string;
  showroom: number;
  warehouse: number;
  showroomTarget: number | null;
  stockMinimum: number | null;
  unitWeightGrams: number | null;
}

export interface BusinessReplenishmentItem extends BusinessLocationBalance {
  name: string;
  category: string;
  sourceType: "manufactured" | "resale";
  totalStock: number;
  soldUnits: number;
  soldTotal: number;
}

export interface BusinessReplenishmentWorkspace {
  enabled: boolean;
  initialized: boolean;
  timezone: string;
  period: BusinessInventoryPeriod;
  periodStart: string;
  periodEnd: string;
  items: BusinessReplenishmentItem[];
}

export function normalizeBusinessReplenishmentWorkspace(value: unknown): BusinessReplenishmentWorkspace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items = rawItems.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    const optionalNumber = (candidate: unknown) => candidate === null || candidate === undefined ? null : Number(candidate);
    return [{
      catalogItemId: item.id,
      name: item.name,
      category: typeof item.category === "string" ? item.category : "Sin categoría",
      sourceType: item.source_type === "manufactured" ? "manufactured" as const : "resale" as const,
      totalStock: Number(item.total_stock) || 0,
      showroom: Number(item.showroom_stock) || 0,
      warehouse: Number(item.warehouse_stock) || 0,
      showroomTarget: optionalNumber(item.showroom_target),
      stockMinimum: optionalNumber(item.stock_minimum),
      unitWeightGrams: optionalNumber(item.unit_weight_grams),
      soldUnits: Number(item.sold_units) || 0,
      soldTotal: Number(item.sold_total) || 0,
    }];
  });
  return {
    enabled: raw.enabled === true,
    initialized: raw.initialized === true,
    timezone: typeof raw.timezone === "string" ? raw.timezone : "America/Argentina/Buenos_Aires",
    period: raw.period === "month" ? "month" : "week",
    periodStart: typeof raw.periodStart === "string" ? raw.periodStart : "",
    periodEnd: typeof raw.periodEnd === "string" ? raw.periodEnd : "",
    items,
  };
}

export function calculateShowroomReplenishment(input: Pick<BusinessLocationBalance, "showroom" | "warehouse" | "showroomTarget">) {
  const target = input.showroomTarget;
  if (target === null) return { needed: 0, movable: 0, remainingShortage: 0 };
  const needed = Math.max(0, target - Math.max(0, input.showroom));
  const movable = Math.min(needed, Math.max(0, input.warehouse));
  return { needed, movable, remainingShortage: needed - movable };
}

export function calculatePurchaseSuggestion(stockMinimum: number | null, currentStock: number) {
  return stockMinimum === null ? null : Math.max(0, stockMinimum - Math.max(0, currentStock));
}

export function soldWeightKg(units: number, unitWeightGrams: number | null) {
  if (unitWeightGrams === null || unitWeightGrams <= 0) return null;
  return Number(((Math.max(0, units) * unitWeightGrams) / 1000).toFixed(3));
}

export function getBusinessPeriodLabel(period: BusinessInventoryPeriod) {
  return period === "month" ? "Este mes" : "Esta semana";
}
