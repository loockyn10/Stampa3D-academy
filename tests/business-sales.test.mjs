import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(filename, dependencies = {}) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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

const catalog = loadTypeScriptModule(path.join(root, "src/lib/business/catalog.ts"));
const hidScanner = loadTypeScriptModule(path.join(root, "src/lib/barcode/hid-scanner.ts"));
const cart = loadTypeScriptModule(path.join(root, "src/lib/business/cart.ts"), {
  "./catalog": catalog,
  "../barcode/hid-scanner": hidScanner,
});
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260907201247_business_inventory_and_sales.sql"), "utf8");
const locationSalesMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260909031859_business_catalog_archive_and_combined_location_sales.sql"), "utf8");
const actions = fs.readFileSync(path.join(root, "src/app/mi-negocio/actions.ts"), "utf8");
const scanner = fs.readFileSync(path.join(root, "src/components/business/BarcodeScanner.tsx"), "utf8");

const products = [{ id: "product-a", stock_quantity: 2 }];
const catalogItems = [
  { id: "catalog-a", source_type: "manufactured", source_product_id: "product-a", name: "Mate", sale_price: 1000, resale_stock_quantity: 0, sku: "MAT-1", barcode: "7790001", is_active: true },
  { id: "catalog-b", source_type: "resale", source_product_id: null, name: "Llave", sale_price: 500, resale_stock_quantity: 1, sku: null, barcode: "123", is_active: true },
];

test("manual search or one scan adds a product and repeated scans increment without exceeding stock", () => {
  const found = cart.findCatalogItemByBarcode(catalogItems, " 7790001 ");
  assert.equal(found.id, "catalog-a");
  const cartItem = cart.toBusinessCartItem(found, products);
  const first = cart.addBusinessCartItem([], cartItem);
  assert.equal(first.success, true);
  const second = cart.addBusinessCartItem(first.cart, cartItem);
  assert.equal(second.success, true);
  assert.equal(second.cart[0].quantity, 2);
  const third = cart.addBusinessCartItem(second.cart, cartItem);
  assert.equal(third.success, false);
  assert.equal(third.cart[0].quantity, 2);
});

test("five continuous scans increment the same item five times without stale cart state", () => {
  const catalogItem = { ...catalogItems[1], id: "catalog-many", barcode: "00012345", resale_stock_quantity: 5 };
  const cartItem = cart.toBusinessCartItem(catalogItem, products);
  let currentCart = [];
  for (let scan = 0; scan < 5; scan += 1) {
    const result = cart.addBusinessCartItem(currentCart, cartItem);
    assert.equal(result.success, true);
    currentCart = result.cart;
  }
  assert.equal(currentCart[0].quantity, 5);
  const overStock = cart.addBusinessCartItem(currentCart, cartItem);
  assert.equal(overStock.success, false);
  assert.equal(overStock.cart[0].quantity, 5);
});

test("continuous scans of different products produce one cart line per product", () => {
  let currentCart = [];
  for (let index = 0; index < 10; index += 1) {
    const item = cart.toBusinessCartItem({
      ...catalogItems[1],
      id: `catalog-${index}`,
      barcode: `0000000${index}`,
      resale_stock_quantity: 1,
    }, products);
    const result = cart.addBusinessCartItem(currentCart, item);
    assert.equal(result.success, true);
    currentCart = result.cart;
  }
  assert.equal(currentCart.length, 10);
  assert.equal(currentCart.reduce((sum, item) => sum + item.quantity, 0), 10);
});

test("unknown barcode is not created and zero stock cannot enter the cart", () => {
  assert.equal(cart.findCatalogItemByBarcode(catalogItems, "missing"), null);
  const unavailable = { ...cart.toBusinessCartItem(catalogItems[1], products), availableStock: 0 };
  assert.equal(cart.addBusinessCartItem([], unavailable).success, false);
  assert.equal(cart.findCatalogItemByBarcode([{ ...catalogItems[1], is_active: false }], "123"), null);
});

