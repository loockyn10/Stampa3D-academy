import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";

// Lámparas V4 (EXPERIMENTO): pantalla de doble pared — prototipo A (sección en C, modo jarrón) y B (anillos cerrados + nervios).
// Todo se mide sobre las MALLAS generadas: distancias punto–triángulo, rayos, cortes por capa, topología.
// Son pruebas GEOMÉTRICAS: NO son pruebas de impresión ni de laminado (ningún laminador se ejecutó).

const dw = loadMakerModule("lib/maker/lamps/experiments/doubleWall/index.ts");
const { DEFAULT_DOUBLE_WALL: D } = dw;
const { analyzeMesh, meshToSoup, indexedBounds } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { createSilhouette } = loadMakerModule("lib/maker/lamps/openwork/silhouette.ts");

const withParams = (patch = {}, outer = {}, inner = {}) => ({ ...D, ...patch, outer: { ...D.outer, ...outer }, inner: { ...D.inner, ...inner } });
const buildA = (p = D) => dw.buildDoubleWall(p, "vase-c");
const buildB = (p = D) => dw.buildDoubleWall(p, "conventional");

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

/** Vértices (x, y, z) de los triángulos de un grupo de superficie. */
function groupTriangles(build, name) {
  const p = build.mesh.positions;
  const out = [];
  for (const [from, to] of build.groups[name] ?? []) {
    for (let t = from; t < to; t++) {
      const a = build.mesh.tris[t * 3] * 3, b = build.mesh.tris[t * 3 + 1] * 3, c = build.mesh.tris[t * 3 + 2] * 3;
      out.push([[p[a], p[a + 1], p[a + 2]], [p[b], p[b + 1], p[b + 2]], [p[c], p[c + 1], p[c + 2]]]);
    }
  }
  return out;
}
function groupVertices(build, name) {
  const seen = new Set();
  const out = [];
  for (const [from, to] of build.groups[name] ?? []) {
    for (let t = from; t < to; t++) {
      for (let k = 0; k < 3; k++) {
        const v = build.mesh.tris[t * 3 + k];
        if (seen.has(v)) continue;
        seen.add(v);
        out.push([build.mesh.positions[v * 3], build.mesh.positions[v * 3 + 1], build.mesh.positions[v * 3 + 2]]);
      }
    }
  }
  return out;
}

/** Distancia mínima (euclídea 3D) entre los vértices de una superficie y los triángulos de otra, medida sobre las MALLAS. */
function meshSeparation(build, fromName, toName, stride = 23) {
  const verts = groupVertices(build, fromName).filter((_, i) => i % stride === 0);
  const tris = groupTriangles(build, toName);
  let min = Infinity, atZ = 0;
  for (const v of verts) {
    for (const [a, b, c] of tris) {
      if (Math.min(a[2], b[2], c[2]) - v[2] > min || v[2] - Math.max(a[2], b[2], c[2]) > min) continue;
      const d = pointTriangleDistance(v, a, b, c);
      if (d < min) { min = d; atZ = v[2]; }
    }
  }
  return { min, atZ };
}

/** Cruces de un rayo horizontal (origen (ox, oy, z), dirección unitaria (dx, dy, 0)) con la malla. */
function castRay(mesh, ox, oy, z, dx, dy) {
  const p = mesh.positions;
  const hits = [];
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const a = mesh.tris[i] * 3, b = mesh.tris[i + 1] * 3, c = mesh.tris[i + 2] * 3;
    if (z < Math.min(p[a + 2], p[b + 2], p[c + 2]) || z > Math.max(p[a + 2], p[b + 2], p[c + 2])) continue;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const hx = dy * e2z, hy = -dx * e2z, hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det;
    const sx = ox - p[a], sy = oy - p[a + 1], sz = z - p[a + 2];
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (dx * qx + dy * qy);
    if (v < 0 || u + v > 1) continue;
    const t = f * (e2x * qx + e2y * qy + e2z * qz);
    if (t > 1e-9) hits.push(t);
  }
  hits.sort((m, n) => m - n);
  return hits.filter((t, k) => k === 0 || t - hits[k - 1] > 1e-6);
}

