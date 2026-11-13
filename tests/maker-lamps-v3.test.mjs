import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { loadTs } from "./helpers/load-ts.mjs";
import { loadLampUi } from "./helpers/lamp-editor-ui.mjs";

// Lámparas V3: pantallas CALADAS (diamante y espiral) con siluetas paramétricas.
// Todo se mide sobre las MALLAS generadas (las mismas que ve el visor y exporta el STL): rayos contra triángulos, topología,
// componentes conexas. Son pruebas GEOMÉTRICAS: no reemplazan laminar en Bambu Studio, imprimir ni la prueba térmica.

const { DEFAULT_LAMP, normalizeLampDefinition, applyInsertStyle, DEFAULT_OPENWORK } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp, clearLampCaches, meshComponents } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { LAMP_GEOMETRY, LAMP_LIMITS } = loadMakerModule("lib/maker/lamps/types.ts");
const { analyzeMesh, indexedBounds } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { sampleOpenworkField } = loadMakerModule("lib/maker/lamps/openwork/field.ts");
const { createSilhouette, silhouetteInput, silhouetteRecipe } = loadMakerModule("lib/maker/lamps/openwork/silhouette.ts");
const { OPENWORK_PRESETS, applyOpenworkPreset, applyShadeType, applySilhouette, openworkPresetMatches } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { renderOpenworkThumbnail } = loadMakerModule("lib/maker/lamps/openwork/thumbnail.ts");
const { cutShellMesh } = loadMakerModule("lib/maker/lamps/openwork/cutShell.ts");
const { lampPartEntries, buildLampZipBlob } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { encodeLampDesign, decodeLampDesign } = loadMakerModule("lib/maker/lamps/designCode.ts");

// ------------------------------------------------------------------ utilidades
// Estas pruebas son de la estructura calada y la silueta (V3): usan el difusor manual de Ø65 de siempre. El difusor según los anillos (V4.1) se prueba en maker-lamps-v41-diffuser.test.mjs.
const BASE = { ...DEFAULT_LAMP, shadeType: "openwork", base: { diameterMm: 130 }, openwork: { ...DEFAULT_LAMP.openwork, diffuserFit: "manual" } };
const ow = (patch = {}, rest = {}) => ({ ...BASE, ...rest, openwork: { ...BASE.openwork, ...patch } });
const shadeDims = (patch) => ({ shade: { ...BASE.shade, ...patch } });
const build = (def) => {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `errores: ${JSON.stringify(r.errors.map((e) => e.code + " " + e.message))}`);
  return r;
};
const codes = (def) => {
  const r = createLamp(def);
  return { errors: r.errors.map((e) => e.code), warnings: r.warnings.map((e) => e.code) };
};

function assertClean(mesh, label) {
  const r = analyzeMesh(mesh);
  assert.equal(r.nonFinite, 0, `${label}: NaN/Infinity`);
  assert.equal(r.degenerate, 0, `${label}: triángulos degenerados`);
  assert.equal(r.boundaryEdges, 0, `${label}: malla abierta`);
  assert.equal(r.nonManifoldEdges, 0, `${label}: aristas no-manifold`);
  assert.equal(r.inconsistentEdges, 0, `${label}: normales incoherentes`);
  assert.ok(r.volume > 0, `${label}: volumen no positivo`);
  return r;
}

/** Lanzador de rayos HORIZONTALES desde el eje (0,0,z) hacia el ángulo θ: devuelve las distancias de cruce, ordenadas. */
function makeCaster(mesh) {
  const p = mesh.positions;
  const bins = new Map();
  const BIN = 2;
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const a = mesh.tris[i] * 3, b = mesh.tris[i + 1] * 3, c = mesh.tris[i + 2] * 3;
    const lo = Math.min(p[a + 2], p[b + 2], p[c + 2]), hi = Math.max(p[a + 2], p[b + 2], p[c + 2]);
    for (let k = Math.floor(lo / BIN); k <= Math.floor(hi / BIN); k++) {
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(i);
    }
  }
  return (z, theta) => {
    const dx = Math.cos(theta), dy = Math.sin(theta);
    const hits = [];
    for (const i of bins.get(Math.floor(z / BIN)) ?? []) {
      const a = mesh.tris[i] * 3, b = mesh.tris[i + 1] * 3, c = mesh.tris[i + 2] * 3;
      const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
      // dirección (dx, dy, 0)
      const hx = dy * e2z, hy = -dx * e2z, hz = dx * e2y - dy * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-12) continue;
      const f = 1 / det;
      const sx = -p[a], sy = -p[a + 1], sz = z - p[a + 2];
      const u = f * (sx * hx + sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = f * (dx * qx + dy * qy);
      if (v < 0 || u + v > 1) continue;
      const t = f * (e2x * qx + e2y * qy + e2z * qz);
      if (t > 1e-9) hits.push(t);
    }
    hits.sort((m, n) => m - n);
    // fusiona cruces casi coincidentes (rayo exacto por una arista compartida entre dos triángulos) y descarta los cruces dobles
    // rasantes (el rayo roza un flanco de corte, que no es exactamente radial: entra y sale a < 0,1 mm sin atravesar material)
    const merged = hits.filter((t, k) => k === 0 || t - hits[k - 1] > 1e-6);
    const out = [];
    for (let k = 0; k < merged.length; k++) {
      if (k + 1 < merged.length && merged[k + 1] - merged[k] < 0.1) { k++; continue; }
      out.push(merged[k]);
    }
    return out;
  };
}

/** z de ensamblado de cada fila del campo y zona calada (donde el campo ya no es anillo). */
function latticeBand(def, r) {
  const f = r.metrics.fit;
  const field = sampleOpenworkField(def.shade, def.openwork);
  return { zFrom: f.decorBottomZ + field.z[field.latticeRowFrom] + 0.5, zTo: f.decorBottomZ + field.z[field.latticeRowTo] - 0.5, decorZ0: f.decorBottomZ, field };
}

