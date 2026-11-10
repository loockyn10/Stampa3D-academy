/**
 * Mejora visual de la cuenta de demostración de Mi Taller, solo con la interfaz real:
 *  1. impresoras: se reemplazan las 2 manuales (sin foto) por las del catálogo de Stampa (con foto) y se suma una A1 Mini;
 *  2. fotos de los 3 productos existentes (formulario de producto → «Subir Imagen» → editor de recorte → «Usar imagen»);
 *  3. 3 productos adicionales con foto y su producción.
 *
 *   DEMO_BASE_URL=http://localhost:3100 node scripts/demo/seed-mi-taller-visual.mjs [--apply] [--only=printers,images,products,production]
 *
 * Usar un servidor de PRODUCCIÓN local (next start): en `next dev` el editor de recorte falla (React StrictMode revoca la URL del archivo).
 * Modo de prueba por defecto. Idempotente. Se detiene ante cualquier formulario inesperado. Solo actúa con la sesión de la cuenta demo.
 */

import path from "node:path";
import { HIDE_DEV_CSS, ensureSession, getConfig, launchBrowser, maskEmail, newSessionContext, redact, suppressTutorials } from "./lib.mjs";
import { catalogPrinters, extraProducts, extraProduction, productImages, products, replacedPrinters } from "./mi-taller-data.mjs";

const apply = process.argv.includes("--apply");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7).split(",") : null;
const wants = (s) => !only || only.includes(s);
const IMAGES_DIR = path.join(process.cwd(), "scripts", "demo", "assets", "products");

const config = getConfig();
console.log(`Modo:     ${apply ? "ESCRITURA (--apply)" : "PRUEBA (solo lectura)"}`);
console.log(`Servidor: ${config.baseUrl}`);
console.log(`Cuenta:   ${maskEmail(config.email)}\n`);

class StepStop extends Error {}
const stop = (m) => {
  throw new StepStop(m);
};

const browser = await launchBrowser();
await ensureSession(browser, config);
const context = await newSessionContext(browser, config, { viewport: { width: 1280, height: 1250 } });
await suppressTutorials(context);
const page = await context.newPage();
page.setDefaultTimeout(20_000);

async function go(route) {
  await page.goto(route, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: HIDE_DEV_CSS });
  await page.waitForTimeout(700);
}

/** Impresoras listadas: nombre, foto y si están activas. Mi Taller no borra: «Eliminar» solo las deja Inactivas (siguen listadas). */
async function readPrinters() {
  await go("/mi-taller/impresoras");
  return page.evaluate(() =>
    [...document.querySelectorAll("h4")].map((h) => {
      const c = h.closest("div[class*='rounded']");
      return { name: h.textContent.trim(), photo: !!c?.querySelector("img"), active: /(^|\s)Activa(\s|$)/.test(c?.innerText ?? "") };
    }),
  );
}
/** Productos visibles: nombre y si tienen miniatura. */
async function readProducts() {
  await go("/mi-taller/productos");
  return page.evaluate(() =>
    [...document.querySelectorAll("h3")]
      .filter((h) => h.parentElement?.parentElement?.querySelector("img, svg") && h.textContent.trim().length > 2)
      .map((h) => {
        let n = h;
        for (let i = 0; i < 4 && n; i++) {
          if (n.querySelector && [...n.querySelectorAll("button")].some((b) => /Editar/.test(b.textContent))) break;
          n = n.parentElement;
        }
        return { name: h.textContent.trim(), photo: !!n?.querySelector("img"), isCard: !!n && [...n.querySelectorAll("button")].some((b) => /Editar/.test(b.textContent)) };
      })
      .filter((x) => x.isCard),
  );
}

// ---------------------------------------------------------------- estado actual y plan
const printersNow = await readPrinters();
const productsNow = await readProducts();
console.log("Estado actual");
console.log("  Impresoras:", JSON.stringify(printersNow));
console.log("  Productos: ", JSON.stringify(productsNow.map(({ name, photo }) => ({ name, photo }))));

