import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { bbox, fitAxis, halfPlaneSegments, loadStlBinary, radiiAtZ } from "../scripts/lib/stl-measure.mjs";
import { planeCrossings } from "./helpers/lamp-slice.mjs";

// SILUETA MOSSGLOW. El difusor debe reproducir el perfil exterior del STL de referencia (panza inferior redondeada, curva cóncava hacia adentro en la zona media, cuello
// superior estrecho y suavizado), NO un cono ni una gota. No alcanza con comparar altura y diámetro máximo: se compara el perfil COMPLETO, normalizado, contra puntos
// medidos del STL, y se verifican las propiedades que definen la forma (panza, punto de inflexión, cuello) para detectar si algún día se vuelve un cono o pierde la panza.
// Los puntos están en este archivo (números, no malla): la prueba no depende de que el STL esté en el equipo; si está, también se compara directamente con él.

const D = loadMakerModule("lib/maker/lamps/defaults.ts");
const E = loadMakerModule("lib/maker/lamps/editor.ts");
const CAPS = loadMakerModule("lib/maker/lamps/capabilities.ts");
const S = loadMakerModule("lib/maker/lamps/standard.ts");
const { createLamp } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { lampPartEntries } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { indexedBounds } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { MOSSGLOW_REFERENCE } = loadMakerModule("lib/maker/lamps/insert/profile.ts");

const FIT_D = 65.135; // encastre estándar (diffuser.stl)
const FIT_H = 13; // tubo liso del encastre
const REF_H = 154.265;
/** Ø exterior del STL de referencia por secciones horizontales: [z mm sobre su base, Ø mm]. Sobre el encastre (z > 13) y con la altura de la referencia. */
const REF = [
  [24.25, 67.69], [28.25, 67.55], [32.25, 67.24], [36.25, 66.73], [40.25, 66.03], [44.25, 65.07], [48.25, 63.9], [52.25, 62.43], [56.25, 60.71], [60.25, 58.7],
  [64.25, 56.42], [68.25, 53.91], [72.25, 51.2], [76.25, 48.38], [80.25, 45.52], [84.25, 42.71], [88.25, 40.02], [92.25, 37.51], [96.25, 35.23], [100.25, 33.18],
  [104.25, 31.38], [108.25, 29.8], [112.25, 28.46], [116.25, 27.32], [120.25, 26.39], [124.25, 25.63], [128.25, 25.04], [132.25, 24.59], [136.25, 24.28],
  [140.25, 24.1], [144.25, 24.04], [148.25, 24.08], [152.25, 24.22],
].map(([z, d]) => ({ u: (z - FIT_H) / (REF_H - FIT_H), d }));

const mossglow = (ins = {}, extra = {}) => {
  const base = CAPS.applyDiffuserKind(E.newLampDesign(), "mossglow");
  return { ...base, ...extra, insert: { ...base.insert, ...ins } };
};
const build = (def, label) => {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `${label}: ${JSON.stringify(r.errors.map((e) => e.code))}`);
  return r;
};
/** Ø exterior de la malla del difusor a la fracción u del cuerpo (0 = sobre el encastre, 1 = borde superior); alturas alineadas con la referencia. */
function profileOf(r, def, us) {
  const L = validateLamp(def).layout.insert;
  const H = def.insert.heightMm;
  return us.map((u) => {
    const z = Math.min(FIT_H + u * (H - FIT_H), H - 0.3);
    const c = planeCrossings(r.indexed.insert, L.z0 + z + 0.013);
    return 2 * c.at(-1);
  });
}
const us = REF.map((p) => p.u);

