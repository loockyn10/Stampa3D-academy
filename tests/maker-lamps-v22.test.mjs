import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";
import { loadTs } from "./helpers/load-ts.mjs";
import { loadLampUi } from "./helpers/lamp-editor-ui.mjs";

// Lámparas V2.2: reborde interno de adhesión y generador de insertos (plano, gota, ondulado).
// Todo se mide sobre las MALLAS generadas (las mismas que ve el visor y exporta el STL), no sobre los valores de configuración.
// Son pruebas GEOMÉTRICAS: no reemplazan imprimir en Bambu Studio, probar la adhesión real ni las pruebas térmicas.

const { DEFAULT_LAMP, applyInsertStyle, normalizeLampDefinition, INSERT_STYLE_INITIAL } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp, insertKind } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { LAMP_GEOMETRY } = loadMakerModule("lib/maker/lamps/types.ts");
const { analyzeMesh, indexedBounds } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { lampPartEntries, buildLampZipBlob, lampTestPieceEntries } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { createLampTestPieces } = loadMakerModule("lib/maker/lamps/parts/createTestPieces.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { PRINT_TRANSFORM_BY_KIND } = loadMakerModule("lib/maker/printOrientation.ts");
const { PART_ASSEMBLY_LAYER } = loadMakerModule("lib/maker/geometry/explodeOrder.ts");
const { createInsertComparison } = loadMakerModule("lib/maker/lamps/insert/compare.ts");
const { insertSilhouette, referenceInsertSurface } = loadMakerModule("lib/maker/lamps/insert/silhouette.ts");
const { encodeLampDesign, decodeLampDesign } = loadMakerModule("lib/maker/lamps/designCode.ts");

// ------------------------------------------------------------------ utilidades de medición sobre mallas
const withInsert = (patch, rest = {}) => ({ ...DEFAULT_LAMP, ...rest, insert: { ...DEFAULT_LAMP.insert, ...patch } });
const style = (name, patch = {}, rest = {}) => {
  const base = applyInsertStyle({ ...DEFAULT_LAMP, ...rest }, name);
  return { ...base, insert: { ...base.insert, ...patch } };
};
// Bombilla más baja: permite alturas de inserto cerrado variadas sin tocar la bombilla (la envolvente se modela como cilindro).
const LOW_BULB = { ...DEFAULT_LAMP.bulb, heightAboveHolderMm: 40 };
const build = (def) => {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `errores: ${JSON.stringify(r.errors.map((e) => e.code + " " + e.message))}`);
  return r;
};
const errorsOf = (def) => createLamp(def).errors.map((e) => e.code);

function* triangles(mesh) {
  const p = mesh.positions;
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const a = mesh.tris[i] * 3, b = mesh.tris[i + 1] * 3, c = mesh.tris[i + 2] * 3;
    yield [[p[a], p[a + 1], p[a + 2]], [p[b], p[b + 1], p[b + 2]], [p[c], p[c + 1], p[c + 2]]];
  }
}

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

/** Distancias t de los cruces de un rayo (origen o, dirección unitaria d) con la malla, ordenadas. */
function rayHits(mesh, o, d) {
  const hits = [];
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
    if (t > 1e-9) hits.push(t);
  }
  return hits.sort((x, y) => x - y);
}
const rayCrossings = (mesh, o, d) => rayHits(mesh, o, d).length;

/** Radios de cruce del plano y = cy (lado +X) a la altura z, ordenados (la última es la pared exterior). */
function planeCrossings(mesh, z, cy = 0.37) {
  const xs = [];
  const p = mesh.positions;
  for (let t = 0; t < mesh.tris.length; t += 3) {
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const a = mesh.tris[t + e] * 3, b = mesh.tris[t + ((e + 1) % 3)] * 3;
      const da = p[a + 1] - cy, db = p[b + 1] - cy;
      if (da * db < 0) { const u = da / (da - db); pts.push([p[a] + u * (p[b] - p[a]), p[a + 2] + u * (p[b + 2] - p[a + 2])]); }
    }
    if (pts.length === 2 && (pts[0][1] - z) * (pts[1][1] - z) < 0) { const u = (z - pts[0][1]) / (pts[1][1] - pts[0][1]); xs.push(pts[0][0] + u * (pts[1][0] - pts[0][0])); }
  }
  return xs.filter((x) => x > 0).sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 0.02);
}

/** ¿El punto está dentro del sólido? (paridad de cruces de un rayo con dirección irracional, para no pegar en aristas). */
const inside = (mesh, p) => rayCrossings(mesh, p, [0.5773502691896258, 0.5773502691896258 * 0.7071067811865476, Math.sqrt(1 - 0.3333333333333333 - 0.16666666666666666)]) % 2 === 1;

const nearZ = (mesh, z, tol = 1e-5) => {
  const out = [];
  for (let i = 0; i < mesh.positions.length; i += 3) if (Math.abs(mesh.positions[i + 2] - z) < tol) out.push([mesh.positions[i], mesh.positions[i + 1]]);
  return out;
};
const radiusOf = ([x, y]) => Math.hypot(x, y);

// ================================================================================================ A. REBORDE INTERNO DE ADHESIÓN

test("reborde interno: ancho 3 mm, altura 0,4 mm, en el plano de apoyo; el exterior de la pantalla no cambia", () => {
  const def = DEFAULT_LAMP;
  assert.deepEqual(def.adhesion, { enabled: true, widthMm: 3, heightMm: 0.4 });
  const r = build(def);
  const layout = validateLamp(def).layout;
  const spec = layout.spec;
  const shade = r.indexed.shade;
  const z0 = layout.ledgeZ;
  // posición: el reborde nace en el plano inferior de impresión (el tope de la base) y sube exactamente 0,4 mm
  assert.ok(Math.abs(indexedBounds(shade).minZ - z0) < 1e-9);
  const inner = (z) => planeCrossings(shade, z)[0];
  assert.ok(Math.abs(inner(z0 + 0.2) - (spec.boreR - 3)) < 0.03, `ancho: radio interior ${inner(z0 + 0.2)} vs ${spec.boreR - 3}`);
  assert.ok(Math.abs(inner(z0 + 0.39) - (spec.boreR - 3)) < 0.03);
  assert.ok(Math.abs(inner(z0 + 0.41) - spec.boreR) < 0.03, `sobre el reborde el orificio vuelve a boreR: ${inner(z0 + 0.41)}`);
  assert.ok(Math.abs(inner(z0 + 5) - spec.boreR) < 0.03);
  // las caras del reborde: vértices exactos en la altura 0,4 mm
  const topFace = nearZ(shade, z0 + 0.4).map(radiusOf);
  assert.ok(topFace.some((x) => Math.abs(x - spec.boreR) < 1e-6) && topFace.some((x) => Math.abs(x - (spec.boreR - 3)) < 1e-6));
  // el anillo plano inferior: del borde interior del reborde a la raíz de la rosca (no sobresale hacia el exterior)
  const bottom = nearZ(shade, z0).map(radiusOf);
  assert.ok(Math.min(...bottom) > spec.boreR - 3 - 1e-6 && Math.abs(Math.max(...bottom) - spec.rootR) < 1e-6);
  // exterior idéntico con y sin reborde, a todas las alturas
  const plain = build({ ...def, adhesion: { ...def.adhesion, enabled: false } }).indexed.shade;
  for (let z = z0 + 0.2; z < layout.shadeTopZ - 1; z += 7.3) {
    const a = planeCrossings(shade, z), b = planeCrossings(plain, z);
    assert.ok(Math.abs(a[a.length - 1] - b[b.length - 1]) < 1e-6, `exterior distinto a z=${z.toFixed(1)}`);
  }
  assert.ok(Math.abs(indexedBounds(shade).maxZ - indexedBounds(plain).maxZ) < 1e-9);
  assert.ok(Math.abs(indexedBounds(shade).maxX - indexedBounds(plain).maxX) < 1e-9, "no sobresale al exterior");
});