console.log("\nPLAN");
for (const r of replacedPrinters) {
  const cur = printersNow.find((p) => p.name === r && p.active && !p.photo);
  console.log(`  Impresora   desactivar la manual «${r}» (sin foto)  [${cur ? "DESACTIVAR" : "ya inactiva / no está"}]`);
}
for (const p of catalogPrinters) console.log(`  Impresora   importar «${p.catalog}» como «${p.name}»  [${printersNow.some((x) => x.name === p.name && x.photo && x.active) ? "ya está" : "IMPORTAR"}]`);
for (const p of products) console.log(`  Foto        ${p.name} ← ${productImages[p.name]}  [${productsNow.find((x) => x.name === p.name)?.photo ? "ya tiene" : "SUBIR"}]`);
for (const p of extraProducts) console.log(`  Producto    ${p.name} · ${p.printer} · ${p.hours} h ${p.minutes} min · ${p.material} ${p.grams} g + foto  [${productsNow.some((x) => x.name === p.name) ? "existe" : "CREAR"}]`);
for (const r of extraProduction) console.log(`  Producción  ${r.product} × ${r.units}  [solo si su inventario está en 0]`);

if (!apply) {
  console.log("\nNo se escribió nada (modo de prueba). Para aplicar: agregar --apply");
  await browser.close();
  process.exit(0);
}

