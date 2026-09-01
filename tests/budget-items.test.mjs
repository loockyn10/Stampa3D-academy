import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadBudgetItemsModule() {
  const filename = path.join(root, "src/lib/budgets/items.ts");
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
    () => { throw new Error("The budget item module must stay dependency-free"); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const budgetItems = loadBudgetItemsModule();

test("catalog and inline products build the same complete budget item", () => {
  const product = {
    id: "product-1",
    name: "Mate multifilamento",
    base_cost: 325.5,
    sale_price: 900,
    calculation_snapshot: { mode: "simple_multifilament", materials: [{}, {}] },
  };

  const result = budgetItems.buildBudgetItemFromProduct(product, 3, "temp-1");
  assert.equal(result.success, true);
  assert.deepEqual(result.item, {
    id: "temp-1",
    product_id: "product-1",
    item_name: "Mate multifilamento",
    quantity: 3,
    unit_price: 900,
    subtotal: 2700,
    unit_base_cost: 325.5,
    unit_profit: 574.5,
    total_profit: 1723.5,
  });
});

test("missing product economics are rejected instead of replaced with zero", () => {
  const missingCost = budgetItems.buildBudgetItemFromProduct({
    id: "product-2",
    name: "Producto incompleto",
    base_cost: null,
    sale_price: 1000,
  });
  const missingPrice = budgetItems.buildBudgetItemFromProduct({
    id: "product-3",
    name: "Producto incompleto",
    base_cost: 500,
    sale_price: null,
  });

  assert.equal(missingCost.success, false);
  assert.match(missingCost.error, /costo del producto/i);
  assert.equal(missingPrice.success, false);
  assert.match(missingPrice.error, /precio de venta/i);
});

test("a persisted zero cost remains valid and changing price recalculates profit", () => {
  const result = budgetItems.normalizeBudgetItemEconomics({
    id: "item-1",
    product_id: "product-4",
    item_name: "Muestra",
    quantity: 2,
    unit_price: 250,
    unit_base_cost: 0,
  });

  assert.equal(result.success, true);
  assert.equal(result.item.subtotal, 500);
  assert.equal(result.item.unit_profit, 250);
  assert.equal(result.item.total_profit, 500);
});

test("the inline creation path uses the shared builder before appending", () => {
  const source = fs.readFileSync(path.join(root, "src/app/presupuestos/page.tsx"), "utf8");
  const inlineSave = source.slice(source.indexOf("const handleSaveProduct"));

  assert.match(inlineSave, /buildBudgetItemFromProduct\(data\)/);
  assert.match(source, /const normalizedItems = \[\]/);
  assert.doesNotMatch(source, /unit_base_cost: item\.unit_base_cost \?\? null/);
});
