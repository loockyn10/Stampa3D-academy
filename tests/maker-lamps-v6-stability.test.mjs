import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

// Lámparas V6 — ESTABILIZACIÓN: restricciones dinámicas de los controles, difusor de la calada por su diámetro (Ø80 / abertura Ø81),
// presets válidos y vista previa honesta. Todo se mide sobre las MALLAS que ve el visor y exporta el STL (no sobre los parámetros).
// Son pruebas GEOMÉTRICAS en Node: no reemplazan abrir la ruta real en el navegador (admin) ni laminar en Bambu Studio, y ninguna
// medida de acá es una validación térmica.

const { DEFAULT_LAMP, DEFAULT_OPENWORK, normalizeLampDefinition } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp, lampGeometryKey } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { LAMP_LIMITS } = loadMakerModule("lib/maker/lamps/types.ts");
const C = loadMakerModule("lib/maker/lamps/constraints.ts");
const { resolveLampDef, openingFreeDiameters } = loadMakerModule("lib/maker/lamps/resolve.ts");
const { suggestThreadMajorForDiffuser } = loadMakerModule("lib/maker/lamps/diffuserFit.ts");
const { OPENWORK_PRESETS, applyOpenworkPreset, applyShadeType, applySilhouette } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { availableOpenworkPresets, availableLampPresets, silhouetteAvailability } = loadMakerModule("lib/maker/lamps/availability.ts");
const { applyLampPreset } = loadMakerModule("lib/maker/lamps/presets.ts");
const { lampPartEntries, buildLampZipBlob } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { letterGeometryToBufferGeometry } = loadMakerModule("lib/maker/geometry/toBufferGeometry.ts");
const { analyzeMesh } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { encodeLampDesign, decodeLampDesign } = loadMakerModule("lib/maker/lamps/designCode.ts");
const { mulberry32 } = loadMakerModule("lib/maker/lamps/random.ts");

// ------------------------------------------------------------------ utilidades
const OPENWORK = applyShadeType(DEFAULT_LAMP, "openwork");
const SPIRAL = { ...OPENWORK, openwork: { ...OPENWORK.openwork, pattern: "spiral", bands: 6, turns: 0.4, stripWidthMm: 6 } };
const DOUBLE = applyShadeType(DEFAULT_LAMP, "double");
const KINDS = { solid: DEFAULT_LAMP, openwork: OPENWORK, spiral: SPIRAL, double: DOUBLE };
const setP = (def, path, v) => C.setLampPath(def, path, v);
const codes = (def) => validateLamp(def).errors.map((e) => e.code);

function assertClosed(mesh, label) {
  const r = analyzeMesh(mesh);
  assert.equal(r.nonFinite, 0, `${label}: NaN/Infinity`);
  assert.equal(r.degenerate, 0, `${label}: triángulos degenerados`);
  assert.equal(r.boundaryEdges, 0, `${label}: malla abierta`);
  assert.equal(r.nonManifoldEdges, 0, `${label}: aristas no-manifold`);
  assert.equal(r.inconsistentEdges, 0, `${label}: normales incoherentes`);
  assert.ok(r.volume > 0, `${label}: volumen no positivo`);
}
/** Genera la lámpara completa y exige que sea válida y que las cuatro piezas sean mallas cerradas. */
function buildValid(def, label) {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `${label}: ${JSON.stringify(r.errors.map((e) => e.code + " " + e.message))}`);
  assert.ok(r.geometry, `${label}: sin geometría`);
  for (const [name, mesh] of Object.entries(r.indexed)) if (mesh) assertClosed(mesh, `${label}/${name}`);
  return r;
}
const radii = (mesh, z0 = -1e9, z1 = 1e9) => {
  const p = mesh.positions;
  const out = [];
  for (let i = 0; i < p.length; i += 3) if (p[i + 2] >= z0 && p[i + 2] <= z1) out.push(Math.hypot(p[i], p[i + 1]));
  return out;
};
/** Distancia PLANA mínima del eje a cualquier triángulo de la malla dentro de [z0, z1] (los tramos entre vértices incluidos: no solo los vértices). */
function minPlanarDistance(mesh, z0 = -1e9, z1 = 1e9) {
  const p = mesh.positions;
  let best = Infinity;
  const seg = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
  };
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const a = mesh.tris[i] * 3, b = mesh.tris[i + 1] * 3, c = mesh.tris[i + 2] * 3;
    if (Math.max(p[a + 2], p[b + 2], p[c + 2]) < z0 || Math.min(p[a + 2], p[b + 2], p[c + 2]) > z1) continue;
    best = Math.min(best, seg(p[a], p[a + 1], p[b], p[b + 1]), seg(p[b], p[b + 1], p[c], p[c + 1]), seg(p[c], p[c + 1], p[a], p[a + 1]));
  }
  return best;
}
function bounds(mesh) {
  const p = mesh.positions;
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < p.length; i += 3) {
    b.minX = Math.min(b.minX, p[i]); b.maxX = Math.max(b.maxX, p[i]);
    b.minY = Math.min(b.minY, p[i + 1]); b.maxY = Math.max(b.maxY, p[i + 1]);
    b.minZ = Math.min(b.minZ, p[i + 2]); b.maxZ = Math.max(b.maxZ, p[i + 2]);
  }
  return b;
}
function parseStl(buf) {
  const n = buf.readUInt32LE(80);
  assert.equal(buf.length, 84 + 50 * n, "STL binario válido");
  const index = new Map();
  const positions = [];
  const tris = [];
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const o = 84 + t * 50 + 12 + k * 12;
      const x = buf.readFloatLE(o), y = buf.readFloatLE(o + 4), z = buf.readFloatLE(o + 8);
      const key = `${x},${y},${z}`;
      let id = index.get(key);
      if (id === undefined) {
        id = positions.length / 3;
        index.set(key, id);
        positions.push(x, y, z);
      }
      tris.push(id);
    }
  }
  return { positions, tris };
}
async function stlOf(result, pattern) {
  const entry = lampPartEntries(result).find((e) => pattern.test(e.fileName));
  assert.ok(entry, `no hay archivo ${pattern}`);
  return parseStl(Buffer.from(await buildSTLBlob(entry.mesh).arrayBuffer()));
}

