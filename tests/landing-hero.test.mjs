// Landing 5.1/5.2 — Hero 3D y sección de herramientas (/landing-preview): línea de tiempo del scroll, ruta pública independiente,
// limpieza de recursos y catálogo de herramientas basado en datos.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const timeline = loadTs("src/components/landing-hero/hero-timeline.ts");
const routes = loadTs("src/lib/auth/route-policy.ts");
const RIG = { baseZ: 14.5, endZ: -4.6 };
const tools = loadTs("src/components/landing-hero/universe-tools.ts");
const repoPath = (relativePath) => path.join(process.cwd(), relativePath);

test("la línea de tiempo arranca en exploración y termina en descubrimiento", () => {
  const start = timeline.computeTimeline(0, RIG);
  assert.equal(start.explode, 0);
  assert.equal(start.hero, 1);
  assert.equal(start.discovery, 0);
  assert.equal(start.dock, 0);
  assert.equal(start.camZ, RIG.baseZ);

  const end = timeline.computeTimeline(1, RIG);
  assert.equal(end.explode, 1);
  assert.equal(end.hero, 0);
  assert.equal(end.discovery, 1);
  assert.equal(end.dock, 1);
  assert.ok(Math.abs(end.camZ - RIG.endZ) < 1e-9);
});

test("el progreso se acota a 0..1 y la cámara avanza de forma monótona", () => {
  assert.deepEqual(timeline.computeTimeline(-3, RIG), timeline.computeTimeline(0, RIG));
  assert.deepEqual(timeline.computeTimeline(9, RIG), timeline.computeTimeline(1, RIG));
  let previous = Infinity;
  for (let p = 0; p <= 1.0001; p += 0.02) {
    const { camZ, explode } = timeline.computeTimeline(p, RIG);
    assert.ok(camZ <= previous + 1e-9, `camZ no debe retroceder en p=${p}`);
    assert.ok(explode >= 0 && explode <= 1);
    previous = camZ;
  }
});

test("el destello ocurre al atravesar el núcleo, no al inicio ni al final", () => {
  assert.equal(timeline.computeTimeline(0, RIG).flash, 0);
  assert.equal(timeline.computeTimeline(1, RIG).flash, 0);
  assert.ok(timeline.computeTimeline(0.585, RIG).flash > 0.9);
});

test("/landing es la landing definitiva (Hero 3D); la anterior vive en /landing-old y /landing-preview redirige", () => {
  for (const path of ["/landing", "/landing-old", "/landing-preview"]) assert.equal(routes.isPublicPath(path), true, path);
  const landing = read("src/app/landing/page.tsx");
  assert.match(landing, /<UniversoHero>/);
  assert.doesNotMatch(landing, /index: false/);
  const old = read("src/app/landing-old/page.tsx");
  assert.match(old, /LandingMembershipPage/);
  assert.match(old, /index: false/);
  assert.equal(fs.existsSync(repoPath("src/app/landing-preview/page.tsx")), false, "no queda una segunda página en /landing-preview");
  assert.match(read("next.config.ts"), /source: "\/landing-preview",\s*destination: "\/landing"/);
});

test("la escena libera sus recursos y no añade dependencias nuevas", () => {
  const scene = read("src/components/landing-hero/core-scene.ts");
  assert.match(scene, /renderer\.dispose\(\)/);
  assert.match(scene, /forceContextLoss\(\)/);
  assert.match(scene, /webglcontextlost/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies.gsap, undefined);
  assert.equal(pkg.dependencies["@react-three/fiber"], undefined);
  // Three.js se carga de forma diferida y solo en el navegador.
  assert.match(read("src/components/landing-hero/UniversoHero.tsx"), /dynamic\(\(\) => import\("\.\/HeroCoreCanvas"\), \{ ssr: false \}\)/);
});

test("la interfaz emerge tras el destello y se acopla a la sección siguiente solo cuando ya está formada", () => {
  const afterFlash = timeline.computeTimeline(0.6, RIG);
  assert.equal(afterFlash.discovery, 0);
  assert.ok(timeline.computeTimeline(0.74, RIG).discovery > 0.3);
  assert.equal(timeline.computeTimeline(0.88, RIG).discovery, 1);
  // El acople (la sección de herramientas se desliza sobre el escenario) no empieza antes de que la interfaz esté completa.
  assert.equal(timeline.computeTimeline(0.9, RIG).dock, 0);
  let previous = 0;
  for (let p = 0.9; p <= 1.0001; p += 0.01) {
    const { dock } = timeline.computeTimeline(p, RIG);
    assert.ok(dock >= previous - 1e-9 && dock <= 1);
    previous = dock;
  }
});

test("la variante de lámpara fue retirada y el núcleo es el único modelo de /landing", () => {
  assert.equal(fs.existsSync(repoPath("src/components/landing-hero/lamp-scene.ts")), false);
  const page = read("src/app/landing/page.tsx");
  assert.doesNotMatch(page, /modelo|lampara|searchParams/);
  const canvas = read("src/components/landing-hero/HeroCoreCanvas.tsx");
  assert.doesNotMatch(canvas, /Lamp|lampara|flashScale/);
  assert.match(read("src/components/landing-hero/core-scene.ts"), /export class HeroCoreScene/);
});