// ================================================================================================ 1. PERFIL COMPLETO CONTRA EL STL
test("Mossglow por defecto: el perfil normalizado coincide con el del STL de referencia en todo el cuerpo (±0,6 mm de Ø)", () => {
  const def = mossglow();
  const r = build(def, "mossglow");
  const gen = profileOf(r, def, us);
  let worst = 0;
  REF.forEach((p, i) => {
    const dev = Math.abs(gen[i] - p.d);
    worst = Math.max(worst, dev);
    assert.ok(dev <= 0.6, `u=${p.u.toFixed(3)}: generado Ø${gen[i].toFixed(2)} vs referencia Ø${p.d.toFixed(2)}`);
  });
  assert.ok(worst < 0.6);
});

// ================================================================================================ 2. LA FORMA: PANZA, INFLEXIÓN, CUELLO
test("Mossglow: tiene panza inferior, curva cóncava hacia adentro en la zona media y cuello superior estrecho y suavizado (no es un cono ni una gota)", () => {
  const def = mossglow();
  const r = build(def, "mossglow");
  const fine = Array.from({ length: 81 }, (_, i) => 0.02 + (i * 0.96) / 80); // u de 0,02 a 0,98
  const d = profileOf(r, def, fine);
  // (1) panza: el máximo está en el tramo inferior del cuerpo y supera al encastre en más de 2 mm de Ø
  const iMax = d.indexOf(Math.max(...d));
  assert.ok(fine[iMax] > 0.03 && fine[iMax] < 0.16, `la panza máxima está en u=${fine[iMax].toFixed(2)}`);
  assert.ok(Math.max(...d) > FIT_D + 2, `panza Ø${Math.max(...d).toFixed(2)} vs encastre Ø${FIT_D}`);
  // (2) no es un cono: la curva se aparta de la recta entre la panza y el cuello: por ARRIBA de la cuerda en la zona baja (convexa) y por DEBAJO en la alta (cóncava)
  const a = 0.1, b = 0.9;
  const dA = profileOf(r, def, [a])[0], dB = profileOf(r, def, [b])[0];
  const chord = (u) => dA + ((dB - dA) * (u - a)) / (b - a);
  const dev = fine.map((u, i) => (u >= a && u <= b ? d[i] - chord(u) : 0));
  assert.ok(Math.max(...dev) > 3, `la parte baja debería abombarse sobre la cuerda (máx ${Math.max(...dev).toFixed(2)} mm)`);
  assert.ok(Math.min(...dev) < -2, `la parte alta debería curvarse bajo la cuerda (mín ${Math.min(...dev).toFixed(2)} mm)`);
  // (3) punto de inflexión: la pendiente más pronunciada está en la zona media (u 0,35–0,7), con curvatura convexa antes y cóncava después
  const slope = d.slice(1).map((v, i) => v - d[i]);
  const iSteep = slope.indexOf(Math.min(...slope));
  assert.ok(fine[iSteep] > 0.35 && fine[iSteep] < 0.7, `estrechamiento más pronunciado en u=${fine[iSteep].toFixed(2)}`);
  assert.ok(slope[iSteep] < slope[3] - 0.4 && slope[iSteep] < slope[slope.length - 3] - 0.3, "la pendiente máxima es mucho mayor que abajo y arriba: no es lineal");
  const second = slope.slice(1).map((v, i) => v - slope[i]);
  assert.ok(second[Math.floor(fine.length * 0.15)] < 0 || second[Math.floor(fine.length * 0.25)] < 0, "convexa (panza) en la zona baja");
  assert.ok(second[Math.floor(fine.length * 0.85)] > 0, "cóncava (se asienta en el cuello) en la zona alta");
  // (4) cuello: Ø mínimo cerca del de la referencia, casi constante en el último 12 % y sin saltos
  const neck = d.filter((_, i) => fine[i] > 0.86);
  assert.ok(Math.min(...neck) > 23.6 && Math.min(...neck) < 25, `cuello Ø${Math.min(...neck).toFixed(2)}`);
  assert.ok(Math.max(...neck) - Math.min(...neck) < 1.8, "el cuello es casi cilíndrico");
  // (5) suave: ninguna variación brusca entre muestras vecinas
  assert.ok(Math.max(...slope.map(Math.abs)) < 1.6, `salto máximo ${Math.max(...slope.map(Math.abs)).toFixed(2)} mm de Ø por muestra`);
  // (6) estrechamiento total: del orden de la referencia (67,7 → 24,0)
  assert.ok(Math.max(...d) - Math.min(...d) > 40);
});

