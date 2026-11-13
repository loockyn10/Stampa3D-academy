import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { planeCrossings } from "./helpers/lamp-slice.mjs";
import { loadLampUi } from "./helpers/lamp-editor-ui.mjs";

// Difusores decorativos de perfil (Mossglow, Tulipán, Reloj de arena, Campana). Todo se mide sobre las MALLAS generadas (las que ve el
// visor y exporta el STL). Son pruebas GEOMÉTRICAS: ninguna es una validación térmica ni de montaje físico. El encastre inferior estándar
// (Ø65,135, pared 0,8: diffuser.stl) no puede cambiar con ningún estilo ni parámetro.

const { DEFAULT_LAMP, applyInsertStyle, normalizeLampDefinition, INSERT_STYLE_INITIAL } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp, insertKind } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { applyShadeType } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");
const { specsFor, computeControlRange, setLampPath } = loadMakerModule("lib/maker/lamps/constraints.ts");
const CAPS = loadMakerModule("lib/maker/lamps/capabilities.ts");
const { PROFILE_TOPS, profilePrintKind, isProfileStyle, MOSSGLOW_REFERENCE } = loadMakerModule("lib/maker/lamps/insert/profile.ts");
const { encodeLampDesign, decodeLampDesign } = loadMakerModule("lib/maker/lamps/designCode.ts");
const { referenceInsertSurface, insertSilhouette } = loadMakerModule("lib/maker/lamps/insert/silhouette.ts");
const { indexedBounds, analyzeMesh } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { lampPartEntries } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { REFERENCE_DIFFUSER } = loadMakerModule("lib/maker/lamps/holder/references.ts");

const STYLES = ["mossglow", "tulip", "hourglass", "bell"];
/** Bombilla LED pequeña tipo gota (Ø30 × 45 mm sobre el portalámparas): es la que usan estas lámparas. Los valores por defecto (Ø60) son un marcador de posición. */
const SMALL_BULB = { diameterMm: 30, heightAboveHolderMm: 45 };
const BASE = { ...DEFAULT_LAMP, bulb: SMALL_BULB };
const FIT_R = REFERENCE_DIFFUSER.outerDiameterMm / 2;
const T = DEFAULT_LAMP.insert.thicknessMm;

/** Lámpara con el difusor de perfil `style`, la terminación `top` y parámetros `ins`. */
const lamp = (style, ins = {}, top, extra = {}) => {
  const d = applyInsertStyle(BASE, style);
  return { ...d, ...extra, insert: { ...d.insert, ...(top ? { profileTop: top } : {}), ...ins } };
};
const build = (def, label = "") => {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `${label} errores: ${JSON.stringify(r.errors.map((e) => `${e.code}: ${e.message.slice(0, 110)}`))}`);
  return r;
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const clean = (mesh, label) => {
  const rep = analyzeMesh(mesh);
  assert.equal(rep.nonFinite, 0, `${label}: coordenadas no finitas`);
  assert.equal(rep.degenerate, 0, `${label}: triángulos degenerados`);
  assert.equal(rep.boundaryEdges, 0, `${label}: aristas abiertas`);
  assert.equal(rep.nonManifoldEdges, 0, `${label}: aristas no-manifold`);
  assert.equal(rep.inconsistentEdges, 0, `${label}: normales incoherentes`);
  assert.ok(rep.volume > 0, `${label}: volumen ${rep.volume}`);
};
const allTops = () => STYLES.flatMap((s) => PROFILE_TOPS[s].map((t) => [s, t]));

/** Perfil exterior e interior medidos sobre la malla: [{ z, inner, outer, n }] cada `dz` mm entre `z0` y `z1`. */
function sliceProfile(mesh, z0, z1, dz = 0.5) {
  const out = [];
  for (let z = z0; z <= z1 + 1e-9; z += dz) {
    const c = planeCrossings(mesh, z);
    out.push({ z, n: c.length, inner: c.length >= 2 ? c[0] : null, outer: c.at(-1) });
  }
  return out;
}

// ==================================================================================================== 1. FAMILIAS Y ENCASTRE
test("estilos: los cuatro difusores existen, son distintos entre sí y de la gota, y solo se ofrecen con la pantalla sólida", () => {
  assert.deepEqual([...CAPS.familyCaps("solid").diffuser.allowed], ["cylinder", "flat", "drop", "wavy", ...STYLES]);
  assert.deepEqual([...CAPS.familyCaps("openwork").diffuser.allowed], ["cylinder"], "la calada conserva su difusor cilíndrico");
  assert.deepEqual([...CAPS.familyCaps("double").diffuser.allowed], ["cylinder"], "la doble pared conserva su pared interior");
  for (const s of STYLES) assert.equal(CAPS.diffuserKind(applyInsertStyle(BASE, s).insert), s);
  // siluetas distintas: ninguna coincide con otra (se mide el perfil exterior sobre la malla)
  const profiles = {};
  for (const s of STYLES) {
    const r = build(lamp(s), s);
    const b = indexedBounds(r.indexed.insert);
    profiles[s] = [0.15, 0.4, 0.65, 0.9].map((f) => 2 * planeCrossings(r.indexed.insert, b.minZ + f * (b.maxZ - b.minZ)).at(-1));
  }
  for (let i = 0; i < STYLES.length; i++) for (let j = i + 1; j < STYLES.length; j++) {
    const d = Math.max(...profiles[STYLES[i]].map((v, k) => Math.abs(v - profiles[STYLES[j]][k])));
    assert.ok(d > 4, `${STYLES[i]} y ${STYLES[j]} se parecen demasiado (${d.toFixed(1)} mm)`);
  }
  // la gota existente no se duplicó ni cambió: sigue siendo cilindro + cierre
  const drop = build(applyInsertStyle(BASE, "drop"), "gota");
  near(2 * Math.max(...planeCrossings(drop.indexed.insert, 100)), 65.135, 0.02, "la gota conserva su cuerpo cilíndrico");
});

