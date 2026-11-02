import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadMakerModule } from "../scripts/lib/maker-engine-node.mjs";

// Lámparas V4/V4.1 (EXPERIMENTO): pantalla de doble pared — prototipo A (sección en C, candidato a modo jarrón) y B (anillos
// cerrados, impresión convencional), ahora con piso y techo que unen las paredes y conservan la abertura central.
// Todo se mide sobre las MALLAS generadas: distancias punto–triángulo, rayos, cortes por capa y verticales, topología.
// Son pruebas GEOMÉTRICAS: NO son pruebas de impresión ni de laminado (ningún laminador se ejecutó). Una malla cerrada y válida
// NO es lo mismo que una geometría compatible con modo jarrón: se verifican por separado.

const dw = loadMakerModule("lib/maker/lamps/experiments/doubleWall/index.ts");
const { DEFAULT_DOUBLE_WALL: D } = dw;
const { analyzeMesh, meshToSoup, indexedBounds } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");
const { createSilhouette } = loadMakerModule("lib/maker/lamps/openwork/silhouette.ts");

const withParams = (patch = {}, outer = {}, inner = {}) => ({ ...D, ...patch, outer: { ...D.outer, ...outer }, inner: { ...D.inner, ...inner } });
const buildA = (p = D) => dw.buildDoubleWall(p, "vase-c");
const buildB = (p = D) => dw.buildDoubleWall(p, "conventional");
const Z = dw.doubleWallZones(D);

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