// ------------------------------------------------------------------ el componente real
const registry = { seg: [], num: [] };
const mocks = {
  "next/link": { __esModule: true, default: (props) => createElement("a", props) },
  "opentype.js": {},
  "@/components/maker/LampFamilyPicker": {
    LampFamilyPicker: (p) => {
      // el selector de tipo (tarjetas) se registra como un selector más para que las pruebas lo accionen por su rótulo
      registry.seg.push({ options: [{ value: "solid", label: "Sólida" }, { value: "openwork", label: "Calada" }, { value: "double", label: "Doble pared" }], value: p.value, onChange: p.onSelect });
      return createElement("div", { "data-seg": "" }, "Sólida Calada Doble pared");
    },
  },
  "@/components/maker/MakerTextControls": {
    SegmentedControl: (p) => {
      registry.seg.push(p);
      return createElement("div", { "data-seg": "" }, p.options.map((o) => createElement("button", { key: o.value, type: "button", "aria-pressed": o.value === p.value }, o.label)));
    },
    NumberField: (p) => {
      registry.num.push(p);
      return createElement("label", null, p.label, createElement("input", { defaultValue: p.value }));
    },
  },
};
const { MakerLampControls, LampExportButtons } = loadTs("src/components/maker/MakerLampControls.tsx", mocks);

/** Rutas de los controles principales de cada tipo (los rangos que calcula la interfaz). */
const MAIN_PATHS = (def) => C.specsFor(def).filter((s) => s.main || s.path === "thread.majorDiameterMm").map((s) => s.path);

/** Una "sesión" de la herramienta: estado = LampDefinition; cada acción pasa por los controles del componente real y los rangos se recalculan como en la página. */
function session(start, allRanges = false) {
  const s = { def: start, html: "", result: null, ranges: {} };
  const render = () => {
    registry.seg = [];
    registry.num = [];
    s.result = createLamp(s.def);
    s.ranges = C.computeLampRanges(s.def, allRanges ? undefined : MAIN_PATHS(s.def));
    s.html = renderToStaticMarkup(
      createElement(MakerLampControls, {
        def: s.def,
        onChange: (next) => (s.captured = next),
        onApplyPreset() {}, onGenerateVariation() {}, onLoadDesign() {}, onError() {},
        errors: s.result.errors, warnings: s.result.warnings, metrics: s.result.metrics,
        ranges: s.ranges,
        exportButtons: createElement(LampExportButtons, { hasInsert: s.def.insert.enabled, insertStyle: s.def.insert.style, hasCollar: false, canDownload: true, canDownloadTests: true, busy: null, onDownloadPart() {}, onDownloadZip() {}, onDownloadTests() {}, holderMeasured: false }),
      }),
    );
    return s;
  };
  s.click = (label) => {
    const seg = registry.seg.find((c) => c.options.some((o) => o.label === label));
    assert.ok(seg, `no hay un selector con la opción «${label}»`);
    s.captured = null;
    seg.onChange(seg.options.find((o) => o.label === label).value);
    assert.ok(s.captured, `el selector «${label}» no cambió el estado`);
    s.def = s.captured;
    return render();
  };
  s.type = (label, value) => {
    const field = registry.num.find((c) => c.label === label);
    assert.ok(field, `no hay un campo «${label}»`);
    s.captured = null;
    field.onChange(value);
    assert.ok(s.captured, `el campo «${label}» no cambió el estado`);
    s.def = s.captured;
    return render();
  };
  s.set = (group, patch) => {
    s.def = { ...s.def, [group]: { ...s.def[group], ...patch } };
    return render();
  };
  /** min / max / step del slider con ese rótulo, tal como los RENDERIZA el componente. */
  s.slider = (label) => {
    const i = s.html.indexOf(label);
    assert.ok(i >= 0, `no hay un slider «${label}»`);
    const m = /<input type="range" min="([^"]+)" max="([^"]+)" step="([^"]+)"/.exec(s.html.slice(i));
    assert.ok(m, `«${label}» no es un slider`);
    return { min: Number(m[1]), max: Number(m[2]), step: Number(m[3]) };
  };
  return render();
}

// ================================================================== A — MATRIZ DE PARÁMETROS Y RESTRICCIONES
test("matriz de parámetros: cada control de la interfaz tiene una envolvente dentro de LAMP_LIMITS y apunta a un campo real", () => {
  assert.deepEqual(C.specsOutsideLimits(), []);
  for (const spec of C.LAMP_CONTROL_SPECS) {
    const [a, b] = spec.path.split(".");
    assert.ok(a in DEFAULT_LAMP && b in DEFAULT_LAMP[a], `${spec.path} no existe en la definición`);
    assert.ok(spec.max > spec.min && spec.step > 0, spec.path);
    assert.equal(Math.round(((spec.max - spec.min) / spec.step) * 1e6) / 1e6 % 1, 0, `${spec.path}: la grilla no cierra en el máximo`);
  }
  // los campos nuevos del difusor calado tienen su límite
  for (const key of ["openwork.diffuserDiameterMm", "openwork.diffuserClearanceMm", "openwork.diffuserTopGapMm"]) assert.ok(LAMP_LIMITS[key], key);
});

for (const [name, start] of Object.entries(KINDS)) {
  test(`rangos dinámicos (${name}): todo valor ofrecido es válido y el siguiente paso fuera del rango deja de serlo (no se reducen rangos de más)`, () => {
    for (const spec of C.specsFor(start)) {
      const r = C.computeControlRange(start, spec);
      const persistent = new Set(r.persistentCodes);
      const fails = (v) => codes(setP(start, spec.path, v)).filter((c) => !persistent.has(c));
      const grid = (v) => Math.round((Math.round((v - spec.min) / spec.step) * spec.step + spec.min) * 1e6) / 1e6;
      // mínimo, intermedio y máximo del rango ofrecido: válidos
      for (const v of [r.min, grid((r.min + r.max) / 2), r.max]) assert.deepEqual(fails(v), [], `${name} ${spec.path}=${v} (rango ${r.min}–${r.max})`);
      // el rango no es arbitrario: un paso más allá de un borde limitado deja de ser válido
      if (r.limitedMax) assert.ok(fails(Math.round((r.max + spec.step) * 1e6) / 1e6).length > 0, `${name} ${spec.path}: ${r.max} + paso sigue siendo válido (límite artificial)`);
      if (r.limitedMin) assert.ok(fails(Math.round((r.min - spec.step) * 1e6) / 1e6).length > 0, `${name} ${spec.path}: ${r.min} − paso sigue siendo válido (límite artificial)`);
      // todo borde limitado explica por qué
      if (r.limitedMax) assert.ok(r.maxReason, `${spec.path}: máximo sin razón`);
      if (r.limitedMin) assert.ok(r.minReason, `${spec.path}: mínimo sin razón`);
      assert.equal(r.conflict, false, `${name} ${spec.path}: conflicto con la definición inicial`);
      assert.ok(r.currentValid, `${name} ${spec.path}: el valor inicial debe estar dentro de su rango`);
    }
  });
}

