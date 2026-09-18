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
const { insetContourGroups } = loadMakerModule("lib/maker/geometry/offsets.ts");
const { validateLetterSignParams } = loadMakerModule("lib/maker/validation.ts");
const { buildLettersZipBlob, recenterMesh } = loadMakerModule("lib/maker/exporters/exportLettersZip.ts");
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
};

function assertFiniteFloatArray(arr, label) {
  for (let i = 0; i < arr.length; i++) {
    assert.ok(Number.isFinite(arr[i]), `${label}[${i}] no es finito: ${arr[i]}`);
  }
}

function assertValidResult(result, label) {
  assert.ok(result.triangleCount > 0, `${label}: se esperaban triángulos`);
  assert.equal(result.positions.length, result.triangleCount * 9, `${label}: positions no coincide con triangleCount`);
  assert.equal(result.normals.length, result.positions.length, `${label}: normals no coincide con positions`);
  assertFiniteFloatArray(result.positions, `${label}.positions`);
  assertFiniteFloatArray(result.normals, `${label}.normals`);
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
    assertValidResult(result, text);
  });

  test(`createLetterGeometry genera una malla topológicamente correcta para "${text}"`, () => {
    const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text });
    const topo = analyzeMeshTopology(result.positions);
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

function contourGroupsFor(char) {
  const path = textToOpentypePath(montserratBold, char, 100);
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
  assertValidResult(result, "I-pared-excesiva");
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
  const hits = raycastZHits(result.positions, cx, cy).filter(
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
  const hitsInFondo = raycastZHits(result.positions, cx, cy).filter(
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
  const hits = raycastZHits(result.positions, midX, holeCy).filter((z) => z > -EPS_Z && z < DEFAULT_PARAMS.depthMm + EPS_Z);
  assert.ok(hits.length > 0, `se esperaba material sólido en el trazo de la "O" en (${midX.toFixed(2)}, ${holeCy.toFixed(2)})`);
});

// --- Front: no debe existir una tapa frontal cubriendo la cavidad ---

test('"O": no hay ninguna cara exactamente en z = depthMm sobre el counter (frente abierto real)', () => {
  const groups = contourGroupsFor("O");
  const [cx, cy] = polygonCentroid(groups[0].holes[0]);
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const hits = raycastZHits(result.positions, cx, cy);
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
  const topo = analyzeMeshTopology(result.positions);
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
    const components = countConnectedComponents(result.positions);
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

  const blob = await buildLettersZipBlob(result.letters);
  const zip = await JSZipLib.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ["01_S.stl", "02_T.stl", "03_A.stl", "04_M.stl", "05_P.stl", "06_A.stl"]);
});

test('"LOOCK 3D": el espacio no genera archivo, se generan 7 STL con nombres únicos', async () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "LOOCK 3D" });
  assert.equal(result.letters.length, 7);
  assert.deepEqual(result.letters.map((l) => l.char), ["L", "O", "O", "C", "K", "3", "D"]);

  const blob = await buildLettersZipBlob(result.letters);
  const zip = await JSZipLib.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ["01_L.stl", "02_O.stl", "03_O.stl", "04_C.stl", "05_K.stl", "06_3.stl", "07_D.stl"]);
  assert.equal(new Set(names).size, names.length, "los nombres deben ser únicos");
});

test("recenterMesh: cada letra individual queda centrada en XY con minZ = 0", () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "STAMPA" });
  for (const letter of result.letters) {
    const recentered = recenterMesh(letter);
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
  const originalBounds = meshBounds(p.positions);
  assert.ok(originalBounds.minX > 50, "la P debería estar bien desplazada en X dentro de la palabra completa");

  const recentered = recenterMesh(p);
  const b = meshBounds(recentered.positions);
  assert.ok(Math.abs((b.minX + b.maxX) / 2) < 1e-3, "el centro X recentrado debería quedar ~0");
});

test('exportación individual: la "O" recentrada mantiene el counter libre en toda la profundidad', () => {
  const result = createLetterGeometry(montserratBold, { ...DEFAULT_PARAMS, text: "O" });
  const letter = result.letters[0];
  const recentered = recenterMesh(letter);

  // Centro del counter en coordenadas originales, trasladado con el mismo
  // offset que recenterMesh le aplicó a la malla completa.
  const groups = contourGroupsFor("O");
  const [holeCx, holeCy] = polygonCentroid(groups[0].holes[0]);
  const originalBounds = meshBounds(letter.positions);
  const shiftX = (originalBounds.minX + originalBounds.maxX) / 2;
  const shiftY = (originalBounds.minY + originalBounds.maxY) / 2;

  const hits = raycastZHits(recentered.positions, holeCx - shiftX, holeCy - shiftY).filter(
    (z) => z > -EPS_Z && z < DEFAULT_PARAMS.depthMm + EPS_Z,
  );
  assert.deepEqual(hits, [], `se esperaba el counter libre tras recentrar, hay geometría en z=[${hits.join(", ")}]`);
});
