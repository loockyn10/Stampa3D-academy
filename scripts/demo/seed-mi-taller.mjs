/**
 * Carga los datos FICTICIOS de Mi Taller en la cuenta de demostración usando los formularios reales de la app.
 *
 *   node scripts/demo/seed-mi-taller.mjs                    # MODO DE PRUEBA (por defecto): solo lee y lista qué crearía
 *   node scripts/demo/seed-mi-taller.mjs --apply            # escribe (todos los pasos pendientes)
 *   node scripts/demo/seed-mi-taller.mjs --apply --only=printers,filaments
 *
 * Pasos: profile, printers, filaments, categories, products, production.
 * Es idempotente: lo que ya existe se omite. Si un formulario no se comporta como se espera, el paso se DETIENE y
 * se informa; no se fuerzan escrituras ni se usa acceso directo a Supabase. Solo actúa con la sesión de la cuenta demo.
 */

import fs from "node:fs";
import path from "node:path";
import { HIDE_DEV_CSS, ensureSession, getConfig, launchBrowser, maskEmail, newSessionContext, redact, suppressTutorials } from "./lib.mjs";
import { DISPLAY_NAME, categories, filaments, printers, production, products } from "./mi-taller-data.mjs";

const apply = process.argv.includes("--apply");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7).split(",") : null;
const wants = (step) => !only || only.includes(step);
const SHOTS = process.env.DEMO_SHOTS_DIR || null; // carpeta opcional para capturas de verificación (nunca dentro del repo)

const config = getConfig();
console.log(`Modo:     ${apply ? "ESCRITURA (--apply)" : "PRUEBA (solo lectura)"}`);
console.log(`Servidor: ${config.baseUrl}`);
console.log(`Cuenta:   ${maskEmail(config.email)}\n`);

class StepStop extends Error {}
const stop = (message) => {
  throw new StepStop(message);
};

const browser = await launchBrowser();
const session = await ensureSession(browser, config);
console.log(`Sesión:   ${session}`);
const context = await newSessionContext(browser, config);
await suppressTutorials(context);
const page = await context.newPage();
page.setDefaultTimeout(15_000);

async function go(route) {
  await page.goto(route, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: HIDE_DEV_CSS });
  await page.waitForTimeout(500);
}
// En Configuración las etiquetas no están asociadas a sus campos: se localiza el campo que sigue a la etiqueta.
const fullNameField = () => page.locator('xpath=//*[normalize-space(text())="Nombre completo"]/following::input[1]');
const displayNameField = () => page.locator('xpath=//*[normalize-space(text())="Nombre para mostrar"]/following::input[1]');
const pageText = async () => (await page.evaluate(() => document.body.innerText)).toLowerCase();
const has = (text, needle) => text.includes(needle.toLowerCase());
async function shot(name) {
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  }
}

