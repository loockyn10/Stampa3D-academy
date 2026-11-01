import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

// Lámparas E27 (Stampa Maker). Estos tests son GEOMÉTRICOS: miden las mallas que genera el motor (las mismas que ve el
// visor y exporta el STL). NO reemplazan pruebas físicas de montaje, temperatura ni estabilidad con un portalámparas,
// una bombilla y un filamento reales.

const { DEFAULT_LAMP, normalizeLampDefinition } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp, clearLampCaches, lampGeometryKey } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { sampleShadeField, planShadeResolution, createShadeRowEvaluator } = loadMakerModule("lib/maker/lamps/shade/surface.ts");
const { LAMP_PRESETS, applyLampPreset } = loadMakerModule("lib/maker/lamps/presets.ts");
const { generateLampVariation } = loadMakerModule("lib/maker/lamps/variation.ts");
const { encodeLampDesign, decodeLampDesign } = loadMakerModule("lib/maker/lamps/designCode.ts");
const { lampPartEntries, buildLampZipBlob, lampEntryForKind } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { LAMP_GEOMETRY, LAMP_LIMITS } = loadMakerModule("lib/maker/lamps/types.ts");
const { LAMP_NOTICE_CODES } = loadMakerModule("lib/maker/lamps/safety.ts");
const { lampSilhouette } = loadMakerModule("lib/maker/lamps/silhouette.ts");
const { analyzeMesh, newMesh, indexedBounds } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { revolveProfile } = loadMakerModule("lib/maker/mugs/geometry/revolveProfile.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { partFileEntries } = loadMakerModule("lib/maker/exporters/parts.ts");
const { PRINT_TRANSFORM_BY_KIND } = loadMakerModule("lib/maker/printOrientation.ts");
const { PART_ASSEMBLY_LAYER, computeExplodeRanks } = loadMakerModule("lib/maker/geometry/explodeOrder.ts");
const { collectBedItems, computeBedLayout } = loadMakerModule("lib/maker/printBed/bedLayout.ts");
const { getPrinterProfile, DEFAULT_PRINTER_PROFILE_ID } = loadMakerModule("lib/maker/printBed/printerProfiles.ts");
const { MAKER_TOOL_AVAILABILITY, canAccessMakerTool } = loadMakerModule("lib/maker/availability.ts");

const srcRoot = path.join(process.cwd(), "src");
const read = (rel) => fs.readFileSync(path.join(srcRoot, rel), "utf8");

const lamp = (shade = {}, rest = {}) => ({ ...DEFAULT_LAMP, ...rest, shade: { ...DEFAULT_LAMP.shade, ...shade } });
// Variante con unión por collar roscado: la pantalla queda lisa y es la única candidata a modo vaso.
const lampCollar = (shade = {}, rest = {}) => lamp(shade, { ...rest, thread: { ...DEFAULT_LAMP.thread, ...(rest.thread ?? {}), connection: "collar" } });
const build = (def) => {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `errores: ${JSON.stringify(r.errors.map((e) => e.code))}`);
  return r;
};

// ------------------------------------------------------------------ utilidades geométricas de test
function* triangles(mesh) {
  const p = mesh.positions;
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const a = mesh.tris[i] * 3, b = mesh.tris[i + 1] * 3, c = mesh.tris[i + 2] * 3;
    yield [[p[a], p[a + 1], p[a + 2]], [p[b], p[b + 1], p[b + 2]], [p[c], p[c + 1], p[c + 2]]];
  }
}

function assertWatertight(mesh, label) {
  const r = analyzeMesh(mesh);
  assert.equal(r.nonFinite, 0, `${label}: NaN/Infinity`);
  assert.equal(r.degenerate, 0, `${label}: triángulos degenerados`);
  assert.equal(r.boundaryEdges, 0, `${label}: malla abierta`);
  assert.equal(r.nonManifoldEdges, 0, `${label}: aristas no-manifold`);
  assert.equal(r.inconsistentEdges, 0, `${label}: normales incoherentes`);
  assert.ok(r.volume > 0, `${label}: volumen no positivo`);
  return r;
}

function components(mesh) {
  const n = mesh.positions.length / 3;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const used = new Set();
  for (let i = 0; i < mesh.tris.length; i += 3) {
    for (let k = 0; k < 3; k++) used.add(mesh.tris[i + k]);
    parent[find(mesh.tris[i])] = find(mesh.tris[i + 1]);
    parent[find(mesh.tris[i + 1])] = find(mesh.tris[i + 2]);
  }
  return new Set([...used].map(find)).size;
}

// Möller-Trumbore: cantidad de cruces de un rayo (origen o, dirección d unitaria) con la malla, hasta la distancia maxT.
function rayCrossings(mesh, o, d, maxT = Infinity) {
  let n = 0;
  for (const [a, b, c] of triangles(mesh)) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det, s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
    const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
    if (v < 0 || u + v > 1) continue;
    const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
    if (t > 1e-9 && t <= maxT) n++;
  }
  return n;
}

// Distancia de un punto a un triángulo (Ericson, Real-Time Collision Detection).
function pointTriangleDistance(p, a, b, c) {
  const sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
      else {
        const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; }
          }
        }
      }
    }
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// Corte horizontal de la malla: lazos cerrados del plano z = z0. Devuelve cuántos lazos hay y si todos los puntos tienen grado 2.
function sliceLoops(mesh, z0) {
  const key = (x, y) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
  const adj = new Map();
  const link = (k1, k2) => { if (!adj.has(k1)) adj.set(k1, []); if (!adj.has(k2)) adj.set(k2, []); adj.get(k1).push(k2); adj.get(k2).push(k1); };
  for (const tri of triangles(mesh)) {
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const p = tri[e], q = tri[(e + 1) % 3];
      if ((p[2] - z0) * (q[2] - z0) < 0) { const t = (z0 - p[2]) / (q[2] - p[2]); pts.push(key(p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))); }
    }
    if (pts.length === 2 && pts[0] !== pts[1]) link(pts[0], pts[1]);
  }
  let closed = true;
  for (const nb of adj.values()) if (nb.length !== 2) closed = false;
  const seen = new Set();
  let loops = 0;
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    loops++;
    const stack = [start];
    while (stack.length) { const k = stack.pop(); if (seen.has(k)) continue; seen.add(k); for (const n of adj.get(k)) stack.push(n); }
  }
  return { loops, closed };
}

// ------------------------------------------------------------------ reutilización y alcance
test("reutiliza revolveProfile de Jarros: la opción closed arma un tubo cerrado de volumen π(R²−r²)h", () => {
  const m = newMesh();
  const R = 40, r = 38, h = 50, seg = 360;
  revolveProfile(m, [{ r: R, z: 0 }, { r: R, z: h }, { r: r, z: h }, { r: r, z: 0 }], { segments: seg, closed: true });
  const rep = analyzeMesh(m);
  assert.equal(rep.boundaryEdges + rep.nonManifoldEdges + rep.inconsistentEdges + rep.degenerate, 0);
  const expected = Math.PI * (R * R - r * r) * h;
  assert.ok(Math.abs(rep.volume - expected) / expected < 0.01, `${rep.volume} vs ${expected}`);
});

test("alcance: el motor de lámparas no importa la geometría de Carteles, Neón ni Jarros (solo utilidades compartidas) y no los modifica", () => {
  const dir = path.join(srcRoot, "lib/maker/lamps");
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.isDirectory()) walk(path.join(d, f.name)); else files.push(path.join(d, f.name)); } })(dir);
  assert.ok(files.length > 10);
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(src, /maker\/neon\//, `${f}: importa Neón`);
    assert.doesNotMatch(src, /createLetterGeometry|maker\/mugs\/(createMug|body|handle|decorations|modifiers)/, `${f}: importa el motor de Carteles/Jarros`);
  }
  // Las herramientas existentes no conocen a las lámparas.
  for (const rel of ["app/stampa-maker/carteles/page.tsx", "app/stampa-maker/neon/page.tsx", "app/stampa-maker/jarros/page.tsx"]) assert.doesNotMatch(read(rel), /lamps|Lamp/);
});

// ------------------------------------------------------------------ superficie y motor paramétrico
test("superficie: el collar inferior es un círculo exacto y la ondulación nace suave sobre él", () => {
  const shade = lamp({ amplitudeMm: 10, twistDeg: 400 }).shade;
  const row = createShadeRowEvaluator(shade);
  for (const z of [0, 3, shade.collarHeightMm]) assert.deepEqual(row(z), { radius: shade.bottomDiameterMm / 2, amp: 0, phase: 0 });
  const field = sampleShadeField(shade);
  const collarRows = [...field.z].map((z, i) => [z, i]).filter(([z]) => z <= shade.collarHeightMm - 1);
  for (const [, i] of collarRows) for (let j = 0; j < field.nTheta; j++) assert.ok(Math.abs(field.outer[i * field.nTheta + j] - shade.bottomDiameterMm / 2) < 1e-9);
  // amplitud creciente y continua (sin saltos entre filas)
  for (let i = 1; i < field.nRows; i++) {
    let dMax = 0;
    for (let j = 0; j < field.nTheta; j++) dMax = Math.max(dMax, Math.abs(field.outer[i * field.nTheta + j] - field.outer[(i - 1) * field.nTheta + j]));
    assert.ok(dMax < 3.5, `salto de ${dMax} mm entre filas ${i - 1} y ${i}`);
  }
});