test("Mossglow: la silueta no depende de la terminación superior (abierta, tapa plana, redondeada o gota)", () => {
  const open = mossglow({ profileTop: "open" });
  const ro = build(open, "abierta");
  const base = profileOf(ro, open, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
  for (const top of ["flat", "round", "drop"]) {
    const def = mossglow({ profileTop: top });
    const r = build(def, top);
    const p = profileOf(r, def, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    p.forEach((v, i) => assert.ok(Math.abs(v - base[i]) < 0.35, `${top}: u=${(0.1 * (i + 1)).toFixed(1)} Ø${v.toFixed(2)} vs abierta Ø${base[i].toFixed(2)}`));
  }
});

// ================================================================================================ 3. ENCASTRE INFERIOR, EXPORTACIÓN Y VISOR
test("Mossglow: el encastre inferior es EXACTAMENTE el estándar (tubo Ø65,135 × 0,8, 13 mm, transición por encima) con cualquier ajuste, y la base y la rosca no cambian", () => {
  const std = build(CAPS.applyDiffuserKind(E.newLampDesign(), "cylinder"), "cilindro estándar");
  for (const ins of [{}, { profileCurvaturePct: 90 }, { profileWaistPct: 30 }, { heightMm: 185 }, { profileTop: "round" }, { profileTop: "flat" }]) {
    const def = mossglow(ins);
    const r = build(def, JSON.stringify(ins));
    const L = validateLamp(def).layout.insert;
    for (let dz = 0.5; dz <= 12.5; dz += 1) {
      const x = planeCrossings(r.indexed.insert, L.z0 + dz, 0.37);
      assert.ok(Math.abs(x.at(-1) - 32.5675) < 0.02 && Math.abs(x.at(-1) - x[0] - 0.8) < 0.02, `${JSON.stringify(ins)}: tubo a +${dz} mm: ${x}`);
    }
    // la transición empieza por encima del encastre: a 13,5 mm el radio todavía es el del tubo (tangente vertical)
    const just = planeCrossings(r.indexed.insert, L.z0 + FIT_H + 0.5, 0.37).at(-1);
    assert.ok(just - 32.5675 < 0.25 && just >= 32.5675 - 1e-6, `justo sobre el encastre: ${just}`);
    // base y pantalla: idénticas a las de cualquier otro difusor
    assert.deepEqual(r.indexed.base.positions, std.indexed.base.positions, "base");
    assert.deepEqual(r.indexed.shade.positions, std.indexed.shade.positions, "pantalla (rosca)");
  }
  // la mecánica del diseño es la estándar
  assert.equal(S.mechanicalDeviations(mossglow()).length, 0);
});

test("Mossglow: el STL exportado es la malla del visor (triángulos, altura y Ø máximo) y su zona inferior es el tubo estándar", async () => {
  const def = mossglow();
  const r = build(def, "export");
  const idx = r.geometry.parts.findIndex((p) => p.kind === "lampInsert" || p.kind === "lampInsertDrop");
  const entry = lampPartEntries(r)[idx];
  assert.match(entry.fileName, /difusor_mossglow/);
  const buf = Buffer.from(await buildSTLBlob(entry.mesh).arrayBuffer());
  const n = buf.readUInt32LE(80);
  assert.equal(n, r.geometry.parts[idx].mesh.triangleCount, "triángulos: STL = visor");
  let zMin = Infinity, zMax = -Infinity, maxR = 0;
  const verts = [];
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const o = 84 + t * 50 + 12 + k * 12;
    const v = [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)];
    verts.push(v);
    zMin = Math.min(zMin, v[2]);
    zMax = Math.max(zMax, v[2]);
    maxR = Math.max(maxR, Math.hypot(v[0], v[1]));
  }
  assert.ok(Math.abs(zMax - zMin - 170) < 0.01, `altura del STL ${zMax - zMin}`);
  assert.ok(Math.abs(2 * maxR - 67.69) < 0.05, `Ø máximo del STL ${2 * maxR}`);
  // el STL se imprime parado (extremo abierto arriba): la zona de encastre es la inferior; su radio es el del tubo estándar
  const lower = verts.filter((v) => v[2] - zMin < FIT_H - 0.01).map((v) => Math.hypot(v[0], v[1]));
  assert.ok(Math.abs(2 * Math.max(...lower) - FIT_D) < 0.02, `encastre en el STL: Ø${2 * Math.max(...lower)}`);
  // el cuello del STL (últimos 10 mm) es angosto: no hay cono ni cierre puntiagudo
  const neck = verts.filter((v) => zMax - v[2] < 10).map((v) => Math.hypot(v[0], v[1]));
  assert.ok(2 * Math.max(...neck) < 27, `cuello del STL Ø${2 * Math.max(...neck)}`);
  assert.ok(zMax - zMin === indexedBounds(r.indexed.insert).maxZ - indexedBounds(r.indexed.insert).minZ || Math.abs(zMax - zMin - (indexedBounds(r.indexed.insert).maxZ - indexedBounds(r.indexed.insert).minZ)) < 0.01);
});

