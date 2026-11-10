/**
 * Graba el recorrido de Mi Taller (cuenta de demostración, datos ficticios) como una secuencia de fotogramas reales de la pantalla
 * (CDP Page.startScreencast). `encode-video.mjs` los convierte luego en MP4/WebM + póster.
 *
 *   node scripts/demo/record-mi-taller.mjs [carpeta-de-fotogramas]
 *
 * - Solo se navega y se pasa el cursor: la única apertura de formulario (Registrar producción) se CANCELA, nunca se confirma.
 * - El login no se graba (sesión guardada). Se ocultan montos y avisos de costos: nada comercial se ve en el video.
 * - Un cursor sintético se mueve de forma pausada para que las interacciones se vean (el navegador sin cabeza no dibuja cursor).
 */

import fs from "node:fs";
import path from "node:path";
import { HIDE_DEV_CSS, ensureSession, getConfig, launchBrowser, newSessionContext, suppressTutorials } from "./lib.mjs";

const OUT = path.resolve(process.argv[2] || path.join(process.cwd(), "tmp-frames"));
const VIEWPORT = { width: 1280, height: 800 };

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const config = getConfig();
const browser = await launchBrowser();
await ensureSession(browser, config);
const context = await newSessionContext(browser, config, { viewport: VIEWPORT });
await suppressTutorials(context);

// Enmascarado de montos/costos y cursor sintético: se inyectan en cada navegación.
await context.addInitScript(() => {
  const AMOUNT = /^\s*\$\s?[\d.,]+(\s?\/\s?h)?\s*$/;
  const RECALC = /^\s*requiere recalcular\s*$/i;
  const mask = () => {
    document.querySelectorAll("span, p, div, b, strong, td, dd").forEach((el) => {
      if (el.childElementCount !== 0) return;
      const text = el.textContent || "";
      if (AMOUNT.test(text)) {
        el.style.filter = "blur(7px)";
        el.style.userSelect = "none";
      } else if (RECALC.test(text) && el.parentElement) {
        el.parentElement.style.display = "none";
      }
    });
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      mask();
    });
  };
  const start = () => {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    mask();
    const cursor = document.createElement("div");
    cursor.id = "__demo_cursor";
    cursor.style.cssText = "position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(1400px,300px);will-change:transform";
    cursor.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.4 1.6L9.8 19 4 2z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const ripple = document.createElement("div");
    ripple.style.cssText = "position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #ff780a;background:rgba(255,120,10,.25);z-index:2147483646;pointer-events:none;opacity:0";
    document.body.append(ripple, cursor);
    addEventListener("mousemove", (e) => { cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
    addEventListener("mousedown", (e) => {
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      ripple.animate([{ opacity: 1, transform: "scale(.4)" }, { opacity: 0, transform: "scale(1.5)" }], { duration: 500, easing: "ease-out" });
    }, true);
  };
  if (document.body) start();
  else addEventListener("DOMContentLoaded", start);
});

const page = await context.newPage();
page.setDefaultTimeout(15_000);
await page.goto("/mi-taller/productos", { waitUntil: "networkidle" });
await page.addStyleTag({ content: `${HIDE_DEV_CSS} html{scrollbar-width:none} ::-webkit-scrollbar{display:none}` });
await page.waitForTimeout(800);

// Seguridad: el email de la cuenta no debe verse en pantalla en ninguna escena.
const assertClean = async (scene) => {
  const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  if (text.includes(config.email.toLowerCase())) throw new Error(`el email de la cuenta se ve en pantalla (escena ${scene}); se cancela la grabación`);
  if (/fredrich/i.test(text)) throw new Error(`aparece un nombre ajeno a la cuenta de demostración (escena ${scene})`);
};

// ------------------------------------------------------------ cursor
let cx = 1400;
let cy = 300;
const sleep = (ms) => page.waitForTimeout(ms);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function moveTo(x, y, ms = 650) {
  // Interpolación por tiempo real: la duración no depende de la latencia de cada movimiento.
  const sx = cx;
  const sy = cy;
  const t0 = Date.now();
  for (;;) {
    const t = (Date.now() - t0) / ms;
    if (t >= 1) break;
    const k = ease(t);
    await page.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k);
  }
  await page.mouse.move(x, y);
  cx = x;
  cy = y;
}
async function center(locator) {
  await locator.first().scrollIntoViewIfNeeded();
  const box = await locator.first().boundingBox();
  if (!box) throw new Error("elemento sin posición");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}