test("las tres familias comparten una única función de superficie y difieren solo en los términos activos", () => {
  const wavy = lamp({ family: "wavy", twistDeg: 0, organicPct: 80 }).shade;
  const spiral = { ...wavy, family: "spiral", twistDeg: 300 };
  const organic = { ...wavy, family: "organic", organicPct: 80, seed: 5 };
  const rowOf = (s, z) => createShadeRowEvaluator(s)(z);
  // ondulada: sin torsión ni términos orgánicos aunque organicPct esté cargado
  assert.equal(rowOf(wavy, 150).phase, 0);
  assert.equal(rowOf(wavy, 150).radius, rowOf({ ...wavy, organicPct: 0 }, 150).radius);
  // espiral: fase lineal con la altura
  assert.ok(Math.abs(rowOf(spiral, 150).phase) > 0.1);
  // orgánica: cambia el diámetro con la semilla, reproduciblemente
  assert.notEqual(rowOf(organic, 150).radius, rowOf({ ...organic, seed: 6 }, 150).radius);
  assert.equal(rowOf(organic, 150).radius, rowOf({ ...organic }, 150).radius);
  const field = (s) => sampleShadeField(s);
  for (const s of [wavy, spiral, organic]) assert.ok(field(s).maxOuterRadius > field(s).minOuterRadius);
});

test("parámetros del motor: todos modifican la geometría (o al menos la superficie muestreada)", () => {
  const base = lamp({ family: "organic", organicPct: 60, verticalFrequency: 2, patternIntensityPct: 40 });
  const sig = (shade) => { const f = sampleShadeField(shade); let s = 0; for (let i = 0; i < f.outer.length; i += 7) s += f.outer[i] * ((i % 13) + 1); return s; };
  const ref = sig(base.shade);
  const patches = { heightMm: 230, bottomDiameterMm: 140, topDiameterMm: 170, waves: 12, amplitudeMm: 8, twistDeg: 100, verticalFrequency: 3.5, profile: "bell", profileAmountPct: 70, patternIntensityPct: 90, organicPct: 20, seed: 99, collarHeightMm: 20 };
  for (const [k, v] of Object.entries(patches)) assert.notEqual(sig({ ...base.shade, [k]: v }), ref, `${k} no cambia la superficie`);
});

test("resolución adaptativa: múltiplo de las ondas, presupuesto de triángulos y sin densidad injustificada", () => {
  for (const waves of [2, 5, 9, 16, 24, 32]) {
    const { nTheta, nRows } = planShadeResolution(lamp({ waves }).shade);
    assert.equal(nTheta % waves, 0);
    assert.ok(nTheta >= Math.min(144, 12 * waves) && nTheta <= 384);
    assert.ok(4 * nTheta * nRows <= LAMP_GEOMETRY.maxShadeTriangles + 4 * nTheta, `presupuesto excedido con ${waves} ondas`);
  }
});

// ------------------------------------------------------------------ mallas cerradas, tamaños y diseños extremos
const CASES = {
  "por defecto": lamp(),
  "pantalla chica": lamp({ heightMm: 100, bottomDiameterMm: 130, topDiameterMm: 130, amplitudeMm: 3 }),
  "pantalla grande": lamp({ heightMm: 300, bottomDiameterMm: 240, topDiameterMm: 260, amplitudeMm: 10 }),
  "diámetro inferior mínimo útil": lamp({ bottomDiameterMm: 100, topDiameterMm: 100, amplitudeMm: 3, waves: 6 }),
  "collar roscado (modo vaso)": lampCollar(),
  "collar con perfil orgánico": lampCollar({ family: "organic", organicPct: 70, waves: 7, amplitudeMm: 6, seed: 77 }),
  "ondulaciones extremas permitidas": lamp({ waves: 12, amplitudeMm: 12, twistDeg: 0, family: "wavy" }),
  "muchas ondas": lamp({ waves: 28, amplitudeMm: 4 }),
  "torsión extrema permitida": lamp({ twistDeg: 1100, amplitudeMm: 5, waves: 6 }),
  "perfil orgánico": lamp({ family: "organic", organicPct: 90, waves: 6, amplitudeMm: 8, seed: 31337, profile: "tulip", profileAmountPct: 70, topDiameterMm: 200 }),
  "campana con variación vertical": lamp({ profile: "bell", topDiameterMm: 190, verticalFrequency: 4, patternIntensityPct: 80, waves: 14 }),
  "cintura": lamp({ profile: "waist", profileAmountPct: 40, topDiameterMm: 140, amplitudeMm: 4 }),
};

for (const [name, def] of Object.entries(CASES)) {
  test(`malla de las tres piezas (${name}): cerrada, manifold, orientada, sin triángulos degenerados, una sola pieza conexa`, () => {
    const r = build(def);
    for (const [part, mesh] of [["pantalla", r.indexed.shade], ["inserto", r.indexed.insert], ["base", r.indexed.base], ["collar", r.indexed.collar]]) {
      if (!mesh) continue;
      assertWatertight(mesh, `${name}/${part}`);
      assert.equal(components(mesh), 1, `${name}/${part}: más de una componente conexa`);
    }
    for (const part of r.geometry.parts) assert.ok(part.mesh.triangleCount > 0);
    const soupFinite = r.geometry.parts.every((p) => [...p.mesh.positions, ...p.mesh.normals].every(Number.isFinite));
    assert.ok(soupFinite);
  });
}

test("continuidad de superficie y contorno por capa: cada corte horizontal de la pantalla son exactamente 2 lazos cerrados (modo vaso: contorno exterior continuo)", () => {
  const r = build(lamp({ twistDeg: 540, waves: 7, amplitudeMm: 7, family: "spiral" }));
  const shadeZ0 = r.metrics.fit.shadeBottomZ, top = r.metrics.fit.shadeTopZ;
  for (const f of [0.013, 0.1, 0.37, 0.5, 0.71, 0.93, 0.995]) {
    const s = sliceLoops(r.indexed.shade, shadeZ0 + (top - shadeZ0) * f);
    assert.equal(s.closed, true, `corte a ${f}: lazo abierto`);
    assert.equal(s.loops, 2, `corte a ${f}: ${s.loops} lazos (se esperaban exterior + interior)`);
  }
});

test("sin autointersecciones: cada rayo horizontal desde el eje cruza la pantalla exactamente 2 veces (piel exterior e interior)", () => {
  for (const def of [lamp({ twistDeg: 540, waves: 7, amplitudeMm: 7 }), CASES["perfil orgánico"], CASES["ondulaciones extremas permitidas"]]) {
    const r = build(def);
    const { shadeBottomZ, shadeTopZ } = r.metrics.fit;
    let n = 0;
    for (let k = 0; k < 90; k++) {
      const theta = (0.0173 + k * 2.399963) % (2 * Math.PI);
      const z = shadeBottomZ + 0.3 + ((shadeTopZ - shadeBottomZ - 0.6) * ((k * 0.618034) % 1));
      assert.equal(rayCrossings(r.indexed.shade, [0, 0, z], [Math.cos(theta), Math.sin(theta), 0]), 2, `rayo θ=${theta.toFixed(2)} z=${z.toFixed(1)}`);
      n++;
    }
    assert.ok(n > 0);
  }
});

test("espesor real de pared: la distancia de la piel interior a la exterior es >= 0,75 × el espesor pedido (también con ondas y torsión)", () => {
  for (const def of [lamp({ heightMm: 90, waves: 6, amplitudeMm: 6, twistDeg: 300, wallMm: 1.2 }), lamp({ heightMm: 90, waves: 9, amplitudeMm: 9, twistDeg: 0, wallMm: 2 }), lamp({ heightMm: 90, family: "organic", organicPct: 80, waves: 6, amplitudeMm: 7, wallMm: 1 })]) {
    const wall = def.shade.wallMm;
    const r = build(def);
    const shade = r.indexed.shade;
    const { nRows, nTheta } = sampleShadeField(def.shade);
    const outerCount = nRows * nTheta; // revolveProfile numera primero los anillos exteriores y después los interiores
    const vertex = (i) => [shade.positions[i * 3], shade.positions[i * 3 + 1], shade.positions[i * 3 + 2]];
    const outerTris = [];
    for (let t = 0; t < shade.tris.length; t += 3) if (shade.tris[t] < outerCount && shade.tris[t + 1] < outerCount && shade.tris[t + 2] < outerCount) outerTris.push([vertex(shade.tris[t]), vertex(shade.tris[t + 1]), vertex(shade.tris[t + 2])]);
    assert.equal(outerTris.length, 2 * nTheta * (nRows - 1));
    let minD = Infinity, checked = 0;
    for (let row = Math.floor(nRows * 0.3); row < nRows - 1; row += 4) {
      for (let j = 0; j < nTheta; j += 9) {
        const p = vertex(outerCount + row * nTheta + j);
        let d = Infinity;
        for (const [a, b, c] of outerTris) d = Math.min(d, pointTriangleDistance(p, a, b, c));
        minD = Math.min(minD, d);
        checked++;
      }
    }
    assert.ok(checked > 40);
    assert.ok(minD >= 0.75 * wall, `espesor mínimo medido ${minD.toFixed(3)} mm < 0,75 × ${wall}`);
  }
});

test("la pared se mide en la dirección normal: un tramo inclinado no queda más fino que el vertical", () => {
  const r = build(lamp({ twistDeg: 700, waves: 6, amplitudeMm: 8 }));
  const field = sampleShadeField(lamp({ twistDeg: 700, waves: 6, amplitudeMm: 8 }).shade);
  assert.ok(field.maxTiltDeg > 25);
  assert.ok(r.metrics.shade.maxTiltDeg > 25);
  // el espesor radial crece con la pendiente: nunca es menor que el pedido
  for (let i = 0; i < field.outer.length; i += 11) assert.ok(field.outer[i] - field.inner[i] >= 1.2 - 1e-9);
});