// ------------------------------------------------------------------ integridad de los patrones
test("diamante y espiral: mallas cerradas, orientadas, sin triángulos degenerados y de UNA sola pieza", () => {
  const cases = [
    ["diamante base", ow()],
    ["diamante 8", ow({ divisions: 8, stripWidthMm: 6 })],
    ["diamante 20", ow({ divisions: 20, stripWidthMm: 3, inclinationDeg: 62 })],
    ["diamante fino", ow({ divisions: 16, stripWidthMm: 2.4, inclinationDeg: 62 })],
    ["diamante ancho", ow({ divisions: 10, stripWidthMm: 9, inclinationDeg: 55 })],
    ["diamante torsión +", ow({ twistDeg: 90, inclinationDeg: 62 })],
    ["diamante torsión −", ow({ twistDeg: -90, inclinationDeg: 62 })],
    ["diamante fase", ow({ phaseDeg: 77 })],
    ["diamante variación", ow({ variationPct: 40, variationCycles: 2 })],
    ["espiral base", ow({ pattern: "spiral", bands: 6, turns: 0.4, stripWidthMm: 7 })],
    ["espiral 12 bandas", ow({ pattern: "spiral", bands: 12, turns: 0.3, stripWidthMm: 4 })],
    ["espiral inversa", ow({ pattern: "spiral", bands: 6, turns: -0.4, stripWidthMm: 7 })],
    ["espiral con anillos", ow({ pattern: "spiral", bands: 8, turns: 0.5, stripWidthMm: 4, connectors: 3, connectorWidthMm: 4 })],
    ["espiral variación", ow({ pattern: "spiral", bands: 8, turns: 0.4, stripWidthMm: 4, variationPct: 50, variationCycles: 2 })],
  ];
  for (const [name, def] of cases) {
    const r = build(def);
    assertClean(r.indexed.shade, name);
    assert.equal(r.metrics.openwork.components, 1, `${name}: la pantalla debe ser UNA pieza conectada`);
    assert.equal(meshComponents(r.indexed.shade), 1, name);
    assert.equal(r.metrics.shade.watertight, true, name);
    assert.ok(r.metrics.openwork.aperturePct > 10 && r.metrics.openwork.aperturePct < 95, `${name}: aberturas ${r.metrics.openwork.aperturePct}%`);
  }
});

test("las aberturas son huecos REALES: rayos radiales cruzan 0 ó 2 veces la pared, y la fracción abierta coincide con el reporte", () => {
  for (const def of [ow(), ow({ pattern: "spiral", bands: 6, turns: 0.4, stripWidthMm: 7 })]) {
    const r = build(def);
    const cast = makeCaster(r.indexed.shade);
    const { zFrom, zTo, field } = latticeBand(def, r);
    let open = 0, total = 0;
    for (let a = 0; a < 40; a++) {
      for (let b = 0; b < 160; b++) {
        const z = zFrom + ((zTo - zFrom) * (a + 0.37)) / 40;
        const theta = (2 * Math.PI * (b + 0.31)) / 160;
        const hits = cast(z, theta);
        assert.ok(hits.length === 0 || hits.length === 2, `rayo con ${hits.length} cruces (z=${z.toFixed(2)}, θ=${theta.toFixed(3)}, patrón ${def.openwork.pattern}, t=${hits.map((h) => h.toFixed(3))}): ni abertura ni pared simple`);
        total++;
        if (hits.length === 0) open++;
      }
    }
    const measured = (100 * open) / total;
    assert.ok(Math.abs(measured - r.metrics.openwork.aperturePct) < 4, `abertura medida ${measured.toFixed(1)}% vs reporte ${r.metrics.openwork.aperturePct}%`);
    assert.ok(field.report.aperturePct > 20);
  }
});

test("la profundidad de las tiras se mide en la malla: grosor de pared = profundidad × √(1+pendiente²)", () => {
  for (const depth of [1.6, 2.4, 3.6]) {
    const def = ow({ depthMm: depth, maxDiameterMm: 150 });
    const r = build(def);
    const cast = makeCaster(r.indexed.shade);
    const { zFrom, zTo, field } = latticeBand(def, r);
    const R = createSilhouette(silhouetteInput(def.shade, def.openwork));
    let checked = 0;
    for (let a = 0; a < 20; a++) {
      for (let b = 0; b < 90; b++) {
        const z = zFrom + ((zTo - zFrom) * (a + 0.5)) / 20;
        const hits = cast(z, (2 * Math.PI * (b + 0.3)) / 90);
        if (hits.length !== 2) continue;
        const u = (z - latticeBand(def, r).decorZ0) / def.shade.heightMm;
        const slope = (R(u + 0.002) - R(u - 0.002)) / (0.004 * def.shade.heightMm);
        // el espesor medido en el rayo horizontal es la diferencia de radios (piel exterior − interior)
        const expected = depth * Math.sqrt(1 + slope * slope);
        assert.ok(Math.abs(hits[1] - hits[0] - expected) < 0.06 * expected + 0.05, `grosor ${(hits[1] - hits[0]).toFixed(3)} vs ${expected.toFixed(3)}`);
        checked++;
      }
    }
    assert.ok(checked > 300);
    assert.ok(field.rowRin[10] < field.rowR[10]);
  }
});

test("espiral: el número de bandas se cuenta sobre la malla (intervalos de material a una altura fija)", () => {
  for (const bands of [3, 6, 9]) {
    const def = ow({ pattern: "spiral", bands, turns: 0.4, stripWidthMm: 4 });
    const r = build(def);
    const cast = makeCaster(r.indexed.shade);
    const { zFrom, zTo } = latticeBand(def, r);
    const z = (zFrom + zTo) / 2 + 0.123;
    let intervals = 0, prev = null;
    const N = 1440;
    for (let k = 0; k < N; k++) {
      const solid = cast(z, ((k + 0.5) / N) * 2 * Math.PI).length > 0;
      if (solid && prev === false) intervals++;
      prev = solid;
    }
    // si la primera muestra es material y la última también, el intervalo se cuenta una vez de menos
    const first = cast(z, (0.5 / N) * 2 * Math.PI).length > 0;
    const last = cast(z, ((N - 0.5) / N) * 2 * Math.PI).length > 0;
    if (first && last) intervals++;
    assert.equal(intervals, bands, `${bands} bandas -> ${intervals} intervalos`);
  }
});

test("diamante: a una altura fija cruzan entre N y 2N tiras (las dos diagonales), y las aberturas nunca desaparecen en los cruces", () => {
  for (const N of [8, 12, 16]) {
    const def = ow({ divisions: N, stripWidthMm: 3.5 });
    const r = build(def);
    const cast = makeCaster(r.indexed.shade);
    const { zFrom, zTo } = latticeBand(def, r);
    for (const frac of [0.3, 0.5, 0.7]) {
      const z = zFrom + (zTo - zFrom) * frac;
      let intervals = 0, prev = null;
      const M = 1440;
      for (let k = 0; k < M; k++) {
        const solid = cast(z, ((k + 0.5) / M) * 2 * Math.PI).length > 0;
        if (solid && prev === false) intervals++;
        prev = solid;
      }
      assert.ok(intervals >= N - 1 && intervals <= 2 * N + 1, `N=${N} z=${z.toFixed(1)}: ${intervals} intervalos`);
    }
  }
});

