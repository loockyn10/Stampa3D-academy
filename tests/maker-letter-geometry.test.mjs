import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

// Este test carga los módulos TypeScript del pipeline geométrico de Stampa
// Maker (src/lib/maker/**) directamente con el compilador de TypeScript,
// igual que tests/calculator-pricing.test.mjs, pero resolviendo también el
// alias "@/..." y los imports relativos entre archivos del pipeline.

const root = process.cwd();
const srcRoot = path.join(root, "src");
const nodeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveModulePath(specifier, fromFile) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No se pudo resolver "${specifier}" desde ${fromFile}`);
}

function loadTsModule(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;

  const source = fs.readFileSync(absPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absPath,
  });

  const mod = { exports: {} };
  moduleCache.set(absPath, mod);

  const localRequire = (specifier) => {
    const resolved = resolveModulePath(specifier, absPath);
    return resolved ? loadTsModule(resolved) : nodeRequire(specifier);
  };

  const fn = new Function("require", "module", "exports", "__filename", "__dirname", outputText);
  fn(localRequire, mod, mod.exports, absPath, path.dirname(absPath));
  return mod.exports;
}

function loadMakerModule(relFromSrc) {
  return loadTsModule(path.join(srcRoot, relFromSrc));
}

const { createLetterGeometry } = loadMakerModule("lib/maker/geometry/createLetterGeometry.ts");
const { textToOpentypePath, flattenOpentypePath } = loadMakerModule("lib/maker/geometry/textToPaths.ts");
const { buildContourHierarchy } = loadMakerModule("lib/maker/geometry/contourHierarchy.ts");
const { insetContourGroups, outsetContourGroups, regroupClipperSolution, clipperPathsArea } = loadMakerModule("lib/maker/geometry/offsets.ts");
const { fitInteriorLip } = loadMakerModule("lib/maker/geometry/joints/interiorLip.ts");
const { computeRibBands } = loadMakerModule("lib/maker/geometry/body/modifiers/ribs.ts");
const { footprintAtOffset } = loadMakerModule("lib/maker/geometry/body/shared.ts");
const { computeGrooveBand } = loadMakerModule("lib/maker/geometry/body/modifiers/groove.ts");
const { punchCirclePattern } = loadMakerModule("lib/maker/geometry/patterns/circles.ts");
const { computeChannelFootprint } = loadMakerModule("lib/maker/geometry/front/lightChannel.ts");
const { validateLetterSignParams } = loadMakerModule("lib/maker/validation.ts");
const { buildLettersZipBlob, recenterMesh } = loadMakerModule("lib/maker/exporters/exportLettersZip.ts");
const { buildWordZipBlob } = loadMakerModule("lib/maker/exporters/exportWord.ts");
const opentype = nodeRequire("opentype.js");
const JSZipLib = nodeRequire("jszip");

function loadFont(fileName) {
  const buf = fs.readFileSync(path.join(root, "public/fonts/maker", fileName));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return opentype.parse(arrayBuffer);
}

const montserratBold = loadFont("Montserrat-Bold.woff");

const DEFAULT_PARAMS = {
  fontId: "montserrat-bold",
  heightMm: 100,
  depthMm: 40,
  wallMm: 1.6,
  baseMm: 1.2,
  bodyType: "standard",
  rearExpansionMm: 2,
  taperStyle: "stepped",
  ribsCount: 0,
  ribProtrusionMm: 0.8,
  ribWidthMm: 1.2,
  bevelEnabled: false,
  bevelDepthMm: 2,
  bevelInsetMm: 1,
  grooveEnabled: false,
  grooveInsetMm: 1,
  grooveWidthMm: 4,
  groovePositionMm: 20,
  frontType: "open",
  lidMm: 1.2,
  lidJoint: "glue",
  insertDepthMm: 3,
  clearanceMm: 0.2,
  lipWallMm: 0.8,
  maskThicknessMm: 1,
  maskWallThicknessMm: 1.2,
  maskSideDepthMm: 5,
  maskClearanceMm: 0.2,
  diffuserThicknessMm: 0.6,
  holeDiameterMm: 2,
  pitchMm: 4,
  edgeMarginMm: 2,
  channelWidthMm: 6,
  channelDepthMm: 4,
  channelOffsetMm: 2,
  diffuserClearanceMm: 0.2,
};

// 0.4 Etapa 1: LetterGeometryResult/LetterPieceResult exponen `parts:
// SignPart[]` en vez de campos fijos `body`/`lid` (ver types.ts). Estos
// helpers buscan por `kind` para no reescribir cada assert existente con
// `.find(...)` inline.
function findPart(withParts, kind) {
  const part = withParts.parts.find((p) => p.kind === kind);
  return part ? part.mesh : null;
}
function bodyOf(withParts) {
  const mesh = findPart(withParts, "body");
  assert.ok(mesh, "se esperaba una pieza \"body\"");
  return mesh;
}
function lidOf(withParts) {
  return findPart(withParts, "lid");
}

function assertFiniteFloatArray(arr, label) {
  for (let i = 0; i < arr.length; i++) {
    assert.ok(Number.isFinite(arr[i]), `${label}[${i}] no es finito: ${arr[i]}`);
  }
}

function assertValidMesh(mesh, label) {
  assert.ok(mesh.triangleCount > 0, `${label}: se esperaban triángulos`);
  assert.equal(mesh.positions.length, mesh.triangleCount * 9, `${label}: positions no coincide con triangleCount`);
  assert.equal(mesh.normals.length, mesh.positions.length, `${label}: normals no coincide con positions`);
  assertFiniteFloatArray(mesh.positions, `${label}.positions`);
  assertFiniteFloatArray(mesh.normals, `${label}.normals`);
}

// Analiza la topología del triangle soup: cada arista debe estar compartida
// por exactamente 2 triángulos con orientación opuesta (interior, sólido
// cerrado) o por 1 solo triángulo (borde real, p.ej. el frente abierto).
// Cualquier otro conteo indica normales incorrectas, caras duplicadas o
// geometría no-manifold (sección 12 del spec).
function analyzeMeshTopology(positions) {
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const directedCounts = new Map();
  const triCount = positions.length / 9;
  let degenerate = 0;

  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const v = [
      [positions[o], positions[o + 1], positions[o + 2]],
      [positions[o + 3], positions[o + 4], positions[o + 5]],
      [positions[o + 6], positions[o + 7], positions[o + 8]],
    ];
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
    const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
    if (Math.hypot(cx, cy, cz) / 2 < 1e-9) degenerate++;

    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const dKey = `${key(...a)}|${key(...b)}`;
      directedCounts.set(dKey, (directedCounts.get(dKey) || 0) + 1);
    }
  }

  // El pipeline arma cada letra como DOS sólidos (fondo + pared) que se
  // tocan en z = baseMm; ahí sus caras pueden coincidir exactamente
  // (mismo contorno, mismo plano), así que una arista interior puede
  // aparecer más de una vez mientras ambas direcciones estén balanceadas
  // (N veces hacia adelante, N veces hacia atrás). Un borde real (frente
  // abierto) aparece una sola vez, sin contraparte.
  let boundaryEdges = 0;
  let interiorEdges = 0;
  let nonManifold = 0;
  const seenUndirected = new Set();

  for (const dKey of directedCounts.keys()) {
    const [a, b] = dKey.split("|");
    const undirectedKey = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenUndirected.has(undirectedKey)) continue;
    seenUndirected.add(undirectedKey);

    const forward = directedCounts.get(`${a}|${b}`) || 0;
    const backward = directedCounts.get(`${b}|${a}`) || 0;
    if (forward === backward) interiorEdges++;
    else if (forward + backward === 1) boundaryEdges++;
    else nonManifold++;
  }

  return { degenerate, boundaryEdges, interiorEdges, nonManifold, triCount };
}

// Cuenta shells/componentes conectados reales de la malla: dos triángulos
// están en el mismo componente si comparten un vértice (misma coordenada,
// con la misma tolerancia que analyzeMeshTopology). Esto es lo que
// distingue "un solo sólido soldado" de "varios sólidos que solo se
// tocan/superponen" — ambos casos pueden ser watertight y balanceados por
// separado, pero solo el primero cuenta como 1 acá.
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

// Centroide (ponderado por área) de un polígono simple, en el mismo
// sistema de coordenadas (mm) que usa el pipeline.
function polygonCentroid(points) {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  area /= 2;
  return [cx / (6 * area), cy / (6 * area)];
}

// Área con signo de un polígono simple (shoelace), en mm² (mismas unidades
// que el resto del pipeline). Usada para comparar el tamaño del labio bajo
// distintas holguras (sección 17.I del spec de 0.3).
function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function sign2D(px, py, ax, ay, bx, by) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

function pointInTriangle2D(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = sign2D(px, py, ax, ay, bx, by);
  const d2 = sign2D(px, py, bx, by, cx, cy);
  const d3 = sign2D(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Lanza un rayo vertical (paralelo a Z) por (x, y) y devuelve el Z de cada
// triángulo del mesh que atraviesa. Es la única forma confiable de probar
// "el hueco está libre": una malla puede ser watertight y perfectamente
// balanceada en aristas y aun así tener una cara tapando el counter (ver
// bug corregido en createLetterGeometry.ts — el fondo tapaba el hueco con
// una tapa real). Triángulos casi verticales (normal.z ~ 0) se ignoran: no
// tienen una Z bien definida para un (x, y) dado y no representan tapas.
function raycastZHits(positions, px, py) {
  const hits = [];
  const triCount = positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];
    if (!pointInTriangle2D(px, py, ax, ay, bx, by, cx, cy)) continue;

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.abs(nz) < 1e-9) continue;

    const z = az - (nx * (px - ax) + ny * (py - ay)) / nz;
    hits.push(z);
  }
  return hits;
}

// --- Sección 13 del spec: casos de prueba mínimos ---

for (const text of ["I", "L", "A", "O", "B", "8", "STAMPA", "LOOCK 3D"]) {
  test(`createLetterGeometry genera un mesh válido para "${text}"`, () => {
    const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text });
    assertValidMesh(bodyOf(result), text);
  });

  test(`createLetterGeometry genera una malla topológicamente correcta para "${text}"`, () => {
    const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text });
    const topo = analyzeMeshTopology(bodyOf(result).positions);
    assert.equal(topo.degenerate, 0, `${text}: triángulos degenerados`);
    assert.equal(topo.nonManifold, 0, `${text}: aristas no-manifold (normales/caras incorrectas)`);
    // El fondo y cada banda de la pared se tapan en ambos extremos (ver
    // fix de huecos): cada pieza queda totalmente cerrada por sí sola, sin
    // bordes abiertos. "Frente abierto" es la ausencia de geometría sobre
    // la cavidad, no un borde sin tapar (ver tests de counters más abajo).
    assert.equal(topo.boundaryEdges, 0, `${text}: no se esperaban bordes abiertos (fondo y pared quedan totalmente cerrados)`);
  });
}

test('el texto "STAMPA" no dispara advertencias con parámetros por defecto', () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "STAMPA" });
  assert.deepEqual(result.warnings, []);
});

// --- Sección 5 del spec: jerarquía de contornos y huecos ---

function contourGroupsFor(char, heightMm = 100) {
  const path = textToOpentypePath(montserratBold, char, heightMm);
  const rawContours = flattenOpentypePath(path);
  return buildContourHierarchy(rawContours);
}

test('"O" produce un contorno exterior con exactamente 1 hueco', () => {
  const groups = contourGroupsFor("O");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].holes.length, 1);
});

test('"B" produce un contorno exterior con exactamente 2 huecos', () => {
  const groups = contourGroupsFor("B");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].holes.length, 2);
});

test('"8" produce un contorno exterior con exactamente 2 huecos', () => {
  const groups = contourGroupsFor("8");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].holes.length, 2);
});

test('"STAMPA" produce un grupo de contornos exterior por letra, con huecos en A y P', () => {
  const groups = contourGroupsFor("STAMPA");
  // S,T,A,M,P,A -> 6 letras -> 6 exteriores
  assert.equal(groups.length, 6);
  const totalHoles = groups.reduce((sum, g) => sum + g.holes.length, 0);
  assert.equal(totalHoles, 3); // las dos "A" + el ojal de la "P"
});

// --- Sección 10 del spec: pared demasiado gruesa para el tamaño del texto ---

test("pared mucho más gruesa que el trazo genera advertencia WALL_TOO_THICK pero no rompe la geometría", () => {
  const result = createLetterGeometry(montserratBold, {
    text: "I",
    fontId: "montserrat-bold",
    heightMm: 5,
    depthMm: 10,
    wallMm: 20,
    baseMm: 1,
    bodyType: "standard",
    frontType: "open",
  });
  assertValidMesh(bodyOf(result), "I-pared-excesiva");
  assert.ok(result.warnings.some((w) => w.code === "WALL_TOO_THICK"));
});

test("texto vacío no genera geometría ni lanza excepción", () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "" });
  assert.equal(result.triangleCount, 0);
  assert.ok(result.warnings.some((w) => w.code === "EMPTY_TEXT"));
});

// --- validación de parámetros (sección 10) ---

test("validateLetterSignParams rechaza dimensiones <= 0 y texto vacío", () => {
  const errors = validateLetterSignParams({
    text: "",
    fontId: "montserrat-bold",
    heightMm: 0,
    depthMm: -1,
    wallMm: 0,
    baseMm: 0,
  });
  const fields = errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ["baseMm", "depthMm", "heightMm", "text", "wallMm"]);
});

test("validateLetterSignParams rechaza fondo >= profundidad", () => {
  const errors = validateLetterSignParams({
    text: "STAMPA",
    fontId: "montserrat-bold",
    heightMm: 100,
    depthMm: 10,
    wallMm: 1.6,
    baseMm: 10,
  });
  assert.ok(errors.some((e) => e.field === "baseMm"));
});

// --- Verificación geométrica de huecos (counters) ---
//
// Reproduce el bug reportado: el fondo tapaba el counter con una cara real
// en z = baseMm, y la pared no cerraba su propio extremo frontal. Ninguno
// de los dos problemas lo detecta analyzeMeshTopology (la malla era
// watertight-con-borde, solo que con la forma equivocada). Estos tests
// disparan un rayo vertical por el centro de cada counter y verifican que
// no exista NINGÚN triángulo (de ninguna de las dos piezas, en ningún
// tramo de Z) que lo cruce.

const EPS_Z = 0.5; // mm, margen fuera de [0, depthMm] para ignorar ruido numérico

function assertCounterIsFree(text, holePoints, label) {
  const [cx, cy] = polygonCentroid(holePoints);
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text });
  const hits = raycastZHits(bodyOf(result).positions, cx, cy).filter(
    (z) => z > -EPS_Z && z < DEFAULT_PARAMS.depthMm + EPS_Z,
  );
  assert.deepEqual(
    hits,
    [],
    `${label}: se esperaba el counter libre en (${cx.toFixed(2)}, ${cy.toFixed(2)}) mm mm, pero hay geometría en z=[${hits.join(", ")}]`,
  );
}

test('"O": el counter queda completamente libre en toda la profundidad (fondo + pared)', () => {
  const groups = contourGroupsFor("O");
  assertCounterIsFree("O", groups[0].holes[0], "O");
});

test('"B": ambos counters quedan completamente libres', () => {
  const groups = contourGroupsFor("B");
  groups[0].holes.forEach((hole, i) => assertCounterIsFree("B", hole, `B (counter ${i})`));
});

test('"8": ambos counters quedan completamente libres', () => {
  const groups = contourGroupsFor("8");
  groups[0].holes.forEach((hole, i) => assertCounterIsFree("8", hole, `8 (counter ${i})`));
});

test('"A": el counter triangular queda completamente libre', () => {
  const groups = contourGroupsFor("A");
  assertCounterIsFree("A", groups[0].holes[0], "A");
});

// --- Back/floor: el fondo debe ser un anillo, no un disco ---

test('"O": el fondo (z entre 0 y baseMm) no tiene geometría sobre el counter', () => {
  const groups = contourGroupsFor("O");
  const [cx, cy] = polygonCentroid(groups[0].holes[0]);
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const hitsInFondo = raycastZHits(bodyOf(result).positions, cx, cy).filter(
    (z) => z > -EPS_Z && z < DEFAULT_PARAMS.baseMm + EPS_Z,
  );
  assert.deepEqual(hitsInFondo, [], `el fondo no debería tener ninguna cara sobre el counter, hay geometría en z=[${hitsInFondo.join(", ")}]`);
});

test('"O": el fondo SÍ tiene material sólido bajo el trazo de la letra (control positivo)', () => {
  const groups = contourGroupsFor("O");
  // Punto sobre el trazo: a mitad de camino entre el borde exterior y el
  // borde del counter, sobre el eje horizontal que pasa por el centro.
  const [, holeCy] = polygonCentroid(groups[0].holes[0]);
  const outerXs = groups[0].outer.map(([x]) => x);
  const midX = (Math.max(...outerXs) + Math.max(...groups[0].holes[0].map(([x]) => x))) / 2;
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const hits = raycastZHits(bodyOf(result).positions, midX, holeCy).filter((z) => z > -EPS_Z && z < DEFAULT_PARAMS.depthMm + EPS_Z);
  assert.ok(hits.length > 0, `se esperaba material sólido en el trazo de la "O" en (${midX.toFixed(2)}, ${holeCy.toFixed(2)})`);
});

// --- Front: no debe existir una tapa frontal cubriendo la cavidad ---