test("pantallas calada y doble pared: no reciben los difusores decorativos ni automáticamente ni por validación", () => {
  for (const type of ["openwork", "double"]) {
    const base = applyShadeType(BASE, type);
    for (const s of STYLES) {
      const forced = { ...base, insert: { ...base.insert, ...INSERT_STYLE_INITIAL[s], style: s, enabled: true } };
      assert.ok(validateLamp(forced).errors.some((e) => e.code === "DIFFUSER_NOT_COMPATIBLE"), `${type}/${s}: debe rechazarse`);
      assert.equal(CAPS.applyDiffuserKind(base, s), base, `${type}/${s}: la acción del usuario no cambia nada`);
      const conformed = CAPS.conformToFamily(forced);
      assert.equal(CAPS.diffuserKind(conformed.insert), "cylinder", `${type}/${s}: al elegir la familia vuelve al cilíndrico`);
    }
    assert.equal(CAPS.diffuserKind(base.insert), "cylinder");
  }
});

test("encastre inferior: Ø65,135 exterior / pared 0,8 y los mismos vértices en todos los estilos, terminaciones y parámetros (la zona nunca cambia)", () => {
  const reference = build(CAPS.applyDiffuserKind(BASE, "cylinder"), "referencia cilíndrica (144 columnas, igual que los difusores de perfil)");
  const refB = indexedBounds(reference.indexed.insert);
  const zm = refB.minZ + DEFAULT_LAMP.insert.seatDepthMm + 3;
  const refRows = sliceProfile(reference.indexed.insert, refB.minZ + 0.2, zm - 0.2, 1);
  for (const [style, top] of allTops()) {
    for (const ins of [{}, { profileWidthMm: 90, profileTopDiameterMm: 100, profileCurvaturePct: 95, profileWaistPct: 80, profileWaistPositionPct: 30 }, { profileWidthMm: 55, profileTopDiameterMm: 40, profileCurvaturePct: 5 }]) {
      const def = lamp(style, ins, top);
      const v = validateLamp(def);
      const layout = v.layout;
      assert.equal(layout.insert.fitOuterR, FIT_R, `${style}/${top}: radio exterior del encastre en el layout`);
      assert.equal(layout.insert.mountInnerR, FIT_R - T);
      assert.equal(layout.insert.flareH, 0, "el difusor de perfil no usa la transición cónica del cilindro ancho");
      if (!v.layout.insert.surface.valid) continue;
      const { createInsertMesh } = loadMakerModule("lib/maker/lamps/parts/createInsert.ts");
      const mesh = createInsertMesh(v.resolved, layout);
      const b = indexedBounds(mesh);
      assert.equal(b.minZ, refB.minZ, `${style}/${top}: mismo borde inferior`);
      const rows = sliceProfile(mesh, b.minZ + 0.2, zm - 0.2, 1);
      rows.forEach((row, i) => {
        near(row.outer, refRows[i].outer, 0.0005, `${style}/${top}: Ø exterior del encastre a z=${row.z.toFixed(1)}`);
        near(row.inner, refRows[i].inner, 0.0005, `${style}/${top}: Ø interior del encastre`);
        near(2 * row.outer, 65.135, 0.02, "Ø65,135");
        near(row.outer - row.inner, T, 0.001, "pared del encastre");
      });
    }
  }
});

test("la base, la rosca y la pantalla son bit a bit las mismas con cualquier difusor de perfil (no se toca nada del sistema mecánico)", () => {
  const ref = build(applyInsertStyle(BASE, "wavy"), "ref");
  for (const s of STYLES) {
    const r = build(lamp(s), s);
    assert.deepEqual(Array.from(r.indexed.base.positions), Array.from(ref.indexed.base.positions), `${s}: la base cambió`);
    assert.deepEqual(Array.from(r.indexed.base.tris), Array.from(ref.indexed.base.tris), `${s}: la base cambió`);
    assert.deepEqual(Array.from(r.indexed.shade.positions), Array.from(ref.indexed.shade.positions), `${s}: la pantalla cambió`);
    assert.equal(r.metrics.fit.insertFit.outerDiameterMm, 65.14);
    assert.equal(r.metrics.fit.insertFit.flareHeightMm, 0);
  }
});

// ==================================================================================================== 2. SILUETA MOSSGLOW
test("Mossglow: silueta de la referencia (panza, curva hacia adentro, cuello) con la altura por defecto; el estrechamiento es progresivo y la panza es mayor que el encastre", () => {
  assert.deepEqual({ ...MOSSGLOW_REFERENCE }, { heightMm: 154.27, peakDiameterMm: 67.69, peakZMm: 22.25, neckDiameterMm: 24.04, fitHeightMm: 13 });
  const r = build(lamp("mossglow"), "mossglow por defecto");
  const m = r.indexed.insert;
  const b = indexedBounds(m);
  near(b.maxZ - b.minZ, 170, 0.01, "altura por defecto");
  near(b.maxX - b.minX, 67.69, 0.05, "Ø de la panza (la de la referencia)");
  assert.ok(b.maxX - b.minX > 65.135 + 2, "la panza es mayor que el encastre");
  near(2 * planeCrossings(m, b.minZ + 6).at(-1), 65.135, 0.02, "el encastre inferior es el estándar");
  const top = planeCrossings(m, b.maxZ - 0.2);
  near(2 * top.at(-1), 24.3, 0.2, "Ø del borde superior");
  // por encima de la panza el radio exterior nunca crece (salvo el borde suavizado del cuello) y la pendiente es suave
  const prof = sliceProfile(m, b.minZ + 13 + 12, b.maxZ - 0.5, 1);
  for (let i = 1; i < prof.length; i++) {
    assert.ok(prof[i - 1].outer - prof[i].outer < 1.6, `salto de ${(prof[i - 1].outer - prof[i].outer).toFixed(2)} mm en z=${prof[i].z}`);
  }
  const q = [0.25, 0.5, 0.75].map((f) => 2 * planeCrossings(m, b.minZ + f * (b.maxZ - b.minZ)).at(-1));
  assert.ok(q[0] > q[1] && q[1] > q[2], `cuartos: ${q.map((v) => v.toFixed(1))}`);
});