// ------------------------------------------------------------------ perfiles
test("perfil exterior: abombado, diámetro máximo y bordes verificados sobre la malla; estrías del número y profundidad pedidos", () => {
  const b = buildA();
  const surf = dw.createDoubleWallSurfaces(D);
  const verts = groupVertices(b, "outerFace");
  let maxR = 0;
  const radiusAtZ = new Map();
  for (const [x, y, z] of verts) {
    const r = Math.hypot(x, y);
    maxR = Math.max(maxR, r);
    const key = z.toFixed(3);
    const e = radiusAtZ.get(key) ?? { min: Infinity, max: 0 };
    e.min = Math.min(e.min, r);
    e.max = Math.max(e.max, r);
    radiusAtZ.set(key, e);
  }
  assert.ok(Math.abs(2 * maxR - D.outer.maxDiameterMm) < 0.15, `Ø máximo ${2 * maxR}`);
  assert.ok(Math.abs(2 * radiusAtZ.get("0.000").max - D.outer.endDiameterMm) < 0.15, "Ø del borde inferior");
  assert.ok(Math.abs(2 * radiusAtZ.get("120.000").max - D.outer.endDiameterMm) < 0.15, "Ø del borde superior");
  // abombada: el máximo cae a la mitad
  const zMax = [...radiusAtZ.entries()].sort((m, n) => n[1].max - m[1].max)[0][0];
  assert.ok(Math.abs(Number(zMax) - 60) <= D.rowMm, `máximo a ${zMax} mm`);
  // estrías: profundidad cresta–valle = amplitud en todas las alturas, y la malla coincide con la superficie analítica
  for (const [key, e] of radiusAtZ) assert.ok(Math.abs(e.max - e.min - D.outer.fluteAmplitudeMm) < 0.02, `profundidad de estría a ${key}: ${e.max - e.min}`);
  for (const [x, y, z] of verts.filter((_, i) => i % 53 === 0)) {
    const r = Math.hypot(x, y);
    assert.ok(Math.abs(r - surf(z).ro(Math.atan2(y, x))) < 1e-6, "vértice fuera de la superficie exterior");
  }
  // cantidad de estrías: cruces por la cresta sobre una altura fija
  const z = [...radiusAtZ.keys()].find((k) => Math.abs(Number(k) - 60) < 0.01);
  const ring = verts.filter((v) => v[2].toFixed(3) === z).map(([x, y]) => ({ th: Math.atan2(y, x), r: Math.hypot(x, y) })).sort((m, n) => m.th - n.th);
  const mean = ring.reduce((s, v) => s + v.r, 0) / ring.length;
  let up = 0;
  for (let i = 0; i < ring.length; i++) if (ring[i].r < mean && ring[(i + 1) % ring.length].r >= mean) up++;
  assert.equal(up, D.outer.flutes, "cantidad de estrías");
});

test("perfil interior: reloj de arena (cintura en la posición pedida) y cara de la pared del diámetro pedido, independiente del exterior", () => {
  const b = buildA();
  const byZ = new Map();
  for (const [x, y, z] of groupVertices(b, "chamberInner")) {
    const key = z.toFixed(3);
    byZ.set(key, Math.max(byZ.get(key) ?? 0, Math.hypot(x, y)));
  }
  const ends = byZ.get("0.000");
  assert.ok(Math.abs(2 * ends - D.inner.endDiameterMm) < 0.05 && Math.abs(2 * byZ.get("120.000") - D.inner.endDiameterMm) < 0.05, "Ø de los bordes");
  const waist = [...byZ.entries()].sort((m, n) => m[1] - n[1])[0];
  assert.ok(Math.abs(Number(waist[0]) - 60) <= D.rowMm, `cintura a ${waist[0]} mm`);
  assert.ok(waist[1] < ends * 0.7, `cintura Ø${2 * waist[1]} vs bordes Ø${2 * ends}`);
  // monótona hacia la cintura (sin ondas): reloj de arena puro
  const zs = [...byZ.keys()].map(Number).sort((m, n) => m - n);
  for (let i = 1; i < zs.length; i++) {
    const r0 = byZ.get(zs[i - 1].toFixed(3)), r1 = byZ.get(zs[i].toFixed(3));
    if (zs[i] <= 60) assert.ok(r1 <= r0 + 1e-9, "la mitad inferior se angosta hacia arriba");
    else assert.ok(r1 >= r0 - 1e-9, "la mitad superior se ensancha");
  }
  // independencia: cambiar la pared interior NO mueve ningún vértice de la exterior (ni al revés)
  const other = buildA(withParams({}, {}, { waistPct: 20, endDiameterMm: 50 }));
  const sig = (bb, name) => groupVertices(bb, name).map((v) => v.map((n) => n.toFixed(6)).join(",")).sort().join("|");
  assert.equal(sig(other, "outerFace"), sig(b, "outerFace"));
  const other2 = buildA(withParams({}, { maxDiameterMm: 150, fluteAmplitudeMm: 2 }));
  assert.equal(sig(other2, "innerFace"), sig(b, "innerFace"));
  // la silueta exterior es la del motor compartido
  const sil = createSilhouette({ bottomDiameterMm: 110, topDiameterMm: 110, maxDiameterMm: 140, bulgePositionPct: 50, curvaturePct: 40, waistPct: 0, organicPct: 0, seed: 0 });
  assert.ok(Math.abs(sil(0.5) - 70) < 1e-9);
});