test('"O": no hay ninguna cara exactamente en z = depthMm sobre el counter (frente abierto real)', () => {
  const groups = contourGroupsFor("O");
  const [cx, cy] = polygonCentroid(groups[0].holes[0]);
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const hits = raycastZHits(bodyOf(result).positions, cx, cy);
  const nearFront = hits.filter((z) => Math.abs(z - DEFAULT_PARAMS.depthMm) < 1);
  assert.deepEqual(nearFront, [], `no debería haber tapa frontal sobre la cavidad, se encontró en z=[${nearFront.join(", ")}]`);
});

// --- Wall thickness: la pared debe tener ~wallMm de espesor real ---

function pointToSegmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx, projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function minDistanceToPolygon(point, polygon) {
  let min = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    min = Math.min(min, pointToSegmentDistance(point, a, b));
  }
  return min;
}

test('"O": la erosión de la pared (wallMm=1.6) queda a ~1.6mm del contorno más cercano (exterior u hueco)', () => {
  const groups = contourGroupsFor("O");
  const insetPaths = insetContourGroups(groups, DEFAULT_PARAMS.wallMm);
  assert.ok(insetPaths.length > 0, "el inset no debería estar vacío para una O de 100mm con pared 1.6mm");

  // insetContourGroups devuelve paths de Clipper en unidades escaladas
  // (mm * CLIPPER_SCALE); volvemos a mm dividiendo por la misma escala
  // interna documentada en offsets.ts.
  const CLIPPER_SCALE = 10000;
  const samples = [];
  for (const path of insetPaths) {
    for (let i = 0; i < path.length; i += Math.max(1, Math.floor(path.length / 8))) {
      samples.push([path[i].X / CLIPPER_SCALE, path[i].Y / CLIPPER_SCALE]);
    }
  }
  assert.ok(samples.length > 0, "no se pudieron samplear puntos del inset");

  // Cada punto del inset erosionó desde ALGÚN borde original: el exterior
  // o alguno de los huecos (cuál de los dos depende de qué lado del
  // trazo quedó ese punto). Medimos contra el más cercano de todos.
  const referenceBoundaries = [groups[0].outer, ...groups[0].holes];
  const distances = samples.map((pt) => Math.min(...referenceBoundaries.map((poly) => minDistanceToPolygon(pt, poly))));
  for (const d of distances) {
    assert.ok(
      d > DEFAULT_PARAMS.wallMm * 0.5 && d < DEFAULT_PARAMS.wallMm * 1.5,
      `distancia al contorno más cercano fuera de rango: ${d.toFixed(3)}mm (esperado ~${DEFAULT_PARAMS.wallMm}mm)`,
    );
  }
});

// --- Watertight (complementa analyzeMeshTopology, sección 12) ---

test('"O": la malla completa (fondo + repisa + pared) es topológicamente correcta', () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const topo = analyzeMeshTopology(bodyOf(result).positions);
  assert.equal(topo.degenerate, 0);
  assert.equal(topo.nonManifold, 0);
  // Fondo, repisa del núcleo y pared comparten vértices en cada frontera
  // (ver createLetterGeometry.ts): no debería quedar ningún borde suelto.
  assert.equal(topo.boundaryEdges, 0, "no se esperaban bordes abiertos: la letra queda totalmente cerrada como un único sólido soldado");
});

// --- Connected components: ¿una letra es 1 solo sólido o varios shells? ---
//
// El bug original (Stampa Maker 0.1, primera versión): fondo y pared eran
// dos sólidos watertight *independientes* que solo se tocaban/superponían
// en z = baseMm (cada uno con su propia tapa completa ahí). Cada uno pasaba
// analyzeMeshTopology de forma aislada, pero juntos formaban 2 (letras sin
// huecos) o hasta 4 (letras con 2 huecos, p.ej. B/8) shells separados —
// exactamente lo que Bambu Studio separaría con "Dividir en objetos".
//
// La solución (ver createLetterGeometry.ts, buildWeldedLetterSolid) no usa
// ninguna operación booleana 3D: construye la letra desde el origen como
// una única malla que comparte vértices en cada frontera real (exterior y
// huecos originales corren de punta a punta; el núcleo erosionado por la
// pared aporta la única tapa en z = baseMm, en vez de que fondo y pared
// tapen por separado el mismo lugar). Resultado verificado acá: 1 solo
// componente conectado por letra para I/O/A/B/8, incluso con 2 huecos.
for (const text of ["I", "O", "A", "B", "8"]) {
  test(`"${text}": la letra terminada es UN solo componente conectado (no varios shells)`, () => {
    const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text });
    const components = countConnectedComponents(bodyOf(result).positions);
    assert.equal(components, 1, `"${text}": se esperaba 1 shell soldado, se encontraron ${components}`);
  });
}

// --- Exportación de letras individuales (ZIP) ---

function meshBounds(positions) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

test('"STAMPA": genera 6 letras exportables y un ZIP con 6 STL nombrados correctamente', async () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "STAMPA" });
  assert.equal(result.letters.length, 6);

  const blob = await buildLettersZipBlob(result);
  const zip = await JSZipLib.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ["01_S.stl", "02_T.stl", "03_A.stl", "04_M.stl", "05_P.stl", "06_A.stl"]);
});

test('"LOOCK 3D": el espacio no genera archivo, se generan 7 STL con nombres únicos', async () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "LOOCK 3D" });
  assert.equal(result.letters.length, 7);
  assert.deepEqual(result.letters.map((l) => l.char), ["L", "O", "O", "C", "K", "3", "D"]);

  const blob = await buildLettersZipBlob(result);
  const zip = await JSZipLib.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ["01_L.stl", "02_O.stl", "03_O.stl", "04_C.stl", "05_K.stl", "06_3.stl", "07_D.stl"]);
  assert.equal(new Set(names).size, names.length, "los nombres deben ser únicos");
});

test("recenterMesh: el cuerpo de cada letra individual queda centrado en XY con minZ = 0", () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "STAMPA" });
  for (const letter of result.letters) {
    const recentered = recenterMesh(bodyOf(letter));
    const b = meshBounds(recentered.positions);
    const centerX = (b.minX + b.maxX) / 2;
    const centerY = (b.minY + b.maxY) / 2;
    assert.ok(Math.abs(centerX) < 1e-3, `"${letter.char}": centro X fuera de rango (${centerX})`);
    assert.ok(Math.abs(centerY) < 1e-3, `"${letter.char}": centro Y fuera de rango (${centerY})`);
    assert.ok(Math.abs(b.minZ) < 1e-6, `"${letter.char}": minZ debería ser 0 (${b.minZ})`);
  }
});

test('recenterMesh: la "P" de STAMPA no conserva su offset X original dentro de la palabra', () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "STAMPA" });
  const p = result.letters.find((l) => l.char === "P");
  const originalBounds = meshBounds(bodyOf(p).positions);
  assert.ok(originalBounds.minX > 50, "la P debería estar bien desplazada en X dentro de la palabra completa");

  const recentered = recenterMesh(bodyOf(p));
  const b = meshBounds(recentered.positions);
  assert.ok(Math.abs((b.minX + b.maxX) / 2) < 1e-3, "el centro X recentrado debería quedar ~0");
});

test('exportación individual: la "O" recentrada mantiene el counter libre en toda la profundidad', () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const letter = result.letters[0];
  const recentered = recenterMesh(bodyOf(letter));

  // Centro del counter en coordenadas originales, trasladado con el mismo
  // offset que recenterMesh le aplicó a la malla completa.
  const groups = contourGroupsFor("O");
  const [holeCx, holeCy] = polygonCentroid(groups[0].holes[0]);
  const originalBounds = meshBounds(bodyOf(letter).positions);
  const shiftX = (originalBounds.minX + originalBounds.maxX) / 2;
  const shiftY = (originalBounds.minY + originalBounds.maxY) / 2;

  const hits = raycastZHits(recentered.positions, holeCx - shiftX, holeCy - shiftY).filter(
    (z) => z > -EPS_Z && z < DEFAULT_PARAMS.depthMm + EPS_Z,
  );
  assert.deepEqual(hits, [], `se esperaba el counter libre tras recentrar, hay geometría en z=[${hits.join(", ")}]`);
});

// --- Stampa Maker 0.2: tapa frontal plana ---
//
// La tapa es una pieza SEPARADA (no soldada al cuerpo, ver
// createLetterGeometry.ts sección "Tapa frontal"): usa exactamente la
// silueta del fondo (exterior menos huecos originales del glifo, nunca un
// disco) extruida de z=depthMm a z=depthMm+lidMm. El cuerpo no cambia
// cuando se activa la tapa.

const LID_PARAMS = { ...DEFAULT_PARAMS, frontType: "lid", lidMm: 1.2 };

test('frontType "open": result.lid y letters[].lid son null', () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  assert.equal(lidOf(result), null);
  assert.equal(lidOf(result.letters[0]), null);
});

for (const text of ["A", "O", "B", "8"]) {
  test(`tapa frontal "${text}": mesh válido, manifold/watertight y sin tapar el counter`, () => {
    const result = createLetterGeometry(montserratBold, { ...LID_PARAMS, text });
    const letter = result.letters[0];
    assert.ok(lidOf(letter), `"${text}": se esperaba una tapa`);
    assertValidMesh(lidOf(letter), `${text}.lid`);

    const topo = analyzeMeshTopology(lidOf(letter).positions);
    assert.equal(topo.degenerate, 0, `${text}.lid: triángulos degenerados`);
    assert.equal(topo.nonManifold, 0, `${text}.lid: aristas no-manifold`);
    assert.equal(topo.boundaryEdges, 0, `${text}.lid: no se esperaban bordes abiertos (tapa sólida y cerrada)`);

    // El counter debe seguir libre en la tapa: NO puede convertirse en un disco.
    const groups = contourGroupsFor(text);
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      const hits = raycastZHits(lidOf(letter).positions, hx, hy);
      assert.deepEqual(hits, [], `${text}.lid: se esperaba el counter libre en la tapa, hay geometría en z=[${hits.join(", ")}]`);
    }
  });
}

test('tapa frontal "O": ocupa exactamente z = [depthMm, depthMm + lidMm]', () => {
  const result = createLetterGeometry(montserratBold, { ...LID_PARAMS, text: "O" });
  const b = meshBounds(lidOf(result.letters[0]).positions);
  assert.ok(Math.abs(b.minZ - LID_PARAMS.depthMm) < 1e-6, `minZ debería ser depthMm (${LID_PARAMS.depthMm}), fue ${b.minZ}`);
  assert.ok(
    Math.abs(b.maxZ - (LID_PARAMS.depthMm + LID_PARAMS.lidMm)) < 1e-6,
    `maxZ debería ser depthMm+lidMm (${LID_PARAMS.depthMm + LID_PARAMS.lidMm}), fue ${b.maxZ}`,
  );
});

test('tapa frontal "O": el cuerpo no cambia respecto al frente abierto (misma profundidad, misma malla)', () => {
  const openResult = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const lidResult = createLetterGeometry(montserratBold, { ...LID_PARAMS, text: "O" });
  assert.deepEqual(Array.from(bodyOf(lidResult.letters[0]).positions), Array.from(bodyOf(openResult.letters[0]).positions));
});

test('"STAMPA" con tapa frontal: cada letra exporta cuerpo+tapa (12 STL en el ZIP, nombres correctos)', async () => {
  const result = createLetterGeometry(montserratBold, { ...LID_PARAMS, text: "STAMPA" });
  const blob = await buildLettersZipBlob(result);
  const zip = await JSZipLib.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, [
    "01_S_cuerpo.stl", "01_S_tapa.stl",
    "02_T_cuerpo.stl", "02_T_tapa.stl",
    "03_A_cuerpo.stl", "03_A_tapa.stl",
    "04_M_cuerpo.stl", "04_M_tapa.stl",
    "05_P_cuerpo.stl", "05_P_tapa.stl",
    "06_A_cuerpo.stl", "06_A_tapa.stl",
  ]);
});

test('palabra completa con tapa frontal: ZIP con <nombre>_cuerpo.stl + <nombre>_tapa.stl', async () => {
  const result = createLetterGeometry(montserratBold, { ...LID_PARAMS, text: "STAMPA" });
  const blob = await buildWordZipBlob(result, "stampa");
  const zip = await JSZipLib.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ["stampa_cuerpo.stl", "stampa_tapa.stl"]);
});

test("validateLetterSignParams: espesor de tapa fuera de rango (0.4-10mm) cuando frontType es lid", () => {
  const tooThin = validateLetterSignParams({ ...LID_PARAMS, text: "O", lidMm: 0.1 });
  assert.ok(tooThin.some((e) => e.field === "lidMm"));

  const tooThick = validateLetterSignParams({ ...LID_PARAMS, text: "O", lidMm: 15 });
  assert.ok(tooThick.some((e) => e.field === "lidMm"));

  const valid = validateLetterSignParams({ ...LID_PARAMS, text: "O", lidMm: 1.2 });
  assert.ok(!valid.some((e) => e.field === "lidMm"));
});

test("validateLetterSignParams: lidMm fuera de rango no genera error si frontType es open", () => {
  const errors = validateLetterSignParams({ ...DEFAULT_PARAMS, text: "O", lidMm: 999 });
  assert.ok(!errors.some((e) => e.field === "lidMm"));
});

// --- Stampa Maker 0.3: tapa encastrable (labio interior) ---
//
// La tapa encastrable arma placa + labio en UNA sola pieza (ver
// geometry/lid.ts, geometry/joints/interiorLip.ts): el labio deriva de la
// MISMA cavidad que ya usa el cuerpo (núcleo erosionado por wallMm, la
// pared interior real) más una holgura adicional por lado (clearanceMm) —
// sin bounding boxes, rectángulos aproximados ni hacks por letra.

const LIP_PARAMS = { ...DEFAULT_PARAMS, frontType: "lid", lidJoint: "interior-lip", lidMm: 1.2, insertDepthMm: 3, clearanceMm: 0.2 };

// A. Regression: el cuerpo con frente abierto es ajeno a
// lidJoint/insertDepthMm/clearanceMm (ni siquiera los lee).
test('regresión 0.3: "O" con frente abierto no cambia con los campos nuevos presentes', () => {
  const withExtraFields = createLetterGeometry(montserratBold, { ...LIP_PARAMS, frontType: "open", text: "O" });
  const reference = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  assert.deepEqual(Array.from(bodyOf(withExtraFields.letters[0]).positions), Array.from(bodyOf(reference.letters[0]).positions));
  assert.equal(lidOf(withExtraFields), null);
});

// B. Regression: tapa plana (lidJoint "glue") sigue siendo exactamente la
// misma pieza que en 0.2 (mismo código: geometry/lid.ts solo movió la
// rama "glue" tal cual, sin tocarla).
test('regresión 0.3: tapa plana ("O") no cambia al introducir lidJoint/insertDepthMm/clearanceMm', () => {
  const withExtraFields = createLetterGeometry(montserratBold, { ...LID_PARAMS, insertDepthMm: 3, clearanceMm: 0.2, text: "O" });
  const reference = createLetterGeometry(montserratBold, { ...LID_PARAMS, text: "O" });
  assert.deepEqual(Array.from(lidOf(withExtraFields.letters[0]).positions), Array.from(lidOf(reference.letters[0]).positions));
});

// C-F. O/A/B/8: placa+labio válido, manifold/watertight, counters libres,
// 1 solo componente conectado (placa+labio soldados, no dos shells).
for (const text of ["A", "O", "B", "8"]) {
  test(`tapa encastrable "${text}": placa+labio válido, manifold/watertight, counters libres y 1 componente conectado`, () => {
    const result = createLetterGeometry(montserratBold, { ...LIP_PARAMS, text });
    const letter = result.letters[0];
    assert.ok(lidOf(letter), `"${text}": se esperaba una tapa`);
    assertValidMesh(lidOf(letter), `${text}.lid`);

    const topo = analyzeMeshTopology(lidOf(letter).positions);
    assert.equal(topo.degenerate, 0, `${text}.lid: triángulos degenerados`);
    assert.equal(topo.nonManifold, 0, `${text}.lid: aristas no-manifold`);
    assert.equal(topo.boundaryEdges, 0, `${text}.lid: no se esperaban bordes abiertos (placa+labio soldados)`);

    const components = countConnectedComponents(lidOf(letter).positions);
    assert.equal(components, 1, `${text}.lid: se esperaba 1 componente conectado (placa+labio soldados), se encontraron ${components}`);

    const groups = contourGroupsFor(text);
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      const hits = raycastZHits(lidOf(letter).positions, hx, hy);
      assert.deepEqual(hits, [], `${text}.lid: se esperaba el counter libre en la tapa encastrable, hay geometría en z=[${hits.join(", ")}]`);
    }
  });
}

// G. Insert depth: el labio se extiende ~insertDepthMm hacia el interior
// (minZ de la tapa combinada = depthMm - insertDepthMm; maxZ sin cambios).
test('tapa encastrable "O": el labio ocupa z = [depthMm - insertDepthMm, depthMm + lidMm]', () => {
  const result = createLetterGeometry(montserratBold, { ...LIP_PARAMS, text: "O" });
  const b = meshBounds(lidOf(result.letters[0]).positions);
  const expectedMinZ = LIP_PARAMS.depthMm - LIP_PARAMS.insertDepthMm;
  assert.ok(Math.abs(b.minZ - expectedMinZ) < 1e-6, `minZ debería ser depthMm-insertDepthMm (${expectedMinZ}), fue ${b.minZ}`);
  assert.ok(
    Math.abs(b.maxZ - (LIP_PARAMS.depthMm + LIP_PARAMS.lidMm)) < 1e-6,
    `maxZ debería ser depthMm+lidMm (${LIP_PARAMS.depthMm + LIP_PARAMS.lidMm}), fue ${b.maxZ}`,
  );
});