test("los rangos dependen del resto de los valores: la torsión máxima cae al aumentar la inclinación de los rombos y la cintura máxima sigue al difusor", () => {
  const twist = (def) => C.computeControlRange(def, C.specFor(def, "openwork.twistDeg"));
  const steep = twist(setP(OPENWORK, "openwork.inclinationDeg", 70));
  const flat = twist(setP(OPENWORK, "openwork.inclinationDeg", 35));
  assert.ok(steep.max > flat.max, `torsión máx. con rombos a 70°: ${steep.max}; a 35°: ${flat.max}`);
  const waist = (d) => C.computeControlRange(d, C.specFor(d, "openwork.waistPct")).max;
  assert.ok(waist(setP(OPENWORK, "openwork.diffuserDiameterMm", 62)) > waist(OPENWORK), "con un difusor más angosto la cintura puede ser más marcada");
  // la amplitud del sólido depende de las ondas
  const amp = (waves) => C.computeControlRange(setP(DEFAULT_LAMP, "shade.waves", waves), C.specFor(DEFAULT_LAMP, "shade.amplitudeMm")).max;
  assert.ok(amp(4) > amp(24), `amplitud máx. con 4 ondas ${amp(4)} vs 24 ondas ${amp(24)}`);
});

test("un valor fuera de rango NO se corrige en silencio: se informa, no se exporta y el rango dice cuál es el valor válido más cercano", () => {
  const bad = setP(OPENWORK, "openwork.twistDeg", 600);
  const r = createLamp(bad);
  assert.equal(r.geometry, null);
  assert.ok(r.errors.some((e) => e.code === "OPENWORK_STRIP_TOO_FLAT"));
  assert.equal(bad.openwork.twistDeg, 600, "la definición no se tocó");
  const range = C.computeControlRange(bad, C.specFor(bad, "openwork.twistDeg"));
  assert.equal(range.currentValid, false);
  assert.ok(range.max < 600);
  const fixed = setP(bad, "openwork.twistDeg", C.nearestInRange(range, 600));
  assert.equal(createLamp(fixed).errors.length, 0);
  // la UI lo muestra: valor en rojo + botón explícito
  const s = session(bad, true);
  assert.ok(s.html.includes("Fuera del rango válido") && s.html.includes("Llevar a"), "aviso y botón de la interfaz");
  // el export falla de forma explícita
  assert.throws(() => lampPartEntries(r), /casi horizontales|No hay una lámpara válida/);
});

test("caminata de extremos simultáneos: cada control llevado a su mínimo o máximo vigente (con los rangos recalculados) deja una lámpara válida y exportable", () => {
  for (const [name, start] of [["solid", DEFAULT_LAMP], ["openwork", OPENWORK], ["spiral", SPIRAL], ["double", DOUBLE]]) {
    const rand = mulberry32(name.length * 7919 + 13);
    let def = start;
    const steps = name === "double" ? 5 : 9;
    for (let step = 0; step < steps; step++) {
      const specs = C.specsFor(def).filter((s) => s.path !== "thread.majorDiameterMm" && s.path !== "insert.heightMm");
      const spec = specs[Math.floor(rand() * specs.length)];
      const r = C.computeControlRange(def, spec);
      const v = rand() < 0.5 ? r.min : r.max;
      def = setP(def, spec.path, v);
      assert.deepEqual(codes(def).filter((c) => !r.persistentCodes.includes(c)), [], `${name} paso ${step}: ${spec.path}=${v}`);
    }
    buildValid(def, `${name} final`);
  }
});

test("configuraciones chicas y grandes: los extremos del rango de los controles principales generan mallas cerradas en cada tipo", () => {
  for (const [name, start] of [["solid", DEFAULT_LAMP], ["openwork", OPENWORK], ["double", DOUBLE]]) {
    for (const spec of C.specsFor(start).filter((s) => s.main && s.path !== "insert.heightMm")) {
      const r = C.computeControlRange(start, spec);
      for (const v of [r.min, r.max]) buildValid(setP(start, spec.path, v), `${name} ${spec.path}=${v}`);
    }
  }
});

// ================================================================== B — DIFUSOR CALADO Ø80 / ABERTURA Ø81
test("relación paramétrica: Ø interior libre de AMBOS anillos = Ø difusor + holgura diametral, para muchas combinaciones (silueta, patrón, profundidad, altura)", () => {
  const rand = mulberry32(2026);
  const thread = { ...DEFAULT_LAMP.thread, majorDiameterMm: 130 };
  for (let i = 0; i < 14; i++) {
    const D = 62 + Math.floor(rand() * 40);
    const clearance = [0.7, 1, 1.5, 2.4][Math.floor(rand() * 4)];
    const depth = [1.6, 2.4, 3.2, 4.5][Math.floor(rand() * 4)];
    const height = 120 + Math.floor(rand() * 5) * 30;
    const def = { ...OPENWORK, thread, openwork: { ...OPENWORK.openwork, diffuserDiameterMm: D, diffuserClearanceMm: clearance, depthMm: depth, maxDiameterMm: D + 20 + Math.floor(rand() * 90), pattern: rand() < 0.5 ? "diamond" : "spiral", bands: 6, turns: 0.3, stripWidthMm: 5, curvaturePct: Math.floor(rand() * 100) }, shade: { ...OPENWORK.shade, heightMm: height } };
    const v = validateLamp(def);
    const errs = v.errors.map((e) => e.code);
    if (errs.length) { assert.ok(!errs.includes("DIFFUSER_FIT_UNSOLVED"), `caso ${i}: la relación no se pudo resolver (${errs})`); continue; }
    const open = openingFreeDiameters(v.resolved);
    assert.ok(Math.abs(open.bottomMm - (D + clearance)) < 0.005 && Math.abs(open.topMm - (D + clearance)) < 0.005, `caso ${i}: libres ${open.bottomMm}/${open.topMm} vs ${D + clearance}`);
    const f = v.layout.fit.diffuser;
    assert.equal(f.diffuserDiameterMm, D);
    assert.ok(Math.abs(f.radialClearanceBottomMm - clearance / 2) < 0.01 && Math.abs(f.radialClearanceTopMm - clearance / 2) < 0.01);
    assert.equal(f.insertable, true);
  }
});

