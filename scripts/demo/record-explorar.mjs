/**
 * Graba una búsqueda REAL en Explorar Modelos (cuenta de demostración): escribe una búsqueda, aplica filtros y recorre las tarjetas.
 *
 *   node scripts/demo/record-explorar.mjs [carpeta-de-fotogramas] [--query="..."]
 *
 * ADVERTENCIA: cada búsqueda y cada filtro consultan a los proveedores externos (Cults3D y MyMiniFactory) con las credenciales del
 * servidor. Son lecturas: no escriben nada en la cuenta ni en Supabase. Los resultados son los que devuelven los proveedores, sin tocar.
 * Las esperas de red se recortan del video; no se hace clic en «Ver modelo» (no se sale de la app).
 */

import { createRecorder } from "./recorder-lib.mjs";

const outDir = process.argv[2] || "tmp-frames-explorar";
const queryArg = process.argv.find((a) => a.startsWith("--query="));
const QUERY = queryArg ? queryArg.slice(8) : "soporte auriculares";

const r = await createRecorder({ outDir, startRoute: "/explorar-modelos" });
const { page, sleep, moveTo, clickOn, scrollBy, assertClean } = r;
const T0 = Date.now();
const scene = (name) => console.log(`  [${((Date.now() - T0) / 1000).toFixed(1)} s] ${name}`);

/**
 * Espera a que el buscador termine y las primeras miniaturas carguen; ese tramo se recorta del video. Algunos filtros se aplican en
 * el cliente sobre lo ya cargado (no hay respuesta de red nueva): por eso la respuesta es opcional.
 */
async function waitResults({ network = true } = {}) {
  if (network) await page.waitForResponse((res) => res.url().includes("/api/model-search"), { timeout: 10_000 }).catch(() => undefined);
  await page.getByText(/\d+ modelos? de/).first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => [...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight && i.getBoundingClientRect().width > 120).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30_000 }).catch(() => undefined);
  await sleep(700);
}
const summary = async () => (await page.getByText(/\d+ modelos? de/).first().textContent()) ?? "";

try {
  scene("inicio");
  await assertClean("inicio");
  await moveTo(760, 330, 800);
  await sleep(900);

  scene("búsqueda");
  await clickOn(page.getByPlaceholder(/Buscá un modelo/), 700);
  await page.keyboard.type(QUERY, { delay: 85 });
  await sleep(500);
  const first = waitResults();
  await page.keyboard.press("Enter");
  await sleep(700);
  r.cutStart();
  await first;
  r.cutEnd();
  console.log("   →", (await summary()).trim());
  await assertClean("resultados");
  await sleep(1600);

  scene("filtro de precio");
  await clickOn(page.getByRole("button", { name: /^Precio:/ }), 800);
  await sleep(400);
  await clickOn(page.getByRole("option", { name: /^Gratis/ }).first(), 600);
  const second = waitResults();
  await sleep(400);
  r.cutStart();
  await second;
  r.cutEnd();
  await sleep(1200);

  scene("filtro de fuente");
  await clickOn(page.getByRole("button", { name: /^Fuente:/ }), 800);
  await sleep(400);
  await clickOn(page.getByRole("option", { name: /MyMiniFactory/ }).first(), 600);
  const third = waitResults();
  await sleep(400);
  r.cutStart();
  await third;
  r.cutEnd();
  await sleep(1200);

  scene("filtro de uso comercial");
  await clickOn(page.getByRole("button", { name: /^Uso comercial:/ }), 800);
  await sleep(400);
  await clickOn(page.getByRole("option", { name: /^Permitido/ }).first(), 600);
  const fourth = waitResults();
  await sleep(400);
  r.cutStart();
  await fourth;
  r.cutEnd();
  console.log("   →", (await summary()).trim());
  await sleep(1300);
  await moveTo(760, 520, 600);
  await scrollBy(340, 1500);
  await sleep(2000);
  await assertClean("final");
} finally {
  await r.finish();
}