// ------------------------------------------------------------------ separación entre paredes
test("separación mínima: medida con distancias punto–triángulo sobre las mallas (estrías incluidas) y ≥ 20 mm", () => {
  for (const [name, b] of [["A", buildA()], ["B", buildB()]]) {
    const m = meshSeparation(b, "chamberOuter", "chamberInner");
    assert.ok(m.min >= 20 - 1e-3, `${name}: separación medida ${m.min.toFixed(3)} mm (z=${m.atZ})`);
    // el valor analítico y el medido sobre la malla coinciden (la malla facetada puede quedar apenas por encima)
    const analytic = dw.measureChamberGap(D);
    assert.ok(Math.abs(m.min - analytic.minGapMm) < 0.35, `analítica ${analytic.minGapMm.toFixed(3)} vs malla ${m.min.toFixed(3)}`);
    // y no es solo la diferencia nominal de radios: con estrías la cara exterior se acerca más que (radio exterior − radio interior)
    const surf = dw.createDoubleWallSurfaces(D)(60);
    assert.ok(analytic.minGapMm < surf.crest - surf.rio, "la separación real es menor que la nominal entre crestas");
  }
  const g = dw.measureChamberGap(D);
  assert.ok(g.minGapMm >= 20 && g.minGapMm < 21.5, `separación de referencia ${g.minGapMm}`);
});

test("la separación se mide con otras alturas, diámetros, curvaturas y estrías, y una combinación incompatible se rechaza con el motivo", () => {
  const variants = [
    withParams({ heightMm: 90 }),
    withParams({ heightMm: 160 }),
    withParams({}, { maxDiameterMm: 160, endDiameterMm: 120 }, { endDiameterMm: 64 }),
    withParams({}, { curvaturePct: 10 }),
    withParams({}, { curvaturePct: 90 }),
    withParams({}, { flutes: 16, fluteAmplitudeMm: 4 }, { endDiameterMm: 56 }),
    withParams({}, { flutes: 36, fluteAmplitudeMm: 1.5 }),
    withParams({}, { twistDeg: 90 }),
    withParams({}, {}, { waistPct: 85 }),
    withParams({}, {}, { waistPct: 0 }),
  ];
  for (const [i, p] of variants.entries()) {
    const v = dw.validateDoubleWall(p);
    assert.deepEqual(v.errors.map((e) => e.code), [], `variante ${i}: ${JSON.stringify(v.errors)}`);
    const a = buildA(p), b = buildB(p);
    assertClean(a.mesh, `A ${i}`);
    assertClean(b.mesh, `B ${i}`);
    const m = meshSeparation(a, "chamberOuter", "chamberInner", 41);
    assert.ok(m.min >= p.minGapMm - 1e-3, `variante ${i}: separación en la malla ${m.min.toFixed(2)}`);
    assert.ok(Math.abs(m.min - v.gap.minGapMm) < 0.6, `variante ${i}: analítica ${v.gap.minGapMm.toFixed(2)} vs malla ${m.min.toFixed(2)}`);
  }
  // rechazos
  const tooWide = dw.validateDoubleWall(withParams({}, {}, { endDiameterMm: 70 }));
  assert.ok(tooWide.errors.some((e) => e.code === "DW_GAP" && /20/.test(e.message)), "pared interior demasiado ancha");
  assert.throws(() => dw.createDoubleWallPrototype("vase-c", withParams({}, {}, { endDiameterMm: 70 })), /DW_GAP/);
  assert.ok(dw.validateDoubleWall(withParams({}, { fluteAmplitudeMm: 8, flutes: 30 })).errors.some((e) => e.code === "DW_FLUTE_SHARP" || e.code === "DW_FLUTE_DEPTH"), "estrías demasiado agudas");
  assert.ok(dw.validateDoubleWall(withParams({ slitMm: 0.2 })).errors.some((e) => e.code === "DW_SLIT"));
  assert.ok(dw.validateDoubleWall(withParams({ wallMm: 0.4 })).errors.some((e) => e.code === "DW_WALL_THIN"));
  assert.ok(dw.validateDoubleWall(withParams({ heightMm: NaN })).errors.some((e) => e.code === "DW_PARAM_RANGE"));
  assert.ok(dw.validateDoubleWall(withParams({}, { flutes: 2 })).errors.some((e) => e.code === "DW_FLUTES"));
  assert.ok(dw.validateDoubleWall(withParams({}, { maxDiameterMm: 100 })).errors.some((e) => e.code === "DW_BULGE"));
});