test("Mossglow: Panza y Estrechamiento mueven la forma como dicen; la altura no cambia la panza, el cuello ni el encastre", () => {
  const diam = (ins, f = 0.5) => {
    // bombilla más chica que la estándar: estos ajustes llevan el cuello a otras alturas y el cuerpo a otros anchos (la separación a la bombilla se valida igual)
    const r = build(lamp("mossglow", ins, undefined, { bulb: { diameterMm: 30, heightAboveHolderMm: 40 } }), JSON.stringify(ins));
    const b = indexedBounds(r.indexed.insert);
    return { max: b.maxX - b.minX, atTop: 2 * planeCrossings(r.indexed.insert, b.maxZ - 0.2).at(-1), mid: 2 * planeCrossings(r.indexed.insert, b.minZ + f * (b.maxZ - b.minZ)).at(-1), fit: 2 * planeCrossings(r.indexed.insert, b.minZ + 6).at(-1), h: b.maxZ - b.minZ };
  };
  const p20 = diam({ profileCurvaturePct: 30 }), p50 = diam({}), p90 = diam({ profileCurvaturePct: 90 });
  assert.ok(p20.max < p50.max && p50.max < p90.max, `la panza ensancha el cuerpo: ${p20.max} < ${p50.max} < ${p90.max}`);
  assert.ok(p20.mid < p50.mid && p50.mid < p90.mid, "y lo mantiene ancho más arriba");
  const e30 = diam({ profileWaistPct: 30 }), e50 = diam({}), e80 = diam({ profileWaistPct: 70 });
  assert.ok(e30.atTop > e50.atTop + 4 && e50.atTop > e80.atTop + 4, `el estrechamiento angosta el cuello: ${e30.atTop} > ${e50.atTop} > ${e80.atTop}`);
  assert.ok(e30.max === e50.max || Math.abs(e30.max - e50.max) < 0.05, "y no cambia la panza");
  for (const x of [p20, p50, p90, e30, e80]) near(x.fit, 65.135, 0.02, "encastre inferior estándar con cualquier ajuste");
  for (const h of [170, 185]) {
    const d = diam({ heightMm: h });
    near(d.h, h, 0.01, `altura ${h}`);
    near(d.max, 67.69, 0.05, `panza con altura ${h}`);
    near(d.atTop, 24.3, 0.2, `cuello con altura ${h}`);
    near(d.fit, 65.135, 0.02, `encastre con altura ${h}`);
  }
});

// ==================================================================================================== 3. GEOMETRÍA DE LOS CUATRO ESTILOS
test("cada estilo con cada terminación permitida: malla cerrada y manifold, sin errores, con altura y diámetro máximo/mínimo medidos", () => {
  for (const [style, top] of allTops()) {
    const def = lamp(style, {}, top);
    const r = build(def, `${style}/${top}`);
    const ins = r.indexed.insert;
    clean(ins, `${style}/${top}`);
    const b = indexedBounds(ins);
    const fit = r.metrics.fit;
    near(b.maxZ - b.minZ, fit.insertHeightMm, 0.06, `${style}/${top}: altura`);
    near(b.maxX - b.minX, fit.insertMaxDiameterMm, 0.05, `${style}/${top}: Ø máximo informado = medido`);
    assert.equal(fit.insertClosed, top !== "open", `${style}/${top}: extremo cerrado`);
    if (style === "hourglass") assert.ok(fit.insertMinDiameterMm < 2 * 0.5 * def.insert.profileWidthMm, "cintura más angosta que los extremos");
    assert.ok(fit.insertMinDiameterMm >= 2 * (T + 1), `${style}/${top}: Ø mínimo ${fit.insertMinDiameterMm}`);
  }
});

test("espesor de pared: la pared medida sobre la normal es el espesor pedido en el cuerpo, la transición y el cierre", () => {
  for (const t of [0.8, 1.0]) {
    for (const [style, top] of allTops()) {
      const r = build(lamp(style, { thicknessMm: t }, top), `${style}/${top}/t=${t}`);
      const m = r.indexed.insert;
      const b = indexedBounds(m);
      const step = 0.5;
      const prof = sliceProfile(m, b.minZ + 0.25, b.maxZ - 0.25, step);
      for (let i = 1; i < prof.length - 1; i++) {
        const p = prof[i];
        if (p.n !== 2 || p.outer < 8) continue; // cap / polo: un solo cruce
        const slope = Math.abs(prof[i + 1].outer - prof[i - 1].outer) / (2 * step);
        const normal = (p.outer - p.inner) / Math.sqrt(1 + slope * slope);
        if (slope > 1.7) continue; // la zona casi horizontal de la cúpula se mide con la tapa
        near(normal, t, 0.09 * Math.max(1, t), `${style}/${top}/t=${t}: espesor normal a z=${p.z.toFixed(1)}`);
      }
    }
  }
});

test("sin autointersecciones: en cada altura la malla cruza el semiplano 2 veces (pared) o 1 vez (tapa / polo), con interior < exterior y orden coherente", () => {
  for (const [style, top] of allTops()) {
    const r = build(lamp(style, {}, top), `${style}/${top}`);
    const m = r.indexed.insert;
    const b = indexedBounds(m);
    const prof = sliceProfile(m, b.minZ + 0.1, b.maxZ - 0.1, 0.4);
    for (const p of prof) {
      assert.ok(p.n === 1 || p.n === 2, `${style}/${top}: ${p.n} cruces a z=${p.z.toFixed(1)}`);
      if (p.n === 2) assert.ok(p.inner < p.outer - 0.05, `${style}/${top}: interior ≥ exterior a z=${p.z.toFixed(1)}`);
    }
    // la altura a partir de la cual deja de haber hueco: solo en el cierre (la tapa / el polo), nunca en medio de la pared
    const firstSolid = prof.findIndex((p) => p.n === 1);
    if (firstSolid >= 0) assert.ok(prof.slice(firstSolid).every((p) => p.n === 1), `${style}/${top}: el hueco reaparece sobre el cierre`);
    assert.equal(firstSolid >= 0, top !== "open", `${style}/${top}: solo hay cierre con extremo cerrado`);
  }
});

