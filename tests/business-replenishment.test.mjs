import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/business/replenishment.ts", import.meta.url), "utf8");
const businessActions = readFileSync(new URL("../src/app/mi-negocio/actions.ts", import.meta.url), "utf8");
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

test("reposición posterior a una venta desde showroom y depósito conserva el total", () => {
  const afterSale = { showroom: 0, warehouse: 9, showroomTarget: 6 };
  const replenishment = calculateShowroomReplenishment(afterSale);
  assert.deepEqual(replenishment, { needed: 6, movable: 6, remainingShortage: 0 });
  assert.equal(afterSale.showroom + replenishment.movable + afterSale.warehouse - replenishment.movable, 9);
});

test("reposición enriquece nombres con la representación comercial centralizada", () => {
  const start = businessActions.indexOf("export async function loadBusinessReplenishmentAction");
  const end = businessActions.indexOf("export async function configureBusinessLocationsAction", start);
  const block = businessActions.slice(start, end);
  assert.match(block, /\.select\("id, name, brand, category, sku, purchase_cost, source_type"\)/);
  assert.match(block, /getBusinessProductDisplayName/);
  assert.match(block, /catalogDetails\.get\(item\.catalogItemId\)/);
  assert.match(block, /purchaseCost: detail\?\.source_type === "resale"[\s\S]*detail\.purchase_cost/);
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
const missingBalanceFix = readFileSync(new URL("../supabase/migrations/20260909022450_fix_missing_business_location_balances.sql", import.meta.url), "utf8");

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

test("CASE 1: showroom faltante se materializa en cero antes de mover 4 de depósito 10", () => {
  assert.match(missingBalanceFix, /insert into public\.business_inventory_location_balances[\s\S]*showroom_id, 0[\s\S]*warehouse_id, 0[\s\S]*on conflict \(catalog_item_id, location_id\) do nothing/i);
  assert.deepEqual(calculateShowroomReplenishment({ showroom: 0, warehouse: 10, showroomTarget: 4 }), { needed: 4, movable: 4, remainingShortage: 0 });
  assert.equal(10 - 4 + 4, 10);
});

test("CASE 2: showroom existente en cero usa el mismo traslado seguro", () => {
  assert.deepEqual(calculateShowroomReplenishment({ showroom: 0, warehouse: 10, showroomTarget: 4 }), { needed: 4, movable: 4, remainingShortage: 0 });
  assert.match(missingBalanceFix, /set quantity = balance\.quantity - move_qty[\s\S]*set quantity = balance\.quantity \+ move_qty/i);
});

test("CASE 3: depósito insuficiente limita el movimiento y nunca queda negativo", () => {
  assert.deepEqual(calculateShowroomReplenishment({ showroom: 0, warehouse: 2, showroomTarget: 4 }), { needed: 4, movable: 2, remainingShortage: 2 });
  assert.match(missingBalanceFix, /and balance\.quantity >= move_qty/i);
  assert.match(migration, /business_inventory_location_balances_quantity_check check \(quantity >= 0\)/i);
});

test("CASE 4: concurrencia usa creación atómica, locks e idempotencia persistida", () => {
  assert.match(missingBalanceFix, /on conflict \(catalog_item_id, location_id\) do nothing/i);
  assert.match(missingBalanceFix, /pg_advisory_xact_lock/i);
  assert.match(missingBalanceFix, /order by balance\.location_id\s+for update/i);
  assert.match(migration, /primary key \(catalog_item_id, location_id\)/i);
  assert.match(migration, /unique \(user_id, operation_key, catalog_item_id\)/i);
});

test("CASE 5: Reponer todo recorre IDs únicos en orden e inicializa cada balance", () => {
  assert.match(missingBalanceFix, /select distinct requested_id[\s\S]*order by requested_id[\s\S]*loop/i);
  assert.match(missingBalanceFix, /loop[\s\S]*ensure_business_inventory_location_balances\(item_id\)[\s\S]*end loop/i);
});

test("CASE 6: reventa conserva resale_stock_quantity como autoridad", () => {
  assert.match(migration, /else coalesce\(item\.resale_stock_quantity, 0\)/i);
  assert.match(missingBalanceFix, /business_catalog_authoritative_stock\(item_id\)/i);
});

test("CASE 7: fabricados conservan products.stock_quantity como autoridad sin duplicarlo", () => {
  assert.match(migration, /when item\.source_type = 'manufactured'[\s\S]*coalesce\(product\.stock_quantity, 0\)/i);
  assert.match(missingBalanceFix, /catalog_item\.source_type = 'manufactured'[\s\S]*from public\.products product[\s\S]*for update/i);
  assert.match(missingBalanceFix, /distributed_qty < authoritative_qty[\s\S]*authoritative_qty - distributed_qty/i);
});

test("CASE 8: otro usuario no puede reponer ni materializar balances ajenos", () => {
  assert.match(missingBalanceFix, /current_user_id uuid := auth\.uid\(\)/i);
  assert.match(missingBalanceFix, /item\.user_id = current_user_id/i);
  assert.match(missingBalanceFix, /balance\.user_id = current_user_id/i);
  assert.match(migration, /foreign key\(user_id,catalog_item_id\)[\s\S]*foreign key\(user_id,location_id\)/i);
});

test("CASE 9: ubicaciones desactivadas no crean balances arbitrariamente", () => {
  assert.match(missingBalanceFix, /if not exists \([\s\S]*settings\.locations_enabled[\s\S]*'locations_disabled'/i);
  assert.match(missingBalanceFix, /owner_id is null or not exists \([\s\S]*settings\.locations_enabled[\s\S]*return false/i);
});

test("CASE 10: producto nuevo con ubicaciones activas crea showroom y depósito incluso con stock cero", () => {
  const applyDelta = missingBalanceFix.slice(
    missingBalanceFix.indexOf("create or replace function public.apply_business_location_stock_delta"),
    missingBalanceFix.indexOf("-- Existing enabled businesses"),
  );
  assert.ok(applyDelta.indexOf("ensure_business_inventory_location_balances") < applyDelta.indexOf("if coalesce(p_delta, 0) = 0 then return"));
  assert.match(migration, /catalog_sync_business_location_stock after insert/i);
});

test("backfill agrega sólo filas faltantes y recupera depósito desde stock no distribuido", () => {
  const backfill = missingBalanceFix.slice(
    missingBalanceFix.indexOf("-- Existing enabled businesses"),
    missingBalanceFix.indexOf("create or replace function public.replenish_business_showroom"),
  );
  assert.match(missingBalanceFix, /Existing quantities are never updated by this backfill/i);
  assert.match(missingBalanceFix, /greatest\([\s\S]*business_catalog_authoritative_stock\(item\.id\)[\s\S]*existing\.distributed_quantity[\s\S]*0[\s\S]*\)::integer/i);
  assert.match(missingBalanceFix, /on conflict \(catalog_item_id, location_id\) do nothing/gi);
  assert.doesNotMatch(backfill, /update public\.business_inventory_location_balances/i);
});

test("errores posteriores al comienzo del lote abortan la transacción completa", () => {
  assert.match(missingBalanceFix, /Catalog item changed while replenishment was being prepared/i);
  assert.match(missingBalanceFix, /Location distribution exceeds authoritative stock/i);
  assert.doesNotMatch(missingBalanceFix, /Missing showroom balance/i);
});