test("CASO 1 — calada: difusor Ø80, holgura 1 mm, abertura Ø81, decorativo Ø150: medido sobre las mallas y sobre el STL exportado", async () => {
  const s = session(DEFAULT_LAMP);
  assert.ok(["Sólida", "Calada", "Doble pared"].every((t) => s.html.includes(t)));
  s.click("Calada");
  assert.equal(s.def.shadeType, "openwork");
  assert.equal(s.def.openwork.diffuserFit, "diameter");
  assert.equal(s.def.openwork.diffuserClearanceMm, 1);
  assert.ok(s.html.includes("Difusor de la pantalla calada") && s.html.includes("Por su diámetro"));
  // 1) difusor Ø80: el encastre inferior es el estándar de diffuser.stl (Ø65,135) y la torre ya no crece con el cuerpo, así que con la rosca de montaje por defecto (Ø96) el cuerpo de Ø80 pasa por el cuello sin tocar nada
  s.type("Ø exterior del difusor", 80);
  assert.equal(s.def.openwork.diffuserDiameterMm, 80);
  assert.equal(s.result.errors.length, 0, JSON.stringify(s.result.errors.map((e) => e.code)));
  assert.equal(s.def.thread.majorDiameterMm, 96, "no se tocó la rosca");
  assert.ok(!s.html.includes("Subir la rosca de montaje hasta que la base aloje el difusor"), "sin error no hay botón de solución");
  // 2) un cuerpo que ya no pasa por el cuello roscado sí se rechaza, explícito y sin reducirlo en silencio; la solución propuesta es la que ejecuta el botón
  s.type("Ø exterior del difusor", 130);
  assert.equal(s.result.geometry, null);
  const exceeds = s.result.errors.find((e) => e.code === "DIFFUSER_EXCEEDS_BASE");
  assert.ok(exceeds && /Subí el diámetro de la rosca de montaje a Ø/.test(exceeds.message), exceeds?.message);
  assert.ok(s.html.includes("Subir la rosca de montaje hasta que el difusor pase por el cuello"), "botón de la solución");
  const major = suggestThreadMajorForDiffuser(s.def);
  assert.ok(major && major > 96, `rosca sugerida Ø${major}`);
  s.type("Ø exterior del difusor", 80);
  // la abertura libre de Ø81 de los anillos (0,5 mm radiales) solo se mide si el cuello roscado no la estrecha: se lleva la rosca a la sugerida
  s.set("thread", { majorDiameterMm: 102 });
  // 3) decorativo Ø150
  s.set("openwork", { maxDiameterMm: 150 });
  assert.equal(s.result.errors.length, 0, JSON.stringify(s.result.errors.map((e) => e.code)));
  assert.equal(s.def.openwork.diffuserClearanceMm, 1);

  const r = s.result;
  const f = r.metrics.fit.diffuser;
  assert.equal(f.source, "diameter");
  assert.equal(f.limitedBy, "diameter");
  assert.equal(f.diffuserDiameterMm, 80);
  assert.ok(Math.abs(f.ringBottomFreeDiameterMm - 81) < 0.005 && Math.abs(f.ringTopFreeDiameterMm - 81) < 0.005, `libres ${f.ringBottomFreeDiameterMm}/${f.ringTopFreeDiameterMm}`);
  assert.ok(Math.abs(f.radialClearanceBottomMm - 0.5) < 0.005 && Math.abs(f.radialClearanceTopMm - 0.5) < 0.005);
  assert.equal(f.insertable, true);
  assert.ok(f.topGapMm >= 6 - 1e-9 && f.topGapMm < 7.1, `holgura vertical ${f.topGapMm}`);

  const measure = (insertMesh, shadeMesh, label) => {
    const ib = bounds(insertMesh);
    const diffuserR = Math.max(...radii(insertMesh));
    assert.ok(Math.abs(2 * diffuserR - 80) < 0.02, `${label}: difusor Ø${2 * diffuserR}`);
    // abertura libre: el punto más cercano al eje de TODA la pantalla (anillos y cara interior de las tiras, tramos entre vértices incluidos)
    const free = minPlanarDistance(shadeMesh);
    assert.ok(Math.abs(2 * free - 81) < 0.03, `${label}: abertura libre Ø${2 * free}`);
    assert.ok(Math.abs(free - diffuserR - 0.5) < 0.02, `${label}: separación radial ${free - diffuserR}`);
    // la pantalla se expande decorativamente sin tocar el montaje
    const sb = bounds(shadeMesh);
    const shadeD = 2 * Math.max(...radii(shadeMesh));
    assert.ok(shadeD > 149.4 && shadeD < 150.6, `${label}: pantalla Ø${shadeD}`);
    assert.ok(sb.maxZ > sb.minZ);
    // recorrido de inserción: el cilindro Ø80 baja por toda la abertura (anillo superior, estructura, cuello roscado) sin tocar nada
    const sweepZ0 = ib.minZ;
    assert.ok(minPlanarDistance(shadeMesh, sweepZ0, 1e9) >= diffuserR + 0.45, `${label}: el difusor no pasaría por toda la pantalla`);
    assert.ok(ib.maxZ <= sb.maxZ - 5.9, `${label}: el difusor sobresale del borde superior de la pantalla`);
  };
  measure(r.indexed.insert, r.indexed.shade, "malla");

  // exportación STL: mismas medidas
  const stlInsert = await stlOf(r, /inserto/);
  const stlShade = await stlOf(r, /pantalla/);
  measure(stlInsert, stlShade, "STL");

  // el visor lee las mismas mallas
  for (const [kind, stl] of [["lampInsert", stlInsert], ["lampShade", stlShade]]) {
    const part = r.geometry.parts.find((p) => p.kind === kind);
    assert.equal(letterGeometryToBufferGeometry(part.mesh).getAttribute("position").count, stl.tris.length, `${kind}: visor y STL con la misma malla`);
  }

  // el decorativo se expande o se contrae sin modificar el montaje
  for (const maxD of [100, 200, 280]) {
    const d = setP(s.def, "openwork.maxDiameterMm", maxD);
    const rr = buildValid(d, `max ${maxD}`);
    const ff = rr.metrics.fit.diffuser;
    assert.equal(ff.diffuserDiameterMm, 80);
    assert.ok(Math.abs(ff.ringBottomFreeDiameterMm - 81) < 0.005 && Math.abs(ff.ringTopFreeDiameterMm - 81) < 0.005);
    assert.ok(Math.abs(Math.max(...radii(rr.indexed.insert)) - 40) < 0.01);
  }
  // el difusor acompaña la altura útil de la pantalla y deja solo la holgura vertical
  for (const height of [120, 200, 300]) {
    const rr = buildValid(setP(s.def, "shade.heightMm", height), `altura ${height}`);
    assert.ok(rr.metrics.fit.diffuser.topGapMm >= 6 - 1e-9 && rr.metrics.fit.diffuser.topGapMm < 7.1, `altura ${height}: holgura vertical ${rr.metrics.fit.diffuser.topGapMm}`);
    assert.equal(rr.metrics.fit.diffuser.diffuserDiameterMm, 80);
  }
  const taller = createLamp(setP(s.def, "openwork.diffuserTopGapMm", 20));
  assert.ok(Math.abs(taller.metrics.fit.diffuser.topGapMm - 20) < 0.11);
});

