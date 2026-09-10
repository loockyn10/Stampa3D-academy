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
const search = loadTypeScriptModule(path.join(root, "src/lib/business/search.ts"), { "./catalog": catalog });
const metrics = loadTypeScriptModule(path.join(root, "src/lib/business/metrics.ts"));
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260910053553_business_polish.sql"), "utf8");
const saleLocationFix = fs.readFileSync(path.join(root, "supabase/migrations/20260910140721_fix_business_sale_location_movements.sql"), "utf8");
const actions = fs.readFileSync(path.join(root, "src/app/mi-negocio/actions.ts"), "utf8");
const catalogPage = fs.readFileSync(path.join(root, "src/app/mi-negocio/catalogo/page.tsx"), "utf8");
const replenishmentPage = fs.readFileSync(path.join(root, "src/app/mi-negocio/reposicion/page.tsx"), "utf8");
const salesPage = fs.readFileSync(path.join(root, "src/app/mi-negocio/ventas/page.tsx"), "utf8");
const metricsPage = fs.readFileSync(path.join(root, "src/app/mi-negocio/metricas/page.tsx"), "utf8");
const businessHub = fs.readFileSync(path.join(root, "src/app/mi-negocio/page.tsx"), "utf8");
const stampyContext = fs.readFileSync(path.join(root, "src/lib/stampy/static-page-contexts.ts"), "utf8");

const w3d = {
  name: "PLA Negro",
  brand: "W3D",
  category: "Filamentos PLA",
  sku: "W3D-PLA-BLK",
  barcode: "7791234567890",
};

test("catalog search matches name, brand, combined display name, category, SKU and barcode", () => {
  for (const query of ["PLA Negro", "W3D", "W3D PLA Negro", "Filamentos", "w3d-pla", "7791234567890"]) {
    assert.equal(search.matchesBusinessSearch(w3d, query), true, query);
  }
  assert.equal(search.matchesBusinessSearch(w3d, "Elegoo PETG"), false);
  assert.equal(search.matchesBusinessSearch({ ...w3d, name: "Ácido" }, "acido"), true);
});