// ------------------------------------------------------------------ topología
test("ambos prototipos: mallas cerradas, orientadas, sin triángulos degenerados y de una sola componente; sin autointersecciones por capa", () => {
  for (const [name, b] of [["A vase-c", buildA()], ["B conventional", buildB()]]) {
    const r = assertClean(b.mesh, name);
    assert.ok(r.triangleCount > 50000 && r.triangleCount < 200000, `${name}: ${r.triangleCount} triángulos`);
    assert.equal(dw.countComponents(b.mesh), 1, `${name}: componentes`);
    for (const z of [0.0123, 7.31, 33.7, 60.0123, 88.45, 119.9877]) {
      const l = dw.summarizeLayer(b.mesh, z, true);
      assert.equal(l.selfIntersections, 0, `${name} z=${z}: autointersección`);
      assert.equal(l.outerContours, 1, `${name} z=${z}: un único contorno exterior`);
      assert.ok(l.nested, `${name} z=${z}: huecos dentro del contorno`);
    }
  }
});

test("prototipo A: cada capa tiene UN contorno exterior continuo y UN hueco (la cámara); el contorno recorre ambas paredes", () => {
  const b = buildA();
  const surf = dw.createDoubleWallSurfaces(D);
  for (let z = 0.0123; z < 120; z += 1.37) {
    const loops = dw.sliceMesh(b.mesh, z);
    const outer = loops.filter((l) => l.area > 0), holes = loops.filter((l) => l.area < 0);
    assert.equal(outer.length, 1, `z=${z.toFixed(2)}: contornos exteriores`);
    assert.equal(holes.length, 1, `z=${z.toFixed(2)}: huecos`);
    assert.equal(loops.length, 2);
    // un único contorno que pasa por la cara exterior de la pared exterior Y por la cara de la pared interior que mira al vacío central
    const radii = outer[0].points.map(([x, y]) => Math.hypot(x, y));
    const s = surf(z);
    assert.ok(Math.max(...radii) > s.crest - 0.2 && Math.max(...radii) <= s.crest + 0.05, "pasa por la cara exterior");
    assert.ok(Math.abs(Math.min(...radii) - s.rii) < 0.05, `pasa por la cara de la pared interior (r=${s.rii.toFixed(2)})`);
    // el hueco (cámara) no toca el contorno: queda a un espesor de pared de distancia como mínimo
    assert.ok(holes[0].area < 0 && Math.abs(holes[0].area) > 1000);
  }
  // el contorno exterior es mucho más largo que el de un solo anillo: lleva las dos paredes y los dos flancos
  const l = dw.summarizeLayer(b.mesh, 60.0123, false);
  const surf60 = surf(60.0123);
  const approx = 2 * Math.PI * (surf60.crest - D.outer.fluteAmplitudeMm / 2) + 2 * Math.PI * surf60.rii;
  assert.ok(l.outerLength > approx * 0.98 && l.outerLength < approx * 1.3, `longitud ${l.outerLength.toFixed(0)} vs ${approx.toFixed(0)}`);
});

