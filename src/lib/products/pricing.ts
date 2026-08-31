import {
  calculateCalculatorFilamentPricing,
  calculateCalculatorPricing,
} from "@/lib/calculator/pricing";

type NumberValue = number | string | null | undefined;

export interface ProductPricingFilament {
  id?: string | null;
  name?: string | null;
  purchase_price?: NumberValue;
  total_grams?: NumberValue;
}

export interface ProductPricingMaterial {
  filament?: ProductPricingFilament | null;
  filament_id?: string | null;
  grams?: NumberValue;
}

export interface ProductPricingComponent {
  id?: string | null;
  name?: string | null;
  quantity_per_product?: NumberValue;
  materials?: ProductPricingMaterial[] | null;
}

export interface ProductPricingPrinter {
  id?: string | null;
  name?: string | null;
  power_watts?: NumberValue;
  maintenance_cost_per_hour?: NumberValue;
}

export interface ProductPricingType {
  id?: string | null;
  name?: string | null;
  multiplier?: NumberValue;
  fixed_cost?: NumberValue;
}

export interface ProductCalculatorSettings {
  default_error_percent?: NumberValue;
  electricity_price_kwh?: NumberValue;
}

export type ProductCalculationSnapshot = Record<string, unknown>;

export interface ProductPriceCalculationInput {
  components: ProductPricingComponent[];
  printTimeMinutes: number;
  printer?: ProductPricingPrinter | null;
  productType?: ProductPricingType | null;
  calculatorSettings?: ProductCalculatorSettings | null;
  oldSnapshot?: ProductCalculationSnapshot | null;
}

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function snapshotNumber(snapshot: ProductCalculationSnapshot | null | undefined, key: string): number {
  return toNumber(snapshot?.[key]);
}

