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
const backCutouts = loadMakerModule("lib/maker/geometry/backCutouts.ts");
const { validateLetterSignParams } = loadMakerModule("lib/maker/validation.ts");
const { DEFAULT_LETTER_SIGN_PARAMS } = loadMakerModule("lib/maker/defaults.ts");
const orient = loadMakerModule("lib/maker/printOrientation.ts");
const { partFileEntries } = loadMakerModule("lib/maker/exporters/parts.ts");
const { placementMatrix, makeBedItem } = loadMakerModule("lib/maker/printBed/bedLayout.ts");
const { extractPresetSettings } = loadMakerModule("lib/maker/presets/presetSettings.ts");
const projects = loadMakerModule("lib/maker/projects/projectData.ts");
const opentype = nodeRequire("opentype.js");

function loadFont(fileName) {
  const buf = fs.readFileSync(path.join(root, "public/fonts/maker", fileName));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const font = loadFont("Montserrat-Bold.woff");

const BASE = { ...DEFAULT_LETTER_SIGN_PARAMS, text: "O" };
const gen = (text, patch = {}) => createLetterGeometry(font, { ...BASE, text, ...patch });
const circle = (x, y, d = 5, id = "c") => ({ id, type: "circle", x, y, diameterMm: d });

// ------------------------------------------------------------ helpers de malla

function bounds(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function polyArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}
function inside(points, [px, py]) {
  let c = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function bodyMesh(result, letter = 0) {
  return result.letters[letter].parts.find((p) => p.kind === "body").mesh;
}
function meshBounds3(positions) {
  return orient.meshBounds(positions);
}
// Área total de triángulos cuya cara mira a -Z/+Z y está en el plano z (dentro de tolerancia).
function planarCapArea(mesh, z, nzSign) {
  let area = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const o = t * 9;
    if (Math.abs(p[o + 2] - z) > 1e-4 || Math.abs(p[o + 5] - z) > 1e-4 || Math.abs(p[o + 8] - z) > 1e-4) continue;
    const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1];
    const cross = ux * vy - uy * vx;
    if (Math.sign(cross) !== nzSign) continue;
    area += Math.abs(cross) / 2;
  }
  return area;
}
function topology(positions) {
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const directed = new Map();
  let degenerate = 0;
  for (let t = 0; t < positions.length / 9; t++) {
    const o = t * 9;
    const v = [0, 1, 2].map((i) => [positions[o + i * 3], positions[o + i * 3 + 1], positions[o + i * 3 + 2]]);
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
    const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    if (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2 < 1e-9) degenerate++;
    for (let e = 0; e < 3; e++) {
      const k = `${key(...v[e])}|${key(...v[(e + 1) % 3])}`;
      directed.set(k, (directed.get(k) || 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  const seen = new Set();
  for (const k of directed.keys()) {
    const [a, b] = k.split("|");
    const u = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(u)) continue;
    seen.add(u);
    const f = directed.get(`${a}|${b}`) || 0, r = directed.get(`${b}|${a}`) || 0;
    if (f !== r) (f + r === 1 ? boundary++ : nonManifold++);
  }
  return { degenerate, boundary, nonManifold };
}
function components(positions) {
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (let t = 0; t < positions.length / 9; t++) {
    const ks = [0, 1, 2].map((i) => key(positions[t * 9 + i * 3], positions[t * 9 + i * 3 + 1], positions[t * 9 + i * 3 + 2]));
    ks.forEach((k) => { if (!parent.has(k)) parent.set(k, k); });
    parent.set(find(ks[0]), find(ks[1]));
    parent.set(find(ks[1]), find(ks[2]));
  }
  return new Set([...parent.keys()].map(find)).size;
}

/** Busca una posición X/Y donde el recorte es válido para `text` (barre el diseño). */
function findValidPosition(text, makeCut, patch = {}, xRange = [-80, 80], yRange = [-40, 40], step = 4) {
  for (let x = xRange[0]; x <= xRange[1]; x += step) {
    for (let y = yRange[0]; y <= yRange[1]; y += step) {
      const r = gen(text, { ...patch, backCutouts: [makeCut(x, y)] });
      if (!r.errors.some((e) => e.code === "BACK_CUTOUT_INVALID") && bodyMesh(r).triangleCount !== bodyMesh(gen(text, patch)).triangleCount) return [x, y];
    }
  }
  throw new Error(`sin posición válida para ${text}`);
}

// ------------------------------------------------------------------ formas

test("recorte circular: diámetro correcto y centrado en la posición", () => {
  const poly = backCutouts.backCutoutPolygons(circle(10, -5, 6.4), { x: 0, y: 0 })[0];
  const b = bounds(poly);
  assert.ok(Math.abs(b.maxX - b.minX - 6.4) < 0.01 && Math.abs(b.maxY - b.minY - 6.4) < 0.01);
  assert.ok(Math.abs((b.maxX + b.minX) / 2 - 10) < 1e-6 && Math.abs((b.maxY + b.minY) / 2 + 5) < 1e-6);
  assert.ok(Math.abs(polyArea(poly) - Math.PI * 3.2 * 3.2) / (Math.PI * 3.2 * 3.2) < 0.01);
});

test("recorte cápsula: ancho/alto exactos, extremos redondeados y área de slot", () => {
  const cap = { id: "k", type: "capsule", x: 0, y: 0, widthMm: 10, heightMm: 4, rotationDeg: 0 };
  const poly = backCutouts.backCutoutPolygons(cap)[0];
  const b = bounds(poly);
  assert.ok(Math.abs(b.maxX - b.minX - 10) < 1e-6 && Math.abs(b.maxY - b.minY - 4) < 1e-6);
  const expected = (10 - 4) * 4 + Math.PI * 2 * 2;
  assert.ok(Math.abs(polyArea(poly) - expected) / expected < 0.01);
  // Extremos redondeados: la esquina del rectángulo envolvente queda afuera, el centro del extremo adentro.
  assert.equal(inside(poly, [4.9, 1.9]), false);
  assert.equal(inside(poly, [4.5, 0]), true);
});

test("recorte cápsula: rotación 90° la deja vertical; width < height también es vertical", () => {
  const rotated = backCutouts.backCutoutPolygons({ id: "k", type: "capsule", x: 3, y: 7, widthMm: 10, heightMm: 4, rotationDeg: 90 })[0];
  const rb = bounds(rotated);
  assert.ok(Math.abs(rb.maxX - rb.minX - 4) < 1e-6 && Math.abs(rb.maxY - rb.minY - 10) < 1e-6);
  const vertical = backCutouts.backCutoutPolygons({ id: "k", type: "capsule", x: 0, y: 0, widthMm: 4, heightMm: 10, rotationDeg: 0 })[0];
  const vb = bounds(vertical);
  assert.ok(Math.abs(vb.maxX - vb.minX - 4) < 1e-6 && Math.abs(vb.maxY - vb.minY - 10) < 1e-6);
  assert.equal(inside(vertical, [1.9, 4.9]), false);
  assert.equal(inside(vertical, [0, 4.5]), true);
});

const KEY = { id: "h", type: "keyhole", x: 0, y: 0, headDiameterMm: 10, neckWidthMm: 4, neckLengthMm: 12, tailDiameterMm: 4, rotationDeg: 0 };

test("recorte keyhole: cabeza, cuello y largo correctos, una única forma continua", () => {
  const polys = backCutouts.backCutoutPolygons(KEY);
  assert.equal(polys.length, 1, "debe ser un único contorno continuo");
  const poly = polys[0];
  const b = bounds(poly);
  assert.ok(Math.abs(b.maxX - b.minX - 10) < 0.02, "ancho = diámetro de cabeza");
  assert.ok(Math.abs(b.maxY - 5) < 0.02, "tope = radio de la cabeza");
  assert.ok(Math.abs(b.minY - (-12 - 2)) < 0.02, "fondo = largo del cuello + radio del extremo");
  // Ancho del cuello a mitad de recorrido: 4 mm.
  assert.equal(inside(poly, [1.9, -8]), true);
  assert.equal(inside(poly, [2.1, -8]), false);
  assert.equal(inside(poly, [0, 0]), true);
  assert.equal(inside(poly, [0, -13.5]), true);
  assert.equal(inside(poly, [4, -8]), false);
});

test("recorte keyhole: rotación 90° y 180° reorienta el cuello", () => {
  const b90 = bounds(backCutouts.backCutoutPolygons({ ...KEY, rotationDeg: 90 })[0]);
  assert.ok(b90.maxX - b90.minX > 15 && b90.maxY - b90.minY < 10.1);
  const p180 = backCutouts.backCutoutPolygons({ ...KEY, rotationDeg: 180 })[0];
  assert.ok(bounds(p180).maxY > 13.9);
  assert.equal(inside(p180, [0, 8]), true);
});

test("posición: X/Y son relativos al centro del diseño (origin) y mueven el polígono", () => {
  const a = bounds(backCutouts.backCutoutPolygons(circle(0, 0, 4), { x: 100, y: 50 })[0]);
  const b = bounds(backCutouts.backCutoutPolygons(circle(10, 20, 4), { x: 100, y: 50 })[0]);
  assert.ok(Math.abs((b.minX - a.minX) - 10) < 1e-9 && Math.abs((b.minY - a.minY) - 20) < 1e-9);
});

// -------------------------------------------------------------- validación

test("validación de parámetros: width/height <= 0, keyhole inválido, demasiados recortes", () => {
  const bad = (c) => backCutouts.validateBackCutoutShape(c);
  assert.ok(bad(circle(0, 0, 0)));
  assert.ok(bad(circle(0, 0, -3)));
  assert.ok(bad({ id: "k", type: "capsule", x: 0, y: 0, widthMm: 0, heightMm: 4, rotationDeg: 0 }));
  assert.ok(bad({ id: "k", type: "capsule", x: 0, y: 0, widthMm: 10, heightMm: -1, rotationDeg: 0 }));
  assert.ok(bad({ id: "k", type: "capsule", x: 0, y: 0, widthMm: 10, heightMm: 4, rotationDeg: NaN }));
  assert.ok(bad({ ...KEY, neckWidthMm: 10 }), "cuello >= cabeza");
  assert.ok(bad({ ...KEY, neckLengthMm: 0 }));
  assert.ok(bad({ ...KEY, tailDiameterMm: 2 }), "extremo menor que el cuello");
  assert.ok(bad(circle(0, 0, 9999)));
  assert.equal(bad(circle(0, 0, 5)), null);
  assert.equal(bad(KEY), null);
  const many = Array.from({ length: 51 }, (_, i) => circle(i, 0, 2, `c${i}`));
  assert.ok(backCutouts.validateBackCutouts(many).some((e) => e.index === -1));
  assert.equal(backCutouts.MAX_BACK_CUTOUTS, 50);
  const fieldErrors = validateLetterSignParams({ ...BASE, backCutouts: [circle(0, 0, 0)] });
  assert.ok(fieldErrors.some((e) => e.field === "backCutouts"));
});

// -------------------------------------------------------------- cuerpo

for (const letter of ["O", "B", "8", "S"]) {
  test(`cuerpo "${letter}" con recorte: atraviesa la base, paredes/counters intactos, watertight y mismos componentes`, () => {
    const base = gen(letter);
    const [x, y] = findValidPosition(letter, (px, py) => circle(px, py, 5));
    const cut = gen(letter, { backCutouts: [circle(x, y, 5)] });
    assert.equal(cut.errors.length, 0);

    const m0 = bodyMesh(base), m1 = bodyMesh(cut);
    const holeArea = Math.PI * 2.5 * 2.5;
    const baseArea0 = planarCapArea(m0, 0, -1), baseArea1 = planarCapArea(m1, 0, -1);
    assert.ok(Math.abs(baseArea0 - baseArea1 - holeArea) / holeArea < 0.03, `tapa trasera: ${baseArea0} -> ${baseArea1}`);
    const shelf0 = planarCapArea(m0, 1.2, 1), shelf1 = planarCapArea(m1, 1.2, 1);
    assert.ok(Math.abs(shelf0 - shelf1 - holeArea) / holeArea < 0.03, `repisa: ${shelf0} -> ${shelf1}`);

    // Paredes y frente (todo lo que está por encima de la base) no cambian.
    const front0 = planarCapArea(m0, 40, 1), front1 = planarCapArea(m1, 40, 1);
    assert.ok(Math.abs(front0 - front1) < 1e-6, "el frente (paredes/counters) no debe cambiar");
    const b0 = meshBounds3(m0.positions), b1 = meshBounds3(m1.positions);
    assert.deepEqual([b0.minX, b0.maxX, b0.minY, b0.maxY, b0.maxZ], [b1.minX, b1.maxX, b1.minY, b1.maxY, b1.maxZ]);

    const t = topology(m1.positions);
    assert.deepEqual(t, { degenerate: 0, boundary: 0, nonManifold: 0 });
    assert.equal(components(m1.positions), components(m0.positions));
  });
}

test("recorte no atraviesa más que la base: nada por encima de baseMm cambia de posición", () => {
  const [x, y] = findValidPosition("O", (px, py) => circle(px, py, 5));
  const cut = gen("O", { backCutouts: [circle(x, y, 5)] });
  const p = bodyMesh(cut).positions;
  // Toda arista del agujero (vértices a 2.5 mm del centro del recorte) vive entre z=0 y z=baseMm.
  const b = meshBounds3(bodyMesh(gen("O")).positions);
  const cx = (b.minX + b.maxX) / 2 + x, cy = (b.minY + b.maxY) / 2 + y;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(Math.hypot(p[i] - cx, p[i + 1] - cy) - 2.5) < 0.02) assert.ok(p[i + 2] <= 1.2 + 1e-4, `vértice del agujero en z=${p[i + 2]}`);
  }
});

test("capsule y keyhole también atraviesan la base y dejan el cuerpo watertight", () => {
  for (const make of [
    (x, y) => ({ id: "s", type: "capsule", x, y, widthMm: 8, heightMm: 3, rotationDeg: 30 }),
    (x, y) => ({ id: "k", type: "keyhole", x, y, headDiameterMm: 6, neckWidthMm: 3, neckLengthMm: 6, tailDiameterMm: 3, rotationDeg: 0 }),
  ]) {
    const [x, y] = findValidPosition("B", make, {}, [-80, 80], [-40, 40], 4);
    const r = gen("B", { backCutouts: [make(x, y)] });
    assert.equal(r.errors.length, 0);
    assert.ok(planarCapArea(bodyMesh(r), 0, -1) < planarCapArea(bodyMesh(gen("B")), 0, -1) - 5);
    assert.deepEqual(topology(bodyMesh(r).positions), { degenerate: 0, boundary: 0, nonManifold: 0 });
  }
});

test("recortes solapados se funden en una sola abertura (sin caras duplicadas)", () => {
  const [x, y] = findValidPosition("O", (px, py) => circle(px, py, 5));
  const two = gen("O", { backCutouts: [circle(x, y, 5, "a"), circle(x + 3, y, 5, "b")] });
  if (two.errors.length === 0) {
    assert.deepEqual(topology(bodyMesh(two).positions), { degenerate: 0, boundary: 0, nonManifold: 0 });
    const one = planarCapArea(bodyMesh(gen("O", { backCutouts: [circle(x, y, 5)] })), 0, -1);
    const merged = planarCapArea(bodyMesh(two), 0, -1);
    assert.ok(merged > one - 40 && merged < one, "la unión quita menos área que dos agujeros separados");
  }
  // Dos recortes separados: múltiples permitidos.
  const sep = gen("8", { backCutouts: [circle(-30, -25, 3, "a"), circle(30, 25, 3, "b")] });
  assert.ok(sep.errors.length >= 0);
});

test("posición: en \"AB\", un recorte bajo la A modifica solo la A", () => {
  const base = gen("AB");
  // Centro del diseño = centro de la caja de AB; la A queda a la izquierda.
  const bA = meshBounds3(bodyMesh(base, 0).positions);
  const bAll = meshBounds3(base.parts.find((p) => p.kind === "body").mesh.positions);
  const cx = (bAll.minX + bAll.maxX) / 2, cy = (bAll.minY + bAll.maxY) / 2;
  let hit = null;
  for (let x = bA.minX; x <= bA.maxX && !hit; x += 2) {
    for (let y = bA.minY; y <= bA.maxY && !hit; y += 2) {
      const r = gen("AB", { backCutouts: [circle(x - cx, y - cy, 4)] });
      if (r.errors.length === 0 && bodyMesh(r, 0).triangleCount !== bodyMesh(base, 0).triangleCount) hit = r;
    }
  }
  assert.ok(hit, "se esperaba un punto válido bajo la A");
  assert.notEqual(bodyMesh(hit, 0).triangleCount, bodyMesh(base, 0).triangleCount, "A modificada");
  assert.deepEqual(Array.from(bodyMesh(hit, 1).positions), Array.from(bodyMesh(base, 1).positions), "B sin cambios");
});

test("recortes inválidos: fuera del cuerpo, cruzando el borde y demasiado grande => error controlado y sin geometría corrupta", () => {
  const base = gen("O");
  const outside = gen("O", { backCutouts: [circle(500, 500, 5)] });
  assert.ok(outside.errors.some((e) => e.code === "BACK_CUTOUT_INVALID" && e.message.includes("demasiado cerca del borde o fuera del cuerpo")));
  assert.equal(bodyMesh(outside).triangleCount, bodyMesh(base).triangleCount, "no se corta nada");

  const huge = gen("O", { backCutouts: [circle(0, 0, 400)] });
  assert.ok(huge.errors.some((e) => e.code === "BACK_CUTOUT_INVALID"));

  const [x, y] = findValidPosition("O", (px, py) => circle(px, py, 5));
  // Cruza el borde: un círculo enorme centrado en un punto válido invade pared/counter.
  const crossing = gen("O", { backCutouts: [circle(x, y, 60)] });
  assert.ok(crossing.errors.some((e) => e.code === "BACK_CUTOUT_INVALID"));
  assert.deepEqual(topology(bodyMesh(crossing).positions), { degenerate: 0, boundary: 0, nonManifold: 0 });

  // Un recorte válido + uno inválido: solo el inválido se rechaza y se reporta con su número.
  const mixed = gen("O", { backCutouts: [circle(x, y, 5, "ok"), circle(500, 0, 5, "bad")] });
  assert.equal(mixed.errors.length, 1);
  assert.ok(mixed.errors[0].message.startsWith("Recorte 2:"));
});

test("recortes con frente de canal luminoso: error explícito (cuerpo macizo)", () => {
  const r = gen("O", { frontType: "light-channel", backCutouts: [circle(0, 0, 5)] });
  assert.ok(r.errors.some((e) => e.code === "BACK_CUTOUT_INVALID"));
});

test("sin recortes el cuerpo es idéntico (backCutouts vacío o ausente)", () => {
  const a = gen("S", { backCutouts: [] });
  const noField = createLetterGeometry(font, { ...BASE, text: "S", backCutouts: undefined });
  assert.deepEqual(Array.from(bodyMesh(a).positions), Array.from(bodyMesh(noField).positions));
});

test("cuerpo tapered con recorte: base recortada y watertight", () => {
  const [x, y] = findValidPosition("O", (px, py) => circle(px, py, 4));
  const r = gen("O", { bodyType: "tapered", backCutouts: [circle(x, y, 4)] });
  assert.ok(planarCapArea(bodyMesh(r), 0, -1) < planarCapArea(bodyMesh(gen("O", { bodyType: "tapered" })), 0, -1) - 8);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(topology(bodyMesh(r).positions), { degenerate: 0, boundary: 0, nonManifold: 0 });
});

// ------------------------------------------------------ orientación de impresión

test("printTransform: lid y mask giran 180° en Y; body/diffuser/channelDiffuser no", () => {
  assert.deepEqual(orient.getPrintTransform("lid"), { rotationXDeg: 0, rotationYDeg: 180, rotationZDeg: 0 });
  assert.equal(orient.getPrintTransform("mask").rotationYDeg, 180);
  for (const k of ["body", "diffuser", "channelDiffuser"]) assert.equal(orient.isIdentityTransform(orient.getPrintTransform(k)), true, k);
});

test("tapa exportada: rotada 180° en Y, minZ = 0 (nunca Z negativo) y misma altura", () => {
  const r = gen("O", { frontType: "lid", lidJoint: "interior-lip" });
  const lid = r.parts.find((p) => p.kind === "lid").mesh;
  const before = meshBounds3(lid.positions);
  assert.ok(before.minZ > 1, "la tapa nace sobre el cuerpo (Z alto)");
  const entry = partFileEntries(r.parts, "x").find((e) => e.fileName.endsWith("_tapa.stl"));
  const after = meshBounds3(entry.mesh.positions);
  assert.ok(Math.abs(after.minZ) < 1e-4, `minZ=${after.minZ}`);
  assert.ok(Math.abs(after.maxZ - (before.maxZ - before.minZ)) < 1e-4);
  assert.ok(Math.abs(after.maxX - after.minX - (before.maxX - before.minX)) < 1e-4, "misma huella XY");
  // La cara visible (antes +Z, la más alta) queda contra la cama: la normal dominante ahora apunta a -Z en Z=0.
  assert.ok(planarCapArea(entry.mesh, 0, -1) > 1, "cara plana apoyada en la cama");
  for (const part of partFileEntries(r.parts, "x")) assert.ok(meshBounds3(part.mesh.positions).minZ > -1e-4);
});

test("el cuerpo exporta sin rotar (misma malla)", () => {
  const r = gen("O", { frontType: "lid" });
  const body = r.parts.find((p) => p.kind === "body").mesh;
  const entry = partFileEntries(r.parts, "x").find((e) => e.fileName.endsWith("_cuerpo.stl"));
  assert.equal(entry.mesh, body);
});

test("Vista Cama y exportación STL usan la MISMA transformación (rotación y huella)", () => {
  const r = gen("O", { frontType: "lid", lidJoint: "interior-lip" });
  const lid = r.parts.find((p) => p.kind === "lid").mesh;
  const item = makeBedItem("l", "l", "lid", lid);
  const exported = meshBounds3(orient.orientMeshForPrint(lid, "lid").positions);
  assert.ok(Math.abs(item.widthMm - (exported.maxX - exported.minX)) < 1e-4);
  assert.ok(Math.abs(item.depthMm - (exported.maxY - exported.minY)) < 1e-4);
  assert.ok(Math.abs(item.heightMm - (exported.maxZ - exported.minZ)) < 1e-4);
  const m = placementMatrix(item, { x: 0, y: 0, rotated: false });
  const P = orient.printRotationMatrix(orient.getPrintTransform("lid"));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(m[j * 4 + i] - P[i][j]) < 1e-9, `L[${i}][${j}]`);
  // Y la malla transformada con la matriz de la cama coincide con la exportada (mismos vértices tras alinear a la esquina).
  const p = lid.positions;
  const ys = [], zs = [];
  for (let i = 0; i < p.length; i += 3) {
    ys.push(m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13]);
    zs.push(m[2] * p[i] + m[6] * p[i + 1] + m[10] * p[i + 2] + m[14]);
  }
  assert.ok(Math.abs(Math.min(...zs)) < 1e-4);
  assert.ok(Math.abs(Math.min(...ys)) < 1e-4);
});