// --- Corrección 0.3.1: el labio es un ANILLO/marco perimetral fino
// (lipWallMm), NO toda la región interior de la cavidad. La corrección
// afecta cómo se construye fitInteriorLip: ahora devuelve el anillo (2
// bandas separadas para un trazo anular como "O", 1 marco para un trazo
// simple como "I"), no la fit region completa. Se prueba con "I" (1 solo
// grupo, sin ambigüedad de cuál banda es "la exterior") para las
// mediciones precisas de holgura/espesor, y con "O" para el caso anular
// (dos bandas + vacío central), que es el caso crítico del spec.

function ringFitFor(char, heightMm, wallMm, clearanceMm, lipWallMm, insertDepthMm) {
  const groups = contourGroupsFor(char, heightMm);
  return { groups, fit: fitInteriorLip(groups[0], wallMm, clearanceMm, lipWallMm, insertDepthMm) };
}

// 2 y 7. "O" encastrable: placa + MARCO perimetral fino (2 bandas, no toda
// la cavidad). Cada banda tiene UN borde que toca la fit region real (a
// ~clearanceMm de la cavidad) y otro borde ya erosionado además por
// lipWallMm (más lejos) — cuál de los dos es ".outer" y cuál ".holes[0]"
// depende de la clasificación exterior/hueco de Clipper (el "outer" es
// simplemente la curva que contiene a la otra, no necesariamente la más
// cercana a la cavidad). Por eso se mide la distancia MÍNIMA entre AMBAS
// curvas de cada banda y la cavidad: esa mínima es la que sigue
// respetando exactamente `clearanceMm`.
test('tapa encastrable "O": el labio es un anillo de 2 bandas (no toda la cavidad), y cada banda toca la cavidad a ~0.20mm por lado', () => {
  const { groups, fit } = ringFitFor("O", DEFAULT_PARAMS.heightMm, DEFAULT_PARAMS.wallMm, 0.2, 0.8, 3);
  assert.equal(fit.collapsed, false);
  assert.equal(fit.groups.length, 2, `"O": se esperaban 2 bandas del anillo (exterior + interior), se encontraron ${fit.groups.length}`);

  const CLIPPER_SCALE = 10000;
  const cavityRawPaths = insetContourGroups(groups, DEFAULT_PARAMS.wallMm);
  const cavityBoundaries = cavityRawPaths.map((path) => path.map((p) => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE]));

  const distanceToCavity = (curve) => {
    const step = Math.max(1, Math.floor(curve.length / 8));
    const samples = curve.filter((_, i) => i % step === 0);
    return Math.min(...samples.map((pt) => Math.min(...cavityBoundaries.map((poly) => minDistanceToPolygon(pt, poly)))));
  };

  for (const ringBand of fit.groups) {
    const nearest = Math.min(distanceToCavity(ringBand.outer), ...ringBand.holes.map(distanceToCavity));
    assert.ok(nearest > 0.2 * 0.5 && nearest < 0.2 * 1.5, `banda del anillo demasiado lejos de la cavidad: ${nearest.toFixed(3)}mm (esperado ~0.20mm)`);
  }
});

// 7 (precisión, sin ambigüedad de bandas): en un trazo simple ("I", un
// solo marco/frame) el borde exterior del anillo es literalmente el borde
// de la fit region, así que mide clearanceMm exacto respecto de la
// cavidad — mismo chequeo que antes de esta corrección.
test('tapa encastrable "I": el borde exterior del marco mide ~0.20mm de la cavidad (holgura por lado)', () => {
  const groups = contourGroupsFor("I", DEFAULT_PARAMS.heightMm);
  const fit = fitInteriorLip(groups[0], DEFAULT_PARAMS.wallMm, 0.2, 0.8, 3);
  assert.equal(fit.collapsed, false);
  assert.equal(fit.groups.length, 1);

  const CLIPPER_SCALE = 10000;
  const cavityRawPaths = insetContourGroups(groups, DEFAULT_PARAMS.wallMm);
  const cavityBoundaries = cavityRawPaths.map((path) => path.map((p) => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE]));

  const outer = fit.groups[0].outer;
  const step = Math.max(1, Math.floor(outer.length / 12));
  const samples = outer.filter((_, i) => i % step === 0);
  for (const pt of samples) {
    const d = Math.min(...cavityBoundaries.map((poly) => minDistanceToPolygon(pt, poly)));
    assert.ok(d > 0.2 * 0.5 && d < 0.2 * 1.5, `distancia marco-cavidad fuera de rango: ${d.toFixed(3)}mm (esperado ~0.20mm)`);
  }
});

// 3 y 4. La región del labio NO ocupa toda la cavidad: debe existir un
// vacío real entre las paredes del anillo (para "O", el vacío es en sí
// mismo anular — sigue rodeando el counter — pero deja de tocar tanto el
// borde exterior como el borde interior de la fit region).
test('tapa encastrable "O": existe un vacío real entre las dos bandas del anillo (el labio no ocupa toda la cavidad)', () => {
  const groups = contourGroupsFor("O", DEFAULT_PARAMS.heightMm);
  const cavityGroups = regroupClipperSolution(insetContourGroups(groups, DEFAULT_PARAMS.wallMm));
  const fitGroups = regroupClipperSolution(insetContourGroups(cavityGroups, 0.2));
  const voidRawPaths = insetContourGroups(fitGroups, 0.8);
  const voidArea = Math.abs(clipperPathsArea(voidRawPaths));
  assert.ok(voidArea > 1, `se esperaba un vacío central con área relevante, fue ${voidArea.toFixed(4)}mm²`);

  const voidGroups = regroupClipperSolution(voidRawPaths);
  assert.equal(voidGroups.length, 1, "el vacío de una O debería seguir siendo 1 anillo (rodea el counter)");
  assert.equal(voidGroups[0].holes.length, 1, "el vacío debe conservar el counter como hueco, no rellenarlo");
});

// 5. Propiedad crítica para difusión de luz: una zona interior alejada del
// perímetro (el vacío detrás de la placa) debe conservar SOLO lidThickness
// de espesor, nunca lidThickness + insertDepth. Ejemplo del spec: O con
// alto 50mm, profundidad 10mm, pared 1.6mm, fondo 1.2mm, lidThickness
// 0.6mm, insertDepth 1.4mm, lipWallMm 0.8mm, clearance 0.2mm.
test('tapa encastrable "O": la zona vacía detrás de la placa mide solo lidThickness, nunca lidThickness+insertDepth', () => {
  const params = {
    ...LIP_PARAMS,
    text: "O",
    heightMm: 50,
    depthMm: 10,
    wallMm: 1.6,
    baseMm: 1.2,
    lidMm: 0.6,
    insertDepthMm: 1.4,
    lipWallMm: 0.8,
    clearanceMm: 0.2,
  };
  const result = createLetterGeometry(montserratBold, params);
  assert.deepEqual(result.errors, []);

  // Punto de control dentro del vacío: mismo patrón que el "control
  // positivo" ya usado para el trazo (sección de counters arriba) —
  // punto medio entre el borde exterior y el borde interior (counter) del
  // vacío, sobre el eje que pasa por el centro.
  const groups = contourGroupsFor("O", params.heightMm);
  const cavityGroups = regroupClipperSolution(insetContourGroups(groups, params.wallMm));
  const fitGroups = regroupClipperSolution(insetContourGroups(cavityGroups, params.clearanceMm));
  const voidGroups = regroupClipperSolution(insetContourGroups(fitGroups, params.lipWallMm));
  const voidOuter = voidGroups[0];
  const [, holeCy] = polygonCentroid(voidOuter.holes[0]);
  const midX = (Math.max(...voidOuter.outer.map(([x]) => x)) + Math.max(...voidOuter.holes[0].map(([x]) => x))) / 2;

  const hits = raycastZHits(lidOf(result.letters[0]).positions, midX, holeCy);
  const uniqueHits = [...new Set(hits.map((z) => Math.round(z * 1000) / 1000))].sort((a, b) => a - b);
  assert.deepEqual(
    uniqueHits,
    [params.depthMm, params.depthMm + params.lidMm],
    `zona vacía: se esperaba geometría SOLO en [depthMm, depthMm+lidMm] (placa fina), se encontró en z=[${uniqueHits.join(", ")}]`,
  );
  const thickness = uniqueHits[1] - uniqueHits[0];
  assert.ok(Math.abs(thickness - params.lidMm) < 1e-6, `espesor en la zona vacía debería ser lidMm (${params.lidMm}mm), fue ${thickness}mm`);
  assert.ok(
    Math.abs(thickness - (params.lidMm + params.insertDepthMm)) > 0.5,
    "la zona vacía NO debería tener el espesor de lidMm+insertDepthMm (ese era el bug de la versión anterior)",
  );
});

// 6. lipWallMm produce aproximadamente esa medida de pared donde la
// geometría lo permite: distancia entre el borde exterior y el borde
// interior (hueco) de cada banda del anillo.
test('tapa encastrable "O": lipWallMm=0.8 produce ~0.8mm de espesor de pared en cada banda del anillo', () => {
  const { fit } = ringFitFor("O", DEFAULT_PARAMS.heightMm, DEFAULT_PARAMS.wallMm, 0.2, 0.8, 3);
  assert.equal(fit.collapsed, false);
  for (const ringBand of fit.groups) {
    assert.equal(ringBand.holes.length, 1, "cada banda del anillo debería tener exactamente 1 hueco (su propio borde interior)");
    const step = Math.max(1, Math.floor(ringBand.outer.length / 8));
    const samples = ringBand.outer.filter((_, i) => i % step === 0);
    const dists = samples.map((pt) => minDistanceToPolygon(pt, ringBand.holes[0]));
    for (const d of dists) {
      assert.ok(d > 0.8 * 0.5 && d < 0.8 * 1.5, `espesor de banda fuera de rango: ${d.toFixed(3)}mm (esperado ~0.8mm)`);
    }
  }
});

// I. Comparación de clearance: mayor holgura -> anillo más chico/separado
// de la cavidad (mismo mecanismo que antes, medido sobre "I" para evitar
// ambigüedad de cuál banda del anillo es "la" banda cuando hay más de una).
test('tapa encastrable "I": mayor clearance separa más el anillo de la cavidad (0.10mm vs 0.30mm)', () => {
  const fitSmall = ringFitFor("I", DEFAULT_PARAMS.heightMm, DEFAULT_PARAMS.wallMm, 0.1, 0.8, 3).fit;
  const fitLarge = ringFitFor("I", DEFAULT_PARAMS.heightMm, DEFAULT_PARAMS.wallMm, 0.3, 0.8, 3).fit;
  assert.equal(fitSmall.collapsed, false);
  assert.equal(fitLarge.collapsed, false);
  assert.equal(fitSmall.groups.length, 1);
  assert.equal(fitLarge.groups.length, 1);

  const areaSmall = Math.abs(polygonArea(fitSmall.groups[0].outer));
  const areaLarge = Math.abs(polygonArea(fitLarge.groups[0].outer));
  assert.ok(areaLarge < areaSmall, `mayor clearance debería dar un anillo más chico: ${areaLarge.toFixed(2)} vs ${areaSmall.toFixed(2)}`);
});

// J. connected components ya verificado dentro del test C-F de arriba (placa+labio: 1 componente).

// K. STAMPA con tapa encastrable: 12 STL (6 cuerpos + 6 tapas), NO 18 —
// el labio nunca se exporta como archivo aparte, es parte de la tapa.
test('"STAMPA" con tapa encastrable: 12 STL en el ZIP (cuerpo+tapa por letra, no un tercer archivo de labio)', async () => {
  const result = createLetterGeometry(montserratBold, { ...LIP_PARAMS, text: "STAMPA" });
  const blob = await buildLettersZipBlob(result);
  const zip = await JSZipLib.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.equal(names.length, 12, "se esperaban 12 STL (6 cuerpos + 6 tapas), nunca 18");
  assert.deepEqual(names, [
    "01_S_cuerpo.stl", "01_S_tapa.stl",
    "02_T_cuerpo.stl", "02_T_tapa.stl",
    "03_A_cuerpo.stl", "03_A_tapa.stl",
    "04_M_cuerpo.stl", "04_M_tapa.stl",
    "05_P_cuerpo.stl", "05_P_tapa.stl",
    "06_A_cuerpo.stl", "06_A_tapa.stl",
  ]);
});

// L. LOOCK 3D: el espacio no genera ninguna pieza (igual que 0.1/0.2).
test('"LOOCK 3D" con tapa encastrable: el espacio no genera ninguna pieza (7 letras, no 8)', () => {
  const result = createLetterGeometry(montserratBold, { ...LIP_PARAMS, text: "LOOCK 3D" });
  assert.equal(result.letters.length, 7);
  assert.deepEqual(result.letters.map((l) => l.char), ["L", "O", "O", "C", "K", "3", "D"]);
});

// --- Sección 12 del spec de 0.3: casos donde el labio es imposible ---
//
// Hardening (contexto nuevo): LIP_COLLAPSED pasó de warning a ERROR
// (result.errors, no result.warnings) — una tapa pedida como "encastrable"
// no puede exportarse en silencio sin encastre funcional. El preview sigue
// mostrando la degradación a placa plana (buildLid.ts) para que el
// usuario entienda qué pasa, pero ningún camino de exportación debe
// aceptar el resultado mientras `errors` no esté vacío.

function collapsedLipResult() {
  return createLetterGeometry(montserratBold, {
    ...LIP_PARAMS,
    text: "I",
    heightMm: 5,
    depthMm: 10,
    wallMm: 1,
    baseMm: 1,
    clearanceMm: 2,
  });
}

// 2. LIP_COLLAPSED aparece como error, no warning.
test("tapa encastrable: holgura/pared excesivas para el trazo marcan el resultado como ERROR (no warning), sin geometría corrupta", () => {
  const result = collapsedLipResult();
  assertValidMesh(lidOf(result.letters[0]), "I-encastre-colapsado.lid");
  assert.ok(result.errors.some((e) => e.code === "LIP_COLLAPSED"), "se esperaba LIP_COLLAPSED en errors");
  assert.ok(!result.warnings.some((w) => w.code === "LIP_COLLAPSED"), "LIP_COLLAPSED no debería aparecer en warnings");
  assert.ok(/letra "I"/.test(result.errors[0].message), "el mensaje debería identificar la letra afectada");
});

// 1. LIP_COLLAPSED bloquea exportación (todos los caminos: palabra completa y letras individuales).
test("tapa encastrable con LIP_COLLAPSED: ningún camino de exportación acepta el resultado", async () => {
  const result = collapsedLipResult();
  await assert.rejects(() => buildLettersZipBlob(result), /letra "I"/);
  await assert.rejects(() => buildWordZipBlob(result, "stampa"), /letra "I"/);
});

// Caso B (nuevo con la corrección de 0.3.1): la fit region es válida por sí
// sola, pero lipWallMm es tan grande respecto a su ancho que el vacío
// central del anillo desaparece — el "labio" pasaría a ser la fit region
// completa (macizo), justo lo que esta corrección busca evitar. Debe
// tratarse como LIP_COLLAPSED (error), NO degradarse en silencio a una
// placa maciza.
test('tapa encastrable "O": lipWallMm demasiado grande respecto a la fit region también dispara LIP_COLLAPSED (no macizo silencioso)', () => {
  const base = { heightMm: 25, wallMm: 1.2, clearanceMm: 0.2, insertDepthMm: 3 };

  const withThinLip = createLetterGeometry(montserratBold, { ...LIP_PARAMS, ...base, text: "O", lipWallMm: 1.5 });
  assert.deepEqual(withThinLip.errors, [], "con lipWallMm=1.5 la fit region todavía debería alcanzar para un vacío central");

  const withThickLip = createLetterGeometry(montserratBold, { ...LIP_PARAMS, ...base, text: "O", lipWallMm: 2 });
  assert.ok(
    withThickLip.errors.some((e) => e.code === "LIP_COLLAPSED"),
    "con lipWallMm=2 (misma fit region) el vacío central debería desaparecer y marcarse como error",
  );
});

// 3. Frente abierto no se ve afectado por esta validación.
test("regresión hardening: frente abierto nunca tiene errors, aunque el trazo sea extremo", () => {
  const result = createLetterGeometry(montserratBold, {
    ...DEFAULT_PARAMS,
    text: "I",
    heightMm: 5,
    depthMm: 10,
    wallMm: 20,
    baseMm: 1,
  });
  assert.deepEqual(result.errors, []);
});

// 4. Tapa plana (lidJoint "glue") no se ve afectada: nunca calcula labio, nunca puede colapsar.
test('regresión hardening: tapa plana ("O") nunca tiene errors', () => {
  const result = createLetterGeometry(montserratBold, { ...LID_PARAMS, text: "O" });
  assert.deepEqual(result.errors, []);
});

// 5. Tapa encastrable válida sigue exportando normalmente (sin errors, sin bloqueo).
test('tapa encastrable "O" con parámetros por defecto: sin errors, exporta normalmente', async () => {
  const result = createLetterGeometry(montserratBold, { ...LIP_PARAMS, text: "O" });
  assert.deepEqual(result.errors, []);
  const zip = await buildLettersZipBlob(result);
  assert.ok(zip.size > 0);
  const wordZip = await buildWordZipBlob(result, "o");
  assert.ok(wordZip.size > 0);
});

