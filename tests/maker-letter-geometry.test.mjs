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
const { insetContourGroups, regroupClipperSolution, clipperPathsArea } = loadMakerModule("lib/maker/geometry/offsets.ts");
const { fitInteriorLip } = loadMakerModule("lib/maker/geometry/joints/interiorLip.ts");
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
  frontType: "open",
  lidMm: 1.2,
  lidJoint: "glue",
  insertDepthMm: 3,
  clearanceMm: 0.2,
  lipWallMm: 0.8,
};

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
    assertValidMesh(result.body, text);
  });

  test(`createLetterGeometry genera una malla topológicamente correcta para "${text}"`, () => {
    const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text });
    const topo = analyzeMeshTopology(result.body.positions);
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
  });
  assertValidMesh(result.body, "I-pared-excesiva");
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
  const hits = raycastZHits(result.body.positions, cx, cy).filter(
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
  const hitsInFondo = raycastZHits(result.body.positions, cx, cy).filter(
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
  const hits = raycastZHits(result.body.positions, midX, holeCy).filter((z) => z > -EPS_Z && z < DEFAULT_PARAMS.depthMm + EPS_Z);
  assert.ok(hits.length > 0, `se esperaba material sólido en el trazo de la "O" en (${midX.toFixed(2)}, ${holeCy.toFixed(2)})`);
});

// --- Front: no debe existir una tapa frontal cubriendo la cavidad ---

test('"O": no hay ninguna cara exactamente en z = depthMm sobre el counter (frente abierto real)', () => {
  const groups = contourGroupsFor("O");
  const [cx, cy] = polygonCentroid(groups[0].holes[0]);
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const hits = raycastZHits(result.body.positions, cx, cy);
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
  const topo = analyzeMeshTopology(result.body.positions);
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
    const components = countConnectedComponents(result.body.positions);
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
    const recentered = recenterMesh(letter.body);
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
  const originalBounds = meshBounds(p.body.positions);
  assert.ok(originalBounds.minX > 50, "la P debería estar bien desplazada en X dentro de la palabra completa");

  const recentered = recenterMesh(p.body);
  const b = meshBounds(recentered.positions);
  assert.ok(Math.abs((b.minX + b.maxX) / 2) < 1e-3, "el centro X recentrado debería quedar ~0");
});

test('exportación individual: la "O" recentrada mantiene el counter libre en toda la profundidad', () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const letter = result.letters[0];
  const recentered = recenterMesh(letter.body);

  // Centro del counter en coordenadas originales, trasladado con el mismo
  // offset que recenterMesh le aplicó a la malla completa.
  const groups = contourGroupsFor("O");
  const [holeCx, holeCy] = polygonCentroid(groups[0].holes[0]);
  const originalBounds = meshBounds(letter.body.positions);
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
  assert.equal(result.lid, null);
  assert.equal(result.letters[0].lid, null);
});

for (const text of ["A", "O", "B", "8"]) {
  test(`tapa frontal "${text}": mesh válido, manifold/watertight y sin tapar el counter`, () => {
    const result = createLetterGeometry(montserratBold, { ...LID_PARAMS, text });
    const letter = result.letters[0];
    assert.ok(letter.lid, `"${text}": se esperaba una tapa`);
    assertValidMesh(letter.lid, `${text}.lid`);

    const topo = analyzeMeshTopology(letter.lid.positions);
    assert.equal(topo.degenerate, 0, `${text}.lid: triángulos degenerados`);
    assert.equal(topo.nonManifold, 0, `${text}.lid: aristas no-manifold`);
    assert.equal(topo.boundaryEdges, 0, `${text}.lid: no se esperaban bordes abiertos (tapa sólida y cerrada)`);

    // El counter debe seguir libre en la tapa: NO puede convertirse en un disco.
    const groups = contourGroupsFor(text);
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      const hits = raycastZHits(letter.lid.positions, hx, hy);
      assert.deepEqual(hits, [], `${text}.lid: se esperaba el counter libre en la tapa, hay geometría en z=[${hits.join(", ")}]`);
    }
  });
}

