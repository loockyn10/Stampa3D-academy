/**
 * Contingencias sobre insumos (D058). Reemplaza al recargo automático del 30 % que se sumaba a los
 * «Insumos extra» y a los otros costos: ahora los insumos se suman a su costo real y el usuario puede
 * configurar un porcentaje opcional (0 % por defecto) que se aplica SOLO sobre los insumos
 * (insumos extra del tipo + catálogo de componentes/embalaje). Nunca recibe el markup.
 */
export const DEFAULT_SUPPLIES_CONTINGENCY_PERCENT = 0;
export const MAX_SUPPLIES_CONTINGENCY_PERCENT = 100;

/** Porcentaje de contingencias válido (0–100). Vacío, negativo o no numérico → 0. */
export function normalizeSuppliesContingencyPercent(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SUPPLIES_CONTINGENCY_PERCENT;
  }
  return Math.min(MAX_SUPPLIES_CONTINGENCY_PERCENT, parsed);
}

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
  /**
   * Insumos del catálogo personal (componentes + embalaje) del tipo de producto.
   * Se suman a su costo real, igual que los "insumos extra" del tipo, y NO reciben el markup.
   * Ausente o 0 → el resultado es idéntico al de la calculadora sin catálogo.
   */
  suppliesCost?: number;
  /**
   * Contingencias opcionales sobre insumos, en porcentaje (5 = 5 %). Se aplican solo sobre
   * `fixedCost + suppliesCost`; no tocan impresión, mano de obra ni otros costos. Ausente → 0 %.
   */
  suppliesContingencyPercent?: number;
}

export interface CalculatorPricingResult {
  filamentCost: number;
  electricityCost: number;
  maintenanceCost: number;
  fixedCost: number;
  /** Insumos del catálogo incluidos en el cálculo (costo real, sin contingencias). */
  suppliesCost: number;
  /** Porcentaje de contingencias aplicado (0–100). */
  suppliesContingencyPercent: number;
  /** Insumos sobre los que se calculan las contingencias: insumos extra del tipo + catálogo. */
  suppliesContingencyBase: number;
  /** Monto de contingencias (base × porcentaje). Es costo, no ganancia. */
  suppliesContingencyAmount: number;
  /**
   * Campos históricos (snapshots y consumidores existentes). Desde D058 la "tasa" es la de contingencias
   * y se aplica solo sobre los insumos (`suppliesContingencyBase`), no sobre todo `otherCostsRaw`.
   * Snapshots guardados antes de D058 conservan 0.3 y sus montos originales.
   */
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
  /** Costo real de fabricación: todo lo que se paga, sin contingencias. */
  realCost: number;
  /** Costo base: costo real + contingencias sobre insumos (con 0 % es igual al costo real). */
  baseCost: number;
  salePrice: number;
  /** Ganancia = precio sugerido − costo base (las contingencias cubren pérdidas esperadas, no son ganancia). */
  profit: number;
  /** Margen sobre el precio de venta (ganancia / precio × 100). null si el precio es 0. */
  marginPercent: number | null;
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
  const suppliesCost = finiteOrZero(input.suppliesCost ?? 0);
  const suppliesContingencyPercent = normalizeSuppliesContingencyPercent(input.suppliesContingencyPercent);

  // Costos que no reciben markup y se suman a su valor real: insumos extra del tipo, otros costos e insumos del catálogo.
  const otherCostsRaw = fixedCost + otherCost + suppliesCost;
  // Contingencias: una sola vez y solo sobre los insumos (no sobre "otros costos" ni mano de obra).
  const suppliesContingencyBase = fixedCost + suppliesCost;
  const suppliesContingencyAmount = (suppliesContingencyBase * suppliesContingencyPercent) / 100;
  const contingencyRate = suppliesContingencyPercent / 100;
  const otherCostsOverheadAmount = suppliesContingencyAmount;
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
  const profit = salePrice - baseCost;

  return {
    filamentCost,
    electricityCost,
    maintenanceCost,
    fixedCost,
    suppliesCost,
    suppliesContingencyPercent,
    suppliesContingencyBase,
    suppliesContingencyAmount,
    fixedCostOverheadRate: contingencyRate,
    fixedCostOverheadAmount,
    fixedCostAdjusted,
    otherCostsRaw,
    otherCostsOverheadRate: contingencyRate,
    otherCostsOverheadAmount,
    otherCostsAdjusted,
    multiplier,
    multipliableCost,
    nonMultipliableCost,
    realCost: baseCost - otherCostsOverheadAmount,
    baseCost,
    salePrice,
    profit,
    marginPercent: salePrice > 0 ? (profit / salePrice) * 100 : null,
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