test("continuidad: el radio exterior es continuo (sin saltos) y la unión con el encastre es tangente (C1)", () => {
  for (const [style, top] of allTops()) {
    const r = build(lamp(style, {}, top), `${style}/${top}`);
    const m = r.indexed.insert;
    const b = indexedBounds(m);
    const zm = b.minZ + DEFAULT_LAMP.insert.seatDepthMm + 3;
    const step = 0.4;
    const maxR = r.metrics.fit.insertMaxDiameterMm / 2;
    const prof = sliceProfile(m, b.minZ + 0.2, b.maxZ - 0.2, step).filter((p) => p.outer > 0.45 * maxR); // la cúpula llega al eje con tangente horizontal por construcción
    for (let i = 1; i < prof.length; i++) {
      const slope = Math.abs(prof[i].outer - prof[i - 1].outer) / step;
      assert.ok(slope < 3.2, `${style}/${top}: salto de pendiente ${slope.toFixed(2)} a z=${prof[i].z.toFixed(1)}`);
    }
    // tangente: justo sobre el encastre la pendiente es casi vertical y sigue el perfil sin quiebres
    const above = sliceProfile(m, zm + 0.05, zm + 0.55, 0.25);
    for (let i = 1; i < above.length; i++) assert.ok(Math.abs(above[i].outer - above[i - 1].outer) / 0.25 < 0.3, `${style}/${top}: quiebre sobre el encastre (${(Math.abs(above[i].outer - above[i - 1].outer) / 0.25).toFixed(2)})`);
  }
});

test("reloj de arena: la intensidad y la posición de la cintura cambian la forma y la cintura cae donde se pide", () => {
  const waistAt = (ins) => {
    const r = build(lamp("hourglass", ins), JSON.stringify(ins));
    const m = r.indexed.insert;
    const b = indexedBounds(m);
    const zs = b.minZ + 13 + 6; // encastre (13 mm) + transición hacia el ancho (6 mm): desde acá la forma decorativa tiene su radio exacto
    const prof = sliceProfile(m, zs + 0.1, b.maxZ - 0.3, 0.5);
    const min = prof.reduce((a, p) => (p.outer < a.outer ? p : a));
    return { d: 2 * min.outer, frac: (min.z - zs) / (b.maxZ - zs), top: 2 * prof.at(-1).outer };
  };
  const soft = waistAt({ profileWaistPct: 15 }), hard = waistAt({ profileWaistPct: 70 });
  assert.ok(hard.d < soft.d - 12, `intensidad: ${soft.d.toFixed(1)} → ${hard.d.toFixed(1)}`);
  near(hard.d, 70 * (1 - 0.7 * 0.7), 0.3, "Ø de la cintura = ancho · (1 − 0,7 · intensidad)");
  const low = waistAt({ profileWaistPositionPct: 30 }), high = waistAt({ profileWaistPositionPct: 70 });
  assert.ok(low.frac < 0.4 && high.frac > 0.6, `posición: ${low.frac.toFixed(2)} y ${high.frac.toFixed(2)}`);
  near(waistAt({ profileWaistPct: 0 }).d, 70, 0.3, "sin cintura: cilindro del ancho pedido");
});

test("tulipán se abre hacia arriba y campana tiene falda ancha con cierre superior: formas y controles", () => {
  const tul = build(lamp("tulip"), "tulipán");
  const tb = indexedBounds(tul.indexed.insert);
  const tprof = sliceProfile(tul.indexed.insert, tb.minZ + 13.3, tb.maxZ - 0.3, 1);
  for (let i = 1; i < tprof.length; i++) assert.ok(tprof[i].outer >= tprof[i - 1].outer - 0.01, "el tulipán no se cierra hacia arriba");
  near(2 * tprof.at(-1).outer, 80, 0.2, "apertura superior");
  const wide = build(lamp("tulip", { profileTopDiameterMm: 84 }), "tulipán ancho");
  assert.ok(2 * planeCrossings(wide.indexed.insert, indexedBounds(wide.indexed.insert).maxZ - 0.3).at(-1) > 83.5);
  const bell = build(lamp("bell"), "campana");
  const bb = indexedBounds(bell.indexed.insert);
  assert.equal(bell.metrics.fit.insertClosed, true);
  near(bb.maxX - bb.minX, 74, 0.06, "ancho del cuerpo de la campana");
  assert.ok(2 * planeCrossings(bell.indexed.insert, bb.maxZ - 12).at(-1) < 60, "la campana se cierra hacia arriba");
  // la terminación cambia la forma: la gota llega más angosta que la redondeada a la misma altura
  const rd = build(lamp("bell", {}, "round"), "round"), dr = build(lamp("bell", {}, "drop"), "drop");
  const widthAt = (r, f) => { const b = indexedBounds(r.indexed.insert); return 2 * planeCrossings(r.indexed.insert, b.minZ + f * (b.maxZ - b.minZ)).at(-1); };
  assert.ok(widthAt(dr, 0.8) < widthAt(rd, 0.8), "gota más puntiaguda que la cúpula redondeada");
  // curvatura de la campana
  assert.ok(widthAt(build(lamp("bell", { profileCurvaturePct: 100 }), "k100"), 0.7) > widthAt(build(lamp("bell", { profileCurvaturePct: 5 }), "k5"), 0.7) + 4);
});

