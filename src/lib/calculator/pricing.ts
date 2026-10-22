export const OTHER_COSTS_OVERHEAD_RATE = 0.3;
// Backward-compatible export for existing calculator consumers and snapshots.
export const FIXED_COST_OVERHEAD_RATE = OTHER_COSTS_OVERHEAD_RATE;

export interface CalculatorFilamentLineInput {
  filamentId: string;
  label: string;
  grams: number;
  costPerKg: number;
}

export interface CalculatorFilamentLineResult
  extends CalculatorFilamentLineInput {
  filamentCost: number;
}

export interface CalculatorFilamentPricingResult {
  filamentLines: CalculatorFilamentLineResult[];
  totalFilamentGrams: number;
  filamentCostRaw: number;
  wasteRate: number;
  filamentCostWithWaste: number;
  isValid: boolean;
}

export interface CalculatorRecipeLineInput {
  filamentId: string;
  grams: number;
  filamentType?: string | null;
  brand?: string | null;
  name?: string | null;
  color?: string | null;
}

export interface CalculatorPricingInput {
  filamentCost: number;
  electricityCost: number;
  maintenanceCost: number;
  fixedCost: number;
  multiplier: number;
  laborCost?: number;
  otherCost?: number;
}

export interface CalculatorPricingResult {
  filamentCost: number;
  electricityCost: number;
  maintenanceCost: number;
  fixedCost: number;
  fixedCostOverheadRate: number;
  fixedCostOverheadAmount: number;
  fixedCostAdjusted: number;
  otherCostsRaw: number;
  otherCostsOverheadRate: number;
  otherCostsOverheadAmount: number;
  otherCostsAdjusted: number;
  multiplier: number;
  multipliableCost: number;
  nonMultipliableCost: number;
  baseCost: number;
  salePrice: number;
  profit: number;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nonNegativeFiniteOrZero(value: number): number {
  return Math.max(0, finiteOrZero(value));
}

export function calculateCalculatorFilamentPricing({
  lines,
  wasteRate,
  manualCostPerKg,
}: {
  lines: CalculatorFilamentLineInput[];
  wasteRate: number;
  manualCostPerKg?: number | null;
}): CalculatorFilamentPricingResult {
  const normalizedWasteRate = nonNegativeFiniteOrZero(wasteRate);
  const normalizedManualCostPerKg =
    manualCostPerKg != null && Number.isFinite(manualCostPerKg) && manualCostPerKg >= 0
      ? manualCostPerKg
      : null;

  const filamentLines = lines.map((line) => {
    const grams = nonNegativeFiniteOrZero(line.grams);
    const costPerKg = normalizedManualCostPerKg
      ?? nonNegativeFiniteOrZero(line.costPerKg);

    return {
      ...line,
      grams,
      costPerKg,
      filamentCost: (grams / 1000) * costPerKg,
    };
  });

  const totalFilamentGrams = filamentLines.reduce(
    (total, line) => total + line.grams,
    0,
  );
  const filamentCostRaw = filamentLines.reduce(
    (total, line) => total + line.filamentCost,
    0,
  );

  return {
    filamentLines,
    totalFilamentGrams,
    filamentCostRaw,
    wasteRate: normalizedWasteRate,
    filamentCostWithWaste: filamentCostRaw * (1 + normalizedWasteRate),
    isValid:
      filamentLines.length > 0
      && filamentLines.every(
        (line) => line.filamentId.trim().length > 0 && line.grams > 0,
      ),
  };
}

export function aggregateCalculatorRecipeLines(
  lines: CalculatorRecipeLineInput[],
): CalculatorRecipeLineInput[] {
  const aggregated = new Map<string, CalculatorRecipeLineInput>();

  for (const line of lines) {
    const filamentId = line.filamentId.trim();
    const grams = nonNegativeFiniteOrZero(line.grams);
    if (!filamentId || grams <= 0) continue;

    const existing = aggregated.get(filamentId);
    if (existing) {
      existing.grams += grams;
      continue;
    }

    aggregated.set(filamentId, {
      ...line,
      filamentId,
      grams,
    });
  }

  return Array.from(aggregated.values());
}

export function calculateCalculatorPricing(
  input: CalculatorPricingInput,
): CalculatorPricingResult {
  const filamentCost = finiteOrZero(input.filamentCost);
  const electricityCost = finiteOrZero(input.electricityCost);
  const maintenanceCost = finiteOrZero(input.maintenanceCost);
  const fixedCost = finiteOrZero(input.fixedCost);
  const multiplier = finiteOrZero(input.multiplier);
  const laborCost = finiteOrZero(input.laborCost ?? 0);
  const otherCost = finiteOrZero(input.otherCost ?? 0);

  const otherCostsRaw = fixedCost + otherCost;
  const otherCostsOverheadAmount = otherCostsRaw * OTHER_COSTS_OVERHEAD_RATE;
  const otherCostsAdjusted = otherCostsRaw + otherCostsOverheadAmount;
  // Legacy aliases kept for existing calculation snapshots.
  const fixedCostOverheadAmount = otherCostsOverheadAmount;
  const fixedCostAdjusted = otherCostsAdjusted;
  const multipliableCost = filamentCost;
  const nonMultipliableCost =
    electricityCost +
    maintenanceCost +
    otherCostsAdjusted +
    laborCost;
  const baseCost = filamentCost + nonMultipliableCost;
  const salePrice = filamentCost * multiplier + nonMultipliableCost;

  return {
    filamentCost,
    electricityCost,
    maintenanceCost,
    fixedCost,
    fixedCostOverheadRate: OTHER_COSTS_OVERHEAD_RATE,
    fixedCostOverheadAmount,
    fixedCostAdjusted,
    otherCostsRaw,
    otherCostsOverheadRate: OTHER_COSTS_OVERHEAD_RATE,
    otherCostsOverheadAmount,
    otherCostsAdjusted,
    multiplier,
    multipliableCost,
    nonMultipliableCost,
    baseCost,
    salePrice,
    profit: salePrice - baseCost,
  };
}

export interface MarketplacePriceInput {
  /** Monto que el vendedor quiere recibir: el precio sugerido del motor (`calculateCalculatorPricing().salePrice`). */
  salePrice: number;
  /** Comisión porcentual que la plataforma cobra sobre el precio FINAL publicado (15 = 15 %). */
  commissionPercent: number;
  /** Cargo fijo por venta configurado por el usuario. */
  fixedFee: number;
  /** Envío a cargo del vendedor. */
  shippingCost: number;
  /** Otros costos de venta a recuperar (opcional). */
  otherSellingCosts?: number;
}

export type MarketplacePriceStatus = "ok" | "not_configured" | "invalid_commission";

export interface MarketplacePriceResult {
  status: MarketplacePriceStatus;
  /** Precio a publicar, redondeado hacia arriba al centavo (0 si no hay estimación válida). */
  price: number;
  /** Comisión estimada sobre el precio publicado. */
  commissionAmount: number;
  fixedFee: number;
  shippingCost: number;
  otherSellingCosts: number;
  commissionPercent: number;
  /** Lo que queda después de comisión y cargos (≈ precio sugerido, nunca menos). */
  netReceived: number;
  /** Compatibilidad: true solo cuando `status === "ok"`. */
  isConfigured: boolean;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;
/** Redondeo hacia arriba al centavo: garantiza que el neto no quede por debajo del objetivo. */
const ceilMoney = (value: number) => Math.ceil(value * 100 - 1e-6) / 100;

/**
 * Precio para Mercado Libre cuando la comisión se cobra sobre el precio final:
 *
 *   precio ML = (precio sugerido + cargo fijo + envío + otros costos de venta) / (1 − comisión)
 *
 * Así, después de descontar la comisión y los cargos, se recibe el precio sugerido.
 * No incorpora tarifas oficiales: todos los parámetros vienen de la configuración del usuario.
 * - comisión ausente o 0 → `not_configured` (no se presenta una estimación);
 * - comisión negativa, no numérica o ≥ 100 % → `invalid_commission`.
 */
export function calculateMarketplacePrice({
  salePrice,
  commissionPercent,
  fixedFee,
  shippingCost,
  otherSellingCosts = 0,
}: MarketplacePriceInput): MarketplacePriceResult {
  const base = nonNegativeFiniteOrZero(salePrice);
  const fee = nonNegativeFiniteOrZero(fixedFee);
  const shipping = nonNegativeFiniteOrZero(shippingCost);
  const other = nonNegativeFiniteOrZero(otherSellingCosts);
  const rawPercent = Number(commissionPercent);
  const empty = {
    price: 0,
    commissionAmount: 0,
    fixedFee: fee,
    shippingCost: shipping,
    otherSellingCosts: other,
    netReceived: 0,
    isConfigured: false,
  };

  if (!Number.isFinite(rawPercent) || rawPercent < 0 || rawPercent >= 100) {
    return { ...empty, status: "invalid_commission", commissionPercent: Number.isFinite(rawPercent) ? rawPercent : 0 };
  }
  if (rawPercent === 0) {
    return { ...empty, status: "not_configured", commissionPercent: 0 };
  }

  const rate = rawPercent / 100;
  const price = ceilMoney((base + fee + shipping + other) / (1 - rate));
  const commissionAmount = roundMoney(price * rate);
  return {
    status: "ok",
    price,
    commissionAmount,
    fixedFee: fee,
    shippingCost: shipping,
    otherSellingCosts: other,
    commissionPercent: rawPercent,
    netReceived: roundMoney(price - commissionAmount - fee - shipping - other),
    isConfigured: true,
  };
}
