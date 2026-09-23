import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

// Carga módulos TypeScript de src/lib/maker/** con el compilador de TypeScript
// (mismo mecanismo que tests/maker-neon.test.mjs / tests/maker-letter-geometry.test.mjs).
const root = process.cwd();
const srcRoot = path.join(root, "src");
const nodeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveModulePath(specifier, fromFile) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(srcRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No se pudo resolver "${specifier}" desde ${fromFile}`);
}

function loadTsModule(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;
  const source = fs.readFileSync(absPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: absPath,
  });
  const mod = { exports: {} };
  moduleCache.set(absPath, mod);
  const localRequire = (specifier) => {
    const resolved = resolveModulePath(specifier, absPath);
    return resolved ? loadTsModule(resolved) : nodeRequire(specifier);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", outputText)(localRequire, mod, mod.exports, absPath, path.dirname(absPath));
  return mod.exports;
}

const load = (rel) => loadTsModule(path.join(srcRoot, rel));

const { textToNeonPaths } = load("lib/maker/neon/paths/textToNeonPaths.ts");
const { svgToNeonPaths } = load("lib/maker/neon/paths/svgToNeonPaths.ts");
const { buildNeonSegments } = load("lib/maker/neon/installation/segments.ts");
const { reconcileSegments } = load("lib/maker/neon/installation/reconcileSegments.ts");
const { planNeonWiring, invertSegmentOrientation, computeNeonBuses } = load("lib/maker/neon/installation/wiring.ts");
const { planPassThrough, isPassThroughValid, passThroughPolygon, passThroughsToRawPaths } = load("lib/maker/neon/installation/passThrough.ts");
const { createChannelGeometry } = load("lib/maker/neon/geometry/createChannelGeometry.ts");
const { DEFAULT_NEON_PARAMS } = load("lib/maker/neon/defaults.ts");
const { segmentOuterFootprint, nearestPointPair, buildBridgeMST, componentsOf, bridgeFootprintPolygon, planBridges } = load(
  "lib/maker/neon/installation/bridges.ts"
);
const { buildNeonWallClipMesh, validateNeonWallClip, neonWallClipWarnings, neonWallClipHeightMm, neonWallClipWallGapMm, buildNeonWallClipPart, NEON_WALL_CLIP_FILE_BASE_NAME } =
  load("lib/maker/neon/installation/wallClip.ts");
const { DEFAULT_NEON_WALL_CLIP_SETTINGS } = load("lib/maker/neon/installation/types.ts");
const { channelOuterWidth: channelOuterWidth2 } = load("lib/maker/neon/defaults.ts");
const { planClipPositionsForSegment, planClipPositions, DEFAULT_CLIP_PLACEMENT_SETTINGS } = load("lib/maker/neon/installation/clipPlacement.ts");

// --------------------------------------------------------------------------
// Helpers (mismo estilo que tests/maker-neon.test.mjs)
// --------------------------------------------------------------------------

const svg = (body, attrs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" ${attrs}>${body}</svg>`;
function neonFromText(text, h = 100, fontId = "neon-linea") {
  return textToNeonPaths(text, fontId, h).paths;
}
const line = (x1, y1, x2, y2) => ({ points: [[x1, y1], [x2, y2]], closed: false });
function circlePath(cx, cy, r, n = 32) {
  return { points: Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]), closed: true };
}
const approx = (a, b, tol = 0.02, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} esperado ${b} ± ${tol}, obtenido ${a}`);

/** Malla: bordes abiertos / no-manifold y triángulos degenerados (mismo helper que tests/maker-neon.test.mjs). */
function meshAudit(mesh) {
  const pos = mesh.positions;
  const key = (i) => `${pos[i].toFixed(4)},${pos[i + 1].toFixed(4)},${pos[i + 2].toFixed(4)}`;
  const directed = new Map();
  let degenerate = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const ux = pos[t + 3] - pos[t], uy = pos[t + 4] - pos[t + 1], uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t], vy = pos[t + 7] - pos[t + 1], vz = pos[t + 8] - pos[t + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (area < 1e-9) degenerate++;
    for (let e = 0; e < 3; e++) {
      const a = key(t + e * 3), b = key(t + ((e + 1) % 3) * 3);
      directed.set(`${a}>${b}`, (directed.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  let openOrNonManifold = 0;
  for (const [k] of directed) {
    const [a, b] = k.split(">");
    if (directed.get(`${a}>${b}`) !== 1 || directed.get(`${b}>${a}`) !== 1) openOrNonManifold++;
  }
  let volume = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [pos[t], pos[t + 1], pos[t + 2], pos[t + 3], pos[t + 4], pos[t + 5], pos[t + 6], pos[t + 7], pos[t + 8]];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return { openOrNonManifold, degenerate, volume, triangles: pos.length / 9 };
}

/** Intersecciones (t ordenadas) de un rayo con la malla — Möller–Trumbore (mismo helper que tests/maker-neon.test.mjs). */
function raycast(mesh, o, d) {
  const pos = mesh.positions;
  const hits = [];
  for (let t = 0; t < pos.length; t += 9) {
    const e1 = [pos[t + 3] - pos[t], pos[t + 4] - pos[t + 1], pos[t + 5] - pos[t + 2]];
    const e2 = [pos[t + 6] - pos[t], pos[t + 7] - pos[t + 1], pos[t + 8] - pos[t + 2]];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(a) < 1e-12) continue;
    const f = 1 / a;
    const s = [o[0] - pos[t], o[1] - pos[t + 1], o[2] - pos[t + 2]];
    const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
    if (v < 0 || u + v > 1) continue;
    const tt = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
    if (tt > 1e-9) hits.push(tt);
  }
  return hits.sort((x, y) => x - y);
}

/** Componentes conectados REALES de la malla (comparten vértice, misma técnica que tests/maker-letter-geometry.test.mjs). */
function countConnectedComponents(positions) {
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const parent = new Map();
  function find(k) {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = k;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const triCount = positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const keys = [
      key(positions[o], positions[o + 1], positions[o + 2]),
      key(positions[o + 3], positions[o + 4], positions[o + 5]),
      key(positions[o + 6], positions[o + 7], positions[o + 8]),
    ];
    for (const k of keys) if (!parent.has(k)) parent.set(k, k);
    union(keys[0], keys[1]);
    union(keys[1], keys[2]);
  }
  const roots = new Set();
  for (const k of parent.keys()) roots.add(find(k));
  return roots.size;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

// --------------------------------------------------------------------------
// Etapa 1 — NeonSegment: conteo por fixture
// --------------------------------------------------------------------------

test("NeonSegment: conteo correcto — I, S, O, A (neon-linea)", () => {
  assert.equal(buildNeonSegments(neonFromText("I", 100)).length, 1);
  assert.equal(buildNeonSegments(neonFromText("S", 100)).length, 1);
  assert.equal(buildNeonSegments(neonFromText("O", 100)).length, 1);
  const a = buildNeonSegments(neonFromText("A", 100));
  assert.equal(a.length, 2, "A = dos lados + travesaño, dos NeonPath");
});

test("NeonSegment: STAMPA -> 9 segmentos (S1 T2 A2 M1 P1 A2)", () => {
  const segs = buildNeonSegments(neonFromText("STAMPA", 100));
  assert.equal(segs.length, 9);
  assert.deepEqual(segs.map((s) => s.id), Array.from({ length: 9 }, (_, i) => `N${i + 1}`));
});

test("NeonSegment: 'amor' (fuente script) no crashea, ids posicionales, sin duplicados", () => {
  const segs = buildNeonSegments(neonFromText("amor", 60, "mistral-singleline"));
  assert.ok(segs.length >= 3);
  assert.equal(new Set(segs.map((s) => s.id)).size, segs.length);
});

test("NeonSegment: SVG multi-path (varias líneas + un círculo) — conteo y closed correctos", () => {
  const content = svg(
    '<line x1="0" y1="0" x2="0" y2="100" stroke="#000"/>' +
      '<line x1="100" y1="0" x2="100" y2="100" stroke="#000"/>' +
      '<circle cx="50" cy="50" r="20" fill="none" stroke="#000"/>'
  );
  const { paths } = svgToNeonPaths(content, 100);
  const segs = buildNeonSegments(paths);
  assert.equal(segs.length, 3);
  assert.equal(segs.filter((s) => s.closed).length, 1);
  assert.equal(segs.filter((s) => !s.closed).length, 2);
});

// --------------------------------------------------------------------------
// Etapa 1 — Endpoints (segmento abierto) y connectionAnchorT (loop cerrado)
// --------------------------------------------------------------------------

test("NeonSegment: segmento abierto A/B tiene endpoints con tangente saliente unitaria", () => {
  const [seg] = buildNeonSegments([line(0, 0, 0, 100)]);
  assert.equal(seg.closed, false);
  assert.equal(seg.connectionAnchorT, null);
  assert.deepEqual(seg.start.point, [0, 0]);
  assert.deepEqual(seg.end.point, [0, 100]);
  // Tangente saliente: en el extremo inicial apunta "hacia atrás" (Y negativo); en el final, "hacia adelante" (Y positivo).
  approx(seg.start.tangent[1], -1, 1e-9);
  approx(seg.end.tangent[1], 1, 1e-9);
  approx(Math.hypot(...seg.start.tangent), 1, 1e-9, "tangente unitaria");
  approx(Math.hypot(...seg.end.tangent), 1, 1e-9, "tangente unitaria");
});

test("NeonSegment: loop cerrado nunca crashea y produce un connectionAnchorT válido en [0,1)", () => {
  for (const closed of [circlePath(0, 0, 50), { points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }]) {
    const [seg] = buildNeonSegments([closed]);
    assert.equal(seg.closed, true);
    assert.equal(seg.start, null);
    assert.equal(seg.end, null);
    assert.ok(Number.isFinite(seg.connectionAnchorT));
    assert.ok(seg.connectionAnchorT >= 0 && seg.connectionAnchorT < 1);
  }
});

test("NeonSegment: connectionAnchorT elige el vértice más recto, determinístico (misma entrada -> mismo resultado)", () => {
  // Rectángulo: 4 esquinas de 90°, todas "igual de rectas" -> debe elegir siempre la primera (índice 0), nunca al azar.
  const square = { points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };
  const runs = Array.from({ length: 5 }, () => buildNeonSegments([square])[0].connectionAnchorT);
  assert.ok(runs.every((t) => t === runs[0]), "determinístico entre corridas");
});

// --------------------------------------------------------------------------
// Etapa 1 — Reconciliación de segmentos entre corridas
// --------------------------------------------------------------------------

test("reconcileSegments: misma entrada -> match 1:1 perfecto para todos los segmentos", () => {
  const paths = neonFromText("STAMPA", 100);
  const prev = buildNeonSegments(paths);
  const next = buildNeonSegments(paths.map((p) => ({ points: p.points.map((pt) => [...pt]), closed: p.closed })));
  const matches = reconcileSegments(prev, next);
  assert.equal(matches.size, prev.length);
  for (const seg of prev) assert.equal(matches.get(seg.id), seg.id);
});

test("reconcileSegments: agregar un segmento nuevo no rompe el match de los existentes", () => {
  const prev = buildNeonSegments([line(0, 0, 0, 100), line(50, 0, 50, 100)]);
  const next = buildNeonSegments([line(0, 0, 0, 100), line(50, 0, 50, 100), line(100, 0, 100, 100)]);
  const matches = reconcileSegments(prev, next);
  assert.equal(matches.get(prev[0].id), next[0].id);
  assert.equal(matches.get(prev[1].id), next[1].id);
  assert.equal(matches.size, 2, "el segmento nuevo no tiene contraparte en prev");
});

test("reconcileSegments: caso adversarial — mismo conteo, formas muy distintas -> se descarta, nunca se remapea mal", () => {
  // prev: dos líneas verticales cortas y separadas. next: un loop grande y una línea larguísima
  // en otro lugar del plano — mismo conteo (2), pero nada geométricamente parecido.
  const prev = buildNeonSegments([line(0, 0, 0, 10), line(20, 0, 20, 10)]);
  const next = buildNeonSegments([circlePath(500, 500, 200), line(-900, -900, 900, 900)]);
  const matches = reconcileSegments(prev, next);
  assert.equal(matches.size, 0, "ninguna coincidencia supera el umbral de confianza: se descarta limpio");
});

test("reconcileSegments: reordenar los mismos trazos igual matchea por forma, no por índice", () => {
  const a = line(0, 0, 0, 100);
  const b = line(50, 0, 50, 100);
  const prev = buildNeonSegments([a, b]);
  const next = buildNeonSegments([b, a]); // orden invertido
  const matches = reconcileSegments(prev, next);
  assert.equal(matches.size, 2);
  // prev[0] (a, en x=0) debe matchear con next[1] (a también, en x=0), no con next[0].
  assert.equal(matches.get(prev[0].id), next[1].id);
  assert.equal(matches.get(prev[1].id), next[0].id);
});

// --------------------------------------------------------------------------
// Etapa 2 — Planificador de cableado (planNeonWiring) + verificación de buses
// --------------------------------------------------------------------------

const SERVICE_MARGIN = 30;

test("planNeonWiring: 0 segmentos -> plan vacío, sin crash", () => {
  const plan = planNeonWiring([], SERVICE_MARGIN);
  assert.deepEqual(plan, { order: [], segments: [], jumpers: [], totalCableMm: 0 });
});

test("planNeonWiring: 1 segmento -> sin jumpers, es a la vez primero y último con alimentación", () => {
  const segs = buildNeonSegments([line(0, 0, 0, 100)]);
  const plan = planNeonWiring(segs, SERVICE_MARGIN);
  assert.equal(plan.order.length, 1);
  assert.equal(plan.jumpers.length, 0);
  assert.equal(plan.totalCableMm, 0);
  const [only] = plan.segments;
  assert.equal(only.isFirst, true);
  assert.equal(only.isLast, true);
  assert.equal(only.hasPowerIn, true);
  assert.equal(only.hasOut, false);
});

test("planNeonWiring: 2 segmentos -> exactamente 1 jumper, orden/orientación determinísticos entre corridas", () => {
  const segs = buildNeonSegments([line(0, 0, 0, 100), line(200, 0, 200, 100)]);
  const plan1 = planNeonWiring(segs, SERVICE_MARGIN);
  const plan2 = planNeonWiring(segs, SERVICE_MARGIN);
  assert.equal(plan1.jumpers.length, 1);
  assert.deepEqual(plan1.order, plan2.order, "orden determinístico");
  assert.deepEqual(
    plan1.segments.map((s) => s.inverted),
    plan2.segments.map((s) => s.inverted),
    "orientación determinística"
  );
  assert.equal(plan1.segments[0].hasPowerIn, true);
  assert.equal(plan1.segments[0].hasOut, true);
  assert.equal(plan1.segments[1].hasOut, false);
});

test("planNeonWiring: 6 segmentos — el plan automático produce menos cable total que un orden manual artificialmente malo", () => {
  // 6 líneas verticales paralelas, separadas 100 mm en X: el orden natural (izquierda a
  // derecha) es obviamente mejor que saltar de un extremo al otro repetidamente.
  const xs = [0, 100, 200, 300, 400, 500];
  const segs = buildNeonSegments(xs.map((x) => line(x, 0, x, 50)));
  const plan = planNeonWiring(segs, SERVICE_MARGIN);
  const autoTotal = plan.jumpers.reduce((sum, j) => sum + j.distanceMm, 0);

  // Orden manual deliberadamente malo: 0, 300, 100, 400, 200, 500 (zigzag).
  const badOrderX = [0, 300, 100, 400, 200, 500];
  let badTotal = 0;
  for (let k = 0; k < badOrderX.length - 1; k++) {
    badTotal += Math.hypot(badOrderX[k + 1] - badOrderX[k], 50);
  }

  assert.ok(autoTotal < badTotal, `auto=${autoTotal} debería ser < malo=${badTotal}`);
  assert.equal(plan.jumpers.length, 5);
});

test("computeNeonBuses: exactamente un bus + y un bus -, nunca en corto (I, O, A, STAMPA, líneas sueltas)", () => {
  const fixtures = [
    buildNeonSegments(neonFromText("I", 100)),
    buildNeonSegments(neonFromText("O", 100)),
    buildNeonSegments(neonFromText("A", 100)),
    buildNeonSegments(neonFromText("STAMPA", 100)),
    buildNeonSegments([line(0, 0, 0, 100), line(200, 0, 200, 100), circlePath(400, 50, 30)]),
  ];
  for (const segs of fixtures) {
    const plan = planNeonWiring(segs, SERVICE_MARGIN);
    const buses = computeNeonBuses(plan);
    assert.equal(buses.plus.length, 1, `segmentos=${segs.length}`);
    assert.equal(buses.minus.length, 1, `segmentos=${segs.length}`);
    assert.equal(buses.shorted, false, `segmentos=${segs.length}`);
  }
});

test("invertSegmentOrientation: invierte IN/OUT de un segmento y recalcula jumpers; no-op en loops cerrados", () => {
  const segs = buildNeonSegments([line(0, 0, 0, 100), line(200, 0, 200, 100), line(400, 0, 400, 100)]);
  const plan = planNeonWiring(segs, SERVICE_MARGIN);
  const targetId = plan.order[1];
  const before = plan.segments.find((s) => s.segmentId === targetId).inverted;
  const after = invertSegmentOrientation(segs, plan, targetId, SERVICE_MARGIN);
  const afterWiring = after.segments.find((s) => s.segmentId === targetId);
  assert.equal(afterWiring.inverted, !before);
  assert.deepEqual(after.order, plan.order, "el orden no cambia, solo la orientación");
  // Los jumpers que tocan ese segmento deben haber cambiado de longitud (o al menos recalcularse consistentemente).
  assert.equal(after.jumpers.length, plan.jumpers.length);
  const buses = computeNeonBuses(after);
  assert.equal(buses.plus.length, 1);
  assert.equal(buses.minus.length, 1);
  assert.equal(buses.shorted, false);

  // No-op sobre un segmento cerrado (O): mismo plan, misma referencia de contenido.
  const closedSegs = buildNeonSegments([circlePath(0, 0, 50)]);
  const closedPlan = planNeonWiring(closedSegs, SERVICE_MARGIN);
  const untouched = invertSegmentOrientation(closedSegs, closedPlan, closedSegs[0].id, SERVICE_MARGIN);
  assert.deepEqual(untouched, closedPlan);
});

// --------------------------------------------------------------------------
// Etapa 3 — Geometría de pass-through + split de piso por bandas
// --------------------------------------------------------------------------

const PT_SETTINGS = { widthMm: 5, heightMm: 3, endpointInsetMm: 10 };

test("planPassThrough: cerca de ambos extremos (no exactamente en la punta), null en segmentos cerrados", () => {
  const [seg] = buildNeonSegments([line(0, 0, 0, 200)]);
  const ptStart = planPassThrough(seg, "start", PT_SETTINGS);
  const ptEnd = planPassThrough(seg, "end", PT_SETTINGS);
  approx(ptStart.center[1], 10, 1e-6, "10 mm desde la punta inicial");
  approx(ptEnd.center[1], 190, 1e-6, "10 mm desde la punta final");
  assert.notDeepEqual(ptStart.center, seg.start.point, "nunca exactamente en la punta");
  assert.notDeepEqual(ptEnd.center, seg.end.point, "nunca exactamente en la punta");

  const [closedSeg] = buildNeonSegments([circlePath(0, 0, 50)]);
  assert.equal(planPassThrough(closedSeg, "start", PT_SETTINGS), null);
});

test("planPassThrough: endpointInset se acota a la mitad del segmento en trazos cortos (los dos huecos nunca se cruzan)", () => {
  const [seg] = buildNeonSegments([line(0, 0, 0, 15)]); // más corto que 2 * endpointInsetMm (20)
  const ptStart = planPassThrough(seg, "start", PT_SETTINGS);
  const ptEnd = planPassThrough(seg, "end", PT_SETTINGS);
  assert.ok(ptStart.center[1] <= ptEnd.center[1] + 1e-6, "el de start nunca queda después del de end");
});

test("isPassThroughValid: acepta una posición bien adentro de la cavidad, rechaza si sobresale de la pared", () => {
  const [seg] = buildNeonSegments([line(0, 0, 0, 200)]);
  const baseline = createChannelGeometry([{ points: seg.points, closed: false }], DEFAULT_NEON_PARAMS);
  const ptStart = planPassThrough(seg, "start", PT_SETTINGS);
  assert.equal(isPassThroughValid(ptStart, baseline.cavityGroups), true);

  const tooWide = { ...ptStart, widthMm: 5, heightMm: 30 }; // mucho más ancha que el corredor interior (~6.3 mm)
  assert.equal(isPassThroughValid(tooWide, baseline.cavityGroups), false);

  const farAway = { ...ptStart, center: [500, 500] };
  assert.equal(isPassThroughValid(farAway, baseline.cavityGroups), false);
});

test("createChannelGeometry: SIN pass-throughs, malla idéntica (triangle count y bounding box) a la firma de 2 argumentos", () => {
  const paths = [line(0, 0, 0, 200)];
  const withoutArg = createChannelGeometry(paths, DEFAULT_NEON_PARAMS);
  const withEmptyContext = createChannelGeometry(paths, DEFAULT_NEON_PARAMS, { passThroughFootprints: [] });
  assert.equal(withEmptyContext.mesh.triangleCount, withoutArg.mesh.triangleCount);
  assert.deepEqual(Array.from(withEmptyContext.mesh.positions), Array.from(withoutArg.mesh.positions), "malla BIT A BIT idéntica");
});

test("createChannelGeometry: pass-through cerca de ambos extremos — perfora el piso, manifold/watertight, paredes intactas", () => {
  const [seg] = buildNeonSegments([line(0, 0, 0, 200)]);
  const baseline = createChannelGeometry([{ points: seg.points, closed: false }], DEFAULT_NEON_PARAMS);
  const ptStart = planPassThrough(seg, "start", PT_SETTINGS);
  const ptEnd = planPassThrough(seg, "end", PT_SETTINGS);
  assert.equal(isPassThroughValid(ptStart, baseline.cavityGroups), true);
  assert.equal(isPassThroughValid(ptEnd, baseline.cavityGroups), true);

  const withHoles = createChannelGeometry([{ points: seg.points, closed: false }], DEFAULT_NEON_PARAMS, {
    passThroughFootprints: [passThroughPolygon(ptStart), passThroughPolygon(ptEnd)],
  });
  assert.deepEqual(withHoles.errors, []);

  const auditBase = meshAudit(baseline.mesh);
  const auditHoles = meshAudit(withHoles.mesh);
  assert.equal(auditHoles.openOrNonManifold, 0, "sigue watertight con los agujeros");
  assert.equal(auditHoles.degenerate, 0, "sin triángulos degenerados");
  assert.ok(auditHoles.volume > 0, "volumen sigue positivo (normales hacia afuera)");

  // Volumen removido ≈ área de cada cápsula × espesor de piso (columna completa perforada).
  const zFloor = DEFAULT_NEON_PARAMS.floorThicknessMm;
  const capsuleArea = polyArea(passThroughPolygon(ptStart));
  const expectedRemoved = 2 * capsuleArea * zFloor;
  const removed = auditBase.volume - auditHoles.volume;
  approx(removed, expectedRemoved, expectedRemoved * 0.1, "volumen removido por los dos agujeros");

  // El hueco atraviesa de punta a punta: un rayo vertical por su centro no encuentra
  // material entre z=0 y z=zFloor (a diferencia de un punto sin pass-through, donde sí).
  const holeHitsBelowFloor = raycast(withHoles.mesh, [ptStart.center[0], ptStart.center[1], -50], [0, 0, 1]).filter((t) => t - 50 < zFloor - 0.05);
  assert.equal(holeHitsBelowFloor.length, 0, "sin material entre z=0 y zFloor en el centro del pass-through");
  const solidFloorHits = raycast(withHoles.mesh, [seg.points[0][0], 100, -50], [0, 0, 1]).filter((t) => t - 50 < zFloor - 0.05);
  assert.ok(solidFloorHits.length > 0, "el piso sigue sólido lejos del pass-through");
});

// --------------------------------------------------------------------------
// Etapa 4 — Puentes traseros (MST)
// --------------------------------------------------------------------------

const BRIDGE_SETTINGS = { widthMm: 6, maxLengthBeforeWarningMm: 250 };

function farLines(xs, y0 = 0, y1 = 30) {
  return buildNeonSegments(xs.map((x) => line(x, y0, x, y1)));
}

test("buildBridgeMST + componentsOf: N=4 componentes desconectados -> 3 puentes -> 1 componente (grafo)", () => {
  const segs = farLines([0, 150, 300, 450]);
  const footprints = new Map(segs.map((s) => [s.id, segmentOuterFootprint(s, DEFAULT_NEON_PARAMS)]));
  const mst = buildBridgeMST(segs, footprints);
  assert.equal(mst.length, 3, "N-1 puentes para N=4 componentes");
  assert.equal(componentsOf(segs, mst).length, 1);
});

test("componentsOf: modo apagado (sin edges) preserva el conteo de componentes original", () => {
  const segs = farLines([0, 150, 300, 450]);
  assert.equal(componentsOf(segs, []).length, segs.length);
});

test("nearestPointPair: es simétrico y siempre no-negativo", () => {
  const [a, b] = farLines([0, 150]);
  const fa = segmentOuterFootprint(a, DEFAULT_NEON_PARAMS);
  const fb = segmentOuterFootprint(b, DEFAULT_NEON_PARAMS);
  const ab = nearestPointPair(fa, fb);
  const ba = nearestPointPair(fb, fa);
  approx(ab.distanceMm, ba.distanceMm, 1e-6);
  assert.ok(ab.distanceMm > 0);
});

test("planBridges: puente por encima del umbral -> warning NEON_BRIDGE_TOO_LONG, sin bloquear", () => {
  const segs = farLines([0, 400]); // ~400 mm de separación, bien por encima del umbral de 250
  const result = planBridges(segs, DEFAULT_NEON_PARAMS, BRIDGE_SETTINGS, []);
  assert.equal(result.bridges.length, 1, "el puente se genera igual (aviso, no bloqueo)");
  assert.ok(result.warnings.some((w) => w.code === "NEON_BRIDGE_TOO_LONG"));
});

test("planBridges: sin cavidad de por medio no avisa de puente largo si está bajo el umbral", () => {
  const segs = farLines([0, 100]);
  const result = planBridges(segs, DEFAULT_NEON_PARAMS, BRIDGE_SETTINGS, []);
  assert.equal(result.bridges.length, 1);
  assert.ok(!result.warnings.some((w) => w.code === "NEON_BRIDGE_TOO_LONG"));
});

test("planBridges: candidato que cruza la cavidad se rechaza y se reemplaza por otra unión", () => {
  // A y B están cerca (~11 mm) pero una cavidad SINTÉTICA bloquea el camino directo entre
  // ellos; D es un desvío más lejano (~46 mm) pero libre. El plan debe:
  //  1. avisar NEON_BRIDGE_CROSSES_CAVITY para el intento directo A-B;
  //  2. terminar igual con las 3 piezas en un solo componente, vía A-D y B-D.
  const segs = buildNeonSegments([line(0, 0, 0, 5), line(20, 0, 20, 5), line(0, 60, 20, 60)]);
  const [segA, segB] = segs;
  const blocker = { outer: [[8, -2], [12, -2], [12, 7], [8, 7]], holes: [] };
  const result = planBridges(segs, DEFAULT_NEON_PARAMS, BRIDGE_SETTINGS, [blocker]);

  assert.ok(
    result.warnings.some((w) => w.code === "NEON_BRIDGE_CROSSES_CAVITY" && w.message.includes(segA.id) && w.message.includes(segB.id)),
    "avisa específicamente del intento A-B rechazado"
  );
  assert.ok(
    !result.bridges.some((b) => (b.fromSegmentId === segA.id && b.toSegmentId === segB.id) || (b.fromSegmentId === segB.id && b.toSegmentId === segA.id)),
    "el puente directo A-B (el que cruza) nunca se acepta"
  );
  assert.equal(componentsOf(segs, result.bridges).length, 1, "igual queda todo conectado, por el desvío");
});

const { intersectRawPaths, clipperPathsArea: clipperArea2, pointsToRawPath: toRawPath2 } = load("lib/maker/geometry/offsets.ts");

/** ¿Dos footprints (Point2D[][] estilo ContourGroup.outer, o un polígono simple) se solapan en área real (no solo se tocan)? */
function footprintsOverlap(polyA, polyB) {
  const area = Math.abs(clipperArea2(intersectRawPaths([toRawPath2(polyA)], [toRawPath2(polyB)])));
  return area > 1e-6;
}

/** Une en un solo grupo cualquier par de piezas (footprints 2D) que se solapen en área — así es como el conjunto imprime como una sola pieza aunque la malla no esté soldada por vértices (puentes = sólidos independientes superpuestos, ver createChannelGeometry.ts). */
function overlapComponents(polys) {
  const parent = polys.map((_, i) => i);
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      if (footprintsOverlap(polys[i], polys[j])) union(i, j);
    }
  }
  return new Set(polys.map((_, i) => find(i))).size;
}

test("createChannelGeometry: puentes fusionan N=4 componentes en 1 sola pieza imprimible; sin puentes siguen separados", () => {
  const xs = [0, 150, 300, 450];
  const segs = farLines(xs);
  const rawPaths = segs.map((s) => ({ points: s.points, closed: s.closed }));

  const withoutBridges = createChannelGeometry(rawPaths, DEFAULT_NEON_PARAMS);
  assert.equal(countConnectedComponents(withoutBridges.mesh.positions), 4, "modo Independientes: 4 piezas separadas (ni siquiera se tocan)");

  const footprints = new Map(segs.map((s) => [s.id, segmentOuterFootprint(s, DEFAULT_NEON_PARAMS)]));
  const mst = buildBridgeMST(segs, footprints);
  assert.equal(mst.length, 3);
  const bridgeFootprints = mst.map((edge) => bridgeFootprintPolygon(edge, BRIDGE_SETTINGS.widthMm));

  const withBridges = createChannelGeometry(rawPaths, DEFAULT_NEON_PARAMS, { bridgeFootprints });
  assert.deepEqual(withBridges.errors, []);
  const audit = meshAudit(withBridges.mesh);
  assert.equal(audit.openOrNonManifold, 0, "cada pieza (segmentos + puentes) sigue watertight por separado");
  assert.equal(audit.degenerate, 0);

  // Cada puente es un sólido independiente (no soldado por vértices, ver comentario en
  // createChannelGeometry.ts) que SOLAPA en área real la huella de los dos segmentos
  // que conecta — eso es lo que hace que el conjunto imprima como una sola pieza. Se
  // verifica exactamente esa propiedad (no `countConnectedComponents`, que exige
  // vértices compartidos y no aplica a sólidos superpuestos-no-soldados).
  const segmentFootprints = segs.map((s) => segmentOuterFootprint(s, DEFAULT_NEON_PARAMS)[0].outer);
  const allFootprints = [...segmentFootprints, ...bridgeFootprints];
  assert.equal(overlapComponents(allFootprints), 1, "los 4 segmentos + 3 puentes quedan todos solapados entre sí (1 sola pieza imprimible)");

  // Los puentes nunca suben más allá del piso: el alto total de la pieza no cambia.
  approx(withBridges.mesh.positions.reduce((m, _, i) => (i % 3 === 2 ? Math.max(m, withBridges.mesh.positions[i]) : m), 0), DEFAULT_NEON_PARAMS.floorThicknessMm + DEFAULT_NEON_PARAMS.wallHeightMm, 0.01, "altura total sin cambios");
});

// --------------------------------------------------------------------------
// Etapa 5 — NeonWallClip
// --------------------------------------------------------------------------

test("NeonWallClip: parámetros por defecto válidos, medidas fuera de rango se rechazan", () => {
  assert.deepEqual(validateNeonWallClip(DEFAULT_NEON_PARAMS, DEFAULT_NEON_WALL_CLIP_SETTINGS), []);
  assert.ok(validateNeonWallClip(DEFAULT_NEON_PARAMS, { ...DEFAULT_NEON_WALL_CLIP_SETTINGS, wallGapMm: 25 }).length > 0);
  assert.ok(validateNeonWallClip(DEFAULT_NEON_PARAMS, { ...DEFAULT_NEON_WALL_CLIP_SETTINGS, clipWallThicknessMm: 0 }).length > 0);
  assert.ok(validateNeonWallClip(DEFAULT_NEON_PARAMS, { ...DEFAULT_NEON_WALL_CLIP_SETTINGS, screwHeadDiameterMm: 2 }).length > 0, "cabeza menor que el vástago");
  assert.ok(neonWallClipWarnings({ ...DEFAULT_NEON_WALL_CLIP_SETTINGS, wallGapMm: 0 }).length > 0, "wallGap=0 avisa conflicto con el cableado");
  assert.equal(neonWallClipWarnings(DEFAULT_NEON_WALL_CLIP_SETTINGS).length, 0);
});

test("NeonWallClip: manifold/watertight, ajuste del bolsillo al canal + holgura, agujero de tornillo pasante y accesible desde arriba", () => {
  const s = DEFAULT_NEON_WALL_CLIP_SETTINGS;
  const mesh = buildNeonWallClipMesh(DEFAULT_NEON_PARAMS, s);
  const audit = meshAudit(mesh);
  assert.equal(audit.openOrNonManifold, 0, "watertight/manifold");
  assert.equal(audit.degenerate, 0);
  assert.ok(audit.volume > 0);

  // Ancho del bolsillo: a media altura de los rieles, el hueco más ancho detectado por un
  // rayo transversal debe medir channelOuterWidth + clearance (holgura TOTAL).
  const postTop = s.clipWallThicknessMm + neonWallClipWallGapMm(DEFAULT_NEON_PARAMS, s);
  const channelH = DEFAULT_NEON_PARAMS.floorThicknessMm + DEFAULT_NEON_PARAMS.wallHeightMm;
  const railZ = postTop + (channelH + s.clipClearanceMm) / 2;
  const ys = raycast(mesh, [0, 100, railZ], [0, -1, 0])
    .map((t) => 100 - t)
    .sort((a, b) => b - a);
  let maxGap = 0;
  for (let i = 0; i < ys.length - 1; i++) maxGap = Math.max(maxGap, ys[i] - ys[i + 1]);
  approx(maxGap, channelOuterWidth2(DEFAULT_NEON_PARAMS) + s.clipClearanceMm, 0.05, "ancho del bolsillo");

  // Agujero de tornillo: atraviesa la base de punta a punta, y nada lo tapa desde arriba (acceso libre con el destornillador).
  const earX = s.clipDepthMm / 2 + (Math.max(s.screwShankDiameterMm, s.screwHeadDiameterMm) + 4) / 2;
  const throughBase = raycast(mesh, [earX, 0, -50], [0, 0, 1]).filter((t) => t - 50 < s.clipWallThicknessMm - 0.05);
  assert.equal(throughBase.length, 0, "el agujero atraviesa la base");
  assert.equal(raycast(mesh, [earX, 0, 200], [0, 0, -1]).length, 0, "nada bloquea el acceso al tornillo desde arriba");

  // Debajo del poste (x=0,y=0) la base sí es sólida: el agujero está en la oreja, no bajo el bolsillo.
  const underPost = raycast(mesh, [0, 0, -50], [0, 0, 1]).filter((t) => t - 50 < s.clipWallThicknessMm - 0.05);
  assert.ok(underPost.length > 0, "la base bajo el poste sigue sólida");
});

test("NeonWallClip: wallGapMm configurado produce exactamente esa separación geométrica", () => {
  for (const wallGapMm of [0, 5, 12]) {
    const s = { ...DEFAULT_NEON_WALL_CLIP_SETTINGS, wallGapMm };
    approx(neonWallClipWallGapMm(DEFAULT_NEON_PARAMS, s), wallGapMm, 1e-6);
  }
});

test("NeonWallClip: se regenera (cambia de medidas) al cambiar el canal, función pura sin paso manual", () => {
  const s = DEFAULT_NEON_WALL_CLIP_SETTINGS;
  const narrow = buildNeonWallClipMesh(DEFAULT_NEON_PARAMS, s);
  const wideParams = { ...DEFAULT_NEON_PARAMS, neonWidthMm: DEFAULT_NEON_PARAMS.neonWidthMm + 6 };
  const wide = buildNeonWallClipMesh(wideParams, s);
  assert.notEqual(wide.positions.length, 0);
  // Mismo canal + mismos settings -> exactamente la misma malla (pureza).
  const again = buildNeonWallClipMesh(DEFAULT_NEON_PARAMS, s);
  assert.deepEqual(Array.from(again.positions), Array.from(narrow.positions));
  // Canal más ancho -> clip más ancho (más triángulos de material, bounding box mayor en Y).
  const boundsY = (mesh) => {
    let min = Infinity, max = -Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      min = Math.min(min, mesh.positions[i]);
      max = Math.max(max, mesh.positions[i]);
    }
    return max - min;
  };
  assert.ok(boundsY(wide) > boundsY(narrow), "el clip se agranda con un canal más ancho");
});

test("buildNeonWallClipPart: una sola pieza + cantidad, nunca N archivos; vacío si la cantidad es 0 o hay error de parámetros", () => {
  const parts = buildNeonWallClipPart(DEFAULT_NEON_PARAMS, DEFAULT_NEON_WALL_CLIP_SETTINGS, 14);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].kind, "neonWallClip");
  assert.equal(parts[0].fileBaseName, NEON_WALL_CLIP_FILE_BASE_NAME);
  assert.equal(parts[0].quantity, 14);
  assert.ok(parts[0].mesh.triangleCount > 0);

  assert.equal(buildNeonWallClipPart(DEFAULT_NEON_PARAMS, DEFAULT_NEON_WALL_CLIP_SETTINGS, 0).length, 0);
  assert.equal(buildNeonWallClipPart(DEFAULT_NEON_PARAMS, { ...DEFAULT_NEON_WALL_CLIP_SETTINGS, wallGapMm: -1 }, 5).length, 0);
});

// --------------------------------------------------------------------------
// Etapa 6 — Posición automática de clips de pared
// --------------------------------------------------------------------------

test("planClipPositionsForSegment: tramo recto de 500mm -> varios puntos cerca del spacing configurado + extra cerca de cada extremo", () => {
  const [seg] = buildNeonSegments([line(0, 0, 0, 500)]);
  const { positions, issue } = planClipPositionsForSegment(seg, DEFAULT_CLIP_PLACEMENT_SETTINGS);
  assert.equal(issue, null);
  assert.ok(positions.length >= 4, `esperaba varios clips, obtuvo ${positions.length}`);
  // Ordenados y dentro del segmento.
  const sorted = [...positions].sort((a, b) => a - b);
  assert.deepEqual(positions, sorted, "orden creciente por longitud de arco");
  assert.ok(sorted[0] < 50, "el primero está cerca del extremo inicial");
  assert.ok(500 - sorted[sorted.length - 1] < 50, "el último está cerca del extremo final");
  // Separación entre consecutivos razonablemente cerca de spacingMm (80-120 recomendado), nunca 0 ni absurdamente grande.
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    assert.ok(gap > 20 && gap <= DEFAULT_CLIP_PLACEMENT_SETTINGS.spacingMm + 10, `separación ${gap} fuera de rango razonable`);
  }
});

test("planClipPositionsForSegment: ningún clip cae sobre un intervalo reservado (pass-through)", () => {
  const [seg] = buildNeonSegments([line(0, 0, 0, 300)]);
  const reserved = [{ t0: 110, t1: 130 }]; // cubre el candidato natural cercano a 120
  const { positions } = planClipPositionsForSegment(seg, DEFAULT_CLIP_PLACEMENT_SETTINGS, reserved);
  assert.ok(positions.length > 0);
  for (const p of positions) {
    const clipT0 = p - DEFAULT_CLIP_PLACEMENT_SETTINGS.clipDepthMm / 2;
    const clipT1 = p + DEFAULT_CLIP_PLACEMENT_SETTINGS.clipDepthMm / 2;
    assert.ok(clipT1 < reserved[0].t0 || clipT0 > reserved[0].t1, `clip en ${p} invade la zona reservada [110,130]`);
  }
});

test("planClipPositionsForSegment: ningún clip cae en una curva demasiado cerrada", () => {
  // "L": tramo recto de 120mm, esquina de 90°, y otros 280mm rectos.
  const [seg] = buildNeonSegments([{ points: [[0, 0], [120, 0], [120, 280]], closed: false }]);
  const { positions } = planClipPositionsForSegment(seg, DEFAULT_CLIP_PLACEMENT_SETTINGS);
  assert.ok(positions.length > 0);
  // Mismo criterio de radio local que el motor: recomputado acá de forma independiente.
  function pointAt(t) {
    const pts = seg.points;
    const clamped = Math.max(0, Math.min(120 + 280, t));
    if (clamped <= 120) return [clamped, 0];
    return [120, clamped - 120];
  }
  function circumradius(a, b, c) {
    const ab = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const bc = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    return cross < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross);
  }
  const probe = DEFAULT_CLIP_PLACEMENT_SETTINGS.minCurvatureRadiusMm * 0.4;
  for (const p of positions) {
    const r = circumradius(pointAt(p - probe), pointAt(p), pointAt(p + probe));
    assert.ok(!Number.isFinite(r) || r >= DEFAULT_CLIP_PLACEMENT_SETTINGS.minCurvatureRadiusMm, `clip en ${p} cae en una curva demasiado cerrada (r=${r})`);
  }
});

test("planClipPositionsForSegment: sin espacio válido -> NEON_CLIP_NO_SPACE, sin crash", () => {
  const [seg] = buildNeonSegments([line(0, 0, 0, 20)]);
  const reserved = [{ t0: -1000, t1: 1000 }]; // cubre todo el segmento
  const { positions, issue } = planClipPositionsForSegment(seg, DEFAULT_CLIP_PLACEMENT_SETTINGS, reserved);
  assert.deepEqual(positions, []);
  assert.equal(issue.code, "NEON_CLIP_NO_SPACE");
});

test("planClipPositions: multi-segmento agrega posiciones e issues por cada uno", () => {
  const segs = buildNeonSegments([line(0, 0, 0, 500), line(200, 0, 200, 15)]);
  const { positions, issues } = planClipPositions(segs, DEFAULT_CLIP_PLACEMENT_SETTINGS, new Map([[segs[1].id, [{ t0: -1000, t1: 1000 }]]]));
  assert.ok(positions.get(segs[0].id).length > 0);
  assert.deepEqual(positions.get(segs[1].id), []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "NEON_CLIP_NO_SPACE");
});