test("prototipo B: cada capa tiene un contorno circular, un hueco central y un hueco por sector de la cámara; sin abertura", () => {
  const b = buildB();
  for (let z = 0.0123; z < 120; z += 3.13) {
    const loops = dw.sliceMesh(b.mesh, z);
    assert.equal(loops.filter((l) => l.area > 0).length, 1);
    assert.equal(loops.filter((l) => l.area < 0).length, D.ribs + 1, `z=${z.toFixed(2)}: huecos`);
  }
  // no hay abertura: un rayo desde el centro en cualquier dirección atraviesa material (pared interior y exterior)
  for (let k = 0; k < 90; k++) {
    const th = (2 * Math.PI * (k + 0.37)) / 90;
    const hits = castRay(b.mesh, 0, 0, 60.05, Math.cos(th), Math.sin(th));
    assert.ok(hits.length === 2 || hits.length === 4 || hits.length === 6, `θ=${th.toFixed(2)}: ${hits.length} cruces`);
    assert.ok(hits.length >= 4 || Math.abs(Math.sin(2 * (th - Math.PI)) ) < 1, "pared exterior e interior cerradas");
  }
  // los nervios son de altura completa: en el azimut de un nervio el rayo atraviesa un único tramo macizo desde la pared interior a la exterior
  for (const z of [5.05, 60.05, 115.05]) {
    const hits = castRay(b.mesh, 0, 0, z, Math.cos(Math.PI), Math.sin(Math.PI));
    assert.equal(hits.length, 2, `nervio a z=${z}`);
  }
});

// ------------------------------------------------------------------ abertura posterior
test("abertura posterior: ancho configurable medido con rayos (1, 1,5, 2 y 3 mm), pasante de la cara interior a la exterior en toda la altura", () => {
  for (const slit of [1, 1.5, 2, 3]) {
    const p = withParams({ slitMm: slit });
    assert.deepEqual(dw.validateDoubleWall(p).errors, []);
    const b = buildA(p);
    assertClean(b.mesh, `abertura ${slit}`);
    assert.equal(dw.countComponents(b.mesh), 1);
    // los flancos son planos paralelos a ±slit/2 del eje de la abertura (el eje apunta a −X: el plano es y = ±slit/2)
    for (const [, y] of groupVertices(b, "flanks")) assert.ok(Math.abs(Math.abs(y) - slit / 2) < 1e-9, `flanco en y=${y}`);
    for (const z of [3.01, 40.01, 60.01, 77.7, 117.01]) {
      // el rayo desde el centro hacia −X (por el eje de la abertura) no toca nada
      assert.equal(castRay(b.mesh, 0, 0, z, -1, 0).length, 0, `abertura obstruida a z=${z}`);
      // ancho libre: se barre y a ambos lados del eje con rayos paralelos a −X y se mide el tramo sin cruces
      let lo = 0, hi = 0;
      for (let y = 0; y < slit + 2; y += 0.02) if (castRay(b.mesh, 0, y, z, -1, 0).length === 0) hi = y; else break;
      for (let y = 0; y > -(slit + 2); y -= 0.02) if (castRay(b.mesh, 0, y, z, -1, 0).length === 0) lo = y; else break;
      assert.ok(Math.abs(hi - lo - slit) < 0.05, `ancho libre ${hi - lo} vs ${slit} (z=${z})`);
      // justo fuera de la abertura el rayo atraviesa la placa de unión y la pared (un solo tramo macizo)
      assert.equal(castRay(b.mesh, 0, slit / 2 + 0.3, z, -1, 0).length, 2, "placa de unión");
    }
  }
});

test("flancos de unión: placas macizas que unen las dos paredes en los extremos de la abertura (la cámara no se comunica con la abertura)", () => {
  const b = buildA();
  const surf = dw.createDoubleWallSurfaces(D);
  for (const z of [10.01, 60.01, 110.01]) {
    const s = surf(z);
    // a lo largo de la placa (y = slit/2 + t/2) el material es continuo desde la pared interior hasta la exterior: 2 cruces en total
    const y = D.slitMm / 2 + D.wallMm / 2;
    const hits = castRay(b.mesh, 0, y, z, -1, 0);
    assert.equal(hits.length, 2);
    assert.ok(Math.abs(hits[0] - s.rii) < 0.1 && hits[1] > s.crest - D.outer.fluteAmplitudeMm - 0.2, `entra en la pared interior (${hits[0].toFixed(2)}) y sale por la exterior (${hits[1].toFixed(2)})`);
    // y justo dentro de la cámara (más allá de la placa) el rayo cruza 4 veces: pared interior, cámara vacía, pared exterior
    const chamberHits = castRay(b.mesh, 0, y + D.wallMm / 2 + 3, z, -1, 0);
    assert.equal(chamberHits.length, 4);
    assert.ok(chamberHits[2] - chamberHits[1] > 15, "cámara de aire");
  }
});

