/**
 * Graba el recorrido de Academia (cuenta de demostración) como fotogramas reales; encode-video.mjs los convierte en MP4 + póster.
 *
 *   node scripts/demo/record-academia.mjs [carpeta-de-fotogramas]
 *
 * Solo se navega, se filtra la grilla de cursos y se cambia de clase. NO se reproduce ningún video, no se marca progreso,
 * no se inscribe a nadie y no se envía nada a Stampy.
 */

import { createRecorder } from "./recorder-lib.mjs";

const outDir = process.argv[2] || "tmp-frames-academia";
// El reproductor de video de las clases arranca solo si el navegador lo permite: se exige interacción en el documento actual,
// así que en la grabación se ve su miniatura (en pausa) y no una clase reproduciéndose.
const r = await createRecorder({ outDir, startRoute: "/academia", launchArgs: ["--autoplay-policy=document-user-activation-required"] });
const { page, sleep, moveTo, pointAt, clickOn, scrollBy, assertClean } = r;
// Portadas visibles ya cargadas (las de más abajo son diferidas y no se esperan).
const imagesReady = () => page.waitForFunction(() => [...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight).every((i) => i.complete && i.naturalWidth > 0));

const T0 = Date.now();
const scene = (name) => console.log(`  [${((Date.now() - T0) / 1000).toFixed(1)} s] ${name}`);

try {
  // ---- 1. Portada de Academia y ruta recomendada
  scene("academia");
  await assertClean("academia");
  await moveTo(820, 330, 700);
  await sleep(600);
  await scrollBy(430, 1100);
  await sleep(2300);
  await assertClean("ruta recomendada");
  await scrollBy(-430, 800);
  await sleep(300);

  // ---- 2. Cursos: la grilla (con Bambu Studio Principiantes) y el buscador
  scene("cursos");
  await clickOn(page.getByRole("link", { name: /Explorar cursos/i }).first(), 650);
  r.cutStart();
  await page.waitForURL(/\/cursos$/);
  await page.getByText("BAMBU STUDIO PRINCIPIANTES").first().waitFor();
  await imagesReady();
  r.cutEnd();
  await sleep(900);
  await assertClean("cursos");
  await clickOn(page.getByPlaceholder("Buscar cursos..."), 600);
  await page.keyboard.type("Bambu", { delay: 140 });
  await sleep(1100);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await sleep(600);

  // ---- 3. Un curso por dentro: progreso, reproductor (miniatura real, sin reproducir) y lista de clases
  scene("curso");
  await clickOn(page.locator('a[href="/cursos/fundamentos"]').first(), 700);
  r.cutStart(); // se recorta la espera de carga de la página del curso
  await page.waitForURL(/\/cursos\/fundamentos/);
  // El reproductor de la app (iframe de video) arranca solo si la página tiene una interacción previa. Una recarga completa
  // (dentro del tramo recortado) deja el documento sin esa interacción: el reproductor queda en pausa con su miniatura real.
  await page.reload({ waitUntil: "domcontentloaded" });
  await r.afterNavigation();
  await page.getByText("Contenido del curso").first().waitFor();
  await page.getByText("Cargando la clase...").waitFor({ state: "detached" }).catch(() => undefined);
  await sleep(1200); // el reproductor muestra su miniatura real
  r.cutEnd();
  await sleep(1600);
  await assertClean("curso");
  await pointAt(page.getByText("Tu progreso").first(), 700, 60, 0);
  await sleep(1900);
  // La app reproduce sola la clase que se elige: se desplaza la vista para que el reproductor quede fuera de cuadro.
  await scrollBy(720, 1100);
  await sleep(400);
  await clickOn(page.getByRole("button", { name: /Clase 2 - Slicers/ }).first(), 700);
  await sleep(120); // se ve la clase activa en la lista; al elegirla la app lleva la vista al reproductor y lo pone en marcha
  await assertClean("clase");

  // ---- 4. Cierre: vuelve a la portada (el mismo estado del inicio) para que el bucle sea natural.
  // La vuelta se hace dentro de un tramo recortado para que el video nunca muestre una clase reproduciéndose.
  scene("cierre");
  r.cutStart();
  await page.goto("/academia", { waitUntil: "networkidle" });
  await r.afterNavigation();
  await page.getByText("Seguí tu ruta recomendada").first().waitFor();
  await page.locator('a[href="/cursos/fundamentos"]').first().waitFor();
  await imagesReady();
  r.cutEnd();
  await moveTo(820, 330, 500);
  await sleep(900);
  await assertClean("cierre");
} finally {
  await r.finish();
}