// ---------------------------------------------------------------- escritura
/** Tarjeta (activa) con ese título: puede haber una Inactiva con el mismo nombre (la manual que se reemplazó). */
const card = (heading) =>
  page.getByRole("heading", { name: heading, exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded')][1]").filter({ hasNotText: /Inactiva/ });

async function uploadImage(file) {
  await page.locator('input[type="file"]').first().setInputFiles(path.join(IMAGES_DIR, file));
  await page.getByRole("button", { name: "Usar imagen" }).click();
  await page
    .waitForFunction(() => /product-images/.test(document.querySelector('input[name="image_url"]')?.value || ""), null, { timeout: 40_000 })
    .catch(() => stop("la imagen no terminó de subir"));
}

const picker = async (button, optionText) => {
  await button.click();
  const option = page.getByRole("option", { name: new RegExp(optionText) }).first();
  if (await option.count()) await option.click();
  else await page.getByText(optionText, { exact: false }).last().click();
  await page.waitForTimeout(250);
};
const after = (label) => page.locator(`xpath=//*[starts-with(normalize-space(text()),"${label}")]/following::*[self::input or self::select or self::textarea][1]`).last();

const steps = {
  async printers() {
    for (const name of replacedPrinters) {
      const cur = (await readPrinters()).find((p) => p.name === name && p.active && !p.photo);
      if (!cur) continue;
      await card(name).locator('button:has(svg[class*="trash"])').click();
      await page.getByRole("button", { name: "Eliminar impresora" }).click();
      await page.waitForTimeout(1500);
      if ((await readPrinters()).some((p) => p.name === name && p.active && !p.photo)) stop(`no se pudo desactivar «${name}»`);
    }
    let imported = 0;
    for (const target of catalogPrinters) {
      if ((await readPrinters()).some((p) => p.name === target.name && p.photo && p.active)) continue;
      await page.getByRole("button", { name: "Importar desde catálogo Stampa" }).first().click();
      await page.getByPlaceholder(/Buscar por marca/).fill(target.catalog);
      await page.waitForTimeout(1200);
      const item = page.getByRole("heading", { name: target.catalog, exact: true }).locator("xpath=ancestor::div[.//button[contains(.,'Agregar a mis impresoras')]][1]");
      if ((await item.count()) !== 1) stop(`el catálogo no devolvió exactamente una «${target.catalog}»`);
      await item.getByRole("button", { name: /Agregar a mis impresoras/ }).click();
      await page.waitForTimeout(2000);
      const added = (await readPrinters()).find((p) => p.name === target.catalog && p.active);
      if (!added) stop(`«${target.catalog}» no apareció después de importarla`);
      if (target.catalog !== target.name) {
        await card(target.catalog).locator('button:has(svg[class*="edit"], svg[class*="pen"])').first().click();
        await page.getByPlaceholder("Ej. Ender 3 V2").fill(target.name);
        await page.getByRole("button", { name: "Guardar" }).click();
        await page.waitForTimeout(1500);
      }
      const final = (await readPrinters()).find((p) => p.name === target.name && p.active);
      if (!final?.photo) stop(`«${target.name}» quedó sin foto`);
      imported++;
    }
    return `${imported} importada(s)`;
  },

  async images() {
    let done = 0;
    for (const p of products) {
      if ((await readProducts()).find((x) => x.name === p.name)?.photo) continue;
      await go("/mi-taller/productos");
      await card(p.name).getByRole("button", { name: "Editar" }).click();
      await page.getByText("Imagen del Producto").waitFor();
      await uploadImage(productImages[p.name]);
      await page.getByRole("button", { name: "Guardar" }).click();
      await page.waitForTimeout(2200);
      if (!(await readProducts()).find((x) => x.name === p.name)?.photo) stop(`«${p.name}» sigue sin foto`);
      done++;
    }
    return `${done} foto(s) subida(s)`;
  },

  async products() {
    let created = 0;
    for (const item of extraProducts) {
      if ((await readProducts()).some((x) => x.name === item.name)) continue;
      await go("/mi-taller/productos");
      await page.getByRole("button", { name: "Nuevo producto" }).first().click();
      await page.getByText("Nuevo Producto", { exact: true }).waitFor();
      await page.getByPlaceholder("Ej. Llavero personalizado").fill(item.name);
      await page.getByPlaceholder("Horas").fill(String(item.hours));
      await page.getByPlaceholder("Minutos").fill(String(item.minutes));
      await picker(page.getByRole("button", { name: "Sin categoría" }), item.category);
      await picker(page.locator('button:has-text("disponibles")').first(), item.material);
      await page.getByPlaceholder("Gramos").fill(String(item.grams));
      await picker(page.locator('xpath=//*[normalize-space(text())="Impresora"]/following::button[1]'), item.printer);
      const typeButton = page.locator('xpath=//*[normalize-space(text())="Tipo de producto"]/following::button[1]');
      if (!/minorista/i.test((await typeButton.textContent()) ?? "")) stop('el tipo de producto no es "Minorista"');
      await after("Costo Base").fill(String(item.baseCost));
      await after("Precio Venta").fill(String(item.salePrice));
      await uploadImage(productImages[item.name]);
      await page.getByRole("button", { name: "Guardar" }).click();
      await page.waitForTimeout(2200);
      if (!(await readProducts()).find((x) => x.name === item.name)?.photo) stop(`«${item.name}» no quedó guardado con foto`);
      created++;
    }
    return `${created} creado(s)`;
  },

  async production() {
    let done = 0;
    for (const r of extraProduction) {
      await go("/mi-taller/inventario");
      const row = page.getByText(r.product, { exact: true }).first().locator("xpath=ancestor::tr[1]");
      if (!(await row.count())) stop(`«${r.product}» no figura en Inventario`);
      const qty = Number(((await row.innerText()).match(/\$[\d.,]+\s+(\d+)/) || [])[1] ?? NaN);
      if (qty !== 0) continue;
      await page.getByRole("button", { name: "Registrar producción" }).first().click();
      await page.getByRole("heading", { name: "Registrar producción" }).waitFor();
      await page.getByRole("button", { name: "Buscar producto o parte..." }).click();
      const option = page.getByRole("option", { name: new RegExp(r.product) }).first();
      if (await option.count()) await option.click();
      else await page.getByText(r.product, { exact: false }).last().click();
      await page.getByRole("button", { name: "Agregar", exact: true }).click();
      await page.waitForTimeout(500);
      const dialog = page.locator('xpath=//h3[normalize-space()="Registrar producción"]/ancestor::div[.//button[normalize-space()="Confirmar producción"]][1]');
      await dialog.locator('input[type="number"]').first().fill(String(r.units));
      await page.getByRole("button", { name: "Confirmar producción" }).click();
      await page.waitForTimeout(2500);
      done++;
    }
    return `${done} registro(s)`;
  },
};

let failed = false;
for (const step of ["printers", "images", "products", "production"]) {
  if (!wants(step)) continue;
  try {
    console.log(`\n· ${step}: ${await steps[step]()}`);
  } catch (error) {
    failed = true;
    console.error(`\n✖ ${step}: ${redact(error instanceof Error ? error.message : error, config)}`);
    if (error instanceof StepStop) console.error("  El paso se detuvo; no se fuerza nada.");
    break;
  }
}
await browser.close();
process.exit(failed ? 2 : 0);