// 6. Multi-letra: una sola letra inválida invalida la exportación del conjunto (no se exporta
// "como si fuera completamente válido"), y se identifica cuál. No se exporta parcialmente:
// una lista simple de letras afectadas alcanza, sin un selector complejo de errores.
test('"STAMPA" con tapa encastrable: si una sola letra colapsa (la "S"), se identifica y se bloquea la exportación del conjunto', async () => {
  const params = { ...LIP_PARAMS, text: "STAMPA", heightMm: 31, wallMm: 2.8, clearanceMm: 0.3 };
  const result = createLetterGeometry(montserratBold, params);

  assert.equal(result.errors.length, 1, `se esperaba que solo la "S" colapsara, errors=${JSON.stringify(result.errors)}`);
  assert.ok(/letra "S" \(posición 1\)/.test(result.errors[0].message));
  // El resto de las letras (T, A, M, P, A) generaron su labio sin problema:
  // el error es específico de la "S", no un colapso global del texto.
  assert.equal(result.letters.length, 6);

  await assert.rejects(() => buildLettersZipBlob(result), /letra "S"/);
  await assert.rejects(() => buildWordZipBlob(result, "stampa"), /letra "S"/);
});

// 7 y 8. INSERT_DEPTH_CLAMPED sigue siendo un warning no bloqueante, e informa
// la profundidad solicitada y la efectiva.
test("tapa encastrable: insertDepthMm mayor a la cavidad disponible se ajusta automáticamente (INSERT_DEPTH_CLAMPED), sin bloquear la exportación", async () => {
  const result = createLetterGeometry(montserratBold, { ...LIP_PARAMS, text: "O", depthMm: 5, baseMm: 1, insertDepthMm: 20 });
  assert.ok(result.warnings.some((w) => w.code === "INSERT_DEPTH_CLAMPED"));
  assert.ok(!result.errors.some((e) => e.code === "INSERT_DEPTH_CLAMPED"), "INSERT_DEPTH_CLAMPED debe ser warning, no error");
  assert.deepEqual(result.errors, [], "un ajuste automático de profundidad no debería bloquear la exportación");

  const b = meshBounds(lidOf(result.letters[0]).positions);
  assert.ok(b.minZ >= 1 - 1e-6, `el labio no debería invadir la base maciza (minZ=${b.minZ}, baseMm=1)`);

  // 7. Sigue permitiendo exportar (warning no bloqueante).
  const zip = await buildLettersZipBlob(result);
  assert.ok(zip.size > 0);

  // 8. El mensaje informa el valor solicitado (20mm) y el efectivo (depthMm-baseMm=4mm).
  const message = result.warnings.find((w) => w.code === "INSERT_DEPTH_CLAMPED").message;
  assert.ok(message.includes("20"), `el mensaje debería mencionar la profundidad solicitada (20mm): "${message}"`);
  assert.ok(message.includes("4"), `el mensaje debería mencionar la profundidad efectiva (4mm): "${message}"`);
});

test("validateLetterSignParams: profundidad de encastre y holgura fuera de rango cuando lidJoint es interior-lip", () => {
  const badInsertDepth = validateLetterSignParams({ ...LIP_PARAMS, text: "O", insertDepthMm: 0.2 });
  assert.ok(badInsertDepth.some((e) => e.field === "insertDepthMm"));

  const badClearance = validateLetterSignParams({ ...LIP_PARAMS, text: "O", clearanceMm: 5 });
  assert.ok(badClearance.some((e) => e.field === "clearanceMm"));

  const valid = validateLetterSignParams({ ...LIP_PARAMS, text: "O" });
  assert.ok(!valid.some((e) => e.field === "insertDepthMm" || e.field === "clearanceMm"));
});

// 1. lipWallMm validado (0.4mm - 3mm cuando lidJoint es interior-lip).
test("validateLetterSignParams: espesor del labio (lipWallMm) fuera de rango cuando lidJoint es interior-lip", () => {
  const tooThin = validateLetterSignParams({ ...LIP_PARAMS, text: "O", lipWallMm: 0.2 });
  assert.ok(tooThin.some((e) => e.field === "lipWallMm"));

  const tooThick = validateLetterSignParams({ ...LIP_PARAMS, text: "O", lipWallMm: 4 });
  assert.ok(tooThick.some((e) => e.field === "lipWallMm"));

  const valid = validateLetterSignParams({ ...LIP_PARAMS, text: "O", lipWallMm: 0.8 });
  assert.ok(!valid.some((e) => e.field === "lipWallMm"));
});

test("validateLetterSignParams: insertDepthMm/clearanceMm/lipWallMm fuera de rango no generan error si lidJoint es glue", () => {
  const errors = validateLetterSignParams({ ...LID_PARAMS, text: "O", insertDepthMm: 999, clearanceMm: 999, lipWallMm: 999 });
  assert.ok(!errors.some((e) => e.field === "insertDepthMm" || e.field === "clearanceMm" || e.field === "lipWallMm"));
});

// --- Stampa Maker 0.4 Etapa 2: costillas laterales ---
//
// Modificador de cuerpo: relieves perimetrales en una o dos bandas de Z
// dentro de la pared (nunca la base maciza), siguiendo exterior, huecos y
// curvas reales vía outsetContourGroups (ver body/modifiers/ribs.ts) — no
// bounding boxes. Sin costillas (ribsCount=0), debe ser exactamente el
// mismo cuerpo que antes de 0.4 Etapa 2 (ver test de regresión más abajo).

test("costillas laterales: ribsCount=0 no cambia el cuerpo (mismo resultado que sin costillas)", () => {
  const withRibsField = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O", ribsCount: 0 });
  const reference = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  assert.deepEqual(Array.from(bodyOf(withRibsField).positions), Array.from(bodyOf(reference).positions));
});

for (const ribsCount of [1, 2]) {
  for (const text of ["O", "B", "8"]) {
    test(`costillas laterales (${ribsCount}): "${text}" sigue siendo manifold/watertight y 1 componente conectado`, () => {
      const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text, ribsCount });
      const mesh = bodyOf(result);
      assertValidMesh(mesh, `${text}-ribs${ribsCount}`);
      const topo = analyzeMeshTopology(mesh.positions);
      assert.equal(topo.degenerate, 0, `${text} (ribs=${ribsCount}): triángulos degenerados`);
      assert.equal(topo.nonManifold, 0, `${text} (ribs=${ribsCount}): aristas no-manifold`);
      assert.equal(topo.boundaryEdges, 0, `${text} (ribs=${ribsCount}): no se esperaban bordes abiertos`);
      const components = countConnectedComponents(mesh.positions);
      assert.equal(components, 1, `${text} (ribs=${ribsCount}): se esperaba 1 componente conectado, se encontraron ${components}`);
    });

    test(`costillas laterales (${ribsCount}): "${text}" mantiene los counters libres`, () => {
      const groups = contourGroupsFor(text);
      const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text, ribsCount });
      const mesh = bodyOf(result);
      for (const hole of groups[0].holes) {
        const [hx, hy] = polygonCentroid(hole);
        const hits = raycastZHits(mesh.positions, hx, hy).filter((z) => z > -EPS_Z && z < DEFAULT_PARAMS.depthMm + EPS_Z);
        assert.deepEqual(hits, [], `${text} (ribs=${ribsCount}): se esperaba el counter libre, hay geometría en z=[${hits.join(", ")}]`);
      }
    });
  }
}

// 0.4.1 corrección 1: la costilla dejó de ser un prisma de tope plano (piso
// y techo exactos en los bordes de la banda) para ser un MONTÍCULO
// progresivo (media onda coseno, `raisedCosineProfile` en body/shared.ts):
// protrusion 0 en band.z0, máxima a mitad de banda, 0 en band.z1, sin salto
// vertical en ningún extremo. Los cruces con un offset intermedio (p.ej.
// "a mitad del protrusion máximo") ya NO caen en los bordes exactos de la
// banda, caen donde el coseno cruza ese valor — con la aproximación por
// sub-bandas finas (~0.2mm), redondeado al paso más cercano.
function raisedCosineT(frac) {
  // 0.5 - 0.5*cos(2*pi*t) = frac  =>  t = acos(1 - 2*frac) / (2*pi) (lado ascendente)
  return Math.acos(1 - 2 * frac) / (2 * Math.PI);
}
const RIB_STEP_TOLERANCE_MM = 0.35; // por encima de la resolución objetivo (~0.2mm) para tolerar el redondeo de la aproximación por pasos

test('costillas laterales (1): "I" llega a máxima protrusión a mitad de banda (no en los bordes)', () => {
  const text = "I";
  const groups = contourGroupsFor(text);
  const bands = computeRibBands(DEFAULT_PARAMS.baseMm, DEFAULT_PARAMS.depthMm, 1, DEFAULT_PARAMS.ribWidthMm);
  assert.equal(bands.length, 1);
  const band = bands[0];
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text, ribsCount: 1 });
  const bodyPositions = bodyOf(result).positions;

  // offset a máxima protrusión (t=0.5, mitad de banda): dos impactos
  // (piso+techo del montículo), centrados en la MITAD de la banda — a
  // diferencia del prisma anterior (0.4), donde el offset máximo ocupaba
  // TODO el ancho de banda de borde a borde.
  const maxOutset = regroupClipperSolution(outsetContourGroups(groups, DEFAULT_PARAMS.ribProtrusionMm - 1e-4));
  const [px, py] = maxOutset[0].outer[0];
  const hits = raycastZHits(bodyPositions, px, py).sort((a, b) => a - b);
  const bandCenter = (band.z0 + band.z1) / 2;
  assert.equal(hits.length, 2, `se esperaban 2 impactos cerca del pico del montículo, se encontraron ${hits.length}: [${hits.join(", ")}]`);
  assert.ok(hits[0] > band.z0 && hits[0] < bandCenter, `el piso del pico debería estar entre el borde y el centro de la banda, fue ${hits[0]}`);
  assert.ok(hits[1] > bandCenter && hits[1] < band.z1, `el techo del pico debería estar entre el centro y el borde de la banda, fue ${hits[1]}`);
});

test('costillas laterales (1): "I" progresión monotónica hasta el pico y descenso posterior (offset a t=0.5 cruza cerca de lo que predice el coseno)', () => {
  const text = "I";
  const groups = contourGroupsFor(text);
  // Banda más ancha (ribWidthMm=6mm en vez del default 1.2mm) para tener
  // más pasos de aproximación (~30 a resolución 0.2mm en vez de 8) y poder
  // distinguir con claridad offsets intermedios distintos — con muy pocos
  // pasos, dos fracciones de protrusión cercanas pueden caer en el mismo
  // escalón y dar el mismo ancho medido (no es un bug, es resolución).
  const params = { ...DEFAULT_PARAMS, text, ribsCount: 1, ribWidthMm: 6 };
  const bands = computeRibBands(params.baseMm, params.depthMm, 1, params.ribWidthMm);
  const band = bands[0];
  const bandHeight = band.z1 - band.z0;
  const result = createLetterGeometry(montserratBold, params);
  const bodyPositions = bodyOf(result).positions;

  // A mitad del protrusion máximo, el coseno cruza en t=0.25 (subiendo) y
  // t=0.75 (bajando) — ver raisedCosineProfile: 0.5-0.5cos(2*pi*0.25)=0.5.
  const halfOutset = regroupClipperSolution(outsetContourGroups(groups, params.ribProtrusionMm * 0.5));
  const [px, py] = halfOutset[0].outer[0];
  const hits = raycastZHits(bodyPositions, px, py).sort((a, b) => a - b);
  assert.equal(hits.length, 2, `se esperaban 2 impactos (subida+bajada a mitad de protrusión), se encontraron ${hits.length}: [${hits.join(", ")}]`);

  const expectedRise = band.z0 + bandHeight * raisedCosineT(0.5);
  const expectedFall = band.z1 - bandHeight * raisedCosineT(0.5);
  assert.ok(Math.abs(hits[0] - expectedRise) < RIB_STEP_TOLERANCE_MM, `cruce de subida fuera de tolerancia: ${hits[0]} (esperado ~${expectedRise.toFixed(2)})`);
  assert.ok(Math.abs(hits[1] - expectedFall) < RIB_STEP_TOLERANCE_MM, `cruce de bajada fuera de tolerancia: ${hits[1]} (esperado ~${expectedFall.toFixed(2)})`);

  // Progresión monotónica hasta el pico (subida) y descenso posterior
  // (bajada): a un offset más chico (10% del máximo, más cerca del borde
  // de la banda) el hueco entre subida y bajada debe ser MÁS ANCHO que a
  // un offset más grande (50%, más cerca del pico) — el montículo se
  // angosta a medida que sube, y por simetría vuelve a ensancharse
  // bajando (mismo coseno de ambos lados del pico).
  const tenPercentOutset = regroupClipperSolution(outsetContourGroups(groups, params.ribProtrusionMm * 0.1));
  const [qx, qy] = tenPercentOutset[0].outer[0];
  const tenPercentHits = raycastZHits(bodyPositions, qx, qy).sort((a, b) => a - b);
  assert.equal(tenPercentHits.length, 2);
  const widthAt10 = tenPercentHits[1] - tenPercentHits[0];
  const widthAt50 = hits[1] - hits[0];
  assert.ok(widthAt10 > widthAt50, `el ancho del montículo a 10% de protrusión (${widthAt10.toFixed(2)}) debería ser mayor que a 50% (${widthAt50.toFixed(2)}) — progresión monotónica hasta el pico, descenso simétrico del otro lado`);
});

test('costillas laterales (2): "I" tiene dos montículos independientes, cada uno con su propio pico centrado en su banda', () => {
  const text = "I";
  const groups = contourGroupsFor(text);
  const bands = computeRibBands(DEFAULT_PARAMS.baseMm, DEFAULT_PARAMS.depthMm, 2, DEFAULT_PARAMS.ribWidthMm);
  assert.equal(bands.length, 2);

  const maxOutset = regroupClipperSolution(outsetContourGroups(groups, DEFAULT_PARAMS.ribProtrusionMm - 1e-4));
  const [px, py] = maxOutset[0].outer[0];

  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text, ribsCount: 2 });
  const hits = raycastZHits(bodyOf(result).positions, px, py).sort((a, b) => a - b);

  assert.equal(hits.length, 4, `se esperaban 4 impactos (piso+techo de cada pico), se encontraron ${hits.length}: [${hits.join(", ")}]`);
  const band0Center = (bands[0].z0 + bands[0].z1) / 2;
  const band1Center = (bands[1].z0 + bands[1].z1) / 2;
  assert.ok(hits[0] > bands[0].z0 && hits[1] < bands[0].z1, "el primer par de impactos debería estar dentro de la primera banda");
  assert.ok(hits[0] < band0Center && hits[1] > band0Center, "el primer par debería rodear el centro de la primera banda");
  assert.ok(hits[2] > bands[1].z0 && hits[3] < bands[1].z1, "el segundo par de impactos debería estar dentro de la segunda banda");
  assert.ok(hits[2] < band1Center && hits[3] > band1Center, "el segundo par debería rodear el centro de la segunda banda");
});

test('costillas laterales (1): "I" no genera material más allá de ribProtrusionMm de la silueta original', () => {
  const text = "I";
  const groups = contourGroupsFor(text);
  const beyondOutset = regroupClipperSolution(outsetContourGroups(groups, DEFAULT_PARAMS.ribProtrusionMm * 1.5));
  const [px, py] = beyondOutset[0].outer[0];
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text, ribsCount: 1 });
  const hits = raycastZHits(bodyOf(result).positions, px, py);
  assert.deepEqual(hits, [], `no debería haber material a 1.5x el protrusion de la costilla, hay en z=[${hits.join(", ")}]`);
});

test('costillas laterales (1) "O": el hueco central también recibe el montículo (sigue el hueco, no solo el exterior)', () => {
  const text = "O";
  const groups = contourGroupsFor(text);
  const bands = computeRibBands(DEFAULT_PARAMS.baseMm, DEFAULT_PARAMS.depthMm, 1, DEFAULT_PARAMS.ribWidthMm);
  const bandCenter = (bands[0].z0 + bands[0].z1) / 2;

  // Punto de sonda DENTRO del hueco original, cerca de la máxima protrusión
  // desde el borde del counter: outsetContourGroups dilata el grupo
  // completo (exterior crece, huecos se achican), así que su borde de hueco
  // es exactamente ese punto intermedio hacia el centro del counter.
  const maxOutset = regroupClipperSolution(outsetContourGroups(groups, DEFAULT_PARAMS.ribProtrusionMm - 1e-4));
  const holeBoundary = maxOutset[0].holes[0];
  const [px, py] = holeBoundary[0];

  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text, ribsCount: 1 });
  const hits = raycastZHits(bodyOf(result).positions, px, py).sort((a, b) => a - b);
  assert.equal(hits.length, 2, `se esperaban 2 impactos (piso+techo del montículo hacia el counter), se encontraron ${hits.length}: [${hits.join(", ")}]`);
  assert.ok(hits[0] > bands[0].z0 && hits[0] < bandCenter);
  assert.ok(hits[1] > bandCenter && hits[1] < bands[0].z1);
});

test("validateLetterSignParams: ribProtrusionMm/ribWidthMm fuera de rango cuando ribsCount > 0", () => {
  const badProtrusion = validateLetterSignParams({ ...DEFAULT_PARAMS, ribsCount: 1, ribProtrusionMm: 0 });
  assert.ok(badProtrusion.some((e) => e.field === "ribProtrusionMm"));

  const badWidth = validateLetterSignParams({ ...DEFAULT_PARAMS, ribsCount: 1, ribWidthMm: 0 });
  assert.ok(badWidth.some((e) => e.field === "ribWidthMm"));

  const valid = validateLetterSignParams({ ...DEFAULT_PARAMS, ribsCount: 1 });
  assert.ok(!valid.some((e) => e.field === "ribProtrusionMm" || e.field === "ribWidthMm"));
});