test('tapa frontal "O": ocupa exactamente z = [depthMm, depthMm + lidMm]', () => {
  const result = createLetterGeometry(montserratBold, { ...LID_PARAMS, text: "O" });
  const b = meshBounds(result.letters[0].lid.positions);
  assert.ok(Math.abs(b.minZ - LID_PARAMS.depthMm) < 1e-6, `minZ debería ser depthMm (${LID_PARAMS.depthMm}), fue ${b.minZ}`);
  assert.ok(
    Math.abs(b.maxZ - (LID_PARAMS.depthMm + LID_PARAMS.lidMm)) < 1e-6,
    `maxZ debería ser depthMm+lidMm (${LID_PARAMS.depthMm + LID_PARAMS.lidMm}), fue ${b.maxZ}`,
  );
});

test('tapa frontal "O": el cuerpo no cambia respecto al frente abierto (misma profundidad, misma malla)', () => {
  const openResult = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const lidResult = createLetterGeometry(montserratBold, { ...LID_PARAMS, text: "O" });
  assert.deepEqual(Array.from(lidResult.letters[0].body.positions), Array.from(openResult.letters[0].body.positions));
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
  assert.deepEqual(Array.from(withExtraFields.letters[0].body.positions), Array.from(reference.letters[0].body.positions));
  assert.equal(withExtraFields.lid, null);
});

// B. Regression: tapa plana (lidJoint "glue") sigue siendo exactamente la
// misma pieza que en 0.2 (mismo código: geometry/lid.ts solo movió la
// rama "glue" tal cual, sin tocarla).
test('regresión 0.3: tapa plana ("O") no cambia al introducir lidJoint/insertDepthMm/clearanceMm', () => {
  const withExtraFields = createLetterGeometry(montserratBold, { ...LID_PARAMS, insertDepthMm: 3, clearanceMm: 0.2, text: "O" });
  const reference = createLetterGeometry(montserratBold, { ...LID_PARAMS, text: "O" });
  assert.deepEqual(Array.from(withExtraFields.letters[0].lid.positions), Array.from(reference.letters[0].lid.positions));
});

// C-F. O/A/B/8: placa+labio válido, manifold/watertight, counters libres,
// 1 solo componente conectado (placa+labio soldados, no dos shells).
for (const text of ["A", "O", "B", "8"]) {
  test(`tapa encastrable "${text}": placa+labio válido, manifold/watertight, counters libres y 1 componente conectado`, () => {
    const result = createLetterGeometry(montserratBold, { ...LIP_PARAMS, text });
    const letter = result.letters[0];
    assert.ok(letter.lid, `"${text}": se esperaba una tapa`);
    assertValidMesh(letter.lid, `${text}.lid`);

    const topo = analyzeMeshTopology(letter.lid.positions);
    assert.equal(topo.degenerate, 0, `${text}.lid: triángulos degenerados`);
    assert.equal(topo.nonManifold, 0, `${text}.lid: aristas no-manifold`);
    assert.equal(topo.boundaryEdges, 0, `${text}.lid: no se esperaban bordes abiertos (placa+labio soldados)`);

    const components = countConnectedComponents(letter.lid.positions);
    assert.equal(components, 1, `${text}.lid: se esperaba 1 componente conectado (placa+labio soldados), se encontraron ${components}`);

    const groups = contourGroupsFor(text);
    for (const hole of groups[0].holes) {
      const [hx, hy] = polygonCentroid(hole);
      const hits = raycastZHits(letter.lid.positions, hx, hy);
      assert.deepEqual(hits, [], `${text}.lid: se esperaba el counter libre en la tapa encastrable, hay geometría en z=[${hits.join(", ")}]`);
    }
  });
}

// G. Insert depth: el labio se extiende ~insertDepthMm hacia el interior
// (minZ de la tapa combinada = depthMm - insertDepthMm; maxZ sin cambios).
test('tapa encastrable "O": el labio ocupa z = [depthMm - insertDepthMm, depthMm + lidMm]', () => {
  const result = createLetterGeometry(montserratBold, { ...LIP_PARAMS, text: "O" });
  const b = meshBounds(result.letters[0].lid.positions);
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

  const hits = raycastZHits(result.letters[0].lid.positions, midX, holeCy);
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
  assertValidMesh(result.letters[0].lid, "I-encastre-colapsado.lid");
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

  const b = meshBounds(result.letters[0].lid.positions);
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