// ------------------------------------------------------------------ comparabilidad y tapas
test("los dos prototipos comparten silueta exterior, silueta interior, altura, orientación y separación", () => {
  const a = buildA(), b = buildB();
  const surf = dw.createDoubleWallSurfaces(D);
  for (const [name, build] of [["A", a], ["B", b]]) {
    for (const [x, y, z] of groupVertices(build, "outerFace").filter((_, i) => i % 31 === 0)) assert.ok(Math.abs(Math.hypot(x, y) - surf(z).ro(Math.atan2(y, x))) < 1e-6, `${name}: cara exterior`);
    for (const [x, y, z] of groupVertices(build, "innerFace").filter((_, i) => i % 11 === 0)) assert.ok(Math.abs(Math.hypot(x, y) - surf(z).rii) < 1e-6, `${name}: cara de la pared interior`);
    for (const [x, y, z] of groupVertices(build, "chamberInner").filter((_, i) => i % 11 === 0)) assert.ok(Math.abs(Math.hypot(x, y) - surf(z).rio) < 1e-6, `${name}: cara de la cámara`);
  }
  const ba = indexedBounds(a.mesh), bb = indexedBounds(b.mesh);
  assert.equal(ba.minZ, 0);
  assert.equal(bb.minZ, 0);
  assert.ok(Math.abs(ba.maxZ - 120) < 1e-9 && Math.abs(bb.maxZ - 120) < 1e-9);
  assert.ok(Math.abs((ba.maxX - ba.minX) - (bb.maxX - bb.minX)) < 0.2);
  // espesor del modelo: distancia de los vértices de la cara interior de la pared exterior a su cara exterior ≈ espesor (normal a la superficie)
  const outerTris = groupTriangles(a, "outerFace");
  let worst = Infinity, best = 0;
  for (const v of groupVertices(a, "chamberOuter").filter((_, i) => i % 61 === 0)) {
    let d = Infinity;
    for (const [p, q, r] of outerTris) if (Math.abs(p[2] - v[2]) < 4) d = Math.min(d, pointTriangleDistance(v, p, q, r));
    worst = Math.min(worst, d);
    best = Math.max(best, d);
  }
  assert.ok(worst > D.wallMm * 0.9 && best < D.wallMm * 1.12, `espesor medido ${worst.toFixed(3)}–${best.toFixed(3)} (pedido ${D.wallMm})`);
});

test("tapas: sin triángulos invertidos (normales −z abajo y +z arriba) y el área de cada tapa es la de la sección", () => {
  for (const [name, b] of [["A", buildA()], ["B", buildB()]]) {
    const p = b.mesh.positions;
    let bottom = 0, top = 0;
    for (const [from, to] of b.groups.caps) {
      for (let t = from; t < to; t++) {
        const a = b.mesh.tris[t * 3] * 3, c = b.mesh.tris[t * 3 + 2] * 3, m = b.mesh.tris[t * 3 + 1] * 3;
        const area = ((p[m] - p[a]) * (p[c + 1] - p[a + 1]) - (p[m + 1] - p[a + 1]) * (p[c] - p[a])) / 2;
        if (p[a + 2] < 1e-9) { assert.ok(area < 0, `${name}: triángulo invertido en la tapa inferior`); bottom += -area; }
        else { assert.ok(area > 0, `${name}: triángulo invertido en la tapa superior`); top += area; }
      }
    }
    for (const [cap, z] of [[bottom, 0.0007], [top, 119.9993]]) {
      const loops = dw.sliceMesh(b.mesh, z);
      const sectionArea = loops.reduce((s, l) => s + l.area, 0);
      assert.ok(Math.abs(cap - sectionArea) / sectionArea < 0.01, `${name}: área de la tapa ${cap.toFixed(1)} vs sección ${sectionArea.toFixed(1)}`);
    }
  }
});

