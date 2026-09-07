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

const budgetContext = {
  page: { section: "budgets", route: "/presupuestos", title: "Presupuestos" },
  formState: {
    kind: "budgetDraft",
    budgetType: "professional",
    title: "Presupuesto Lucas",
    validUntil: "2026-09-14",
    client: { id: "client-1", name: "Lucas" },
    items: [
      { productId: "product-1", name: "Mate", quantity: 2, unitPrice: 8_000, estimatedProfit: 8_000 },
      { productId: "product-2", name: "Llavero", quantity: 10, unitPrice: 1_000, estimatedProfit: 2_000 },
    ],
    discountPercent: 0,
    taxRate: 0,
    additionalCharges: 0,
    summary: { subtotal: 26_000, discount: 0, tax: 0, total: 26_000, estimatedProfit: 10_000 },
    paymentMethod: "Transferencia",
    deliveryTime: "5 días hábiles",
  },
};

test("budget reports the current amount and a compact breakdown", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "¿Cuánto le estoy cobrando?",
    screenContext: budgetContext,
  });
  assert.equal(result.kind, "budget");
  assert.match(result.answer, /\$26\.000/);
  assert.match(result.answer, /subtotal/i);
});

test("budget calculates a discount scenario with the real totals helper", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "¿Qué pasa si descuento 10%?",
    screenContext: budgetContext,
  });
  assert.match(result.answer, /\$23\.400/);
  assert.match(result.answer, /No modifiqué el borrador/);
});

test("budget projects supported IVA without mutating the draft", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "Poné IVA 21%",
    screenContext: budgetContext,
  });
  assert.match(result.answer, /\$31\.460/);
  assert.match(result.answer, /No modifiqué el borrador/);
});

test("budget identifies the product with the lowest estimated margin", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "¿Qué producto me está dejando menos margen?",
    screenContext: budgetContext,
  });
  assert.match(result.answer, /Llavero/);
  assert.match(result.answer, /20%/);
});

test("budget lists missing professional fields instead of inventing them", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "¿Qué falta completar?",
    screenContext: {
      ...budgetContext,
      formState: {
        ...budgetContext.formState,
        client: null,
        items: [],
        paymentMethod: undefined,
        deliveryTime: undefined,
      },
    },
  });
  assert.match(result.answer, /cliente/);
  assert.match(result.answer, /producto/);
  assert.match(result.answer, /forma de pago/);
  assert.match(result.answer, /plazo de entrega/);
});

test("budget projects shipping charges but does not claim it changed the form", () => {
  const result = analysis.analyzeStampyScreenQuestion({
    message: "Agregá $5000 de envío",
    screenContext: budgetContext,
  });
  assert.match(result.answer, /\$31\.000/);
  assert.match(result.answer, /No modifiqué el borrador/);
});