test("rechazo: ondas/amplitud/torsión que pliegan la pared o la vuelven imprimible quedan bloqueadas con el motivo, sin geometría", () => {
  const sharp = createLamp(lamp({ waves: 32, amplitudeMm: 25 }));
  assert.ok(sharp.geometry === null);
  assert.ok(sharp.errors.some((e) => e.code === "SHADE_RIDGE_TOO_SHARP"));
  const steep = createLamp(lamp({ heightMm: 80, twistDeg: 1440, amplitudeMm: 25, waves: 3, collarHeightMm: 8 }));
  assert.ok(steep.geometry === null);
  assert.ok(steep.errors.some((e) => e.code === "SHADE_TOO_STEEP"), JSON.stringify(steep.errors.map((e) => e.code)));
  // un diseño agresivo pero con crestas de radio > espesor y pendiente < 70° SÍ se genera (y avisa que no es apto para modo vaso)
  const spiky = createLamp(lamp({ twistDeg: 1440, amplitudeMm: 20, waves: 12 }));
  assert.ok(spiky.geometry !== null);
  assert.equal(spiky.metrics.shade.vase.ready, false);
  const range = createLamp(lamp({ waves: 1.5, amplitudeMm: -1 }));
  assert.ok(range.geometry === null);
  assert.ok(range.errors.filter((e) => e.code === "OUT_OF_RANGE").length >= 2);
  const nan = createLamp(lamp({ heightMm: Number.NaN }));
  assert.ok(nan.geometry === null);
});

// ------------------------------------------------------------------ inserto de color
test("cilindro compatible: queda dentro de la pantalla con la holgura pedida a TODAS las alturas (medido sobre las mallas)", () => {
  for (const def of [lamp(), CASES["perfil orgánico"], CASES["pantalla grande"], lamp({ twistDeg: 540, waves: 7, amplitudeMm: 7 })]) {
    const r = build(def);
    const c = def.insert.clearanceMm;
    // radio mínimo de la pantalla por altura (a partir de su malla)
    const rowMin = new Map();
    for (let i = 0; i < r.indexed.shade.positions.length; i += 3) {
      const z = Math.round(r.indexed.shade.positions[i + 2] * 1e3);
      const rad = Math.hypot(r.indexed.shade.positions[i], r.indexed.shade.positions[i + 1]);
      rowMin.set(z, Math.min(rowMin.get(z) ?? Infinity, rad));
    }
    const rowZ = [...rowMin.keys()].sort((a, b) => a - b);
    const nearest = (z) => { let lo = 0, hi = rowZ.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rowZ[m] / 1e3 < z) lo = m; else hi = m; } return Math.min(rowMin.get(rowZ[lo]), rowMin.get(rowZ[hi])); };
    const sb = indexedBounds(r.indexed.shade);
    const ins = r.indexed.insert.positions;
    let worst = Infinity;
    for (let i = 0; i < ins.length; i += 3) {
      const z = ins[i + 2];
      if (z < sb.minZ + 1) continue; // por debajo del cuello roscado el inserto está dentro de la base
      worst = Math.min(worst, nearest(z) - Math.hypot(ins[i], ins[i + 1]));
    }
    assert.ok(worst >= c - 0.05, `holgura mínima ${worst.toFixed(3)} < ${c}`);
    // nunca sobresale del borde superior de la pantalla
    assert.ok(indexedBounds(r.indexed.insert).maxZ <= sb.maxZ - LAMP_GEOMETRY.insertTopMarginMm + 1e-6);
    // y apoya en la ranura anular de la torre de la base
    assert.ok(Math.abs(indexedBounds(r.indexed.insert).minZ - r.metrics.fit.insertBottomZ) < 1e-6);
    assert.ok(Math.abs(r.metrics.fit.insertBottomZ - (r.metrics.fit.tower.topZ - def.insert.seatDepthMm)) < 1e-6, "apoya en el fondo de la ranura de la torre");
  }
});

test("inserto: separado de la bombilla y del portalámparas (radio interior − envolvente >= separación mínima de diseño) y nunca la toca", () => {
  const def = lamp();
  const r = build(def);
  const fit = r.metrics.fit;
  const insertInnerR = fit.insertInnerDiameterMm / 2;
  const envelope = Math.max(def.bulb.diameterMm, def.holder.bodyDiameterMm) / 2;
  assert.ok(insertInnerR - envelope >= def.insert.minBulbGapMm);
  assert.ok(fit.insertBulbGapMm >= def.insert.minBulbGapMm);
  // medido en la malla: radio mínimo de las paredes del inserto
  let minR = Infinity;
  const p = r.indexed.insert.positions;
  for (let i = 0; i < p.length; i += 3) if (p[i + 2] > r.metrics.fit.floorTopZ) minR = Math.min(minR, Math.hypot(p[i], p[i + 1]));
  assert.ok(minR - def.bulb.diameterMm / 2 >= def.insert.minBulbGapMm - 1e-6);
  assert.ok(minR - def.holder.bodyDiameterMm / 2 >= def.insert.minBulbGapMm - 1e-6);
});

test("inserto incompatible: se informa el motivo con las cifras y NO se achica ninguna separación automáticamente", () => {
  // separación mínima de 30 mm con diámetro automático: el cilindro necesario (Ø 121) no cabe ni en el cuello roscado ni en la pantalla
  const tight = lamp({}, { insert: { ...DEFAULT_LAMP.insert, diameterMm: null, minBulbGapMm: 30 } });
  const snapshot = JSON.stringify(tight);
  const r = createLamp(tight);
  assert.ok(r.geometry === null);
  const e = r.errors.find((x) => x.code === "INSERT_DOES_NOT_FIT");
  assert.ok(e);
  assert.match(e.message, /no entra/);
  assert.match(e.message, /\d+(,\d)? mm/);
  assert.equal(JSON.stringify(tight), snapshot, "la definición no se modifica");
  assert.equal(tight.insert.minBulbGapMm, 30);
  assert.equal(tight.insert.diameterMm, null);
  // diámetro manual que atraviesa la pantalla
  const touch = createLamp(lamp({}, { insert: { ...DEFAULT_LAMP.insert, diameterMm: 200 } }));
  assert.ok(touch.errors.some((x) => x.code === "INSERT_TOUCHES_SHADE"));
  // inserto demasiado cerca de la bombilla (diámetro manual chico)
  const near = createLamp(lamp({}, { insert: { ...DEFAULT_LAMP.insert, diameterMm: 60 } }));
  assert.ok(near.errors.some((x) => x.code === "INSERT_TOO_CLOSE_TO_BULB"));
  assert.ok(near.errors.some((x) => x.code === "INSERT_TOO_CLOSE_TO_RINGS"), "también queda pegado a los anillos del portalámparas");
  // separación mínima exagerada -> no entra, no se recorta
  const gap = createLamp(lamp({}, { insert: { ...DEFAULT_LAMP.insert, diameterMm: null, minBulbGapMm: 40 } }));
  assert.ok(gap.errors.some((x) => x.code === "INSERT_DOES_NOT_FIT"));
  for (const bad of [r, touch, near, gap]) assert.ok(bad.geometry === null);
});

test("sin inserto: dos piezas, la pantalla respeta igualmente la separación a la bombilla", () => {
  const ok = build(lamp({}, { insert: { ...DEFAULT_LAMP.insert, enabled: false } }));
  assert.equal(ok.geometry.parts.length, 2);
  assert.equal(ok.indexed.insert, null);
  assert.equal(ok.metrics.insert, null);
  // sin inserto, el cuello roscado mismo debe respetar la separación de diseño a la bombilla
  const near = createLamp(lamp({}, { insert: { ...DEFAULT_LAMP.insert, enabled: false, minBulbGapMm: 15 } }));
  assert.ok(near.errors.some((e) => e.code === "SHADE_TOO_CLOSE_TO_BULB"));
});

test("holgura de montaje configurable dentro de límites validados: la ranura de la torre sigue al cilindro", () => {
  for (const clearance of [0.3, 0.35, 0.5]) {
    const def = lamp({}, { insert: { ...DEFAULT_LAMP.insert, clearanceMm: clearance } });
    const r = build(def);
    const ro = r.metrics.fit.insertOuterDiameterMm / 2, rn = r.metrics.fit.insertInnerDiameterMm / 2;
    // radios de la ranura en el fondo de la ranura (z = fondo del cilindro) de la malla de la base
    const radii = new Set();
    const p = r.indexed.base.positions;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2] - r.metrics.fit.insertBottomZ) < 1e-3) radii.add(Math.round(Math.hypot(p[i], p[i + 1]) * 100) / 100);
    const near = (target) => [...radii].some((x) => Math.abs(x - target) < 0.05);
    assert.ok(near(ro + clearance), `pared exterior de la ranura (${ro + clearance})`);
    assert.ok(near(rn - clearance), `pared interior de la ranura (${rn - clearance})`);
    assert.ok(Math.abs(r.metrics.fit.tower.slotOuterDiameterMm - 2 * (ro + clearance)) < 0.02);
  }
  for (const bad of [0.1, 2.5]) assert.ok(createLamp(lamp({}, { insert: { ...DEFAULT_LAMP.insert, clearanceMm: bad } })).errors.some((e) => e.field === "insert.clearanceMm"));
  // una holgura grande ensancha la ranura y se come la pared entre el rebaje y la ranura: se informa, no se corrige
  assert.ok(createLamp(lamp({}, { insert: { ...DEFAULT_LAMP.insert, clearanceMm: 0.8 } })).errors.some((e) => e.code === "TOWER_INNER_WALL_THIN"));
});