test("no hay autointersecciones: los rayos nunca cruzan más de dos veces la pared en la zona calada ni un número impar en todo el alto", () => {
  const def = ow({ twistDeg: 90, inclinationDeg: 62, maxDiameterMm: 160 }, { shade: { ...BASE.shade, topDiameterMm: 120 } });
  const r = build(def);
  const cast = makeCaster(r.indexed.shade);
  for (let a = 0; a < 60; a++) {
    for (let b = 0; b < 60; b++) {
      const z = r.metrics.fit.decorBottomZ + 3 + (a / 59) * (def.shade.heightMm - 6);
      const hits = cast(z, (2 * Math.PI * (b + 0.17)) / 60);
      assert.ok(hits.length % 2 === 0 && hits.length <= 2, `${hits.length} cruces en z=${z.toFixed(1)}`);
    }
  }
});

// ------------------------------------------------------------------ siluetas
test("siluetas: cilíndrica, abombada, reloj de arena y orgánica salen del MISMO motor y la malla coincide con la curva", () => {
  const kinds = ["cylinder", "bulge", "hourglass", "organic"];
  const diam = {};
  for (const kind of kinds) {
    for (const pattern of ["diamond", "spiral"]) {
      const start = applySilhouette({ ...BASE, openwork: { ...BASE.openwork, pattern, bands: 6, turns: 0.4, stripWidthMm: pattern === "spiral" ? 6 : 4 } }, kind);
      const r = build(start);
      assertClean(r.indexed.shade, `${kind}/${pattern}`);
      assert.equal(r.metrics.openwork.components, 1);
      const R = createSilhouette(silhouetteInput(start.shade, start.openwork));
      // el radio exterior de la malla en las filas de los anillos (sólidas) es exactamente el de la curva
      const p = r.indexed.shade.positions;
      const decorZ0 = r.metrics.fit.decorBottomZ;
      let checked = 0;
      for (let i = 0; i < p.length; i += 3) {
        const zLocal = p[i + 2] - decorZ0;
        if (zLocal < 0.5 || zLocal > start.shade.heightMm - 0.5) continue;
        const rad = Math.hypot(p[i], p[i + 1]);
        const expectedOuter = R(zLocal / start.shade.heightMm);
        // un vértice de la grilla está sobre la piel exterior (radio R) o la interior (R − profundidad·S) o en un corte (interpolado entre ambas)
        assert.ok(rad <= expectedOuter + 0.35 && rad >= expectedOuter - start.openwork.depthMm * 1.6 - 0.35, `radio ${rad.toFixed(2)} fuera de la silueta ${expectedOuter.toFixed(2)} (${kind})`);
        checked++;
      }
      assert.ok(checked > 1000);
      diam[kind] = r.metrics.openwork;
    }
  }
  assert.ok(Math.abs(diam.cylinder.maxDiameterMm - diam.cylinder.minDiameterMm) < 1e-6 + 0.2, "cilíndrica: diámetro constante");
  assert.ok(diam.bulge.maxDiameterMm > diam.cylinder.maxDiameterMm * 1.25, "abombada: más ancha en el medio");
  assert.ok(diam.hourglass.minDiameterMm < diam.hourglass.maxDiameterMm * 0.75, "reloj de arena: cintura");
  assert.ok(diam.organic.maxDiameterMm > diam.organic.minDiameterMm, "orgánica: cambia el diámetro");
});

test("silueta: continua (sin saltos), diámetro máximo y posición del ensanchamiento respetados; extremos con pendiente suave", () => {
  const sil = (patch) => createSilhouette(silhouetteInput({ ...BASE.shade, bottomDiameterMm: 120, topDiameterMm: 120 }, { ...BASE.openwork, ...patch }));
  const R = sil({ maxDiameterMm: 170, bulgePositionPct: 35, curvaturePct: 40 });
  let maxU = 0, maxR = 0;
  for (let i = 0; i <= 1000; i++) {
    const u = i / 1000;
    if (R(u) > maxR) { maxR = R(u); maxU = u; }
    if (i > 0) assert.ok(Math.abs(R(u) - R(u - 0.001)) < 0.8, "salto de radio entre muestras vecinas");
  }
  assert.ok(Math.abs(maxR - 85) < 0.2, `máximo ${maxR}`);
  assert.ok(Math.abs(maxU - 0.35) < 0.02, `posición ${maxU}`);
  assert.ok(Math.abs(R(0) - 60) < 1e-9 && Math.abs(R(1) - 60) < 1e-9, "extremos = diámetros inferior y superior");
  assert.ok(Math.abs(R(0.002) - 60) < 0.05 && Math.abs(R(0.998) - 60) < 0.05, "pendiente casi nula contra los anillos");
  // la cintura baja el diámetro por debajo de los extremos y deja los extremos intactos
  const W = sil({ maxDiameterMm: 120, waistPct: 60, bulgePositionPct: 50 });
  assert.ok(W(0.5) < 60 * 0.75 && Math.abs(W(0) - 60) < 1e-9);
  // determinista por semilla
  const O1 = sil({ organicPct: 80, seed: 5 }), O2 = sil({ organicPct: 80, seed: 5 }), O3 = sil({ organicPct: 80, seed: 6 });
  assert.equal(O1(0.4), O2(0.4));
  assert.notEqual(O1(0.4), O3(0.4));
});

// ------------------------------------------------------------------ interfaz E27: anillo inferior, rosca, base, difusor
test("anillo inferior continuo: las tiras empiezan por encima de la zona funcional (rosca, cuello y transición de 45°)", () => {
  const def = ow({ bottomRingMm: 14 });
  const r = build(def);
  const layout = validateLamp(def).layout;
  const cast = makeCaster(r.indexed.shade);
  // en todo el anillo inferior, TODAS las direcciones atraviesan material (pared sólida de revolución)
  for (let k = 0; k < 8; k++) {
    const z = layout.decorZ0 + 0.5 + (k / 7) * 13;
    for (let b = 0; b < 90; b++) assert.equal(cast(z, (2 * Math.PI * (b + 0.4)) / 90).length, 2, `anillo inferior discontinuo en z=${z.toFixed(2)}`);
  }
  // el primer hueco aparece por encima del anillo
  const { zFrom } = latticeBand(def, r);
  assert.ok(zFrom >= layout.decorZ0 + def.openwork.bottomRingMm - 0.01, `tiras desde ${zFrom} (anillo hasta ${layout.decorZ0 + def.openwork.bottomRingMm})`);
  assert.ok(layout.decorZ0 > layout.neckTopZ, "la parte decorativa arranca sobre el cuello y la transición");
  // anillo superior continuo
  const top = layout.shadeTopZ - 2;
  for (let b = 0; b < 90; b++) assert.equal(cast(top, (2 * Math.PI * (b + 0.4)) / 90).length, 2, "anillo superior discontinuo");
});

