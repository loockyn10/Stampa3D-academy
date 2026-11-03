// Mide los cuatro STL de referencia de los sistemas de fijación E27 y del difusor (references/lamp-e27) y muestra las cotas que usa
// src/lib/maker/lamps/holder/references.ts. Cada cifra sale de la MALLA: ajuste del eje por mínimos cuadrados sobre un cilindro liso,
// cortes por semiplanos que pasan por el eje y detección de los ápices del filete. Es de solo lectura.
//
//   node scripts/lamp-stl-reference.mjs            (los cuatro)
//   node scripts/lamp-stl-reference.mjs diffuser   (uno: diffuser | press | base2 | v6)
import fs from "node:fs";
import path from "node:path";
import { bbox, fitAxis, halfPlaneSegments, loadStlBinary, measureThread, radiiAtZ, vertexRadii } from "./lib/stl-measure.mjs";

const DIR = path.join(process.cwd(), "references", "lamp-e27");
const which = process.argv[2] ?? "all";
const f = (n, d = 3) => Number(n).toFixed(d);
const file = (name) => path.join(DIR, name);

function diffuser() {
  const T = loadStlBinary(file("diffuser.stl"));
  const b = bbox(T);
  const ax = fitAxis(T, b.min[2] + b.size[2] / 2, 1);
  const inner = fitAxis(T, b.min[2] + b.size[2] / 2, 0, [ax.cx, ax.cy]);
  const layers = new Set();
  for (let i = 0; i < T.length; i += 3) layers.add(Math.round((T[i + 2] - b.min[2]) * 1000) / 1000);
  const vo = vertexRadii(T, ax.cx, ax.cy, { rLo: 32, rHi: 33, zLo: 0, zHi: 131 });
  const vi = vertexRadii(T, ax.cx, ax.cy, { rLo: 31, rHi: 32.2, zLo: 0, zHi: 131 });
  console.log("== diffuser.stl: tubo recto");
  console.log(`   Ø exterior de diseño (vértices) ${f(2 * vo.max)} · Ø interior ${f(2 * vi.max)} · pared ${f(vo.max - vi.max, 4)} · alto ${f(b.size[2])} · capas de vértices en z: ${[...layers].join(", ")}`);
  console.log(`   (radio medio de facetas: Ø ${f(2 * ax.R)} exterior / Ø ${f(2 * inner.R)} interior)`);
}

function press() {
  const T = loadStlBinary(file("BASE v2.stl"));
  const b = bbox(T);
  const ax = fitAxis(T, 30, 0);
  console.log("== BASE v2.stl: alojamiento a presión");
  const vb = vertexRadii(T, ax.cx, ax.cy, { rLo: 19.5, rHi: 20.5, zLo: 20, zHi: 60 });
  const vc = vertexRadii(T, ax.cx, ax.cy, { rLo: 3, rHi: 4, zLo: 11, zHi: 15 });
  console.log(`   eje (${f(ax.cx, 4)}, ${f(ax.cy, 4)}) · agujero liso Ø de diseño (vértices) ${f(2 * vb.min)} (radio medio de facetas Ø ${f(2 * ax.R)}; residuo de circularidad ${f(ax.residual, 4)} mm) · alto total ${f(b.size[2])}`);
  console.log(`   orificio del cable Ø de diseño (vértices) ${f(2 * vc.median)}`);
  const S = halfPlaneSegments(T, ax.cx, ax.cy, 200);
  const probe = (z) => radiiAtZ(S, z)[0];
  console.log(`   orificio del cable: R ${f(probe(13))} a z=13 (Ø ${f(2 * probe(13))}); cono de avellanado R ${f(probe(2))} (z=2) → R ${f(probe(10))} (z=10)`);
  let floorZ = null;
  for (let z = 14.5; z < 15.5; z += 0.005) { const r = probe(z); if (r !== undefined && r > 15 && floorZ === null) floorZ = z; }
  console.log(`   cara superior del piso (el radio salta de 3,5 a ${f(probe(15.1))} mm) en z ≈ ${floorZ === null ? "?" : f(floorZ, 2)}`);
}

function thread(name, label) {
  const T = loadStlBinary(file(name));
  const b = bbox(T);
  console.log(`== ${name}: ${label}`);
  return { T, b };
}

function base2() {
  const { T, b } = thread("BASE2.stl", "rosca hembra A");
  const ax = fitAxis(T, 40, 0);
  const m = measureThread(T, { cx: ax.cx, cy: ax.cy, zLo: 29, zHi: 39.5, rootR: ax.R });
  const top = b.max[2];
  const vr = vertexRadii(T, ax.cx, ax.cy, { rLo: 20, rHi: 20.6, zLo: top - 0.1, zHi: top });
  const vk = vertexRadii(T, ax.cx, ax.cy, { rLo: 19.4, rHi: 19.7, zLo: 30, zHi: 39 });
  console.log(`   raíz Ø de diseño (vértices) ${f(2 * vr.median)} · cresta Ø (vértices del ápice) ${f(2 * vk.min)} · paso ${f(m.pitch, 2)} · ${m.rightHanded ? "a derechas" : "A IZQUIERDAS"} · vueltas ${f(m.turns, 2)} · pendiente de flanco ${f(m.flankSlope, 2)}`);
  console.log(`   ápices desde la cara superior (z = ${f(top)}): más cercano ${f(top - m.maxApexZ, 2)} mm · más profundo ${f(top - m.minApexZ, 2)} mm`);
}

function v6() {
  const { T } = thread("patas V6.stl", "rosca hembra B con patas");
  const ax = fitAxis(T, 10, 0, [905.9, 115.9]);
  const m = measureThread(T, { cx: ax.cx, cy: ax.cy, zLo: 0.05, zHi: 9, rootR: ax.R });
  const vr = vertexRadii(T, ax.cx, ax.cy, { rLo: 20, rHi: 20.6, zLo: 14.9, zHi: 15.1 });
  const vk = vertexRadii(T, ax.cx, ax.cy, { rLo: 19.4, rHi: 19.7, zLo: 0, zHi: 8 });
  console.log(`   raíz Ø de diseño (vértices) ${f(2 * vr.median)} · cresta Ø (vértices del ápice) ${f(2 * vk.min)} · paso ${f(m.pitch, 2)} · ${m.rightHanded ? "a derechas" : "A IZQUIERDAS"} · vueltas ${f(m.turns, 2)} · pendiente de flanco ${f(m.flankSlope, 2)}`);
  console.log(`   ápices desde la cara de entrada (z = 0): más cercano ${f(m.minApexZ, 2)} mm · más profundo ${f(m.maxApexZ, 2)} mm`);
  const S = halfPlaneSegments(T, ax.cx, ax.cy, 200);
  const rim = radiiAtZ(S, 1.5).slice(-1)[0];
  console.log(`   plato: borde vertical R ${f(rim)} (Ø ${f(2 * rim)}) a z=1,5`);
}

if (!fs.existsSync(DIR)) { console.error(`Falta ${DIR}`); process.exit(1); }
const jobs = { diffuser, press, base2, v6 };
for (const [key, run] of Object.entries(jobs)) if (which === "all" || which === key) run();