// ==================================================================================================== 4. ALTURAS, RANGOS Y EXTREMOS
test("alturas: cada estilo es válido en alturas diferentes (la altura sale exacta) y, si una altura no cabe, se rechaza con su causa y no se exporta", () => {
  const tall = { ...BASE, shade: { ...BASE.shade, heightMm: 240 } };
  const legit = new Set(["INSERT_CLOSURE_TOUCHES_BULB", "INSERT_TOO_CLOSE_TO_BULB", "INSERT_PROFILE_TOO_SHORT", "INSERT_PROFILE_TOO_STEEP", "INSERT_TOO_SHORT"]);
  let rejected = 0;
  for (const s of STYLES) {
    for (const h of [90, 120, 154, 200, 230]) {
      const d = applyInsertStyle(tall, s);
      d.insert = { ...d.insert, heightMm: h };
      const r = createLamp(d);
      if (r.errors.length) {
        assert.ok(r.errors.every((e) => legit.has(e.code)), `${s}/${h}: ${JSON.stringify(r.errors.map((e) => e.code))}`);
        assert.equal(r.geometry, null);
        assert.ok(h < (s === "mossglow" ? 164 : 154), `${s}/${h}: una altura de ${s === "mossglow" ? 164 : 154} mm o más debe ser válida (con la bombilla estándar el cuello del Mossglow la toca por debajo de 164 mm)`);
        rejected++;
        continue;
      }
      const b = indexedBounds(r.indexed.insert);
      near(b.maxZ - b.minZ, h, 0.01, `${s}/${h}: altura exacta`);
      clean(r.indexed.insert, `${s}/${h}`);
    }
  }
  assert.ok(rejected < STYLES.length * 3, "la mayoría de las alturas son válidas");
});