test("reborde interno: continuo, malla cerrada, no es un disco (la abertura queda libre) y suma superficie de apoyo", () => {
  const r = build(DEFAULT_LAMP);
  const shade = r.indexed.shade;
  assertClean(shade, "pantalla con reborde");
  assert.equal(components(shade), 1);
  // continuidad: el corte horizontal del reborde es un anillo completo (todas las columnas) con el radio interior constante
  const radii = nearZ(shade, validateLamp(DEFAULT_LAMP).layout.ledgeZ).map(radiusOf).filter((x) => x < 44);
  assert.ok(radii.length >= 144, `columnas del borde interior: ${radii.length}`);
  assert.ok(Math.max(...radii) - Math.min(...radii) < 1e-6, "borde interior circular y continuo");
  // no cierra la abertura: un rayo vertical por el eje atraviesa la pantalla sin tocarla, y por el hueco del reborde también
  assert.equal(rayCrossings(shade, [0, 0, -5], [0, 0, 1]), 0);
  const l = validateLamp(DEFAULT_LAMP).layout;
  assert.ok(l.adhesion.innerR > l.tower.towerR + LAMP_GEOMETRY.adhesionClearanceMm - 1e-9, "la abertura sigue siendo mayor que la torre");
  // superficie contra la cama: el apoyo con reborde es mayor (informe) y coincide con la malla (anillo plano en z = tope)
  const fit = r.metrics.fit.adhesion;
  assert.ok(fit.contactAreaMm2 > 1.8 * fit.contactAreaWithoutMm2 - 1, `${fit.contactAreaMm2} vs ${fit.contactAreaWithoutMm2}`);
  const rIn = l.adhesion.innerR, rOut = l.spec.rootR;
  assert.ok(Math.abs(fit.contactAreaMm2 - Math.PI * (rOut * rOut - rIn * rIn)) < 1);
});

test("reborde interno: no interfiere con la torre, el inserto (de los tres estilos), el portalámparas ni la base ensambladas", () => {
  for (const def of [DEFAULT_LAMP, style("flat"), style("drop"), style("wavy"), style("wavy", { wavyTop: "flat" })]) {
    const r = build(def);
    const layout = validateLamp(def).layout;
    const a = layout.adhesion;
    assert.ok(a.clearanceMm >= LAMP_GEOMETRY.adhesionClearanceMm - 1e-9, `holgura ${a.clearanceMm}`);
    assert.equal(r.metrics.fit.clearances.find((c) => c.id === "adhesionClearance").status, "ok");
    // puntos del volumen del reborde (en el borde interior, a media altura y en 24 ángulos): fuera de la base, del inserto y de la torre
    for (let k = 0; k < 24; k++) {
      const th = ((k + 0.37) * 2 * Math.PI) / 24;
      for (const rad of [a.innerR + 0.05, (a.innerR + a.outerR) / 2, a.outerR - 0.05]) {
        const p = [rad * Math.cos(th), rad * Math.sin(th), a.z0 + a.heightMm / 2];
        assert.equal(inside(r.indexed.base, p), false, `reborde dentro de la base (${th.toFixed(2)} rad)`);
        if (r.indexed.insert) assert.equal(inside(r.indexed.insert, p), false, "reborde dentro del inserto");
      }
    }
    // la torre y el inserto no cruzan el plano del reborde dentro de su anillo
    assert.ok(layout.tower.towerR < a.innerR - 0.9);
    if (layout.insert) assert.ok(layout.insert.z0 > a.z1, "el borde inferior del inserto queda sobre el reborde");
  }
  // el reborde queda en el orificio del cuello, arriba del tope de la base: no toca la rosca hembra (que está afuera de rootR)
  const l = validateLamp(DEFAULT_LAMP).layout;
  assert.ok(l.adhesion.outerR <= l.spec.boreR + 1e-9 && l.spec.boreR < l.spec.rootR);
});

test("reborde interno: compatibilidad con las roscas y la base (rosca y base idénticas con y sin reborde)", () => {
  const on = build(DEFAULT_LAMP);
  const off = build({ ...DEFAULT_LAMP, adhesion: { ...DEFAULT_LAMP.adhesion, enabled: false } });
  assert.deepEqual(on.metrics.fit.thread, off.metrics.fit.thread, "la interfaz roscada estandarizada no cambia");
  assert.equal(on.metrics.fit.baseHeightMm, off.metrics.fit.baseHeightMm);
  assert.deepEqual(Array.from(on.indexed.base.positions), Array.from(off.indexed.base.positions), "la base es la misma malla");
  assert.ok(on.geometry.parts[0].mesh === off.geometry.parts[0].mesh, "la base se reutiliza: ni siquiera se regenera");
  // el vacío de la rosca hembra y la rosca macho conservan su holgura radial: medida sobre las mallas, a la altura del primer filete
  const l = validateLamp(DEFAULT_LAMP).layout;
  const z = l.ledgeZ + 2.5;
  const male = planeCrossings(on.indexed.shade, z).at(-1);
  const femaleVoid = planeCrossings(on.indexed.base, z).filter((x) => x > l.spec.boreR + 1);
  assert.ok(femaleVoid.length > 0 && femaleVoid[0] - male >= l.spec.clearance - 0.35, `holgura radial ${femaleVoid[0] - male}`);
  // y el borde exterior de la pieza sigue siendo el de siempre
  const maleOff = planeCrossings(off.indexed.shade, z).at(-1);
  assert.ok(Math.abs(male - maleOff) < 1e-6);
  // el tope plano (anillo inferior) apoya en el escalón de la base: la cara inferior sigue en z = tope
  assert.ok(Math.abs(indexedBounds(on.indexed.shade).minZ - l.ledgeZ) < 1e-9);
});

test("reborde interno: si el ancho pedido interfiere se informa y se puede reducir o desactivar; nunca se achica en silencio", () => {
  const l = validateLamp(DEFAULT_LAMP).layout;
  const avail = l.adhesion.availableWidthMm;
  assert.ok(avail > 3, `ancho disponible ${avail}`);
  const just = createLamp({ ...DEFAULT_LAMP, adhesion: { ...DEFAULT_LAMP.adhesion, widthMm: Math.floor(avail * 10) / 10 } });
  assert.equal(just.errors.length, 0, "el máximo disponible entra");
  const over = createLamp({ ...DEFAULT_LAMP, adhesion: { ...DEFAULT_LAMP.adhesion, widthMm: avail + 0.5 } });
  const e = over.errors.find((x) => x.code === "ADHESION_INTERFERES");
  assert.ok(e && e.field === "adhesion.widthMm" && /torre central/.test(e.message) && /desactiv/i.test(e.message), JSON.stringify(over.errors));
  assert.equal(over.geometry, null, "no se genera una unión defectuosa");
  assert.equal(createLamp({ ...DEFAULT_LAMP, adhesion: { ...DEFAULT_LAMP.adhesion, widthMm: avail + 0.5, enabled: false } }).errors.length, 0, "desactivado no bloquea");
  // lo disponible sale de las geometrías ensambladas: la torre sigue al encastre ESTÁNDAR (no al ancho del cuerpo), así que un difusor de Ø70 no lo reduce; un plato más ancho (rosca con patas) sí
  const wide = validateLamp(withInsert({ diameterMm: 70 })).layout;
  assert.equal(wide.adhesion.availableWidthMm, avail, "la torre no crece con el difusor");
  assert.equal(wide.adhesion.widthMm, 3, "el ancho pedido no se cambió");
  const plate = validateLamp({ ...DEFAULT_LAMP, holder: { ...DEFAULT_LAMP.holder, mount: "threadV6" } }).layout;
  assert.ok(plate.adhesion.availableWidthMm < avail - 0.5, "el plato Ø78,82 deja menos lugar al reborde");
  // inserto que llega hasta el plano del reborde (ranura muy profunda) con ondas grandes: lo limita el inserto
  const deep = validateLamp(style("wavy", { amplitudeMm: 10, seatDepthMm: 14 })).layout;
  assert.equal(deep.adhesion.limitedBy, "insert");
  assert.ok(createLamp(style("wavy", { amplitudeMm: 10, seatDepthMm: 14 })).errors.some((x) => x.code === "ADHESION_INTERFERES" && /inserto/.test(x.message)));
  // límites propios del campo
  assert.ok(createLamp({ ...DEFAULT_LAMP, adhesion: { ...DEFAULT_LAMP.adhesion, widthMm: 0.2 } }).errors.some((x) => x.field === "adhesion.widthMm"));
  assert.ok(createLamp({ ...DEFAULT_LAMP, adhesion: { ...DEFAULT_LAMP.adhesion, heightMm: 3 } }).errors.some((x) => x.field === "adhesion.heightMm"));
});