test("la interfaz E27 no cambia con el calado: rosca, tope, cuello, reborde y base idénticos a los de la pantalla sólida", () => {
  clearLampCaches();
  const solid = createLamp({ ...BASE, shadeType: "solid" });
  const open = createLamp(BASE);
  assert.equal(solid.errors.length + open.errors.length, 0);
  const a = solid.metrics.fit, b = open.metrics.fit;
  assert.deepEqual(a.thread, b.thread);
  assert.equal(a.shadeBottomZ, b.shadeBottomZ);
  assert.equal(a.decorBottomZ, b.decorBottomZ);
  assert.equal(a.shadeTopZ, b.shadeTopZ);
  assert.deepEqual(a.adhesion, b.adhesion);
  assert.deepEqual(a.tower, b.tower);
  assert.equal(solid.indexed.base, open.indexed.base, "la base es la MISMA malla (no se regenera ni se altera)");
  // rosca medida sobre la malla: la cresta del macho llega al diámetro mayor y la raíz al diámetro de raíz
  const p = open.indexed.shade.positions;
  let maxR = 0, minNeck = Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 2] > a.shadeBottomZ + b.thread.engagementMm - 0.01) continue;
    const rad = Math.hypot(p[i], p[i + 1]);
    maxR = Math.max(maxR, rad);
  }
  assert.ok(Math.abs(maxR - b.thread.majorDiameterMm / 2) < 0.05, `cresta ${maxR} vs ${b.thread.majorDiameterMm / 2}`);
  // el borde inferior sigue teniendo el reborde interno de adhesión (se mide en el anillo plano de abajo)
  const flat = [];
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2] - a.shadeBottomZ) < 1e-9) flat.push(Math.hypot(p[i], p[i + 1]));
  assert.ok(Math.min(...flat) < b.adhesion.outerRadiusMm - b.adhesion.widthMm + 0.01, "reborde de adhesión conservado");
  void minNeck;
});

test("difusor: el cilíndrico es independiente del calado y no interfiere; plano, gota y ondulado no son compatibles con la pantalla calada", () => {
  for (const style of ["flat", "drop", "wavy"]) assert.deepEqual(validateLamp(applyInsertStyle(BASE, style)).errors.map((e) => e.code), ["DIFFUSER_NOT_COMPATIBLE"], style);
  for (const style of ["wavy"]) {
    const base = { ...BASE, insert: { ...BASE.insert, amplitudeMm: 0, twistDeg: 0, verticalFrequency: 0, wavyTop: "open", tabs: false } };
    const r1 = build(base);
    const r2 = build({ ...base, openwork: { ...base.openwork, pattern: "spiral", bands: 6, turns: 0.4, stripWidthMm: 6 } });
    // cambiar el patrón NO cambia el difusor
    assert.deepEqual(r1.indexed.insert.positions, r2.indexed.insert.positions, `${style}: el inserto no depende del patrón`);
    assert.deepEqual(r1.indexed.insert.tris, r2.indexed.insert.tris);
    // el inserto de la pantalla sólida es el mismo que con la calada
    const sol = createLamp({ ...base, shadeType: "solid" });
    assert.deepEqual(sol.indexed.insert.positions, r1.indexed.insert.positions, `${style}: mismo inserto con pantalla sólida`);
    // sin interferencia: ningún vértice de la pantalla entra en el cuerpo del inserto (con holgura de montaje)
    const L = validateLamp(base).layout;
    const ins = L.insert;
    const p = r1.indexed.shade.positions;
    let closest = Infinity;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 2] < ins.z0 || p[i + 2] > ins.z1 || p[i + 2] < L.decorZ0) continue;
      closest = Math.min(closest, Math.hypot(p[i], p[i + 1]) - ins.bodyMaxR);
    }
    assert.ok(closest > base.insert.clearanceMm - 1e-6, `${style}: pantalla a ${closest.toFixed(2)} mm del inserto (holgura ${base.insert.clearanceMm})`);
    // y respeta el portalámparas y la bombilla: cada vértice de la pantalla queda fuera de la envolvente con la separación de diseño
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 2] < L.decorZ0) continue;
      const rad = Math.hypot(p[i], p[i + 1]);
      const envelope = p[i + 2] <= L.holderTopZ ? Math.max(L.bodyR, L.bulbR) : p[i + 2] <= L.bulbTopZ ? L.bulbR : 0;
      assert.ok(rad - envelope >= base.insert.minBulbGapMm, `la pantalla invade la separación de diseño a la bombilla en z=${p[i + 2].toFixed(1)}`);
    }
  }
});

test("una silueta que no deja pasar el inserto se informa con el motivo: no se achica nada en silencio", () => {
  const def = ow({ waistPct: 100, maxDiameterMm: 120 });
  const res = codes(def);
  assert.ok(res.errors.some((c) => c.startsWith("INSERT_") || c === "SHADE_TOO_CLOSE_TO_BULB"), `se esperaba un error de encaje: ${res.errors}`);
  const full = createLamp(def);
  assert.equal(full.geometry, null);
  assert.ok(full.errors.some((e) => /cilindro|inserto|bombilla/i.test(e.message)));
  // el diseño no se modificó
  assert.equal(def.openwork.waistPct, 100);
});