test("el difusor puede cambiar de diámetro, de holgura y de altura sin romper la relación; el tipo de difusor (plano, gota, ondulado) es intercambiable", () => {
  const base = { ...OPENWORK, thread: { ...OPENWORK.thread, majorDiameterMm: 102 }, openwork: { ...OPENWORK.openwork, diffuserDiameterMm: 80, maxDiameterMm: 150 } };
  for (const [patch, expect] of [[{ diffuserDiameterMm: 70 }, 71], [{ diffuserDiameterMm: 80, diffuserClearanceMm: 2 }, 82], [{ diffuserDiameterMm: 90, diffuserClearanceMm: 1.4 }, 91.4]]) {
    const def = { ...base, thread: { ...base.thread, majorDiameterMm: 112 }, openwork: { ...base.openwork, ...patch } };
    const rr = buildValid(def, JSON.stringify(patch));
    assert.ok(Math.abs(rr.metrics.fit.diffuser.ringBottomFreeDiameterMm - expect) < 0.01, `${JSON.stringify(patch)} → libre ${rr.metrics.fit.diffuser.ringBottomFreeDiameterMm}`);
  }
  // altura manual del difusor dentro del rango dinámico
  const range = C.computeControlRange({ ...base, insert: { ...base.insert, heightMm: 120 } }, C.specFor({ ...base, insert: { ...base.insert, heightMm: 120 } }, "insert.heightMm"));
  for (const h of [range.min, range.max]) buildValid({ ...base, insert: { ...base.insert, heightMm: h } }, `altura difusor ${h}`);
  assert.ok(codes({ ...base, insert: { ...base.insert, heightMm: range.max + 5 } }).includes("INSERT_TOO_TALL"));
  // la calada solo admite el difusor cilíndrico recto (el «ondulado» liso): plano, gota y ondulado con ondas se rechazan con un solo error claro
  const { applyInsertStyle } = loadMakerModule("lib/maker/lamps/defaults.ts");
  const { applyDiffuserKind } = loadMakerModule("lib/maker/lamps/capabilities.ts");
  buildValid(applyDiffuserKind(base, "cylinder"), "cilíndrico");
  for (const style of ["flat", "drop", "wavy"]) {
    const bad = applyInsertStyle(base, style);
    assert.deepEqual(codes(bad), ["DIFFUSER_NOT_COMPATIBLE"], `${style}: ${codes(bad)}`);
    assert.equal(createLamp(bad).geometry, null, `${style}: no se genera ni se exporta`);
  }
  // los tres estilos con el mismo encastre estándar siguen existiendo en la sólida (la interfaz de montaje no cambia)
  const outer = new Set();
  for (const style of ["flat", "drop", "wavy"]) outer.add(buildValid(applyInsertStyle(DEFAULT_LAMP, style), `sólida ${style}`).metrics.fit.insertOuterDiameterMm);
  assert.equal(outer.size, 1);
});

test("la sólida conserva su inserto liso, ahora el estándar de Ø65,135 (diffuser.stl); los códigos de la calada anteriores a la V6 se leen como eran", () => {
  const solid = createLamp(DEFAULT_LAMP);
  assert.equal(solid.errors.length, 0);
  assert.equal(solid.metrics.fit.insertOuterDiameterMm, 65.135);
  assert.equal(solid.metrics.fit.diffuser, null);
  const old = JSON.parse(JSON.stringify(OPENWORK));
  delete old.openwork.diffuserFit;
  delete old.openwork.diffuserDiameterMm;
  delete old.openwork.diffuserTopGapMm;
  const loaded = normalizeLampDefinition(old);
  assert.equal(loaded.openwork.diffuserFit, "rings", "un diseño calado anterior se lee según los anillos, como era");
  assert.equal(loaded.openwork.diffuserDiameterMm, DEFAULT_OPENWORK.diffuserDiameterMm);
  assert.equal(normalizeLampDefinition({}).openwork.diffuserFit, "diameter");
  // ida y vuelta del código con los campos nuevos
  const code = encodeLampDesign({ ...OPENWORK, openwork: { ...OPENWORK.openwork, diffuserDiameterMm: 80 } });
  const back = decodeLampDesign(code);
  assert.equal(back.def.openwork.diffuserDiameterMm, 80);
  assert.equal(back.def.openwork.diffuserFit, "diameter");
});

test("la base y la rosca: si el difusor no cabe en la base se explica la interferencia exacta y la rosca mínima; ninguna medida se modifica sola", () => {
  const def = { ...OPENWORK, openwork: { ...OPENWORK.openwork, diffuserDiameterMm: 90 } };
  const v = validateLamp(def);
  const e = v.errors.find((x) => x.code === "DIFFUSER_EXCEEDS_BASE");
  assert.ok(e, v.errors.map((x) => x.code).join());
  assert.match(e.message, /Ø 86,8 mm/);
  assert.ok(!v.errors.some((x) => x.code === "TOWER_TOO_WIDE_FOR_THREAD" || x.code === "ADHESION_INTERFERES"), "los efectos secundarios no se repiten como errores");
  const major = suggestThreadMajorForDiffuser(def);
  assert.ok(major > def.thread.majorDiameterMm && major <= 200);
  assert.equal(codes({ ...def, thread: { ...def.thread, majorDiameterMm: major } }).length, 0, `con la rosca Ø${major}`);
  assert.ok(codes({ ...def, thread: { ...def.thread, majorDiameterMm: major - 1 } }).length > 0, "y con un milímetro menos no cabe");
  assert.equal(def.thread.majorDiameterMm, 96);
});