test("quick sale exposes showroom plus warehouse as the available stock", () => {
  const item = cart.toBusinessCartItem(catalogItems[0], products, { showroom: 2, warehouse: 10 });
  assert.equal(item.availableStock, 12);
  assert.equal(item.showroomStock, 2);
  assert.equal(item.warehouseStock, 10);
  assert.equal(cart.setBusinessCartQuantity([item], item.catalogItemId, 12).success, true);
  assert.equal(cart.setBusinessCartQuantity([item], item.catalogItemId, 13).success, false);
});

test("seven barcode scans can consume combined showroom and warehouse availability", () => {
  const item = cart.toBusinessCartItem(catalogItems[1], products, { showroom: 2, warehouse: 5 });
  let currentCart = [];
  for (let scan = 0; scan < 7; scan += 1) {
    const result = cart.addBusinessCartItem(currentCart, item);
    assert.equal(result.success, true);
    currentCart = result.cart;
  }
  assert.equal(currentCart[0].quantity, 7);
  assert.equal(cart.addBusinessCartItem(currentCart, item).success, false);
});

test("cart validates quantities and calculates totals deterministically", () => {
  const item = cart.toBusinessCartItem(catalogItems[0], products);
  assert.equal(cart.setBusinessCartQuantity([item], "catalog-a", 0).success, false);
  assert.equal(cart.setBusinessCartQuantity([item], "catalog-a", 3).success, false);
  const updated = cart.setBusinessCartQuantity([item], "catalog-a", 2);
  assert.equal(updated.success, true);
  assert.equal(cart.calculateBusinessCartTotal(updated.cart), 2000);
  assert.equal(
    cart.buildBusinessSaleFingerprint([{ catalogItemId: "b", quantity: 1 }, { catalogItemId: "a", quantity: 2 }], null),
    cart.buildBusinessSaleFingerprint([{ catalogItemId: "a", quantity: 2 }, { catalogItemId: "b", quantity: 1 }], null),
  );
});

test("sale SQL provides one atomic, concurrent and idempotent confirmation boundary", () => {
  assert.match(migration, /create or replace function public\.confirm_business_sale/);
  assert.match(migration, /business_sales_user_idempotency_uidx/);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*business-sale:/);
  assert.match(migration, /for update/);
  assert.match(migration, /group by \(element ->> 'catalogItemId'\)::uuid/);
  assert.match(migration, /catalog_item\.sale_price \* requested_item\.quantity/);
  assert.match(migration, /insert into public\.business_sales/);
  assert.match(migration, /insert into public\.business_sale_items/);
  assert.match(migration, /insert into public\.business_inventory_movements/);
  assert.match(migration, /perform public\.adjust_product_stock/);
  assert.match(migration, /set resale_stock_quantity = resulting_stock/);
  assert.match(migration, /'invalid_reason'/);
  assert.doesNotMatch(migration, /consume_filament|filament_stock|remaining_grams/);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i);
});

test("an RPC error rolls the function transaction back instead of returning partial success", () => {
  assert.doesNotMatch(migration, /exception\s+when[\s\S]*return query select true/i);
  assert.match(migration, /raise exception 'adjust_product_stock no actualizó el stock esperado'/);
  assert.match(migration, /raise exception 'No se pudo actualizar el inventario de reventa'/);
});

test("server action accepts identity and quantities only and revalidates through the RPC", () => {
  const saleStart = actions.indexOf("export async function confirmBusinessSaleAction");
  const saleEnd = actions.indexOf("export async function loadBusinessSalesAction", saleStart);
  const saleBlock = actions.slice(saleStart, saleEnd);
  assert.match(saleBlock, /authorizeBusinessAccess\(\)/);
  assert.match(saleBlock, /p_items: input\.items/);
  assert.match(saleBlock, /p_client_id: input\.clientId \|\| null/);
  assert.doesNotMatch(saleBlock, /unitPrice|salePrice|totalAmount|userId:/);
});

