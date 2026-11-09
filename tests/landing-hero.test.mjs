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