test("reborde interno: parámetros avanzados (ancho y altura) cambian la geometría real; desactivado no hay reborde; no promete imprimir sin brim", () => {
  const l = validateLamp(DEFAULT_LAMP).layout;
  for (const [w, h] of [[2, 0.2], [4, 0.6], [5, 1.0]]) {
    const def = { ...DEFAULT_LAMP, adhesion: { enabled: true, widthMm: w, heightMm: h } };
    const shade = build(def).indexed.shade;
    const z = l.ledgeZ;
    assert.ok(Math.abs(planeCrossings(shade, z + h / 2)[0] - (l.spec.boreR - w)) < 0.03, `ancho ${w}`);
    assert.ok(Math.abs(planeCrossings(shade, z + h + 0.05)[0] - l.spec.boreR) < 0.03, `altura ${h}`);
    assertClean(shade, `reborde ${w}x${h}`);
  }
  const off = build({ ...DEFAULT_LAMP, adhesion: { ...DEFAULT_LAMP.adhesion, enabled: false } });
  assert.ok(Math.abs(planeCrossings(off.indexed.shade, l.ledgeZ + 0.2)[0] - l.spec.boreR) < 0.03);
  assert.equal(off.metrics.fit.adhesion.enabled, false);
  assert.equal(off.warnings.some((w) => w.code === "ADHESION_UNVERIFIED"), false);
  const on = build(DEFAULT_LAMP);
  const w = on.warnings.find((x) => x.code === "ADHESION_UNVERIFIED");
  assert.ok(w && /NO garantiza/.test(w.message) && /brim/.test(w.message));
});

test("reborde interno en modo collar: lo lleva el collar (pieza roscada impresa de forma convencional) y la pantalla lisa queda sin reborde", () => {
  const def = { ...DEFAULT_LAMP, thread: { ...DEFAULT_LAMP.thread, connection: "collar" } };
  const r = build(def);
  const l = validateLamp(def).layout;
  const collar = r.indexed.collar;
  assert.ok(Math.abs(planeCrossings(collar, l.ledgeZ + 0.2)[0] - (l.spec.boreR - 3)) < 0.03);
  assert.ok(Math.abs(planeCrossings(collar, l.ledgeZ + 1)[0] - l.spec.boreR) < 0.03);
  assertClean(collar, "collar con reborde");
  // la pantalla lisa (modo vaso) no cambia con el reborde
  const off = build({ ...def, adhesion: { ...def.adhesion, enabled: false } });
  assert.deepEqual(Array.from(r.indexed.shade.positions), Array.from(off.indexed.shade.positions));
  assert.ok(r.metrics.shade.vase.ready, "el modo vaso de la pantalla lisa no se afecta");
});

test("pieza de prueba del reborde: el macho de prueba lleva el mismo reborde, apoya sobre la pieza del portalámparas sin tocarla y el LÉEME lo indica", () => {
  const l = validateLamp(DEFAULT_LAMP).layout;
  const pieces = createLampTestPieces(l);
  const male = pieces.threadMale;
  assertClean(male, "macho de prueba");
  const b = indexedBounds(male);
  assert.ok(Math.abs(b.minZ) < 1e-9, "apoyado en la cama");
  assert.ok(Math.abs(planeCrossings(male, 0.2)[0] - (l.spec.boreR - 3)) < 0.03, "mismo reborde que la pantalla");
  assert.ok(Math.abs(planeCrossings(male, 1)[0] - l.spec.boreR) < 0.03);
  // se apoya alrededor de la pieza del torre sin tocarla
  const holder = indexedBounds(pieces.holderFit);
  assert.ok(Math.max(holder.maxX, holder.maxY) + LAMP_GEOMETRY.adhesionClearanceMm <= l.spec.boreR - 3 + 1e-9);
  const noAdh = createLampTestPieces(validateLamp({ ...DEFAULT_LAMP, adhesion: { ...DEFAULT_LAMP.adhesion, enabled: false } }).layout).threadMale;
  assert.ok(Math.abs(planeCrossings(noAdh, 0.2)[0] - l.spec.boreR) < 0.03, "sin reborde la prueba también sale sin él");
});

// ================================================================================================ B. INSERTO PLANO

test("inserto plano: tapa superior plana a 90° con el espesor pedido, extremo inferior abierto, pared de espesor constante", () => {
  const def = style("flat", { heightMm: 140, capThicknessMm: 2 }, { bulb: LOW_BULB });
  const r = build(def);
  const ins = r.indexed.insert;
  const fit = r.metrics.fit;
  const b = indexedBounds(ins);
  assertClean(ins, "inserto plano");
  assert.equal(components(ins), 1);
  assert.ok(Math.abs(b.maxZ - b.minZ - 140) < 1e-6, "altura total exacta");
  // tapa: un rayo vertical por el eje y por varios radios cruza exactamente dos veces (cara de abajo y de arriba), separadas por el espesor de la tapa
  for (const rad of [0, 8, 20, 30]) {
    const hits = rayHits(ins, [rad + 0.013, 0.021, b.minZ - 1], [0, 0, 1]);
    assert.equal(hits.length, 2, `tapa a r=${rad}`);
    assert.ok(Math.abs(hits[1] - hits[0] - 2) < 1e-6, `espesor de tapa ${hits[1] - hits[0]}`);
    assert.ok(Math.abs(b.minZ - 1 + hits[1] - b.maxZ) < 1e-6, "la cara superior de la tapa es el extremo del inserto");
  }
  // unión a 90°: la pared sube vertical (mismo radio) hasta el borde de la tapa y el borde de la tapa es el radio exterior
  const top = nearZ(ins, b.maxZ).map(radiusOf);
  assert.ok(Math.abs(Math.max(...top) - fit.insertOuterDiameterMm / 2) < 1e-6);
  for (const z of [b.maxZ - 0.05, b.maxZ - 1, b.maxZ - 1.99]) assert.ok(Math.abs(planeCrossings(ins, z).at(-1) - fit.insertOuterDiameterMm / 2) < 0.02, `cara exterior vertical a z=${z}`);
  assert.ok(Math.abs(planeCrossings(ins, b.maxZ - 2.05).at(-1) - fit.insertOuterDiameterMm / 2) < 0.02);
  assert.equal(planeCrossings(ins, b.maxZ - 1).length, 1, "en la tapa solo hay material continuo (sin cavidad)");
  assert.equal(planeCrossings(ins, b.maxZ - 2.5).length, 2, "bajo la tapa hay pared: cara interior y exterior");
  // extremo inferior abierto: el eje queda libre desde abajo hasta la cara inferior de la tapa y solo hay un anillo en el borde
  const axis = rayHits(ins, [0.013, 0.021, b.minZ - 1], [0, 0, 1]);
  assert.ok(Math.abs(b.minZ - 1 + axis[0] - (b.maxZ - 2)) < 1e-6, "la primera cara por el eje es la de abajo de la tapa");
  const ring = planeCrossings(ins, b.minZ + 0.05);
  assert.equal(ring.length, 2);
  assert.ok(Math.abs(ring[1] - ring[0] - def.insert.thicknessMm) < 0.02);
  // mismo radio interior/exterior a todas las alturas de la pared
  for (const z of [b.minZ + 3, b.minZ + 40, b.minZ + 100]) {
    const x = planeCrossings(ins, z);
    assert.ok(Math.abs(x[1] - fit.insertOuterDiameterMm / 2) < 0.02 && Math.abs(x[0] - fit.insertInnerDiameterMm / 2) < 0.02);
  }
  // sin lengüetas (cerrado) y marcado como pendiente de validación térmica
  assert.equal(fit.insertClosed, true);
  assert.equal(r.warnings.filter((w) => w.code === "INSERT_CLOSED_THERMAL_PENDING").length, 1);
  assert.match(r.warnings.find((w) => w.code === "INSERT_CLOSED_THERMAL_PENDING").message, /PENDIENTE DE VALIDACIÓN TÉRMICA/);
  assert.equal(r.metrics.insert.vaseCapable, false);
});

test("inserto plano: distintas alturas y espesores (de pared y de tapa) cambian la malla real; alturas que tocan la bombilla se bloquean", () => {
  const seen = new Set();
  for (const [h, t, tc] of [[110, 0.6, 1], [140, 0.8, 1.6], [175, 1, 3]]) {
    const def = style("flat", { heightMm: h, thicknessMm: t, capThicknessMm: tc }, { bulb: LOW_BULB });
    const r = build(def);
    const b = indexedBounds(r.indexed.insert);
    assert.ok(Math.abs(b.maxZ - b.minZ - h) < 1e-6, `altura ${h}`);
    const ring = planeCrossings(r.indexed.insert, b.minZ + 0.05);
    assert.ok(Math.abs(ring[1] - ring[0] - t) < 0.02, `espesor de pared ${t}`);
    const hits = rayHits(r.indexed.insert, [0.011, 0.017, b.minZ - 1], [0, 0, 1]);
    assert.ok(Math.abs(hits[1] - hits[0] - tc) < 1e-6, `espesor de tapa ${tc}`);
    seen.add(analyzeMesh(r.indexed.insert).volume.toFixed(0));
  }
  assert.equal(seen.size, 3, "cada combinación genera un volumen distinto");
  // con la bombilla alta (por defecto) un inserto bajo se bloquea con el motivo y las cifras (nunca se corrige solo)
  const low = createLamp(style("flat", { heightMm: 90 }));
  const e = low.errors.find((x) => x.code === "INSERT_CLOSURE_TOUCHES_BULB");
  assert.ok(e && /171,4/.test(e.message) && /Subí la altura/.test(e.message), JSON.stringify(low.errors));
  assert.equal(low.geometry, null);
  assert.ok(createLamp(style("flat", { capThicknessMm: 0.3 })).errors.some((x) => x.field === "insert.capThicknessMm"));
  // la altura automática del plano siempre deja la tapa sobre la bombilla + separación
  const auto = build(style("flat"));
  assert.ok(auto.metrics.fit.insertEnvelopeGapMm >= DEFAULT_LAMP.insert.minBulbGapMm);
});

