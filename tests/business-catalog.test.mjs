import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(filename) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (request) => { throw new Error(`Unexpected dependency: ${request}`); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const catalog = loadTypeScriptModule(path.join(root, "src/lib/business/catalog.ts"));
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260907172205_business_catalog_foundation.sql"),
  "utf8",
);

const workshopProducts = [{
  id: "product-a",
  name: "Mate",
  description: null,
  base_cost: 100,
  sale_price: 300,
  stock_quantity: 7,
  image_url: null,
  is_active: true,
}];

test("manufactured catalog stock is always resolved from the workshop product", () => {
  const stock = catalog.resolveBusinessCatalogStock({
    source_type: "manufactured",
    source_product_id: "product-a",
    resale_stock_quantity: 999,
  }, workshopProducts);
  assert.equal(stock, 7);
});

test("resale catalog stock does not depend on workshop products", () => {
  const stock = catalog.resolveBusinessCatalogStock({
    source_type: "resale",
    source_product_id: null,
    resale_stock_quantity: 12,
  }, workshopProducts);
  assert.equal(stock, 12);
});

test("missing production source is visible instead of silently becoming zero", () => {
  assert.equal(catalog.resolveBusinessCatalogStock({
    source_type: "manufactured",
    source_product_id: "missing",
    resale_stock_quantity: 0,
  }, workshopProducts), null);
});

test("business inputs normalize money, stock and optional text deterministically", () => {
  assert.equal(catalog.normalizeBusinessMoney("19.999"), 20);
  assert.equal(catalog.normalizeBusinessMoney(-1), null);
  assert.equal(catalog.normalizeBusinessStock("3"), 3);
  assert.equal(catalog.normalizeBusinessStock("3.5"), null);
  assert.equal(catalog.normalizeOptionalBusinessText("  PLA   Azul  ", 80), "PLA Azul");
});

test("migration prevents duplicate links and separates commercial stock", () => {
  assert.match(migration, /unique index if not exists business_catalog_items_user_source_product_uidx/i);
  assert.match(migration, /source_type in \('manufactured', 'resale'\)/i);
  assert.match(migration, /source_type = 'manufactured'[\s\S]*resale_stock_quantity = 0/i);
  assert.match(migration, /source_type = 'resale'[\s\S]*source_product_id is null/i);
  assert.match(migration, /public\.has_platform_access\(auth\.uid\(\)\)/i);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i);
});