// ------------------------------------------------------------------ alternar entre sólida y calada
test("alternar sólida/calada conserva dimensiones, difusor, color, rosca y los parámetros exclusivos de cada tipo", () => {
  const start = { ...DEFAULT_LAMP, shade: { ...DEFAULT_LAMP.shade, waves: 14, amplitudeMm: 7, twistDeg: 300 }, insert: { ...DEFAULT_LAMP.insert, previewColor: "#3fae5a", style: "drop" } };
  const open = applyShadeType(applyOpenworkPreset(start, OPENWORK_PRESETS[2]), "openwork");
  assert.equal(open.shadeType, "openwork");
  const back = applyShadeType(open, "solid");
  assert.equal(back.shadeType, "solid");
  // el sólido recupera exactamente sus parámetros de onda (el preset calado solo tocó el diámetro superior)
  assert.equal(back.shade.waves, 14);
  assert.equal(back.shade.amplitudeMm, 7);
  assert.equal(back.shade.twistDeg, 300);
  assert.equal(back.shade.heightMm, start.shade.heightMm);
  assert.equal(back.shade.bottomDiameterMm, start.shade.bottomDiameterMm);
  assert.deepEqual(back.insert, start.insert);
  assert.deepEqual(back.thread, start.thread);
  assert.deepEqual(back.holder, start.holder);
  assert.deepEqual(back.base, start.base);
  // y la calada conserva lo suyo
  const again = applyShadeType(back, "openwork");
  assert.deepEqual(again.openwork, open.openwork);
  // cambiar de tipo sin tocar nada devuelve el mismo objeto (no se regenera nada)
  assert.equal(applyShadeType(start, "solid"), start);
});

test("alternar de tipo no regenera la base ni el inserto, y el color no es geometría", () => {
  clearLampCaches();
  const a = createLamp({ ...BASE, shadeType: "solid" });
  const b = createLamp(BASE);
  assert.equal(a.indexed.base, b.indexed.base);
  assert.equal(a.indexed.insert, b.indexed.insert);
  const recolored = createLamp({ ...BASE, insert: { ...BASE.insert, previewColor: "#3b7be5" } });
  assert.equal(recolored.indexed.shade, b.indexed.shade);
  const insertChanged = createLamp({ ...BASE, insert: { ...BASE.insert, thicknessMm: 1 } });
  assert.equal(insertChanged.indexed.shade, b.indexed.shade, "cambiar el inserto no regenera la pantalla");
});

test("diseños guardados antes de V3 se leen como pantalla sólida; el código del diseño conserva la calada", () => {
  const old = { ...DEFAULT_LAMP };
  delete old.shadeType;
  delete old.openwork;
  const loaded = normalizeLampDefinition(old);
  assert.equal(loaded.shadeType, "solid");
  assert.deepEqual(loaded.openwork, DEFAULT_OPENWORK);
  assert.equal(createLamp(loaded).errors.length, 0);
  const design = ow({ pattern: "spiral", bands: 7, turns: 0.45, stripWidthMm: 5, topFinish: "open" });
  const round = decodeLampDesign(encodeLampDesign(design));
  assert.deepEqual(round.def.openwork, design.openwork);
  assert.equal(round.def.shadeType, "openwork");
  assert.equal(normalizeLampDefinition({ shadeType: "x", openwork: { pattern: "z", topFinish: 4 } }).shadeType, "solid");
  assert.equal(normalizeLampDefinition({ openwork: { pattern: "z" } }).openwork.pattern, "diamond");
});

// ------------------------------------------------------------------ presets y miniaturas
test("seis diseños calados: cada uno es una combinación real de parámetros que se genera sin errores y se deja modificar", () => {
  assert.deepEqual(OPENWORK_PRESETS.map((p) => p.label), ["Diamante clásico", "Diamante fino", "Diamante con torsión", "Espiral suave", "Espiral intensa", "Reloj de arena calado"]);
  const sigs = new Set();
  for (const preset of OPENWORK_PRESETS) {
    const def = applyOpenworkPreset({ ...BASE }, preset);
    assert.equal(def.shadeType, "openwork");
    const r = build(def);
    assertClean(r.indexed.shade, preset.id);
    assert.equal(r.metrics.openwork.components, 1, preset.id);
    assert.ok(openworkPresetMatches(def, preset));
    // se puede seguir modificando cualquier parámetro: deja de coincidir pero sigue siendo válido
    const tweaked = { ...def, openwork: { ...def.openwork, stripWidthMm: def.openwork.stripWidthMm + 0.4 } };
    assert.equal(openworkPresetMatches(tweaked, preset), false);
    assert.equal(createLamp(tweaked).errors.length, 0, `${preset.id} modificado`);
    // no pisa altura, diámetro inferior, inserto ni base
    assert.equal(def.shade.heightMm, DEFAULT_LAMP.shade.heightMm);
    assert.equal(def.shade.bottomDiameterMm, DEFAULT_LAMP.shade.bottomDiameterMm);
    assert.deepEqual(def.insert, DEFAULT_LAMP.insert);
    sigs.add(r.indexed.shade.tris.length + ":" + Math.round(r.metrics.shade.volumeCm3 * 10));
  }
  assert.equal(sigs.size, 6, "los seis diseños generan geometrías distintas");
});

test("las miniaturas salen del campo real: coinciden con la malla exportada píxel a píxel (rayo de cámara) y se distinguen entre sí", () => {
  const masks = new Set();
  for (const preset of OPENWORK_PRESETS) {
    const def = applyOpenworkPreset({ ...BASE }, preset);
    const r = build(def);
    const thumb = renderOpenworkThumbnail(def.shade, def.openwork, 96);
    assert.ok(thumb.width > 20 && thumb.height === 96);
    // vista desde −y: un píxel opaco ⇔ un rayo +y por (x, z) toca la malla
    const mesh = r.indexed.shade;
    const p = mesh.positions;
    const bins = new Map();
    const BIN = 4;
    for (let i = 0; i < mesh.tris.length; i += 3) {
      const a = mesh.tris[i] * 3, b = mesh.tris[i + 1] * 3, c = mesh.tris[i + 2] * 3;
      const lo = Math.min(p[a + 2], p[b + 2], p[c + 2]), hi = Math.max(p[a + 2], p[b + 2], p[c + 2]);
      for (let k = Math.floor(lo / BIN); k <= Math.floor(hi / BIN); k++) { if (!bins.has(k)) bins.set(k, []); bins.get(k).push(i); }
    }
    const scale = thumb.height / def.shade.heightMm;
    const decorZ0 = r.metrics.fit.decorBottomZ;
    let agree = 0, total = 0;
    for (let k = 0; k < 500; k++) {
      const px = 2 + Math.floor(((k * 7919) % 1000) / 1000 * (thumb.width - 4));
      const py = 3 + Math.floor((((k * 104729) % 1000) / 1000) * (thumb.height - 6));
      const x = (px + 0.5 - thumb.width / 2) / scale;
      const z = decorZ0 + ((thumb.height - 0.5 - py) / thumb.height) * def.shade.heightMm;
      // ¿el rayo vertical-de-cámara (dirección +y) por (x, z) toca la pantalla?
      let hit = false;
      for (const i of bins.get(Math.floor(z / BIN)) ?? []) {
        const a = mesh.tris[i] * 3, b = mesh.tris[i + 1] * 3, c = mesh.tris[i + 2] * 3;
        const sgn = (x0, z0, x1, z1, x2, z2) => (x0 - x2) * (z1 - z2) - (x1 - x2) * (z0 - z2);
        const d1 = sgn(x, z, p[a], p[a + 2], p[b], p[b + 2]);
        const d2 = sgn(x, z, p[b], p[b + 2], p[c], p[c + 2]);
        const d3 = sgn(x, z, p[c], p[c + 2], p[a], p[a + 2]);
        const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) { hit = true; break; }
      }
      const opaque = thumb.pixels[(py * thumb.width + px) * 4 + 3] > 0;
      // fuera de la silueta ambos son falsos
      total++;
      if (hit === opaque) agree++;
    }
    assert.ok(agree / total > 0.96, `${preset.id}: la miniatura coincide con la malla en ${((100 * agree) / total).toFixed(1)}% de los píxeles`);
    masks.add(Array.from(thumb.pixels.filter((_, i) => i % 4 === 3)).map((v) => (v > 0 ? 1 : 0)).join("").slice(0, 4000) + thumb.width);
  }
  assert.equal(masks.size, 6, "seis miniaturas distintas");
});