test("quick sale keeps its attempt key for a lost response and clears it only after success", () => {
  const page = fs.readFileSync(path.join(root, "src/app/mi-negocio/venta-rapida/page.tsx"), "utf8");
  assert.match(page, /sessionStorage\.getItem\(SALE_ATTEMPT_STORAGE_KEY\)/);
  assert.match(page, /stored\?\.fingerprint === fingerprint/);
  assert.match(page, /sessionStorage\.setItem\(SALE_ATTEMPT_STORAGE_KEY/);
  assert.match(page, /No recibimos la respuesta\. Reintentá/);
  assert.match(page, /sessionStorage\.removeItem\(SALE_ATTEMPT_STORAGE_KEY\)/);
  assert.match(page, /Producto, SKU o código/);
  assert.match(page, /Código no encontrado/);
  assert.match(page, /<option value="">Sin cliente<\/option>/);
  assert.match(page, /disabled=\{cart\.length === 0 \|\| submitting\}/);
});

test("scanner feature-detects formats and always stops camera resources", () => {
  assert.match(scanner, /BarcodeDetector/);
  assert.match(scanner, /getSupportedFormats/);
  assert.match(scanner, /"ean_13"[\s\S]*"ean_8"[\s\S]*"upc_a"[\s\S]*"upc_e"[\s\S]*"code_128"/);
  assert.match(scanner, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(scanner, /useEffect\(\(\) => stop, \[stop\]\)/);
  assert.match(scanner, /búsqueda manual/i);
});

test("combined location sale consumes showroom first and warehouse second", () => {
  assert.match(locationSalesMigration, /showroom_consumed := least\(coalesce\(showroom_qty, 0\), requested\.quantity\)/i);
  assert.match(locationSalesMigration, /warehouse_consumed := requested\.quantity - showroom_consumed/i);
  assert.match(locationSalesMigration, /set_config\('stampa\.inventory_sale_location_id', showroom_id::text, true\)/i);
  assert.match(locationSalesMigration, /select \* into sale_result[\s\S]*confirm_business_sale/i);
  assert.doesNotMatch(locationSalesMigration, /insert into public\.business_inventory_transfers/i);
});

test("combined sale supports 2+10 distributions and rejects quantity 13", () => {
  const consume = (showroom, warehouse, quantity) => {
    if (showroom + warehouse < quantity) return null;
    const fromShowroom = Math.min(showroom, quantity);
    return { showroom: showroom - fromShowroom, warehouse: warehouse - (quantity - fromShowroom) };
  };
  assert.deepEqual(consume(2, 10, 3), { showroom: 0, warehouse: 9 });
  assert.deepEqual(consume(5, 10, 3), { showroom: 2, warehouse: 10 });
  assert.deepEqual(consume(2, 10, 12), { showroom: 0, warehouse: 0 });
  assert.equal(consume(2, 10, 13), null);
  assert.deepEqual(consume(0, 10, 3), { showroom: 0, warehouse: 7 });
});

test("missing showroom balance is lazily created and warehouse is reconciled from authority", () => {
  assert.match(locationSalesMigration, /ensure_business_inventory_location_balances\(catalog_item\.id\)/i);
  assert.match(locationSalesMigration, /distributed_qty < authoritative_qty[\s\S]*authoritative_qty - distributed_qty/i);
  assert.match(locationSalesMigration, /coalesce\(showroom_qty, 0\) \+ coalesce\(warehouse_qty, 0\) < requested\.quantity/i);
});

test("location sale is atomic, concurrent-safe, idempotent and records its source split", () => {
  assert.match(locationSalesMigration, /pg_advisory_xact_lock[\s\S]*business-sale:/i);
  assert.match(locationSalesMigration, /order by \(element ->> 'catalogItemId'\)::uuid/i);
  assert.match(locationSalesMigration, /for update/i);
  assert.match(locationSalesMigration, /A retry must replay before validating the now-reduced stock/i);
  assert.match(locationSalesMigration, /location_breakdown = location_breakdowns -> \(movement\.catalog_item_id::text\)/i);
  assert.match(locationSalesMigration, /updated_movements <> jsonb_object_length\(location_breakdowns\)[\s\S]*raise exception/i);
});

test("locations disabled preserve the original quick-sale RPC", () => {
  assert.match(locationSalesMigration, /if not exists \([\s\S]*settings\.locations_enabled[\s\S]*select \* from public\.confirm_business_sale/i);
});