// ---------------------------------------------------------------- lectura del estado actual
const state = {};
await go("/configuracion");
state.displayName = await displayNameField().inputValue();
state.fullName = await fullNameField().inputValue();
await go("/mi-taller/impresoras");
{
  const t = await pageText();
  state.printers = printers.map((p) => ({ item: p, exists: has(t, p.name) }));
}
await go("/mi-taller/filamentos");
{
  const t = await pageText();
  state.filaments = filaments.map((f) => ({ item: f, exists: has(t, f.color) && has(t, f.brand) && has(t, f.type) }));
}
await go("/mi-taller/productos");
{
  const t = await pageText();
  state.categories = categories.map((c) => ({ item: c, exists: has(t, c) }));
  state.products = products.map((p) => ({ item: p, exists: has(t, p.name) }));
}
await go("/mi-taller");
{
  const t = await page.evaluate(() => document.body.innerText);
  const m = t.match(/Unidades terminadas\s*\n?\s*(\d+)/i);
  state.finishedUnits = m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------- plan
const mark = (exists) => (exists ? "existe  (se omite)" : "CREAR");
console.log("PLAN");
console.log(`  Perfil: nombre para mostrar → "${DISPLAY_NAME}"  [${state.displayName === DISPLAY_NAME ? "ya está" : "CAMBIAR"}]`);
console.log(`  Perfil: nombre completo (es el que muestra el encabezado) → "${DISPLAY_NAME}"  [${state.fullName === DISPLAY_NAME ? "ya está" : "CAMBIAR"}]`);
for (const { item, exists } of state.printers) console.log(`  Impresora   ${item.name} (${item.watts} W, $${item.maintenance}/h)  [${mark(exists)}]`);
for (const { item, exists } of state.filaments) console.log(`  Filamento   ${item.name} (${item.total} g, restante ${item.remaining} g)  [${mark(exists)}]`);
for (const { item, exists } of state.categories) console.log(`  Categoría   ${item}  [${mark(exists)}]`);
for (const { item, exists } of state.products) console.log(`  Producto    ${item.name} · ${item.printer} · ${item.hours} h ${item.minutes} min · ${item.material} ${item.grams} g  [${mark(exists)}]`);
const producing = state.finishedUnits === 0;
for (const r of production) console.log(`  Producción  ${r.product} × ${r.units}  [${state.finishedUnits === null ? "no se pudo leer el inventario" : producing ? "REGISTRAR" : `ya hay ${state.finishedUnits} unidades terminadas (se omite)`}]`);

if (!apply) {
  console.log("\nNo se escribió nada (modo de prueba). Para cargar: agregar --apply");
  await browser.close();
  process.exit(0);
}

// ---------------------------------------------------------------- escritura
const steps = {
  async profile() {
    if (state.displayName === DISPLAY_NAME && state.fullName === DISPLAY_NAME) return "sin cambios";
    await go("/configuracion");
    await displayNameField().fill(DISPLAY_NAME);
    await fullNameField().fill(DISPLAY_NAME);
    await shot("profile-before-save");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.waitForTimeout(1500);
    await go("/configuracion");
    const value = await displayNameField().inputValue();
    const full = await fullNameField().inputValue();
    if (value !== DISPLAY_NAME || full !== DISPLAY_NAME) stop(`el nombre no quedó guardado (para mostrar: "${value}", completo: "${full}")`);
    return "guardado";
  },

  async printers() {
    let created = 0;
    for (const { item, exists } of state.printers) {
      if (exists) continue;
      await go("/mi-taller/impresoras");
      await page.getByRole("button", { name: "Añadir impresora" }).first().click();
      await page.getByPlaceholder("Ej. Ender 3 V2").fill(item.name);
      await page.locator('input[type="number"]').nth(0).fill(String(item.watts));
      await page.locator('input[type="number"]').nth(1).fill(String(item.maintenance));
      await shot(`printer-${created}-form`);
      await page.getByRole("button", { name: "Guardar" }).click();
      await page.waitForTimeout(1500);
      await go("/mi-taller/impresoras");
      if (!has(await pageText(), item.name)) stop(`la impresora "${item.name}" no aparece después de guardar`);
      created++;
    }
    return `${created} creada(s)`;
  },
};

// Los pasos de filamentos, categorías, productos y producción se agregan abajo cuando se confirma cada formulario.
const extra = await import("./seed-mi-taller-steps.mjs").catch(() => ({}));
Object.assign(steps, extra.makeSteps?.({ page, go, pageText, has, shot, stop, state }) ?? {});

let failed = false;
for (const step of ["profile", "printers", "filaments", "categories", "products", "production"]) {
  if (!wants(step)) continue;
  if (!steps[step]) {
    console.log(`\n· ${step}: (aún no implementado)`);
    continue;
  }
  try {
    console.log(`\n· ${step}: ${await steps[step]()}`);
  } catch (error) {
    failed = true;
    console.error(`\n✖ ${step}: ${redact(error instanceof Error ? error.message : error, config)}`);
    if (error instanceof StepStop) console.error("  El paso se detuvo; no se fuerza nada. Revisá el formulario y avisame.");
    break;
  }
}
await browser.close();
process.exit(failed ? 2 : 0);
