import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/business/replenishment.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiledModule = { exports: {} };
new Function("module", "exports", js)(compiledModule, compiledModule.exports);
const { calculateShowroomReplenishment, calculatePurchaseSuggestion, soldWeightKg } = compiledModule.exports;

test("reposición completa preserva el faltante calculado", () => {
  assert.deepEqual(calculateShowroomReplenishment({ showroom: 2, warehouse: 10, showroomTarget: 6 }), { needed: 4, movable: 4, remainingShortage: 0 });
});

test("reposición limitada por depósito informa faltante restante", () => {
  assert.deepEqual(calculateShowroomReplenishment({ showroom: 2, warehouse: 2, showroomTarget: 6 }), { needed: 4, movable: 2, remainingShortage: 2 });
});

test("producto sin objetivo no se recomienda", () => {
  assert.deepEqual(calculateShowroomReplenishment({ showroom: 2, warehouse: 10, showroomTarget: null }), { needed: 0, movable: 0, remainingShortage: 0 });
});

test("compras y peso no inventan datos", () => {
  assert.equal(calculatePurchaseSuggestion(10, 5), 5);
  assert.equal(calculatePurchaseSuggestion(null, 5), null);
  assert.equal(soldWeightKg(11, 1000), 11);
  assert.equal(soldWeightKg(8, 500), 4);
  assert.equal(soldWeightKg(12, null), null);
});

const migration = readFileSync(new URL("../supabase/migrations/20260909010248_business_inventory_locations.sql", import.meta.url), "utf8");

test("schema usa ubicaciones extensibles, balances y transferencias idempotentes", () => {
  assert.match(migration, /create table if not exists public\.business_inventory_locations/);
  assert.match(migration, /create table if not exists public\.business_inventory_location_balances/);
  assert.match(migration, /create table if not exists public\.business_inventory_transfers/);
  assert.match(migration, /unique \(user_id, operation_key, catalog_item_id\)/);
  assert.doesNotMatch(migration, /showroom_stock\s+integer|warehouse_stock\s+integer/);
});

test("activación preserva autoridad y permite elegir ubicación inicial", () => {
  assert.match(migration, /business_catalog_authoritative_stock/);
  assert.match(migration, /p_initial_location='showroom'/);
  assert.match(migration, /products\.stock_quantity/);
  assert.match(migration, /resale_stock_quantity/);
});

test("venta con ubicaciones valida showroom y conserva venta existente como fallback", () => {
  assert.match(migration, /confirm_business_showroom_sale/);
  assert.match(migration, /insufficient_showroom_stock/);
  assert.match(migration, /return query select \* from public\.confirm_business_sale/);
  assert.match(migration, /set_config\('stampa\.inventory_sale_location_id'/);
  assert.match(migration, /products_sync_business_location_stock/);
  assert.match(migration, /catalog_sync_business_location_stock/);
});

test("RLS y RPCs fijan usuario desde auth uid", () => {
  assert.match(migration, /alter table public\.business_inventory_locations enable row level security/);
  assert.match(migration, /user_id = auth\.uid\(\)/);
  assert.match(migration, /current_user_id uuid\s*:=\s*auth\.uid\(\)/);
  assert.doesNotMatch(migration, /p_user_id/);
  assert.match(migration, /foreign key\(user_id,catalog_item_id\)/);
  assert.match(migration, /foreign key\(user_id,location_id\)/);
});

test("la migración conserva autoridades, RLS e idempotencia", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260909010248_business_inventory_locations.sql", import.meta.url), "utf8");
  for (const fragment of [
    "business_inventory_locations", "business_inventory_location_balances", "business_inventory_policies",
    "business_inventory_transfers", "for update", "auth.uid()", "has_platform_access",
    "unique (user_id, operation_key, catalog_item_id)", "confirm_business_showroom_sale",
    "status='completed'", "America/Argentina/Buenos_Aires",
  ]) assert.match(sql, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(sql, /alter table public\.business_catalog_items[\s\S]*add column[^;]*(showroom_stock|warehouse_stock)/i);
});