test("los objetos orbitantes y el núcleo digital siguen siendo compartidos con la escena del núcleo", () => {
  const core = read("src/components/landing-hero/core-scene.ts");
  assert.match(core, /new HeroOrbiters\(quality\.pieces\)/);
  assert.match(core, /new HeroDigitalCore\(/);
  assert.match(core, /orbiters\.dispose\(\)/);
  assert.match(core, /digitalCore\.dispose\(\)/);
  const models = read("src/components/landing-hero/printed-models.ts");
  for (const id of ["boat", "tower", "cube", "gear"]) assert.match(models, new RegExp(`${id}:`));
  // Identidad común: filamento marfil sin metal ni colores arcoíris, y sin presentar el barco como el 3DBenchy oficial.
  assert.match(models, /metalness: 0 \}/);
  assert.doesNotMatch(models, /0x5b7cff/);
  assert.match(models, /NO es 3DBenchy/);
});

test("el catálogo de herramientas es coherente: ids únicos, rutas reales y demostraciones existentes", () => {
  const list = tools.universeTools;
  assert.ok(list.length >= 2);
  assert.equal(new Set(list.map((tool) => tool.id)).size, list.length);
  for (const tool of list) {
    assert.ok(tool.route.startsWith("/"), `${tool.id}: ruta`);
    assert.ok(fs.existsSync(repoPath(`src/app${tool.route}`)), `${tool.id}: la ruta ${tool.route} no existe en src/app`);
    assert.ok(tool.demos.length >= 1 && tool.highlights.length >= 1, `${tool.id}: demos y puntos destacados`);
    assert.ok(["open", "member"].includes(tool.access));
    assert.equal(new Set(tool.demos.map((demo) => demo.id)).size, tool.demos.length, `${tool.id}: ids de demo únicos`);
    for (const demo of [...tool.demos, ...(tool.experimentalDemos ?? [])]) {
      const media = demo.media;
      if (media.kind === "image" || media.kind === "video") {
        assert.ok(fs.existsSync(repoPath(`public${media.src}`)), `${tool.id}/${demo.id}: falta ${media.src}`);
        assert.ok(media.alt.length > 10 && media.width > 0 && media.height > 0);
        if (media.kind === "video") {
          // Video de demostración: póster de respaldo y peso razonable para una landing (se descarga al elegir la herramienta).
          assert.ok(fs.existsSync(repoPath(`public${media.poster}`)), `${tool.id}/${demo.id}: falta el póster ${media.poster}`);
          assert.ok(fs.statSync(repoPath(`public${media.src}`)).size < 4 * 1024 * 1024, `${tool.id}/${demo.id}: el video supera 4 MB`);
          assert.ok(fs.statSync(repoPath(`public${media.poster}`)).size < 250 * 1024, `${tool.id}/${demo.id}: el póster supera 250 KB`);
          assert.match(media.src, /\.mp4$/);
        }
      } else {
        // Un marcador siempre explica que la demostración todavía no existe: nunca simula una pantalla.
        assert.equal(media.kind, "placeholder");
        assert.ok(media.note.length > 10);
      }
    }
  }
  // Stampa Maker sigue en beta privada: no se promociona en la landing, pero su definición se conserva para publicarlo después.
  assert.equal(list.some((tool) => tool.id === "stampa-maker"), false);
  const unlisted = tools.unlistedTools.find((tool) => tool.id === "stampa-maker");
  assert.ok(unlisted, "la definición de Stampa Maker debe conservarse fuera de la lista pública");
  assert.ok(fs.existsSync(repoPath("src/app/stampa-maker")));
  // Mi Negocio está deshabilitado a propósito (feature flag apagada): tampoco se promociona, pero su definición se conserva.
  assert.equal(list.some((tool) => tool.id === "mi-negocio"), false);
  assert.ok(tools.unlistedTools.some((tool) => tool.id === "mi-negocio"));
  assert.ok(fs.existsSync(repoPath("src/app/mi-negocio")));
  // La escena del Hero muestra una demostración real, no un marcador.
  assert.equal(tools.heroRevealTool.demos[0].media.kind, "image");
});

test("el video de demostración se reproduce sin sonido, en bucle, solo a la vista y respeta el movimiento reducido", () => {
  const video = read("src/components/landing-hero/DemoVideo.tsx");
  for (const pattern of [/muted/, /loop/, /playsInline/, /IntersectionObserver/, /video\.pause\(\)/, /poster=/, /animate/]) assert.match(video, pattern);
  assert.doesNotMatch(video, /controls/);
  assert.match(read("src/components/landing-hero/DemoWindow.tsx"), /<DemoVideo/);
  // Mi Taller usa el video real; las herramientas sin grabación conservan su marcador rotulado.
  for (const id of ["calculadora", "explorar-modelos", "mi-taller", "academia", "stampy"]) {
    const tool = tools.universeTools.find((candidate) => candidate.id === id);
    assert.equal(tool.demos[0].media.kind, "video", `${id}: debe usar video`);
  }
  // Los datos de la cuenta de demostración son ficticios y no contienen nada de Stampa.
  const data = read("scripts/demo/mi-taller-data.mjs");
  assert.match(data, /Demo Universo/);
  assert.doesNotMatch(data, /hellbot|ecofila|venta directa/i);
});