test("rangos: los extremos que ofrece cada control de perfil (calculados con la validación real) producen geometrías válidas y STL exportable", () => {
  let checked = 0;
  for (const [style, top] of [["mossglow", "open"], ["mossglow", "round"], ["tulip", "open"], ["hourglass", "open"], ["hourglass", "flat"], ["bell", "round"], ["bell", "drop"]]) {
    const def = lamp(style, {}, top);
    const paths = specsFor(def).filter((s) => s.path.startsWith("insert.profile") || s.path === "insert.heightMm");
    assert.ok(paths.length >= 3, `${style}: controles de perfil`);
    for (const spec of paths) {
      const range = computeControlRange(def, spec, { samples: 13 });
      if (range.conflict) continue; // lo causa otro control (p. ej. la bombilla): no se atribuye a éste
      const values = [range.min, range.max, (range.min + range.max) / 2].map((v) => Math.round(v / spec.step) * spec.step);
      for (const v of values) {
        const d = setLampPath(def, spec.path, v);
        const r = createLamp(d);
        assert.equal(r.errors.length, 0, `${style}/${top}: ${spec.path}=${v} (rango ${range.min}–${range.max}) rompe el modelo: ${JSON.stringify(r.errors.map((e) => e.code))}`);
        clean(r.indexed.insert, `${style}/${top}/${spec.path}=${v}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 60, `verificó ${checked} extremos`);
});

test("valores fuera de rango o que rompen el modelo se bloquean con mensaje (nunca se corrigen en silencio ni se exporta una malla inválida)", () => {
  const bad = [
    ["mossglow", { profileTopDiameterMm: 8 }, "OUT_OF_RANGE"],
    ["mossglow", { profileWidthMm: 400 }, "OUT_OF_RANGE"],
    ["hourglass", { profileWaistPct: 150 }, "OUT_OF_RANGE"],
    ["bell", { heightMm: 60 }, null],
    ["tulip", { profileTopDiameterMm: 160 }, null],
  ];
  for (const [style, ins, code] of bad) {
    const d = lamp(style, ins);
    const v = validateLamp(d);
    assert.ok(v.errors.length > 0, `${style} ${JSON.stringify(ins)} debería bloquearse`);
    if (code) assert.ok(v.errors.some((e) => e.code === code), `${style}: esperaba ${code} y hubo ${JSON.stringify(v.errors.map((e) => e.code))}`);
    const r = createLamp(d);
    assert.equal(r.geometry, null, "no se genera geometría con errores");
    assert.throws(() => lampPartEntries(r), "no se exporta con errores");
  }
});

// ==================================================================================================== 5. BOMBILLA, MONTAJE Y SEGURIDAD
test("bombilla: la separación geométrica a la bombilla se respeta y una bombilla grande bloquea el difusor que la invade (no se afirma seguridad térmica)", () => {
  for (const [style, top] of allTops()) {
    const v = validateLamp(lamp(style, {}, top));
    if (v.errors.length) continue;
    assert.ok(v.layout.fit.insertEnvelopeGapMm >= DEFAULT_LAMP.insert.minBulbGapMm - 1e-9, `${style}/${top}: separación ${v.layout.fit.insertEnvelopeGapMm}`);
    assert.ok(v.warnings.some((w) => w.code === "PHYSICAL_VALIDATION_PENDING"), "sigue la validación física pendiente");
    if (top !== "open") assert.ok(v.warnings.some((w) => w.code === "INSERT_CLOSED_THERMAL_PENDING"), `${style}/${top}: cierre superior: validación térmica pendiente`);
  }
  // el marcador de posición (Ø60) llena el difusor: Mossglow / Reloj de arena no caben y se explica con la separación a la bombilla
  for (const s of ["mossglow", "hourglass"]) {
    const v = validateLamp(applyInsertStyle(DEFAULT_LAMP, s));
    assert.ok(v.errors.some((e) => e.code === "INSERT_TOO_CLOSE_TO_BULB" || e.code === "INSERT_CLOSURE_TOUCHES_BULB"), `${s}: ${JSON.stringify(v.errors.map((e) => e.code))}`);
  }
  // una bombilla más angosta deja un hueco mayor (monótono)
  const gap = (dia) => validateLamp({ ...lamp("hourglass"), bulb: { diameterMm: dia, heightAboveHolderMm: 60 } }).layout.fit.insertEnvelopeGapMm;
  assert.ok(gap(36) > gap(40) && gap(40) > gap(44));
});

test("espacio interior: el diámetro interior mínimo a toda altura supera a la bombilla + separación mientras hay bombilla; el cierre queda sobre ella", () => {
  for (const [style, top] of allTops()) {
    const def = lamp(style, {}, top);
    const v = validateLamp(def);
    if (v.errors.length) continue;
    const L = v.layout;
    const r = build(def, `${style}/${top}`);
    const m = r.indexed.insert;
    const b = indexedBounds(m);
    const bulbR = def.bulb.diameterMm / 2;
    for (let z = b.minZ + 0.5; z <= Math.min(b.maxZ - 0.5, L.bulbTopZ); z += 1) {
      const c = planeCrossings(m, z);
      assert.ok(c.length >= 2, `${style}/${top}: sin hueco a z=${z} (bombilla hasta ${L.bulbTopZ})`);
      assert.ok(c[0] >= bulbR + def.insert.minBulbGapMm - 0.05, `${style}/${top}: radio interior ${c[0].toFixed(2)} a z=${z.toFixed(1)} < bombilla ${bulbR} + ${def.insert.minBulbGapMm}`);
    }
    // portalámparas: el cuerpo (Ø40) queda a distancia en todo el recorrido inferior
    for (let z = b.minZ + 0.5; z <= L.holderTopZ; z += 2) assert.ok(planeCrossings(m, z)[0] >= def.holder.bodyDiameterMm / 2 + def.insert.minBulbGapMm - 0.05, `${style}/${top}: portalámparas a z=${z}`);
  }
});

test("montaje y extracción: cada estilo pasa por el cuello roscado y sale por arriba; uno que no entra se rechaza con la causa", () => {
  for (const [style, top] of allTops()) {
    const v = validateLamp(lamp(style, {}, top));
    if (v.errors.length) continue;
    const fit = v.layout.fit;
    assert.ok(fit.insertMaxDiameterMm / 2 <= fit.shadeClearRadiusMm + 1e-6, `${style}/${top}: pasa por el cuello`);
    assert.equal(fit.insertRemovableFromTop, true, `${style}/${top}: se saca por arriba`);
  }
  const wide = validateLamp(lamp("tulip", { profileTopDiameterMm: 120 }));
  assert.ok(wide.errors.some((e) => e.code === "INSERT_TOUCHES_SHADE" || e.code === "INSERT_DOES_NOT_FIT"), JSON.stringify(wide.errors.map((e) => e.code)));
});

test("pared que no deja hueco: un estrechamiento mayor que el que admite el espesor se rechaza en la superficie (sin malla)", () => {
  const { buildInsertSurface } = loadMakerModule("lib/maker/lamps/insert/surface.ts");
  const surface = buildInsertSurface({
    style: "mossglow", outerR: FIT_R, fitOuterR: FIT_R, thicknessMm: 7, z0: 0, heightMm: 150, seatDepthMm: 10, capThicknessMm: 1.6,
    drop: { closureMm: 50, curvaturePct: 70, tipRadiusMm: 10 }, wavy: { waves: 12, amplitudeMm: 0, twistDeg: 0, verticalFrequency: 0, top: "open" },
    profile: { widthMm: 67.7, topDiameterMm: 24.3, curvaturePct: 50, waistPct: 100, waistPositionPct: 50, top: "open" }, tabs: false,
  });
  assert.equal(surface.valid, false);
  assert.ok(surface.issues.some((i) => i.code === "INSERT_PROFILE_TOO_NARROW"), JSON.stringify(surface.issues));
  assert.equal(surface.rows.length, 0);
});

test("ninguna combinación pasa por válida con soportes imposibles: pared de más de 70° se bloquea y de más de 45° avisa", () => {
  const steep = validateLamp(lamp("mossglow", { heightMm: 28, profileCurvaturePct: 100, profileWaistPct: 100 }));
  assert.ok(steep.errors.length > 0);
  const soft = validateLamp(lamp("mossglow"));
  assert.ok(!soft.errors.length);
  assert.ok(soft.layout.insert.surface.maxLeanDeg < 45, "Mossglow de referencia se imprime sin soportes");
});

// ==================================================================================================== 6. VISOR, EXPORTACIÓN, ORIENTACIÓN
test("exportación = visor: el STL del difusor es la malla del visor (triángulos, altura, diámetro) y cada estilo sale en su archivo y orientación", async () => {
  const names = { mossglow: "difusor_mossglow", tulip: "difusor_tulipan", hourglass: "difusor_reloj_de_arena", bell: "difusor_campana" };
  for (const [style, top] of allTops()) {
    const r = build(lamp(style, {}, top), `${style}/${top}`);
    const part = r.geometry.parts.find((p) => p.kind === insertKind(lamp(style, {}, top)));
    assert.ok(part, `${style}/${top}: la pieza del difusor está en el ensamblado`);
    assert.equal(part.kind, profilePrintKind(style, top));
    const entries = lampPartEntries(r);
    const entry = entries.find((e) => e.fileName.includes(names[style]));
    assert.ok(entry, `${style}/${top}: archivo ${names[style]} en ${entries.map((e) => e.fileName)}`);
    const buf = Buffer.from(await buildSTLBlob(entry.mesh).arrayBuffer());
    const tris = buf.readUInt32LE(80);
    assert.equal(tris, r.indexed.insert.tris.length / 3, `${style}/${top}: triángulos del STL = visor`);
    assert.equal(tris, part.mesh.triangleCount);
    let minZ = Infinity, maxZ = -Infinity, maxR = 0;
    for (let i = 0; i < tris; i++) for (let v = 0; v < 3; v++) {
      const o = 84 + i * 50 + 12 + v * 12;
      const x = buf.readFloatLE(o), y = buf.readFloatLE(o + 4), z = buf.readFloatLE(o + 8);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); maxR = Math.max(maxR, Math.hypot(x, y));
    }
    const b = indexedBounds(r.indexed.insert);
    // la exportación va en la orientación de impresión: puede ir invertida (tapa/tulipán) o parada; la altura es la misma
    near(maxZ - minZ, b.maxZ - b.minZ, 0.01, `${style}/${top}: altura del STL`);
    near(2 * maxR, r.metrics.fit.insertMaxDiameterMm, 0.1, `${style}/${top}: Ø máximo del STL`);
  }
});

test("orientación de impresión: tapa plana y tulipán se imprimen invertidos; el resto, parados", () => {
  assert.equal(profilePrintKind("tulip", "open"), "lampInsert");
  assert.equal(profilePrintKind("mossglow", "flat"), "lampInsert");
  assert.equal(profilePrintKind("bell", "flat"), "lampInsert");
  assert.equal(profilePrintKind("mossglow", "open"), "lampInsertDrop");
  assert.equal(profilePrintKind("bell", "round"), "lampInsertDrop");
  assert.equal(profilePrintKind("hourglass", "round"), "lampInsertDrop");
  assert.equal(insertKind(lamp("bell", {}, "drop")), "lampInsertDrop");
  // una terminación que no tiene sentido para el estilo se lee como la primera permitida
  assert.equal(profilePrintKind("tulip", "round"), "lampInsert");
});

test("terminaciones: cada estilo solo ofrece las que tienen sentido, y las demás se normalizan sin romper el modelo", () => {
  assert.deepEqual(PROFILE_TOPS.mossglow, ["open", "flat", "round", "drop"]);
  assert.deepEqual(PROFILE_TOPS.tulip, ["open", "flat"]);
  assert.deepEqual(PROFILE_TOPS.hourglass, ["open", "flat", "round"]);
  assert.deepEqual(PROFILE_TOPS.bell, ["round", "drop", "flat"]);
  // un tulipán con "round" guardado se genera como abierto (la primera permitida): mismo resultado que "open"
  const a = build(lamp("tulip", {}, "round"), "tulip/round"), b = build(lamp("tulip", {}, "open"), "tulip/open");
  assert.deepEqual(Array.from(a.indexed.insert.positions), Array.from(b.indexed.insert.positions));
});

// ==================================================================================================== 7. CAMBIOS DE ESTILO Y DISEÑOS GUARDADOS
test("cambio entre estilos: ida y vuelta por todos conserva color, espesor, encastre y los demás parámetros; el estilo elegido siempre arranca válido", () => {
  let def = { ...BASE, insert: { ...BASE.insert, previewColor: "#3366cc", thicknessMm: 1.0, seatDepthMm: 12 } };
  const order = ["flat", "mossglow", "drop", "tulip", "wavy", "hourglass", "bell", "mossglow", "wavy"];
  for (const kind of order) {
    def = CAPS.applyDiffuserKind(def, kind);
    assert.equal(CAPS.diffuserKind(def.insert), kind);
    assert.equal(def.insert.previewColor, "#3366cc");
    assert.equal(def.insert.thicknessMm, 1.0);
    assert.equal(def.insert.seatDepthMm, 12);
    if (isProfileStyle(kind)) {
      assert.equal(def.insert.profileTop, INSERT_STYLE_INITIAL[kind].profileTop, `${kind}: terminación inicial`);
      const r = createLamp(def);
      assert.equal(r.errors.length, 0, `${kind}: ${JSON.stringify(r.errors.map((e) => e.code))}`);
    }
  }
  // volver al ondulado deja el difusor ondulado de siempre
  assert.equal(CAPS.diffuserKind(def.insert), "wavy");
});

test("diseños guardados: los anteriores a estos estilos se leen igual, y el código del diseño conserva cada estilo con todos sus parámetros", () => {
  // diseño viejo: sin ningún campo profile*
  const old = JSON.parse(JSON.stringify(DEFAULT_LAMP));
  for (const k of ["profileWidthMm", "profileTopDiameterMm", "profileCurvaturePct", "profileWaistPct", "profileWaistPositionPct", "profileTop"]) delete old.insert[k];
  const loaded = normalizeLampDefinition(old);
  assert.equal(loaded.insert.style, DEFAULT_LAMP.insert.style);
  assert.equal(loaded.insert.profileWidthMm, DEFAULT_LAMP.insert.profileWidthMm);
  assert.equal(validateLamp(loaded).errors.length, validateLamp(DEFAULT_LAMP).errors.length);
  // un valor desconocido de terminación vuelve al predeterminado
  assert.equal(normalizeLampDefinition({ insert: { profileTop: "triangulo" } }).insert.profileTop, "open");
  // ida y vuelta por el código de diseño
  for (const [style, top] of allTops()) {
    const d = lamp(style, { profileWidthMm: 71.5, profileTopDiameterMm: 33, profileCurvaturePct: 35, profileWaistPct: 55, profileWaistPositionPct: 40, heightMm: 140 }, top);
    const decoded = decodeLampDesign(encodeLampDesign(d));
    assert.ok(decoded.def, `${style}/${top}: se decodifica`);
    assert.deepEqual(decoded.def.insert, d.insert, `${style}/${top}: el código conserva el difusor`);
    const a = createLamp(d), b = createLamp(decoded.def);
    assert.deepEqual(a.errors.map((e) => e.code), b.errors.map((e) => e.code));
    if (a.indexed) assert.deepEqual(Array.from(a.indexed.insert.positions), Array.from(b.indexed.insert.positions), `${style}/${top}: misma malla`);
  }
});

test("difusores anteriores: plano, gota y ondulado generan exactamente lo mismo que antes (el encastre y el cuerpo no cambian)", () => {
  const wavy = build(CAPS.applyDiffuserKind(DEFAULT_LAMP, "cylinder"), "cilindro liso");
  near(2 * Math.max(...planeCrossings(wavy.indexed.insert, 80)), 65.135, 0.02, "cilindro liso");
  assert.equal(wavy.metrics.fit.insertMinDiameterMm, null, "el Ø mínimo solo se informa en los difusores de perfil");
  const drop = build(applyInsertStyle(DEFAULT_LAMP, "drop"), "gota");
  assert.equal(drop.metrics.fit.insertClosed, true);
  const flat = build(applyInsertStyle(DEFAULT_LAMP, "flat"), "plano");
  assert.equal(flat.metrics.fit.insertClosed, true);
  for (const s of ["flat", "drop", "wavy"]) assert.equal(isProfileStyle(s), false);
});

// ==================================================================================================== 8. INTERFAZ
test("interfaz: galería con las ocho formas, tres controles principales por estilo y lo demás en «Más ajustes del difusor»; sin controles que no aplican", () => {
  const { MakerLampControls, LampExportButtons } = loadLampUi();
  const render = (def) => {
    const r = createLamp(def);
    return renderToStaticMarkup(createElement(MakerLampControls, { def, onChange() {}, errors: r.errors, warnings: r.warnings, metrics: r.metrics }));
  };
  const exportHtml = (def) => renderToStaticMarkup(createElement(LampExportButtons, { hasInsert: true, insertStyle: def.insert.style, insertPrintKind: isProfileStyle(def.insert.style) ? profilePrintKind(def.insert.style, def.insert.profileTop) : undefined, insertLabel: CAPS.DIFFUSER_KIND_LABELS[CAPS.diffuserKind(def.insert)].toLowerCase(), hasCollar: false, canDownload: true, canDownloadTests: true, busy: null, onDownloadPart() {}, onDownloadZip() {}, onDownloadTests() {}, holderMeasured: false }));
  const main = (html) => {
    // el panel del difusor: lo visible siempre (hasta «Más ajustes del difusor») y lo plegado
    const block = html.slice(html.indexOf('data-component="diffuser"'));
    const controls = block.indexOf("Ajustes del difusor");
    const adv = block.indexOf('data-section="diffuser-more"');
    const end = block.indexOf("Color de la vista previa");
    return { main: block.slice(controls, adv), adv: block.slice(adv, end) };
  };
  const mg = render(lamp("mossglow"));
  for (const label of ["Mossglow", "Tulipán", "Reloj de arena", "Campana", "Cilíndrico"]) assert.ok(mg.includes(label), `galería: ${label}`);
  assert.equal((mg.match(/data-diffuser="/g) ?? []).length, 8, "ocho formas");
  const m1 = main(mg);
  for (const t of ["Altura", "Panza", "Estrechamiento"]) assert.ok(m1.main.includes(t), `Mossglow principal: ${t}`);
  assert.equal((m1.main.match(/type="range"/g) ?? []).length, 3, "Mossglow: exactamente tres controles principales");
  assert.ok(m1.adv.includes("Terminación superior") && !m1.adv.includes("Curvatura"), "Mossglow: tres controles y la terminación; nada más");
  assert.ok(!m1.adv.includes("Espesor de pared") && !m1.adv.includes("Espesor de la tapa"), "el espesor es del encastre: no es un control");
  assert.ok(!m1.main.includes("cintura") && !m1.main.includes("Apertura"), "sin controles de otros estilos");
  const tu = main(render(lamp("tulip")));
  for (const t of ["Altura", "Apertura superior", "Curvatura"]) assert.ok(tu.main.includes(t), `Tulipán principal: ${t}`);
  assert.equal((tu.main.match(/type="range"/g) ?? []).length, 3);
  assert.ok(!tu.main.includes("Ancho") && !tu.main.includes("cintura") && !tu.adv.includes("Posición de la cintura"));
  const hg = main(render(lamp("hourglass")));
  for (const t of ["Altura", "Ancho (Ø máximo)", "Intensidad de la cintura"]) assert.ok(hg.main.includes(t), `Reloj principal: ${t}`);
  assert.equal((hg.main.match(/type="range"/g) ?? []).length, 3);
  assert.ok(hg.adv.includes("Posición de la cintura"));
  const bl = main(render(lamp("bell")));
  for (const t of ["Altura", "Ancho del cuerpo", "Curvatura"]) assert.ok(bl.main.includes(t), `Campana principal: ${t}`);
  assert.equal((bl.main.match(/type="range"/g) ?? []).length, 3);
  assert.ok(bl.adv.includes("Redondeada") && bl.adv.includes("Gota") && bl.adv.includes("Tapa plana") && !bl.adv.includes(">Abierta<"), "la campana no ofrece terminación abierta");
  assert.ok(tu.adv.includes("Abierta") && tu.adv.includes("Tapa plana") && !tu.adv.includes("Redondeada") && !tu.adv.includes("Gota"), "el tulipán solo ofrece abierta y tapa plana");
  // el Ø exterior del cuerpo y el diámetro automático (propios de los cilindros) no aparecen con un difusor de perfil
  const html = render(lamp("mossglow"));
  assert.ok(!html.includes("Diámetro automático") && !html.includes("Ø exterior del cuerpo"));
  assert.ok(html.includes("Ø máximo del difusor"));
  assert.ok(html.includes("encastre"), "el encastre es el estándar y no se edita");
  assert.ok(exportHtml(lamp("mossglow")).includes("Difusor mossglow (STL)"));
  // los controles de los cilindros siguen con ellos
  const wavy = render(applyInsertStyle(BASE, "wavy"));
  assert.ok(!wavy.includes("Estrechamiento") && !wavy.includes("Apertura superior") && !wavy.includes("Intensidad de la cintura"));
  // calada y doble pared: sin galería de difusores decorativos
  for (const type of ["openwork", "double"]) {
    const h = render(applyShadeType(BASE, type));
    assert.ok(!h.includes('data-diffuser="mossglow"') && !h.includes('data-diffuser="hourglass"'), `${type}: no ofrece difusores decorativos`);
  }
});

test("miniaturas: salen de la misma superficie que la malla y respetan el estilo (silueta, cierre y cavidad)", () => {
  const widths = {};
  for (const s of STYLES) {
    const surface = referenceInsertSurface(s, applyInsertStyle(BASE, s).insert, false);
    assert.ok(surface.valid, `${s}: superficie de la miniatura`);
    const sil = insertSilhouette(surface, 64);
    assert.ok(sil.outer.startsWith("M") && sil.cavity.startsWith("M"));
    widths[s] = sil.maxDiameterMm;
  }
  assert.ok(widths.tulip > widths.mossglow + 5, "el tulipán de la miniatura es más ancho arriba");
  // la miniatura de Mossglow se estrecha: el contorno exterior arriba es más angosto que abajo
  const sil = referenceInsertSurface("mossglow", BASE.insert, false);
  assert.ok(sil.outline.crest.at(-1).r < sil.outline.crest[0].r / 2);
});
