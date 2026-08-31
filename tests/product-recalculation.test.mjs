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

const calculatorPricing = loadTypeScriptModule(
  path.join(root, "src/lib/calculator/pricing.ts"),
);
const { calculateProductPrice } = loadTypeScriptModule(
  path.join(root, "src/lib/products/pricing.ts"),
  { "@/lib/calculator/pricing": calculatorPricing },
);

test("product pricing uses every component and filament through the shared calculator engine", () => {
  const result = calculateProductPrice({
    components: [
      {
        id: "component-a",
        name: "Cuerpo",
        quantity_per_product: 2,
        materials: [{
          filament_id: "filament-a",
          grams: 100,
          filament: { id: "filament-a", name: "PLA", purchase_price: 10_000, total_grams: 1_000 },
        }],
      },
      {
        id: "component-b",
        name: "Detalle",
        quantity_per_product: 1,
        materials: [{
          filament_id: "filament-b",
          grams: 50,
          filament: { id: "filament-b", name: "PETG", purchase_price: 20_000, total_grams: 1_000 },
        }],
      },
    ],
    printTimeMinutes: 120,
    printer: { id: "printer", name: "Printer", power_watts: 200, maintenance_cost_per_hour: 30 },
    productType: { id: "type", name: "Minorista", multiplier: 3, fixed_cost: 100 },
    calculatorSettings: { default_error_percent: 5, electricity_price_kwh: 100 },
    oldSnapshot: { labor_cost: 50, other_costs: 100 },
  });

  assert.equal(result.isValid, true);
  assert.equal(result.materialCost, 3_150);
  assert.equal(result.baseCost, 3_560);
  assert.equal(result.salePrice, 9_860);
  assert.equal(result.snapshot.source, "product_editor");
  assert.equal(result.snapshot.materials.length, 2);
  assert.equal(result.snapshot.materials[0].grams_total, 200);
});

test("recalculation actions authorize ownership and reload the complete recipe on the server", () => {
  const actions = fs.readFileSync(path.join(root, "src/app/productos/actions.ts"), "utf8");

  assert.match(actions, /getCurrentUserAccess\(supabase\)/);
  assert.match(actions, /\.eq\("user_id", userId\)/);
  assert.match(actions, /from\("product_components"\)/);
  assert.match(actions, /from\("product_component_filaments"\)/);
  assert.doesNotMatch(actions, /product_components[\s\S]{0,250}\.limit\(1\)/);
  assert.match(actions, /for \(const product of context\.products\)/);
  assert.match(actions, /calculateProductPrice\(/);
});

test("products UI exposes individual and batch recalculation with Stampa feedback", () => {
  const page = fs.readFileSync(path.join(root, "src/app/productos/page.tsx"), "utf8");

  assert.match(page, /title="Recalcular precio"/);
  assert.match(page, /Recalcular Todos/);
  assert.match(page, /confirmAction\(\{/);
  assert.match(page, /Precio recalculado correctamente\./);
  assert.doesNotMatch(page, /window\.confirm|\bconfirm\(/);
});