test("cilindro: pared continua sin ventanas ni cortes laterales, dos lengüetas superiores exteriores y apoyo en el fondo de la ranura", () => {
  const def = lamp();
  const r = build(def);
  const ins = r.indexed.insert;
  const b = indexedBounds(ins);
  const fit = r.metrics.fit;
  const ro = fit.insertOuterDiameterMm / 2;
  // lengüetas: en el borde superior el radio máximo supera al del tubo en la longitud de lengüeta; en el resto no
  let tabR = 0, bodyR = 0;
  for (let i = 0; i < ins.positions.length; i += 3) {
    const rad = Math.hypot(ins.positions[i], ins.positions[i + 1]);
    if (ins.positions[i + 2] > b.maxZ - 1) tabR = Math.max(tabR, rad);
    else if (ins.positions[i + 2] < b.maxZ - LAMP_GEOMETRY.tabThicknessMm - 1) bodyR = Math.max(bodyR, rad);
  }
  assert.ok(Math.abs(bodyR - ro) < 0.05);
  assert.ok(Math.abs(tabR - (ro + LAMP_GEOMETRY.tabLengthMm)) < 0.1);
  const dir = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0];
  // pared CONTINUA: desde el eje, a todas las alturas (enterrada en la ranura, justo sobre la torre y a media altura) y en todos los
  // ángulos, un rayo horizontal cruza la pared exactamente 2 veces (cara interior y exterior): no hay ventanas.
  const zTop = b.maxZ - LAMP_GEOMETRY.tabThicknessMm - 0.5; // por debajo de las lengüetas
  const heights = [b.minZ + 0.3, b.minZ + def.insert.seatDepthMm / 2, fit.tower.topZ + 0.2, fit.tower.topZ + 1.5, fit.tower.topZ + 5, fit.tower.topZ + 9, (b.minZ + zTop) / 2, zTop - 10, zTop];
  for (const z of heights) for (let deg = 0; deg < 360; deg += 15) assert.equal(rayCrossings(ins, [0, 0, z], dir(deg + 3.7)), 2, `pared cortada a z=${z.toFixed(1)} ángulo ${deg + 3.7}`);
  // las lengüetas se suman sobre la pared, en +Y y -Y, solo en el borde superior
  for (const deg of [90, 270]) assert.equal(rayCrossings(ins, [0, 0, b.maxZ - 1], dir(deg)), 2, "las lengüetas son macizas: dos caras");
  // radios interior/exterior constantes a todas las alturas (sin escalones ni restos de perforaciones)
  for (const z of heights) {
    const x = planeCrossings(ins, 0, 0.37, z);
    assert.equal(x.length, 2, `z=${z.toFixed(1)}`);
    assert.ok(Math.abs(x[1] - ro) < 0.05 && Math.abs(x[0] - fit.insertInnerDiameterMm / 2) < 0.05, `radios a z=${z.toFixed(1)}: ${x}`);
  }
  // el cilindro apoya en el fondo de la ranura: su borde inferior coincide con el fondo y no sobresale por debajo; lo enterrado es seatDepthMm
  assert.ok(Math.abs(b.minZ - (fit.tower.topZ - def.insert.seatDepthMm)) < 1e-9, "borde inferior = cara superior de la torre − profundidad de la ranura");
  assert.ok(Math.abs(b.minZ - fit.insertBottomZ) < 1e-9);
  assert.ok(b.minZ >= fit.floorTopZ + LAMP_GEOMETRY.towerFloorBelowSlotMm - 1e-9, "queda material de la torre bajo el fondo de la ranura");
  assert.ok(fit.insertBottomZ > fit.floorTopZ && fit.insertBottomZ < fit.tower.topZ, "no sobresale por debajo de la torre");
  // volumen = anillo analítico (sin restos de cortes): tubo liso sin lengüetas
  const plain = build(lamp({}, { insert: { ...DEFAULT_LAMP.insert, tabs: false } }));
  const pb = indexedBounds(plain.indexed.insert);
  const ri = plain.metrics.fit.insertInnerDiameterMm / 2;
  const analytic = Math.PI * (ro * ro - ri * ri) * (pb.maxZ - pb.minZ);
  const plainVol = assertWatertight(plain.indexed.insert, "cilindro liso").volume;
  assert.ok(Math.abs(plainVol - analytic) / analytic < 0.01, `volumen ${plainVol.toFixed(1)} vs anillo ${analytic.toFixed(1)}`);
  assert.equal(components(plain.indexed.insert), 1);
  // sin lengüetas: tubo liso, candidato a modo vaso
  assert.equal(plain.metrics.insert.vaseCapable, true);
  assert.equal(r.metrics.insert.vaseCapable, false);
  // el diseño ya no tiene parámetros de ventanas
  assert.equal("ventWindows" in DEFAULT_LAMP.insert, false);
  assert.equal("ventSlots" in DEFAULT_LAMP.base, false);
});

// ------------------------------------------------------------------ base E27
// Medición sobre la malla: radios de cruce en el plano y = 0,37 (lado +X, fuera de las simetrías exactas) a una altura z, respecto de (cx, cy).
function planeCrossings(mesh, cx, cy, z) {
  const xs = [];
  const p = mesh.positions;
  for (let t = 0; t < mesh.tris.length; t += 3) {
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const a = mesh.tris[t + e] * 3, b = mesh.tris[t + ((e + 1) % 3)] * 3;
      const da = p[a + 1] - cy, db = p[b + 1] - cy;
      if (da * db < 0) { const u = da / (da - db); pts.push([p[a] + u * (p[b] - p[a]), p[a + 2] + u * (p[b + 2] - p[a + 2])]); }
    }
    if (pts.length === 2 && (pts[0][1] - z) * (pts[1][1] - z) < 0) { const u = (z - pts[0][1]) / (pts[1][1] - pts[0][1]); xs.push(pts[0][0] + u * (pts[1][0] - pts[0][0]) - cx); }
  }
  return xs.filter((x) => x > 0).sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 0.02);
}

test("torre de la base: agujero central, rebaje de los anillos y ranura del cilindro siguen las medidas cargadas (geometría paramétrica, no fija)", () => {
  for (const [boreD, ringsD, recessDepth, seat] of [[40, 54, 4, 30], [42, 58, 5.15, 31.4], [44, 56, 6, 33]]) {
    const def = lamp({}, { holder: { ...DEFAULT_LAMP.holder, bodyDiameterMm: boreD - 2, boreDiameterMm: boreD, ringsDiameterMm: ringsD, ringsRecessDepthMm: recessDepth, seatHeightMm: seat, measured: true } });
    const r = build(def);
    const t = r.metrics.fit.tower;
    const recessD = ringsD + 2 * def.holder.ringsClearanceMm;
    assert.ok(Math.abs(t.ringsRecessDiameterMm - recessD) < 0.01 && Math.abs(t.topZ - (seat + recessDepth)) < 1e-9);
    // medido en la malla: a la altura del piso del rebaje (seat + 0,1) el rebaje es el vacío hasta recessD/2; bajo el apoyo solo queda el agujero
    const above = planeCrossings(r.indexed.base, 0, 0.37, seat + 0.1);
    const below = planeCrossings(r.indexed.base, 0, 0.37, seat - 0.1);
    assert.ok(Math.abs(above[0] - recessD / 2) < 0.05, `rebaje Ø${recessD}: medido ${above[0]}`);
    assert.ok(Math.abs(below[0] - boreD / 2) < 0.05, `agujero Ø${boreD}: medido ${below[0]}`);
    // el agujero es pasante: un rayo vertical por el eje no cruza material desde la mesa hasta arriba de la torre
    assert.equal(rayCrossings(r.indexed.base, [0, 0, -1], [0, 0, 1], t.topZ + 1), 0);
    // espesor de material bajo el apoyo de los anillos = su altura sobre la mesa
    assert.ok(Math.abs(t.seatMaterialMm - seat) < 0.05);
  }
});

const REFERENCE_STL = path.join(process.cwd(), "references", "lamp-e27", "bottom.stl");
test("torre de la base vs el STL de referencia bottom.stl (solo si el archivo está en references/lamp-e27): rebaje, ranura, alturas y diámetro de la torre coinciden", { skip: !fs.existsSync(REFERENCE_STL) && "references/lamp-e27/bottom.stl no está en este equipo" }, () => {
  // STL binario -> malla indexada sin soldar (basta para cortar por un plano)
  const buf = fs.readFileSync(REFERENCE_STL);
  const n = buf.readUInt32LE(80);
  assert.equal(buf.length, 84 + 50 * n, "STL binario");
  const positions = [], tris = [];
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) { for (let c = 0; c < 3; c++) positions.push(buf.readFloatLE(84 + t * 50 + 12 + v * 12 + c * 4)); tris.push(t * 3 + v); }
  const stl = { positions, tris };
  const CX = 110.05, CY = -151.6 + 0.37;
  const ref = (z) => planeCrossings(stl, CX, CY, z);
  const mine = build(lamp({}, { holder: { ...DEFAULT_LAMP.holder, measured: false } }));
  const gen = (z) => planeCrossings(mine.indexed.base, 0, 0.37, z);
  // referencia a z = 33 (sobre el piso del rebaje): [rebaje, ranura interior, ranura exterior, torre]
  const r33 = ref(33).slice(0, 4);
  const g33 = gen(mine.metrics.fit.tower.seatZ + 1.6).slice(0, 4);
  assert.equal(r33.length, 4);
  assert.equal(g33.length, 4);
  assert.ok(Math.abs(r33[0] - g33[0]) < 0.1, `rebaje: STL R${r33[0].toFixed(2)} vs generado R${g33[0].toFixed(2)}`);
  assert.ok(Math.abs(r33[1] - g33[1]) < 0.35, `ranura interior: STL R${r33[1].toFixed(2)} vs R${g33[1].toFixed(2)} (el espesor del cilindro de la referencia no se conoce)`);
  assert.ok(Math.abs(r33[2] - g33[2]) < 0.1, `ranura exterior: STL R${r33[2].toFixed(2)} vs R${g33[2].toFixed(2)}`);
  assert.ok(Math.abs(r33[3] - g33[3]) < 0.1, `torre: STL R${r33[3].toFixed(2)} vs R${g33[3].toFixed(2)}`);
  // agujero central: la referencia mide Ø40,9 y el dato nominal del usuario es Ø42 (se conserva el nominal y la diferencia queda documentada)
  const bore = ref(20)[0] * 2;
  assert.ok(bore > 40.5 && bore < 41.3 && Math.abs(2 * gen(20)[0] - 42) < 0.05);
  // alturas: piso del rebaje y cara superior de la torre (por los escalones del perfil del STL)
  const seatRef = (() => { let lo = 28, hi = 34; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (ref(m)[0] > 25) hi = m; else lo = m; } return hi; })();
  assert.ok(Math.abs(seatRef - mine.metrics.fit.tower.seatZ) < 0.1, `apoyo: STL ${seatRef.toFixed(2)} vs ${mine.metrics.fit.tower.seatZ}`);
  const topRef = (() => { let lo = 35, hi = 38; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (ref(m).some((x) => x > 29 && x < 36)) lo = m; else hi = m; } return lo; })();
  assert.ok(Math.abs(topRef - mine.metrics.fit.tower.topZ) < 0.1, `cara superior de la torre: STL ${topRef.toFixed(2)} vs ${mine.metrics.fit.tower.topZ}`);
  // profundidad de la ranura: fondo a 26,55 mm en el STL
  const slotBottom = (() => { let lo = 24, hi = 29; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (ref(m).filter((x) => x > 30 && x < 36).length >= 3) hi = m; else lo = m; } return hi; })();
  assert.ok(Math.abs(slotBottom - mine.metrics.fit.insertBottomZ) < 0.1, `fondo de la ranura: STL ${slotBottom.toFixed(2)} vs ${mine.metrics.fit.insertBottomZ}`);
});