/** Separación mínima entre las caras de la cámara (3D, punto–triángulo sobre las MALLAS) en la zona de paredes rectas [zLo, zHi]. */
function meshSeparation(build, zLo, zHi, stride = 23) {
  const verts = groupVertices(build, "chamberOuter").filter((v) => v[2] >= zLo - 1e-6 && v[2] <= zHi + 1e-6).filter((_, i) => i % stride === 0);
  const tris = groupTriangles(build, "chamberInner").filter((t) => Math.max(t[0][2], t[1][2], t[2][2]) <= zHi + 1e-6 && Math.min(t[0][2], t[1][2], t[2][2]) >= zLo - 1e-6);
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
test("perfil exterior: abombado, diámetro máximo y borde inferior verificados sobre la malla; estrías del número y profundidad pedidos", () => {
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
  const zMax = [...radiusAtZ.entries()].sort((m, n) => n[1].max - m[1].max)[0][0];
  assert.ok(Math.abs(Number(zMax) - 60) <= D.rowMm, `máximo a ${zMax} mm`);
  // estrías: profundidad cresta–valle = amplitud en toda la zona de paredes rectas; el techo las desvanece hasta un círculo
  for (const [key, e] of radiusAtZ) if (Number(key) <= Z.roofStart) assert.ok(Math.abs(e.max - e.min - D.outer.fluteAmplitudeMm) < 0.02, `profundidad de estría a ${key}: ${e.max - e.min}`);
  const top = radiusAtZ.get("120.000");
  assert.ok(top.max - top.min < 0.02, "arriba la cara exterior es circular (las estrías se desvanecen en el techo)");
  for (const [x, y, z] of verts.filter((_, i) => i % 53 === 0)) assert.ok(Math.abs(Math.hypot(x, y) - surf(z).ro(Math.atan2(y, x))) < 1e-6, "vértice fuera de la superficie exterior");
  const z = [...radiusAtZ.keys()].find((k) => Math.abs(Number(k) - 60) < 0.01);
  const ring = verts.filter((v) => v[2].toFixed(3) === z).map(([x, y]) => ({ th: Math.atan2(y, x), r: Math.hypot(x, y) })).sort((m, n) => m.th - n.th);
  const mean = ring.reduce((s, v) => s + v.r, 0) / ring.length;
  let up = 0;
  for (let i = 0; i < ring.length; i++) if (ring[i].r < mean && ring[(i + 1) % ring.length].r >= mean) up++;
  assert.equal(up, D.outer.flutes, "cantidad de estrías");
});

test("perfil interior: reloj de arena (cintura en la posición pedida), diámetro de los bordes, independiente del exterior", () => {
  const b = buildA();
  const byZ = new Map();
  for (const [x, y, z] of groupVertices(b, "chamberInner")) byZ.set(z.toFixed(3), Math.max(byZ.get(z.toFixed(3)) ?? 0, Math.hypot(x, y)));
  assert.ok(Math.abs(2 * byZ.get(Z.floorTop.toFixed(3)) - D.inner.endDiameterMm) < 0.4, "Ø del borde inferior (a la altura del piso)");
  const zs = [...byZ.keys()].map(Number).sort((m, n) => m - n).filter((v) => v <= Z.roofStart + 1e-6);
  const waist = zs.map((v) => [v, byZ.get(v.toFixed(3))]).sort((m, n) => m[1] - n[1])[0];
  assert.ok(Math.abs(waist[0] - 60) <= D.rowMm, `cintura a ${waist[0]} mm`);
  assert.ok(waist[1] < byZ.get(Z.floorTop.toFixed(3)) * 0.7);
  for (let i = 1; i < zs.length; i++) {
    const r0 = byZ.get(zs[i - 1].toFixed(3)), r1 = byZ.get(zs[i].toFixed(3));
    if (zs[i] <= 60) assert.ok(r1 <= r0 + 1e-9, "la mitad inferior se angosta hacia arriba");
    else assert.ok(r1 >= r0 - 1e-9, "la mitad superior se ensancha");
  }
  // independencia: cambiar una pared NO mueve ningún vértice de la otra
  // (en el techo las dos paredes convergen a un radio común, así que solo son independientes en la zona de paredes rectas)
  const sig = (bb, name) => groupVertices(bb, name).filter((v) => v[2] <= Z.roofStart + 1e-6).map((v) => v.map((n) => n.toFixed(6)).join(",")).sort().join("|");
  assert.equal(sig(buildA(withParams({}, {}, { waistPct: 20, endDiameterMm: 50 })), "outerFace"), sig(b, "outerFace"));
  assert.equal(sig(buildA(withParams({}, { maxDiameterMm: 150, fluteAmplitudeMm: 2 })), "innerFace"), sig(b, "innerFace"));
  assert.notEqual(sig(buildA(withParams({}, { maxDiameterMm: 150, fluteAmplitudeMm: 2 })), "outerFace"), sig(b, "outerFace"));
  const sil = createSilhouette({ bottomDiameterMm: 110, topDiameterMm: 110, maxDiameterMm: 140, bulgePositionPct: 50, curvaturePct: 40, waistPct: 0, organicPct: 0, seed: 0 });
  assert.ok(Math.abs(sil(0.5) - 70) < 1e-9);
});

// ------------------------------------------------------------------ separación entre paredes
test("separación mínima: medida con distancias punto–triángulo sobre las mallas (estrías incluidas) y ≥ 20 mm en la zona de paredes rectas", () => {
  const analytic = dw.measureChamberGap(D);
  for (const [name, b] of [["A", buildA()], ["B", buildB()]]) {
    const m = meshSeparation(b, Z.floorTop, Z.roofStart);
    assert.ok(m.min >= 20 - 1e-3, `${name}: separación medida ${m.min.toFixed(3)} mm (z=${m.atZ})`);
    assert.ok(Math.abs(m.min - analytic.minGapMm) < 0.35, `analítica ${analytic.minGapMm.toFixed(3)} vs malla ${m.min.toFixed(3)}`);
  }
  const surf = dw.createDoubleWallSurfaces(D)(60);
  assert.ok(analytic.minGapMm < surf.crest - surf.rio, "la separación real es menor que la nominal entre crestas");
  assert.ok(analytic.minGapMm >= 20 && analytic.minGapMm < 21.5, `separación de referencia ${analytic.minGapMm}`);
});

test("la separación se mide con otras alturas, diámetros, curvaturas y estrías, y una combinación incompatible se rechaza con el motivo", () => {
  const variants = [
    withParams({ heightMm: 100 }),
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
    const z = dw.doubleWallZones(p);
    const m = meshSeparation(a, z.floorTop, z.roofStart, 41);
    assert.ok(m.min >= p.minGapMm - 1e-3, `variante ${i}: separación en la malla ${m.min.toFixed(2)}`);
    assert.ok(Math.abs(m.min - v.gap.minGapMm) < 0.6, `variante ${i}: analítica ${v.gap.minGapMm.toFixed(2)} vs malla ${m.min.toFixed(2)}`);
  }
  const tooWide = dw.validateDoubleWall(withParams({}, {}, { endDiameterMm: 70 }));
  assert.ok(tooWide.errors.some((e) => e.code === "DW_GAP" && /20/.test(e.message)), "pared interior demasiado ancha");
  assert.throws(() => dw.createDoubleWallPrototype("vase-c", withParams({}, {}, { endDiameterMm: 70 })), /DW_GAP/);
  assert.ok(dw.validateDoubleWall(withParams({}, { fluteAmplitudeMm: 8, flutes: 30 })).errors.some((e) => e.code === "DW_FLUTE_SHARP" || e.code === "DW_FLUTE_DEPTH"), "estrías demasiado agudas");
  assert.ok(dw.validateDoubleWall(withParams({ slitMm: 0.2 })).errors.some((e) => e.code === "DW_SLIT"));
  assert.ok(dw.validateDoubleWall(withParams({ wallMm: 0.4 })).errors.some((e) => e.code === "DW_WALL_THIN"));
  assert.ok(dw.validateDoubleWall(withParams({ heightMm: NaN })).errors.some((e) => e.code === "DW_PARAM_RANGE"));
  assert.ok(dw.validateDoubleWall(withParams({}, { flutes: 2 })).errors.some((e) => e.code === "DW_FLUTES"));
  assert.ok(dw.validateDoubleWall(withParams({}, { maxDiameterMm: 100 })).errors.some((e) => e.code === "DW_BULGE"));
  // uniones: piso, techo y zonas
  assert.ok(dw.validateDoubleWall(withParams({ floorMm: 0.6 })).errors.some((e) => e.code === "DW_FLOOR"), "piso no estructural");
  assert.ok(dw.validateDoubleWall(withParams({ roofHeightMm: 4 })).errors.some((e) => e.code === "DW_ROOF_HEIGHT"));
  assert.ok(dw.validateDoubleWall(withParams({ heightMm: 40 })).errors.some((e) => e.code === "DW_ZONES"), "no alcanza la altura para piso, cámara y techo");
  assert.ok(dw.validateDoubleWall(withParams({ roofHeightMm: 8 }, { endDiameterMm: 130, maxDiameterMm: 150 })).errors.some((e) => e.code === "DW_LEAN"), "techo demasiado corto: caras casi horizontales");
  assert.ok(dw.validateDoubleWall(withParams({ roofHeightMm: 20 })).warnings.some((e) => e.code === "DW_OVERHANG"), "voladizo > 45°");
});

// ------------------------------------------------------------------ topología y unión inferior / superior
test("ambos prototipos: mallas cerradas, orientadas y sin degenerados; A es un cuerpo, B un cuerpo con una cavidad interna (la cámara cerrada)", () => {
  for (const [name, b] of [["A vase-c", buildA()], ["B conventional", buildB()]]) {
    const r = assertClean(b.mesh, name);
    assert.ok(r.triangleCount > 50000 && r.triangleCount < 200000, `${name}: ${r.triangleCount} triángulos`);
  }
  const a = dw.shellReport(buildA().mesh), b = dw.shellReport(buildB().mesh);
  assert.deepEqual([a.shells, a.solidBodies, a.cavities], [1, 1, 0], "A: una superficie, cámara abierta");
  assert.deepEqual([b.shells, b.solidBodies, b.cavities], [2, 1, 1], "B: un sólido con una cavidad interna");
  // el volumen de la cavidad coincide con el de la cámara analítica (± 3 %): integral de la corona entre las caras de la cámara
  const surf = dw.createDoubleWallSurfaces(D);
  let cav = 0;
  const n = 480;
  for (let k = 0; k < n; k++) {
    const z = Z.floorTop + ((Z.ceiling - Z.floorTop) * (k + 0.5)) / n;
    const s = surf(z);
    let area = 0;
    const m = 360;
    for (let j = 0; j < m; j++) { const r = s.roi((2 * Math.PI * (j + 0.5)) / m); area += (0.5 * (r * r - s.rio * s.rio) * (2 * Math.PI)) / m; }
    cav += area * ((Z.ceiling - Z.floorTop) / n);
  }
  const cavMesh = -Math.min(...b.volumes);
  assert.ok(Math.abs(cavMesh - cav) / cav < 0.03, `cavidad ${cavMesh.toFixed(0)} vs analítica ${cav.toFixed(0)} mm³`);
});

test("unión inferior: piso anular macizo entre las dos paredes, de espesor estructural, que apoya sobre la cama y deja libre la abertura central", () => {
  const surf = dw.createDoubleWallSurfaces(D);
  for (const [name, b] of [["A", buildA()], ["B", buildB()]]) {
    const chamberZ = [...groupVertices(b, "chamberOuter"), ...groupVertices(b, "chamberInner")].map((v) => v[2]);
    assert.ok(Math.abs(Math.min(...chamberZ) - D.floorMm) < 1e-9, `${name}: la cámara arranca a ${Math.min(...chamberZ)}`);
    for (const z of [0.3, 1.2, 2.2]) {
      for (let k = 0; k < 72; k++) {
        const th = (2 * Math.PI * (k + 0.37)) / 72;
        const hits = castRay(b.mesh, 0, 0, z, Math.cos(th), Math.sin(th));
        if (name === "A" && Math.abs(Math.sin(th)) < 0.012 && Math.cos(th) < 0) { assert.equal(hits.length, 0, "la abertura atraviesa también el piso"); continue; }
        assert.equal(hits.length, 2, `${name}: piso discontinuo a z=${z} θ=${th.toFixed(2)}`);
        // (los rayos que pasan a menos de 3,5° de la abertura entran por el flanco plano, no por la cara de la pared interior)
        if (name === "B" || !(Math.abs(Math.sin(th)) < 0.07 && Math.cos(th) < 0)) assert.ok(Math.abs(hits[0] - surf(z).rii) < 0.15, `la abertura central empieza en la cara de la pared interior (${hits[0].toFixed(2)} vs ${surf(z).rii.toFixed(2)})`);
        assert.ok(hits[1] <= surf(z).crest + 0.05 && hits[1] > surf(z).crest - D.outer.fluteAmplitudeMm - 0.1);
      }
    }
    const bottom = groupTriangles(b, "bottom");
    assert.ok(bottom.length > 0 && bottom.every((t) => t.every((v) => v[2] === 0)), `${name}: tapa inferior en z = 0`);
    const floor = groupTriangles(b, "chamberFloor");
    assert.ok(floor.length > 0 && floor.every((t) => t.every((v) => Math.abs(v[2] - D.floorMm) < 1e-9)), `${name}: piso de la cámara`);
  }
});

test("unión superior: las paredes se inclinan una hacia la otra (≤ 45° de la vertical), la cámara termina en topGap y la abertura central no se reduce", () => {
  const surf = dw.createDoubleWallSurfaces(D);
  const lean = dw.measureLean(D);
  assert.ok(lean.maxDeg <= 45, `inclinación máxima ${lean.maxDeg.toFixed(1)}°`);
  assert.ok(lean.atZ >= Z.roofStart - 1 && lean.atZ <= Z.ceiling + 1, "la mayor inclinación está en el techo");
  const a = buildA();
  const crestRay = groupVertices(a, "outerFace").filter((v) => Math.abs(Math.atan2(v[1], v[0])) < 1e-9 && v[2] >= Z.roofStart).sort((m, n) => m[2] - n[2]);
  let maxMesh = 0;
  for (let i = 1; i < crestRay.length; i++) maxMesh = Math.max(maxMesh, Math.atan(Math.abs(Math.hypot(crestRay[i][0], crestRay[i][1]) - Math.hypot(crestRay[i - 1][0], crestRay[i - 1][1])) / (crestRay[i][2] - crestRay[i - 1][2])));
  assert.ok((maxMesh * 180) / Math.PI <= lean.maxDeg + 3, `malla ${((maxMesh * 180) / Math.PI).toFixed(1)}° vs ${lean.maxDeg.toFixed(1)}°`);
  // A: arriba la cámara queda como una ranura abierta (4 cruces) y el hueco del medio mide topGap
  for (const z of [118.5, 119.7]) {
    const hits = castRay(a.mesh, 0, 0, z, 1, 0);
    assert.equal(hits.length, 4);
    assert.ok(Math.abs(hits[2] - hits[1] - D.topGapMm) < 1e-6, `ranura ${hits[2] - hits[1]}`);
  }
  // B: arriba la cámara está cerrada: un rim macizo de ancho 2·espesor + topGap
  const b = buildB();
  for (const z of [118.2, 119.7]) {
    const hits = castRay(b.mesh, 0, 0, z, 1, 0);
    assert.equal(hits.length, 2);
    assert.ok(Math.abs(hits[1] - hits[0] - (2 * D.wallMm + D.topGapMm)) < 1e-6, `rim ${hits[1] - hits[0]}`);
  }
  const ceil = groupTriangles(b, "ceiling");
  assert.ok(ceil.length > 0 && ceil.every((t) => t.every((v) => Math.abs(v[2] - Z.ceiling) < 1e-9)));
  // abertura central: el radio mínimo de la cara que mira al eje es el de la cintura; el techo solo la ensancha; A y B coinciden
  for (const build of [a, b]) {
    const radii = groupVertices(build, "innerFace").map((v) => ({ r: Math.hypot(v[0], v[1]), z: v[2] }));
    const min = radii.reduce((m, v) => (v.r < m.r ? v : m));
    assert.ok(Math.abs(min.r - dw.measureChamberGap(D).minInnerVoidRadiusMm) < 0.05, `abertura mínima ${min.r}`);
    assert.ok(Math.abs(min.z - 60) <= D.rowMm);
    const top = radii.filter((v) => v.z === 120).map((v) => v.r);
    assert.ok(Math.min(...top) > min.r + 15, "el techo ensancha la abertura");
    assert.ok(Math.abs(Math.min(...top) - surf(120).rii) < 1e-6);
    for (const z of [10.05, 60.05, 110.05, 119.9]) {
      const hits = castRay(build.mesh, 0, 0, z, Math.cos(1.3), Math.sin(1.3));
      assert.ok(Math.abs(hits[0] - surf(z).rii) < 0.15, `abertura a z=${z}: ${hits[0]} vs ${surf(z).rii}`);
    }
  }
});

test("capas: A = un contorno exterior y un hueco (la cámara) sobre el piso; B = dos anillos unidos por el piso y por el rim superior", () => {
  const a = buildA(), b = buildB();
  const surf = dw.createDoubleWallSurfaces(D);
  for (let z = 0.0123; z < 120; z += 1.37) {
    const loops = dw.sliceMesh(a.mesh, z);
    const outer = loops.filter((l) => l.area > 0), holes = loops.filter((l) => l.area < 0);
    assert.equal(outer.length, 1, `A z=${z.toFixed(2)}: contornos exteriores`);
    assert.equal(holes.length, z < D.floorMm ? 0 : 1, `A z=${z.toFixed(2)}: huecos`);
    const radii = outer[0].points.map(([x, y]) => Math.hypot(x, y));
    const s = surf(z);
    assert.ok(Math.max(...radii) > s.ro(0) - 0.35 && Math.max(...radii) <= s.ro(0) + 0.05, "pasa por la cara exterior");
    assert.ok(Math.abs(Math.min(...radii) - s.rii) < (z < Z.roofStart ? 0.05 : 0.3), `pasa por la cara de la pared interior (r=${s.rii.toFixed(2)} z=${z.toFixed(1)})`);
  }
  for (let z = 0.0123; z < 120; z += 1.37) {
    const loops = dw.sliceMesh(b.mesh, z);
    const outer = loops.filter((l) => l.area > 0), holes = loops.filter((l) => l.area < 0);
    const wallsApart = z > D.floorMm && z < Z.ceiling;
    assert.equal(outer.length, wallsApart ? 2 : 1, `B z=${z.toFixed(2)}: islas`);
    assert.equal(holes.length, wallsApart ? 2 : 1, `B z=${z.toFixed(2)}: huecos`);
  }
  const ra = dw.createDoubleWallPrototype("vase-c").report, rb = dw.createDoubleWallPrototype("conventional").report;
  assert.equal(ra.layerStats.layers, 600);
  assert.deepEqual(ra.layerStats.outerContours, [1, 1]);
  assert.deepEqual(ra.layerStats.holes, [0, 1]);
  assert.ok(ra.layerStats.maxLengthJumpPct < 1, `salto de longitud ${ra.layerStats.maxLengthJumpPct} %`);
  assert.deepEqual(rb.layerStats.outerContours, [1, 2]);
  for (const [name, build] of [["A", a], ["B", b]]) for (const z of [0.0123, 7.31, 33.7, 60.0123, 100.4, 112.2, 118.7]) assert.equal(dw.summarizeLayer(build.mesh, z, true).selfIntersections, 0, `${name} z=${z}`);
});

test("secciones verticales: A un perfil en U (la abertura deja libre el lado −X); B dos perfiles cerrados con la cavidad de la cámara", () => {
  const a = dw.sliceMeshAxis(buildA().mesh, 1, 0.37);
  assert.equal(a.length, 1);
  assert.ok(a[0].area > 0);
  assert.ok(a[0].points.every(([, x]) => x > 0), "la abertura atraviesa pared exterior, cámara, pared interior y piso");
  const b = dw.sliceMeshAxis(buildB().mesh, 1, 0.37);
  assert.equal(b.filter((l) => l.area > 0).length, 2);
  assert.equal(b.filter((l) => l.area < 0).length, 2, "una cavidad por lado");
  assert.ok(b.some((l) => l.points.some(([, x]) => x < 0)) && b.some((l) => l.points.some(([, x]) => x > 0)));
  const zs = a[0].points.map(([z]) => z);
  assert.ok(Math.abs(Math.min(...zs)) < 1e-6 && Math.abs(Math.max(...zs) - 120) < 1e-6);
  for (const l of b.filter((l) => l.area < 0)) {
    const hz = l.points.map(([z]) => z);
    assert.ok(Math.abs(Math.min(...hz) - D.floorMm) < 1e-6 && Math.abs(Math.max(...hz) - Z.ceiling) < 1e-6, `cavidad entre ${Math.min(...hz)} y ${Math.max(...hz)}`);
  }
});

// ------------------------------------------------------------------ abertura posterior
test("abertura posterior: ancho configurable medido con rayos (1, 1,5, 2 y 3 mm), pasante de la cara interior a la exterior en toda la altura y el piso", () => {
  for (const slit of [1, 1.5, 2, 3]) {
    const p = withParams({ slitMm: slit });
    assert.deepEqual(dw.validateDoubleWall(p).errors, []);
    const b = buildA(p);
    assertClean(b.mesh, `abertura ${slit}`);
    assert.equal(dw.countComponents(b.mesh), 1);
    for (const [, y] of groupVertices(b, "flanks")) assert.ok(Math.abs(Math.abs(y) - slit / 2) < 1e-9, `flanco en y=${y}`);
    for (const z of [1.1, 3.01, 40.01, 60.01, 77.7, 110.01, 119.9]) {
      assert.equal(castRay(b.mesh, 0, 0, z, -1, 0).length, 0, `abertura obstruida a z=${z}`);
      let lo = 0, hi = 0;
      for (let y = 0; y < slit + 2; y += 0.02) if (castRay(b.mesh, 0, y, z, -1, 0).length === 0) hi = y; else break;
      for (let y = 0; y > -(slit + 2); y -= 0.02) if (castRay(b.mesh, 0, y, z, -1, 0).length === 0) lo = y; else break;
      assert.ok(Math.abs(hi - lo - slit) < 0.05, `ancho libre ${hi - lo} vs ${slit} (z=${z})`);
      assert.equal(castRay(b.mesh, 0, slit / 2 + 0.3, z, -1, 0).length, 2, `placa de unión a z=${z}`);
    }
  }
});

test("flancos de unión: placas macizas que unen las dos paredes (la cámara no se comunica con la abertura)", () => {
  const b = buildA();
  const surf = dw.createDoubleWallSurfaces(D);
  for (const z of [10.01, 60.01, 85.01]) {
    const s = surf(z);
    const y = D.slitMm / 2 + D.wallMm / 2;
    const hits = castRay(b.mesh, 0, y, z, -1, 0);
    assert.equal(hits.length, 2);
    assert.ok(Math.abs(hits[0] - s.rii) < 0.1 && hits[1] > s.crest - D.outer.fluteAmplitudeMm - 0.2);
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
  assert.ok(Math.abs(ba.maxX - ba.minX - (bb.maxX - bb.minX)) < 0.2);
  const outerTris = groupTriangles(a, "outerFace");
  let worst = Infinity, best = 0;
  for (const v of groupVertices(a, "chamberOuter").filter((v) => v[2] <= Z.roofStart).filter((_, i) => i % 61 === 0)) {
    let d = Infinity;
    for (const [p, q, r] of outerTris) if (Math.abs(p[2] - v[2]) < 4) d = Math.min(d, pointTriangleDistance(v, p, q, r));
    worst = Math.min(worst, d);
    best = Math.max(best, d);
  }
  assert.ok(worst > D.wallMm * 0.9 && best < D.wallMm * 1.12, `espesor medido ${worst.toFixed(3)}–${best.toFixed(3)} (pedido ${D.wallMm})`);
});

test("superficies horizontales: sin triángulos invertidos (normales −z abajo y +z arriba) y el área de cada una es la de la sección", () => {
  for (const [name, b] of [["A", buildA()], ["B", buildB()]]) {
    const p = b.mesh.positions;
    const areaOf = (g) => {
      let sum = 0;
      for (const [from, to] of b.groups[g] ?? []) {
        for (let t = from; t < to; t++) {
          const a = b.mesh.tris[t * 3] * 3, m = b.mesh.tris[t * 3 + 1] * 3, c = b.mesh.tris[t * 3 + 2] * 3;
          sum += ((p[m] - p[a]) * (p[c + 1] - p[a + 1]) - (p[m + 1] - p[a + 1]) * (p[c] - p[a])) / 2;
        }
      }
      return sum;
    };
    const sectionArea = (z) => dw.sliceMesh(b.mesh, z).reduce((s, l) => s + l.area, 0);
    assert.ok(areaOf("bottom") < 0 && Math.abs(-areaOf("bottom") - sectionArea(0.0007)) / sectionArea(0.0007) < 0.01, `${name}: tapa inferior`);
    assert.ok(areaOf("top") > 0 && Math.abs(areaOf("top") - sectionArea(119.9993)) / sectionArea(119.9993) < 0.01, `${name}: tapa superior`);
    // piso de la cámara: su área es la de los huecos de la sección justo encima, sin el hueco central de la abertura
    const holesAbove = dw.sliceMesh(b.mesh, D.floorMm + 0.0007).filter((l) => l.area < 0);
    const posAbove = dw.sliceMesh(b.mesh, D.floorMm + 0.0007).filter((l) => l.area > 0).map((l) => l.area).sort((m, n) => m - n);
    // A: el hueco es la cámara; B: el hueco grande es el interior de la pared exterior, del que se resta el cilindro de la pared interior (contorno positivo más chico)
    const chamberArea = name === "A" ? -holesAbove.reduce((s, l) => s + l.area, 0) : -holesAbove.map((l) => l.area).sort((m, n) => m - n)[0] - posAbove[0];
    assert.ok(areaOf("chamberFloor") > 0 && Math.abs(areaOf("chamberFloor") - chamberArea) / chamberArea < 0.02, `${name}: piso de la cámara ${areaOf("chamberFloor").toFixed(0)} vs ${chamberArea.toFixed(0)}`);
    if (name === "B") assert.ok(areaOf("ceiling") < 0, "cielorraso hacia abajo");
  }
});

// ------------------------------------------------------------------ modo jarrón: malla válida ≠ geometría compatible
test("malla válida NO es lo mismo que geometría compatible con modo jarrón: A cumple las condiciones geométricas, B (cámara cerrada) no", () => {
  const a = dw.createDoubleWallPrototype("vase-c").report, b = dw.createDoubleWallPrototype("conventional").report;
  assert.equal(a.vase.validClosedMesh, true);
  assert.equal(b.vase.validClosedMesh, true, "B tiene una malla cerrada y válida…");
  assert.equal(b.vase.geometricPreconditionsMet, false, "…y aun así no es candidata a modo jarrón");
  assert.equal(b.vase.noInternalCeiling, false);
  assert.equal(b.vase.singleOuterContourPerLayer, false);
  assert.equal(b.vase.noTopSolidLayers, false);
  assert.deepEqual(a.vase, { validClosedMesh: true, singleOuterContourPerLayer: true, noTopSolidLayers: true, noInternalCeiling: true, requiredBottomShellLayers: 12, geometricPreconditionsMet: true });
  assert.deepEqual(a.horizontalFaces.map((f) => [f.z, f.normal]), [[0, "-z"], [2.4, "+z"], [120, "+z"]]);
  assert.deepEqual(b.horizontalFaces.map((f) => [f.z, f.normal]), [[0, "-z"], [2.4, "+z"], [117.6, "-z"], [120, "+z"]]);
  assert.equal(a.chamberClosed, false);
  assert.equal(b.chamberClosed, true);
  assert.equal(a.solidLayers.top, 0);
  assert.equal(a.solidLayers.bottom, 12);
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
    let minZ = Infinity, maxZ = -Infinity, maxR = 0;
    for (let t = 0; t < one.proto.report.triangles; t++) for (let k = 0; k < 3; k++) {
      const x = one.buf.readFloatLE(84 + t * 50 + 12 + k * 12), y = one.buf.readFloatLE(84 + t * 50 + 16 + k * 12), z = one.buf.readFloatLE(84 + t * 50 + 20 + k * 12);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); maxR = Math.max(maxR, Math.hypot(x, y));
    }
    assert.equal(minZ, 0);
    assert.ok(Math.abs(maxZ - 120) < 1e-4 && Math.abs(2 * maxR - 140) < 0.15, `${strategy}: ${maxZ} × Ø${2 * maxR}`);
    assert.ok(one.proto.report.watertight && one.proto.report.solidBodies === 1);
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
  assert.equal(report.prototypes["vase-c"].solidBodies, 1);
  assert.equal(report.prototypes.conventional.cavities, 1);
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
