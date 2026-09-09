import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Mi Taller exposes four canonical, URL-backed sections", () => {
  for (const section of ["impresoras", "filamentos", "productos", "inventario"]) {
    assert.equal(fs.existsSync(path.join(root, `src/app/mi-taller/${section}/page.tsx`)), true);
  }

  const navigation = read("src/components/workshop/workshop-navigation.tsx");
  assert.match(navigation, /\/mi-taller\/impresoras/);
  assert.match(navigation, /\/mi-taller\/filamentos/);
  assert.match(navigation, /\/mi-taller\/productos/);
  assert.match(navigation, /\/mi-taller\/inventario/);
  assert.match(navigation, /overflow-x-auto/);
});

test("desktop and mobile navigation use one Mi Taller entry", () => {
  const sidebar = read("src/components/layout/sidebar.tsx");
  const mobile = read("src/components/layout/mobile-navigation.ts");

  assert.match(sidebar, /path: "\/mi-taller", label: "Mi Taller"/);
  assert.doesNotMatch(sidebar, /Productos fabricados|label: "Producción"|\/configuracion\?tab=taller|\/stock\?tab=/);
  assert.match(mobile, /href: "\/mi-taller"/);
  assert.doesNotMatch(mobile, /href: "\/productos"|href: "\/stock"/);
});

test("legacy routes redirect to the consolidated architecture", () => {
  const config = read("next.config.ts");
  assert.match(config, /source: "\/productos"[\s\S]*destination: "\/mi-taller\/productos"/);
  assert.match(config, /value: "filamentos"[\s\S]*destination: "\/mi-taller\/filamentos"/);
  assert.match(config, /value: "productos"[\s\S]*destination: "\/mi-taller\/inventario"/);
  assert.match(config, /source: "\/mi-negocio\/inventario"[\s\S]*destination: "\/mi-negocio\/catalogo"/);
});

test("workshop inventory reuses safe production and manual adjustment flows", () => {
  const stock = read("src/app/stock/page.tsx");
  assert.match(stock, /workshopSection === "inventory"/);
  assert.match(stock, /Registrar producción/);
  assert.match(stock, /p_add_to_stock: consumeAddStock/);
  assert.match(stock, /rpc\("adjust_product_stock"/);
});

test("commercial catalog owns resale adjustments but links manufactured stock to workshop", () => {
  const catalog = read("src/app/mi-negocio/catalogo/page.tsx");
  assert.match(catalog, /loadBusinessOperationsAction/);
  assert.match(catalog, /adjustBusinessInventoryAction/);
  assert.match(catalog, /item\.source_type === "manufactured"/);
  assert.match(catalog, /href="\/mi-taller\/inventario"/);
  assert.match(catalog, /Ajustar stock de reventa/);
});
