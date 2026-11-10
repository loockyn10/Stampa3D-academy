/**
 * Base común para grabar recorridos de la landing (la usa record-academia.mjs): sesión de la cuenta demo, cursor sintético con
 * clic visible, movimientos por tiempo real, scroll suave, enmascarado opcional de montos y captura de fotogramas por CDP.
 * (record-mi-taller.mjs conserva su propia copia: esa demostración está aprobada y no se toca.)
 */

import fs from "node:fs";
import path from "node:path";
import { HIDE_DEV_CSS, ensureSession, getConfig, launchBrowser, newSessionContext, suppressTutorials } from "./lib.mjs";

const CURSOR_AND_MASK = ({ maskAmounts }) => {
  const AMOUNT = /^\s*\$\s?[\d.,]+(\s?\/\s?h)?\s*$/;
  const mask = () => {
    if (!maskAmounts) return;
    document.querySelectorAll("span, p, div, b, strong, td, dd").forEach((el) => {
      if (el.childElementCount === 0 && AMOUNT.test(el.textContent || "")) el.style.filter = "blur(7px)";
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
};

export async function createRecorder({ outDir, startRoute, viewport = { width: 1280, height: 800 }, maskAmounts = false, waitUntil = "networkidle", launchArgs = [] }) {
  const OUT = path.resolve(outDir);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const config = getConfig();
  const browser = await launchBrowser(launchArgs);
  await ensureSession(browser, config);
  const context = await newSessionContext(browser, config, { viewport });
  await suppressTutorials(context);
  await context.addInitScript(CURSOR_AND_MASK, { maskAmounts });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(startRoute, { waitUntil });
  await page.addStyleTag({ content: `${HIDE_DEV_CSS} html{scrollbar-width:none} ::-webkit-scrollbar{display:none}` });
  await page.waitForTimeout(800);

  const assertClean = async (scene) => {
    const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    if (text.includes(config.email.toLowerCase())) throw new Error(`el email de la cuenta se ve en pantalla (escena ${scene}); se cancela la grabación`);
    if (/fredrich/i.test(text)) throw new Error(`aparece un nombre ajeno a la cuenta de demostración (escena ${scene})`);
  };

  let cx = 1400;
  let cy = 300;
  const sleep = (ms) => page.waitForTimeout(ms);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  async function moveTo(x, y, ms = 650) {
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
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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
  /** Scroll con la rueda, repartido en el tiempo (el cursor debe estar sobre el contenido). */
  async function scrollBy(dy, ms = 900) {
    const t0 = Date.now();
    let done = 0;
    for (;;) {
      const t = Math.min(1, (Date.now() - t0) / ms);
      const target = dy * ease(t);
      const step = target - done;
      if (Math.abs(step) >= 1) {
        await page.mouse.wheel(0, step);
        done += step;
      }
      if (t >= 1) break;
    }
  }

  // Fotogramas
  const client = await context.newCDPSession(page);
  const frames = [];
  let writing = Promise.resolve();
  client.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = `f${String(frames.length).padStart(5, "0")}.jpg`;
    frames.push({ t: metadata.timestamp, file });
    writing = writing.then(() => fs.promises.writeFile(path.join(OUT, file), Buffer.from(data, "base64")));
    client.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
  });
  await client.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 2 });
  await sleep(500);

  /** Tras una recarga completa: vuelve a aplicar el CSS de grabación y reubica el cursor sintético donde estaba. */
  const afterNavigation = async () => {
    await page.addStyleTag({ content: `${HIDE_DEV_CSS} html{scrollbar-width:none} ::-webkit-scrollbar{display:none}` });
    await page.mouse.move(cx, cy);
  };

  // Tramos que se recortan del video (esperas de carga): se anotan en el manifiesto y los aplica encode-video.mjs.
  const cuts = [];
  let cutFrom = null;
  const cutStart = () => { cutFrom = Date.now() / 1000; };
  const cutEnd = () => { if (cutFrom !== null) cuts.push([cutFrom, Date.now() / 1000]); cutFrom = null; };

  async function finish() {
    await client.send("Page.stopScreencast").catch(() => undefined);
    await writing;
    fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ viewport, frames, cuts }));
    await browser.close();
    const span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
    console.log(`Fotogramas: ${frames.length} · duración ${span.toFixed(1)} s · ${(frames.length / Math.max(span, 1)).toFixed(1)} fps medios → ${OUT}`);
  }

  return { page, config, sleep, moveTo, pointAt, clickOn, scrollBy, assertClean, cutStart, cutEnd, afterNavigation, finish };
}
