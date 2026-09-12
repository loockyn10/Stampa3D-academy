import { getFilamentLabel } from "@/lib/filaments/utils";

type DemoPrinterCandidate = {
  id: string;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  power_watts?: number | null;
  maintenance_cost_per_hour?: number | null;
};

type DemoFilamentCandidate = {
  id: string;
  name?: string | null;
  brand?: string | null;
  filament_type?: string | null;
  color?: string | null;
  default_total_grams?: number | null;
  default_purchase_price?: number | null;
};

export type DemoSelectionStatus = "configured" | "fallback" | "configured_missing" | "configured_invalid";

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

function distinctParts(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value) return false;
    const key = value.toLocaleLowerCase("es-AR");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getCalculatorPrinterDisplayName(printer: DemoPrinterCandidate): string {
  return distinctParts([
    cleanText(printer.brand),
    cleanText(printer.model),
    cleanText(printer.name),
  ]).join(" ");
}

export function isUsableDemoPrinter(printer: DemoPrinterCandidate): boolean {
  return Boolean(
    getCalculatorPrinterDisplayName(printer)
      && isFiniteNumber(printer.power_watts)
      && Number(printer.power_watts) > 0
      && isFiniteNumber(printer.maintenance_cost_per_hour)
      && Number(printer.maintenance_cost_per_hour) >= 0,
  );
}

export function getCalculatorFilamentDisplayName(filament: DemoFilamentCandidate): string {
  return getFilamentLabel(filament);
}

export function isUsableDemoFilament(filament: DemoFilamentCandidate): boolean {
  return Boolean(
    cleanText(filament.filament_type)
      && getCalculatorFilamentDisplayName(filament) !== "Filamento sin nombre"
      && isFiniteNumber(filament.default_total_grams)
      && Number(filament.default_total_grams) > 0
      && isFiniteNumber(filament.default_purchase_price)
      && Number(filament.default_purchase_price) > 0,
  );
}

export function selectDemoCatalogItem<T extends { id: string }>(
  items: T[],
  configuredId: string | null,
  isUsable: (item: T) => boolean,
): { item: T | null; status: DemoSelectionStatus } {
  if (configuredId) {
    const configured = items.find((item) => item.id === configuredId);
    if (!configured) {
      return { item: items.find(isUsable) ?? null, status: "configured_missing" };
    }
    if (!isUsable(configured)) {
      return { item: items.find(isUsable) ?? null, status: "configured_invalid" };
    }
    return { item: configured, status: "configured" };
  }

  return { item: items.find(isUsable) ?? null, status: "fallback" };
}