test("portalámparas de doble anillo: errores claros cuando el agujero, el rebaje, el apoyo o la ranura no cierran (nada se corrige en silencio)", () => {
  const withHolder = (patch, insert = {}) => createLamp(lamp({}, { holder: { ...DEFAULT_LAMP.holder, ...patch }, insert: { ...DEFAULT_LAMP.insert, ...insert } }));
  const codes = (r) => r.errors.map((e) => e.code);
  assert.ok(codes(withHolder({ bodyDiameterMm: 42 })).includes("HOLDER_BODY_WIDER_THAN_BORE"));
  assert.ok(codes(withHolder({ ringsDiameterMm: 44 })).includes("RINGS_RECESS_TOO_SMALL"));
  assert.ok(codes(withHolder({ seatHeightMm: 13 })).includes("HOLDER_SEAT_TOO_LOW"));
  assert.ok(codes(withHolder({ seatHeightMm: 38 })).includes("TOWER_ABOVE_BASE"));
  // anillos tan grandes que casi tocan la ranura del cilindro: la pared que queda se informa con la cifra
  const thin = withHolder({ ringsDiameterMm: 62 });
  assert.ok(thin.errors.some((e) => e.code === "TOWER_INNER_WALL_THIN" && /\d+(,\d)? mm/.test(e.message)));
  assert.ok(thin.geometry === null);
  // ranura demasiado profunda para el piso
  assert.ok(codes(withHolder({ seatHeightMm: 20 }, { seatDepthMm: 20 })).includes("INSERT_SEAT_TOO_DEEP"));
  // pared delgada pero válida (1,45 mm con el cilindro de Ø65 y 0,35 mm de holgura): se advierte, no se bloquea
  const base = createLamp(lamp());
  assert.equal(base.errors.length, 0);
  assert.ok(base.warnings.some((w) => w.code === "TOWER_INNER_WALL_THIN" && /referencia impresa tiene 1,7 mm/.test(w.message)));
  // la torre no puede ser más ancha que el orificio del cuello roscado menos 3 mm de aire
  assert.ok(codes(createLamp(lamp({}, { thread: { ...DEFAULT_LAMP.thread, majorDiameterMm: 80 } }))).includes("TOWER_TOO_WIDE_FOR_THREAD"));
});

test("base: espacio para el cableado — canal inferior libre hacia el borde (+X), ranuras del precinto y pared maciza del lado opuesto", () => {
  const def = lamp();
  const r = build(def);
  const R = r.metrics.fit.baseDiameterMm / 2;
  const z = 3;
  assert.equal(rayCrossings(r.indexed.base, [0, 0, z], [1, 0, 0]), 0, "el canal debería estar libre hasta el borde");
  assert.ok(rayCrossings(r.indexed.base, [0, 0, z], [-1, 0, 0]) >= 1, "del lado opuesto hay pared");
  // agujero pasante central de la espiga: un rayo vertical desde abajo por el eje atraviesa solo el alojamiento y el agujero hasta la cavidad
  assert.equal(rayCrossings(r.indexed.base, [0, 0, -1], [0, 0, 1], r.metrics.fit.baseHeightMm), 0, "el eje queda libre de lado a lado");
  // alojamiento de la tuerca más ancho que el agujero
  assert.ok(rayCrossings(r.indexed.base, [0, 0, 2], [0, 1, 0]) >= 1);
  // precinto: las ranuras laterales atraviesan el piso a ambos lados del canal
  const layout = validateLamp(def).layout;
  assert.ok(layout.tie, "hay lugar para las ranuras del precinto");
  for (const sign of [-1, 1]) assert.equal(rayCrossings(r.indexed.base, [layout.tie.x, sign * (layout.tie.y0 + 0.9), -1], [0, 0, 1], layout.floorTopZ), 0, "ranura libre de lado a lado");
  const noTie = build(lamp({}, { cable: { ...DEFAULT_LAMP.cable, tieAnchor: false } }));
  assert.equal(rayCrossings(noTie.indexed.base, [layout.tie.x, layout.tie.y0 + 0.9, -1], [0, 0, 1], layout.floorTopZ) >= 1, true, "sin precinto no hay ranura");
  assert.ok(R > 50);
});

test("base: superficie exterior lisa — sin ventanas laterales; las únicas aberturas son el canal de cable y las ranuras del precinto del piso", () => {
  const def = lamp();
  const r = build(def);
  const base = r.indexed.base;
  const layout = validateLamp(def).layout;
  const fit = r.metrics.fit;
  const R = fit.baseDiameterMm / 2;
  const dir = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0];
  const out = layout.tower.towerR + 1; // dentro de la cavidad anular, fuera de la torre
  const from = (deg, z) => [out * Math.cos((deg * Math.PI) / 180), out * Math.sin((deg * Math.PI) / 180), z];
  // cavidad anular: a todas las alturas entre el piso y el tope de la rosca y en todos los ángulos el rayo hacia el exterior cruza la pared maciza (entra en la cara de la cavidad y sale por la exterior: 2 cruces; una ventana daría 0)
  for (const z of [fit.floorTopZ + 0.3, fit.floorTopZ + 3, fit.floorTopZ + 6, fit.floorTopZ + 8, layout.ledgeZ - 0.3])
    for (let deg = 0; deg < 360; deg += 10) assert.equal(rayCrossings(base, from(deg + 2.3, z), dir(deg + 2.3)), 2, `abertura lateral a z=${z.toFixed(1)} ángulo ${deg + 2.3}`);
  // a todas las alturas por encima del canal de cable la pared exterior es un cilindro liso de radio R (sin escalones ni cortes)
  for (let z = layout.channelHeight + 1; z < fit.baseHeightMm - 0.5; z += 4) {
    const x = planeCrossings(base, 0, 0.37, z);
    assert.ok(Math.abs(x[x.length - 1] - R) < 0.05, `pared exterior a z=${z.toFixed(1)}: ${x[x.length - 1]} vs ${R}`);
  }
  // la cavidad anular termina en el tope de la rosca, a la misma altura de siempre
  assert.ok(Math.abs(layout.ledgeZ - (fit.floorTopZ + LAMP_GEOMETRY.baseCavityHeightMm)) < 1e-9);
  // lo que SÍ se conserva: canal de cable libre hasta el borde (+X) con techo, y el resto de los ángulos con pared a esa altura
  const zc = layout.channelHeight / 2;
  assert.equal(rayCrossings(base, [0, 0, zc], dir(0)), 0, "el canal de cable sigue libre hasta el exterior");
  for (const deg of [30, 90, 180, 270, 330]) assert.ok(rayCrossings(base, [0, 0, zc], dir(deg)) >= 1, `pared a ${deg}°`);
  assert.ok(fit.floorTopZ - layout.channelHeight >= 3, "techo del canal");
  assert.ok(layout.tie, "las ranuras del precinto siguen");
  // sin restos de cortes: una sola pieza cerrada
  assertWatertight(base, "base");
  assert.equal(components(base), 1);
  // los parámetros de ventanas ya no existen: un código viejo que los traía se lee igual, ignorándolos
  const legacy = normalizeLampDefinition({ version: 2, insert: { ventWindows: 6, ventNotches: 4 }, base: { ventSlots: 6 } });
  assert.equal("ventWindows" in legacy.insert, false);
  assert.equal("ventSlots" in legacy.base, false);
  assert.deepEqual(legacy, DEFAULT_LAMP);
});

test("tope de enroscado: la cara plana del cuello apoya en un escalón plano de la base (sin pasar de largo) y no invade la rosca hembra", () => {
  const def = lamp();
  const r = build(def);
  const layout = validateLamp(def).layout;
  const spec = layout.spec;
  const sb = indexedBounds(r.indexed.shade);
  assert.ok(Math.abs(sb.minZ - layout.ledgeZ) < 1e-6, "el cuello apoya a la altura del tope");
  // el anillo inferior del cuello: radio interior = orificio de la cavidad, exterior = raíz de la rosca
  const bottomRadii = new Set();
  const sp = r.indexed.shade.positions;
  for (let i = 0; i < sp.length; i += 3) if (Math.abs(sp[i + 2] - layout.ledgeZ) < 1e-6) bottomRadii.add(Math.round(Math.hypot(sp[i], sp[i + 1]) * 100) / 100);
  assert.deepEqual([...bottomRadii].sort((a, b) => a - b), [Math.round(spec.boreR * 100) / 100, Math.round(spec.rootR * 100) / 100]);
  // la base: el escalón del tope tiene la cavidad (boreR) hacia adentro y el vacío roscado (>= raíz + holgura) hacia afuera
  const baseRadii = new Set();
  const bp = r.indexed.base.positions;
  for (let i = 0; i < bp.length; i += 3) if (Math.abs(bp[i + 2] - layout.ledgeZ) < 1e-6) baseRadii.add(Math.hypot(bp[i], bp[i + 1]));
  assert.ok([...baseRadii].some((x) => Math.abs(x - spec.boreR) < 0.02));
  assert.ok(Math.min(...[...baseRadii].filter((x) => x > spec.boreR + 0.5)) >= spec.rootR + spec.clearance - 0.02);
  // la cara inferior del cuello cabe entera sobre el escalón (apoyo parejo)
  assert.ok(spec.rootR < Math.min(...[...baseRadii].filter((x) => x > spec.boreR + 0.5)));
  // y la pantalla no puede bajar más: sobre el escalón hay base debajo
  assert.ok(rayCrossings(r.indexed.base, [(spec.boreR + spec.rootR) / 2, 0.3, layout.ledgeZ - 5], [0, 0, 1], 10) >= 1);
});

