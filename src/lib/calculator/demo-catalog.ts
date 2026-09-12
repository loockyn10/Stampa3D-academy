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

function comparable(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-AR")
    .replace(/[^a-z0-9]/g, "");
}

function canonicalBrand(value: string | null): string | null {
  if (!value) return null;
  const aliases: Record<string, string> = {
    bambulab: "Bambu Lab",
    anycubic: "Anycubic",
    creality: "Creality",
    flashforge: "Flashforge",
  };
  return aliases[comparable(value)] ?? value;
}

function stripBrandPrefix(value: string, brand: string): string {
  const tokens = brand.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return value;
  const pattern = tokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s._-]*");
  return value.replace(new RegExp(`^\\s*${pattern}(?=\\s|[._-]|\\d|$)`, "iu"), "").trim();
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getCalculatorPrinterDisplayName(printer: DemoPrinterCandidate): string {
  const rawBrand = cleanText(printer.brand);
  const brand = canonicalBrand(rawBrand);
  const model = cleanText(printer.model);
  const name = cleanText(printer.name);
  const nameWithoutBrand = name && rawBrand ? stripBrandPrefix(name, rawBrand) : name;
  let descriptor = nameWithoutBrand || model;

  if (descriptor && model && !comparable(descriptor).includes(comparable(model))) {
    descriptor = `${model} ${descriptor}`;
  }

  if (brand && descriptor && comparable(descriptor).startsWith(comparable(brand))) {
    return descriptor;
  }
  return [brand, descriptor].filter(Boolean).join(" ");
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