async function pointAt(locator, ms = 650, dx = 0, dy = 0) {
  const { x, y } = await center(locator);
  await moveTo(x + dx, y + dy, ms);
}
async function clickOn(locator, ms = 650) {
  await pointAt(locator, ms);
  await sleep(120);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}

// ------------------------------------------------------------ fotogramas
const client = await context.newCDPSession(page);
const frames = [];
let writing = Promise.resolve();
client.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const index = frames.length;
  const file = `f${String(index).padStart(5, "0")}.jpg`;
  frames.push({ t: metadata.timestamp, file });
  writing = writing.then(() => fs.promises.writeFile(path.join(OUT, file), Buffer.from(data, "base64")));
  client.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
});
await client.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 2 });
await sleep(500);

try {
  const scene = (name) => console.log(`  [${((Date.now() - T0) / 1000).toFixed(1)} s] ${name}`);
  const T0 = Date.now();
  // ---- 1. Productos
  scene("productos");
  await assertClean("productos");
  await moveTo(880, 430, 700);
  await sleep(500);
  await clickOn(page.getByRole("button", { name: /^Accesorios/ }), 600);
  await sleep(1000);
  await clickOn(page.getByRole("button", { name: /^Todas/ }), 500);
  await sleep(600);

  // ---- 2. Filamentos
  scene("filamentos");
  await clickOn(page.getByRole("link", { name: "Filamentos" }).first(), 600);
  await page.waitForURL(/\/mi-taller\/filamentos/);
  await page.getByText("Bambu Lab").first().waitFor();
  await sleep(700);
  await assertClean("filamentos");
  await clickOn(page.getByPlaceholder("Buscar filamentos..."), 600);
  await page.keyboard.type("PLA", { delay: 140 });
  await sleep(1000);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await sleep(500);

  // ---- 3. Impresoras
  scene("impresoras");
  await clickOn(page.getByRole("link", { name: "Impresoras" }).first(), 600);
  await page.waitForURL(/\/mi-taller\/impresoras/);
  await page.getByText("Bambu Lab A1").first().waitFor();
  await sleep(600);
  await assertClean("impresoras");
  await pointAt(page.getByText("Bambu Lab P1S", { exact: true }).first(), 600);
  await sleep(700);
  await pointAt(page.getByText("Bambu Lab A1", { exact: true }).first(), 500);
  await sleep(500);

  // ---- 4. Inventario (el formulario se abre para mostrar el cálculo y se CANCELA)
  scene("inventario");
  await clickOn(page.getByRole("link", { name: "Inventario" }).first(), 600);
  await page.waitForURL(/\/mi-taller\/inventario/);
  await page.getByText("Maceta geométrica").first().waitFor();
  await sleep(700);
  await assertClean("inventario");
  await clickOn(page.getByRole("button", { name: "Registrar producción" }).first(), 650);
  await page.getByRole("heading", { name: "Registrar producción" }).waitFor();
  await sleep(300);
  await clickOn(page.getByRole("button", { name: "Buscar producto o parte..." }), 550);
  await sleep(300);
  await clickOn(page.getByRole("option", { name: /Organizador de escritorio/ }).first(), 450);
  await clickOn(page.getByRole("button", { name: "Agregar", exact: true }), 450);
  await sleep(1400);
  await clickOn(page.getByRole("button", { name: "Cancelar" }), 550); // se cancela: no se escribe nada
  await sleep(400);

  // ---- cierre: vuelve a Productos (el mismo estado del inicio) para que el bucle sea natural
  scene("cierre");
  await clickOn(page.getByRole("link", { name: "Productos" }).first(), 650);
  await page.waitForURL(/\/mi-taller\/productos/);
  await page.getByText("Soporte para auriculares").first().waitFor();
  await moveTo(1180, 560, 500);
  await sleep(500);
  await assertClean("cierre");
} finally {
  await client.send("Page.stopScreencast").catch(() => undefined);
  await writing;
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ viewport: VIEWPORT, frames }, null, 0));
  await browser.close();
}
const span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
console.log(`Fotogramas: ${frames.length} · duración ${span.toFixed(1)} s · ${(frames.length / Math.max(span, 1)).toFixed(1)} fps medios → ${OUT}`);