// ------------------------------------------------------------------ validaciones y casos extremos
test("casos extremos: cada combinación problemática se rechaza con su motivo y sin generar geometría inválida", () => {
  // fuera de rango
  for (const [patch, field] of [[{ stripWidthMm: 0.6 }, "openwork.stripWidthMm"], [{ divisions: 2 }, "openwork.divisions"], [{ divisions: 11.5 }, "openwork.divisions"], [{ inclinationDeg: 5 }, "openwork.inclinationDeg"], [{ depthMm: NaN }, "openwork.depthMm"], [{ turns: 20 }, "openwork.turns"], [{ topRingMm: 1 }, "openwork.topRingMm"]]) {
    const r = createLamp(ow(patch));
    assert.equal(r.geometry, null);
    assert.ok(r.errors.some((e) => e.code === "OUT_OF_RANGE" && e.field === field), `${field}: ${JSON.stringify(r.errors.map((e) => e.code + e.field))}`);
  }
  // el rango del calado solo se exige con la calada activa
  assert.equal(createLamp({ ...DEFAULT_LAMP, openwork: { ...DEFAULT_LAMP.openwork, stripWidthMm: 0.1 } }).errors.length, 0);
  // tiras demasiado cerradas: sin aberturas reales
  assert.ok(codes(ow({ divisions: 48, stripWidthMm: 6 })).errors.includes("OPENWORK_OPENING_CLOSED"));
  assert.ok(codes(ow({ pattern: "spiral", bands: 24, turns: 0.1, stripWidthMm: 14 }, shadeDims({ bottomDiameterMm: 105 }))).errors.includes("OPENWORK_OPENING_CLOSED"));
  // espiral casi horizontal / torsión que aplana una de las diagonales
  assert.ok(codes(ow({ pattern: "spiral", bands: 6, turns: 1.5, stripWidthMm: 5 })).errors.includes("OPENWORK_STRIP_TOO_FLAT"));
  assert.ok(codes(ow({ twistDeg: 700 })).errors.includes("OPENWORK_STRIP_TOO_FLAT"));
  // anillos que se comen la pantalla
  assert.ok(codes(ow({ bottomRingMm: 40, topRingMm: 40 }, shadeDims({ heightMm: 90 }))).errors.includes("OPENWORK_RINGS_TOO_TALL"));
  // collar: el anillo inferior debe cubrir el pozo
  assert.ok(codes(ow({ bottomRingMm: 8 }, { thread: { ...BASE.thread, connection: "collar" } })).errors.includes("OPENWORK_RING_IN_COLLAR"));
  // muy grande y densa: la grilla se engrosa para respetar el presupuesto (y se avisa), nunca se genera una malla desmedida
  const bigDef = ow({ divisions: 36, stripWidthMm: 2.4, inclinationDeg: 70 }, shadeDims({ heightMm: 320, bottomDiameterMm: 260, topDiameterMm: 260 }));
  const heavy = createLamp(bigDef);
  assert.ok(heavy.warnings.some((w) => w.code === "OPENWORK_MESH_COARSE") || heavy.errors.some((e) => e.code === "OPENWORK_TOO_HEAVY" || e.code === "OPENWORK_OPENING_CLOSED"), `grande y densa: ${heavy.errors.map((e) => e.code)} ${heavy.warnings.map((e) => e.code)}`);
  if (heavy.metrics) assert.ok(heavy.metrics.shade.triangleCount <= LAMP_GEOMETRY.openworkMaxTriangles + 60000);
  // avisos (no bloquean)
  const warns = codes(ow({ stripWidthMm: 1.0, divisions: 12, depthMm: 1.2 }));
  assert.deepEqual(warns.errors, []);
  assert.ok(warns.warnings.includes("OPENWORK_STRIP_THIN") && warns.warnings.includes("OPENWORK_DEPTH_THIN"));
  assert.ok(codes(ow({ topFinish: "open" })).warnings.includes("OPENWORK_TOP_OPEN"));
  assert.ok(codes(ow({ twistDeg: 100, inclinationDeg: 62 })).warnings.includes("OPENWORK_NEEDS_SUPPORT"));
  assert.ok(codes(ow()).warnings.includes("OPENWORK_NOT_THERMAL"));
});

test("extremos que sí se pueden generar: terminación abierta, collar, variación máxima, silueta extrema y sin reborde", () => {
  const cases = [
    ["terminación abierta", ow({ topFinish: "open" })],
    ["abierta + espiral", ow({ topFinish: "open", pattern: "spiral", bands: 6, turns: 0.4, stripWidthMm: 6 })],
    ["collar", ow({ bottomRingMm: 14 }, { thread: { ...BASE.thread, connection: "collar" } })],
    ["variación máxima", ow({ variationPct: 70, variationCycles: 6 })],
    ["sin reborde", ow({}, { adhesion: { ...BASE.adhesion, enabled: false } })],
    ["abombado extremo", ow({ maxDiameterMm: 250 }, shadeDims({ topDiameterMm: 110 }))],
    ["cónica", ow({ maxDiameterMm: 100 }, shadeDims({ topDiameterMm: 200 }))],
    ["profunda", ow({ depthMm: 6, stripWidthMm: 8, divisions: 8 })],
  ];
  for (const [name, def] of cases) {
    const r = build(def);
    assertClean(r.indexed.shade, name);
    assert.equal(r.metrics.openwork.components, 1, name);
  }
});

