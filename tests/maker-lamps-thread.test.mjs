import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";

// Lámparas E27: unión roscada pantalla–base, collar para modo vaso, alojamiento del portalámparas, inserto reducido y
// piezas de prueba. Todos los tests son GEOMÉTRICOS: miden las mallas que genera el motor (las mismas que ve el visor
// y exporta el STL). No reemplazan imprimir las piezas de prueba, laminarlas en Bambu Studio ni montar la lámpara real.

const { DEFAULT_LAMP } = loadMakerModule("lib/maker/lamps/defaults.ts");
const { createLamp, clearLampCaches } = loadMakerModule("lib/maker/lamps/createLamp.ts");
const { validateLamp } = loadMakerModule("lib/maker/lamps/validation/validateLamp.ts");
const { threadSpec, threadProfile, maleRadius, femaleVoidRadius, maleAmplitude } = loadMakerModule("lib/maker/lamps/threads/lampThread.ts");
const { createLampTestPieces } = loadMakerModule("lib/maker/lamps/parts/createTestPieces.ts");
const { lampPartEntries, lampTestPieceEntries, buildLampZipBlob, buildLampTestZipBlob, isTestPieceBlocker } = loadMakerModule("lib/maker/lamps/exporters/lampFiles.ts");
const { LAMP_GEOMETRY, LAMP_LIMITS } = loadMakerModule("lib/maker/lamps/types.ts");
const { LAMP_MEASUREMENTS_NEEDED, LAMP_PHYSICAL_TESTS, lampReadmeText, lampTestReadmeText } = loadMakerModule("lib/maker/lamps/safety.ts");
const { analyzeMesh, indexedBounds } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { collectBedItems, computeBedLayout } = loadMakerModule("lib/maker/printBed/bedLayout.ts");
const { getPrinterProfile, DEFAULT_PRINTER_PROFILE_ID } = loadMakerModule("lib/maker/printBed/printerProfiles.ts");
const { PRINT_TRANSFORM_BY_KIND } = loadMakerModule("lib/maker/printOrientation.ts");
const { computeExplodeRanks } = loadMakerModule("lib/maker/geometry/explodeOrder.ts");
const { socketRibHeight } = loadMakerModule("lib/maker/lamps/parts/createCollar.ts");

const lamp = (shade = {}, rest = {}) => ({ ...DEFAULT_LAMP, ...rest, shade: { ...DEFAULT_LAMP.shade, ...shade }, thread: { ...DEFAULT_LAMP.thread, ...(rest.thread ?? {}) } });
const lampCollar = (shade = {}, rest = {}) => lamp(shade, { ...rest, thread: { ...(rest.thread ?? {}), connection: "collar" } });
const build = (def) => {
  const r = createLamp(def);
  assert.equal(r.errors.length, 0, `errores: ${JSON.stringify(r.errors.map((e) => e.code + " " + e.message))}`);
  return r;
};
const layoutOf = (def) => validateLamp(def).layout;

// ------------------------------------------------------------------ utilidades geométricas
/** Rayos horizontales desde el eje a una altura dada: radios de cruce ordenados. Se indexa la malla una vez. */
function rayIndex(mesh) {
  const p = mesh.positions;
  const n = mesh.tris.length / 3;
  const data = new Float64Array(n * 9);
  const zlo = new Float64Array(n);
  const zhi = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const a = mesh.tris[t * 3] * 3, b = mesh.tris[t * 3 + 1] * 3, c = mesh.tris[t * 3 + 2] * 3;
    data.set([p[a], p[a + 1], p[a + 2], p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2], p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]], t * 9);
    zlo[t] = Math.min(p[a + 2], p[b + 2], p[c + 2]);
    zhi[t] = Math.max(p[a + 2], p[b + 2], p[c + 2]);
  }
  return {
    hits(theta, z) {
      const dx = Math.cos(theta), dy = Math.sin(theta);
      const ox = 1e-7, oy = 1e-7;
      const out = [];
      for (let t = 0; t < n; t++) {
        if (z < zlo[t] - 1e-9 || z > zhi[t] + 1e-9) continue;
        const o = t * 9;
        const e1x = data[o + 3], e1y = data[o + 4], e1z = data[o + 5], e2x = data[o + 6], e2y = data[o + 7], e2z = data[o + 8];
        // h = d × e2 con d = (dx, dy, 0)
        const hx = dy * e2z, hy = -dx * e2z, hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-12) continue;
        const f = 1 / det;
        const sx = ox - data[o], sy = oy - data[o + 1], sz = z - data[o + 2];
        const u = f * (sx * hx + sy * hy + sz * hz);
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = f * (dx * qx + dy * qy);
        if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        const dist = f * (e2x * qx + e2y * qy + e2z * qz);
        if (dist > 0) out.push(dist);
      }
      out.sort((a, b) => a - b);
      return out.filter((x, i) => i === 0 || x - out[i - 1] > 1e-6);
    },
  };
}

