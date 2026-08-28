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

const { calculateCalculatorPricing, FIXED_COST_OVERHEAD_RATE } = loadPricingModule();

test("markup applies only to filament and fixed inputs receive a 30 percent overhead", () => {
  const result = calculateCalculatorPricing({
    filamentCost: 500,
    electricityCost: 80,
    maintenanceCost: 120,
    fixedCost: 2_000,
    multiplier: 4,
  });

  assert.equal(FIXED_COST_OVERHEAD_RATE, 0.3);
  assert.equal(result.fixedCostOverheadAmount, 600);
  assert.equal(result.fixedCostAdjusted, 2_600);
  assert.equal(result.baseCost, 3_300);
  assert.equal(result.salePrice, 4_800);
  assert.notEqual(result.salePrice, 10_800);
});

test("multiplier one keeps sale price equal to adjusted base cost", () => {
  const result = calculateCalculatorPricing({
    filamentCost: 500,
    electricityCost: 80,
    maintenanceCost: 120,
    fixedCost: 2_000,
    multiplier: 1,
  });

  assert.equal(result.baseCost, 3_300);
  assert.equal(result.salePrice, 3_300);
});

test("zero fixed inputs add no overhead", () => {
  const result = calculateCalculatorPricing({
    filamentCost: 500,
    electricityCost: 80,
    maintenanceCost: 120,
    fixedCost: 0,
    multiplier: 4,
  });

  assert.equal(result.fixedCostOverheadAmount, 0);
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

  assert.equal(result.baseCost, 3_100);
  assert.equal(result.salePrice, 4_600);
});

test("high and decimal fixed inputs receive exactly one overhead and no markup", () => {
  const highFixed = calculateCalculatorPricing({
    filamentCost: 100,
    electricityCost: 10,
    maintenanceCost: 20,
    fixedCost: 10_000,
    multiplier: 8,
  });
  assert.equal(highFixed.fixedCostAdjusted, 13_000);
  assert.equal(highFixed.salePrice, 13_830);

  const decimalFixed = calculateCalculatorPricing({
    filamentCost: 0,
    electricityCost: 0,
    maintenanceCost: 0,
    fixedCost: 123.45,
    multiplier: 4,
  });
  assert.ok(Math.abs(decimalFixed.fixedCostOverheadAmount - 37.035) < 1e-10);
  assert.ok(Math.abs(decimalFixed.fixedCostAdjusted - 160.485) < 1e-10);
  assert.ok(Math.abs(decimalFixed.salePrice - 160.485) < 1e-10);
});

test("existing advanced labor and other costs stay additive without markup", () => {
  const result = calculateCalculatorPricing({
    filamentCost: 100,
    electricityCost: 10,
    maintenanceCost: 20,
    fixedCost: 0,
    multiplier: 4,
    laborCost: 50,
    otherCost: 25,
  });

  assert.equal(result.baseCost, 205);
  assert.equal(result.salePrice, 505);
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
});

test("calculator summary stays compact while adjusted inputs remain internal", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/calculadora/page.tsx"),
    "utf8",
  );

  assert.match(source, />Insumos extra</);
  assert.match(source, />Recargo insumos 30%</);
  assert.doesNotMatch(source, />Insumos ajustados</);
  assert.doesNotMatch(source, />Markup:<\/span>/);
  assert.doesNotMatch(source, /Precio sugerido = filamento con markup/);
  assert.match(source, /fixedCostAdjusted: calc\.fixedCostAdjusted/);
});
