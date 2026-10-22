import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const routes = loadTs("src/lib/workshop/routes.ts");
const dashboard = loadTs("src/lib/workshop/dashboard.ts");

const snapshotFor = (filament) => ({
  source: "calculator",
  materials: [{ filament_id: filament.id, filament_purchase_price: filament.purchase_price, filament_total_grams: filament.total_grams }],
});

test("pestañas de Mi Taller: orden definitivo y Dashboard solo con ruta exacta", () => {
  assert.deepEqual(routes.WORKSHOP_SECTIONS.map((s) => s.label), ["Dashboard", "Inventario", "Productos", "Filamentos", "Impresoras"]);
  const [dash, inventory] = routes.WORKSHOP_SECTIONS;
  assert.equal(routes.isWorkshopSectionActive(dash, "/mi-taller"), true);
  assert.equal(routes.isWorkshopSectionActive(dash, "/mi-taller/"), true);
  assert.equal(routes.isWorkshopSectionActive(dash, "/mi-taller/inventario"), false);
  assert.equal(routes.isWorkshopSectionActive(inventory, "/mi-taller/inventario"), true);
  assert.equal(routes.isWorkshopSectionActive(inventory, "/mi-taller/inventario/x"), true);
  assert.equal(routes.isWorkshopSectionActive(inventory, "/mi-taller/inventariox"), false);
  assert.equal(routes.isWorkshopSectionActive(inventory, null), false);
});

test("rutas de destino preservan las subsecciones y deep links existentes", () => {
  assert.equal(routes.WORKSHOP_ROUTES.newProduct, "/mi-taller/productos?action=new");
  assert.equal(routes.WORKSHOP_ROUTES.inventoryOutOfStock, "/mi-taller/inventario?estado=sin-stock");
  assert.equal(routes.WORKSHOP_ROUTES.productsNeedingRecalculation, "/mi-taller/productos?estado=recalcular");
  assert.equal(routes.WORKSHOP_ROUTES.editProduct("a b"), "/mi-taller/productos?edit=a%20b");
});

test("resumen: indicadores reales sin umbrales inventados", () => {
  const pla = { id: "f1", name: "PLA Negro", filament_type: "pla", remaining_grams: 750, total_grams: 1000, purchase_price: 20000, is_active: true };
  const petg = { id: "f2", name: "PETG Azul", filament_type: "PETG", remaining_grams: 0, total_grams: 1000, purchase_price: 25000, is_active: true };
  const retired = { id: "f3", name: "Vieja", filament_type: "PLA", remaining_grams: 300, total_grams: 1000, purchase_price: 1, is_active: false };
  const summary = dashboard.buildWorkshopSummary({
    products: [
      { id: "p1", name: "Maceta", stock_quantity: 4, is_active: true, calculation_snapshot: snapshotFor(pla) },
      { id: "p2", name: "Llavero", stock_quantity: 1, is_active: true, calculation_snapshot: snapshotFor(pla) },
      { id: "p3", name: "Lámpara", stock_quantity: 0, is_active: true, calculation_snapshot: snapshotFor(pla) },
      { id: "p4", name: "Sin snapshot", stock_quantity: 2, is_active: true },
    ],
    components: [
      { id: "c1", product_id: "p3", name: "Base", stock_quantity: 5, quantity_per_product: 2, is_active: true },
      { id: "c2", product_id: "p3", name: "Pantalla", stock_quantity: 3, quantity_per_product: 1, is_active: true },
    ],
    filaments: [pla, petg, retired],
    printers: [{ id: "pr1" }],
    productTypes: [],
  });
  assert.equal(summary.activeProducts, 4);
  assert.equal(summary.finishedUnits, 7, "suma stock_quantity; las piezas no se suman");
  assert.equal(summary.outOfStockProducts, 1);
  assert.equal(summary.needsRecalculationProducts, 1, "misma regla que Productos (sin snapshot)");
  assert.equal(summary.assemblableUnits, 2, "min(floor(5/2), floor(3/1))");
  assert.equal(summary.assemblableProducts, 1);
  assert.equal(summary.activeSpools, 2, "las bobinas inactivas no cuentan");
  assert.equal(summary.emptySpools, 1);
  assert.equal(summary.availableGrams, 750);
  assert.deepEqual(summary.materials.map((m) => m.material), ["PLA", "PETG"]);
  // Atención: agotado primero, con la diferencia entre terminadas y armables.
  assert.equal(summary.attentionProducts[0].id, "p3");
  assert.equal(summary.attentionProducts[0].assemblableUnits, 2);
  assert.ok(summary.attentionProducts.some((p) => p.id === "p4" && p.needsRecalculation));
  assert.ok(!summary.attentionProducts.some((p) => p.id === "p2"), "1 unidad no es una alerta: no hay umbral de stock bajo");
});

test("producto completo de un solo componente no se trata como armable", () => {
  assert.equal(dashboard.isAssembledFromParts([{ id: "c", product_id: "p", name: "Producto completo" }]), false);
  assert.equal(dashboard.maxAssemblableUnits([]), 0);
});

test("dashboard: solo lectura, reusa flujos existentes y no escribe stock", () => {
  const ui = read("src/components/workshop/workshop-dashboard.tsx");
  assert.doesNotMatch(ui, /\.(insert|update|upsert|delete)\(|\.rpc\(/);
  assert.doesNotMatch(ui, /product_stock_movements|filament_stock_movements/, "actividad reciente omitida: schema no verificable");
  assert.match(ui, /WORKSHOP_ROUTES\.registerProduction/);
  assert.match(ui, /WORKSHOP_ROUTES\.newProduct/);
  assert.match(ui, /grid grid-cols-2 gap-3 lg:grid-cols-4/, "2x2 en mobile");
  const stock = read("src/app/stock/page.tsx");
  assert.match(stock, /searchParams\.get\("action"\) !== WORKSHOP_REGISTER_PRODUCTION_ACTION/);
  assert.match(stock, /setConsumeAddStock\(true\);\s*setConsumeModalOpen\(true\);\s*router\.replace\("\/mi-taller\/inventario"/);
  assert.match(stock, /outOfStockOnly && \(p\.is_active === false \|\| \(p\.stock_quantity \|\| 0\) > 0\)/);
  const products = read("src/app/productos/page.tsx");
  assert.match(products, /needsRecalculationOnly[\s\S]*getProductPricingStatus\(product, filaments, printers, productTypes\)\.needsRecalculation/);
});