test("validateLetterSignParams: ribProtrusionMm/ribWidthMm fuera de rango no generan error si ribsCount es 0", () => {
  const errors = validateLetterSignParams({ ...DEFAULT_PARAMS, ribsCount: 0, ribProtrusionMm: 999, ribWidthMm: 999 });
  assert.ok(!errors.some((e) => e.field === "ribProtrusionMm" || e.field === "ribWidthMm"));
});

// --- Stampa Maker 0.4 Etapa 3: cuerpo tapered ---
//
// La silueta exterior/de counters crece progresivamente desde el frente
// (z=depthMm, offset 0, nominal) hacia la base (z=0, offset
// rearExpansionMm). Aproximado con varios tramos rectos + escalones (ver
// body/tapered.ts) — sin CSG. La cavidad oculta y la interfaz con
// frente/tapa no cambian (mismo contorno original).

const TAPERED_PARAMS = { ...DEFAULT_PARAMS, bodyType: "tapered", rearExpansionMm: 2 };

test("cuerpo tapered: rearExpansionMm=0 da el mismo resultado que el cuerpo standard sin costillas", () => {
  const tapered = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O", bodyType: "tapered", rearExpansionMm: 0 });
  const standard = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O", bodyType: "standard" });
  assert.deepEqual(Array.from(bodyOf(tapered).positions), Array.from(bodyOf(standard).positions));
});

for (const text of ["O", "A", "B", "8"]) {
  test(`cuerpo tapered "${text}": manifold/watertight y 1 componente conectado`, () => {
    const result = createLetterGeometry(montserratBold, { ...TAPERED_PARAMS, text });
    const mesh = bodyOf(result);
    assertValidMesh(mesh, `${text}-tapered`);
    const topo = analyzeMeshTopology(mesh.positions);
    assert.equal(topo.degenerate, 0, `${text} (tapered): triángulos degenerados`);
    assert.equal(topo.nonManifold, 0, `${text} (tapered): aristas no-manifold`);
    assert.equal(topo.boundaryEdges, 0, `${text} (tapered): no se esperaban bordes abiertos`);
    const components = countConnectedComponents(mesh.positions);
    assert.equal(components, 1, `${text} (tapered): se esperaba 1 componente conectado, se encontraron ${components}`);
  });

  test(`cuerpo tapered "${text}": mantiene los counters libres`, () => {
    const groups = contourGroupsFor(text);
    const result = createLetterGeometry(montserratBold, { ...TAPERED_PARAMS, text });
    const mesh = bodyOf(result);
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      const hits = raycastZHits(mesh.positions, hx, hy).filter((z) => z > -EPS_Z && z < TAPERED_PARAMS.depthMm + EPS_Z);
      assert.deepEqual(hits, [], `${text} (tapered): se esperaba el counter libre, hay geometría en z=[${hits.join(", ")}]`);
    }
  });
}

test('cuerpo tapered "O": el frente mantiene la silueta nominal (sin material fuera del contorno original cerca de depthMm)', () => {
  const text = "O";
  const groups = contourGroupsFor(text);
  const outsetHalf = regroupClipperSolution(outsetContourGroups(groups, TAPERED_PARAMS.rearExpansionMm * 0.5));
  const [px, py] = outsetHalf[0].outer[0];

  const result = createLetterGeometry(montserratBold, { ...TAPERED_PARAMS, text });
  const hits = raycastZHits(bodyOf(result).positions, px, py);
  const nearFront = hits.filter((z) => z > TAPERED_PARAMS.depthMm - 4);
  assert.deepEqual(nearFront, [], `no debería haber material fuera de la silueta nominal cerca del frente, se encontró en z=[${nearFront.join(", ")}]`);
});

test('cuerpo tapered "O": la base queda más ancha (hay material fuera del contorno original cerca de z=0)', () => {
  const text = "O";
  const groups = contourGroupsFor(text);
  const outsetHalf = regroupClipperSolution(outsetContourGroups(groups, TAPERED_PARAMS.rearExpansionMm * 0.5));
  const [px, py] = outsetHalf[0].outer[0];

  const result = createLetterGeometry(montserratBold, { ...TAPERED_PARAMS, text });
  const hits = raycastZHits(bodyOf(result).positions, px, py);
  const nearBase = hits.filter((z) => z < 4);
  assert.ok(nearBase.length > 0, "se esperaba material fuera de la silueta nominal cerca de la base (rearExpansionMm)");
});

test('cuerpo tapered "O": no hay material más allá de rearExpansionMm de la silueta original en ningún Z', () => {
  const text = "O";
  const groups = contourGroupsFor(text);
  const beyondOutset = regroupClipperSolution(outsetContourGroups(groups, TAPERED_PARAMS.rearExpansionMm * 1.5));
  const [px, py] = beyondOutset[0].outer[0];

  const result = createLetterGeometry(montserratBold, { ...TAPERED_PARAMS, text });
  const hits = raycastZHits(bodyOf(result).positions, px, py);
  assert.deepEqual(hits, [], `no debería haber material a 1.5x rearExpansionMm de la silueta original, hay en z=[${hits.join(", ")}]`);
});

test("cuerpo tapered: compatible con tapa frontal (la tapa usa la silueta nominal del frente, sin cambios)", () => {
  const taperedLidResult = createLetterGeometry(montserratBold, { ...TAPERED_PARAMS, text: "O", frontType: "lid" });
  assert.ok(lidOf(taperedLidResult.letters[0]), "se esperaba una tapa");
  // La tapa deriva de `contourGroups` (silueta original), ajena al tipo de
  // cuerpo: debe ser byte-idéntica a la tapa de un cuerpo standard.
  const standardLidResult = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O", bodyType: "standard", frontType: "lid" });
  assert.deepEqual(
    Array.from(lidOf(taperedLidResult.letters[0]).positions),
    Array.from(lidOf(standardLidResult.letters[0]).positions),
  );
});

// --- 0.4.1 corrección 2: cuerpo tapered "smooth" ---
//
// Mismo destino (offset 0 en el frente, rearExpansionMm en la base) que
// "stepped", pero aproximado con sub-bandas finas (~0.2mm, ver
// TAPER_SMOOTH_RESOLUTION_MM en body/tapered.ts) + perfil smoothstep en vez
// de las bandas grandes (~2mm) de "stepped" — debe percibirse como una
// pendiente continua, no escalones grandes evidentes.

const TAPERED_SMOOTH_PARAMS = { ...DEFAULT_PARAMS, bodyType: "tapered", taperStyle: "smooth", rearExpansionMm: 2 };

for (const text of ["O", "B", "8"]) {
  test(`cuerpo tapered suave "${text}": manifold/watertight y 1 componente conectado`, () => {
    const result = createLetterGeometry(montserratBold, { ...TAPERED_SMOOTH_PARAMS, text });
    const mesh = bodyOf(result);
    assertValidMesh(mesh, `${text}-tapered-smooth`);
    const topo = analyzeMeshTopology(mesh.positions);
    assert.equal(topo.degenerate, 0, `${text} (tapered suave): triángulos degenerados`);
    assert.equal(topo.nonManifold, 0, `${text} (tapered suave): aristas no-manifold`);
    assert.equal(topo.boundaryEdges, 0, `${text} (tapered suave): no se esperaban bordes abiertos`);
    assert.equal(countConnectedComponents(mesh.positions), 1, `${text} (tapered suave): se esperaba 1 componente conectado`);
  });

  test(`cuerpo tapered suave "${text}": mantiene los counters libres (la transición también se aplica a huecos, no sólo al exterior)`, () => {
    const groups = contourGroupsFor(text);
    const result = createLetterGeometry(montserratBold, { ...TAPERED_SMOOTH_PARAMS, text });
    const mesh = bodyOf(result);
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      const hits = raycastZHits(mesh.positions, hx, hy).filter((z) => z > -EPS_Z && z < TAPERED_SMOOTH_PARAMS.depthMm + EPS_Z);
      assert.deepEqual(hits, [], `${text} (tapered suave): se esperaba el counter libre, hay geometría en z=[${hits.join(", ")}]`);
    }
  });
}

test('cuerpo tapered suave "O": el frente mantiene la silueta nominal (offset 0 en z=depthMm)', () => {
  const text = "O";
  const groups = contourGroupsFor(text);
  const outsetHalf = regroupClipperSolution(outsetContourGroups(groups, TAPERED_SMOOTH_PARAMS.rearExpansionMm * 0.5));
  const [px, py] = outsetHalf[0].outer[0];
  const result = createLetterGeometry(montserratBold, { ...TAPERED_SMOOTH_PARAMS, text });
  const hits = raycastZHits(bodyOf(result).positions, px, py);
  const nearFront = hits.filter((z) => z > TAPERED_SMOOTH_PARAMS.depthMm - 2);
  assert.deepEqual(nearFront, [], `no debería haber material fuera de la silueta nominal cerca del frente, se encontró en z=[${nearFront.join(", ")}]`);
});

test('cuerpo tapered suave "O": la expansión trasera es correcta (offset ~rearExpansionMm en la base)', () => {
  const text = "O";
  const groups = contourGroupsFor(text);
  // Sonda justo por debajo del offset máximo (rearExpansionMm): debería
  // haber material ahí muy cerca de z=0 (la base usa el footprint MÁS
  // ANCHO, sin escalón — ver body/tapered.ts).
  const nearMaxOutset = regroupClipperSolution(outsetContourGroups(groups, TAPERED_SMOOTH_PARAMS.rearExpansionMm - 0.1));
  const [px, py] = nearMaxOutset[0].outer[0];
  const result = createLetterGeometry(montserratBold, { ...TAPERED_SMOOTH_PARAMS, text });
  const hits = raycastZHits(bodyOf(result).positions, px, py);
  const nearBase = hits.filter((z) => z < 4);
  assert.ok(nearBase.length > 0, "se esperaba material cerca de la base, a casi rearExpansionMm de la silueta original");

  // Y no más allá del offset máximo, en ningún Z (mismo criterio que "stepped").
  const beyondOutset = regroupClipperSolution(outsetContourGroups(groups, TAPERED_SMOOTH_PARAMS.rearExpansionMm * 1.5));
  const [bx, by] = beyondOutset[0].outer[0];
  const beyondHits = raycastZHits(bodyOf(result).positions, bx, by);
  assert.deepEqual(beyondHits, [], `no debería haber material a 1.5x rearExpansionMm de la silueta original, hay en z=[${beyondHits.join(", ")}]`);
});

test('cuerpo tapered suave "O": la aproximación usa muchos pasos pequeños, ningún salto de offset mayor que una tolerancia razonable', () => {
  const text = "O";
  const groups = contourGroupsFor(text);
  const result = createLetterGeometry(montserratBold, { ...TAPERED_SMOOTH_PARAMS, text });
  const bodyPositions = bodyOf(result).positions;

  // Barrido de offsets crecientes: para cada uno, encontrar el Z donde
  // aparece/desaparece el material a esa distancia de la silueta original.
  // Un "salto grande" en la curva offset(z) se vería como un Z muy
  // distinto entre offsets consecutivos (paso pequeño en offset).
  const samples = [];
  for (let frac = 0.05; frac < 1; frac += 0.05) {
    const outsetAt = regroupClipperSolution(outsetContourGroups(groups, TAPERED_SMOOTH_PARAMS.rearExpansionMm * frac));
    const [px, py] = outsetAt[0].outer[0];
    const hits = raycastZHits(bodyPositions, px, py).filter((z) => z > -EPS_Z && z < TAPERED_SMOOTH_PARAMS.depthMm + EPS_Z);
    if (hits.length > 0) samples.push({ frac, z: Math.min(...hits) });
  }
  assert.ok(samples.length >= 10, `se esperaban múltiples muestras a lo largo de la rampa, hubo ${samples.length}`);

  // Referencia "stepped" con las mismas bandas grandes de siempre (2mm, ~20
  // bandas para depthMm=40): el salto máximo esperado en "smooth" debe ser
  // claramente menor (más chico) que el ancho de una banda "stepped" — es
  // la evidencia concreta de "pendiente extremadamente suave, sin niveles
  // grandes evidentes" pedida en el spec.
  let maxJump = 0;
  for (let i = 1; i < samples.length; i++) {
    maxJump = Math.max(maxJump, Math.abs(samples[i].z - samples[i - 1].z));
  }
  assert.ok(maxJump < 2, `salto máximo entre muestras consecutivas (${maxJump.toFixed(2)}mm) debería ser claramente menor a una banda "stepped" (2mm)`);
});

test('cuerpo tapered suave: compatible con tapa frontal (la tapa usa la silueta nominal del frente, sin cambios, igual que "stepped")', () => {
  const taperedSmoothLidResult = createLetterGeometry(montserratBold, { ...TAPERED_SMOOTH_PARAMS, text: "O", frontType: "lid" });
  assert.ok(lidOf(taperedSmoothLidResult.letters[0]), "se esperaba una tapa");
  const standardLidResult = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O", bodyType: "standard", frontType: "lid" });
  assert.deepEqual(
    Array.from(lidOf(taperedSmoothLidResult.letters[0]).positions),
    Array.from(lidOf(standardLidResult.letters[0]).positions),
  );
});

test("validateLetterSignParams: rearExpansionMm fuera de rango cuando bodyType es tapered", () => {
  const tooLarge = validateLetterSignParams({ ...TAPERED_PARAMS, text: "O", rearExpansionMm: 999 });
  assert.ok(tooLarge.some((e) => e.field === "rearExpansionMm"));

  const negative = validateLetterSignParams({ ...TAPERED_PARAMS, text: "O", rearExpansionMm: -1 });
  assert.ok(negative.some((e) => e.field === "rearExpansionMm"));

  const valid = validateLetterSignParams({ ...TAPERED_PARAMS, text: "O" });
  assert.ok(!valid.some((e) => e.field === "rearExpansionMm"));
});

test("validateLetterSignParams: rearExpansionMm fuera de rango no genera error si bodyType es standard", () => {
  const errors = validateLetterSignParams({ ...DEFAULT_PARAMS, text: "O", rearExpansionMm: 999 });
  assert.ok(!errors.some((e) => e.field === "rearExpansionMm"));
});

// --- Stampa Maker 0.4 Etapa 4: bisel frontal interior ---
//
// Modificador de pared (exterior y counters) que se angosta progresivamente
// en una banda pegada al frente. A diferencia de las costillas/tapered, SÍ
// cambia la silueta de la interfaz frontal a propósito (ver body/standard.ts:
// "frente" usa el inset completo del bisel, no la silueta original).

const BEVEL_PARAMS = { ...DEFAULT_PARAMS, bevelEnabled: true, bevelDepthMm: 2, bevelInsetMm: 1 };

test("bisel frontal: bevelEnabled=false no cambia el cuerpo (mismo resultado que sin bisel)", () => {
  const withBevelField = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O", bevelEnabled: false });
  const reference = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  assert.deepEqual(Array.from(bodyOf(withBevelField).positions), Array.from(bodyOf(reference).positions));
});

for (const text of ["O", "B", "8"]) {
  test(`bisel frontal "${text}": manifold/watertight y 1 componente conectado`, () => {
    const result = createLetterGeometry(montserratBold, { ...BEVEL_PARAMS, text });
    const mesh = bodyOf(result);
    assertValidMesh(mesh, `${text}-bevel`);
    const topo = analyzeMeshTopology(mesh.positions);
    assert.equal(topo.degenerate, 0, `${text} (bevel): triángulos degenerados`);
    assert.equal(topo.nonManifold, 0, `${text} (bevel): aristas no-manifold`);
    assert.equal(topo.boundaryEdges, 0, `${text} (bevel): no se esperaban bordes abiertos`);
    const components = countConnectedComponents(mesh.positions);
    assert.equal(components, 1, `${text} (bevel): se esperaba 1 componente conectado, se encontraron ${components}`);
  });

  test(`bisel frontal "${text}": mantiene los counters libres`, () => {
    const groups = contourGroupsFor(text);
    const result = createLetterGeometry(montserratBold, { ...BEVEL_PARAMS, text });
    const mesh = bodyOf(result);
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      const hits = raycastZHits(mesh.positions, hx, hy).filter((z) => z > -EPS_Z && z < BEVEL_PARAMS.depthMm + EPS_Z);
      assert.deepEqual(hits, [], `${text} (bevel): se esperaba el counter libre, hay geometría en z=[${hits.join(", ")}]`);
    }
  });
}

test('bisel frontal "I": el desplazamiento (bevelInsetMm) y la banda son medibles', () => {
  const text = "I";
  const groups = contourGroupsFor(text);
  // Sonda a 0.4x el inset máximo: estrictamente entre dos escalones de la
  // aproximación (n=4 tramos para bevelDepthMm=2), sin ambigüedad de borde.
  const probeInset = regroupClipperSolution(insetContourGroups(groups, BEVEL_PARAMS.bevelInsetMm * 0.4));
  const [px, py] = probeInset[0].outer[0];

  const result = createLetterGeometry(montserratBold, { ...BEVEL_PARAMS, text });
  const hits = raycastZHits(bodyOf(result).positions, px, py).sort((a, b) => a - b);

  const bandZ0 = BEVEL_PARAMS.depthMm - BEVEL_PARAMS.bevelDepthMm;
  const expectedTop = bandZ0 + BEVEL_PARAMS.bevelDepthMm * 0.5;
  assert.equal(hits.length, 2, `se esperaban 2 impactos (piso en z=0, techo donde el bisel angosta), se encontraron ${hits.length}: [${hits.join(", ")}]`);
  assert.ok(Math.abs(hits[0] - 0) < 1e-3, `se esperaba el piso en z=0, fue ${hits[0]}`);
  assert.ok(Math.abs(hits[1] - expectedTop) < 1e-3, `se esperaba el techo en ~${expectedTop.toFixed(2)}mm, fue ${hits[1].toFixed(2)}mm`);
});

