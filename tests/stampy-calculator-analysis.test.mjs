import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(filename, dependencies = {}) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (request) => {
      if (request in dependencies) return dependencies[request];
      throw new Error(`Unexpected dependency: ${request}`);
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const pricing = loadTypeScriptModule(path.join(root, "src/lib/calculator/pricing.ts"));
const budgets = loadTypeScriptModule(path.join(root, "src/lib/budgets/calculation.ts"));
const analysis = loadTypeScriptModule(
  path.join(root, "src/lib/stampy/screen-analysis.ts"),
  {
    "@/lib/calculator/pricing": pricing,
    "@/lib/budgets/calculation": budgets,
  },
);

const calculatorContext = {
  page: { section: "calculator", route: "/calculadora", title: "Calculadora" },
  formState: {
    kind: "calculatorDraft",
    mode: "advanced",
    valid: true,
    printer: { id: "printer-1", name: "A1 Mini" },
    productType: "Minorista",
    filaments: [{ id: "filament-1", name: "PLA Negro", grams: 100, costPerKg: 10_000, cost: 1_000 }],
    timeMinutes: 300,
    printerPowerWatts: 200,
    electricityPriceKwh: 100,
    maintenanceCostPerHour: 50,
    wastePercent: 0,
    laborCost: 500,
    otherCost: 100,
    fixedCost: 0,
    multiplier: 3,
    result: {
      filamentCost: 1_000,
      electricityCost: 100,
      maintenanceCost: 250,
      // D058: otros costos a su valor real (sin el 30 % anterior).
      baseCost: 1_950,
      salePrice: 3_950,
      profit: 2_000,
      marketplacePrice: 4_500,
    },
  },
};

test("calculator explains the largest cost from the current typed draft", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "¿Qué parte del costo pesa más?",
    screenContext: calculatorContext,
  });
  assert.equal(result.kind, "calculator");
  assert.match(result.answer, /filamento/i);
  assert.match(result.answer, /\$1\.000/);
});

test("calculator reports current profit without calling OpenAI", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "¿Cuánto estoy ganando?",
    screenContext: calculatorContext,
  });
  assert.match(result.answer, /\$2\.000/);
  assert.match(result.answer, /50,6%/);
});

test("calculator runs added-time scenarios through the real pricing helper", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "¿Cuánto subiría si agrego 2 horas?",
    screenContext: calculatorContext,
  });
  assert.match(result.answer, /\$2\.090/);
  assert.match(result.answer, /\$4\.090/);
  assert.match(result.answer, /No modifiqué el cálculo/);
});

test("calculator scenarios keep catalog supplies and contingencies exactly once (never the old 30 %)", () => {
  // Insumos del catálogo 1.500 + contingencia 5 % (75) ya incluidos por el motor en el costo base.
  const draft = {
    ...calculatorContext.formState,
    otherCost: 0,
    result: { ...calculatorContext.formState.result, baseCost: 1_850 + 1_575, salePrice: 3_850 + 1_575, profit: 2_000 },
  };
  const result = analysis.analyzeStampyScreenQuestion({
    message: "¿Cuánto subiría si agrego 2 horas?",
    screenContext: { ...calculatorContext, formState: draft },
  });
  assert.match(result.answer, /\$3\.565/, "1.850 + 1.575 + 140 de impresión extra");
  assert.match(result.answer, /\$5\.565/);
  const largest = analysis.analyzeStampyScreenQuestion({ message: "¿Qué parte del costo pesa más?", screenContext: { ...calculatorContext, formState: draft } });
  assert.match(largest.answer, /insumos y otros costos/);
  assert.match(largest.answer, /\$1\.575/);
});

test("calculator converts a target margin into a compatible filament multiplier", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "¿Qué pasa si uso 40% de margen?",
    screenContext: calculatorContext,
  });
  assert.match(result.answer, /40%/);
  assert.match(result.answer, /No modifiqué el cálculo/);
});

test("calculator refuses analysis while required inputs are incomplete", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "¿Por qué me da tan caro?",
    screenContext: {
      ...calculatorContext,
      formState: { ...calculatorContext.formState, valid: false },
    },
  });
  assert.match(result.answer, /faltan datos/i);
});