test("combinaciones: silueta × patrón × torsión × densidad generan geometría válida sin reglas especiales por combinación", () => {
  let n = 0;
  for (const kind of ["cylinder", "bulge", "hourglass", "organic"]) {
    for (const pattern of ["diamond", "spiral"]) {
      for (const twist of [0, 80]) {
        const start = applySilhouette(ow({ pattern, bands: 6, turns: 0.35, stripWidthMm: pattern === "spiral" ? 6 : 4, twistDeg: twist, inclinationDeg: 62 }), kind);
        const r = createLamp(start);
        assert.ok(r.errors.every((e) => /^OPENWORK_(STRIP_TOO_FLAT)/.test(e.code)) || r.errors.length === 0, `${kind}/${pattern}/${twist}: ${r.errors.map((e) => e.code)}`);
        if (r.errors.length === 0) {
          assertClean(r.indexed.shade, `${kind}/${pattern}/${twist}`);
          assert.equal(r.metrics.openwork.components, 1);
          n++;
        }
      }
    }
  }
  assert.ok(n >= 12, `combinaciones válidas: ${n}`);
});

test("el mallador por sí solo: un lazo con aberturas es cerrado y orientado, y una abertura toca el borde superior sin romper la malla", () => {
  // cilindro de 4 filas con un hueco que alcanza el borde superior (caso del recorte 1D del borde)
  const n = 24, rows = 5;
  const f = [];
  for (let i = 0; i < rows; i++) {
    const row = new Float64Array(n);
    for (let j = 0; j < n; j++) row[j] = i >= 2 && j >= 4 && j < 10 ? -1 : 1;
    f.push(row);
  }
  const outerR = [], innerR = [];
  for (let i = 0; i < rows; i++) outerR.push({ z: i * 2, r: 10, f: f[i], row: i });
  for (let i = rows - 1; i >= 0; i--) innerR.push({ z: i * 2, r: 8, f: f[i], row: i });
  const mesh = cutShellMesh(outerR, innerR, n);
  const rep = assertClean(mesh, "mallador");
  assert.ok(rep.triangleCount > 0);
  assert.equal(meshComponents(mesh), 1);
  // el volumen es menor que el del tubo completo: hay material quitado de verdad
  const full = [];
  const fullIn = [];
  for (let i = 0; i < rows; i++) full.push({ z: i * 2, r: 10, f: new Float64Array(n).fill(1), row: i });
  for (let i = rows - 1; i >= 0; i--) fullIn.push({ z: i * 2, r: 8, f: new Float64Array(n).fill(1), row: i });
  assert.ok(rep.volume < analyzeMesh(cutShellMesh(full, fullIn, n)).volume * 0.97);
});

// ------------------------------------------------------------------ exportación, dimensiones, rendimiento
test("exportación: el STL de la pantalla calada es la malla del visor, con las dimensiones reales", async () => {
  const def = ow();
  const r = build(def);
  const entries = lampPartEntries(r);
  const shade = entries.find((e) => e.fileName.includes("pantalla"));
  assert.ok(shade, "archivo de la pantalla");
  assert.equal(shade.mesh.triangleCount, r.indexed.shade.tris.length / 3, "visor y STL: misma cantidad de triángulos");
  const blob = buildSTLBlob(shade.mesh);
  assert.equal(blob.size, 84 + 50 * shade.mesh.triangleCount, "STL binario válido");
  const buf = Buffer.from(await blob.arrayBuffer());
  assert.equal(buf.readUInt32LE(80), shade.mesh.triangleCount);
  // dimensiones: alto = alto de la pantalla + cuello, diámetro = el de la silueta
  const b = indexedBounds(r.indexed.shade);
  const R = createSilhouette(silhouetteInput(def.shade, def.openwork));
  let rMax = 0;
  for (let i = 0; i <= 400; i++) rMax = Math.max(rMax, R(i / 400));
  assert.ok(Math.abs((b.maxX - b.minX) / 2 - rMax) < 0.5 || Math.abs((b.maxY - b.minY) / 2 - rMax) < 0.5, "diámetro exportado = silueta");
  assert.ok(Math.abs(b.maxZ - (r.metrics.fit.decorBottomZ + def.shade.heightMm)) < 1e-6 && Math.abs(b.minZ - r.metrics.fit.shadeBottomZ) < 1e-6);
  // nombre de archivo y ZIP: las mismas piezas que con la sólida (no cambia el formato)
  const solidNames = lampPartEntries(createLamp({ ...def, shadeType: "solid" })).map((e) => e.fileName);
  assert.deepEqual(entries.map((e) => e.fileName), solidNames);
  const zip = await JSZip.loadAsync(Buffer.from(await (await buildLampZipBlob(r, def)).arrayBuffer()));
  assert.ok(Object.keys(zip.files).some((f) => f.includes("pantalla")));
  const readme = await zip.file("LEEME.txt").async("string");
  assert.ok(/CALADA/.test(readme) && /NO es una validaci/.test(readme), "el LÉEME aclara que calada no es seguridad térmica");
  assert.ok(/es una sola pieza conectada/.test(readme));
  const solidZip = await JSZip.loadAsync(Buffer.from(await (await buildLampZipBlob(createLamp({ ...def, shadeType: "solid" }), { ...def, shadeType: "solid" })).arrayBuffer()));
  assert.ok(!/es una sola pieza conectada/.test(await solidZip.file("LEEME.txt").async("string")), "el LÉEME de la sólida no describe una pantalla calada");
});