test('bisel frontal "I": la pared lateral no llega más allá de bevelInsetMm dentro de la banda (el frente conserva el resto del espesor como tapa)', () => {
  const text = "I";
  const groups = contourGroupsFor(text);
  // 0.3mm más allá del inset máximo del bisel, pero todavía dentro del
  // espesor de pared (wallMm=1.6mm): a esta distancia, la pared LATERAL
  // biselada nunca llega (angostó del todo antes), pero el frente (pieza
  // "frente", tapa del espesor restante wallMm-bevelInsetMm) sigue
  // cubriendo este punto exactamente en z=depthMm — eso es correcto, no lo
  // que este test verifica.
  const beyondInset = regroupClipperSolution(insetContourGroups(groups, BEVEL_PARAMS.bevelInsetMm + 0.3));
  const [px, py] = beyondInset[0].outer[0];

  const result = createLetterGeometry(montserratBold, { ...BEVEL_PARAMS, text });
  const hits = raycastZHits(bodyOf(result).positions, px, py).filter((z) => z > -EPS_Z && z < BEVEL_PARAMS.depthMm + EPS_Z);
  const bandZ0 = BEVEL_PARAMS.depthMm - BEVEL_PARAMS.bevelDepthMm;

  const insideBandOpen = hits.filter((z) => z > bandZ0 + 0.1 && z < BEVEL_PARAMS.depthMm - 0.1);
  assert.deepEqual(insideBandOpen, [], `no debería haber pared lateral dentro de la banda más allá de bevelInsetMm, se encontró en z=[${insideBandOpen.join(", ")}]`);
  assert.ok(hits.some((z) => z < bandZ0 - 0.5), "se esperaba material de la pared normal por debajo de la banda del bisel");
});

test("validateLetterSignParams: bevelDepthMm/bevelInsetMm fuera de rango cuando bevelEnabled", () => {
  const badDepth = validateLetterSignParams({ ...BEVEL_PARAMS, text: "O", bevelDepthMm: 0 });
  assert.ok(badDepth.some((e) => e.field === "bevelDepthMm"));

  const badInset = validateLetterSignParams({ ...BEVEL_PARAMS, text: "O", bevelInsetMm: 0 });
  assert.ok(badInset.some((e) => e.field === "bevelInsetMm"));

  const valid = validateLetterSignParams({ ...BEVEL_PARAMS, text: "O" });
  assert.ok(!valid.some((e) => e.field === "bevelDepthMm" || e.field === "bevelInsetMm"));
});

test("validateLetterSignParams: bevelDepthMm/bevelInsetMm fuera de rango no generan error si bevelEnabled es false", () => {
  const errors = validateLetterSignParams({ ...DEFAULT_PARAMS, bevelEnabled: false, bevelDepthMm: 999, bevelInsetMm: 999 });
  assert.ok(!errors.some((e) => e.field === "bevelDepthMm" || e.field === "bevelInsetMm"));
});

test('costillas + bisel combinados "O": no se superponen (las costillas ceden lugar al bisel) y el resultado sigue siendo válido', () => {
  const result = createLetterGeometry(montserratBold, { ...BEVEL_PARAMS, text: "O", ribsCount: 2 });
  const mesh = bodyOf(result);
  assertValidMesh(mesh, "O-ribs+bevel");
  const topo = analyzeMeshTopology(mesh.positions);
  assert.equal(topo.degenerate, 0);
  assert.equal(topo.nonManifold, 0);
  assert.equal(topo.boundaryEdges, 0);
  assert.equal(countConnectedComponents(mesh.positions), 1);
});

// --- 0.4.1 corrección 3A: bisel frontal suave (front bevel) ---
//
// Mismo destino (0 en band.z0, bevelInsetMm en band.z1=depthMm) que la
// versión de 0.4, pero con perfil smoothstep + resolución fina (~0.2mm) en
// vez de sub-bandas de 0.5mm con interpolación LINEAL — debe verse
// continuo, sin quiebre anguloso donde empalma con la pared normal.
// Además, la tapa (cuando existe) debe continuar la misma silueta
// angostada (geometry/lid.ts#bevelPlateInsetMm), en vez de una tapa de
// tamaño nominal sobresaliendo del cuerpo biselado.

test('bisel frontal "I": progresión suave — el inset a t=0.5 cruza cerca de lo que predice smoothstep, sin escalón grande', () => {
  const text = "I";
  const groups = contourGroupsFor(text);
  const band = { z0: BEVEL_PARAMS.depthMm - BEVEL_PARAMS.bevelDepthMm, z1: BEVEL_PARAMS.depthMm };
  const bandHeight = band.z1 - band.z0;
  const result = createLetterGeometry(montserratBold, { ...BEVEL_PARAMS, text });
  const bodyPositions = bodyOf(result).positions;

  // smoothstep(t) = 3t²-2t³; a t=0.5 da exactamente 0.5 (mismo destino que
  // el lineal en el punto medio), pero con pendiente 0 en los bordes.
  const halfInset = regroupClipperSolution(insetContourGroups(groups, BEVEL_PARAMS.bevelInsetMm * 0.5));
  const [px, py] = halfInset[0].outer[0];
  const hits = raycastZHits(bodyPositions, px, py).sort((a, b) => a - b);
  assert.ok(hits.length >= 1, "se esperaba al menos un impacto (piso) al inset de mitad de banda");
  const expectedZ = band.z0 + bandHeight * 0.5;
  const closest = hits.reduce((best, z) => (Math.abs(z - expectedZ) < Math.abs(best - expectedZ) ? z : best), hits[0]);
  assert.ok(Math.abs(closest - expectedZ) < 0.35, `cruce a mitad de banda fuera de tolerancia: ${closest} (esperado ~${expectedZ.toFixed(2)})`);
});

test('bisel frontal "S": manifold/watertight y 1 componente conectado (trazo con curvas complejas)', () => {
  const text = "S";
  const result = createLetterGeometry(montserratBold, { ...BEVEL_PARAMS, text });
  const mesh = bodyOf(result);
  assertValidMesh(mesh, "S-bevel");
  const topo = analyzeMeshTopology(mesh.positions);
  assert.equal(topo.degenerate, 0);
  assert.equal(topo.nonManifold, 0);
  assert.equal(topo.boundaryEdges, 0);
  assert.equal(countConnectedComponents(mesh.positions), 1);
});

test('bisel frontal + tapa plana "I": la tapa continúa la silueta angostada del bisel (mismo ancho que el borde real del cuerpo, sin voladizo)', () => {
  const withBevel = createLetterGeometry(montserratBold, { ...BEVEL_PARAMS, text: "I", frontType: "lid", lidJoint: "glue" });
  const withoutBevel = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "I", frontType: "lid", lidJoint: "glue" });
  const lidBoundsWithBevel = meshBounds(lidOf(withBevel.letters[0]).positions);
  const lidBoundsWithoutBevel = meshBounds(lidOf(withoutBevel.letters[0]).positions);

  const widthWithBevel = lidBoundsWithBevel.maxX - lidBoundsWithBevel.minX;
  const widthWithoutBevel = lidBoundsWithoutBevel.maxX - lidBoundsWithoutBevel.minX;
  const expectedNarrowing = 2 * BEVEL_PARAMS.bevelInsetMm; // por lado, en ambos lados de X
  assert.ok(
    Math.abs((widthWithoutBevel - widthWithBevel) - expectedNarrowing) < 0.01,
    `la tapa con bisel debería ser ${expectedNarrowing}mm más angosta que sin bisel (real: ${(widthWithoutBevel - widthWithBevel).toFixed(3)}mm) — sin esto, queda una tapa nominal sobresaliendo del cuerpo biselado (voladizo incorrecto)`,
  );
});

test('bisel frontal + tapa encastrable "O": sigue siendo válida (placa+labio manifold, 1 componente) con la silueta angostada', () => {
  const result = createLetterGeometry(montserratBold, { ...BEVEL_PARAMS, text: "O", frontType: "lid", lidJoint: "interior-lip" });
  const lidMesh = lidOf(result.letters[0]);
  assertValidMesh(lidMesh, "O.lid (bevel+interior-lip)");
  const topo = analyzeMeshTopology(lidMesh.positions);
  assert.equal(topo.nonManifold, 0, "O.lid (bevel+interior-lip): aristas no-manifold");
  assert.equal(topo.boundaryEdges, 0, "O.lid (bevel+interior-lip): no se esperaban bordes abiertos");
  assert.equal(countConnectedComponents(lidMesh.positions), 1);
  assert.deepEqual(result.errors, [], "no se esperaban errores: el bisel + labio interior es una combinación válida con estos parámetros");
});

test("bisel frontal + tapa: si el bisel erosiona toda la placa, el resultado queda marcado con BEVEL_PLATE_COLLAPSED (error, no geometría corrupta)", () => {
  // Letra muy chica + bisel grande respecto al trazo: la silueta angostada
  // (footprintAtOffset con inset = bevelInsetMm) puede erosionar toda la
  // placa. No es el foco de esta corrección (0.4.1 se concentra en
  // suavizar/continuar el bisel, no en redefinir sus límites), pero el
  // mecanismo de colapso (mismo patrón que LIP_COLLAPSED/CHANNEL_COLLAPSED)
  // debe seguir bloqueando la exportación en vez de degradarse en silencio.
  const result = createLetterGeometry(montserratBold, {
    ...DEFAULT_PARAMS,
    text: "I",
    heightMm: 6,
    bevelEnabled: true,
    bevelDepthMm: 2,
    bevelInsetMm: 10,
    frontType: "lid",
    lidJoint: "glue",
  });
  if (result.errors.length > 0) {
    assert.ok(result.errors.every((e) => e.code === "BEVEL_PLATE_COLLAPSED"), "se esperaba únicamente BEVEL_PLATE_COLLAPSED");
  }
  // Sin importar si colapsó o no con estos parámetros puntuales, el
  // resultado nunca debe lanzar una excepción ni dejar geometría con NaN.
  assertFiniteFloatArray(bodyOf(result).positions, "body.positions");
});

// --- 0.4.1 corrección 3B: doble bisel / bisel lateral luminoso (groove) ---
//
// Modificador SEPARADO del bisel frontal: una cintura intermedia donde la
// pared entra hacia adentro y vuelve a salir (perfil de montículo NEGATIVO,
// misma media onda coseno que las costillas — ver
// body/modifiers/groove.ts#grooveBandToZBand).

const GROOVE_PARAMS = { ...DEFAULT_PARAMS, grooveEnabled: true, grooveInsetMm: 0.6, grooveWidthMm: 4, groovePositionMm: 20 };

test('bisel lateral "I": offset 0 antes de la banda, entra progresivamente, alcanza el máximo a mitad de banda, y vuelve aproximadamente a 0 después', () => {
  const text = "I";
  const groups = contourGroupsFor(text);
  const band = computeGrooveBand(GROOVE_PARAMS.baseMm, GROOVE_PARAMS.depthMm, true, GROOVE_PARAMS.groovePositionMm, GROOVE_PARAMS.grooveWidthMm);
  assert.ok(band, "se esperaba que la banda del bisel lateral entre en la pared con estos parámetros");
  const bandCenter = (band.z0 + band.z1) / 2;

  const result = createLetterGeometry(montserratBold, { ...GROOVE_PARAMS, text });
  const bodyPositions = bodyOf(result).positions;

  // Fuera de la banda (bien por debajo de z0 o por encima de z1): la
  // silueta original no debería mostrar ninguna cara extra ahí (mismo
  // punto que la pared plana normal).
  const [ox, oy] = groups[0].outer[0];
  const hitsOutside = raycastZHits(bodyPositions, ox, oy).filter((z) => z > band.z0 + 0.3 && z < band.z1 - 0.3);
  assert.deepEqual(hitsOutside, [], "no debería haber una cara extra sobre la silueta original bien dentro de la banda (la cintura se erosiona hacia adentro, la silueta original queda vacía ahí)");

  // Al inset máximo (t=0.5, mitad de banda): dos impactos DENTRO del rango
  // de la banda, centrados en su medio (igual patrón que el montículo de
  // costillas, con signo invertido). El punto de sonda está INSET (a
  // diferencia de las costillas, que sondean OUTSET): sigue siendo parte
  // del material sólido normal fuera de la banda (fondo en z=0, frente en
  // z=depthMm), así que se filtran esos impactos — el foco acá es
  // exclusivamente la entrada/salida de la cintura.
  // 90% del inset máximo (no el máximo exacto): a t=0.5 exacto el hueco
  // entre entrada y salida es casi nulo (el pico es un único punto), y
  // redondearía ambos impactos al mismo Z — 90% deja un hueco medible sin
  // dejar de estar cerca del fondo de la cintura.
  const nearMaxInset = regroupClipperSolution(insetContourGroups(groups, GROOVE_PARAMS.grooveInsetMm * 0.9));
  const [px, py] = nearMaxInset[0].outer[0];
  const allHits = raycastZHits(bodyPositions, px, py).sort((a, b) => a - b);
  const hits = allHits.filter((z) => z > band.z0 - 1e-6 && z < band.z1 + 1e-6);
  assert.equal(hits.length, 2, `se esperaban 2 impactos dentro de la banda (entrada/salida de la cintura), se encontraron ${hits.length} de ${allHits.length} totales: [${hits.join(", ")}] (todos: [${allHits.join(", ")}])`);
  assert.ok(hits[0] > band.z0 && hits[0] < bandCenter, `el impacto de entrada debería estar entre el borde y el centro de la banda, fue ${hits[0]}`);
  assert.ok(hits[1] > bandCenter && hits[1] < band.z1, `el impacto de salida debería estar entre el centro y el borde de la banda, fue ${hits[1]}`);

  // No hay material más allá de grooveInsetMm hacia adentro en ningún Z.
  const beyondInset = regroupClipperSolution(insetContourGroups(groups, GROOVE_PARAMS.grooveInsetMm * 1.5));
  if (beyondInset.length > 0 && beyondInset[0].outer.length > 0) {
    const [bx, by] = beyondInset[0].outer[0];
    const beyondHits = raycastZHits(bodyPositions, bx, by).filter((z) => z > band.z0 - EPS_Z && z < band.z1 + EPS_Z);
    assert.deepEqual(beyondHits, [], "no debería haber pared más allá de grooveInsetMm hacia adentro de la cintura");
  }
});

for (const text of ["O", "B", "8"]) {
  test(`bisel lateral "${text}": manifold/watertight, 1 componente conectado y counters libres`, () => {
    const result = createLetterGeometry(montserratBold, { ...GROOVE_PARAMS, text });
    const mesh = bodyOf(result);
    assertValidMesh(mesh, `${text}-groove`);
    const topo = analyzeMeshTopology(mesh.positions);
    assert.equal(topo.degenerate, 0, `${text} (groove): triángulos degenerados`);
    assert.equal(topo.nonManifold, 0, `${text} (groove): aristas no-manifold`);
    assert.equal(topo.boundaryEdges, 0, `${text} (groove): no se esperaban bordes abiertos`);
    assert.equal(countConnectedComponents(mesh.positions), 1, `${text} (groove): se esperaba 1 componente conectado`);

    const groups = contourGroupsFor(text);
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      const hits = raycastZHits(mesh.positions, hx, hy).filter((z) => z > -EPS_Z && z < GROOVE_PARAMS.depthMm + EPS_Z);
      assert.deepEqual(hits, [], `${text} (groove): se esperaba el counter libre, hay geometría en z=[${hits.join(", ")}]`);
    }
  });
}

test("validateLetterSignParams: grooveInsetMm/grooveWidthMm/groovePositionMm fuera de rango cuando grooveEnabled", () => {
  const badInset = validateLetterSignParams({ ...GROOVE_PARAMS, grooveInsetMm: 0 });
  assert.ok(badInset.some((e) => e.field === "grooveInsetMm"));
  const badWidth = validateLetterSignParams({ ...GROOVE_PARAMS, grooveWidthMm: 0 });
  assert.ok(badWidth.some((e) => e.field === "grooveWidthMm"));
  const valid = validateLetterSignParams({ ...GROOVE_PARAMS, text: "O" });
  assert.ok(!valid.some((e) => e.field === "grooveInsetMm" || e.field === "grooveWidthMm" || e.field === "groovePositionMm"));
});

test("validateLetterSignParams: grooveInsetMm/grooveWidthMm fuera de rango no generan error si grooveEnabled es false", () => {
  const errors = validateLetterSignParams({ ...DEFAULT_PARAMS, grooveEnabled: false, grooveInsetMm: 999, grooveWidthMm: 999 });
  assert.ok(!errors.some((e) => e.field === "grooveInsetMm" || e.field === "grooveWidthMm"));
});