export function calculateProductPrice({
  components,
  printTimeMinutes,
  printer,
  productType,
  calculatorSettings,
  oldSnapshot,
}: ProductPriceCalculationInput) {
  const errorPercent = toNumber(calculatorSettings?.default_error_percent);
  const wasteRate = Math.max(0, errorPercent / 100);
  const preparedMaterials: Array<{
    componentIndex: number;
    filament: ProductPricingFilament | null;
    filamentId: string;
    gramsPerUnit: number;
    gramsTotal: number;
  }> = [];

  const mode = components.length > 1 || (components.length === 1 && components[0]?.name !== "Producto completo")
    ? "components"
    : "simple_multifilament";

  components.forEach((component, componentIndex) => {
    const componentQuantity = toNumber(component.quantity_per_product, 1) || 1;
    for (const material of component.materials ?? []) {
      const gramsPerUnit = toNumber(material.grams);
      const filament = material.filament ?? null;
      preparedMaterials.push({
        componentIndex,
        filament,
        filamentId: filament?.id || material.filament_id || "",
        gramsPerUnit,
        gramsTotal: gramsPerUnit * componentQuantity,
      });
    }
  });

  const filamentPricing = calculateCalculatorFilamentPricing({
    lines: preparedMaterials.map((material) => {
      const totalGrams = toNumber(material.filament?.total_grams);
      const purchasePrice = toNumber(material.filament?.purchase_price);
      return {
        filamentId: material.filamentId,
        label: material.filament?.name || "Filamento",
        grams: material.gramsTotal,
        costPerKg: totalGrams > 0 ? (purchasePrice / totalGrams) * 1000 : 0,
      };
    }),
    wasteRate,
  });

  const processedComponents = components.map((component, componentIndex) => {
    const componentQuantity = toNumber(component.quantity_per_product, 1) || 1;
    const materials = preparedMaterials
      .map((material, materialIndex) => ({ material, materialIndex }))
      .filter(({ material }) => material.componentIndex === componentIndex)
      .map(({ material, materialIndex }) => {
        const pricedLine = filamentPricing.filamentLines[materialIndex];
        return {
          filament_id: material.filamentId || null,
          filament_name: material.filament?.name || null,
          grams: material.gramsPerUnit,
          grams_total: material.gramsTotal,
          grams_with_error: material.gramsTotal * (1 + wasteRate),
          filament_purchase_price: toNumber(material.filament?.purchase_price) || null,
          filament_total_grams: toNumber(material.filament?.total_grams) || null,
          filament_cost_per_gram: pricedLine ? pricedLine.costPerKg / 1000 : null,
          material_cost: pricedLine ? pricedLine.filamentCost * (1 + wasteRate) : 0,
        };
      });

    return {
      component_id: component.id || null,
      name: component.name || "Producto completo",
      quantity_per_product: componentQuantity,
      materials,
    };
  });

  const processedMaterials = processedComponents.flatMap((component) => component.materials);
  const totalHours = Math.max(0, toNumber(printTimeMinutes)) / 60;
  const kwhPrice = toNumber(
    calculatorSettings?.electricity_price_kwh,
    snapshotNumber(oldSnapshot, "kwhPrice"),
  );
  const powerWatts = toNumber(printer?.power_watts, snapshotNumber(oldSnapshot, "printer_consumption_watts"));
  const maintenanceCostPerHour = toNumber(
    printer?.maintenance_cost_per_hour,
    snapshotNumber(oldSnapshot, "maintenance_cost_per_hour"),
  );
  const electricityCost = totalHours * (powerWatts / 1000) * kwhPrice;
  const maintenanceCost = totalHours * maintenanceCostPerHour;
  const fixedCost = toNumber(productType?.fixed_cost, snapshotNumber(oldSnapshot, "fixed_cost"));
  const laborCost = snapshotNumber(oldSnapshot, "labor_cost");
  const otherCost = snapshotNumber(oldSnapshot, "other_costs");
  const multiplier = toNumber(productType?.multiplier, snapshotNumber(oldSnapshot, "multiplier")) || 1;

  const pricing = calculateCalculatorPricing({
    filamentCost: filamentPricing.filamentCostWithWaste,
    electricityCost,
    maintenanceCost,
    fixedCost,
    multiplier,
    laborCost,
    otherCost,
  });

  const snapshot: ProductCalculationSnapshot = {
    ...(oldSnapshot ?? {}),
    source: "product_editor",
    mode,
    components: processedComponents,
    materials: processedMaterials,
    grams: filamentPricing.totalFilamentGrams,
    grams_with_error: filamentPricing.totalFilamentGrams * (1 + wasteRate),
    total_grams: filamentPricing.totalFilamentGrams,
    total_grams_with_error: filamentPricing.totalFilamentGrams * (1 + wasteRate),
    error_percent: errorPercent,
    print_time_minutes: printTimeMinutes,
    material_cost: filamentPricing.filamentCostWithWaste,
    electricity_cost: electricityCost,
    maintenance_cost: maintenanceCost,
    fixed_cost: fixedCost,
    fixed_cost_overhead_rate: pricing.fixedCostOverheadRate,
    fixed_cost_overhead_amount: pricing.fixedCostOverheadAmount,
    fixed_cost_adjusted: pricing.fixedCostAdjusted,
    labor_cost: laborCost,
    other_costs: otherCost,
    other_costs_overhead_rate: pricing.otherCostsOverheadRate,
    other_costs_overhead_amount: pricing.otherCostsOverheadAmount,
    other_costs_adjusted: pricing.otherCostsAdjusted,
    base_cost: pricing.baseCost,
    multiplier,
    sale_price: pricing.salePrice,
    profit: pricing.profit,
    filamentCostRaw: filamentPricing.filamentCostRaw,
    wasteRate,
    filamentCostWithWaste: filamentPricing.filamentCostWithWaste,
    otherCostsRaw: pricing.otherCostsRaw,
    otherCostsOverheadRate: pricing.otherCostsOverheadRate,
    otherCostsOverheadAmount: pricing.otherCostsOverheadAmount,
    otherCostsAdjusted: pricing.otherCostsAdjusted,
    baseCost: pricing.baseCost,
    salePrice: pricing.salePrice,
    filament_id: processedMaterials[0]?.filament_id || null,
    filament_name: processedMaterials[0]?.filament_name || null,
    printer_id: printer?.id || null,
    printer_name: printer?.name || null,
    printer_power_watts: toNumber(printer?.power_watts) || null,
    printer_maintenance_cost_per_hour: toNumber(printer?.maintenance_cost_per_hour) || null,
    product_type_id: productType?.id || null,
    product_type_name: productType?.name || null,
    product_type_multiplier: toNumber(productType?.multiplier) || null,
    product_type_fixed_cost: toNumber(productType?.fixed_cost) || null,
  };

  return {
    isValid: filamentPricing.isValid,
    gramsWithError: filamentPricing.totalFilamentGrams * (1 + wasteRate),
    materialCost: filamentPricing.filamentCostWithWaste,
    electricityCost,
    maintenanceCost,
    fixedCost,
    baseCost: pricing.baseCost,
    salePrice: pricing.salePrice,
    profit: pricing.profit,
    snapshot,
    multiplier,
  };
}
