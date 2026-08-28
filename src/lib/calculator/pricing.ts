export const FIXED_COST_OVERHEAD_RATE = 0.3;

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

  const fixedCostOverheadAmount = fixedCost * FIXED_COST_OVERHEAD_RATE;
  const fixedCostAdjusted = fixedCost + fixedCostOverheadAmount;
  const multipliableCost = filamentCost;
  const nonMultipliableCost =
    electricityCost +
    maintenanceCost +
    fixedCostAdjusted +
    laborCost +
    otherCost;
  const baseCost = filamentCost + nonMultipliableCost;
  const salePrice = filamentCost * multiplier + nonMultipliableCost;

  return {
    filamentCost,
    electricityCost,
    maintenanceCost,
    fixedCost,
    fixedCostOverheadRate: FIXED_COST_OVERHEAD_RATE,
    fixedCostOverheadAmount,
    fixedCostAdjusted,
    multiplier,
    multipliableCost,
    nonMultipliableCost,
    baseCost,
    salePrice,
    profit: salePrice - baseCost,
  };
}