test("recorrido de inserción y extracción: una cintura que estrecha la abertura por debajo del difusor se rechaza con el motivo", () => {
  const def = { ...OPENWORK, openwork: { ...OPENWORK.openwork, waistPct: 100 } };
  const r = createLamp(def);
  assert.equal(r.geometry, null);
  assert.ok(r.errors.some((e) => e.code === "DIFFUSER_STRUCTURE_INTRUDES" || e.code === "DIFFUSER_PATH_BLOCKED"), r.errors.map((e) => e.code).join());
  assert.equal(def.openwork.waistPct, 100);
});

// ================================================================== C — INTERFAZ Y PRESETS
test("interfaz principal: tipo, diseños, altura, diámetro, forma e intensidad a la vista; lo técnico dentro de «Personalización avanzada»", () => {
  for (const [name, def, mainLabels, advancedLabels] of [
    ["sólida", DEFAULT_LAMP, ["Estilo", "Altura", "Diámetro", "Intensidad del diseño"], ["Cantidad de ondas", "Torsión", "Diámetro superior", "Familia de patrón", "Perfil"]],
    ["calada", OPENWORK, ["Estilo", "Altura", "Forma exterior", "Densidad del calado"], ["Diámetro máximo decorativo", "Torsión", "Inclinación de las diagonales", "Grosor de la estructura", "Intensidad de cintura"]],
    ["doble pared", DOUBLE, ["Forma exterior", "Forma interior", "Separación entre paredes", "Altura", "Diámetro máximo"], ["Torsión", "Diámetro inferior (pared interior)", "Profundidad de las ondulaciones"]],
  ]) {
    const s = session(def);
    const adv = s.html.indexOf("Personalización avanzada");
    assert.ok(adv > 0, `${name}: falta «Personalización avanzada»`);
    const detailsOpen = /<details[^>]*open[^>]*>\s*<summary[^>]*>Personalización avanzada/.test(s.html);
    assert.equal(detailsOpen, false, `${name}: lo avanzado empieza plegado`);
    for (const label of mainLabels) {
      const at = s.html.indexOf(label);
      assert.ok(at >= 0 && at < adv, `${name}: «${label}» debe estar en los controles principales`);
    }
    for (const label of advancedLabels) {
      const at = s.html.indexOf(label);
      assert.ok(at > adv, `${name}: «${label}» debe estar en la personalización avanzada`);
    }
    // un parámetro = un control: ningún rótulo de slider se repite dentro de la misma pantalla
    const sliders = [...s.html.slice(0, s.html.indexOf("Difusor y color")).matchAll(/<span>([^<]+)<\/span><span class="[^"]*">[^<]*<\/span><\/span><input type="range"/g)].map((m) => m[1]);
    assert.equal(new Set(sliders).size, sliders.length, `${name}: controles duplicados ${sliders.filter((l, i) => sliders.indexOf(l) !== i)}`);
  }
});

test("los sliders ofrecen el rango VÁLIDO calculado, no la envolvente fija: lo que la interfaz renderiza coincide con las restricciones", () => {
  const s = session(OPENWORK, true);
  const twist = C.computeControlRange(OPENWORK, C.specFor(OPENWORK, "openwork.twistDeg"));
  assert.ok(twist.limitedMax);
  const rendered = s.slider("Torsión");
  assert.equal(rendered.min, twist.min);
  assert.equal(rendered.max, twist.max);
  assert.ok(rendered.max < 720, "la torsión ya no ofrece 720°");
  assert.ok(s.html.includes("Válido:"), "el rango válido se anuncia con su razón");
  // sin contexto de rangos (p. ej. antes de calcularlos) cada control usa su envolvente fija
  registry.seg = []; registry.num = [];
  const bare = renderToStaticMarkup(createElement(MakerLampControls, { def: OPENWORK, onChange() {}, onApplyPreset() {}, onGenerateVariation() {}, onLoadDesign() {}, onError() {}, errors: [], warnings: [], metrics: null, exportButtons: null }));
  assert.ok(/min="-720" max="720"/.test(bare));
});

test("CASO 2 — modificar consecutivamente todos los controles principales (calada, sólida y doble pared): la interfaz solo ofrece valores que generan una lámpara válida", () => {
  // CALADA, con el montaje Ø80/Ø81
  let s = session({ ...OPENWORK, thread: { ...OPENWORK.thread, majorDiameterMm: 102 }, openwork: { ...OPENWORK.openwork, diffuserDiameterMm: 80, maxDiameterMm: 150 } }, true);
  assert.equal(s.result.errors.length, 0);
  const walk = (labels, session0) => {
    for (const label of labels) {
      for (const which of ["min", "max"]) {
        const range = session0.slider(label);
        const v = range[which];
        const group = labelGroup[label];
        session0.set(group.group, group.patch(v));
        assert.equal(session0.result.errors.length, 0, `${label}=${v}: ${session0.result.errors.map((e) => e.code)}`);
      }
    }
  };
  const labelGroup = {
    "Altura": { group: "shade", patch: (v) => ({ heightMm: v }) },
    "Diámetro máximo decorativo": { group: "openwork", patch: (v) => ({ maxDiameterMm: v }) },
    "Densidad del calado (rombos alrededor)": { group: "openwork", patch: (v) => ({ divisions: Math.round(v) }) },
    "Diámetro": { group: "shade", patch: (v) => ({ bottomDiameterMm: v }) },
    "Intensidad del diseño": { group: "shade", patch: (v) => ({ amplitudeMm: v }) },
    "Diámetro máximo": { group: "doubleWall", patch: (v) => ({ maxDiameterMm: v }) },
    "Profundidad de las ondulaciones": { group: "doubleWall", patch: (v) => ({ fluteAmplitudeMm: v }) },
    "Separación entre paredes": { group: "doubleWall", patch: (v) => ({ minGapMm: v }) },
  };
  walk(["Altura", "Diámetro máximo decorativo", "Densidad del calado (rombos alrededor)"], s);
  for (const kind of ["Abombada", "Cilíndrica", "Orgánica"]) {
    s.click(kind);
    assert.equal(s.result.errors.length, 0, `forma ${kind}: ${s.result.errors.map((e) => e.code)}`);
    walk(["Diámetro máximo decorativo"], s);
  }
  buildValid(s.def, "calada tras recorrer los controles");
  // un cambio de patrón también queda válido
  s.click("Espiral");
  assert.equal(s.def.openwork.pattern, "spiral");
  // la espiral con las vueltas por defecto (1,5) NO es imprimible: el error se informa y los rangos de «Vueltas» lo explican
  assert.ok(s.result.errors.some((e) => e.code === "OPENWORK_STRIP_TOO_FLAT"), "la espiral con 1,5 vueltas debe informar el error");
  const turns = C.computeControlRange(s.def, C.specFor(s.def, "openwork.turns"));
  s.set("openwork", { turns: C.nearestInRange(turns, s.def.openwork.turns) });
  assert.equal(s.result.errors.length, 0, s.result.errors.map((e) => e.code).join());

  // SÓLIDA
  s = session(DEFAULT_LAMP);
  walk(["Altura", "Diámetro", "Intensidad del diseño"], s);
  for (const profile of ["Recto", "Barril", "Cintura", "Campana", "Tulipán"]) {
    s.click(profile);
    assert.equal(s.result.errors.length, 0, `perfil ${profile}: ${s.result.errors.map((e) => e.code)}`);
  }
  buildValid(s.def, "sólida tras recorrer los controles");

  // DOBLE PARED
  s = session(DOUBLE, true);
  walk(["Separación entre paredes", "Diámetro máximo", "Profundidad de las ondulaciones"], s);
  buildValid(s.def, "doble pared tras recorrer los controles");
});

test("CASO 3 — diseños (presets): cada diseño ofrecido genera una lámpara válida con las medidas actuales y sigue siendo válida al mover altura, diámetro, forma e intensidad", () => {
  // SÓLIDA
  const solidAv = availableLampPresets(DEFAULT_LAMP);
  assert.ok(solidAv.available.length >= 6, `diseños de la sólida disponibles: ${solidAv.available.length}`);
  for (const preset of solidAv.available) {
    const def = applyLampPreset(DEFAULT_LAMP, preset);
    buildValid(def, `sólida/${preset.id}`);
  }
  for (const h of solidAv.hidden) assert.ok(h.reason, `${h.preset.id}: razón`); // lo oculto explica por qué
  // un preset de la sólida movido por todos los controles principales
  const solidPreset = applyLampPreset(DEFAULT_LAMP, solidAv.available[0]);
  for (const path of ["shade.heightMm", "shade.bottomDiameterMm", "shade.amplitudeMm"]) {
    const r = C.computeControlRange(solidPreset, C.specFor(solidPreset, path));
    for (const v of [r.min, r.max]) buildValid(setP(solidPreset, path, v), `sólida preset ${path}=${v}`);
  }

  // CALADA con el montaje por defecto (Ø70) y con el Ø80/Ø81 (rosca Ø102)
  const mounts = [
    ["Ø70 / rosca 96", OPENWORK],
    ["Ø80 / rosca 102", { ...OPENWORK, thread: { ...OPENWORK.thread, majorDiameterMm: 102 }, openwork: { ...OPENWORK.openwork, diffuserDiameterMm: 80 } }],
  ];
  for (const [label, start] of mounts) {
    const { available, hidden } = availableOpenworkPresets(start, OPENWORK_PRESETS);
    assert.ok(available.length >= 5, `${label}: ${available.length} diseños calados disponibles`);
    assert.ok(hidden.every((h) => h.reason), `${label}: lo oculto explica por qué`);
    for (const preset of available) {
      const def = applyOpenworkPreset(start, preset);
      const r = buildValid(def, `${label}/${preset.id}`);
      assert.equal(r.metrics.fit.diffuser.diffuserDiameterMm, start.openwork.diffuserDiameterMm, `${label}/${preset.id}: el preset no cambia el difusor`);
      assert.equal(def.thread.majorDiameterMm, start.thread.majorDiameterMm, `${label}/${preset.id}: ni la rosca`);
      assert.equal(def.shade.heightMm, start.shade.heightMm);
    }
    // un preset movido por altura, diámetro, forma e intensidad
    const preset = applyOpenworkPreset(start, available[0]);
    for (const path of ["shade.heightMm", "openwork.maxDiameterMm", preset.openwork.pattern === "diamond" ? "openwork.divisions" : "openwork.bands"]) {
      const range = C.computeControlRange(preset, C.specFor(preset, path));
      for (const v of [range.min, range.max]) buildValid(setP(preset, path, v), `${label} preset ${path}=${v}`);
    }
    for (const kind of ["cylinder", "bulge", "organic"]) {
      if (silhouetteAvailability(preset, kind).ok) buildValid(applySilhouette(preset, kind), `${label} silueta ${kind}`);
    }
  }
  // el diseño que no cabe con un difusor (la cintura de «Reloj de arena calado») no se ofrece y se explica; con el ajuste «según anillos» sí
  const av = availableOpenworkPresets(OPENWORK, OPENWORK_PRESETS);
  const reloj = av.hidden.find((h) => h.preset.id === "reloj-de-arena-calado");
  assert.ok(reloj && /difusor|abertura|estructura/i.test(reloj.reason), JSON.stringify(av.hidden));
  const rings = { ...OPENWORK, openwork: { ...OPENWORK.openwork, diffuserFit: "manual" }, base: { diameterMm: 130 } };
  assert.ok(availableOpenworkPresets(rings, OPENWORK_PRESETS).available.length === 6, "con el difusor manual de Ø65 los seis diseños son válidos");
});

test("doble pared: las formas que rompen la separación entre paredes no se ofrecen (con su razón) y todas las ofrecidas generan una lámpara válida", () => {
  const S = loadMakerModule("lib/maker/lamps/doublewall/shapes.ts");
  const A = loadMakerModule("lib/maker/lamps/availability.ts");
  const outer = A.availableDoubleOuterShapes(DOUBLE, Object.keys(S.DOUBLE_OUTER_LABELS));
  const inner = A.availableDoubleInnerShapes(DOUBLE, Object.keys(S.DOUBLE_INNER_LABELS));
  assert.deepEqual(outer.hidden.map((h) => h.kind), ["wavy"], JSON.stringify(outer.hidden));
  assert.deepEqual(inner.hidden.map((h) => h.kind), ["cone"], JSON.stringify(inner.hidden));
  assert.ok([...outer.hidden, ...inner.hidden].every((h) => /paredes/.test(h.reason)), "la razón es la separación entre paredes");
  // lo ofrecido es válido con la validación COMPLETA (no solo con el muestreo grueso de la disponibilidad)
  for (const kind of outer.available) assert.deepEqual(codes(S.applyDoubleOuterShape(DOUBLE, kind)), [], `exterior ${kind}`);
  for (const kind of inner.available) assert.deepEqual(codes(S.applyDoubleInnerShape(DOUBLE, kind)), [], `interior ${kind}`);
  buildValid(S.applyDoubleOuterShape(DOUBLE, "fluted"), "doble pared estriada");
  // y lo que no se ofrece, efectivamente, no sería válido
  assert.ok(codes(S.applyDoubleOuterShape(DOUBLE, "wavy")).includes("DW_GAP"));
  assert.ok(codes(S.applyDoubleInnerShape(DOUBLE, "cone")).includes("DW_GAP"));
});

test("las miniaturas de los diseños dibujan lo que se malla: con el difusor como dato se resuelven los extremos antes de dibujar", () => {
  const { renderOpenworkThumbnail } = loadMakerModule("lib/maker/lamps/openwork/thumbnail.ts");
  const preset = OPENWORK_PRESETS[0];
  const def = applyOpenworkPreset(OPENWORK, preset);
  const r = buildValid(def, "miniatura");
  const resolved = resolveLampDef(def);
  const thumb = renderOpenworkThumbnail(resolved.shade, resolved.openwork, 96);
  assert.ok(thumb.width > 20 && thumb.height === 96);
  const wrong = renderOpenworkThumbnail(def.shade, def.openwork, 96);
  assert.notEqual(thumb.width, wrong.width, "sin resolver, la miniatura sería de otra pantalla");
  assert.ok(r.indexed.shade.positions.length > 0);
});

// ================================================================== D — VISTA PREVIA HONESTA Y EXPORTACIÓN
test("vista previa: con errores se muestra la última lámpara válida MARCADA como desactualizada, con los errores actuales; sin errores previos no hay vista anterior", () => {
  const { selectLampView } = loadMakerModule("lib/maker/lamps/view.ts");
  const good = createLamp(DEFAULT_LAMP);
  const bad = createLamp({ ...DEFAULT_LAMP, shade: { ...DEFAULT_LAMP.shade, waves: 32 } });
  assert.equal(bad.geometry, null);
  const view = selectLampView(bad, good);
  assert.equal(view.outdated, true);
  assert.ok(view.outdatedReason && view.outdatedReason.length > 10);
  assert.equal(view.result.geometry, good.geometry, "el visor conserva la última geometría válida");
  assert.deepEqual(view.result.errors, bad.errors, "pero los errores son los ACTUALES");
  assert.throws(() => lampPartEntries(view.result), /./, "y no se exporta");
  assert.equal(selectLampView(good, good).outdated, false);
  assert.equal(selectLampView(bad, null).outdated, false);
  assert.equal(selectLampView(bad, null).result.geometry, null);
});

test("el panel avisa cuando el visor muestra una vista anterior y la página bloquea la descarga", () => {
  registry.seg = []; registry.num = [];
  const bad = createLamp({ ...DEFAULT_LAMP, shade: { ...DEFAULT_LAMP.shade, waves: 32 } });
  const html = renderToStaticMarkup(createElement(MakerLampControls, { def: DEFAULT_LAMP, onChange() {}, onApplyPreset() {}, onGenerateVariation() {}, onLoadDesign() {}, onError() {}, errors: bad.errors, warnings: bad.warnings, metrics: null, outdated: true, exportButtons: null }));
  // mensaje corto, sin códigos internos ni párrafos: lo que se ve y lo que no se puede hacer
  assert.ok(html.includes("El visor muestra el último diseño válido") && html.includes("No se puede descargar"));
  assert.ok(!html.includes("NO corresponde") && !/[A-Z]+_[A-Z_]+/.test(html.replace(/data-[a-z-]+/g, "")), "sin códigos internos en la interfaz");
  const page = loadFile("src/app/stampa-maker/lamparas/page.tsx");
  assert.ok(page.includes("outdated") && page.includes("Vista anterior"), "la página marca el visor");
  assert.ok(/canDownload = !pending && !outdated/.test(page), "la descarga se bloquea mientras el visor muestra una vista anterior");
});

test("exportación: el ZIP y los STL salen de las mismas mallas del visor, con el difusor Ø80 y el LEEME; un diseño con errores no exporta nada", async () => {
  const def = { ...OPENWORK, thread: { ...OPENWORK.thread, majorDiameterMm: 102 }, openwork: { ...OPENWORK.openwork, diffuserDiameterMm: 80, maxDiameterMm: 150 } };
  const r = buildValid(def, "export");
  const zip = await JSZip.loadAsync(Buffer.from(await (await buildLampZipBlob(r, def)).arrayBuffer()));
  const names = Object.keys(zip.files);
  assert.ok(names.some((n) => /pantalla/.test(n)) && names.some((n) => /inserto/.test(n)) && names.some((n) => /base/.test(n)) && names.includes("LEEME.txt"));
  const insertEntry = lampPartEntries(r).find((e) => /inserto/.test(e.fileName));
  const stl = await zip.file(insertEntry.fileName).async("nodebuffer");
  const parsed = parseStl(stl);
  assert.ok(Math.abs(2 * Math.max(...radii(parsed)) - 80) < 0.02);
  // un cuerpo que no pasa por el cuello roscado (Ø130 con rosca Ø96) es un diseño con errores: no exporta nada
  const bad = createLamp({ ...def, thread: { ...def.thread, majorDiameterMm: 96 }, openwork: { ...def.openwork, diffuserDiameterMm: 130 } });
  assert.equal(bad.geometry, null);
  await assert.rejects(() => buildLampZipBlob(bad, def));
});

test("la clave de geometría no cambia con el color y sí con todo lo que mueve la malla (la vista previa nunca queda desfasada)", () => {
  const a = lampGeometryKey(OPENWORK);
  assert.equal(lampGeometryKey({ ...OPENWORK, insert: { ...OPENWORK.insert, previewColor: "#3fae5a" } }), a);
  for (const patch of [{ diffuserDiameterMm: 71 }, { diffuserClearanceMm: 1.2 }, { diffuserTopGapMm: 9 }, { diffuserFit: "rings" }]) {
    assert.notEqual(lampGeometryKey({ ...OPENWORK, openwork: { ...OPENWORK.openwork, ...patch } }), a, JSON.stringify(patch));
  }
});

function loadFile(rel) {
  return fs.readFileSync(rel, "utf8");
}