// ------------------------------------------------------------------ exportación, reproducibilidad, fixtures
test("exportación STL: binario válido, mismas dimensiones y cantidad de triángulos que la malla, y reproducible byte a byte", async () => {
  const bytes = async (strategy) => {
    const proto = dw.createDoubleWallPrototype(strategy);
    const blob = buildSTLBlob(meshToSoup(proto.build.mesh, 45));
    return { proto, buf: Buffer.from(await blob.arrayBuffer()) };
  };
  for (const strategy of ["vase-c", "conventional"]) {
    const one = await bytes(strategy), two = await bytes(strategy);
    assert.ok(one.buf.equals(two.buf), `${strategy}: no reproducible`);
    assert.equal(one.buf.length, 84 + 50 * one.proto.report.triangles);
    assert.equal(one.buf.readUInt32LE(80), one.proto.report.triangles);
    assert.equal(one.proto.report.stlBytes, one.buf.length);
    // dimensiones leídas del propio STL
    let minZ = Infinity, maxZ = -Infinity, maxR = 0;
    for (let t = 0; t < one.proto.report.triangles; t++) for (let k = 0; k < 3; k++) {
      const x = one.buf.readFloatLE(84 + t * 50 + 12 + k * 12), y = one.buf.readFloatLE(84 + t * 50 + 16 + k * 12), z = one.buf.readFloatLE(84 + t * 50 + 20 + k * 12);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); maxR = Math.max(maxR, Math.hypot(x, y));
    }
    assert.equal(minZ, 0);
    assert.ok(Math.abs(maxZ - 120) < 1e-4 && Math.abs(2 * maxR - 140) < 0.15, `${strategy}: ${maxZ} × Ø${2 * maxR}`);
    assert.ok(one.proto.report.watertight && one.proto.report.components === 1);
    // el reporte coincide con la malla
    assert.ok(Math.abs(one.proto.report.boundingBoxMm.height - 120) < 1e-9);
  }
});

test("los STL guardados en tests/fixtures/maker-double-wall son exactamente los que genera el motor (si faltan, se regeneran con scripts/generate-double-wall-prototypes.mjs)", async () => {
  const dir = path.resolve("tests/fixtures/maker-double-wall");
  for (const [strategy, file] of [["vase-c", "double-wall-vase-test.stl"], ["conventional", "double-wall-conventional-test.stl"]]) {
    const target = path.join(dir, file);
    assert.ok(fs.existsSync(target), `falta ${file}: node scripts/generate-double-wall-prototypes.mjs`);
    const proto = dw.createDoubleWallPrototype(strategy);
    const fresh = Buffer.from(await buildSTLBlob(meshToSoup(proto.build.mesh, 45)).arrayBuffer());
    assert.ok(fs.readFileSync(target).equals(fresh), `${file} no coincide con el motor actual`);
  }
  const report = JSON.parse(fs.readFileSync(path.join(dir, "double-wall-report.json"), "utf8"));
  assert.match(report.note, /NO son resultados de laminado/);
  assert.equal(report.prototypes["vase-c"].components, 1);
});

test("el experimento está aislado: nada del generador publicado, la UI ni las otras herramientas lo importa", () => {
  const root = path.resolve("src");
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) {
        if (f.includes(path.join("lamps", "experiments"))) continue;
        walk(f);
      } else if (/\.(ts|tsx)$/.test(e.name) && /experiments\/doubleWall/.test(fs.readFileSync(f, "utf8"))) offenders.push(f);
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
  // y el catálogo/disponibilidad no lo listan como herramienta
  const availability = fs.readFileSync(path.join(root, "lib/maker/availability.ts"), "utf8");
  assert.ok(!/double-?wall/i.test(availability));
});

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

test("todas las capas de 0,2 mm: la topología de la sección no cambia (A: 1 contorno + 1 hueco; B: 1 + 5) y la longitud del contorno varía sin saltos", () => {
  const a = dw.createDoubleWallPrototype("vase-c").report.layerStats;
  assert.equal(a.layers, 600);
  assert.deepEqual(a.outerContours, [1, 1]);
  assert.deepEqual(a.holes, [1, 1]);
  assert.ok(a.maxLengthJumpPct < 1, `salto máximo de longitud entre capas consecutivas: ${a.maxLengthJumpPct} %`);
  const b = dw.createDoubleWallPrototype("conventional").report.layerStats;
  assert.deepEqual(b.outerContours, [1, 1]);
  assert.deepEqual(b.holes, [D.ribs + 1, D.ribs + 1]);
});
