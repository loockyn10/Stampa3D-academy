/**
 * Graba una interacción real con la Calculadora PÚBLICA (anónima, configuración demo) con datos FICTICIOS.
 *
 *   node scripts/demo/record-calculadora.mjs [carpeta-de-fotogramas]
 *
 * - La app y sus cálculos son los reales. Solo se reemplaza, en el navegador, la respuesta de GET /api/calculator/catalog con un
 *   catálogo ficticio (W3D PLA Naranja, Venta minorista, importes ilustrativos): no se toca el código, el endpoint ni Supabase.
 * - Se ocultan multiplicadores y porcentajes internos: el sufijo «(x…)» del tipo de producto, el «30 %» fijo de recargo de insumos y el
 *   campo «Markup manual» (difuminado). No hay sesión: no hay datos de usuario.
 */

import { createRecorder } from "./recorder-lib.mjs";

const outDir = process.argv[2] || "tmp-frames-calculadora";
const SAFE_CATALOG = {
  authenticated: false,
  demo: true,
  printers: [{ id: "demo-printer", name: "BambuLab H2S", brand: "", model: "", power_watts: 200, maintenance_cost_per_hour: 300, image_path: null, display_name: "BambuLab H2S" }],
  filaments: [{ id: "demo-filament", name: "", brand: "W3D", filament_type: "PLA", color: "Naranja", color_hex: "#ff780a", default_total_grams: 1000, default_purchase_price: 16000, display_name: "W3D PLA Naranja" }],
  catalogPrinters: [],
  catalogFilaments: [],
  selectedPrinterTemplateIds: [],
  selectedFilamentTemplateIds: [],
  preferences: null,
  settings: { electricityPriceKwh: 100, platformCommissionPercent: 10, platformExtraAmount: 0, defaultErrorPercent: 5 },
  productTypes: [{ id: "demo-retail", name: "Venta minorista", multiplier: 2.4, fixed_cost: 0 }],
};

// Enmascarado continuo (la app reescribe el DOM al recalcular): se aplica en cada cambio.
const MASK = () => {
  const suffix = /\s*\(x[0-9.,]+\)/g;
  const fix = () => {
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const t = n.nodeValue ?? "";
      const u = t.replace("Recargo insumos 30%", "Recargo insumos").replace("Se les suma un 30% por envío", "Se les suma un recargo por envío").replace(suffix, "");
      if (u !== t) n.nodeValue = u;
    }
    document.querySelectorAll("label, span, p, div").forEach((el) => {
      if (el.children.length || !el.textContent?.trim().startsWith("Markup manual")) return;
      let box = el.parentElement;
      while (box && box.querySelectorAll("input").length !== 1) box = box.parentElement;
      const input = box?.querySelector("input");
      if (input) input.style.filter = "blur(7px)";
    });
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fix();
    });
  };
  addEventListener("DOMContentLoaded", () => {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    fix();
  });
};

const numeric = (page) => page.locator("input[inputmode='decimal'], input[inputmode='numeric'], input[type='number']");

const r = await createRecorder({
  outDir,
  startRoute: "/calculadora",
  anonymous: true,
  initScripts: [MASK],
  setup: (context) => context.route("**/api/calculator/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SAFE_CATALOG) })),
  prepare: async (page) => {
    await page.getByText("W3D PLA Naranja").first().waitFor();
    const n = numeric(page);
    await n.nth(0).fill("120");
    await n.nth(1).fill("3");
    await n.nth(2).fill("30");
    await page.mouse.click(1000, 40);
    await page.waitForTimeout(800);
  },
});
const { page, sleep, moveTo, clickOn, scrollBy } = r;
const T0 = Date.now();
const scene = (name) => console.log(`  [${((Date.now() - T0) / 1000).toFixed(1)} s] ${name}`);

async function setField(index, value) {
  const field = numeric(page).nth(index);
  await clickOn(field, 700);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(String(value), { delay: 150 });
}

try {
  scene("inicio");
  await moveTo(900, 420, 800);
  await sleep(1500);

  scene("gramos");
  await setField(0, 200);
  await sleep(1700);

  scene("horas");
  await setField(1, 5);
  await sleep(1700);

  scene("modo avanzado");
  await clickOn(page.getByText("Modo Avanzado").first(), 800);
  await sleep(1100);
  await moveTo(520, 520, 600);
  await scrollBy(560, 1300);
  await sleep(2200);

  scene("modo básico");
  await scrollBy(-560, 1000);
  await sleep(300);
  await clickOn(page.getByText("Modo Básico").first(), 800);
  await sleep(1600);
} finally {
  await r.finish();
}