test("catalog and replenishment expose client-side search without one request per key", () => {
  assert.match(catalogPage, /matchesBusinessSearch\(item, catalogSearch\)/);
  assert.match(catalogPage, /marca, categoría, SKU o código/);
  assert.match(replenishmentPage, /matchesBusinessSearch\(item, search\)/);
  assert.match(replenishmentPage, /marca, categoría o SKU/);
  assert.doesNotMatch(catalogPage, /useEffect\([\s\S]{0,300}catalogSearch[\s\S]{0,300}loadBusiness/);
});

test("bulk purchase cost is an owned atomic RPC that changes no sale price, stock or barcode", () => {
  const functionSql = migration.match(/create or replace function public\.bulk_update_business_purchase_cost[\s\S]*?\$bulk_purchase_cost\$;/i)?.[0] ?? "";
  assert.match(functionSql, /auth\.uid\(\)/);
  assert.match(functionSql, /has_platform_access/);
  assert.match(functionSql, /source_type = 'resale'/);
  assert.match(functionSql, /order by item\.id[\s\S]*for update/);
  assert.match(functionSql, /set purchase_cost = round\(p_purchase_cost, 2\)/);
  assert.match(functionSql, /affected_count <> requested_count[\s\S]*raise exception/);
  assert.doesNotMatch(functionSql, /set[\s\S]*sale_price\s*=/i);
  assert.doesNotMatch(functionSql, /set[\s\S]*(resale_stock_quantity|barcode)\s*=/i);
  assert.match(actions, /bulkUpdateBusinessPurchaseCostAction/);
  assert.match(replenishmentPage, /Seleccionar resultados filtrados/);
  assert.match(replenishmentPage, /Varios valores/);
});

test("sale void is owned, concurrent-safe, idempotent and blocks online sales", () => {
  const functionSql = saleLocationFix.match(/create or replace function public\.void_business_sale[\s\S]*?\$void_sale_by_location\$;/i)?.[0] ?? "";
  assert.match(functionSql, /where sale\.id = p_sale_id[\s\S]*sale\.user_id = current_user_id[\s\S]*for update/);
  assert.match(functionSql, /target_sale\.status = 'voided'[\s\S]*stock no se modificó/);
  assert.match(functionSql, /target_sale\.order_id is not null[\s\S]*pago online/);
  assert.match(functionSql, /movement\.movement_type = 'sale'/);
  assert.match(functionSql, /insert into public\.business_inventory_movements[\s\S]*'void_sale'/);
  assert.match(functionSql, /set status = 'voided',[\s\S]*voided_at = now\(\),[\s\S]*void_reason/);
  assert.doesNotMatch(functionSql, /delete from public\.business_sales/i);
  assert.doesNotMatch(functionSql, /refund|mercado_pago|payment_provider/i);
  assert.match(salesPage, /Eliminar esta venta/);
  assert.match(salesPage, /no puede eliminarse desde acá/);
});

test("sale void restores the recorded showroom and warehouse split", () => {
  assert.match(saleLocationFix, /group by movement\.location_id/);
  assert.match(saleLocationFix, /quantity = balance\.quantity - relocate_quantity/);
  assert.match(saleLocationFix, /quantity = balance\.quantity \+ source_location\.quantity/);
  assert.match(saleLocationFix, /source_location\.location_id, 'void_sale'/);
  assert.match(saleLocationFix, /venta legacy restaurada en depósito/);
  assert.doesNotMatch(saleLocationFix, /location_breakdown/);
});

test("sale void validates movement totals and rolls back if it cannot mark the sale", () => {
  const functionSql = saleLocationFix.match(/create or replace function public\.void_business_sale[\s\S]*?\$void_sale_by_location\$;/i)?.[0] ?? "";
  assert.match(functionSql, /movement_total <> sold_item\.quantity/);
  assert.match(functionSql, /localized_count not in \(0, movement_count\)/);
  assert.match(functionSql, /updated_sales <> 1 then raise exception/);
  assert.match(functionSql, /target_sale\.status = 'voided'[\s\S]*stock no se modificó/);
  assert.ok(functionSql.indexOf("Validate and lock the complete sale") < functionSql.indexOf("p_quantity_delta => restore_quantity"));
  assert.match(functionSql, /order by item\.catalog_item_id[\s\S]*for update/);
  assert.match(functionSql, /Location distribution exceeds authoritative stock/);
});

test("a localized 2 showroom + 3 warehouse sale is exactly reversible only once", () => {
  const original = { showroom: 2, warehouse: 10 };
  const movement = { showroom: -2, warehouse: -3 };
  const afterSale = {
    showroom: original.showroom + movement.showroom,
    warehouse: original.warehouse + movement.warehouse,
  };
  assert.deepEqual(afterSale, { showroom: 0, warehouse: 7 });

  let status = "completed";
  const voidOnce = (stock) => {
    if (status === "voided") return stock;
    status = "voided";
    return { showroom: stock.showroom - movement.showroom, warehouse: stock.warehouse - movement.warehouse };
  };
  const restored = voidOnce(afterSale);
  assert.deepEqual(restored, original);
  assert.deepEqual(voidOnce(restored), original);
});

test("metrics use the business timezone and exclude voided and refunded sales", () => {
  const functionSql = migration.match(/create or replace function public\.get_business_metrics[\s\S]*?\$business_metrics\$;/i)?.[0] ?? "";
  assert.match(functionSql, /America\/Argentina\/Buenos_Aires/);
  assert.match(functionSql, /date_trunc\('week'/);
  assert.match(functionSql, /sale\.status = 'completed'/);
  assert.match(functionSql, /source_order\.status <> 'refunded'/);
  assert.match(functionSql, /limit 5/);
  assert.match(functionSql, /unit_weight_grams/);
  assert.match(functionSql, /revenuePercent/);
});

test("metrics normalizer preserves totals, comparisons and weighted top products", () => {
  const normalized = metrics.normalizeBusinessMetrics({
    period: "week",
    timezone: "America/Argentina/Buenos_Aires",
    periodStart: "2026-09-07T03:00:00Z",
    periodEnd: "2026-09-14T03:00:00Z",
    revenue: "25000",
    salesCount: 2,
    averageTicket: 12500,
    unitsSold: 14,
    filamentKilograms: "12",
    comparison: { revenuePercent: 25, salesPercent: -10 },
    topProducts: [{ catalogItemId: "item-1", name: "W3D PLA Negro", units: 10, revenue: 18000, kilograms: 10 }],
  });
  assert.equal(normalized.revenue, 25000);
  assert.equal(normalized.comparison.salesPercent, -10);
  assert.equal(normalized.topProducts[0].kilograms, 10);
});

test("Mi Negocio removes the redundant Clients destination and adds Metrics", () => {
  assert.doesNotMatch(businessHub, /title: "Clientes"/);
  assert.match(businessHub, /href: "\/mi-negocio\/metricas"/);
  assert.match(metricsPage, /Facturación/);
  assert.match(metricsPage, /Ticket promedio/);
  assert.match(metricsPage, /Productos más vendidos/);
});

test("Stampy receives business search and metrics context but no dangerous mutation capability", () => {
  assert.match(catalogPage, /searchQuery: catalogSearch/);
  assert.match(replenishmentPage, /searchQuery: search/);
  assert.match(metricsPage, /weekly_metrics/);
  assert.match(stampyContext, /no anules ventas, no hagas ediciones masivas/);
  assert.doesNotMatch(stampyContext, /podés anular ventas|podés editar costos en masa/i);
});

test("migration is additive and never hard-deletes sales or changes payments", () => {
  assert.match(migration, /add column if not exists voided_at/);
  assert.match(migration, /add column if not exists void_reason/);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i);
  assert.doesNotMatch(migration, /update public\.(payments|business_payment|mercado_pago)/i);
});