test("inserto plano: la tapa y las paredes respetan la separación a la bombilla medida sobre la malla (nunca la tocan)", () => {
  const def = style("flat", { heightMm: 130, capThicknessMm: 1.6 }, { bulb: LOW_BULB });
  const r = build(def);
  const l = validateLamp(def).layout;
  const gapMin = def.insert.minBulbGapMm;
  // vértices interiores del inserto contra la envolvente cilíndrica de la bombilla (hasta bulbTopZ) y del portalámparas
  let worst = Infinity;
  const p = r.indexed.insert.positions;
  for (let i = 0; i < p.length; i += 3) {
    const rad = Math.hypot(p[i], p[i + 1]);
    const dBulb = Math.hypot(Math.max(0, rad - l.bulbR), Math.max(0, p[i + 2] - l.bulbTopZ));
    const dBody = Math.hypot(Math.max(0, rad - l.bodyR), Math.max(0, p[i + 2] - l.holderTopZ));
    // sólo vértices de la cara interior (los exteriores están más lejos del eje)
    if (rad < l.insert.outerR - def.insert.thicknessMm / 2 || p[i + 2] > l.insert.z1 - def.insert.capThicknessMm - 1e-6) worst = Math.min(worst, dBulb, dBody);
  }
  assert.ok(worst >= gapMin - 1e-6, `distancia mínima medida ${worst}`);
  assert.ok(Math.abs(worst - r.metrics.fit.insertEnvelopeGapMm) < 0.06);
  // el límite exacto: una tapa a 1 mm de la bombilla entra; un poco más abajo no
  const bulbTop = l.bulbTopZ;
  const okH = bulbTop + 1 + 1.6 + 0.2 - l.insert.z0;
  assert.equal(createLamp(style("flat", { heightMm: okH, capThicknessMm: 1.6 }, { bulb: LOW_BULB })).errors.length, 0);
  assert.ok(createLamp(style("flat", { heightMm: okH - 1, capThicknessMm: 1.6 }, { bulb: LOW_BULB })).errors.some((x) => x.code === "INSERT_CLOSURE_TOUCHES_BULB"));
});

test("inserto plano: orientación de impresión invertida (la tapa sobre la cama, el extremo abierto hacia arriba) y sin geometría interna que lo impida", () => {
  const r = build(style("flat"));
  const entry = lampPartEntries(r).find((e) => e.fileName === "lampara_inserto_plano.stl");
  assert.ok(entry);
  const p = entry.mesh.positions;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 2; i < p.length; i += 3) { minZ = Math.min(minZ, p[i]); maxZ = Math.max(maxZ, p[i]); }
  assert.ok(Math.abs(minZ) < 1e-4, "apoyado en la cama");
  // en la capa de la cama están el centro (eje) y el borde de la tapa: es un disco lleno
  const bed = [];
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2] - minZ) < 1e-4) bed.push(Math.hypot(p[i], p[i + 1]));
  assert.ok(Math.min(...bed) < 0.01 && Math.max(...bed) > 32, "la cara de la cama es el disco completo de la tapa");
  // el extremo abierto queda arriba: la capa más alta es el anillo de la pared (radio interior > 0)
  const topRing = [];
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2] - maxZ) < 1e-4) topRing.push(Math.hypot(p[i], p[i + 1]));
  assert.ok(Math.min(...topRing) > 30);
  // sin voladizos internos: el espesor de la pared es constante de la tapa al borde (la pared nace de la tapa a 90° y no tiene salientes)
  assert.equal(PRINT_TRANSFORM_BY_KIND.lampInsert.rotationYDeg, 180);
  assert.equal(PRINT_TRANSFORM_BY_KIND.lampInsertDrop.rotationYDeg, 0);
  assert.equal(r.geometry.parts.find((x) => x.filenameSuffix === "inserto_plano").kind, "lampInsert");
});

// ================================================================================================ C. INSERTO GOTA

test("inserto gota: cierre progresivo con punta redondeada, altura total y sección cilíndrica exactas, malla cerrada y continua", () => {
  const def = style("drop");
  const r = build(def);
  const l = validateLamp(def).layout;
  const ins = r.indexed.insert;
  const b = indexedBounds(ins);
  assertClean(ins, "inserto gota");
  assert.equal(components(ins), 1);
  const H = l.insert.heightMm;
  const closure = def.insert.dropClosureMm;
  assert.ok(Math.abs(b.maxZ - b.minZ - H) < 1e-6, "altura total");
  const zb = b.minZ + H - closure;
  const Ro = l.insert.outerR;
  // sección cilíndrica: radio constante hasta el arranque del cierre
  for (const z of [b.minZ + 2, b.minZ + 30, zb - 1]) assert.ok(Math.abs(planeCrossings(ins, z).at(-1) - Ro) < 0.02, `cilindro a z=${z.toFixed(1)}`);
  // cierre: el radio exterior decrece de forma monótona hasta cerrar en la punta
  let prev = Ro + 1e-3;
  for (let k = 1; k < 24; k++) {
    const z = zb + (closure * k) / 24.2;
    const rr = planeCrossings(ins, z).at(-1);
    assert.ok(rr < prev + 1e-6 && rr > 0, `radio exterior no decreciente en el cierre (k=${k}): ${rr}`);
    prev = rr;
  }
  // punta redondeada: arco de radio rho centrado en el eje (r² ≈ 2·rho·d − d² a d bajo el ápice)
  const rho = def.insert.dropTipRadiusMm;
  for (const d of [0.4, 1, 2]) {
    const rr = planeCrossings(ins, b.maxZ - d).at(-1);
    assert.ok(Math.abs(rr - Math.sqrt(2 * rho * d - d * d)) < 0.35, `punta a ${d} mm del ápice: ${rr} vs ${Math.sqrt(2 * rho * d - d * d)}`);
  }
  // el ápice es un único punto sobre el eje y no hay base maciza que cierre la abertura: el eje desde abajo solo choca con el cierre
  const axis = rayHits(ins, [0.004, 0.003, b.minZ - 1], [0, 0, 1]);
  assert.equal(axis.length, 2);
  assert.ok(Math.abs(b.minZ - 1 + axis[1] - b.maxZ) < 1e-3 && Math.abs(b.minZ - 1 + axis[0] - (b.maxZ - def.insert.thicknessMm)) < 1e-3, "espesor de la punta = espesor de pared");
  assert.equal(planeCrossings(ins, b.minZ + 0.05).length, 2, "abertura inferior libre: solo el anillo de la pared");
  assert.equal(r.metrics.fit.insertClosed, true);
  assert.equal(r.warnings.filter((w) => w.code === "INSERT_CLOSED_THERMAL_PENDING").length, 1);
});

