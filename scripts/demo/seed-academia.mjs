/**
 * Prepara la cuenta de demostración para el recorrido de Academia, usando la interfaz real:
 *  - preferencia de impresora principal: Flashforge → Bambu Lab (para que la ruta recomendada no contradiga Mi Taller);
 *  - progreso: las 2 primeras clases de "Fundamentos Express" marcadas como completadas.
 *
 *   node scripts/demo/seed-academia.mjs            # MODO DE PRUEBA: solo lee y lista qué cambiaría
 *   node scripts/demo/seed-academia.mjs --apply    # escribe (solo en la cuenta de demostración)
 *
 * Idempotente. Solo se usa el botón «Marcar completada» sobre clases concretas: nada se reproduce ni se inscribe.
 */

import { HIDE_DEV_CSS, ensureSession, getConfig, launchBrowser, maskEmail, newSessionContext, redact, suppressTutorials } from "./lib.mjs";

const apply = process.argv.includes("--apply");
const BRAND = { label: "Bambu Lab", model: "A1" };
const COURSE = "/cursos/fundamentos";
const LESSONS = ["Clase 0 - Introducción", "Clase 1 - Principios del FDM"];

const config = getConfig();
console.log(`Modo:     ${apply ? "ESCRITURA (--apply)" : "PRUEBA (solo lectura)"}`);
console.log(`Servidor: ${config.baseUrl}`);
console.log(`Cuenta:   ${maskEmail(config.email)}\n`);

const browser = await launchBrowser();
await ensureSession(browser, config);
const context = await newSessionContext(browser, config);
await suppressTutorials(context);
const page = await context.newPage();
page.setDefaultTimeout(15_000);

async function go(route, wait = 600) {
  // La página del curso mantiene el reproductor de video conectado: no llega a "networkidle".
  await page.goto(route, { waitUntil: route.startsWith("/cursos/") ? "domcontentloaded" : "networkidle" });
  if (route.startsWith("/cursos/")) await page.getByText("Contenido del curso").first().waitFor();
  await page.addStyleTag({ content: HIDE_DEV_CSS });
  await page.waitForTimeout(wait);
}
const brandSelect = () => page.locator('xpath=//*[normalize-space(text())="Marca"]/following::select[1]');
const modelInput = () => page.locator('xpath=//*[normalize-space(text())="Modelo"]/following::input[1]');
const completedCount = async () => {
  const text = await page.evaluate(() => document.body.innerText);
  const match = text.match(/Contenido del curso\s*\n?\s*(\d+) de (\d+)/);
  return match ? Number(match[1]) : null;
};

// ------------------------------------------------------------ lectura
await go("/configuracion");
const current = { brand: await brandSelect().inputValue(), model: await modelInput().inputValue() };
await go(COURSE, 2500);
const done = await completedCount();

console.log("PLAN");
console.log(`  Perfil: impresora principal ${current.brand} ${current.model} → ${BRAND.label} ${BRAND.model}  [${/bambu/i.test(current.brand) && current.model === BRAND.model ? "ya está" : "CAMBIAR"}]`);
for (const lesson of LESSONS) console.log(`  Progreso:   «${lesson}» → completada  [${done === null ? "no se pudo leer el progreso" : done >= LESSONS.length ? "ya hay ≥ 2 completadas (se omite)" : "MARCAR"}]`);
console.log(`  (progreso actual de Fundamentos: ${done ?? "?"} de 7 clases)`);

if (!apply) {
  console.log("\nNo se escribió nada (modo de prueba). Para aplicar: agregar --apply");
  await browser.close();
  process.exit(0);
}

// ------------------------------------------------------------ escritura
let failed = false;
try {
  if (!(/bambu/i.test(current.brand) && current.model === BRAND.model)) {
    await go("/configuracion");
    await brandSelect().selectOption({ label: BRAND.label });
    await modelInput().fill(BRAND.model);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.waitForTimeout(1800);
    await go("/configuracion");
    const after = { brand: await brandSelect().inputValue(), model: await modelInput().inputValue() };
    if (!/bambu/i.test(after.brand) || after.model !== BRAND.model) throw new Error(`la preferencia no quedó guardada (marca "${after.brand}", modelo "${after.model}")`);
    console.log("\n· perfil: impresora principal guardada");
  }

  if (done !== null && done < LESSONS.length) {
    for (let i = 0; i < LESSONS.length; i++) {
      await go(COURSE, 2000);
      if ((await completedCount()) > i) continue; // ya estaba marcada
      await page.getByRole("button", { name: new RegExp(LESSONS[i]) }).first().click();
      await page.waitForTimeout(1200);
      const toggle = page.getByRole("button", { name: /^Marcar completada$/ });
      if (!(await toggle.count())) throw new Error(`«${LESSONS[i]}» ya figura como completada o no se encontró el botón`);
      await toggle.first().click();
      await page.waitForTimeout(1800);
      await go(COURSE, 2000);
      const n = await completedCount();
      if (n === null || n < i + 1) throw new Error(`el progreso no se guardó tras «${LESSONS[i]}» (completadas: ${n})`);
    }
    console.log(`· progreso: ${await completedCount()} de 7 clases completadas`);
  }
} catch (error) {
  failed = true;
  console.error(`\n✖ ${redact(error instanceof Error ? error.message : error, config)}\n  Se detuvo; no se fuerza nada.`);
}
await browser.close();
process.exit(failed ? 2 : 0);