test("rendimiento: triángulos, tiempo y tamaño del STL dentro de presupuesto; cambiar un parámetro del inserto no regenera la pantalla", () => {
  clearLampCaches();
  createLamp(BASE); // calienta la base
  clearLampCaches();
  const t0 = performance.now();
  const r = createLamp(BASE);
  const ms = performance.now() - t0;
  assert.equal(r.errors.length, 0);
  assert.ok(r.metrics.shade.triangleCount < LAMP_GEOMETRY.openworkMaxTriangles, `${r.metrics.shade.triangleCount} triángulos`);
  assert.ok(r.metrics.shade.triangleCount * 50 < 10e6, "STL de la pantalla < 10 MB");
  assert.ok(ms < 20000, `generación ${Math.round(ms)} ms`);
  // el campo se muestrea en milisegundos (el visor no se congela por el muestreo)
  const t1 = performance.now();
  sampleOpenworkField(BASE.shade, BASE.openwork);
  assert.ok(performance.now() - t1 < 500);
  // segunda llamada idéntica: cache
  const t2 = performance.now();
  const again = createLamp(BASE);
  assert.ok(performance.now() - t2 < 300);
  assert.equal(again.indexed.shade, r.indexed.shade);
  // el presupuesto de grilla se respeta aun con la pantalla más grande
  const big = sampleOpenworkField({ ...BASE.shade, heightMm: 320, bottomDiameterMm: 260, topDiameterMm: 260 }, { ...BASE.openwork, stripWidthMm: 3, divisions: 20 });
  assert.ok(big.nTheta * (big.nRows - 1) <= LAMP_GEOMETRY.openworkMaxCells * 1.05, "celdas dentro del presupuesto");
  assert.equal(big.report.coarse || big.cellMm >= 1, true);
});

test("el diseño sólido sigue igual: mismos números que antes de V3 y ningún campo de calado en sus métricas", () => {
  const r = createLamp(DEFAULT_LAMP);
  assert.equal(r.errors.length, 0);
  assert.equal(r.metrics.openwork, null);
  assert.equal(DEFAULT_LAMP.shadeType, "solid");
  const v = validateLamp(DEFAULT_LAMP);
  assert.ok(!v.warnings.some((w) => w.code.startsWith("OPENWORK_")));
  // la sólida con collar sigue siendo apta para modo vaso (no se tocó), y la calada nunca lo es
  const collar = { ...DEFAULT_LAMP, thread: { ...DEFAULT_LAMP.thread, connection: "collar" } };
  assert.equal(createLamp(collar).metrics.shade.vase.ready, true);
  const openCollar = createLamp({ ...BASE, bottomRingMm: 14, thread: { ...BASE.thread, connection: "collar" }, openwork: { ...BASE.openwork, bottomRingMm: 14 } });
  assert.equal(openCollar.metrics.shade.vase.ready, false);
  assert.ok(Object.keys(LAMP_LIMITS).some((k) => k.startsWith("openwork.")));
});

// ------------------------------------------------------------------ UI
test("UI: selector Sólida/Calada, diseños calados, controles por patrón y avisos, sin mezclar los de la sólida", () => {
  const { MakerLampControls, LampExportButtons } = loadLampUi();
  const render = (def) => {
    const r = createLamp(def);
    return renderToStaticMarkup(
      createElement(MakerLampControls, {
        def, onChange() {}, onApplyPreset() {}, onGenerateVariation() {}, onLoadDesign() {}, onError() {},
        errors: r.errors, warnings: r.warnings, metrics: r.metrics,
        exportButtons: createElement(LampExportButtons, { hasInsert: true, insertStyle: def.insert.style, hasCollar: false, canDownload: true, canDownloadTests: true, busy: null, onDownloadPart() {}, onDownloadZip() {}, onDownloadTests() {}, holderMeasured: false }),
      }),
    );
  };
  const solid = render(DEFAULT_LAMP);
  for (const text of ["Tipo de lámpara", "Sólida", "Calada", "Familia de patrón", "Cantidad de ondas"]) assert.ok(solid.includes(text), `sólida: falta "${text}"`);
  assert.ok(!solid.includes("rombos alrededor") && !solid.includes("Diamante clásico"));
  const diamond = render(BASE);
  for (const text of ["Tipo de lámpara", "Diamante clásico", "Diamante fino", "Diamante con torsión", "Espiral suave", "Espiral intensa", "Reloj de arena calado", "Cilíndrica", "Abombada", "Reloj de arena", "Orgánica", "rombos alrededor", "Inclinación de las diagonales", "Grosor de la estructura", "Profundidad de las tiras", "Diámetro máximo", "Intensidad de cintura", "Más ajustes", "Una sola pieza conectada", "Abertura mínima", "NO es una validación térmica"]) {
    assert.ok(diamond.includes(text), `calada: falta "${text}"`);
  }
  assert.ok(!diamond.includes("Familia de patrón") && !diamond.includes("Cantidad de ondas"), "no mezcla los controles de la sólida");
  const spiral = render(ow({ pattern: "spiral", bands: 6, turns: 0.4, stripWidthMm: 6 }));
  for (const text of ["Densidad del patrón (bandas)", "Vueltas", "Separación libre entre bandas"]) assert.ok(spiral.includes(text), `espiral: falta "${text}"`);
  assert.ok(!spiral.includes("rombos alrededor"));
  // seis miniaturas seleccionables (botones con aria-pressed) y avanzados plegados
  assert.equal((diamond.match(/data-style="/g) ?? []).length, 6);
  assert.ok(/<details(?![^>]*\bopen\b)[^>]*>\s*<summary[^>]*>Más ajustes/.test(diamond), "las opciones avanzadas están plegadas");
  // un error de la calada se muestra con su mensaje
  assert.ok(render(ow({ pattern: "spiral", bands: 6, turns: 1.5, stripWidthMm: 5 })).includes("casi horizontales"));
});

test("análisis topológico rápido de las pantallas calada: idéntico a analyzeMesh (mismos contadores) también con una malla rota", () => {
  const { analyzeMeshFast } = loadMakerModule("lib/maker/lamps/geometry/fastAnalyze.ts");
  const { newMesh, addVertex, addTri } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
  const r = build(BASE);
  for (const mesh of [r.indexed.shade, r.indexed.base, r.indexed.insert]) assert.deepEqual(analyzeMeshFast(mesh), analyzeMesh(mesh));
  // hueco + arista compartida por tres caras + normal invertida: ambos detectan lo mismo
  const m = newMesh();
  for (const v of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]]) addVertex(m, ...v);
  addTri(m, 0, 2, 1); addTri(m, 0, 1, 3); addTri(m, 1, 2, 3); addTri(m, 0, 3, 2); addTri(m, 0, 1, 4);
  assert.deepEqual(analyzeMeshFast(m), analyzeMesh(m));
  assert.ok(analyzeMeshFast(m).boundaryEdges > 0 && analyzeMeshFast(m).nonManifoldEdges > 0 && analyzeMeshFast(m).inconsistentEdges > 0);
});
