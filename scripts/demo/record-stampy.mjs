/**
 * Graba una consulta REAL a Stampy IA con la cuenta de demostración (fotogramas; encode-video.mjs los convierte en MP4 + póster).
 *
 *   node scripts/demo/record-stampy.mjs <carpeta-de-fotogramas> [--question="..."]
 *
 * ADVERTENCIA: cada ejecución ENVÍA UNA CONSULTA REAL (llama a OpenAI con la clave del servidor y escribe una conversación,
 * 2 mensajes y un registro de uso en la cuenta demo; cuenta para el límite de 40/h). Por eso se ejecuta solo con autorización.
 * La respuesta se muestra tal cual la devuelve Stampy: nunca se edita. NO se confirma ninguna acción que Stampy proponga.
 */

import fs from "node:fs";
import path from "node:path";
import { createRecorder } from "./recorder-lib.mjs";

const outDir = process.argv[2] || "tmp-frames-stampy";
const questionArg = process.argv.find((a) => a.startsWith("--question="));
const QUESTION = questionArg ? questionArg.slice(11) : "Se me despegan las esquinas de la pieza en la primera capa. ¿Qué clase de Academia me puede ayudar?";
// Viewport más chico (misma proporción 16:10): al mostrarse dentro de la ventana de la landing el texto del chat se lee mejor.
const VIEWPORT = { width: 1120, height: 700 };

const r = await createRecorder({ outDir, startRoute: "/stampy", viewport: VIEWPORT });
const { page, sleep, moveTo, pointAt, clickOn, scrollBy, assertClean } = r;
const T0 = Date.now();
const scene = (name) => console.log(`  [${((Date.now() - T0) / 1000).toFixed(1)} s] ${name}`);
let answer = null;

try {
  // ---- 1. Estado vacío: sugerencias y acciones (que se confirman; no se ejecutan)
  scene("inicio");
  await assertClean("inicio");
  await moveTo(700, 420, 800);
  await sleep(1700);

  // ---- 2. La pregunta
  scene("pregunta");
  const input = page.getByPlaceholder(/Contale a Stampy/);
  await clickOn(input, 700);
  await page.keyboard.type(QUESTION, { delay: 36 });
  await sleep(700);

  // ---- 3. Envío: se muestra un instante de "pensando" y se recorta la espera restante
  scene("envío (CONSULTA REAL)");
  await page.keyboard.press("Enter");
  await sleep(1600);
  r.cutStart();
  await page.waitForFunction(() => [...document.querySelectorAll("span.sr-only")].some((s) => s.textContent?.trim() === "Stampy:"), null, { timeout: 90_000 });
  // La respuesta se entrega completa; se espera a que el chat se estabilice (sin indicador de escritura y con el envío habilitado).
  await sleep(1500);
  r.cutEnd();

  answer = await page.evaluate(() => {
    const spans = [...document.querySelectorAll("span.sr-only")].filter((s) => s.textContent?.trim() === "Stampy:");
    const root = spans[spans.length - 1]?.parentElement;
    return root ? root.innerText : null;
  });
  const hasCard = (await page.getByText("Abrir curso").count()) > 0;
  const proposesAction = (await page.getByRole("button", { name: /Confirmar|Aplicar|Aprobar/i }).count()) > 0;
  console.log(`  recomendación de clase visible: ${hasCard} · propone acción: ${proposesAction}`);
  await assertClean("respuesta");

  // ---- 4. Lectura: la pregunta y el comienzo de la respuesta; luego la recomendación de Academia
  scene("respuesta");
  await moveTo(640, 360, 600);
  const question = page.getByText(QUESTION.slice(0, 30)).first();
  const qBox = await question.boundingBox();
  if (qBox) await scrollBy(qBox.y - 110, 900);
  await sleep(2600);
  if (hasCard) {
    const card = page.getByText("Abrir curso").first();
    const cBox = await card.boundingBox();
    if (cBox) await scrollBy(cBox.y - VIEWPORT.height * 0.52, 3600);
    await sleep(500);
    // Énfasis visual de la recomendación (solo presentación: contorno y brillo; el texto no se toca).
    await page.evaluate(() => {
      const link = [...document.querySelectorAll("a")].find((a) => a.textContent?.includes("Abrir curso"));
      const card = link?.closest("div.group");
      if (card) {
        card.style.transition = "box-shadow .6s, border-color .6s";
        card.style.borderColor = "#ff780a";
        card.style.boxShadow = "0 0 0 1px #ff780a, 0 0 34px rgba(255,120,10,.45)";
      }
    });
    await pointAt(page.getByText("Abrir curso").first(), 900);
    await sleep(2600);
  } else {
    await scrollBy(500, 2500);
    await sleep(1500);
  }
} finally {
  fs.writeFileSync(path.join(path.resolve(outDir), "answer.txt"), answer ?? "(sin respuesta)");
  await r.finish();
}
console.log("\n--- RESPUESTA DE STAMPY (tal cual) ---\n" + (answer ?? "(sin respuesta)") + "\n--- fin ---");
