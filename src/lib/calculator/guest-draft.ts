export const CALCULATOR_GUEST_DRAFT_KEY = "stampa_calculator_guest_draft_v1";
export const CALCULATOR_GUEST_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export interface CalculatorGuestDraft {
  version: 1;
  savedAt: number;
  advanced: boolean;
  grams: string[];
  hours: string;
  minutes: string;
  manualPricePerKg: string;
  manualErrorPercent: string;
  manualKwhPrice: string;
  manualPrinterConsumption: string;
  manualPrinterMaintenance: string;
  laborCost: string;
  otherCost: string;
  fixedCost: string;
  manualMultiplier: string;
  manualPlatformCommission: string;
  manualPlatformExtra: string;
  shippingCost: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseCalculatorGuestDraft(raw: string | null, now = Date.now()): CalculatorGuestDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CalculatorGuestDraft>;
    if (value.version !== 1 || typeof value.savedAt !== "number" || now - value.savedAt > CALCULATOR_GUEST_DRAFT_TTL_MS) return null;
    if (typeof value.advanced !== "boolean" || !isStringArray(value.grams)) return null;
    const stringKeys: Array<keyof CalculatorGuestDraft> = [
      "hours", "minutes", "manualPricePerKg", "manualErrorPercent", "manualKwhPrice",
      "manualPrinterConsumption", "manualPrinterMaintenance", "laborCost", "otherCost", "fixedCost",
      "manualMultiplier", "manualPlatformCommission", "manualPlatformExtra", "shippingCost",
    ];
    if (stringKeys.some((key) => typeof value[key] !== "string")) return null;
    return value as CalculatorGuestDraft;
  } catch {
    return null;
  }
}

export function buildCalculatorAuthHref(path: "/login" | "/registro"): string {
  return `${path}?returnTo=${encodeURIComponent("/calculadora")}`;
}