test("Mossglow: sin lengüetas, disponible solo con la pantalla sólida (calada y doble pared no lo ofrecen)", () => {
  const withTabs = mossglow({ tabs: true });
  const r = build(withTabs, "tabs");
  const b = indexedBounds(r.indexed.insert);
  assert.ok(Math.abs(b.maxX - b.minX - (b.maxY - b.minY)) < 0.2, "sin salientes en Y");
  const { switchFamily } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
  for (const type of ["openwork", "double"]) assert.ok(!CAPS.familyCaps(type).diffuser.allowed.includes("mossglow"), type);
  assert.deepEqual(validateLamp({ ...switchFamily(E.newLampDesign(), "openwork").def, insert: { ...mossglow().insert } }).errors.map((e) => e.code).filter((c) => c === "DIFFUSER_NOT_COMPATIBLE"), ["DIFFUSER_NOT_COMPATIBLE"]);
  // por defecto es válido con la bombilla estándar de los diseños nuevos
  assert.deepEqual(validateLamp(mossglow()).errors, []);
  assert.deepEqual(D.INSERT_STYLE_INITIAL.mossglow.tabs, false);
});

// ================================================================================================ 4. CONTRA EL STL ORIGINAL (si está en el equipo)
const STL = "references/lamp-e27/Mossglow+Lite+-+Diffuser+-+Pla.stl";
test("Mossglow: el perfil generado coincide con el del STL original medido directamente (solo si el archivo está en references/lamp-e27)", { skip: !fs.existsSync(STL) && "el STL de referencia no está en este equipo" }, () => {
  const T = loadStlBinary(STL);
  const b = bbox(T);
  const ax = fitAxis(T, b.min[2] + 40, 1);
  const S0 = halfPlaneSegments(T, ax.cx, ax.cy, 0);
  const def = mossglow();
  const r = build(def, "mossglow");
  const gen = profileOf(r, def, us);
  REF.forEach((p, i) => {
    const z = FIT_H + p.u * (b.size[2] - FIT_H) + b.min[2];
    const ext = radiiAtZ(S0, z).at(-1) * 2;
    assert.ok(Math.abs(ext - p.d) < 0.05, `los puntos de este test salen del STL (u=${p.u.toFixed(2)}: ${ext} vs ${p.d})`);
    assert.ok(Math.abs(gen[i] - ext) < 0.6, `u=${p.u.toFixed(2)}: generado ${gen[i].toFixed(2)} vs STL ${ext.toFixed(2)}`);
  });
  assert.equal(MOSSGLOW_REFERENCE.heightMm, 154.27);
});