test("inserto gota: altura total, cierre, curvatura y redondeo de la punta cambian la geometría real (no son tres tamaños predefinidos)", () => {
  const measure = (patch) => {
    const def = style("drop", patch, { bulb: LOW_BULB });
    const r = build(def);
    const b = indexedBounds(r.indexed.insert);
    const l = validateLamp(def).layout;
    const zb = b.maxZ - def.insert.dropClosureMm;
    return { r, b, def, l, zb, at: (frac) => planeCrossings(r.indexed.insert, zb + def.insert.dropClosureMm * frac).at(-1) };
  };
  // insertos bajos y altos (la altura automática sigue a la bombilla; la explícita lo fija)
  const heights = [140, 190].map((h) => measure({ heightMm: h, dropClosureMm: 40 }));
  assert.ok(Math.abs(heights[0].b.maxZ - heights[0].b.minZ - 140) < 1e-6 && Math.abs(heights[1].b.maxZ - heights[1].b.minZ - 190) < 1e-6);
  // cierres cortos y alargados: la sección cilíndrica es la diferencia
  const short = measure({ dropClosureMm: 30, heightMm: 170 }), long = measure({ dropClosureMm: 70, heightMm: 170 });
  assert.ok(Math.abs(short.zb - long.zb - 40) < 1e-6);
  assert.notEqual(short.at(0.3).toFixed(2), long.at(0.3).toFixed(2));
  // curvatura: 0 = cono, 100 = ojiva llena; más curvatura = más panza a media altura del cierre
  const radii = [0, 50, 100].map((k) => measure({ dropCurvaturePct: k }).at(0.5));
  assert.ok(radii[0] < radii[1] && radii[1] < radii[2], `panza creciente con la curvatura: ${radii}`);
  // cono recto con curvatura 0: radio lineal (±) entre dos puntos del cierre
  const cone = measure({ dropCurvaturePct: 0, dropTipRadiusMm: 3 });
  const a = cone.at(0.2), b = cone.at(0.4), c = cone.at(0.6);
  assert.ok(Math.abs((a - b) - (b - c)) < 0.35, `cono recto: ${a} ${b} ${c}`);
  // punta más redondeada vs más estilizada: cerca del ápice la punta redondeada es más ancha
  const blunt = measure({ dropTipRadiusMm: 14 }), sharp = measure({ dropTipRadiusMm: 4 });
  const near = (m) => planeCrossings(m.r.indexed.insert, m.b.maxZ - 3).at(-1);
  assert.ok(near(blunt) > near(sharp) + 1, `${near(blunt)} vs ${near(sharp)}`);
  // todas son mallas cerradas y la tangencia con el cilindro (curvatura 100) no deja escalón: el radio apenas cambia a ambos lados del arranque
  const tang = measure({ dropCurvaturePct: 100 });
  assert.ok(Math.abs(planeCrossings(tang.r.indexed.insert, tang.zb - 0.3).at(-1) - planeCrossings(tang.r.indexed.insert, tang.zb + 0.3).at(-1)) < 0.05, "empalme tangente con el cilindro");
  for (const m of [short, long, blunt, sharp, cone, tang, ...heights]) assertClean(m.r.indexed.insert, "gota");
});

test("inserto gota: espesor constante en todo el cierre (medido sobre la malla), sin zonas finas ni autointersecciones", () => {
  const def = style("drop", { thicknessMm: 1 });
  const r = build(def);
  const ins = r.indexed.insert;
  const surface = validateLamp(def).layout.insert.surface;
  assert.equal(surface.valid, true);
  // cada punto de la cara interior (en el plano y = 0) contra los triángulos de la piel EXTERIOR (los que lo tienen detrás): la distancia mínima es el espesor
  const innerPts = surface.outline.inner.filter((p) => p.r > 0.5);
  const worst = minWallDistance([...triangles(ins)], innerPts.filter((_, i) => i % Math.ceil(innerPts.length / 16) === 0).map((p) => [p.r, 0, p.z]), 1);
  assert.ok(worst > 0.93, "espesor mínimo medido " + worst.toFixed(3) + " (pedido 1)");
  assert.ok(worst < 1.25, "y no mucho más grueso: " + worst.toFixed(3));
  // el interior no se pliega: el perfil interior es monótono (radio no creciente, altura no decreciente)
  for (let i = 1; i < surface.outline.inner.length; i++) {
    assert.ok(surface.outline.inner[i].z >= surface.outline.inner[i - 1].z - 1e-7 && surface.outline.inner[i].r <= surface.outline.inner[i - 1].r + 1e-7);
  }
  assertClean(ins, "gota 1 mm");
});

test("inserto gota: combinaciones imposibles (punta más fina que el espesor, cierre corto, cilindro sin lugar para la ranura) se bloquean con el motivo", () => {
  const code = (patch) => errorsOf(style("drop", patch));
  assert.ok(code({ thicknessMm: 1.5, dropTipRadiusMm: 1.8 }).includes("INSERT_DROP_TIP_THIN"));
  assert.ok(code({ dropClosureMm: 12, dropTipRadiusMm: 10 }).includes("INSERT_DROP_CLOSURE_SHORT"));
  assert.ok(code({ dropTipRadiusMm: 30 }).some((c) => c === "INSERT_DROP_TIP_TOO_WIDE" || c === "INSERT_DROP_CLOSURE_SHORT"));
  assert.ok(code({ heightMm: 100, dropClosureMm: 95 }).some((c) => c === "INSERT_DROP_CYLINDER_SHORT" || c === "INSERT_CLOSURE_TOUCHES_BULB"));
  assert.ok(code({ heightMm: 150, dropClosureMm: 60 }).includes("INSERT_CLOSURE_TOUCHES_BULB"), "el cierre empieza dentro de la envolvente de la bombilla");
  // un cierre muy corto sobre un cilindro ancho es muy empinado: no imprimible
  const steep = createLamp(style("drop", { dropClosureMm: 18, dropTipRadiusMm: 5 }));
  assert.ok(steep.errors.length > 0 || steep.warnings.some((w) => w.code === "INSERT_DROP_STEEP"), "el cierre empinado se avisa o se bloquea");
});

test("inserto gota: se imprime parado con la abertura inferior sobre la cama (kind propio) y se exporta con ese nombre", () => {
  const r = build(style("drop"));
  const part = r.geometry.parts.find((p) => p.filenameSuffix === "inserto_gota");
  assert.equal(part.kind, "lampInsertDrop");
  assert.equal(PRINT_TRANSFORM_BY_KIND.lampInsertDrop.rotationYDeg, 0);
  assert.equal(PART_ASSEMBLY_LAYER.lampInsertDrop, PART_ASSEMBLY_LAYER.lampInsert);
  const entry = lampPartEntries(r).find((e) => e.fileName === "lampara_inserto_gota.stl");
  const p = entry.mesh.positions;
  let minZ = Infinity;
  for (let i = 2; i < p.length; i += 3) minZ = Math.min(minZ, p[i]);
  const bed = [];
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2] - minZ) < 1e-4) bed.push(Math.hypot(p[i], p[i + 1]));
  assert.ok(Math.min(...bed) > 30, "la cara sobre la cama es el anillo de la abertura (no hay disco)");
  assert.equal(insertKind(style("drop")), "lampInsertDrop");
  assert.equal(insertKind(style("flat")), "lampInsert");
});

// ================================================================================================ D. INSERTO ONDULADO

/** Radios de la piel exterior en un anillo de la malla (a la altura exacta de una fila), ordenados por ángulo. */
function outerRing(mesh, z) {
  // en cada columna hay un vértice exterior y uno interior a la misma altura: la piel exterior es el de mayor radio
  const byAngle = new Map();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (Math.abs(mesh.positions[i + 2] - z) > 1e-5) continue;
    const th = Math.atan2(mesh.positions[i + 1], mesh.positions[i]);
    const key = Math.round(th * 1e4);
    const rad = Math.hypot(mesh.positions[i], mesh.positions[i + 1]);
    if (!byAngle.has(key) || byAngle.get(key).r < rad) byAngle.set(key, { th, r: rad });
  }
  return [...byAngle.values()].sort((a, b) => a.th - b.th);
}
function rowZs(mesh) {
  const zs = new Set();
  for (let i = 2; i < mesh.positions.length; i += 3) zs.add(+mesh.positions[i].toFixed(5));
  return [...zs].sort((a, b) => a - b);
}

test("inserto ondulado: cantidad de ondas, amplitud (solo hacia afuera) y diámetro máximo sobre la malla", () => {
  for (const [n, A] of [[8, 1.5], [12, 2.5], [20, 3]]) {
    const def = style("wavy", { waves: n, amplitudeMm: A, twistDeg: 0, tabs: false });
    const r = build(def);
    const l = validateLamp(def).layout;
    const ins = r.indexed.insert;
    assertClean(ins, `ondulado ${n}`);
    const Ro = l.insert.outerR;
    const zs = rowZs(ins);
    const zMid = zs[Math.floor(zs.length * 0.6)];
    const ring = outerRing(ins, zMid);
    // la piel exterior oscila entre Ro y Ro + A (nunca por debajo del tubo liso)
    const rs = ring.map((x) => x.r);
    assert.ok(Math.abs(Math.max(...rs) - (Ro + A)) < 0.03, `cresta ${Math.max(...rs)} vs ${Ro + A}`);
    assert.ok(Math.abs(Math.min(...rs) - Ro) < 0.03, `valle ${Math.min(...rs)} vs ${Ro}`);
    // cantidad de crestas = ondas
    let peaks = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length].r, c = ring[i].r, d = ring[(i + 1) % ring.length].r;
      if (c > a && c >= d && c > Ro + 0.8 * A) peaks++;
    }
    assert.equal(peaks, n, `crestas ${peaks} vs ondas ${n}`);
    // diámetro máximo informado = el medido; el nominal de montaje no cambia
    assert.ok(Math.abs(r.metrics.fit.insertMaxDiameterMm - 2 * (Ro + A)) < 0.1);
    assert.equal(r.metrics.fit.insertOuterDiameterMm, 65.135);
    // el interior nunca se acerca más a la bombilla que el tubo liso (la onda solo suma afuera)
    const inner = [];
    for (let i = 0; i < ins.positions.length; i += 3) {
      const rad = Math.hypot(ins.positions[i], ins.positions[i + 1]);
      if (rad < Ro - 0.3) inner.push(rad);
    }
    assert.ok(Math.min(...inner) > l.insert.innerR - 0.2, `radio interior mínimo ${Math.min(...inner)} vs ${l.insert.innerR}`);
    assert.ok(r.metrics.fit.insertEnvelopeGapMm >= 1.7 - 0.2);
  }
  // amplitud 0 = cilindro liso: todas las columnas al mismo radio
  const smooth = build(style("wavy", { amplitudeMm: 0 }));
  assert.ok(Math.abs(smooth.metrics.fit.insertMaxDiameterMm - 65.135) < 1e-6);
});