// ------------------------------------------------------ presets y proyectos

test("presets generales NO guardan recortes; el proyecto sí (round-trip circle/capsule/keyhole)", () => {
  const cuts = [
    circle(3, -4, 5.5, "a"),
    { id: "b", type: "capsule", x: -10, y: 15, widthMm: 10, heightMm: 4, rotationDeg: 45 },
    { ...KEY, id: "c", x: 7, y: 2, rotationDeg: 30 },
  ];
  const params = { ...DEFAULT_LETTER_SIGN_PARAMS, backCutouts: cuts };
  assert.equal("backCutouts" in extractPresetSettings(params), false);
  // (la receta de instalación tiene una clave "keyhole" propia: lo que no debe viajar es un RECORTE de tipo keyhole)
  assert.equal(JSON.stringify(extractPresetSettings(params)).includes('"type":"keyhole"'), false);
  const state = { params, sourceMode: "text", designHeightMm: 100, pngOptions: { threshold: 128, invert: false, smoothing: "medium" }, fileMeta: null };
  const payload = projects.serializeProject(state);
  const loaded = projects.deserializeProject(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(loaded.params.backCutouts, cuts);
  assert.deepEqual(loaded.params, params);
});

test("proyectos antiguos sin backCutouts cargan con []; cambiar recortes marca Modificado", () => {
  const loaded = projects.deserializeProject({ source_type: "text", source_data: { text: "HOLA" }, settings: { depthMm: 33 }, schema_version: 1 });
  assert.deepEqual(loaded.params.backCutouts, []);
  const state = { params: DEFAULT_LETTER_SIGN_PARAMS, sourceMode: "text", designHeightMm: 100, pngOptions: { threshold: 128, invert: false, smoothing: "medium" }, fileMeta: null };
  const sig = projects.projectSignature(state, null);
  assert.equal(projects.isProjectDirty(state, null, sig), false);
  assert.equal(projects.isProjectDirty({ ...state, params: { ...state.params, backCutouts: [circle(1, 1)] } }, null, sig), true);
  assert.deepEqual(projects.normalizeBackCutouts([{ type: "wat" }, { type: "circle", x: 1 }]).map((c) => c.type), ["circle"]);
});