test("base demasiado chica o inestable: errores y avisos claros", () => {
  assert.ok(createLamp(lamp({}, { base: { ...DEFAULT_LAMP.base, diameterMm: 100 } })).errors.some((e) => e.code === "BASE_TOO_SMALL"));
  const unstable = createLamp(lamp({ topDiameterMm: 300, amplitudeMm: 3, profile: "straight" }, { base: { ...DEFAULT_LAMP.base, diameterMm: 140 } }));
  assert.equal(unstable.errors.length, 0, JSON.stringify(unstable.errors.map((e) => e.code)));
  assert.ok(unstable.warnings.some((w) => w.code === "BASE_STABILITY"));
  // una rosca más ancha deja más aire alrededor de la torre y acepta un cilindro más ancho
  const wide = createLamp(lamp({ bottomDiameterMm: 170, topDiameterMm: 170 }, { thread: { ...DEFAULT_LAMP.thread, majorDiameterMm: 130 }, insert: { ...DEFAULT_LAMP.insert, diameterMm: 84 } }));
  assert.equal(wide.errors.length, 0, JSON.stringify(wide.errors.map((e) => e.code + e.message)));
});

test("base E27 preliminar: sin medidas reales se identifica como NO VALIDADA en avisos, archivo y vista previa; con medidas cargadas cambia la etiqueta", () => {
  const prelim = build(lamp());
  assert.ok(prelim.warnings.some((w) => w.code === "HOLDER_NOT_VALIDATED" && /NO VALIDADA/.test(w.message)));
  assert.equal(prelim.geometry.parts[0].filenameSuffix, "base_PRELIMINAR");
  const measured = build(lamp({}, { holder: { ...DEFAULT_LAMP.holder, measured: true } }));
  assert.ok(!measured.warnings.some((w) => w.code === "HOLDER_NOT_VALIDATED"));
  assert.equal(measured.geometry.parts[0].filenameSuffix, "base");
  // aun con medidas cargadas, el diseño sigue pendiente de validación física
  assert.ok(measured.warnings.some((w) => w.code === "PHYSICAL_VALIDATION_PENDING"));
  for (const code of LAMP_NOTICE_CODES) assert.ok(prelim.warnings.some((w) => w.code === code) || code === "HOLDER_NOT_VALIDATED");
});

// ------------------------------------------------------------------ modo vaso
test("modo vaso: el informe usa la pendiente REAL de la pared (campo ≈ malla) y no se declara apta por tener pared fina", () => {
  for (const def of [lampCollar(), lampCollar({ twistDeg: 700, waves: 6, amplitudeMm: 8 }), lampCollar({ family: "organic", organicPct: 90, waves: 6, amplitudeMm: 8, seed: 31337, profile: "tulip", profileAmountPct: 70, topDiameterMm: 200 })]) {
    const r = build(def);
    let meshTilt = 0;
    for (const [a, b, c] of triangles(r.indexed.shade)) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
      if (nx * cx + ny * cy <= 0) continue; // solo piel exterior
      if (Math.abs(nz) / len > 0.999) continue; // bordes
      meshTilt = Math.max(meshTilt, (Math.asin(Math.abs(nz) / len) * 180) / Math.PI);
    }
    assert.ok(Math.abs(meshTilt - r.metrics.shade.vase.maxOverhangDeg) < 3, `malla ${meshTilt.toFixed(1)}° vs informe ${r.metrics.shade.vase.maxOverhangDeg}°`);
    assert.equal(r.metrics.shade.vase.ready, r.metrics.shade.vase.maxOverhangDeg <= LAMP_GEOMETRY.vaseMaxOverhangDeg);
  }
  const thin = lampCollar({ twistDeg: 1440, amplitudeMm: 12, wallMm: 0.8 });
  const r = build(thin);
  assert.equal(r.metrics.shade.vase.ready, false, "pared fina pero pendiente excesiva: NO es modo vaso");
  assert.ok(r.warnings.some((w) => w.code === "SHADE_NOT_VASE"));
  assert.ok(build(lampCollar()).metrics.shade.vase.ready);
  // con la rosca integrada la pantalla lleva paredes macizas: NO se declara apta para modo vaso, aunque su pendiente sea suave
  const integrated = build(lamp());
  assert.equal(integrated.metrics.shade.vase.ready, false);
  assert.match(integrated.metrics.shade.vase.reasons[0], /collar/);
  assert.ok(!integrated.warnings.some((w) => w.code === "SHADE_NOT_VASE"), "no se avisa algo que el usuario no pidió");
});

// ------------------------------------------------------------------ presets y variaciones
test("presets: nueve diseños iniciales válidos, distintos entre sí, aptos para modo vaso y que no pisan altura, diámetro, inserto ni base", () => {
  assert.ok(LAMP_PRESETS.length >= 8);
  const sigs = new Set();
  for (const preset of LAMP_PRESETS) {
    for (const size of [{ heightMm: 160, bottomDiameterMm: 130 }, {}, { heightMm: 260, bottomDiameterMm: 170 }]) {
      const def = applyLampPreset(lampCollar(size), preset);
      assert.equal(def.shade.heightMm, lamp(size).shade.heightMm);
      assert.equal(def.shade.bottomDiameterMm, lamp(size).shade.bottomDiameterMm);
      assert.deepEqual(def.insert, DEFAULT_LAMP.insert);
      assert.deepEqual(def.base, DEFAULT_LAMP.base);
      assert.deepEqual(def.thread, { ...DEFAULT_LAMP.thread, connection: "collar" }, "un diseño inicial no toca la interfaz roscada");
      const r = createLamp(def);
      assert.equal(r.errors.length, 0, `${preset.id} ${JSON.stringify(size)}: ${JSON.stringify(r.errors.map((e) => e.code))}`);
      assert.ok(r.metrics.shade.vase.ready, `${preset.id}: no apto para modo vaso (${r.metrics.shade.vase.maxOverhangDeg}°)`);
    }
    sigs.add(JSON.stringify(applyLampPreset(lamp(), preset).shade));
    // con un diámetro inferior chico un diseño puede no alojar el inserto: se informa, pero nunca hay un error de geometría
    const small = createLamp(applyLampPreset(lamp({ bottomDiameterMm: 100 }), preset));
    assert.ok(small.errors.every((e) => e.code === "INSERT_DOES_NOT_FIT" || e.code === "INSERT_TOUCHES_SHADE"), `${preset.id}: ${JSON.stringify(small.errors.map((e) => e.code))}`);
  }
  assert.equal(sigs.size, LAMP_PRESETS.length);
  assert.ok(new Set(LAMP_PRESETS.map((p) => p.recipe.family)).size === 3, "las tres familias");
});

test("variación: reproducible (misma semilla y base = mismo diseño y mismas mallas), diversa y siempre válida", () => {
  const seeds = Array.from({ length: 24 }, (_, i) => 1000 + i * 7919);
  const designs = seeds.map((s) => generateLampVariation(DEFAULT_LAMP, s));
  const again = seeds.map((s) => generateLampVariation(DEFAULT_LAMP, s));
  assert.deepEqual(designs.map((d) => d.def), again.map((d) => d.def));
  assert.ok(designs.every((d) => !d.fellBack), "ninguna cayó en la reserva");
  assert.ok(new Set(designs.map((d) => JSON.stringify(d.def.shade))).size >= 22, "variaciones distintas");
  assert.ok(new Set(designs.map((d) => d.def.shade.family)).size === 3);
  assert.ok(new Set(designs.map((d) => d.def.shade.profile)).size >= 4);
  for (const { def } of designs) {
    // conserva lo que el usuario fijó
    assert.equal(def.shade.heightMm, DEFAULT_LAMP.shade.heightMm);
    assert.equal(def.shade.bottomDiameterMm, DEFAULT_LAMP.shade.bottomDiameterMm);
    assert.deepEqual(def.insert, DEFAULT_LAMP.insert);
    assert.deepEqual(def.holder, DEFAULT_LAMP.holder);
    assert.ok(def.shade.seed >= 0);
  }
  // misma semilla -> mismas mallas
  clearLampCaches();
  const a = build(designs[3].def), vol = (r) => r.metrics.shade.volumeCm3;
  clearLampCaches();
  const b = build(designs[3].def);
  assert.equal(vol(a), vol(b));
  assert.deepEqual([...a.geometry.parts[2].mesh.positions.slice(0, 600)], [...b.geometry.parts[2].mesh.positions.slice(0, 600)]);
});

