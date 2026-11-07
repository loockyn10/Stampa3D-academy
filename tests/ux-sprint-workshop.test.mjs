// Sprint 4.1 — UX-02..UX-05: tarjetas de producto, buscador, consistencia de Mi Taller y sidebar contraíble.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const search = loadTs("src/lib/products/search.ts");
const categories = loadTs("src/lib/products/categories.ts");
const sidebarPref = loadTs("src/lib/layout/sidebar-preference.ts");

const CATS = new Map([
  ["c1", "Llaveros"],
  ["c2", "Decoración del hogar"],
]);
const PRODUCTS = [
  { id: "1", name: "Llavero Personalizado", category_id: "c1" },
  { id: "2", name: "Lámpara de mesa", category_id: "c2" },
  { id: "3", name: "Maceta geométrica", category_id: null },
  { id: "4", name: "Soporte de auriculares", category_id: "c2" },
];
const ids = (list) => list.map((p) => p.id);

test("buscador: por nombre, sin distinguir mayúsculas ni acentos", () => {
  assert.deepEqual(ids(search.filterProductsBySearch(PRODUCTS, "llavero", CATS)), ["1"]);
  assert.deepEqual(ids(search.filterProductsBySearch(PRODUCTS, "LAMPARA", CATS)), ["2"]);
  assert.deepEqual(ids(search.filterProductsBySearch(PRODUCTS, "geometrica", CATS)), ["3"]);
});

test("buscador: también por nombre de categoría y por varias palabras", () => {
  assert.deepEqual(ids(search.filterProductsBySearch(PRODUCTS, "decoracion", CATS)), ["2", "4"]);
  assert.deepEqual(ids(search.filterProductsBySearch(PRODUCTS, "hogar auriculares", CATS)), ["4"]);
  assert.deepEqual(ids(search.filterProductsBySearch(PRODUCTS, "llaveros", CATS)), ["1"]);
});

test("buscador: consulta vacía devuelve todo, sin coincidencias devuelve vacío y no muta la entrada", () => {
  assert.equal(search.filterProductsBySearch(PRODUCTS, "", CATS).length, 4);
  assert.equal(search.filterProductsBySearch(PRODUCTS, "   ", CATS).length, 4);
  assert.deepEqual(search.filterProductsBySearch(PRODUCTS, "zzz", CATS), []);
  assert.equal(PRODUCTS.length, 4);
});

test("buscador: se combina con el filtro de categoría de la pantalla", () => {
  const inCategory = categories.filterProductsByCategory(PRODUCTS, "c2");
  assert.deepEqual(ids(search.filterProductsBySearch(inCategory, "soporte", CATS)), ["4"]);
  assert.deepEqual(ids(search.filterProductsBySearch(inCategory, "llavero", CATS)), [], "un producto de otra categoría no aparece");
  const uncategorized = categories.filterProductsByCategory(PRODUCTS, categories.PRODUCT_CATEGORY_FILTER_NONE);
  assert.deepEqual(ids(search.filterProductsBySearch(uncategorized, "maceta", CATS)), ["3"]);
});