test("inserto ondulado: torsión (las crestas giran con la altura) y frecuencia vertical (la amplitud respira a lo alto)", () => {
  const crestAngle = (mesh, z) => {
    const ring = outerRing(mesh, z);
    return ring.reduce((m, x) => (x.r > m.r ? x : m), ring[0]).th;
  };
  const def = style("wavy", { waves: 12, amplitudeMm: 3, twistDeg: 20, verticalFrequency: 0, tabs: false });
  const r = build(def);
  const l = validateLamp(def).layout;
  const surface = l.insert.surface;
  const Ro = l.insert.outerR;
  const zm = l.insert.z0 + def.insert.seatDepthMm + LAMP_GEOMETRY.insertMountExtraMm;
  const ztop = l.insert.z1;
  const zs = rowZs(r.indexed.insert).filter((z) => z > zm + LAMP_GEOMETRY.insertWaveRampMm && z < ztop - 0.1);
  const z1 = zs[Math.floor(zs.length * 0.2)], z2 = zs[Math.floor(zs.length * 0.9)];
  const du = (z2 - z1) / (ztop - zm);
  const expected = (20 * Math.PI / 180) * du; // giro de las crestas entre las dos alturas
  const period = (2 * Math.PI) / 12;
  let delta = crestAngle(r.indexed.insert, z2) - crestAngle(r.indexed.insert, z1);
  delta = ((delta + period / 2 + 10 * period) % period) - period / 2;
  assert.ok(Math.abs(delta - expected) < 0.04, `giro medido ${delta.toFixed(3)} vs esperado ${expected.toFixed(3)}`);
  // sin torsión las crestas no giran
  const straight = build(style("wavy", { waves: 12, amplitudeMm: 3, twistDeg: 0, tabs: false }));
  let d0 = crestAngle(straight.indexed.insert, z2) - crestAngle(straight.indexed.insert, z1);
  d0 = ((d0 + period / 2 + 10 * period) % period) - period / 2;
  assert.ok(Math.abs(d0) < 0.04, `sin torsión: ${d0}`);
  // frecuencia vertical: la cresta máxima varía con la altura (con 0 es constante)
  const crestR = (mesh, z) => Math.max(...outerRing(mesh, z).map((x) => x.r));
  const vf = build(style("wavy", { waves: 12, amplitudeMm: 4, twistDeg: 0, verticalFrequency: 2, tabs: false }));
  const flatAmp = build(style("wavy", { waves: 12, amplitudeMm: 4, twistDeg: 0, verticalFrequency: 0, tabs: false }));
  const zv = rowZs(vf.indexed.insert).filter((z) => z > zm + LAMP_GEOMETRY.insertWaveRampMm && z < ztop - 0.1);
  const crestsVf = zv.filter((_, i) => i % 6 === 0).map((z) => crestR(vf.indexed.insert, z));
  const crestsFlat = zv.filter((_, i) => i % 6 === 0).map((z) => crestR(flatAmp.indexed.insert, z));
  assert.ok(Math.max(...crestsVf) - Math.min(...crestsVf) > 1.5, "la amplitud varía con la altura");
  assert.ok(Math.max(...crestsFlat) - Math.min(...crestsFlat) < 0.05, "sin frecuencia vertical la amplitud es constante");
  assert.ok(Math.max(...crestsVf) <= Ro + 4 + 0.03, "la frecuencia vertical nunca supera la amplitud pedida");
  assert.ok(surface.valid);
});

test("inserto ondulado: espesor (medido sobre la malla 3D), zona de montaje idéntica y compatibilidad con el alojamiento de la base", () => {
  const def = style("wavy", { waves: 10, amplitudeMm: 2.5, twistDeg: 90, thicknessMm: 1, tabs: false });
  const r = build(def);
  const l = validateLamp(def).layout;
  const ins = r.indexed.insert;
  const p = ins.positions;
  // espesor 3D: de vértices interiores (lejos de los bordes) a los triángulos de la piel exterior
  const inner = [];
  for (let i = 0; i < p.length; i += 3) {
    const rad = Math.hypot(p[i], p[i + 1]);
    if (p[i + 2] > l.insert.z0 + 25 && p[i + 2] < l.insert.z1 - 4 && rad < l.insert.outerR - 0.3) inner.push([p[i], p[i + 1], p[i + 2]]);
  }
  const worst = minWallDistance([...triangles(ins)], inner.filter((_, i) => i % Math.ceil(inner.length / 40) === 0), 1);
  assert.ok(worst >= 1 * 0.93, "espesor mínimo 3D " + worst.toFixed(3) + " (pedido 1)");
  // zona de montaje: el tubo liso Ø65,135 (encastre de diffuser.stl) es idéntico en los tres estilos (misma ranura de la torre)
  const zMount = l.insert.z0 + 5;
  const mounts = ["flat", "drop", "wavy"].map((s) => {
    const rr = build(style(s, {}, { })).indexed.insert;
    const x = planeCrossings(rr, zMount);
    return x.map((v) => +v.toFixed(2)).join(",");
  });
  assert.equal(new Set(mounts).size, 1, `montaje distinto entre estilos: ${mounts}`);
  // el borde inferior apoya en el fondo de la ranura (igual en los tres) y los diámetros del montaje no cambian con las ondas
  for (const s of ["flat", "drop", "wavy"]) {
    const b = indexedBounds(build(style(s)).indexed.insert);
    assert.ok(Math.abs(b.minZ - l.tower.slot.bottomZ) < 1e-9, `${s}: apoyo en el fondo de la ranura`);
  }
  assert.ok(Math.abs(planeCrossings(ins, zMount).at(-1) - 32.5675) < 0.02);
  // el inserto no invade la torre: ningún punto del inserto dentro del sólido de la base (la ranura lo aloja con holgura)
  const sample = [];
  for (let i = 0; i < p.length; i += 3 * 97) sample.push([p[i], p[i + 1], p[i + 2]]);
  for (const pt of sample) assert.equal(inside(r.indexed.base, pt), false, "punto del inserto dentro de la base");
  // ni dentro de la pantalla
  for (const pt of sample) assert.equal(inside(r.indexed.shade, pt), false, "punto del inserto dentro de la pantalla");
  assert.equal(r.metrics.fit.clearances.every((c) => c.status !== "fail"), true);
});

test("inserto ondulado: combinaciones que interfieren o son imposibles se bloquean con el motivo (pantalla, crestas agudas, pared muy inclinada)", () => {
  // las ondas no pueden tocar la pantalla/cuello
  const touch = createLamp(style("wavy", { amplitudeMm: 12 }));
  assert.ok(touch.errors.some((e) => e.code === "INSERT_TOUCHES_SHADE" || e.code === "INSERT_DOES_NOT_FIT"), JSON.stringify(touch.errors.map((e) => e.code)));
  assert.equal(touch.geometry, null);
  // crestas más agudas que el espesor
  const sharp = createLamp(style("wavy", { amplitudeMm: 9, waves: 32, thicknessMm: 3 }));
  assert.ok(sharp.errors.some((e) => e.code === "INSERT_WAVE_CREST_SHARP"), JSON.stringify(sharp.errors.map((e) => e.code)));
  // pared demasiado inclinada por torsión fuerte
  const steep = createLamp(style("wavy", { amplitudeMm: 6, waves: 24, twistDeg: 720 }));
  assert.ok(steep.errors.some((e) => e.code === "INSERT_WAVE_TOO_STEEP") || steep.warnings.some((w) => w.code === "INSERT_WAVE_STEEP"));
  // espesor demasiado fino para la altura
  assert.ok(createLamp(style("wavy", { thicknessMm: 0.2 })).errors.some((e) => e.field === "insert.thicknessMm"));
  // fuera de rango
  assert.ok(createLamp(style("wavy", { waves: 1 })).errors.some((e) => e.field === "insert.waves"));
  assert.ok(createLamp(style("wavy", { amplitudeMm: 20 })).errors.some((e) => e.field === "insert.amplitudeMm"));
  // el inserto ondulado conserva la separación a la bombilla: la validación mide la malla del perfil, no el valor nominal
  const ok = build(style("wavy", { amplitudeMm: 3 }));
  assert.ok(ok.metrics.fit.insertEnvelopeGapMm >= DEFAULT_LAMP.insert.minBulbGapMm);
});