test("variaciones aleatorias (24): mallas cerradas, sin degenerados, pendiente imprimible, inserto compatible, y editables después", () => {
  for (let i = 0; i < 24; i++) {
    const { def } = generateLampVariation(lampCollar(), 424242 + i * 104729);
    const r = createLamp(def);
    assert.equal(r.errors.length, 0, `variación ${i}: ${JSON.stringify(r.errors.map((e) => e.code))}`);
    for (const m of [r.indexed.shade, r.indexed.insert, r.indexed.base, r.indexed.collar]) assertWatertight(m, `variación ${i}`);
    assert.deepEqual(def.thread, lampCollar().thread, "la variación no toca la interfaz roscada");
    assert.ok(r.metrics.shade.maxTiltDeg <= LAMP_GEOMETRY.vaseMaxOverhangDeg - 5 + 1e-9);
    assert.ok(r.metrics.shade.vase.ready);
    // el usuario puede seguir editando: un ajuste posterior sigue siendo una definición válida
    const edited = { ...def, shade: { ...def.shade, amplitudeMm: Math.max(0, def.shade.amplitudeMm - 1) } };
    assert.equal(createLamp(edited).errors.length, 0);
  }
});

test("variación sobre medidas ajustadas (pantalla alta y ancha): también respeta el inserto", () => {
  const base = lamp({ heightMm: 280, bottomDiameterMm: 170 });
  for (let i = 0; i < 6; i++) {
    const { def, fellBack } = generateLampVariation(base, 99 + i * 31);
    assert.equal(fellBack, false);
    assert.equal(createLamp(def).errors.length, 0);
  }
});

// ------------------------------------------------------------------ rendimiento y cache
test("rendimiento: tiempo de generación y tamaño de malla medidos; el cache evita regenerar lo que no cambió", () => {
  clearLampCaches();
  const t0 = performance.now();
  const first = build(lamp());
  const cold = performance.now() - t0;
  console.log(`[lamparas] defecto: ${first.metrics.totalTriangles} triángulos (pantalla ${first.metrics.shade.triangleCount}, inserto ${first.metrics.insert.triangleCount}, base ${first.metrics.base.triangleCount}), ${cold.toFixed(0)} ms en frío`);
  assert.ok(first.metrics.totalTriangles < 180_000);
  // presupuesto de la parte decorativa + el cuello roscado (≈ 2 × nTheta × filas de rosca, ≈ 4 × nTheta × 120 con margen)
  assert.ok(first.metrics.shade.triangleCount <= LAMP_GEOMETRY.maxShadeTriangles + 4 * 384 * 120);
  assert.ok(cold < 8000, `generación en frío ${cold} ms`);
  const sizes = [];
  for (const [name, def] of Object.entries(CASES)) {
    const t = performance.now();
    const r = build(def);
    sizes.push(`${name}: ${r.metrics.totalTriangles} tri, ${(performance.now() - t).toFixed(0)} ms`);
    assert.ok(r.metrics.totalTriangles < 330_000, `${name}: malla demasiado densa`);
  }
  console.log("[lamparas] " + sizes.join(" | "));

  // solo el color: nada se regenera (misma clave de geometría, mismas mallas)
  const first2 = build(lamp());
  const recolored = { ...DEFAULT_LAMP, insert: { ...DEFAULT_LAMP.insert, previewColor: "#0000ff" } };
  assert.equal(lampGeometryKey(recolored), lampGeometryKey(DEFAULT_LAMP));
  const again = build(recolored);
  assert.ok(again.geometry.parts[2].mesh === first2.geometry.parts[2].mesh, "pantalla reutilizada");
  assert.ok(again.geometry.parts[1].mesh === first2.geometry.parts[1].mesh, "inserto reutilizado");
  // solo el inserto: la pantalla no se regenera
  const thick = build({ ...DEFAULT_LAMP, insert: { ...DEFAULT_LAMP.insert, thicknessMm: 0.6 } });
  assert.ok(thick.geometry.parts[2].mesh === first2.geometry.parts[2].mesh, "pantalla reutilizada al cambiar el inserto");
  assert.ok(thick.geometry.parts[1].mesh !== first2.geometry.parts[1].mesh);
  // solo la pantalla: el inserto se regenera porque su diámetro depende de la pantalla (automático), la base no si el diámetro no cambia
  const manual = { ...DEFAULT_LAMP };
  const m1 = build(manual);
  const m2 = build({ ...manual, shade: { ...manual.shade, amplitudeMm: 5 } });
  assert.ok(m2.geometry.parts[1].mesh === m1.geometry.parts[1].mesh, "cilindro de diámetro manual no se regenera");
  assert.ok(m2.geometry.parts[0].mesh === m1.geometry.parts[0].mesh, "base no se regenera");
});

// ------------------------------------------------------------------ exportación
async function readStl(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  const count = buf.readUInt32LE(80);
  assert.equal(buf.length, 84 + 50 * count);
  const positions = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) positions[t * 9 + v * 3 + c] = buf.readFloatLE(84 + t * 50 + 12 + v * 12 + c * 4);
  return { count, positions };
}

test("exportación STL: tres archivos con exactamente las mallas del visor (misma cantidad de triángulos y vértices), dimensiones reales en mm", async () => {
  const def = lamp();
  const r = build(def);
  const entries = lampPartEntries(r);
  assert.deepEqual(entries.map((e) => e.fileName), ["lampara_base_PRELIMINAR.stl", "lampara_cilindro.stl", "lampara_pantalla.stl"]);
  for (const [i, entry] of entries.entries()) {
    const viewer = r.geometry.parts[i].mesh;
    const stl = await readStl(buildSTLBlob(entry.mesh));
    assert.equal(stl.count, viewer.triangleCount, `${entry.fileName}: triángulos`);
    assert.equal(entry.mesh.triangleCount, viewer.triangleCount);
  }
  // pantalla y base salen en la misma orientación y coordenadas que el visor (identidad)
  for (const idx of [0, 2]) {
    const stl = await readStl(buildSTLBlob(entries[idx].mesh));
    const viewer = r.geometry.parts[idx].mesh.positions;
    for (let k = 0; k < viewer.length; k += 97) assert.ok(Math.abs(stl.positions[k] - viewer[k]) < 1e-5);
  }
  // el inserto exporta dado vuelta (lengüetas contra la cama): mismas dimensiones, apoyado en Z=0
  const insertStl = await readStl(buildSTLBlob(entries[1].mesh));
  let minZ = Infinity, maxZ = -Infinity;
  for (let k = 2; k < insertStl.positions.length; k += 3) { minZ = Math.min(minZ, insertStl.positions[k]); maxZ = Math.max(maxZ, insertStl.positions[k]); }
  const vb = indexedBounds(r.indexed.insert);
  assert.ok(Math.abs(minZ) < 1e-5 && Math.abs(maxZ - (vb.maxZ - vb.minZ)) < 1e-4);
  // dimensiones reales: la pantalla exportada mide lo que dice el diseño
  const shadeB = r.metrics.shade.boundingBox;
  assert.ok(Math.abs(shadeB.height - (r.metrics.fit.shadeTopZ - r.metrics.fit.shadeBottomZ)) < 1e-6, "la pantalla mide cuello + transición + altura del diseño");
  assert.ok(Math.abs(r.metrics.fit.shadeTopZ - r.metrics.fit.decorBottomZ - def.shade.heightMm) < 1e-9, "la parte decorativa mide la altura pedida");
  assert.ok(shadeB.width >= def.shade.bottomDiameterMm && shadeB.width <= def.shade.bottomDiameterMm * 1.6);
  assert.equal(lampEntryForKind(r, "lampShade").fileName, "lampara_pantalla.stl");
});

test("exportación: ZIP con las tres piezas + LEEME con avisos de seguridad y el código del diseño; no exporta vacíos ni inválidos", async () => {
  const def = lamp();
  const r = build(def);
  const zip = await JSZip.loadAsync(Buffer.from(await (await buildLampZipBlob(r, def)).arrayBuffer()));
  assert.deepEqual(Object.keys(zip.files).sort(), ["LEEME.txt", "lampara_base_PRELIMINAR.stl", "lampara_cilindro.stl", "lampara_pantalla.stl"]);
  const readme = await zip.file("LEEME.txt").async("string");
  assert.match(readme, /PENDIENTE DE VALIDACIÓN FÍSICA/);
  assert.match(readme, /NO VALIDADA/);
  assert.match(readme, /MEDIDAS A VERIFICAR/);
  assert.match(readme, /PRUEBAS FÍSICAS/);
  const code = readme.match(/SL1:[A-Za-z0-9_-]+/)[0];
  assert.deepEqual(decodeLampDesign(code).def, def);
  for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".stl"))) {
    const stl = await readStl(new Blob([await zip.file(name).async("uint8array")]));
    assert.ok(stl.count > 1000);
  }
  // inválido: no se exporta nada
  const bad = createLamp(lamp({ waves: 32, amplitudeMm: 25 }));
  assert.throws(() => lampPartEntries(bad), /crestas|no es imprimible|pliegue|plegar/i);
  // pieza vacía: se rechaza
  const empty = { ...r, geometry: { ...r.geometry, parts: [{ ...r.geometry.parts[0], mesh: { positions: new Float32Array(0), normals: new Float32Array(0), triangleCount: 0 } }, ...r.geometry.parts.slice(1)] } };
  assert.throws(() => lampPartEntries(empty), /vacía/);
  // sin inserto: dos archivos
  const noInsert = build(lamp({}, { insert: { ...DEFAULT_LAMP.insert, enabled: false } }));
  assert.equal(lampPartEntries(noInsert).length, 2);
});