test("tarjeta de producto: estructura sin recortes agresivos y con todas las acciones", () => {
  const card = read("src/components/products/product-card.tsx");
  assert.ok(!/\btruncate\b[^"]*"[^>]*>\{p\.name\}/.test(card), "el nombre no se corta en una sola línea");
  assert.match(card, /line-clamp-2[^"]*"[^>]*title=\{p\.name\}/, "el nombre admite 2 líneas y muestra el completo al pasar el cursor");
  assert.match(card, /description &&/, "la descripción solo se muestra cuando existe");
  for (const action of ["onDetail", "onEdit", "onRecalculate", "onDelete"]) {
    assert.match(card, new RegExp(`onClick=\\{${action}\\}|${action}\\(\\);`), `la acción ${action} sigue disponible`);
  }
  for (const label of ["Recalcular precio de", "Eliminar ${p.name}", "ya está en Mi Negocio", "Agregar ${p.name} a Mi Negocio"]) {
    assert.ok(card.includes(label), `etiqueta accesible: ${label}`);
  }
  assert.match(card, /min-w-0/, "el contenido puede encoger dentro de la tarjeta");
  assert.ok(!/h-11 w-11 shrink-0/.test(card), "no hay hileras de botones de ancho fijo que desborden");
});

test("Productos: grilla por ancho disponible, buscador compartido y tarjeta compartida", () => {
  const page = read("src/app/productos/page.tsx");
  assert.match(page, /<ProductCard/);
  assert.match(page, /<WorkshopSearchField/);
  assert.match(page, /filterProductsBySearch\(\s*filterProductsByCategory\(/, "búsqueda y categoría se combinan");
  assert.match(page, /auto-fill,minmax\(min\(100%,17\.5rem\),1fr\)/, "columnas según el espacio real, no según el viewport");
  assert.ok(!/lg:grid-cols-3/.test(page), "ya no hay grilla fija de 3 columnas");
  assert.match(page, /No encontramos productos con esa búsqueda/, "estado vacío de búsqueda");
});

test("Mi Taller: las cuatro pantallas comparten encabezado, buscador y avisos", () => {
  const products = read("src/app/productos/page.tsx");
  const stock = read("src/app/stock/page.tsx");
  const printers = read("src/components/configuracion/printers-manager.tsx");
  for (const [name, source] of [["productos", products], ["stock", stock], ["impresoras", printers]]) {
    assert.match(source, /<WorkshopPageHeader/, `${name} usa el encabezado compartido`);
  }
  assert.match(stock, /workshopSection \? \(\s*<WorkshopPageHeader/, "Inventario y Filamentos usan el encabezado compartido");
  assert.equal((stock.match(/<WorkshopSearchField/g) ?? []).length, 2, "Inventario y Filamentos usan el mismo buscador");
  assert.match(stock, /<WorkshopNotice tone="warning"/, "stock bajo con el aviso compartido");
  assert.match(printers, /<WorkshopNotice tone="error"/);
  assert.match(printers, /<EmptyState/);
  const shared = read("src/components/workshop/workshop-page.tsx");
  assert.match(shared, /aria-label="Limpiar búsqueda"/);
  assert.match(shared, /role=\{tone === "error" \? "alert" : "status"\}/);
});

// ---- Sidebar contraíble

function withFakeBrowser(run) {
  const attrs = new Map();
  const store = new Map();
  const listeners = new Map();
  const fake = {
    document: {
      documentElement: {
        getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
        setAttribute: (name, value) => attrs.set(name, value),
        removeAttribute: (name) => attrs.delete(name),
      },
    },
    window: {
      localStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value),
        removeItem: (key) => store.delete(key),
      },
      addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== fn)),
      dispatchEvent: (event) => (listeners.get(event.type) ?? []).forEach((fn) => fn(event)),
    },
  };
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = fake.document;
  globalThis.window = fake.window;
  try {
    return run({ attrs, store, listeners, fake });
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
}

test("sidebar: la preferencia se guarda, se lee y se notifica", () => {
  withFakeBrowser(({ attrs, store }) => {
    let notified = 0;
    const unsubscribe = sidebarPref.subscribeSidebarPreference(() => { notified += 1; });
    assert.equal(sidebarPref.readSidebarCollapsed(), false);

    sidebarPref.writeSidebarCollapsed(true);
    assert.equal(sidebarPref.readSidebarCollapsed(), true);
    assert.equal(attrs.get("data-sidebar"), "collapsed");
    assert.equal(store.get("stampa-sidebar-collapsed"), "1");
    assert.equal(notified, 1);

    sidebarPref.writeSidebarCollapsed(false);
    assert.equal(sidebarPref.readSidebarCollapsed(), false);
    assert.equal(attrs.has("data-sidebar"), false);
    assert.equal(store.has("stampa-sidebar-collapsed"), false);
    assert.equal(notified, 2);

    unsubscribe();
    sidebarPref.writeSidebarCollapsed(true);
    assert.equal(notified, 2, "sin suscripción no hay notificaciones");
  });
});

test("sidebar: si localStorage falla, el cambio igual vale para la pestaña", () => {
  withFakeBrowser(({ attrs, fake }) => {
    fake.window.localStorage.setItem = () => { throw new Error("blocked"); };
    assert.doesNotThrow(() => sidebarPref.writeSidebarCollapsed(true));
    assert.equal(attrs.get("data-sidebar"), "collapsed");
  });
});

test("sidebar: el script inline aplica la preferencia guardada antes de pintar y tolera storage bloqueado", () => {
  withFakeBrowser(({ attrs, store, fake }) => {
    store.set("stampa-sidebar-collapsed", "1");
    new Function("window", "document", sidebarPref.SIDEBAR_INIT_SCRIPT)(fake.window, fake.document);
    assert.equal(attrs.get("data-sidebar"), "collapsed");

    attrs.clear();
    store.clear();
    new Function("window", "document", sidebarPref.SIDEBAR_INIT_SCRIPT)(fake.window, fake.document);
    assert.equal(attrs.has("data-sidebar"), false, "sin preferencia queda expandido");

    fake.window.localStorage.getItem = () => { throw new Error("blocked"); };
    assert.doesNotThrow(() => new Function("window", "document", sidebarPref.SIDEBAR_INIT_SCRIPT)(fake.window, fake.document));
  });
});

test("sidebar: el layout raíz aplica el script y el CSS resuelve el ancho sin saltos", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /SIDEBAR_INIT_SCRIPT/);
  const css = read("src/app/globals.css");
  assert.match(css, /\.app-sidebar\s*\{\s*width:\s*16rem/);
  assert.match(css, /html\[data-sidebar="collapsed"\]\s+\.app-sidebar\s*\{\s*width:\s*4\.5rem/);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.app-sidebar/);
  assert.match(read("src/app/main-layout.tsx"), /className="app-sidebar hidden/, "el fallback de Suspense usa el mismo ancho");
});

test("sidebar: botón accesible, estado expuesto, nombres para íconos y tooltips", () => {
  const sidebar = read("src/components/layout/sidebar.tsx");
  assert.match(sidebar, /aria-expanded=\{!collapsed\}/);
  assert.match(sidebar, /aria-controls="app-sidebar-nav"/);
  assert.match(sidebar, /"Expandir menú lateral" : "Contraer menú lateral"/);
  assert.match(sidebar, /aria-label=\{item\.label\}/, "cada ítem conserva nombre accesible aunque el texto se oculte");
  assert.match(sidebar, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(sidebar, /role="tooltip"/);
  assert.match(sidebar, /onFocus: showTooltip\(label\)/, "el tooltip también aparece con el foco del teclado");
  assert.match(sidebar, /lg:flex/, "el sidebar sigue siendo solo de escritorio");
});

// ---- Estructura común de Mi Taller (Sprint 4.1, corrección UX-04)

const summary = loadTs("src/lib/workshop/summary.ts");

test("resumen del panel: total o «mostrados de total»", () => {
  assert.equal(summary.workshopCountLabel(5, 5, "producto", "productos"), "5 productos");
  assert.equal(summary.workshopCountLabel(1, 1, "producto", "productos"), "1 producto");
  assert.equal(summary.workshopCountLabel(2, 5, "filamento", "filamentos"), "2 de 5 filamentos");
  assert.equal(summary.workshopCountLabel(0, 3, "impresora", "impresoras"), "0 de 3 impresoras");
});

test("Mi Taller: las cuatro pantallas respetan el orden encabezado → alertas → búsqueda y filtros → contenido", () => {
  const stock = read("src/app/stock/page.tsx");
  const screens = [
    ["Productos", read("src/app/productos/page.tsx"), "<ProductCard"],
    ["Inventario y Filamentos", stock, "<FilamentStockCard"],
    ["Impresoras", read("src/components/configuracion/printers-manager.tsx"), "WORKSHOP_GRID_GAP}`}>"],
  ];
  for (const [name, source, content] of screens) {
    const header = source.indexOf("<WorkshopPageHeader");
    const notice = source.indexOf("<WorkshopNotice");
    const toolbar = source.indexOf("<WorkshopToolbar");
    const body = source.indexOf(content, toolbar);
    assert.ok(header >= 0 && notice > header && toolbar > notice && body > toolbar, `${name}: orden de bloques`);
  }
  // Inventario: la tabla viene después del panel; el filtro del Dashboard vive dentro del panel, no suelto sobre las alertas.
  assert.ok(stock.indexOf("<WorkshopFilterChip") > stock.indexOf('<WorkshopToolbar\n          summary'), "chip de filtro dentro del panel");
  assert.ok(!/mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-300/.test(stock), "sin chip de filtro suelto sobre las alertas");
});

test("Mi Taller: panel de búsqueda uniforme (mismo marco, 44 px, resumen) y grillas con la misma separación", () => {
  const shared = read("src/components/workshop/workshop-page.tsx");
  assert.match(shared, /aria-label="Búsqueda y filtros"/);
  assert.match(shared, /rounded-2xl border border-stampa-border bg-stampa-surface/);
  assert.match(shared, /h-11 w-full rounded-xl/);
  assert.match(shared, /WORKSHOP_GRID_GAP = "gap-4 sm:gap-5"/);
  for (const file of ["src/app/productos/page.tsx", "src/app/stock/page.tsx", "src/components/configuracion/printers-manager.tsx"]) {
    assert.match(read(file), /WORKSHOP_GRID_GAP/, `${file} usa la separación común`);
  }
  assert.match(read("src/app/productos/page.tsx"), /<ProductCategoryBar/);
  assert.ok(!/divide-gray-100/.test(read("src/app/stock/page.tsx")), "la tabla de Inventario usa los separadores del tema");
});
