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

const hid = loadTypeScriptModule(path.join(root, "src/lib/barcode/hid-scanner.ts"));
const receipt = loadTypeScriptModule(path.join(root, "src/lib/business/stock-receipt.ts"), {
  "@/lib/barcode/hid-scanner": hid,
});
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260909063147_business_stock_receipt_barcodes.sql"), "utf8");
const actions = fs.readFileSync(path.join(root, "src/app/mi-negocio/actions.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "src/app/mi-negocio/catalogo/page.tsx"), "utf8");
const dialog = fs.readFileSync(path.join(root, "src/components/business/StockReceiptDialog.tsx"), "utf8");
const provider = fs.readFileSync(path.join(root, "src/components/barcode/BarcodeScannerProvider.tsx"), "utf8");

const base = {
  catalogItemId: "catalog-a",
  displayName: "W3D PLA Negro",
  category: "Filamentos",
  sourceType: "resale",
  isActive: true,
  unitWeightGrams: 1000,
};
const unit = { ...base, id: "unit-a", barcode: "00123456", barcodeType: "unit", unitsPerScan: 1 };
const box = { ...base, id: "case-a", barcode: "00999999", barcodeType: "case", unitsPerScan: 10 };

test("unit and case barcodes add one or their server-configured multiplier", () => {
  const one = receipt.addBusinessStockScan([], [unit, box], unit.barcode);
  assert.equal(one.success, true);
  assert.equal(receipt.getBusinessStockReceiptTotal(one.pending), 1);
  const ten = receipt.addBusinessStockScan([], [unit, box], box.barcode);
  assert.equal(ten.success, true);
  assert.equal(receipt.getBusinessStockReceiptTotal(ten.pending), 10);
});

test("fifteen continuous case scans produce 150 units without stale increments", () => {
  let pending = [];
  for (let scan = 0; scan < 15; scan += 1) {
    const result = receipt.addBusinessStockScan(pending, [unit, box], box.barcode);
    assert.equal(result.success, true);
    pending = result.pending;
  }
  assert.equal(pending[0].scanCount, 15);
  assert.equal(receipt.getBusinessStockReceiptTotal(pending), 150);
});

test("two boxes plus one unit aggregate to 21 while preserving both presentations", () => {
  let pending = [];
  for (const barcode of [box.barcode, unit.barcode, box.barcode]) {
    const result = receipt.addBusinessStockScan(pending, [unit, box], barcode);
    assert.equal(result.success, true);
    pending = result.pending;
  }
  assert.equal(pending.length, 2);
  assert.equal(receipt.getBusinessStockReceiptTotal(pending), 21);
});

test("continuous mixed scanning and leading zeroes remain exact", () => {
  const second = { ...box, id: "case-b", catalogItemId: "catalog-b", barcode: "00000002", displayName: "W3D PLA Blanco", unitsPerScan: 5 };
  let pending = [];
  for (const barcode of [box.barcode, box.barcode, second.barcode, unit.barcode, second.barcode]) {
    const result = receipt.addBusinessStockScan(pending, [unit, box, second], barcode);
    assert.equal(result.success, true);
    pending = result.pending;
  }
  assert.equal(receipt.getBusinessStockReceiptTotal(pending), 31);
  assert.equal(pending.find((item) => item.id === second.id).barcode, "00000002");
});

test("weight derives from real per-unit grams instead of assuming one kilogram", () => {
  assert.equal(receipt.getBusinessStockReceiptWeightKg(150, 1000), 150);
  assert.equal(receipt.getBusinessStockReceiptWeightKg(150, 500), 75);
  assert.equal(receipt.getBusinessStockReceiptWeightKg(20, null), null);
});

test("unknown, archived and manufactured barcodes never enter pending stock", () => {
  assert.deepEqual(receipt.addBusinessStockScan([], [unit], "UNKNOWN"), { success: false, reason: "unknown", barcode: "UNKNOWN" });
  assert.equal(receipt.addBusinessStockScan([], [{ ...unit, isActive: false }], unit.barcode).reason, "archived");
  assert.equal(receipt.addBusinessStockScan([], [{ ...unit, sourceType: "manufactured" }], unit.barcode).reason, "manufactured");
});

test("schema centralizes unit/case uniqueness across the user's catalog", () => {
  assert.match(migration, /create table if not exists public\.business_catalog_barcodes/i);
  assert.match(migration, /unique index if not exists business_catalog_barcodes_user_value_uidx[\s\S]*user_id, lower\(btrim\(barcode\)\)/i);
  assert.match(migration, /unique index if not exists business_catalog_barcodes_item_type_uidx/i);
  assert.match(migration, /not \(item\.id = new\.catalog_item_id and new\.barcode_type = 'unit'\)/i);
  assert.match(migration, /barcode_type = 'case' and units_per_scan between 2 and 100000/i);
});

test("receipt RPC resolves scans server-side and is atomic, owned and idempotent", () => {
  const start = migration.indexOf("create or replace function public.confirm_business_stock_receipt");
  const block = migration.slice(start);
  assert.match(block, /current_user_id uuid := auth\.uid\(\)/i);
  assert.match(block, /barcode\.user_id = current_user_id/i);
  assert.match(block, /item\.user_id = current_user_id[\s\S]*item\.is_active[\s\S]*item\.source_type = 'resale'/i);
  assert.match(block, /scanCount'[\s\S]*barcode\.units_per_scan/i);
  assert.match(block, /pg_advisory_xact_lock/i);
  assert.match(block, /operation_key = p_operation_key[\s\S]*reference = 'barcode_stock_receipt'/i);
  assert.match(block, /for update/i);
  assert.ok(block.indexOf("requested_item.quantity not between 1 and 100000") < block.indexOf("for requested in"));
  const mutationLoop = block.slice(block.indexOf("for requested in"), block.indexOf("end loop;", block.indexOf("for requested in")));
  assert.doesNotMatch(mutationLoop, /return query/);
  assert.match(block, /set resale_stock_quantity = resulting_stock[\s\S]*insert into public\.business_inventory_movements/i);
  assert.doesNotMatch(block, /exception when others/i);
});

test("positive resale delta is routed to warehouse by the existing location authority", () => {
  assert.match(migration, /set resale_stock_quantity = resulting_stock/i);
  const locationFix = fs.readFileSync(path.join(root, "supabase/migrations/20260909022450_fix_missing_business_location_balances.sql"), "utf8");
  assert.match(locationFix, /if p_delta > 0 then[\s\S]*location_type = 'warehouse'/i);
  assert.doesNotMatch(migration, /location_type = 'showroom'[\s\S]*set quantity = .*\+/i);
});

test("server action sends barcodes and scan counts, never trusted unit totals", () => {
  const start = actions.indexOf("export async function confirmBusinessStockReceiptAction");
  const block = actions.slice(start);
  const requestBlock = block.slice(0, block.indexOf("const { data, error }"));
  assert.match(block, /authorizeBusinessAccess\(\)/);
  assert.match(block, /p_scans: scans/);
  assert.match(block, /barcode, scanCount: scan\.scanCount/);
  assert.doesNotMatch(requestBlock, /unitsPerScan|totalUnits/);
});

test("stock dialog owns scans at maximum priority and preserves continuous state in a ref", () => {
  assert.match(dialog, /priority: 1_000/);
  assert.match(dialog, /allowWhenDialogOpen: true/);
  assert.match(dialog, /pendingRef\.current/);
  assert.match(provider, /handler\.enabled !== false/);
  assert.match(provider, /contextualHandler\?\.allowWhenDialogOpen !== true/);
  assert.match(page, /Cargar stock/);
});

test("unknown codes can be assigned or routed to the existing product creator", () => {
  assert.match(dialog, /Asignar y sumar/);
  assert.match(dialog, /Crear producto/);
  assert.match(dialog, /saveBusinessCatalogBarcodesAction/);
  assert.match(page, /createProductFromStockReceipt/);
  assert.match(page, /setStockReceiptResumeBarcode\(stockProductPrefill\.barcode\)/);
});