test("visor = exportación: orientación de impresión, explosión y Vista Cama salen de las mismas mallas", () => {
  const r = build(lamp());
  // tabla de orientación completa para los tipos nuevos
  assert.ok("lampShade" in PRINT_TRANSFORM_BY_KIND && "lampInsert" in PRINT_TRANSFORM_BY_KIND);
  assert.equal(PRINT_TRANSFORM_BY_KIND.lampInsert.rotationYDeg, 180);
  assert.equal(PRINT_TRANSFORM_BY_KIND.lampShade.rotationYDeg, 0);
  // orden de armado: base (ancla) -> inserto -> collar -> pantalla
  assert.deepEqual([PART_ASSEMBLY_LAYER.body, PART_ASSEMBLY_LAYER.lampInsert, PART_ASSEMBLY_LAYER.lampCollar, PART_ASSEMBLY_LAYER.lampShade], [0, 1, 2, 3]);
  assert.equal(PRINT_TRANSFORM_BY_KIND.lampCollar.rotationYDeg, 0, "el collar se imprime con el cuello roscado sobre la cama");
  const ranks = computeExplodeRanks(r.geometry.parts.map((p) => p.kind));
  assert.equal(ranks.get("lampInsert"), 1);
  assert.equal(ranks.get("lampShade"), 2);
  assert.equal(ranks.has("body"), false);
  // Vista Cama: tres piezas, cada una en su orientación de impresión; el inserto invertido conserva su altura
  const items = collectBedItems(r.geometry);
  assert.deepEqual(items.map((i) => i.kind).sort(), ["body", "lampInsert", "lampShade"]);
  const layout = computeBedLayout(items, getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID));
  assert.equal(layout.plates.reduce((n, p) => n + p.placements.length, 0), 3);
  const ins = items.find((i) => i.kind === "lampInsert");
  assert.ok(Math.abs(ins.heightMm - r.metrics.insert.boundingBox.height) < 1e-3);
  // la exportación usa partFileEntries (misma fuente que la cama)
  assert.equal(partFileEntries(r.geometry.parts, "x").length, 3);
});

// ------------------------------------------------------------------ código del diseño, límites y seguridad
test("código del diseño: ida y vuelta exacta (incluida la semilla), tolerante con códigos viejos y rechaza basura", () => {
  const def = generateLampVariation(DEFAULT_LAMP, 7777).def;
  const code = encodeLampDesign(def);
  assert.match(code, /^SL1:[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeLampDesign(code).def, def);
  assert.ok("error" in decodeLampDesign("hola"));
  assert.ok("error" in decodeLampDesign("SL1:@@@@"));
  // campos faltantes o con tipo incorrecto -> valores por defecto (no recorta rangos: valida después)
  const tolerant = normalizeLampDefinition({ shade: { waves: "doce", heightMm: 9999 }, insert: { previewColor: "rojo" } });
  assert.equal(tolerant.shade.waves, DEFAULT_LAMP.shade.waves);
  assert.equal(tolerant.shade.heightMm, 9999);
  assert.equal(tolerant.insert.previewColor, DEFAULT_LAMP.insert.previewColor);
  assert.ok(createLamp(tolerant).errors.some((e) => e.field === "shade.heightMm"));
  assert.equal(normalizeLampDefinition(null).version, 2);
  // códigos de la primera versión (sin interfaz roscada, con espiga en threadDiameterMm) se leen completando lo que falta
  const legacy = normalizeLampDefinition({ version: 1, shade: { heightMm: 150 }, holder: { threadDiameterMm: 13, bodyDiameterMm: 50, mount: "screws" }, insert: { ventNotches: 4 }, base: { heightMm: 36, ventGapMm: 3 } });
  assert.equal(legacy.holder.bodyDiameterMm, 50);
  assert.equal(legacy.holder.boreDiameterMm, DEFAULT_LAMP.holder.boreDiameterMm, "el alojamiento nuevo toma los valores de referencia");
  assert.equal("ventWindows" in legacy.insert, false, "las muescas/ventanas viejas se ignoran: el cilindro ya no tiene aberturas");
  assert.deepEqual(legacy.thread, DEFAULT_LAMP.thread);
  assert.equal("ventSlots" in legacy.base, false);
});

test("límites: cada campo numérico fuera de rango se rechaza con su propio campo, sin tocar geometría", () => {
  for (const [key, limit] of Object.entries(LAMP_LIMITS)) {
    const [group, name] = key.split(".");
    for (const value of [limit.min - 1, limit.max + 1]) {
      const def = { ...DEFAULT_LAMP, [group]: { ...DEFAULT_LAMP[group], [name]: value } };
      const v = validateLamp(def);
      assert.ok(v.errors.some((e) => e.field === key && e.code === "OUT_OF_RANGE"), `${key}=${value}`);
      assert.equal(v.field, null);
    }
  }
});

test("seguridad: avisos siempre presentes, sin contactos eléctricos ni cableado de red en la geometría y sin afirmar distancias seguras", () => {
  const r = build(lamp());
  assert.ok(r.warnings.some((w) => w.code === "PHYSICAL_VALIDATION_PENDING"));
  // el engine no genera ninguna pieza eléctrica: solo pantalla, inserto y base
  assert.deepEqual(r.geometry.parts.map((p) => p.kind), ["body", "lampInsert", "lampShade"]);
  assert.deepEqual(build(lampCollar()).geometry.parts.map((p) => p.kind), ["body", "lampInsert", "lampCollar", "lampShade"]);
  const safety = read("lib/maker/lamps/safety.ts");
  assert.match(safety, /No hay datos verificados de temperatura/);
  assert.match(safety, /NO una distancia térmicamente segura/);
  assert.match(safety, /PETG/);
  assert.match(safety, /no da instrucciones de cableado de red/);
  assert.doesNotMatch(safety, /es seguro a \d+ ?°?C|distancia segura de \d+/i);
  // la separación mínima y el piso geométrico se describen como de diseño / anti-contacto
  assert.match(read("lib/maker/lamps/types.ts"), /NO es una distancia térmicamente segura/);
  assert.match(read("lib/maker/lamps/types.ts"), /no hay datos para afirmar ventilación ni temperatura/i);
});

test("disponibilidad: Lámparas es Beta / solo administradores y la ruta se protege server-side", () => {
  assert.equal(canAccessMakerTool("/stampa-maker/lamparas", true), true);
  assert.equal(canAccessMakerTool("/stampa-maker/lamparas", false), false);
  const entry = MAKER_TOOL_AVAILABILITY.find((t) => t.href === "/stampa-maker/lamparas");
  assert.equal(entry.beta, true);
  assert.equal(entry.adminOnly, true);
  const layout = read("app/stampa-maker/lamparas/layout.tsx");
  assert.doesNotMatch(layout, /"use client"/);
  assert.match(layout, /capabilities\.accessAdmin/);
  assert.match(layout, /redirect\("\/stampa-maker"\)/);
  assert.match(read("app/stampa-maker/page.tsx"), /\/stampa-maker\/lamparas/);
});

// ------------------------------------------------------------------ UI
test("UI: panel en tres secciones (diseño, iluminación, fabricación), botón Generar variación, selector de color, avisos de seguridad y descargas por pieza", () => {
  const { MakerLampControls, LampExportButtons } = loadTs("src/components/maker/MakerLampControls.tsx", { "next/link": { __esModule: true, default: (props) => createElement("a", props) }, "opentype.js": {} });
  const r = createLamp(DEFAULT_LAMP);
  const html = renderToStaticMarkup(
    createElement(MakerLampControls, {
      def: DEFAULT_LAMP, onChange() {}, onApplyPreset() {}, onGenerateVariation() {}, onLoadDesign() {}, onError() {},
      errors: r.errors, warnings: r.warnings, metrics: r.metrics, exportButtons: createElement(LampExportButtons, { hasInsert: true, hasCollar: true, canDownload: true, canDownloadTests: true, busy: null, onDownloadPart() {}, onDownloadZip() {}, onDownloadTests() {}, holderMeasured: false }),
    }),
  );
  for (const text of ["1 · Diseño", "Generar variación", "2 · Iluminación", "3 · Fabricación", "Perfil de base E27", "Doble anillo", "Pendiente de validación física", "NO VALIDADA", "Medidas que tenés que verificar", "Pruebas físicas antes de usarla", "Pantalla (STL)", "Collar roscado (STL)", "Cilindro (STL)", "Base preliminar (STL)", "Todo en un ZIP", "Piezas de prueba (ZIP)", "Código del diseño", "Rosca de unión pantalla–base", "Holguras del ensamblaje", "Parámetros de la rosca", "Ranuras para precinto", "Modo de impresión", "Ø agujero central", "Rebaje de los anillos"]) {
    assert.ok(html.includes(text), `falta "${text}"`);
  }
  assert.equal((html.match(/role="radio"/g) ?? []).length, 9, "nueve colores de referencia (el selector libre no es un radio)");
  assert.ok(html.includes("Rojo") && html.includes("Azul") && html.includes("Verde"));
  // el color es solo una referencia visual
  assert.ok(html.includes("aproximación visual"));
  assert.ok(html.includes("modo vaso"));
});

test("UI: miniaturas de los diseños iniciales salen del mismo evaluador que la geometría", () => {
  const a = lampSilhouette(lamp().shade, 64), b = lampSilhouette(applyLampPreset(lamp(), LAMP_PRESETS.find((p) => p.id === "campana")).shade, 64);
  assert.notEqual(a.crest, b.crest);
  assert.ok(b.width > a.width);
  assert.match(a.crest, /^M[\d.,L-]+Z$/);
});

test("visor: props opcionales zUp / hiddenKinds / partColors, sin tocar el comportamiento de las otras herramientas", () => {
  const viewport = read("components/maker/MakerViewport.tsx");
  assert.match(viewport, /zUp\?: boolean/);
  assert.match(viewport, /hiddenKinds\?:/);
  assert.match(viewport, /sectionView\?: boolean/);
  assert.match(viewport, /partColors\?:/);
  // los valores por defecto conservan el comportamiento previo
  assert.match(viewport, /zUp = false, hiddenKinds = null, partColors = null, sectionView = false/);
  for (const rel of ["app/stampa-maker/carteles/page.tsx", "app/stampa-maker/neon/page.tsx", "app/stampa-maker/jarros/page.tsx"]) assert.doesNotMatch(read(rel), /zUp|hiddenKinds|partColors/);
  const page = read("app/stampa-maker/lamparas/page.tsx");
  assert.match(page, /zUp/);
  assert.match(page, /useLampGeometry/);
  assert.doesNotMatch(page, /tutorial/i, "no se crea un sistema paralelo de tutoriales");
});
