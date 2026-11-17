import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadPricingModule() {
  const filename = path.join(root, "src/lib/calculator/pricing.ts");
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    () => {
      throw new Error("Pricing helper must not have runtime dependencies");
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const {
  aggregateCalculatorRecipeLines,
  calculateCalculatorFilamentPricing,
  calculateCalculatorPricing,
  normalizeSuppliesContingencyPercent,
  DEFAULT_SUPPLIES_CONTINGENCY_PERCENT,
} = loadPricingModule();
const pricingModule = loadPricingModule();

// D058: los insumos se suman a su costo real. Sin recargo automático del 30 %; contingencias opcionales (0 % por defecto).

test("markup applies only to filament and type extras are added at their real cost (no 30 percent surcharge)", () => {
  const result = calculateCalculatorPricing({
    filamentCost: 500,
    electricityCost: 80,
    maintenanceCost: 120,
    fixedCost: 2_000,
    multiplier: 4,
  });

  assert.equal(DEFAULT_SUPPLIES_CONTINGENCY_PERCENT, 0);
  assert.equal(pricingModule.OTHER_COSTS_OVERHEAD_RATE, undefined, "the fixed 30 % rate no longer exists");
  assert.equal(pricingModule.FIXED_COST_OVERHEAD_RATE, undefined);
  assert.equal(result.fixedCostOverheadAmount, 0);
  assert.equal(result.suppliesContingencyAmount, 0);
  assert.equal(result.fixedCostAdjusted, 2_000);
  assert.equal(result.baseCost, 2_700);
  assert.equal(result.realCost, 2_700);
  assert.equal(result.salePrice, 4_200);
  assert.notEqual(result.salePrice, 4_800, "the previous 30 % result is gone");
  assert.notEqual(result.salePrice, 10_800, "the markup never applies to type extras");
});

test("multiplier one keeps sale price equal to base cost", () => {
  const result = calculateCalculatorPricing({
    filamentCost: 500,
    electricityCost: 80,
    maintenanceCost: 120,
    fixedCost: 2_000,
    multiplier: 1,
  });

  assert.equal(result.baseCost, 2_700);
  assert.equal(result.salePrice, 2_700);
});

test("zero fixed inputs add no contingency", () => {
  const result = calculateCalculatorPricing({
    filamentCost: 500,
    electricityCost: 80,
    maintenanceCost: 120,
    fixedCost: 0,
    multiplier: 4,
    suppliesContingencyPercent: 5,
  });

  assert.equal(result.fixedCostOverheadAmount, 0);
  assert.equal(result.suppliesContingencyAmount, 0);
  assert.equal(result.baseCost, 700);
  assert.equal(result.salePrice, 2_200);
});

test("electricity and maintenance remain additive and are never multiplied", () => {
  const result = calculateCalculatorPricing({
    filamentCost: 500,
    electricityCost: 0,
    maintenanceCost: 0,
    fixedCost: 2_000,
    multiplier: 4,
  });

  assert.equal(result.baseCost, 2_500);
  assert.equal(result.salePrice, 4_000);
});

test("high and decimal fixed inputs keep their real value and never get the markup", () => {
  const highFixed = calculateCalculatorPricing({
    filamentCost: 100,
    electricityCost: 10,
    maintenanceCost: 20,
    fixedCost: 10_000,
    multiplier: 8,
  });
  assert.equal(highFixed.fixedCostAdjusted, 10_000);
  assert.equal(highFixed.salePrice, 10_830);

  const decimalFixed = calculateCalculatorPricing({
    filamentCost: 0,
    electricityCost: 0,
    maintenanceCost: 0,
    fixedCost: 123.45,
    multiplier: 4,
  });
  assert.equal(decimalFixed.fixedCostOverheadAmount, 0);
  assert.equal(decimalFixed.fixedCostAdjusted, 123.45);
  assert.equal(decimalFixed.salePrice, 123.45);
});

test("labor and other manual costs stay additive: no surcharge, no contingency, no markup", () => {
  const result = calculateCalculatorPricing({
    filamentCost: 100,
    electricityCost: 10,
    maintenanceCost: 20,
    fixedCost: 0,
    multiplier: 4,
    laborCost: 50,
    otherCost: 25,
    suppliesContingencyPercent: 5,
  });

  assert.equal(result.otherCostsRaw, 25);
  assert.equal(result.otherCostsOverheadAmount, 0, "contingencies apply only to supplies, not to other costs");
  assert.equal(result.baseCost, 205);
  assert.equal(result.salePrice, 505);
});

test("supply contingency: $1.500 at 0 % stays $1.500 and at 5 % becomes $1.575", () => {
  const base = { filamentCost: 0, electricityCost: 0, maintenanceCost: 0, fixedCost: 1_500, multiplier: 3 };
  const zero = calculateCalculatorPricing({ ...base, suppliesContingencyPercent: 0 });
  assert.equal(zero.otherCostsAdjusted, 1_500);
  assert.equal(zero.baseCost, 1_500);
  assert.equal(zero.salePrice, 1_500);

  const five = calculateCalculatorPricing({ ...base, suppliesContingencyPercent: 5 });
  assert.equal(five.suppliesContingencyBase, 1_500);
  assert.equal(five.suppliesContingencyAmount, 75);
  assert.equal(five.otherCostsAdjusted, 1_575);
  assert.equal(five.baseCost, 1_575);
  assert.equal(five.realCost, 1_500, "real cost excludes contingencies");
  assert.equal(five.salePrice, 1_575, "contingencies never receive the markup");
  assert.notEqual(five.salePrice, 1_950, "never the previous 30 %");

  // Same result whether the supply comes from the type extras or the catalog (one rule, applied once).
  const catalog = calculateCalculatorPricing({ ...base, fixedCost: 0, suppliesCost: 1_500, suppliesContingencyPercent: 5 });
  assert.equal(catalog.baseCost, 1_575);
  assert.equal(catalog.salePrice, 1_575);
});

test("contingency percent is normalized: empty, negative or invalid values mean 0 %, capped at 100 %", () => {
  assert.equal(normalizeSuppliesContingencyPercent(undefined), 0);
  assert.equal(normalizeSuppliesContingencyPercent(null), 0);
  assert.equal(normalizeSuppliesContingencyPercent(""), 0);
  assert.equal(normalizeSuppliesContingencyPercent("abc"), 0);
  assert.equal(normalizeSuppliesContingencyPercent(-5), 0);
  assert.equal(normalizeSuppliesContingencyPercent("5"), 5);
  assert.equal(normalizeSuppliesContingencyPercent(250), 100);
  const negative = calculateCalculatorPricing({ filamentCost: 0, electricityCost: 0, maintenanceCost: 0, fixedCost: 1_000, multiplier: 1, suppliesContingencyPercent: -10 });
  assert.equal(negative.baseCost, 1_000);
});

test("contingency does not change printing costs nor the markup rule; profit and margin stay consistent", () => {
  const input = { filamentCost: 1_000, electricityCost: 200, maintenanceCost: 300, fixedCost: 1_000, suppliesCost: 500, multiplier: 3, laborCost: 400 };
  const zero = calculateCalculatorPricing(input);
  const five = calculateCalculatorPricing({ ...input, suppliesContingencyPercent: 5 });

  for (const result of [zero, five]) {
    assert.equal(result.filamentCost, 1_000);
    assert.equal(result.electricityCost, 200);
    assert.equal(result.maintenanceCost, 300);
    assert.equal(result.multipliableCost, 1_000);
    assert.equal(result.realCost, 1_000 + 200 + 300 + 1_000 + 500 + 400);
    assert.equal(result.profit, 2_000, "profit = filament × (markup − 1), unaffected by supplies or contingencies");
    assert.equal(result.salePrice - result.baseCost, result.profit);
    assert.equal(result.marginPercent, (result.profit / result.salePrice) * 100);
  }
  assert.equal(zero.baseCost, 3_400);
  assert.equal(zero.salePrice, 5_400);
  assert.equal(five.suppliesContingencyAmount, 75, "5 % of (type extras 1.000 + catalog 500), only once");
  assert.equal(five.baseCost, 3_475);
  assert.equal(five.salePrice, 5_475);
  assert.equal(five.baseCost - five.realCost, five.suppliesContingencyAmount, "contingency counted exactly once");
});

test("multiple filaments are summed before waste and markup", () => {
  const filamentPricing = calculateCalculatorFilamentPricing({
    lines: [
      { filamentId: "a", label: "PLA A", grams: 150, costPerKg: 10_000 },
      { filamentId: "b", label: "PLA B", grams: 25, costPerKg: 20_000 },
    ],
    wasteRate: 0.05,
  });
  const result = calculateCalculatorPricing({
    filamentCost: filamentPricing.filamentCostWithWaste,
    electricityCost: 60,
    maintenanceCost: 450,
    fixedCost: 0,
    otherCost: 1_800,
    multiplier: 3,
  });

  assert.equal(filamentPricing.totalFilamentGrams, 175);
  assert.equal(filamentPricing.filamentCostRaw, 2_000);
  assert.equal(filamentPricing.filamentCostWithWaste, 2_100);
  assert.equal(result.otherCostsOverheadAmount, 0);
  assert.equal(result.otherCostsAdjusted, 1_800);
  assert.equal(result.baseCost, 4_410);
  assert.equal(result.salePrice, 8_610);
  assert.notEqual(result.salePrice, result.baseCost * 3);
});

test("removing a filament line recalculates with the remaining line", () => {
  const twoLines = [
    { filamentId: "a", label: "PLA A", grams: 150, costPerKg: 10_000 },
    { filamentId: "b", label: "PLA B", grams: 25, costPerKg: 20_000 },
  ];
  const multiple = calculateCalculatorFilamentPricing({ lines: twoLines, wasteRate: 0 });
  const single = calculateCalculatorFilamentPricing({ lines: twoLines.slice(0, 1), wasteRate: 0 });

  assert.equal(multiple.filamentCostRaw, 2_000);
  assert.equal(single.totalFilamentGrams, 150);
  assert.equal(single.filamentCostRaw, 1_500);
});

test("every filament line requires a selection and positive grams", () => {
  const blankGrams = calculateCalculatorFilamentPricing({
    lines: [{ filamentId: "a", label: "PLA A", grams: 0, costPerKg: 10_000 }],
    wasteRate: 0,
  });
  const blankFilament = calculateCalculatorFilamentPricing({
    lines: [{ filamentId: "", label: "", grams: 50, costPerKg: 10_000 }],
    wasteRate: 0,
  });

  assert.equal(blankGrams.isValid, false);
  assert.equal(blankFilament.isValid, false);
});

test("manual cost per kg overrides every filament line", () => {
  const result = calculateCalculatorFilamentPricing({
    lines: [
      { filamentId: "a", label: "PLA A", grams: 100, costPerKg: 10_000 },
      { filamentId: "b", label: "PLA B", grams: 50, costPerKg: 20_000 },
    ],
    wasteRate: 0,
    manualCostPerKg: 30_000,
  });

  assert.deepEqual(result.filamentLines.map((line) => line.costPerKg), [30_000, 30_000]);
  assert.equal(result.filamentCostRaw, 4_500);
});

test("product recipe aggregates duplicate filament lines and preserves total grams", () => {
  const recipe = aggregateCalculatorRecipeLines([
    { filamentId: "a", grams: 150, filamentType: "PLA", color: "Azul" },
    { filamentId: "b", grams: 25, filamentType: "PLA", color: "Rojo" },
    { filamentId: "a", grams: 10, filamentType: "PLA", color: "Azul" },
  ]);

  assert.equal(recipe.length, 2);
  assert.equal(recipe[0].filamentId, "a");
  assert.equal(recipe[0].grams, 160);
  assert.equal(recipe.reduce((total, line) => total + line.grams, 0), 185);
});

test("calculator product snapshot keeps legacy keys and adds the new breakdown", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/calculadora/page.tsx"),
    "utf8",
  );

  for (const key of [
    "filamentCost",
    "electricityCost",
    "maintenanceCost",
    "fixedCostOverheadRate",
    "fixedCostOverheadAmount",
    "fixedCostAdjusted",
    "multiplier",
    "baseCost",
    "salePrice",
  ]) {
    assert.match(source, new RegExp(`${key}:`));
  }
  assert.match(source, /material_cost: calc\.materialCost/);
  assert.match(source, /fixed_cost: calc\.fixedCost/);
  assert.match(source, /base_cost: calc\.baseCost/);
  assert.match(source, /sale_price: calc\.normalPrice/);
  assert.match(source, /grams: calc\.totalFilamentGrams/);
  assert.match(source, /\.from\("product_components"\)/);
  assert.match(source, /\.from\("product_component_filaments"\)/);
  assert.match(source, /filamentLines: calc\.filamentLines/);
});

test("calculator summary stays compact while adjusted inputs remain internal", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/calculadora/page.tsx"),
    "utf8",
  );

  assert.match(source, />Insumos extra</);
  // D058: sin recargo fijo del 30 %; las contingencias solo se muestran si están configuradas.
  assert.doesNotMatch(source, /Recargo insumos 30%/);
  assert.doesNotMatch(source, /30 ?%/);
  assert.match(source, />Contingencias insumos /);
  assert.match(source, /suppliesContingencyPercent: accessMode === "paid" \? normalizeSuppliesContingencyPercent\(settings\?\.supplies_contingency_percent\) : 0/);
  assert.doesNotMatch(source, />Insumos ajustados</);
  assert.doesNotMatch(source, />Markup:<\/span>/);
  assert.doesNotMatch(source, /Precio sugerido = filamento con markup/);
  assert.match(source, /fixedCostAdjusted: calc\.fixedCostAdjusted/);
});
