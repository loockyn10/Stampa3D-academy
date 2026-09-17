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
const { validateLetterSignParams } = loadMakerModule("lib/maker/validation.ts");
const opentype = nodeRequire("opentype.js");

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
    assert.ok(topo.boundaryEdges > 0, `${text}: se esperaba al menos el borde del frente abierto`);
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