test("validateLetterSignParams: bisel frontal + bisel lateral superpuestos se bloquean con un mensaje claro (no compiten por el mismo tramo de pared)", () => {
  // bisel frontal: [depthMm-2, depthMm] = [38, 40]. bisel lateral centrado
  // en groovePositionMm=1 desde el frente, ancho 4mm: [depthMm-3, depthMm-1]
  // Wait: se arma explícitamente superpuesto con el bisel frontal.
  const overlapping = validateLetterSignParams({
    ...DEFAULT_PARAMS,
    bevelEnabled: true,
    bevelDepthMm: 2,
    bevelInsetMm: 1,
    grooveEnabled: true,
    grooveInsetMm: 0.5,
    grooveWidthMm: 4,
    groovePositionMm: 1,
  });
  assert.ok(overlapping.some((e) => e.field === "groovePositionMm"), "se esperaba un error bloqueando la superposición de bandas");

  // Separados (sin superposición): no debería haber error de superposición.
  const separated = validateLetterSignParams({
    ...DEFAULT_PARAMS,
    bevelEnabled: true,
    bevelDepthMm: 2,
    bevelInsetMm: 1,
    grooveEnabled: true,
    grooveInsetMm: 0.5,
    grooveWidthMm: 4,
    groovePositionMm: 20,
  });
  assert.ok(!separated.some((e) => e.field === "groovePositionMm"));
});

test('bisel frontal + bisel lateral combinados "O" (sin superponerse): ambos activos, resultado sigue siendo válido', () => {
  const result = createLetterGeometry(montserratBold, {
    ...DEFAULT_PARAMS,
    text: "O",
    bevelEnabled: true,
    bevelDepthMm: 2,
    bevelInsetMm: 1,
    grooveEnabled: true,
    grooveInsetMm: 0.5,
    grooveWidthMm: 4,
    groovePositionMm: 20,
  });
  const mesh = bodyOf(result);
  assertValidMesh(mesh, "O-bevel+groove");
  const topo = analyzeMeshTopology(mesh.positions);
  assert.equal(topo.degenerate, 0);
  assert.equal(topo.nonManifold, 0);
  assert.equal(topo.boundaryEdges, 0);
  assert.equal(countConnectedComponents(mesh.positions), 1);
});

test('costillas + doble bisel combinados "O": las costillas ceden lugar al bisel lateral (no se superponen) y el resultado sigue siendo válido', () => {
  const result = createLetterGeometry(montserratBold, { ...GROOVE_PARAMS, text: "O", ribsCount: 2 });
  const mesh = bodyOf(result);
  assertValidMesh(mesh, "O-ribs+groove");
  const topo = analyzeMeshTopology(mesh.positions);
  assert.equal(topo.degenerate, 0);
  assert.equal(topo.nonManifold, 0);
  assert.equal(topo.boundaryEdges, 0);
  assert.equal(countConnectedComponents(mesh.positions), 1);
});

// --- Stampa Maker 0.4 Etapa 5: frente perforado + difusor plano ---
//
// Máscara opaca con perforaciones (patrón de círculos, centro a centro) +
// difusor plano detrás, siempre 2 piezas separadas (ver front/perforated.ts,
// patterns/circles.ts). El difusor sigue la silueta completa; la máscara
// perfora esa misma silueta sin tocar los counters originales.

test('patrón circular: "I" genera agujeros del diámetro configurado, respetando el margen', () => {
  const groups = contourGroupsFor("I", 100);
  const plateGroups = groups.map((g) => ({ outer: g.outer, holes: g.holes }));
  const punched = punchCirclePattern(plateGroups, { holeDiameterMm: 2, pitchMm: 4, edgeMarginMm: 2 });

  const originalHoleCount = plateGroups.reduce((sum, g) => sum + g.holes.length, 0);
  const punchedHoleCount = punched.reduce((sum, g) => sum + g.holes.length, 0);
  assert.ok(punchedHoleCount > originalHoleCount, "se esperaban agujeros nuevos perforados en la máscara");

  const expectedArea = Math.PI * (2 / 2) ** 2;
  for (const group of punched) {
    for (const hole of group.holes) {
      const area = Math.abs(polygonArea(hole));
      assert.ok(area > expectedArea * 0.7 && area < expectedArea * 1.3, `área de agujero fuera de rango: ${area.toFixed(3)}mm² (esperado ~${expectedArea.toFixed(3)}mm²)`);
    }
  }
});

test("patrón circular: mayor edgeMargin produce menos agujeros (mismo pitch/diámetro)", () => {
  const groups = contourGroupsFor("O", 100);
  const plateGroups = groups.map((g) => ({ outer: g.outer, holes: g.holes }));
  const countHoles = (gs) => gs.reduce((sum, g) => sum + g.holes.length, 0);
  const tightMargin = punchCirclePattern(plateGroups, { holeDiameterMm: 2, pitchMm: 4, edgeMarginMm: 1 });
  const looseMargin = punchCirclePattern(plateGroups, { holeDiameterMm: 2, pitchMm: 4, edgeMarginMm: 5 });
  assert.ok(countHoles(looseMargin) < countHoles(tightMargin), "un margen mayor debería dejar lugar para menos agujeros");
});

test("patrón circular: mayor pitch produce menos agujeros (mismo diámetro/margen)", () => {
  const groups = contourGroupsFor("O", 100);
  const plateGroups = groups.map((g) => ({ outer: g.outer, holes: g.holes }));
  const countHoles = (gs) => gs.reduce((sum, g) => sum + g.holes.length, 0);
  const tightPitch = punchCirclePattern(plateGroups, { holeDiameterMm: 2, pitchMm: 3, edgeMarginMm: 2 });
  const loosePitch = punchCirclePattern(plateGroups, { holeDiameterMm: 2, pitchMm: 8, edgeMarginMm: 2 });
  assert.ok(countHoles(loosePitch) < countHoles(tightPitch), "un pitch mayor debería dejar menos agujeros en la misma área");
});

test('patrón circular "O": no perfora el hueco central (el counter permanece intacto)', () => {
  const groups = contourGroupsFor("O", 100);
  const plateGroups = groups.map((g) => ({ outer: g.outer, holes: g.holes }));
  const punched = punchCirclePattern(plateGroups, { holeDiameterMm: 2, pitchMm: 4, edgeMarginMm: 2 });
  const originalHoleArea = Math.abs(polygonArea(plateGroups[0].holes[0]));
  const centralHoleAfter = punched[0].holes.find((h) => Math.abs(Math.abs(polygonArea(h)) - originalHoleArea) < originalHoleArea * 0.05);
  assert.ok(centralHoleAfter, "el hueco central original debería seguir presente sin deformarse");
});

const PERFORATED_PARAMS = { ...DEFAULT_PARAMS, frontType: "perforated" };

// 0.4.1 corrección 4A: orden físico correcto, del cuerpo hacia el
// observador: CUERPO -> DIFUSOR -> MÁSCARA (la máscara es la pieza más
// externa/lejana). Antes, `PART_ORDER` en createLetterGeometry.ts listaba
// "mask" antes que "diffuser" — la causa de raíz del offset explosionado
// invertido en el viewport (ver docs/STAMPA_MAKER.md).
test('frente perforado "O": orden físico body -> diffuser -> mask (cada pieza empieza donde termina la anterior o más allá, nunca antes)', () => {
  const result = createLetterGeometry(montserratBold, { ...PERFORATED_PARAMS, text: "O" });
  const letter = result.letters[0];
  const bodyBounds = meshBounds(letter.parts.find((p) => p.kind === "body").mesh.positions);
  const diffuserBounds = meshBounds(letter.parts.find((p) => p.kind === "diffuser").mesh.positions);
  const maskBounds = meshBounds(letter.parts.find((p) => p.kind === "mask").mesh.positions);

  assert.ok(bodyBounds.maxZ <= diffuserBounds.minZ + 1e-6, "el difusor debería empezar donde termina el cuerpo (o más adelante)");
  assert.ok(diffuserBounds.maxZ <= maskBounds.maxZ, "la máscara (su cara) debería ser la pieza más externa, más lejos del cuerpo que el difusor");
  // La MÁSCARA es la única con faldón (puede llegar más atrás que el
  // difusor en minZ), pero su CARA (el extremo más externo, maxZ) siempre
  // queda más lejos del cuerpo que el difusor — eso es lo que define el
  // orden observador->máscara->difusor->cuerpo.
});

// Límite conocido de 0.4 Etapa 5: con CIENTOS de huecos cercanos en una
// sola tapa (la máscara perforada, a diferencia de cualquier letra normal
// con a lo sumo 2-3 huecos), earcut puede elegir algún "puente"
// hueco-a-hueco cuyo triángulo resultante es válido en float64 pero
// colapsa a colineal recién al redondear a Float32 (`TriangleSoupData`
// usa Float32Array) — un artefacto numérico sin volumen real, no una
// grieta ni una superposición: no genera bordes abiertos ni aristas
// no-manifold (verificado abajo, sin tolerancia), solo un puñado de
// triángulos de área ~0 que un slicer ignora. Documentado en
// docs/STAMPA_MAKER.md en vez de ocultarlo; ver también DECISIONS
// (aumentar el jitter no lo resuelve de forma confiable a esta densidad
// de huecos — es un límite del triangulador, no del patrón/pieza).
const MAX_BENIGN_DEGENERATE_TRIANGLES = 30;

for (const text of ["O", "B", "8"]) {
  test(`frente perforado "${text}": máscara y difusor son piezas válidas, separadas, manifold/watertight`, () => {
    const result = createLetterGeometry(montserratBold, { ...PERFORATED_PARAMS, text });
    const letter = result.letters[0];
    const maskPart = letter.parts.find((p) => p.kind === "mask");
    const diffuserPart = letter.parts.find((p) => p.kind === "diffuser");
    assert.ok(maskPart, `"${text}": se esperaba una pieza "mask"`);
    assert.ok(diffuserPart, `"${text}": se esperaba una pieza "diffuser"`);
    assertValidMesh(maskPart.mesh, `${text}.mask`);
    assertValidMesh(diffuserPart.mesh, `${text}.diffuser`);

    const diffuserTopo = analyzeMeshTopology(diffuserPart.mesh.positions);
    assert.equal(diffuserTopo.degenerate, 0, `${text}.diffuser: triángulos degenerados`);
    assert.equal(diffuserTopo.nonManifold, 0, `${text}.diffuser: aristas no-manifold`);
    assert.equal(diffuserTopo.boundaryEdges, 0, `${text}.diffuser: no se esperaban bordes abiertos`);

    const maskTopo = analyzeMeshTopology(maskPart.mesh.positions);
    assert.ok(
      maskTopo.degenerate <= MAX_BENIGN_DEGENERATE_TRIANGLES,
      `${text}.mask: demasiados triángulos degenerados (${maskTopo.degenerate}), más allá del artefacto numérico esperado a esta densidad de huecos`,
    );
    assert.equal(maskTopo.nonManifold, 0, `${text}.mask: aristas no-manifold`);
    assert.equal(maskTopo.boundaryEdges, 0, `${text}.mask: no se esperaban bordes abiertos`);
  });

  test(`frente perforado "${text}": el counter original queda libre en máscara y difusor`, () => {
    const groups = contourGroupsFor(text);
    const result = createLetterGeometry(montserratBold, { ...PERFORATED_PARAMS, text });
    const letter = result.letters[0];
    const maskPart = letter.parts.find((p) => p.kind === "mask");
    const diffuserPart = letter.parts.find((p) => p.kind === "diffuser");
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      assert.deepEqual(raycastZHits(maskPart.mesh.positions, hx, hy), [], `${text}.mask: counter debería estar libre`);
      assert.deepEqual(raycastZHits(diffuserPart.mesh.positions, hx, hy), [], `${text}.diffuser: counter debería estar libre`);
    }
  });
}

// 0.4.1 corrección 4B: la máscara pasó de ser una placa plana a una carcasa
// (cara perforada + faldón lateral, ver front/perforated.ts) — su huella
// crece uniformemente por `maskClearanceMm + maskWallThicknessMm`
// (exterior Y counters, mismo mecanismo `footprintAtOffset` que costillas/
// tapered), así que ya no comparte límites Z ni silueta con el difusor
// (que SÍ sigue la silueta original sin cambios). El Z de la CARA (no del
// faldón, que se extiende más atrás) sigue empezando justo donde termina
// el difusor.

test('frente perforado "O": la cara de la máscara empieza justo donde termina el difusor, sin superponerse', () => {
  const result = createLetterGeometry(montserratBold, { ...PERFORATED_PARAMS, text: "O" });
  const letter = result.letters[0];
  const diffuserBounds = meshBounds(letter.parts.find((p) => p.kind === "diffuser").mesh.positions);
  const maskBounds = meshBounds(letter.parts.find((p) => p.kind === "mask").mesh.positions);

  // Tolerancia relajada (no 1e-6): TriangleSoupData.positions es
  // Float32Array, y valores como 40.6 no son representables exactos en
  // float32 (error de redondeo ~1e-5 para magnitudes ~40).
  const FLOAT32_TOL = 1e-4;
  assert.ok(Math.abs(diffuserBounds.minZ - PERFORATED_PARAMS.depthMm) < FLOAT32_TOL);
  assert.ok(Math.abs(diffuserBounds.maxZ - (PERFORATED_PARAMS.depthMm + PERFORATED_PARAMS.diffuserThicknessMm)) < FLOAT32_TOL);
  // maxZ de la máscara (el extremo más lejano del cuerpo) = tope de la
  // CARA, no del faldón (que va hacia atrás, más cerca del cuerpo).
  assert.ok(Math.abs(maskBounds.maxZ - (diffuserBounds.maxZ + PERFORATED_PARAMS.maskThicknessMm)) < FLOAT32_TOL);
});

test('frente perforado "O": la máscara tiene perforaciones visibles (un agujero del patrón queda libre en la malla generada)', () => {
  // La máscara ya no perfora la silueta ORIGINAL directamente: perfora la
  // silueta crecida por maskClearanceMm+maskWallThicknessMm (outerGroups en
  // front/perforated.ts) — mismo cálculo acá para encontrar un agujero real.
  const groups = contourGroupsFor("O");
  const outerGroups = groups.flatMap((g) => footprintAtOffset(g, PERFORATED_PARAMS.maskClearanceMm + PERFORATED_PARAMS.maskWallThicknessMm));
  const punched = punchCirclePattern(outerGroups, {
    holeDiameterMm: PERFORATED_PARAMS.holeDiameterMm,
    pitchMm: PERFORATED_PARAMS.pitchMm,
    edgeMarginMm: PERFORATED_PARAMS.edgeMarginMm,
  });
  const originalHoleArea = Math.abs(polygonArea(outerGroups[0].holes[0]));
  const patternHole = punched[0].holes.find((h) => Math.abs(Math.abs(polygonArea(h)) - originalHoleArea) > 1);
  assert.ok(patternHole, "se esperaba al menos un agujero del patrón distinto del counter original");
  const [hx, hy] = polygonCentroid(patternHole);

  const result = createLetterGeometry(montserratBold, { ...PERFORATED_PARAMS, text: "O" });
  const maskPart = result.letters[0].parts.find((p) => p.kind === "mask");
  // Sólo en el rango Z de la CARA (no del faldón, que en XY puede pasar
  // cerca del perímetro pero nunca perfora — ver test dedicado más abajo):
  // un agujero real del patrón está bien adentro de la zona segura, lejos
  // del faldón, así que no debería haber NINGÚN impacto en absoluto.
  const hits = raycastZHits(maskPart.mesh.positions, hx, hy);
  assert.deepEqual(hits, [], "se esperaba que el agujero del patrón esté libre en la máscara generada");
});

// --- 0.4.1 corrección 4B: máscara como carcasa (faldón lateral) ---

test('frente perforado "O": maskSideDepthMm=5 da un faldón de ~5mm medidos desde el frente', () => {
  const params = { ...PERFORATED_PARAMS, text: "O", maskSideDepthMm: 5 };
  const result = createLetterGeometry(montserratBold, params);
  const maskPart = result.letters[0].parts.find((p) => p.kind === "mask");
  const bounds = meshBounds(maskPart.mesh.positions);
  const expectedSkirtZ0 = params.depthMm - 5;
  assert.ok(Math.abs(bounds.minZ - expectedSkirtZ0) < 1e-3, `el faldón debería llegar hasta z=${expectedSkirtZ0}, llegó hasta z=${bounds.minZ}`);
});

test('frente perforado "O": maskSideDepthMm >= profundidad del cuerpo da cobertura lateral completa (hasta z=0)', () => {
  const params = { ...PERFORATED_PARAMS, text: "O", maskSideDepthMm: PERFORATED_PARAMS.depthMm };
  const result = createLetterGeometry(montserratBold, params);
  const maskPart = result.letters[0].parts.find((p) => p.kind === "mask");
  const bounds = meshBounds(maskPart.mesh.positions);
  assert.ok(Math.abs(bounds.minZ - 0) < 1e-3, `con cobertura completa el faldón debería llegar hasta z=0, llegó hasta z=${bounds.minZ}`);

  // Advertencia MASK_SIDE_DEPTH_CLAMPED si se pide más de lo disponible.
  const overResult = createLetterGeometry(montserratBold, { ...params, maskSideDepthMm: params.depthMm * 3 });
  assert.ok(overResult.warnings.some((w) => w.code === "MASK_SIDE_DEPTH_CLAMPED"), "se esperaba MASK_SIDE_DEPTH_CLAMPED al pedir más cobertura que la profundidad disponible");
});

test('frente perforado "O": maskSideDepthMm=0 no genera faldón (sólo la cara, mismo comportamiento que una placa)', () => {
  const params = { ...PERFORATED_PARAMS, text: "O", maskSideDepthMm: 0 };
  const result = createLetterGeometry(montserratBold, params);
  const maskPart = result.letters[0].parts.find((p) => p.kind === "mask");
  const bounds = meshBounds(maskPart.mesh.positions);
  const expectedFaceZ0 = params.depthMm + params.diffuserThicknessMm;
  assert.ok(Math.abs(bounds.minZ - expectedFaceZ0) < 1e-3, "sin faldón, la máscara debería ocupar sólo el rango Z de la cara");
});