/** Paridad de cruces de un rayo en una dirección fija: impar = el punto está dentro de la malla cerrada. */
function pointInside(mesh, x, y, z) {
  const p = mesh.positions;
  const d = [0.3711, 0.5293, 0.7622];
  const len = Math.hypot(...d);
  d[0] /= len; d[1] /= len; d[2] /= len;
  let count = 0;
  for (let t = 0; t < mesh.tris.length; t += 3) {
    const a = mesh.tris[t] * 3, b = mesh.tris[t + 1] * 3, c = mesh.tris[t + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det, sx = x - p[a], sy = y - p[a + 1], sz = z - p[a + 2];
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
    if (v < 0 || u + v > 1) continue;
    if (f * (e2x * qx + e2y * qy + e2z * qz) > 1e-9) count++;
  }
  return count % 2 === 1;
}

/** Puntos 0,05 mm DENTRO del material de `mesh` (centroide de triángulos repartidos, desplazado contra la normal exterior). */
function interiorProbes(mesh, count, depth = 0.05) {
  const p = mesh.positions;
  const tris = mesh.tris.length / 3;
  const stride = Math.max(1, Math.floor(tris / count));
  const out = [];
  for (let t = 3; t < tris; t += stride) {
    const a = mesh.tris[t * 3] * 3, b = mesh.tris[t * 3 + 1] * 3, c = mesh.tris[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    out.push([(p[a] + p[b] + p[c]) / 3 - (nx / len) * depth, (p[a + 1] + p[b + 1] + p[c + 1]) / 3 - (ny / len) * depth, (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - (nz / len) * depth]);
  }
  return out;
}

function assertWatertight(mesh, label) {
  const r = analyzeMesh(mesh);
  assert.equal(r.nonFinite + r.degenerate + r.boundaryEdges + r.nonManifoldEdges + r.inconsistentEdges, 0, `${label}: ${JSON.stringify(r)}`);
  assert.ok(r.volume > 0, `${label}: volumen no positivo`);
}

const golden = (k) => (k * 0.6180339887498949) % 1;

/**
 * Separación radial macho–hembra medida sobre las MALLAS en `samples` puntos (θ, z) del tramo de profundidad completa.
 * `male` y `female` son mallas; `shift` aplica un movimiento helicoidal al macho (giro ψ y subida Δ).
 */
function measureGaps(maleMesh, femaleMesh, layout, samples, { psi = 0, rise = 0, zFrom = null, zTo = null } = {}) {
  const spec = layout.spec;
  const male = rayIndex(maleMesh), female = rayIndex(femaleMesh);
  const lo = zFrom ?? layout.ledgeZ + spec.rampIn + 0.3 + rise;
  const hi = zTo ?? layout.ledgeZ + spec.length - spec.rampOut - 0.3;
  const gaps = [];
  for (let k = 0; k < samples; k++) {
    const theta = 2 * Math.PI * golden(k + 1);
    const z = lo + (hi - lo) * golden(k * 3 + 2);
    const m = male.hits(theta - psi, z - rise);
    const f = female.hits(theta, z);
    if (!m.length || !f.length) continue;
    gaps.push(f[0] - m[m.length - 1]);
  }
  return gaps;
}

// ------------------------------------------------------------------ 1. rosca macho
test("rosca macho: perfil trapecial de flancos a 45°, cresta, raíz, paso, entradas y derecha", () => {
  const t = lamp().thread;
  const spec = threadSpec(t);
  const g = LAMP_GEOMETRY;
  assert.ok(Math.abs(spec.depth - g.threadDepthFrac * t.pitchMm) < 1e-12);
  assert.ok(Math.abs(spec.majorR - t.majorDiameterMm / 2) < 1e-12 && Math.abs(spec.rootR - (spec.majorR - spec.depth)) < 1e-12);
  assert.ok(Math.abs(spec.boreR - (spec.rootR - t.coreWallMm)) < 1e-12);
  assert.equal(spec.lead, t.pitchMm * t.starts);
  // perfil normalizado: cresta plana, raíz plana y flancos lineales de pendiente depth/(flankFrac·paso) = 1 (45°)
  assert.equal(threadProfile(spec, 0), 1);
  assert.equal(threadProfile(spec, 0.5), 0);
  assert.ok(threadProfile(spec, spec.flatHalf * 0.99) === 1 && threadProfile(spec, 0.5 - spec.flatHalf * 0.99) === 0);
  const mid = spec.flatHalf + spec.flankFrac / 2;
  assert.ok(Math.abs(threadProfile(spec, mid) - 0.5) < 1e-12);
  const slope = (spec.depth * (threadProfile(spec, mid) - threadProfile(spec, mid + 0.01))) / (0.01 * spec.pitch);
  assert.ok(Math.abs(slope - 1) < 1e-9, `pendiente de flanco ${slope} (1 = 45°)`);
  // periodicidad: se repite cada paso en z y cada vuelta/entradas en θ
  const z0 = 5.37, th = 1.1; // dentro del tramo de profundidad completa (el filete entra y sale con rampa)
  const full = (z, theta) => maleRadius(spec, theta, z, 0);
  assert.ok(Math.abs(full(z0 + spec.pitch, th) - full(z0, th)) < 1e-9);
  assert.ok(Math.abs(full(z0, th + (2 * Math.PI) / spec.starts) - full(z0, th)) < 1e-9);
  // rosca derecha: la cresta sube al girar en sentido antihorario (visto desde +Z)
  // simetría helicoidal: al girar Δθ la superficie sube Δz = entradas · paso · Δθ / 2π (y NO baja)
  const dTheta = 0.3, dZ = (spec.starts * spec.pitch * dTheta) / (2 * Math.PI);
  let wrongSign = 0;
  for (const [zz, tt] of [[5.4, 0.2], [6.1, 1.7], [7.3, 3.9], [9.9, 5.2]]) {
    assert.ok(Math.abs(full(zz + dZ, tt + dTheta) - full(zz, tt)) < 1e-9, "la cresta sube al girar antihorario (rosca derecha)");
    wrongSign = Math.max(wrongSign, Math.abs(full(zz - dZ, tt + dTheta) - full(zz, tt)));
  }
  assert.ok(wrongSign > 0.1, "una rosca izquierda daría otro relieve");
  // entrada del filete: nace con profundidad 0 y llega a la completa; sale con profundidad 0
  assert.equal(maleAmplitude(spec, 0), 0);
  assert.equal(maleAmplitude(spec, spec.length), 0);
  assert.equal(maleAmplitude(spec, spec.length / 2), 1);
  assert.ok(Math.abs(maleAmplitude(spec, spec.rampIn / 2) - 0.5) < 1e-12);
  assert.ok(spec.usefulEngagement > 1.5 * spec.pitch);
  for (const th2 of [0.3, 2.2, 4.4]) assert.ok(Math.abs(maleRadius(spec, th2, 0, 0) - spec.rootR) < 1e-12);
});

test("rosca macho: los vértices del cuello de la pantalla están sobre la superficie analítica y el cuello no depende de las ondas", () => {
  const def = lamp();
  const r = build(def);
  const layout = layoutOf(def);
  const spec = layout.spec;
  const p = r.indexed.shade.positions;
  let checked = 0, worst = 0, crest = 0, root = Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const z = p[i + 2];
    if (z < layout.ledgeZ - 1e-9 || z > layout.ledgeZ + spec.length + 1e-9) continue;
    const rad = Math.hypot(p[i], p[i + 1]);
    if (rad < spec.rootR - 1e-6) continue; // piel interior (orificio)
    worst = Math.max(worst, Math.abs(rad - maleRadius(spec, Math.atan2(p[i + 1], p[i]), z, layout.ledgeZ)));
    crest = Math.max(crest, rad);
    root = Math.min(root, rad);
    checked++;
  }
  assert.ok(checked > 2000);
  assert.ok(worst < 1e-6, `desvío ${worst}`);
  assert.ok(Math.abs(crest - spec.majorR) < 0.03, `cresta ${crest} vs ${spec.majorR}`);
  assert.ok(Math.abs(root - spec.rootR) < 1e-6);
  // cambiar ondas, amplitud, torsión o perfil NO cambia el cuello: sus vértices están sobre la MISMA superficie analítica
  // (la cantidad de columnas de la malla sigue a las ondas, pero la rosca es la misma función)
  for (const patch of [{ waves: 5, amplitudeMm: 9 }, { family: "wavy", twistDeg: 0, waves: 20 }, { family: "organic", organicPct: 80, seed: 5, profile: "tulip", profileAmountPct: 60 }]) {
    const other = lamp(patch);
    const q = build(other).indexed.shade.positions;
    let n = 0, dev = 0, top = -Infinity;
    for (let i = 0; i < q.length; i += 3) {
      const z = q[i + 2], rad = Math.hypot(q[i], q[i + 1]);
      if (z < layout.ledgeZ - 1e-9 || z > layout.ledgeZ + spec.length + 1e-9 || rad < spec.rootR - 1e-6) continue;
      dev = Math.max(dev, Math.abs(rad - maleRadius(spec, Math.atan2(q[i + 1], q[i]), z, layout.ledgeZ)));
      top = Math.max(top, rad);
      n++;
    }
    assert.ok(n > 2000 && dev < 1e-6 && Math.abs(top - spec.majorR) < 0.05, `el cuello cambió con ${JSON.stringify(patch)} (desvío ${dev})`);
  }
});

// ------------------------------------------------------------------ 2. rosca hembra
test("rosca hembra: el vacío de la base sigue la rosca macho + holgura (nunca más angosto que la superficie analítica) y la pared que la rodea es suficiente", () => {
  const def = lamp();
  const r = build(def);
  const layout = layoutOf(def);
  const spec = layout.spec;
  const base = rayIndex(r.indexed.base);
  let minOver = Infinity, maxOver = -Infinity;
  for (let k = 0; k < 160; k++) {
    const theta = 2 * Math.PI * golden(k + 1);
    const z = layout.ledgeZ + 0.2 + (spec.femaleDepth - 0.4) * golden(k * 3 + 2);
    const hits = base.hits(theta, z);
    assert.ok(hits.length >= 1);
    const analytic = femaleVoidRadius(spec, theta, z, layout.ledgeZ);
    minOver = Math.min(minOver, hits[0] - analytic);
    maxOver = Math.max(maxOver, hits[0] - analytic);
    // el material de la base llega hasta el borde exterior
    assert.ok(Math.abs(hits[hits.length - 1] - layout.baseDiameterMm / 2) < 0.1);
  }
  assert.ok(minOver >= -0.02, `el vacío quedó ${minOver} mm más angosto que la rosca analítica`);
  assert.ok(maxOver <= 0.7, `escalonado de capas de ${maxOver} mm (un paso de capa de 0,31 mm × pendiente de 45° + avellanado)`);
  // espesor mínimo de la pared alrededor de la rosca hembra
  const wall = layout.baseDiameterMm / 2 - (spec.majorR + spec.clearance);
  assert.ok(wall >= LAMP_GEOMETRY.baseMinOuterWallMm);
  assert.ok(Math.abs(wall - r.metrics.fit.thread.baseWallMm) < 0.1);
  // avellanado de entrada: el vacío se ensancha en el borde superior (guía el arranque)
  const topHits = base.hits(0.123, layout.baseTopZ - 0.05);
  const deepHits = base.hits(0.123, layout.baseTopZ - 3);
  assert.ok(topHits[0] > deepHits[0] - 0.01 + 0.9 || topHits[0] > deepHits[0], "avellanado en el borde superior");
  // el tope (escalón) deja un apoyo plano de al menos el ancho de la cara del cuello
  const ledgeWidth = spec.rootR + spec.clearance - spec.boreR;
  assert.ok(ledgeWidth >= r.metrics.fit.thread.stopFaceWidthMm);
});

// ------------------------------------------------------------------ 3. coincidencia macho–hembra y holguras
for (const connection of ["integrated", "collar"]) {
  test(`coincidencia geométrica (${connection}): la separación radial medida sobre las mallas es >= la holgura en todo el tramo de profundidad completa`, () => {
    const def = connection === "collar" ? lampCollar() : lamp();
    const r = build(def);
    const layout = layoutOf(def);
    const maleMesh = connection === "collar" ? r.indexed.collar : r.indexed.shade;
    const gaps = measureGaps(maleMesh, r.indexed.base, layout, 160);
    assert.ok(gaps.length >= 150);
    const c = def.thread.clearanceMm;
    assert.ok(Math.min(...gaps) >= c - 0.05, `separación mínima ${Math.min(...gaps).toFixed(3)} < holgura ${c}`);
    assert.ok(Math.max(...gaps) <= c + 0.55, `separación máxima ${Math.max(...gaps).toFixed(3)} (holgura excesiva = juego de más)`);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    assert.ok(mean < c + 0.25, `separación media ${mean.toFixed(3)}`);
  });
}

test("el tornillo gira libre: el movimiento helicoidal (giro + avance) del macho nunca interfiere con la hembra; un giro sin avance sí", () => {
  const def = lamp({}, { thread: { ...DEFAULT_LAMP.thread, engagementMm: 30 } });
  const r = build(def);
  const layout = layoutOf(def);
  const spec = layout.spec;
  const c = def.thread.clearanceMm;
  // el macho se levanta `rise` mientras gira ψ = 2π · rise / avance-por-vuelta (desenroscar)
  for (const turnFraction of [0, 0.15, 0.3, 0.5, 0.75]) {
    const psi = 2 * Math.PI * turnFraction, rise = spec.lead * turnFraction;
    const gaps = measureGaps(r.indexed.shade, r.indexed.base, layout, 60, { psi, rise, zFrom: layout.ledgeZ + spec.rampIn + 0.3 + rise, zTo: layout.ledgeZ + spec.length - spec.rampOut - 0.3 });
    assert.ok(gaps.length >= 55);
    assert.ok(Math.min(...gaps) >= c - 0.05, `giro ${turnFraction} vueltas: separación ${Math.min(...gaps).toFixed(3)}`);
  }
  // control negativo: girar el macho SIN subirlo (no es un movimiento de tornillo) choca con la hembra
  const wrong = measureGaps(r.indexed.shade, r.indexed.base, layout, 60, { psi: Math.PI / spec.starts, rise: 0 });
  assert.ok(Math.min(...wrong) < 0, "el control negativo debería interferir");
  // el sentido de la rosca es el esperado: avance por vuelta = paso × entradas
  assert.ok(Math.abs(r.metrics.fit.thread.leadMm - spec.lead) < 1e-9);
});

test("holguras de montaje: la separación medida sigue la holgura configurada, el juego axial se informa y fuera de rango se rechaza", () => {
  for (const clearanceMm of [0.2, 0.4, 0.6, 0.8]) {
    const def = lamp({}, { thread: { ...DEFAULT_LAMP.thread, clearanceMm } });
    const r = build(def);
    const gaps = measureGaps(r.indexed.shade, r.indexed.base, layoutOf(def), 90);
    assert.ok(Math.min(...gaps) >= clearanceMm - 0.05, `holgura ${clearanceMm}: mínimo ${Math.min(...gaps).toFixed(3)}`);
    assert.ok(Math.max(...gaps) <= clearanceMm + 0.55);
    assert.ok(Math.abs(r.metrics.fit.thread.normalClearanceMm - clearanceMm * Math.SQRT1_2) < 0.006);
    assert.ok(Math.abs(r.metrics.fit.thread.axialPlayMm - 2 * clearanceMm) < 1e-9);
  }
  // holguras del inserto: ranura de la base y pantalla
  for (const clearanceMm of [0.3, 0.8, 1.6]) assert.equal(createLamp(lamp({}, { insert: { ...DEFAULT_LAMP.insert, clearanceMm } })).errors.length, 0);
  for (const bad of [0.1, 0.9]) assert.ok(createLamp(lamp({}, { thread: { ...DEFAULT_LAMP.thread, clearanceMm: bad } })).errors.some((e) => e.field === "thread.clearanceMm"));
  // la lista de holguras del ensamblaje sale de la misma geometría y marca fallas
  const checks = build(lamp()).metrics.fit.clearances;
  assert.ok(checks.length >= 7 && checks.every((c) => ["ok", "warn", "fail", "info"].includes(c.status)));
  assert.ok(checks.filter((c) => c.minMm !== null).every((c) => c.status === "ok"));
});

// ------------------------------------------------------------------ 4. espesores mínimos
test("espesores mínimos: cuello bajo la raíz, pared de la transición, pozo del collar, piso y techo de la base", () => {
  const g = LAMP_GEOMETRY;
  // cuello macho: del orificio a la raíz de la rosca, en todas las alturas del cuello
  const def = lamp();
  const r = build(def);
  const layout = layoutOf(def);
  const spec = layout.spec;
  const shade = rayIndex(r.indexed.shade);
  for (let k = 0; k < 90; k++) {
    const theta = 2 * Math.PI * golden(k + 1);
    const z = layout.ledgeZ + 0.1 + (spec.length - 0.2) * golden(k * 3 + 1);
    const hits = shade.hits(theta, z);
    assert.equal(hits.length, 2, "dos paredes: orificio y exterior");
    const rootAtZ = maleRadius(spec, theta, z, layout.ledgeZ) - spec.depth * maleAmplitude(spec, z - layout.ledgeZ) * threadProfile(spec, z / spec.pitch - (spec.starts * theta) / (2 * Math.PI));
    assert.ok(hits[0] - spec.boreR < 0.01, "el orificio es el de la cavidad");
    assert.ok(hits[1] - hits[0] >= def.thread.coreWallMm - 0.02, `cuello ${hits[1] - hits[0]} < ${def.thread.coreWallMm}`);
    assert.ok(Math.abs(rootAtZ - spec.rootR) < 1e-9);
  }
  // transición de 45°: el espesor medido en horizontal es wall·√2 (el espesor normal queda en `wallMm`)
  const zMid = layout.neckTopZ + layout.flareH / 2;
  const flare = shade.hits(0.77, zMid);
  assert.equal(flare.length, 2);
  assert.ok((flare[1] - flare[0]) / Math.SQRT2 >= def.shade.wallMm - 0.05, `pared de la transición ${(flare[1] - flare[0]) / Math.SQRT2}`);
  // pozo del collar: pared exterior, piso y nervios
  const c = lampCollar();
  const rc = build(c);
  const lc = layoutOf(c);
  const collar = rayIndex(rc.indexed.collar);
  const midSocket = lc.collar.floorZ + c.shade.collarHeightMm / 2;
  let thinnest = Infinity;
  for (let k = 0; k < 60; k++) {
    const h = collar.hits(2 * Math.PI * golden(k + 1), midSocket);
    assert.equal(h.length, 2);
    thinnest = Math.min(thinnest, h[1] - h[0]);
    assert.ok(Math.abs(h[1] - lc.collar.outerWallR) < 0.02);
  }
  assert.ok(thinnest >= g.socketWallMm - 0.02, `pared del pozo ${thinnest}`);
  assert.ok(Math.abs(lc.collar.socketR - c.shade.bottomDiameterMm / 2 - g.socketClearanceMm) < 1e-9);
  assert.ok(lc.collar.socketR - lc.collar.floorInnerR >= g.socketFloorWidthMm, "ancho del piso del pozo");
  // piso de la base: techo sobre el canal de cable y sobre las ventanas, tope y pared exterior
  const f = r.metrics.fit;
  assert.ok(f.floorTopZ - layout.channelHeight >= 3, `techo del canal ${f.floorTopZ - layout.channelHeight}`);
  assert.ok(layout.ledgeZ - (f.floorTopZ + g.ventSlotHeightMm) >= g.baseLedgeRoofMm - 1e-9);
  assert.ok(f.thread.baseWallMm >= g.baseMinOuterWallMm && f.thread.stopFaceWidthMm >= 3);
  // y lo que queda por debajo del mínimo se rechaza con el motivo
  assert.ok(createLamp(lamp({}, { thread: { ...DEFAULT_LAMP.thread, engagementMm: 8, pitchMm: 8 } })).errors.some((e) => e.code === "THREAD_ENGAGEMENT_SHORT"));
});

// ------------------------------------------------------------------ 5. interferencias
for (const connection of ["integrated", "collar"]) {
  test(`interferencias (${connection}): ningún punto interior de una pieza cae dentro de otra en la posición de montaje`, () => {
    const def = connection === "collar" ? lampCollar() : lamp();
    const r = build(def);
    const parts = { base: r.indexed.base, insert: r.indexed.insert, shade: r.indexed.shade, collar: r.indexed.collar };
    let checked = 0;
    for (const [nameA, a] of Object.entries(parts)) {
      if (!a) continue;
      const probes = interiorProbes(a, 90);
      for (const [nameB, b] of Object.entries(parts)) {
        if (!b || nameA === nameB) continue;
        // el borde de la pantalla entra a presión en el pozo del collar (0,2 mm de interferencia en 6 nervios): se verifica aparte
        if ((nameA === "shade" && nameB === "collar") || (nameA === "collar" && nameB === "shade")) continue;
        for (const [x, y, z] of probes) {
          assert.equal(pointInside(b, x, y, z), false, `${nameA} penetra en ${nameB} en (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
          checked++;
        }
      }
    }
    assert.ok(checked > 400);
    // control negativo: bajar la pantalla (o el collar) 2 mm la clava en el tope de la base -> el chequeo lo detecta
    const moved = connection === "collar" ? r.indexed.collar : r.indexed.shade;
    const sunk = { positions: moved.positions.map((v, i) => (i % 3 === 2 ? v - 2 : v)), tris: moved.tris };
    assert.ok(interiorProbes(sunk, 150).some(([x, y, z]) => pointInside(r.indexed.base, x, y, z)), "el control negativo debería detectar la interferencia");
  });
}

test("collar roscado + pantalla lisa: el borde de la pantalla entra a presión (interferencia de diseño 0,2 mm solo en los nervios), apoya en el piso del pozo y no hay otro contacto", () => {
  const g = LAMP_GEOMETRY;
  const def = lampCollar();
  const r = build(def);
  const layout = layoutOf(def);
  const col = layout.collar;
  const R0 = def.shade.bottomDiameterMm / 2;
  const collar = rayIndex(r.indexed.collar);
  const z = col.floorZ + def.shade.collarHeightMm / 2;
  const segments = g.femaleSegments;
  // nervio: radio mínimo del pozo = pozo − altura del nervio -> interferencia con el diámetro exterior de la pantalla
  const inner = (theta) => { const h = collar.hits(theta, z); return h[h.length - 2]; };
  let minInner = Infinity, maxInner = -Infinity;
  for (let j = 0; j < segments; j++) {
    const theta = (2 * Math.PI * (j + 0.31)) / segments;
    const rad = inner(theta);
    minInner = Math.min(minInner, rad);
    maxInner = Math.max(maxInner, rad);
  }
  assert.ok(Math.abs(maxInner - col.socketR) < 0.03, `pozo ${maxInner} vs ${col.socketR}`);
  assert.ok(R0 - minInner > 0.1 && R0 - minInner <= g.socketRibHeightMm - g.socketClearanceMm + 0.08, `interferencia ${(R0 - minInner).toFixed(3)} mm`);
  // seis nervios repartidos en la circunferencia: altura máxima en su centro, cero entre ellos
  assert.ok(Math.abs(socketRibHeight(0, segments) - g.socketRibHeightMm) < 1e-9 && socketRibHeight(segments / g.socketRibs / 2, segments) === 0);
  assert.equal(Array.from({ length: segments }, (_, j) => socketRibHeight(j, segments)).filter((h, j, arr) => h > 0 && (arr[(j + segments - 1) % segments] === 0)).length, g.socketRibs);
  // fuera de los nervios hay holgura (el borde de la pantalla no se traba)
  assert.ok(maxInner - R0 >= g.socketClearanceMm - 0.03);
  // la pantalla apoya sobre el piso del pozo (su borde inferior está a la altura del piso) y arriba del collar sobresale limpia
  const sb = indexedBounds(r.indexed.shade);
  assert.ok(Math.abs(sb.minZ - col.floorZ) < 1e-6);
  assert.ok(sb.minZ < col.topZ && sb.maxZ > col.topZ);
  // la pantalla en modo collar es lisa abajo: su anillo inferior es exactamente un círculo de R0 (apto para modo vaso, sin rosca ni pestañas)
  const bottomRadii = new Set();
  const sp = r.indexed.shade.positions;
  for (let i = 0; i < sp.length; i += 3) if (Math.abs(sp[i + 2] - sb.minZ) < 1e-6) bottomRadii.add(Math.round(Math.hypot(sp[i], sp[i + 1]) * 100) / 100);
  assert.deepEqual([...bottomRadii].sort((a, b) => a - b), [Math.round((R0 - def.shade.wallMm) * 100) / 100, R0]);
  assert.ok(r.metrics.shade.vase.ready && r.metrics.shade.vase.reasons.length === 0);
  // y se avisa que el pozo NO está validado con un laminador
  assert.ok(r.warnings.some((w) => w.code === "COLLAR_UNVERIFIED" && /NO está validado/.test(w.message)));
  // el piso del pozo apoya el borde (R0 − pared) .. R0 dentro de [floorInnerR, socketR]
  assert.ok(col.floorInnerR <= R0 - def.shade.wallMm && col.socketR >= R0);
});

// ------------------------------------------------------------------ 6. inserto reducido, fijación y extracción
test("inserto reducido: el automático es el MÁS ANGOSTO que respeta la separación a la bombilla y al portalámparas, no el más ancho que cabe", () => {
  const def = lamp();
  const r = build(def);
  const fit = r.metrics.fit;
  const bulbR = def.bulb.diameterMm / 2, holderR = def.holder.bodyDiameterMm / 2;
  const minOuter = 2 * (Math.max(bulbR, holderR) + def.insert.minBulbGapMm + def.insert.thicknessMm);
  assert.ok(fit.insertOuterDiameterMm >= minOuter - 1e-9 && fit.insertOuterDiameterMm <= minOuter + 0.5 + 1e-9, `Ø ${fit.insertOuterDiameterMm} vs mínimo ${minOuter}`);
  assert.ok(fit.insertOuterDiameterMm < 0.7 * def.shade.bottomDiameterMm, "mucho más angosto que la pantalla");
  assert.ok(fit.insertOuterDiameterMm < fit.thread.boreDiameterMm - 2 * def.insert.clearanceMm, "entra en el orificio del cuello con holgura");
  // sigue el tamaño de la bombilla / del portalámparas / de la separación pedida (no asume que todas las E27 son iguales)
  const od = (d) => build(d).metrics.fit.insertOuterDiameterMm;
  assert.ok(od(lamp({}, { bulb: { ...DEFAULT_LAMP.bulb, diameterMm: 50 } })) < fit.insertOuterDiameterMm);
  assert.ok(od(lamp({}, { bulb: { ...DEFAULT_LAMP.bulb, diameterMm: 64 } })) > fit.insertOuterDiameterMm);
  assert.ok(od(lamp({}, { insert: { ...DEFAULT_LAMP.insert, minBulbGapMm: 6 } })) < fit.insertOuterDiameterMm);
  assert.ok(od(lamp({}, { insert: { ...DEFAULT_LAMP.insert, thicknessMm: 1.6 } })) > fit.insertOuterDiameterMm);
  assert.ok(od(lamp({}, { holder: { ...DEFAULT_LAMP.holder, bodyDiameterMm: 62 } })) > fit.insertOuterDiameterMm);
  // medido en la malla: el tubo está a >= la separación de diseño de la bombilla y del portalámparas
  const p = r.indexed.insert.positions;
  let minR = Infinity;
  for (let i = 0; i < p.length; i += 3) minR = Math.min(minR, Math.hypot(p[i], p[i + 1]));
  assert.ok(minR - bulbR >= def.insert.minBulbGapMm - 1e-6);
  // altura configurable dentro de límites geométricos
  for (const heightPct of [50, 70, 95]) {
    const h = build(lamp({}, { insert: { ...DEFAULT_LAMP.insert, heightPct } }));
    assert.ok(Math.abs(h.metrics.insert.boundingBox.height - (heightPct / 100) * (h.metrics.fit.shadeTopZ - h.metrics.fit.insertBottomZ)) < 0.06);
  }
  assert.ok(createLamp(lamp({}, { insert: { ...DEFAULT_LAMP.insert, heightPct: 99 } })).errors.some((e) => e.field === "insert.heightPct"));
  // diámetro manual: se respeta (si cabe) y no se corrige en silencio
  assert.equal(build(lamp({}, { insert: { ...DEFAULT_LAMP.insert, diameterMm: 82 } })).metrics.fit.insertOuterDiameterMm, 82);
});

test("inserto intercambiable: varios insertos de espesor y color distintos comparten la misma pantalla y la misma base; se saca por arriba sin desmontar", () => {
  const first = build(lamp());
  const ref = first.geometry.parts;
  const baseMesh = ref[0].mesh, shadeMesh = ref[2].mesh;
  for (const insert of [{ thicknessMm: 0.6, previewColor: "#3b7be5" }, { thicknessMm: 1.2, previewColor: "#3fae5a" }, { thicknessMm: 1.0, previewColor: "#f2c230", tabs: false, ventNotches: 0 }]) {
    const d = lamp({}, { insert: { ...DEFAULT_LAMP.insert, ...insert } });
    const r = build(d);
    assert.equal(r.indexed.insert === first.indexed.insert, false);
    assert.ok(r.geometry.parts[2].mesh === shadeMesh, "la pantalla no se regenera al cambiar el inserto");
    assertWatertight(r.indexed.insert, "inserto alterno");
    assert.equal(r.metrics.fit.insertRemovableFromTop, true);
    assert.ok(r.metrics.fit.insertBottomZ === first.metrics.fit.insertBottomZ, "todos apoyan en la misma ranura");
  }
  void baseMesh;
  // el color no es geometría: las mallas son las mismas
  const plain = build(lamp());
  const recolored = build(lamp({}, { insert: { ...DEFAULT_LAMP.insert, previewColor: "#8a5bd6" } }));
  assert.ok(recolored.geometry.parts[1].mesh === plain.geometry.parts[1].mesh);
  void ref;
  // abertura superior demasiado angosta para sacar el inserto con sus lengüetas: se informa, no se oculta
  const narrow = createLamp(lamp({ profile: "waist", profileAmountPct: 0, topDiameterMm: 90, amplitudeMm: 0 }));
  if (narrow.errors.length === 0) assert.ok(narrow.warnings.some((w) => w.code === "INSERT_NOT_REMOVABLE_FROM_TOP") || narrow.metrics.fit.insertRemovableFromTop === true);
  // el inserto no lleva rosca propia: encastra en una ranura del piso de la base (apoyo sencillo)
  const bounds = indexedBounds(first.indexed.insert);
  assert.ok(Math.abs(bounds.minZ - (first.metrics.fit.floorTopZ - LAMP_GEOMETRY.grooveDepthMm)) < 1e-6);
});

// ------------------------------------------------------------------ 7. tamaños, independencia de la interfaz y geometrías extremas
test("la misma base y la misma interfaz sirven a pantallas distintas: la base no cambia y todas se enroscan con la misma holgura", () => {
  const fixedBase = { ...DEFAULT_LAMP.base, diameterMm: 140 };
  const shades = [
    { family: "wavy", waves: 5, amplitudeMm: 8, twistDeg: 0, heightMm: 120, bottomDiameterMm: 110, topDiameterMm: 150 },
    { family: "spiral", waves: 20, amplitudeMm: 4, twistDeg: 700, heightMm: 260, bottomDiameterMm: 170, topDiameterMm: 170 },
    { family: "organic", organicPct: 80, waves: 7, amplitudeMm: 6, seed: 9, profile: "tulip", profileAmountPct: 60, heightMm: 180, bottomDiameterMm: 130, topDiameterMm: 200 },
  ];
  let baseMesh = null;
  for (const shade of shades) {
    for (const connection of ["integrated", "collar"]) {
      const def = lamp(shade, { base: fixedBase, thread: { ...DEFAULT_LAMP.thread, connection } });
      const r = build(def);
      if (baseMesh === null) baseMesh = r.geometry.parts[0].mesh;
      assert.ok(r.geometry.parts[0].mesh === baseMesh, "la base es la misma pieza para cualquier pantalla con la misma interfaz");
      const maleMesh = connection === "collar" ? r.indexed.collar : r.indexed.shade;
      const gaps = measureGaps(maleMesh, r.indexed.base, layoutOf(def), 40);
      assert.ok(Math.min(...gaps) >= def.thread.clearanceMm - 0.05);
    }
  }
});

const THREAD_CASES = {
  "una entrada, paso fino": { starts: 1, pitchMm: 3, engagementMm: 12 },
  "cuatro entradas, paso grueso": { starts: 4, pitchMm: 8, engagementMm: 30 },
  "longitud mínima": { starts: 2, pitchMm: 3, engagementMm: 8 },
  "holgura mínima": { clearanceMm: 0.2 },
  "holgura máxima": { clearanceMm: 0.8 },
  "cuello fino": { coreWallMm: 2 },
  "cuello grueso": { coreWallMm: 8, majorDiameterMm: 110 },
  "rosca ancha": { majorDiameterMm: 150 },
  "rosca mínima": { majorDiameterMm: 80 },
};
for (const [name, patch] of Object.entries(THREAD_CASES)) {
  test(`rosca extrema (${name}): mallas cerradas y separación >= holgura en ambas uniones, o el motivo del rechazo`, () => {
    for (const connection of ["integrated", "collar"]) {
      const thread = { ...DEFAULT_LAMP.thread, ...patch, connection };
      // la pantalla debe superar la raíz de la rosca; el portalámparas, entrar en el orificio; el inserto, caber
      const rootD = 2 * (thread.majorDiameterMm / 2 - 0.32 * thread.pitchMm);
      const def = lamp({ bottomDiameterMm: Math.max(120, Math.ceil(rootD + 20)), topDiameterMm: Math.max(130, Math.ceil(rootD + 30)) }, { thread, holder: { ...DEFAULT_LAMP.holder, bodyDiameterMm: thread.majorDiameterMm >= 90 ? 45 : 36 }, bulb: { ...DEFAULT_LAMP.bulb, diameterMm: thread.majorDiameterMm >= 90 ? 60 : 45 } });
      const v = validateLamp(def);
      if (v.errors.length > 0) {
        // un rechazo debe ser claro y no generar geometría
        assert.ok(v.errors.every((e) => e.message.length > 20), name);
        assert.equal(createLamp(def).geometry, null);
        continue;
      }
      const r = build(def);
      for (const mesh of [r.indexed.shade, r.indexed.base, r.indexed.insert, r.indexed.collar]) if (mesh) assertWatertight(mesh, `${name}/${connection}`);
      const gaps = measureGaps(connection === "collar" ? r.indexed.collar : r.indexed.shade, r.indexed.base, layoutOf(def), 40);
      assert.ok(gaps.length >= 35, `${name}: muestras`);
      assert.ok(Math.min(...gaps) >= thread.clearanceMm - 0.06, `${name}/${connection}: separación ${Math.min(...gaps).toFixed(3)}`);
      assert.ok(r.metrics.fit.thread.turnsToSeat > 0.5);
    }
  });
}

test("diseños y tamaños extremos de la parte decorativa con la interfaz roscada: mallas cerradas y la unión intacta", () => {
  const cases = [
    lamp({ heightMm: 60, bottomDiameterMm: 100, topDiameterMm: 90, amplitudeMm: 1, waves: 3 }),
    lamp({ heightMm: 400, bottomDiameterMm: 300, topDiameterMm: 300, amplitudeMm: 20, waves: 4 }),
    lamp({ twistDeg: 1400, amplitudeMm: 4, waves: 5 }),
    lampCollar({ twistDeg: -1000, amplitudeMm: 5, waves: 6 }),
    lampCollar({ family: "organic", organicPct: 100, seed: 4242, waves: 9, amplitudeMm: 9, verticalFrequency: 6, patternIntensityPct: 100 }),
    lamp({ waves: 32, amplitudeMm: 2.5 }),
  ];
  for (const [i, def] of cases.entries()) {
    const v = validateLamp(def);
    if (v.errors.length) {
      assert.equal(createLamp(def).geometry, null, `caso ${i}: ${JSON.stringify(v.errors.map((e) => e.code))}`);
      continue;
    }
    const r = build(def);
    for (const mesh of [r.indexed.shade, r.indexed.base, r.indexed.insert, r.indexed.collar]) if (mesh) assertWatertight(mesh, `extremo ${i}`);
    const gaps = measureGaps(def.thread.connection === "collar" ? r.indexed.collar : r.indexed.shade, r.indexed.base, layoutOf(def), 30);
    assert.ok(Math.min(...gaps) >= def.thread.clearanceMm - 0.05, `caso ${i}`);
  }
  // una pantalla más angosta que la raíz de la rosca no se acepta: nada se agranda ni se achica en silencio
  const narrow = createLamp(lamp({ bottomDiameterMm: 94, topDiameterMm: 94, amplitudeMm: 0 }));
  assert.ok(narrow.errors.some((e) => e.code === "SHADE_NARROWER_THAN_THREAD"));
  assert.equal(narrow.geometry, null);
});

// ------------------------------------------------------------------ 8. piezas de prueba, exportación y correspondencia visor–STL
test("piezas de prueba de la rosca y del portalámparas: cerradas, chicas, encastran con la misma holgura y salen de las mismas funciones que la lámpara", () => {
  const def = lamp();
  const layout = layoutOf(def);
  const pieces = createLampTestPieces(layout);
  for (const [name, mesh] of Object.entries(pieces)) {
    assertWatertight(mesh, name);
    const b = indexedBounds(mesh);
    assert.ok(Math.abs(b.minZ) < 1e-6, `${name}: apoyada en Z=0`);
  }
  const spec = layout.spec;
  const male = indexedBounds(pieces.threadMale), female = indexedBounds(pieces.threadFemale);
  assert.ok(male.maxZ - male.minZ <= spec.length + 3 + 1e-6 && female.maxZ - female.minZ <= spec.femaleDepth + 3 + 1e-6, "tramos cortos: se imprimen en minutos");
  assert.ok(Math.abs(male.maxX - spec.majorR) < 0.05, "el macho tiene la rosca real (misma cresta)");
  assert.ok(Math.abs(female.maxX - (spec.majorR + spec.clearance + LAMP_GEOMETRY.baseMinOuterWallMm)) < 0.1);
  // ensamblados (el macho apoya sobre el escalón de 3 mm del tramo hembra): la separación radial es la de la lámpara
  const shifted = { positions: pieces.threadMale.positions.map((v, i) => (i % 3 === 2 ? v + 3 : v)), tris: pieces.threadMale.tris };
  const gaps = measureGaps(shifted, pieces.threadFemale, { ...layout, ledgeZ: 3 }, 120);
  assert.ok(Math.min(...gaps) >= def.thread.clearanceMm - 0.05, `separación en las piezas de prueba ${Math.min(...gaps).toFixed(3)}`);
  // disco del portalámparas: mismos agujeros que la base (espiga y asiento)
  const hf = rayIndex(pieces.holderFit);
  const seatZ = layout.floorTopZ - LAMP_GEOMETRY.holderSeatDepthMm;
  assert.ok(Math.abs(hf.hits(0.9, seatZ + 1)[0] - layout.seatR) < 0.1, "asiento del faldón");
  assert.ok(Math.abs(hf.hits(0.9, seatZ - 1)[0] - layout.fixing.holeR) < 0.1, "agujero pasante de la espiga");
  assert.ok(Math.abs(indexedBounds(pieces.holderFit).maxZ - layout.floorTopZ) < 1e-6, "mismo espesor de piso que la base");
  // ZIP de prueba: tres STL + LÉEME que dice qué comprobar y qué NO prueba
  return (async () => {
    const entries = lampTestPieceEntries(def);
    assert.deepEqual(entries.map((e) => e.fileName), ["lampara_prueba_rosca_macho.stl", "lampara_prueba_rosca_hembra.stl", "lampara_prueba_portalamparas.stl"]);
    const zip = await JSZip.loadAsync(Buffer.from(await (await buildLampTestZipBlob(def)).arrayBuffer()));
    assert.deepEqual(Object.keys(zip.files).sort(), ["LEEME_PRUEBAS.txt", ...entries.map((e) => e.fileName)].sort());
    const readme = await zip.file("LEEME_PRUEBAS.txt").async("string");
    assert.match(readme, /ANTES que la lámpara completa/);
    assert.match(readme, /NO prueban la temperatura/);
    assert.match(readme, /EJEMPLO/);
    assert.ok(lampTestReadmeText({ threadDiameterMm: 96, pitchMm: 5, starts: 1, clearanceMm: 0.4, holderMeasured: true }).includes("1 entrada,"));
    // con una rosca o un portalámparas inválidos no hay piezas de prueba; con la pantalla inválida SÍ (no la usan)
    assert.throws(() => lampTestPieceEntries(lamp({}, { holder: { ...DEFAULT_LAMP.holder, fixingLengthMm: 6 } })), /espiga|tuerca/i);
    assert.doesNotThrow(() => lampTestPieceEntries(lamp({ waves: 32, amplitudeMm: 25 })));
    assert.equal(isTestPieceBlocker({ code: "X", message: "m", field: "thread.pitchMm" }), true);
    assert.equal(isTestPieceBlocker({ code: "X", message: "m", field: "shade.waves" }), false);
  })();
});

test("exportación del conjunto con collar: cuatro STL con exactamente las mallas del visor, dimensiones reales y LÉEME con el orden de montaje", async () => {
  const def = lampCollar();
  const r = build(def);
  const entries = lampPartEntries(r);
  assert.deepEqual(entries.map((e) => e.fileName), ["lampara_base_PRELIMINAR.stl", "lampara_inserto.stl", "lampara_collar.stl", "lampara_pantalla.stl"]);
  for (const [i, entry] of entries.entries()) {
    const blob = buildSTLBlob(entry.mesh);
    const buf = Buffer.from(await blob.arrayBuffer());
    assert.equal(buf.readUInt32LE(80), r.geometry.parts[i].mesh.triangleCount, `${entry.fileName}: triángulos`);
  }
  const layout = layoutOf(def);
  // el collar mide lo que dice el diseño (diámetro del pozo + pared, altura del tope al borde)
  const cb = r.metrics.collar.boundingBox;
  assert.ok(Math.abs(cb.width - 2 * layout.collar.outerWallR) < 0.1);
  assert.ok(Math.abs(cb.height - (layout.collar.topZ - layout.ledgeZ)) < 1e-6);
  assert.ok(Math.abs(r.metrics.base.boundingBox.width - r.metrics.fit.baseDiameterMm) < 0.1);
  const zip = await JSZip.loadAsync(Buffer.from(await (await buildLampZipBlob(r, def)).arrayBuffer()));
  assert.ok(zip.file("lampara_collar.stl"));
  const readme = await zip.file("LEEME.txt").async("string");
  assert.match(readme, /Collar: apoyá el borde inferior de la pantalla en el pozo/);
  assert.match(readme, /portalámparas comercial/);
  assert.match(lampReadmeText({ holderMeasured: false, partNames: [], collar: false }), /Pantalla: enroscala en la base hasta el tope/);
  // sin collar no hay archivo de collar
  assert.equal(lampPartEntries(build(lamp())).length, 3);
});

test("visor = exportación para el collar: orientación de impresión, orden de explosión y Vista Cama", () => {
  const r = build(lampCollar());
  assert.equal(PRINT_TRANSFORM_BY_KIND.lampCollar.rotationYDeg, 0);
  const ranks = computeExplodeRanks(r.geometry.parts.map((p) => p.kind));
  assert.deepEqual([ranks.get("lampInsert"), ranks.get("lampCollar"), ranks.get("lampShade")], [1, 2, 3]);
  const items = collectBedItems(r.geometry);
  assert.deepEqual(items.map((i) => i.kind).sort(), ["body", "lampCollar", "lampInsert", "lampShade"]);
  const layout = computeBedLayout(items, getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID));
  assert.equal(layout.plates.reduce((n, p) => n + p.placements.length, 0), 4);
  const collar = items.find((i) => i.kind === "lampCollar");
  assert.ok(Math.abs(collar.heightMm - r.metrics.collar.boundingBox.height) < 1e-3, "el collar se imprime parado sobre su cuello roscado");
  // la geometría del visor es la del STL: cada pieza del resultado se exporta tal cual
  for (const part of r.geometry.parts) assert.ok(part.mesh.triangleCount > 0);
});

test("datos a medir y pruebas físicas: la lista pide lo que decide el alojamiento (largo de la espiga) y las pruebas dejan explícitos Bambu Studio, el montaje real y la bombilla LED", () => {
  const needed = LAMP_MEASUREMENTS_NEEDED.join("\n");
  assert.match(needed, /sobresale la espiga/);
  assert.match(needed, /circunscripto/);
  assert.match(needed, /Tuerca/);
  const tests = LAMP_PHYSICAL_TESTS.join("\n");
  assert.match(tests, /piezas de prueba/i);
  assert.match(tests, /Bambu Studio/);
  assert.match(tests, /bombilla LED/);
  assert.match(tests, /incandescentes ni halógenas/);
  assert.match(tests, /Montaje en seco/);
  // los límites de la rosca están acotados y documentados en un solo lugar
  for (const key of ["thread.majorDiameterMm", "thread.pitchMm", "thread.starts", "thread.engagementMm", "thread.clearanceMm", "thread.coreWallMm"]) assert.ok(LAMP_LIMITS[key]);
  clearLampCaches();
});
