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
const actions = fs.readFileSync(path.join(root, "src/app/mi-negocio/actions.ts"), "utf8");
const catalogPage = fs.readFileSync(path.join(root, "src/app/mi-negocio/catalogo/page.tsx"), "utf8");

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

test("commercial display name adds brand once and preserves unbranded names", () => {
  assert.equal(catalog.getBusinessProductDisplayName({ brand: "W3D", name: "PLA Negro" }), "W3D PLA Negro");
  assert.equal(catalog.getBusinessProductDisplayName({ brand: "W3D", name: "W3D PLA Negro" }), "W3D PLA Negro");
  assert.equal(catalog.getBusinessProductDisplayName({ brand: "w3d", name: "W3D-PLA Negro" }), "W3D-PLA Negro");
  assert.equal(catalog.getBusinessProductDisplayName({ brand: null, name: "Mate Messi" }), "Mate Messi");
});

test("migration prevents duplicate links and separates commercial stock", () => {
  assert.match(migration, /unique index if not exists business_catalog_items_user_source_product_uidx/i);
  assert.match(migration, /source_type in \('manufactured', 'resale'\)/i);
  assert.match(migration, /source_type = 'manufactured'[\s\S]*resale_stock_quantity = 0/i);
  assert.match(migration, /source_type = 'resale'[\s\S]*source_product_id is null/i);
  assert.match(migration, /public\.has_platform_access\(auth\.uid\(\)\)/i);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i);
});

test("catalog delete is an owned soft archive and never deletes the workshop product", () => {
  const start = actions.indexOf("export async function archiveBusinessCatalogItemAction");
  const block = actions.slice(start);
  assert.match(block, /authorizeBusinessAccess\(\)/);
  assert.match(block, /\.from\("business_catalog_items"\)[\s\S]*\.update\(\{ is_active: false, is_published: false \}\)/);
  assert.match(block, /\.eq\("user_id", authorized\.userId\)/);
  assert.match(block, /\.select\("id, source_type"\)[\s\S]*\.maybeSingle\(\)/);
  assert.doesNotMatch(block, /\.from\("products"\)[\s\S]*\.(delete|update)\(/);
  assert.doesNotMatch(block, /\.delete\(/);
});

test("catalog cards always expose Delete through the shared custom Dialog", () => {
  assert.match(catalogPage, /<Trash2 size=\{14\} \/> Eliminar/);
  assert.match(catalogPage, /<Dialog open=\{deleteItem !== null\}/);
  assert.match(catalogPage, /Esta acción lo quitará de Mi Negocio\./);
  assert.match(catalogPage, /El producto seguirá existiendo en Mi Taller/);
  assert.doesNotMatch(catalogPage, /\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/);
});

test("catalog cards expose Edit and preload a metadata-only editor", () => {
  assert.match(catalogPage, /<Pencil size=\{14\}[\s\S]*Editar/);
  assert.match(catalogPage, /<Dialog open=\{editItem !== null\}/);
  assert.match(catalogPage, /Nombre comercial[\s\S]*Marca[\s\S]*Categoría[\s\S]*Precio de venta/);
  assert.match(catalogPage, /Estos cambios no modifican el stock ni sus movimientos/);
});

test("manufactured and resale creation restore archived rows instead of inserting duplicates", () => {
  const resaleStart = actions.indexOf("export async function createResaleCatalogItemAction");
  const manufacturedStart = actions.indexOf("export async function linkManufacturedProductAction");
  const operationsStart = actions.indexOf("export async function loadBusinessOperationsAction");
  const resaleBlock = actions.slice(resaleStart, manufacturedStart);
  const manufacturedBlock = actions.slice(manufacturedStart, operationsStart);
  assert.match(resaleBlock, /\.eq\("source_type", "resale"\)[\s\S]*equivalentRows[\s\S]*candidate\.is_active/);
  assert.match(resaleBlock, /archivedMatches\.length === 1[\s\S]*\.update\(\{ is_active: true \}\)[\s\S]*restored: true/);
  assert.match(manufacturedBlock, /\.eq\("source_product_id", product\.id\)[\s\S]*existingCatalogItem\?\.is_active/);
  assert.match(manufacturedBlock, /\.update\(\{ is_active: true \}\)[\s\S]*\.eq\("id", existingCatalogItem\.id\)[\s\S]*restored: true/);
});

test("catalog edit updates commercial metadata without touching stock, balances or movements", () => {
  const start = actions.indexOf("export async function updateBusinessCatalogItemAction");
  const end = actions.indexOf("export async function archiveBusinessCatalogItemAction", start);
  const block = actions.slice(start, end);
  const mutation = block.slice(block.indexOf(".update({"), block.indexOf(".eq(\"id\", currentItem.id)"));
  for (const field of ["name", "category", "brand", "description", "purchase_cost", "sale_price", "sku", "barcode", "supplier", "image_urls"]) {
    assert.match(mutation, new RegExp(`${field}:?`));
  }
  assert.doesNotMatch(mutation, /resale_stock_quantity|stock_quantity|location|movement|source_product_id/);
  assert.match(block, /\.eq\("user_id", authorized\.userId\)/);
});

test("archived catalog items disappear from operational loaders and historical rows remain untouched", () => {
  assert.match(actions, /\.from\("business_catalog_items"\)[\s\S]*\.eq\("is_active", true\)/);
  assert.doesNotMatch(actions.slice(actions.indexOf("archiveBusinessCatalogItemAction")), /business_sale_items[\s\S]*\.(?:delete|update)\(/);
  assert.match(migration, /business_catalog_items_user_barcode_uidx[\s\S]*where barcode is not null/i);
});