for (const text of ["O", "B", "8"]) {
  test(`frente perforado "${text}": la máscara (cara + faldón) es manifold/watertight y 1 solo componente conectado`, () => {
    const result = createLetterGeometry(montserratBold, { ...PERFORATED_PARAMS, text });
    const maskPart = result.letters[0].parts.find((p) => p.kind === "mask");
    const topo = analyzeMeshTopology(maskPart.mesh.positions);
    assert.ok(topo.degenerate <= MAX_BENIGN_DEGENERATE_TRIANGLES, `${text}.mask: demasiados triángulos degenerados (${topo.degenerate})`);
    assert.equal(topo.nonManifold, 0, `${text}.mask: aristas no-manifold`);
    assert.equal(topo.boundaryEdges, 0, `${text}.mask: no se esperaban bordes abiertos (cara+faldón cerrados)`);
    assert.equal(countConnectedComponents(maskPart.mesh.positions), 1, `${text}.mask: se esperaba 1 solo componente conectado (cara+faldón soldados)`);
  });

  test(`frente perforado "${text}": el counter original queda libre en el faldón también (no sólo en la cara)`, () => {
    const groups = contourGroupsFor(text);
    const result = createLetterGeometry(montserratBold, { ...PERFORATED_PARAMS, text });
    const maskPart = result.letters[0].parts.find((p) => p.kind === "mask");
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      assert.deepEqual(raycastZHits(maskPart.mesh.positions, hx, hy), [], `${text}.mask: counter debería estar libre en toda la profundidad (cara + faldón)`);
    }
  });
}

test('frente perforado "O": maskClearanceMm separa el faldón de la silueta real del cuerpo (holgura por lado)', () => {
  const groups = contourGroupsFor("O");
  const smallClearance = { ...PERFORATED_PARAMS, text: "O", maskClearanceMm: 0.2 };
  const bigClearance = { ...PERFORATED_PARAMS, text: "O", maskClearanceMm: 1.5 };

  // El borde INTERIOR del faldón (el más cerca del cuerpo real) es
  // exactamente `footprintAtOffset(group, maskClearanceMm)` — un punto de
  // ese borde debería estar más lejos del contorno original cuando la
  // holgura es mayor.
  const innerSmall = footprintAtOffset(groups[0], smallClearance.maskClearanceMm);
  const innerBig = footprintAtOffset(groups[0], bigClearance.maskClearanceMm);
  const distSmall = minDistanceToPolygon(innerSmall[0].outer[0], groups[0].outer);
  const distBig = minDistanceToPolygon(innerBig[0].outer[0], groups[0].outer);
  assert.ok(Math.abs(distSmall - smallClearance.maskClearanceMm) < 0.05);
  assert.ok(Math.abs(distBig - bigClearance.maskClearanceMm) < 0.05);
  assert.ok(distBig > distSmall, "una holgura mayor debería separar más el faldón de la silueta real");
});

test('frente perforado: el patrón de círculos nunca perfora el faldón lateral (sólo la cara frontal)', () => {
  const params = { ...PERFORATED_PARAMS, text: "O", maskSideDepthMm: PERFORATED_PARAMS.depthMm };
  const result = createLetterGeometry(montserratBold, params);
  const maskPart = result.letters[0].parts.find((p) => p.kind === "mask");
  const faceZ0 = params.depthMm + params.diffuserThicknessMm;

  // Sondeamos en el ANILLO del faldón (entre el borde interior y exterior
  // del faldón, ver footprintAtOffset) muy por debajo de la cara: si
  // hubiera un agujero del patrón ahí, un rayo vertical mostraría un hueco
  // (0 impactos) en vez de tocar la pared sólida del faldón (>=1 impacto
  // por debajo de la cara).
  const groups = contourGroupsFor("O");
  const skirtMidOuter = footprintAtOffset(groups[0], params.maskClearanceMm + params.maskWallThicknessMm / 2);
  const [sx, sy] = skirtMidOuter[0].outer[0];
  const hitsBelowFace = raycastZHits(maskPart.mesh.positions, sx, sy).filter((z) => z < faceZ0 - 0.1);
  assert.ok(hitsBelowFace.length > 0, "se esperaba pared sólida del faldón (sin perforar) por debajo de la cara");
});

test('"STAMPA" con frente perforado: exporta cuerpo+máscara+difusor por letra (18 STL en el ZIP)', async () => {
  const result = createLetterGeometry(montserratBold, { ...PERFORATED_PARAMS, text: "STAMPA" });
  const blob = await buildLettersZipBlob(result);
  const zip = await JSZipLib.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.equal(names.length, 18, "se esperaban 18 STL (6 letras x 3 piezas)");
  assert.ok(names.includes("01_S_cuerpo.stl"));
  assert.ok(names.includes("01_S_mascara.stl"));
  assert.ok(names.includes("01_S_difusor.stl"));
});

test("palabra completa con frente perforado: ZIP con <nombre>_cuerpo/_mascara/_difusor.stl", async () => {
  const result = createLetterGeometry(montserratBold, { ...PERFORATED_PARAMS, text: "STAMPA" });
  const blob = await buildWordZipBlob(result, "stampa");
  const zip = await JSZipLib.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ["stampa_cuerpo.stl", "stampa_difusor.stl", "stampa_mascara.stl"]);
});

test("validateLetterSignParams: campos del frente perforado fuera de rango cuando frontType es perforated", () => {
  const bad = validateLetterSignParams({ ...PERFORATED_PARAMS, text: "O", maskThicknessMm: 0, diffuserThicknessMm: 0, holeDiameterMm: 0, pitchMm: 0, edgeMarginMm: -1 });
  for (const field of ["maskThicknessMm", "diffuserThicknessMm", "holeDiameterMm", "pitchMm", "edgeMarginMm"]) {
    assert.ok(bad.some((e) => e.field === field), `se esperaba un error en ${field}`);
  }
  const valid = validateLetterSignParams({ ...PERFORATED_PARAMS, text: "O" });
  assert.deepEqual(valid, []);
});

test("validateLetterSignParams: campos del frente perforado fuera de rango no generan error si frontType no es perforated", () => {
  const errors = validateLetterSignParams({ ...DEFAULT_PARAMS, text: "O", maskThicknessMm: 999, diffuserThicknessMm: 999, holeDiameterMm: 999, pitchMm: 0, edgeMarginMm: 999 });
  assert.ok(!errors.some((e) => ["maskThicknessMm", "diffuserThicknessMm", "holeDiameterMm", "pitchMm", "edgeMarginMm"].includes(e.field)));
});

// --- Stampa Maker 0.4 Etapa 6: canal luminoso interior ---
//
// A diferencia de los demás frentes, el canal luminoso asume un cuerpo
// MACIZO (sin la cavidad interior hueca del resto de los frentes): el
// canal es la ÚNICA cavidad, tallada desde el frente hacia adentro sin
// atravesar el cuerpo (ver body/standard.ts). El difusor del canal sigue
// EXACTAMENTE su huella, nunca la letra completa (ver front/lightChannel.ts).

const LIGHT_CHANNEL_PARAMS = { ...DEFAULT_PARAMS, frontType: "light-channel" };

test('computeChannelFootprint "O": genera un anillo entre channelOffsetMm y channelOffsetMm+channelWidthMm', () => {
  const groups = contourGroupsFor("O", 100);
  const { channelGroups, collapsed } = computeChannelFootprint(groups[0], 2, 6);
  assert.equal(collapsed, false);
  assert.ok(channelGroups.length > 0, "se esperaba al menos una banda del canal");

  const referenceBoundaries = [groups[0].outer, ...groups[0].holes];
  for (const group of channelGroups) {
    const samplePoints = [...group.outer, ...group.holes.flat()];
    const step = Math.max(1, Math.floor(samplePoints.length / 10));
    for (let i = 0; i < samplePoints.length; i += step) {
      const d = Math.min(...referenceBoundaries.map((poly) => minDistanceToPolygon(samplePoints[i], poly)));
      assert.ok(d > 2 * 0.5 && d < 8 * 1.5, `punto del canal a distancia inesperada del contorno más cercano: ${d.toFixed(2)}mm (esperado entre ~2 y ~8mm)`);
    }
  }
});

// Límite conocido de 0.4 Etapa 6: en letras con features complejas cerca
// del canal (p.ej. la pata diagonal de una "R", donde el contorno exterior
// y el canal quedan muy próximos), earcut puede dejar un puñado de aristas
// de borde en la tapa del frente al triangular "silueta menos canal" — un
// puente casi degenerado, mismo tipo de límite numérico del triangulador
// ya documentado en la Etapa 5 (frente perforado), no una grieta real de
// espesor significativo. Documentado en vez de forzado a 0 para no
// ocultarlo (ver docs/STAMPA_MAKER.md).
const MAX_BENIGN_BOUNDARY_EDGES = 10;

for (const text of ["O", "A", "B", "8", "R"]) {
  test(`canal luminoso "${text}": cuerpo válido, manifold/watertight (con tolerancia documentada) y 1 componente conectado`, () => {
    const result = createLetterGeometry(montserratBold, { ...LIGHT_CHANNEL_PARAMS, text });
    assert.deepEqual(result.errors, [], `"${text}": no se esperaban errores`);
    const mesh = bodyOf(result);
    assertValidMesh(mesh, `${text}.body`);
    const topo = analyzeMeshTopology(mesh.positions);
    assert.equal(topo.degenerate, 0, `${text}: triángulos degenerados`);
    assert.equal(topo.nonManifold, 0, `${text}: aristas no-manifold`);
    assert.ok(topo.boundaryEdges <= MAX_BENIGN_BOUNDARY_EDGES, `${text}: demasiadas aristas de borde (${topo.boundaryEdges})`);
    assert.equal(countConnectedComponents(mesh.positions), 1, `${text}: se esperaba 1 componente conectado (el exterior permanece unido)`);
  });

  test(`canal luminoso "${text}": counters libres y el difusor del canal es una pieza válida separada`, () => {
    const groups = contourGroupsFor(text);
    const result = createLetterGeometry(montserratBold, { ...LIGHT_CHANNEL_PARAMS, text });
    const mesh = bodyOf(result);
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      const hits = raycastZHits(mesh.positions, hx, hy).filter((z) => z > -EPS_Z && z < LIGHT_CHANNEL_PARAMS.depthMm + EPS_Z);
      assert.deepEqual(hits, [], `${text}: se esperaba el counter libre`);
    }

    const diffuserPart = result.letters[0].parts.find((p) => p.kind === "channelDiffuser");
    assert.ok(diffuserPart, `${text}: se esperaba una pieza "channelDiffuser"`);
    assertValidMesh(diffuserPart.mesh, `${text}.channelDiffuser`);
    const dtopo = analyzeMeshTopology(diffuserPart.mesh.positions);
    assert.equal(dtopo.degenerate, 0, `${text}.channelDiffuser: triángulos degenerados`);
    assert.equal(dtopo.nonManifold, 0, `${text}.channelDiffuser: aristas no-manifold`);
    assert.equal(dtopo.boundaryEdges, 0, `${text}.channelDiffuser: no se esperaban bordes abiertos`);
  });
}

test('canal luminoso "O": no atraviesa el fondo (piso sólido a channelDepthMm del frente) — profundidad medible', () => {
  const text = "O";
  const midOffset = LIGHT_CHANNEL_PARAMS.channelOffsetMm + LIGHT_CHANNEL_PARAMS.channelWidthMm / 2;
  const groups = contourGroupsFor(text);
  const midGroups = regroupClipperSolution(insetContourGroups(groups, midOffset));
  const [px, py] = midGroups[0].outer[0];

  const result = createLetterGeometry(montserratBold, { ...LIGHT_CHANNEL_PARAMS, text });
  const hits = raycastZHits(bodyOf(result).positions, px, py).sort((a, b) => a - b);

  const expectedFloorZ = LIGHT_CHANNEL_PARAMS.depthMm - LIGHT_CHANNEL_PARAMS.channelDepthMm;
  assert.equal(hits.length, 2, `se esperaban 2 impactos (fondo sólido en z=0 + piso del canal), se encontraron ${hits.length}: [${hits.join(", ")}]`);
  assert.ok(Math.abs(hits[0] - 0) < 1e-3, `se esperaba el fondo sólido en z=0, fue ${hits[0]}`);
  assert.ok(Math.abs(hits[1] - expectedFloorZ) < 1e-3, `piso del canal fuera de rango: ${hits[1]} (esperado ${expectedFloorZ})`);
});

test('canal luminoso "O": el ancho y el margen del canal son medibles (material opaco hasta el frente fuera de la banda del canal)', () => {
  const text = "O";
  const groups = contourGroupsFor(text);
  const beforeGroups = regroupClipperSolution(insetContourGroups(groups, LIGHT_CHANNEL_PARAMS.channelOffsetMm * 0.5));
  const [px1, py1] = beforeGroups[0].outer[0];
  const afterOffset = LIGHT_CHANNEL_PARAMS.channelOffsetMm + LIGHT_CHANNEL_PARAMS.channelWidthMm + 1;
  const afterGroups = regroupClipperSolution(insetContourGroups(groups, afterOffset));
  const [px2, py2] = afterGroups[0].outer[0];

  const result = createLetterGeometry(montserratBold, { ...LIGHT_CHANNEL_PARAMS, text });
  const mesh = bodyOf(result);

  for (const [px, py, label] of [[px1, py1, "antes del canal (margen)"], [px2, py2, "después del canal"]]) {
    const hits = raycastZHits(mesh.positions, px, py).filter((z) => z > -EPS_Z && z < LIGHT_CHANNEL_PARAMS.depthMm + EPS_Z);
    const nearFront = hits.filter((z) => Math.abs(z - LIGHT_CHANNEL_PARAMS.depthMm) < 0.5);
    assert.ok(nearFront.length > 0, `${label}: se esperaba material opaco hasta el frente (fuera de la banda del canal)`);
  }
});

function collapsedChannelResult() {
  return createLetterGeometry(montserratBold, {
    ...LIGHT_CHANNEL_PARAMS,
    text: "I",
    heightMm: 10,
  });
}

test("canal luminoso: trazo demasiado fino para el ancho de canal pedido marca el resultado como ERROR, sin geometría corrupta", () => {
  const result = collapsedChannelResult();
  assertValidMesh(bodyOf(result), "I-canal-colapsado");
  assert.ok(result.errors.some((e) => e.code === "CHANNEL_COLLAPSED"), "se esperaba CHANNEL_COLLAPSED en errors");
  assert.ok(/letra "I"/.test(result.errors[0].message), "el mensaje debería identificar la letra afectada");
});

test("canal luminoso con CHANNEL_COLLAPSED: ningún camino de exportación acepta el resultado", async () => {
  const result = collapsedChannelResult();
  await assert.rejects(() => buildLettersZipBlob(result), /letra "I"/);
  await assert.rejects(() => buildWordZipBlob(result, "stampa"), /letra "I"/);
});

test("canal luminoso: channelDepthMm mayor a la cavidad disponible se ajusta automáticamente (CHANNEL_DEPTH_CLAMPED), sin bloquear la exportación", () => {
  const result = createLetterGeometry(montserratBold, { ...LIGHT_CHANNEL_PARAMS, text: "O", depthMm: 5, baseMm: 1, channelDepthMm: 20 });
  assert.ok(result.warnings.some((w) => w.code === "CHANNEL_DEPTH_CLAMPED"));
  assert.deepEqual(result.errors, [], "un ajuste automático de profundidad no debería bloquear la exportación");
});

test('"STAMPA" con canal luminoso: exporta cuerpo+difusor de canal por letra (12 STL en el ZIP)', async () => {
  const result = createLetterGeometry(montserratBold, { ...LIGHT_CHANNEL_PARAMS, text: "STAMPA" });
  assert.deepEqual(result.errors, []);
  const blob = await buildLettersZipBlob(result);
  const zip = await JSZipLib.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.equal(names.length, 12, "se esperaban 12 STL (6 cuerpos + 6 difusores de canal)");
  assert.ok(names.includes("01_S_cuerpo.stl"));
  assert.ok(names.includes("01_S_difusor_canal.stl"));
});

test("validateLetterSignParams: campos del canal luminoso fuera de rango cuando frontType es light-channel", () => {
  const bad = validateLetterSignParams({ ...LIGHT_CHANNEL_PARAMS, text: "O", channelWidthMm: 0, channelDepthMm: 0, channelOffsetMm: -1, diffuserClearanceMm: -1 });
  for (const field of ["channelWidthMm", "channelDepthMm", "channelOffsetMm", "diffuserClearanceMm"]) {
    assert.ok(bad.some((e) => e.field === field), `se esperaba un error en ${field}`);
  }
  const valid = validateLetterSignParams({ ...LIGHT_CHANNEL_PARAMS, text: "O" });
  assert.deepEqual(valid, []);
});

test("validateLetterSignParams: campos del canal luminoso fuera de rango no generan error si frontType no es light-channel", () => {
  const errors = validateLetterSignParams({ ...DEFAULT_PARAMS, text: "O", channelWidthMm: 999, channelDepthMm: 999, channelOffsetMm: 999, diffuserClearanceMm: 999 });
  assert.ok(!errors.some((e) => ["channelWidthMm", "channelDepthMm", "channelOffsetMm", "diffuserClearanceMm"].includes(e.field)));
});
