import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "src/app/stock/page.tsx"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260901002424_produce_product_components.sql"),
  "utf8",
);

test("component targets retain both product and component identity in one RPC call", () => {
  assert.match(page, /p_component_items = compItems\.map/);
  assert.match(page, /product_id: item\.product\.id/);
  assert.match(page, /component_id: item\.component\.id/);
  assert.match(page, /consume_filaments_for_production_targets/);
  assert.doesNotMatch(page, /Process individual components sequentially/);
});

test("the component RPC validates ownership, relationship and a non-empty recipe", () => {
  assert.match(migration, /component\.product_id = item_record\.product_id/i);
  assert.match(migration, /component\.user_id = current_user_id/i);
  assert.match(migration, /product\.user_id = current_user_id/i);
  assert.match(migration, /recipe_rows = 0[\s\S]*no tiene una receta de filamentos configurada/i);
  assert.match(migration, /recipe_record\.filament_id is null[\s\S]*recipe_record\.grams/i);
});

test("all filament stock is validated before multifilament movements begin", () => {
  const validationLock = migration.indexOf("Lock every affected filament");
  const firstAdjustment = migration.indexOf("perform public.adjust_filament_stock");

  assert.ok(validationLock > 0);
  assert.ok(firstAdjustment > validationLock);
  assert.match(migration, /jsonb_each_text\(consumption_totals\)[\s\S]*order by key/i);
  assert.match(migration, /recipe_record\.grams::numeric \* item_record\.quantity/i);
  assert.match(migration, /remaining_grams[\s\S]*< consumption_record\.required_grams/i);
});

test("component production updates only component stock and verifies both delegated mutations", () => {
  assert.match(migration, /public\.adjust_component_stock\(/i);
  assert.match(migration, /p_quantity_delta => item_record\.quantity/i);
  assert.match(migration, /resulting_component_stock is distinct from expected_component_stock/i);
  assert.match(migration, /resulting_remaining is distinct from expected_remaining/i);
  assert.doesNotMatch(migration, /update\s+public\.products/i);
  assert.doesNotMatch(migration, /adjust_product_stock/i);
});

test("the wrapper keeps complete products on the existing RPC and makes mixed carts atomic", () => {
  assert.match(migration, /perform public\.consume_filaments_for_products\(/i);
  assert.match(migration, /public\.consume_filaments_for_components\(/i);
  assert.match(migration, /consume_filaments_for_production_targets/);
  assert.match(migration, /security invoker/i);
});