test("inserto ondulado: terminación superior abierta (con lengüetas opcionales) o con tapa plana, sobre el mismo motor", () => {
  const open = build(style("wavy", { wavyTop: "open", tabs: true }));
  const flat = build(style("wavy", { wavyTop: "flat", tabs: true, capThicknessMm: 1.6, heightMm: 190 }));
  const none = build(style("wavy", { wavyTop: "open", tabs: false }));
  const b = (r) => indexedBounds(r.indexed.insert);
  assertClean(open.indexed.insert, "abierto con lengüetas");
  assertClean(flat.indexed.insert, "con tapa plana");
  assertClean(none.indexed.insert, "abierto sin lengüetas");
  // lengüetas: sólo con extremo abierto (en el plano y=0 no hay; en +Y sí)
  assert.ok(Math.max(b(open).maxY, -b(open).minY) > 2.5 + 32.5675 + 5, "las lengüetas sobresalen en ±Y");
  assert.ok(Math.max(b(none).maxY, -b(none).minY) < 32.5675 + 2.5 + 0.2);
  assert.ok(Math.max(b(flat).maxY, -b(flat).minY) < 32.5675 + 2.5 + 0.2, "con tapa no hay lengüetas");
  assert.equal(open.metrics.fit.insertClosed, false);
  assert.equal(flat.metrics.fit.insertClosed, true);
  assert.equal(flat.warnings.some((w) => w.code === "INSERT_CLOSED_THERMAL_PENDING"), true);
  assert.equal(open.warnings.some((w) => w.code === "INSERT_CLOSED_THERMAL_PENDING"), false);
  // la tapa plana del ondulado: dos caras por el eje separadas por el espesor
  const hits = rayHits(flat.indexed.insert, [0.01, 0.02, b(flat).minZ - 1], [0, 0, 1]);
  assert.equal(hits.length, 2);
  assert.ok(Math.abs(hits[1] - hits[0] - 1.6) < 1e-6);
  // el motor es el mismo: el abierto sin ondas es el cilindro liso de la lámpara de referencia (Ø65,135 exterior, 0,8 de espesor)
  const smooth = build(style("wavy", { amplitudeMm: 0, tabs: false }));
  const x = planeCrossings(smooth.indexed.insert, b(smooth).minZ + 60);
  assert.ok(Math.abs(x[1] - 32.5675) < 0.02 && Math.abs(x[0] - 31.7675) < 0.02);
  assert.equal(smooth.metrics.insert.vaseCapable, true);
});

// ================================================================================================ E. ESTILOS, ENSAMBLAJE Y EXPORTACIÓN

test("estilos del inserto: parámetros iniciales propios, el color, el diámetro y el espesor se conservan y la pantalla exterior no cambia", () => {
  const base = { ...DEFAULT_LAMP, insert: { ...DEFAULT_LAMP.insert, previewColor: "#3b7be5", diameterMm: 66, thicknessMm: 1 }, shade: { ...DEFAULT_LAMP.shade, waves: 14, seed: 77 } };
  for (const s of ["flat", "drop", "wavy"]) {
    const next = applyInsertStyle(base, s);
    assert.equal(next.insert.style, s);
    assert.equal(next.insert.previewColor, "#3b7be5");
    assert.equal(next.insert.diameterMm, 66);
    assert.equal(next.insert.thicknessMm, 1);
    assert.deepEqual(next.shade, base.shade, "la pantalla exterior no cambia");
    assert.deepEqual(next.thread, base.thread);
    assert.deepEqual(next.adhesion, base.adhesion);
    for (const [k, v] of Object.entries(INSERT_STYLE_INITIAL[s])) assert.equal(next.insert[k], v, `${s}.${k}`);
  }
  assert.equal(applyInsertStyle(base, "flat").insert.tabs, false);
  assert.equal(applyInsertStyle(base, "wavy").insert.tabs, true);
  // cambiar de estilo no regenera la pantalla ni la base (cache por pieza)
  createLamp(base);
  const a = createLamp(applyInsertStyle(base, "flat")), b = createLamp(applyInsertStyle(base, "wavy"));
  assert.ok(a.geometry.parts.find((p) => p.kind === "body").mesh === b.geometry.parts.find((p) => p.kind === "body").mesh, "base reutilizada");
  assert.ok(a.geometry.parts.find((p) => p.kind === "lampShade").mesh === b.geometry.parts.find((p) => p.kind === "lampShade").mesh, "pantalla reutilizada");
});

test("ensamblaje: los tres estilos son compatibles con la base, la pantalla y el portalámparas (holguras, mallas cerradas y exportación STL = visor)", async () => {
  for (const s of ["flat", "drop", "wavy"]) {
    const def = style(s);
    const r = build(def);
    assert.ok(r.metrics.fit.clearances.every((c) => c.status !== "fail"), `${s}: ${JSON.stringify(r.metrics.fit.clearances.filter((c) => c.status === "fail"))}`);
    for (const k of ["base", "shade", "insert"]) assertClean(r.indexed[k], `${s}/${k}`);
    // las piezas exportadas son EXACTAMENTE las del visor: misma cantidad de triángulos y mismas dimensiones
    const entries = lampPartEntries(r);
    const insertEntry = entries.find((e) => e.fileName.includes("inserto"));
    assert.ok(insertEntry, s);
    const part = r.geometry.parts.find((p) => p.filenameSuffix.startsWith("inserto"));
    assert.equal(part.mesh.triangleCount, insertEntry.mesh.triangleCount);
    assert.equal(part.mesh.triangleCount, r.indexed.insert.tris.length / 3);
    const buf = Buffer.from(await buildSTLBlob(insertEntry.mesh).arrayBuffer());
    assert.equal(buf.readUInt32LE(80), part.mesh.triangleCount, `${s}: triángulos del STL`);
    // dimensiones reales conservadas (bounding box del STL vs malla del visor)
    const bb = indexedBoundsOf(r.indexed.insert);
    let minZ = Infinity, maxZ = -Infinity;
    for (let t = 0; t < part.mesh.triangleCount; t++) for (let v = 0; v < 3; v++) { const z = buf.readFloatLE(84 + t * 50 + 12 + v * 12 + 8); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    assert.ok(Math.abs(maxZ - minZ - (bb.maxZ - bb.minZ)) < 1e-3, `${s}: altura del STL`);
    // el ZIP del conjunto incluye únicamente el inserto del estilo elegido
    const zip = await JSZip.loadAsync(await buildLampZipBlob(r, def));
    const names = Object.keys(zip.files).filter((n) => n.includes("inserto"));
    assert.deepEqual(names, [`lampara_inserto_${{ flat: "plano", drop: "gota", wavy: "ondulado" }[s]}.stl`]);
    assert.equal(Object.keys(zip.files).filter((n) => /inserto_(plano|gota|ondulado)/.test(n)).length, 1);
  }
  // sin inserto: ningún archivo de inserto
  const none = build({ ...DEFAULT_LAMP, insert: { ...DEFAULT_LAMP.insert, enabled: false } });
  assert.equal(lampPartEntries(none).some((e) => e.fileName.includes("inserto")), false);
});
const indexedBoundsOf = (m) => indexedBounds(m);

test("exportación individual: pantalla, inserto de cada estilo, base y las piezas de prueba, con orientaciones de impresión coherentes", () => {
  const names = [];
  for (const s of ["flat", "drop", "wavy"]) {
    const r = build(style(s));
    const entries = lampPartEntries(r);
    names.push(...entries.map((e) => e.fileName));
    assert.ok(entries.some((e) => e.fileName === "lampara_pantalla.stl") && entries.some((e) => e.fileName.startsWith("lampara_base")));
  }
  assert.deepEqual([...new Set(names)].filter((n) => n.includes("inserto")).sort(), ["lampara_inserto_gota.stl", "lampara_inserto_ondulado.stl", "lampara_inserto_plano.stl"]);
  const tests = lampTestPieceEntries(DEFAULT_LAMP).map((e) => e.fileName);
  assert.deepEqual(tests, ["lampara_prueba_rosca_macho.stl", "lampara_prueba_rosca_hembra.stl", "lampara_prueba_portalamparas.stl"]);
});

test("comparar estilos: los tres insertos reales lado a lado, con la misma geometría que el ensamblado y sin superponerse", () => {
  const cmp = createInsertComparison(DEFAULT_LAMP);
  assert.deepEqual(cmp.skipped, []);
  assert.equal(cmp.geometry.parts.length, 3);
  assert.deepEqual(cmp.geometry.parts.map((p) => p.filenameSuffix), ["plano", "gota", "ondulado"]);
  const boxes = cmp.geometry.parts.map((p) => {
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < p.mesh.positions.length; i += 3) { minX = Math.min(minX, p.mesh.positions[i]); maxX = Math.max(maxX, p.mesh.positions[i]); }
    return [minX, maxX];
  });
  assert.ok(boxes[0][1] < boxes[1][0] && boxes[1][1] < boxes[2][0], "sin superposición");
  // cada uno tiene la cantidad de triángulos del inserto real del estilo
  for (const [i, s] of ["flat", "drop", "wavy"].entries()) {
    const real = build(s === DEFAULT_LAMP.insert.style ? DEFAULT_LAMP : applyInsertStyle(DEFAULT_LAMP, s));
    assert.equal(cmp.geometry.parts[i].mesh.triangleCount, real.geometry.parts.find((p) => p.filenameSuffix.startsWith("inserto")).mesh.triangleCount, s);
  }
  // un estilo que no entra con estas medidas se omite con el motivo, sin romper los demás
  const small = createInsertComparison({ ...DEFAULT_LAMP, bulb: { ...DEFAULT_LAMP.bulb, heightAboveHolderMm: 190 } });
  assert.ok(small.skipped.length >= 1 && small.skipped.every((x) => x.reason.length > 10));
  assert.ok(small.geometry === null || small.geometry.parts.length < 3);
});

