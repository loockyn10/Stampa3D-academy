// Sprint 5.1 — Hero 3D (/landing-preview): línea de tiempo del scroll, ruta pública independiente y limpieza de recursos.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const timeline = loadTs("src/components/landing-hero/hero-timeline.ts");
const routes = loadTs("src/lib/auth/route-policy.ts");
const RIG = { baseZ: 14.5, endZ: -4.6 };

test("la línea de tiempo arranca en exploración y termina en descubrimiento", () => {
  const start = timeline.computeTimeline(0, RIG);
  assert.equal(start.explode, 0);
  assert.equal(start.hero, 1);
  assert.equal(start.discovery, 0);
  assert.equal(start.camZ, RIG.baseZ);

  const end = timeline.computeTimeline(1, RIG);
  assert.equal(end.explode, 1);
  assert.equal(end.hero, 0);
  assert.equal(end.discovery, 1);
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

test("/landing-preview es pública, no indexable y no reemplaza a /landing", () => {
  assert.equal(routes.isPublicPath("/landing-preview"), true);
  assert.match(read("src/app/landing-preview/page.tsx"), /index: false/);
  assert.match(read("src/app/landing/page.tsx"), /LandingMembershipPage/);
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

test("?modelo=lampara elige la lámpara y el núcleo sigue siendo el modelo por defecto", () => {
  const page = read("src/app/landing-preview/page.tsx");
  assert.match(page, /modelo === "lampara" \? "lampara" : "nucleo"/);
  const canvas = read("src/components/landing-hero/HeroCoreCanvas.tsx");
  assert.match(canvas, /model = "nucleo"/);
  assert.match(canvas, /HeroLampScene/);
  const lamp = read("src/components/landing-hero/lamp-scene.ts");
  assert.match(lamp, /renderer\.dispose\(\)/);
  assert.match(lamp, /forceContextLoss\(\)/);
  assert.match(lamp, /reducedMotion/);
  // La geometría anterior se conserva.
  assert.match(read("src/components/landing-hero/core-scene.ts"), /export class HeroCoreScene/);
});

test("los objetos orbitantes y el núcleo digital son compartidos por ambas variantes", () => {
  const core = read("src/components/landing-hero/core-scene.ts");
  const lamp = read("src/components/landing-hero/lamp-scene.ts");
  for (const source of [core, lamp]) {
    assert.match(source, /new HeroOrbiters\(quality\.pieces\)/);
    assert.match(source, /new HeroDigitalCore\(/);
    assert.match(source, /orbiters\.dispose\(\)/);
    assert.match(source, /digitalCore\.dispose\(\)/);
  }
  // El modelo de lámpara no vuelve a dibujar una bombilla: solo el núcleo digital aparece al separar las capas.
  assert.doesNotMatch(lamp, /bulbGlow/);
  const models = read("src/components/landing-hero/printed-models.ts");
  for (const id of ["boat", "tower", "cube", "gear"]) assert.match(models, new RegExp(`${id}:`));
  // Identidad común: filamento marfil sin metal ni colores arcoíris, y sin presentar el barco como el 3DBenchy oficial.
  assert.match(models, /metalness: 0 \}/);
  assert.doesNotMatch(models, /0x5b7cff/);
  assert.match(models, /NO es 3DBenchy/);
});

test("equipos modestos muestran menos objetos orbitantes y el destello se puede atenuar", () => {
  const quality = read("src/components/landing-hero/hero-quality.ts");
  assert.match(quality, /case "low":\s*\n?\s*return \{ tier, layers: 26, pieces: 3,/);
  assert.match(quality, /layers: 46, pieces: 4,/);
  const half = timeline.computeTimeline(0.585, { ...RIG, flashScale: 0.5 }).flash;
  const full = timeline.computeTimeline(0.585, RIG).flash;
  assert.ok(Math.abs(half - full / 2) < 1e-9);
});
