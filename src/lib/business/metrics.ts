import type { BusinessInventoryPeriod } from "./replenishment";

export interface BusinessMetricComparison {
  revenuePercent: number | null;
  salesPercent: number | null;
}

export interface BusinessTopProductMetric {
  catalogItemId: string;
  name: string;
  units: number;
  revenue: number;
  kilograms: number | null;
}

export interface BusinessMetrics {
  period: BusinessInventoryPeriod;
  timezone: string;
  periodStart: string;
  periodEnd: string;
  revenue: number;
  salesCount: number;
  averageTicket: number;
  unitsSold: number;
  filamentKilograms: number;
  comparison: BusinessMetricComparison;
  topProducts: BusinessTopProductMetric[];
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeBusinessMetrics(value: unknown): BusinessMetrics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.periodStart !== "string" || typeof raw.periodEnd !== "string") return null;
  const comparisonRaw = raw.comparison && typeof raw.comparison === "object" && !Array.isArray(raw.comparison)
    ? raw.comparison as Record<string, unknown>
    : {};
  const optionalPercent = (candidate: unknown) => candidate === null || candidate === undefined
    ? null
    : finiteNumber(candidate);

  const topProducts = Array.isArray(raw.topProducts)
    ? raw.topProducts.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const item = candidate as Record<string, unknown>;
      if (typeof item.catalogItemId !== "string" || typeof item.name !== "string") return [];
      return [{
        catalogItemId: item.catalogItemId,
        name: item.name,
        units: finiteNumber(item.units),
        revenue: finiteNumber(item.revenue),
        kilograms: item.kilograms === null || item.kilograms === undefined ? null : finiteNumber(item.kilograms),
      }];
    })
    : [];

  return {
    period: raw.period === "month" ? "month" : "week",
    timezone: typeof raw.timezone === "string" ? raw.timezone : "America/Argentina/Buenos_Aires",
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    revenue: finiteNumber(raw.revenue),
    salesCount: finiteNumber(raw.salesCount),
    averageTicket: finiteNumber(raw.averageTicket),
    unitsSold: finiteNumber(raw.unitsSold),
    filamentKilograms: finiteNumber(raw.filamentKilograms),
    comparison: {
      revenuePercent: optionalPercent(comparisonRaw.revenuePercent),
      salesPercent: optionalPercent(comparisonRaw.salesPercent),
    },
    topProducts,
  };
}