test("miniaturas de los estilos: salen de la misma superficie que la geometría (no son decorativas) y son distintas entre sí", () => {
  const sil = {};
  for (const s of ["flat", "drop", "wavy"]) {
    const surface = referenceInsertSurface(s, DEFAULT_LAMP.insert, false);
    assert.equal(surface.valid, true);
    sil[s] = insertSilhouette(surface, 64);
    assert.ok(!/NaN/.test(sil[s].outer + sil[s].cavity + sil[s].valley), s);
    assert.ok(sil[s].outer.startsWith("M") && sil[s].outer.endsWith("Z"));
    assert.ok(Math.abs(sil[s].maxDiameterMm - 2 * surface.bodyMaxR) < 1e-9);
  }
  assert.notEqual(sil.flat.outer, sil.drop.outer);
  assert.notEqual(sil.flat.outer, sil.wavy.outer);
  assert.notEqual(sil.drop.outer, sil.wavy.outer);
  // el ondulado inicial es más ancho que el plano (suma amplitud); la gota cierra: su contorno llega al eje arriba
  assert.ok(sil.wavy.maxDiameterMm > sil.flat.maxDiameterMm);
  assert.ok(sil.drop.valley === sil.drop.outer, "sin ondas el valle es el mismo contorno");
  assert.notEqual(sil.wavy.valley, sil.wavy.outer, "con ondas el valle difiere de la cresta");
  // misma geometría que se malla: el radio máximo de la superficie coincide con la malla generada para esas medidas
  const def = style("wavy");
  const lay = validateLamp(def).layout.insert;
  const meshR = Math.max(...Array.from(build(def).indexed.insert.positions).filter((_, i) => i % 3 === 0).map(Math.abs));
  assert.ok(meshR <= lay.surface.tabMaxR + 1e-6 && meshR >= lay.surface.bodyMaxR - 1e-6);
});

test("compatibilidad con diseños guardados: los códigos anteriores a V2.2 se leen con el estilo ondulado liso y el reborde por defecto", () => {
  const old = { version: 2, shade: { heightMm: 150 }, insert: { diameterMm: 65, heightPct: 85, tabs: true, previewColor: "#3fae5a", ventWindows: 6 }, base: { ventSlots: 6 } };
  const def = normalizeLampDefinition(old);
  assert.equal(def.insert.style, "wavy");
  assert.equal(def.insert.amplitudeMm, 0);
  assert.equal(def.insert.heightMm, null);
  assert.deepEqual(def.adhesion, DEFAULT_LAMP.adhesion);
  assert.equal(def.insert.previewColor, "#3fae5a");
  const round = decodeLampDesign(encodeLampDesign(style("drop", { dropClosureMm: 55 })));
  assert.equal(round.def.insert.style, "drop");
  assert.equal(round.def.insert.dropClosureMm, 55);
  assert.equal(normalizeLampDefinition({ insert: { style: "cubo" } }).insert.style, "wavy");
  assert.ok(createLamp(def).errors.length === 0);
});

test("UI: selector de estilo del difusor, controles propios de cada estilo; la adhesión interna y el espesor ya no son controles", () => {
  const { MakerLampControls, LampExportButtons } = loadLampUi();
  const render = (def) => {
    const r = createLamp(def);
    return renderToStaticMarkup(createElement(MakerLampControls, { def, onChange() {}, errors: r.errors, warnings: r.warnings, metrics: r.metrics }));
  };
  const exportHtml = (def) => renderToStaticMarkup(createElement(LampExportButtons, { hasInsert: true, insertStyle: def.insert.style, hasCollar: false, canDownload: true, canDownloadTests: true, busy: null, onDownloadPart() {}, onDownloadZip() {}, onDownloadTests() {}, holderMeasured: false }));
  // por defecto el difusor es el cilíndrico recto (el «ondulado» liso): sin controles de ondas
  const cylinder = render(DEFAULT_LAMP);
  for (const text of ["Estilo del difusor", "Cilíndrico", "Plano", "Gota", "Ondulado", "Tipo de lámpara", "Base E27 estándar"]) assert.ok(cylinder.includes(text), `falta "${text}"`);
  assert.ok(exportHtml(DEFAULT_LAMP).includes("Inserto ondulado (STL)"));
  assert.ok(!cylinder.includes("Número de ondas"), "el cilíndrico no tiene ondas");
  // la adhesión interna es mecánica (reborde de la pieza roscada): no es un control
  for (const text of ["Adhesión interna", "Ancho del reborde", "Altura del reborde"]) assert.ok(!cylinder.includes(text), `sin "${text}"`);
  const wavy = render(style("wavy"));
  for (const text of ["Número de ondas", "Amplitud", "Frecuencia vertical", "Terminación superior"]) assert.ok(wavy.includes(text), `ondulado: falta "${text}"`);
  const flat = render(style("flat"));
  assert.ok(!flat.includes("Número de ondas") && !flat.includes("Espesor de la tapa") && /temperatura/i.test(flat) && exportHtml(style("flat")).includes("Inserto plano (STL)"));
  const drop = render(style("drop"));
  for (const text of ["Altura del cierre", "Curvatura", "Redondeo de la punta"]) assert.ok(drop.includes(text), `falta "${text}"`);
  assert.ok(exportHtml(style("drop")).includes("Inserto gota (STL)"));
  // las tarjetas son radios con la miniatura (svg) y la elegida marcada. Con la bombilla del motor (Ø60 × 85, marcador de posición) las siluetas Mossglow, Reloj de arena y Campana no
  // entran y no se ofrecen: quedan cilíndrico, plano, gota, ondulado y Tulipán
  assert.equal((drop.match(/data-diffuser="/g) ?? []).length, 5);
  assert.ok(/aria-checked="true"[^>]*data-diffuser="drop"/.test(drop));
  assert.equal((drop.match(/aria-checked="true"[^>]*data-diffuser="/g) ?? []).length, 1);
});

/** Distancia mínima de cada punto interior a la piel EXTERIOR: triángulos que lo tienen detrás de su cara (normal saliente) a más de 0,3 t. */
function triNormal(a, b, c) {
  return [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
}
function minWallDistance(tris, points, t) {
  let worst = Infinity;
  for (const pt of points) {
    for (const [a, b, c] of tris) {
      const n = triNormal(a, b, c);
      const len = Math.hypot(n[0], n[1], n[2]);
      if (len < 1e-12) continue;
      const behind = ((pt[0] - a[0]) * n[0] + (pt[1] - a[1]) * n[1] + (pt[2] - a[2]) * n[2]) / len;
      if (behind > -0.3 * t) continue;
      worst = Math.min(worst, pointTriangleDistance(pt, a, b, c));
    }
  }
  return worst;
}

// ------------------------------------------------------------------ utilidades de distancia (Ericson, Real-Time Collision Detection)
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