test("las versiones de respaldo solo se ven con ?comparar y no cambian la demostración pública", () => {
  const taller = tools.universeTools.find((tool) => tool.id === "mi-taller");
  assert.equal(taller.demos.length, 1, "la versión pública de Mi Taller es una sola");
  assert.equal(taller.demos[0].media.src, "/landing-preview/demos/mi-taller-cine-v2.mp4");
  // Las versiones anteriores se conservan como respaldo (con sus archivos), pero no son públicas.
  assert.deepEqual(taller.experimentalDemos.map((demo) => demo.media.src), ["/landing-preview/demos/mi-taller-cine.mp4", "/landing-preview/demos/mi-taller.mp4"]);
  // Academia y Stampy: la pública es la cinematográfica y la grabación original queda de respaldo (solo con ?comparar).
  for (const [id, pub, backup] of [["academia", "academia-cine", "academia"], ["stampy", "stampy-cine", "stampy"]]) {
    const tool = tools.universeTools.find((candidate) => candidate.id === id);
    assert.equal(tool.demos[0].media.src, `/landing-preview/demos/${pub}.mp4`);
    assert.deepEqual(tool.experimentalDemos.map((demo) => demo.media.src), [`/landing-preview/demos/${backup}.mp4`]);
  }
  // Calculadora y Explorar Modelos: la pública es el video y las capturas estáticas originales quedan de respaldo.
  for (const id of ["calculadora", "explorar-modelos"]) {
    const tool = tools.universeTools.find((candidate) => candidate.id === id);
    assert.match(tool.demos[0].media.src, /-cine\.mp4$/);
    assert.ok(tool.experimentalDemos.length >= 1 && tool.experimentalDemos.every((demo) => demo.media.kind === "image"), `${id}: el respaldo son las capturas`);
  }
  // La transición del Hero sigue usando la captura estática (no un video).
  assert.equal(tools.heroRevealTool.demos[0].media.kind, "image");
  const compared = tools.withComparison(tools.universeTools).find((tool) => tool.id === "mi-taller");
  assert.deepEqual(compared.demos.map((demo) => demo.label), ["Recorrido", "Versión anterior", "Original sin fotos"]);
  const explorer = read("src/components/landing-hero/ToolsExplorer.tsx");
  assert.match(explorer, /has\("comparar"\)/);
  assert.doesNotMatch(read("src/app/landing/page.tsx"), /searchParams/);
});

test("los datos y las imágenes de la cuenta de demostración son originales y ficticios", () => {
  const data = read("scripts/demo/mi-taller-data.mjs");
  for (const file of Object.values(tools_dataImages(data))) assert.ok(fs.existsSync(repoPath(`scripts/demo/assets/products/${file}`)), `falta la imagen ${file}`);
  // Los renders se generan por código (sin fotos ni modelos de terceros).
  const render = read("scripts/demo/render-product-images.mjs");
  assert.match(render, /Three\.js/);
  assert.doesNotMatch(render, /https?:\/\/(?!render\.local)/);
});

function tools_dataImages(source) {
  const block = source.slice(source.indexOf("export const productImages"));
  return Object.fromEntries([...block.matchAll(/"([^"]+)": "([^"]+\.jpg)"/g)].map((m) => [m[1], m[2]]));
}

test("la sección de herramientas es genérica: no nombra herramientas, es accesible y respeta el movimiento reducido", () => {
  const explorer = read("src/components/landing-hero/ToolsExplorer.tsx");
  for (const name of ["Calculadora", "Mi Taller", "Stampy", "Academia"]) assert.doesNotMatch(explorer, new RegExp(name));
  assert.match(explorer, /role="tablist"/);
  assert.match(explorer, /role="tab"/);
  assert.match(explorer, /role="tabpanel"/);
  assert.match(explorer, /ArrowDown/);
  assert.match(explorer, /reducedMotion/);
  // La interfaz de la transición y la de la sección son la misma ventana.
  assert.match(read("src/components/landing-hero/HeroDiscovery.tsx"), /DemoWindow/);
  assert.match(explorer, /DemoWindow/);
  // Sin dependencias nuevas ni backend: la sección es solo front.
  assert.doesNotMatch(explorer + read("src/components/landing-hero/universe-tools.ts"), /supabase|mercadopago|fetch\(/i);
});

test("equipos modestos muestran menos objetos orbitantes", () => {
  const quality = read("src/components/landing-hero/hero-quality.ts");
  assert.match(quality, /case "low":\s*\n?\s*return \{ tier, layers: 26, pieces: 3,/);
  assert.match(quality, /layers: 46, pieces: 4,/);
});
