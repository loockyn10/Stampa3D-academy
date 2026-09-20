import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

// Carga módulos TypeScript de src/lib/maker/** con el compilador de TypeScript
// (mismo mecanismo que tests/maker-letter-geometry.test.mjs).
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

const { buildNeonPaths, createNeonGeometry } = load("lib/maker/neon/createNeonGeometry.ts");
const { textToNeonPaths } = load("lib/maker/neon/paths/textToNeonPaths.ts");
const { svgToNeonPaths, SVG_FILL_ONLY_MESSAGE } = load("lib/maker/neon/paths/svgToNeonPaths.ts");
const { createChannelGeometry } = load("lib/maker/neon/geometry/createChannelGeometry.ts");
const { neonPathLength, totalNeonLength, recommendedNeonLength } = load("lib/maker/neon/metrics/pathLength.ts");
const { analyzeCurvature } = load("lib/maker/neon/metrics/curvature.ts");
const { DEFAULT_NEON_PARAMS, channelInnerWidth, channelOuterWidth } = load("lib/maker/neon/defaults.ts");
const { validateNeonParams } = load("lib/maker/neon/validation/validateNeonParams.ts");
const { NEON_FONTS } = load("lib/maker/neon/fonts/neonFonts.ts");
const { collectBedItems, computeBedLayout, placementMatrix } = load("lib/maker/printBed/bedLayout.ts");
const { getPrinterProfile, DEFAULT_PRINTER_PROFILE_ID } = load("lib/maker/printBed/printerProfiles.ts");
const { partFileEntries } = load("lib/maker/exporters/parts.ts");
const { buildSTLBlob } = load("lib/maker/exporters/exportSTL.ts");
const { meshBounds } = load("lib/maker/printOrientation.ts");

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const P = DEFAULT_NEON_PARAMS; // neon 6, holgura 0.3, pared 8/1.2, fondo 1.6
const INNER = 6.3;
const OUTER = 8.7;
const TOP = 9.6;
const approx = (a, b, tol = 0.02, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} esperado ${b} ± ${tol}, obtenido ${a}`);

const svg = (body, attrs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" ${attrs}>${body}</svg>`;

function neonFromText(text, h = 50, fontId = "neon-linea") {
  return textToNeonPaths(text, fontId, h);
}

/** Malla: bordes abiertos / no-manifold (aristas dirigidas sin su opuesta 1:1) y triángulos degenerados. */
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
  for (const [k, count] of directed) {
    const [a, b] = k.split(">");
    if (count !== 1 || directed.get(`${b}>${a}`) !== 1) openOrNonManifold++;
  }
  // Volumen con signo (divergencia): positivo = normales hacia afuera, coherente.
  let volume = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [pos[t], pos[t + 1], pos[t + 2], pos[t + 3], pos[t + 4], pos[t + 5], pos[t + 6], pos[t + 7], pos[t + 8]];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return { openOrNonManifold, degenerate, volume, triangles: pos.length / 9 };
}

/** Intersecciones (t ordenadas) de un rayo con la malla — Möller–Trumbore. */
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

/** Alturas z de los impactos de un rayo vertical (de arriba hacia abajo) en (x, y). */
function verticalHits(mesh, x, y) {
  return raycast(mesh, [x, y, 100], [0, 0, -1]).map((t) => 100 - t);
}

/** Coordenadas de los impactos de un rayo horizontal a lo largo de +X (desde x0) en (y, z). */
function xHits(mesh, x0, y, z) {
  return raycast(mesh, [x0, y, z], [1, 0, 0]).map((t) => x0 + t);
}

function yHits(mesh, x, y0, z) {
  return raycast(mesh, [x, y0, z], [0, 1, 0]).map((t) => y0 + t);
}

const line = (x1, y1, x2, y2) => ({ points: [[x1, y1], [x2, y2]], closed: false });
function circlePath(cx, cy, r, n = 96) {
  return { points: Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]), closed: true };
}
function region(groups) {
  return groups.reduce((sum, g) => sum + polyArea(g.outer) - g.holes.reduce((h, ring) => h + polyArea(ring), 0), 0);
}
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}
const boundsOf = (paths) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const [x, y] of p.points) [minX, maxX, minY, maxY] = [Math.min(minX, x), Math.max(maxX, x), Math.min(minY, y), Math.max(maxY, y)];
  return { minX, minY, maxX, maxY };
};

// --------------------------------------------------------------------------
// 34. Tests de paths (SVG)
// --------------------------------------------------------------------------

test("SVG: línea simple -> un path abierto de 2 puntos, largo = alto", () => {
  const { paths } = svgToNeonPaths(svg('<line x1="10" y1="10" x2="10" y2="110" stroke="black"/>'), 50);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].closed, false);
  assert.equal(paths[0].points.length, 2);
  approx(neonPathLength(paths[0]), 50, 1e-6);
  const b = boundsOf(paths);
  assert.deepEqual([b.minX, b.minY], [0, 0]);
});

test("SVG: polyline -> path abierto con todos sus puntos (Y hacia arriba)", () => {
  const { paths } = svgToNeonPaths(svg('<polyline points="0,100 50,0 100,100" fill="none" stroke="black"/>'), 100);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].closed, false);
  assert.equal(paths[0].points.length, 3);
  // El vértice del medio (SVG y=0, arriba) queda arriba: y = 100 mm.
  approx(paths[0].points[1][1], 100, 1e-6);
  approx(paths[0].points[0][1], 0, 1e-6);
});

test("SVG: path abierto vs path cerrado (Z) y polygon", () => {
  const open = svgToNeonPaths(svg('<path d="M0 0 L10 10 L20 0" fill="none" stroke="#000"/>'), 10).paths;
  assert.equal(open[0].closed, false);
  const closed = svgToNeonPaths(svg('<path d="M0 0 L10 10 L20 0 Z" fill="none" stroke="#000"/>'), 10).paths;
  assert.equal(closed[0].closed, true);
  assert.equal(closed[0].points.length, 3, "el cierre es implícito: no repite el primer punto");
  const poly = svgToNeonPaths(svg('<polygon points="0,0 10,0 10,10 0,10" fill="none" stroke="#000"/>'), 10).paths;
  assert.equal(poly[0].closed, true);
  approx(neonPathLength(poly[0]), 40, 1e-6);
});

test("SVG: Bézier se aplana con puntos suficientes y sin explotar", () => {
  const { paths } = svgToNeonPaths(svg('<path d="M0 100 C0 0 100 0 100 100" fill="none" stroke="#000"/>'), 100);
  const n = paths[0].points.length;
  assert.ok(n > 10 && n < 400, `puntos: ${n}`);
  const pts = paths[0].points;
  // La cúbica es simétrica respecto del eje vertical de su caja.
  const b = boundsOf(paths);
  const axis = (b.minX + b.maxX) / 2;
  for (const [x, y] of pts) {
    const near = Math.min(...pts.map(([px, py]) => Math.hypot(px - (2 * axis - x), py - y)));
    assert.ok(near < 0.6, `simetría de la curva (desvío ${near})`);
  }
});

test("SVG: circle -> path cerrado con perímetro ≈ 2πr", () => {
  const { paths } = svgToNeonPaths(svg('<circle cx="100" cy="100" r="50" fill="none" stroke="#000"/>'), 100);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].closed, true);
  const len = neonPathLength(paths[0]);
  approx(len / (2 * Math.PI * 50), 1, 0.002, "perímetro relativo");
  const ellipse = svgToNeonPaths(svg('<ellipse cx="100" cy="100" rx="60" ry="30" fill="none" stroke="#000"/>'), 30).paths;
  assert.equal(ellipse[0].closed, true);
  const b = boundsOf(ellipse);
  approx((b.maxX - b.minX) / (b.maxY - b.minY), 2, 0.01);
});

test("SVG: transforms anidados (translate/rotate/scale/matrix) se aplican en orden", () => {
  const nested = svgToNeonPaths(
    svg('<g transform="translate(10 20)"><g transform="rotate(90)"><line x1="0" y1="0" x2="10" y2="0" stroke="#000"/></g><line x1="0" y1="0" x2="0" y2="-10" stroke="#000"/></g>'),
    20,
  ).paths;
  assert.equal(nested.length, 2);
  // línea1: (10,20)->(10,30) SVG => (0,10)->(0,0) mm ; línea2: (10,20)->(10,10) SVG => (0,10)->(0,20) mm (escala 1: alto 20 -> 20 mm).
  assert.deepEqual(nested[0].points.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]), [[0, 10], [0, 0]]);
  assert.deepEqual(nested[1].points.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]), [[0, 10], [0, 20]]);

  const scaled = svgToNeonPaths(svg('<g transform="translate(5,5)"><g transform="scale(2)"><line x1="0" y1="0" x2="0" y2="10" stroke="#000"/></g></g>'), 20).paths;
  approx(neonPathLength(scaled[0]), 20, 1e-6);

  const matrix = svgToNeonPaths(svg('<line x1="0" y1="0" x2="10" y2="0" stroke="#000" transform="matrix(0 1 -1 0 0 0)"/>'), 10).paths;
  const b = boundsOf(matrix);
  approx(b.maxX - b.minX, 0, 1e-6, "la línea horizontal rotada 90° queda vertical");
  approx(b.maxY - b.minY, 10, 1e-6);

  const viaUse = svgToNeonPaths(svg('<defs><path id="a" d="M0 0 L0 10" stroke="#000" fill="none"/></defs><use href="#a" transform="translate(30 0)"/><use href="#a"/>'), 10).paths;
  assert.equal(viaUse.length, 2);
  approx(boundsOf(viaUse).maxX, 30, 1e-6);
});

test("SVG: múltiples trazos independientes conservan su posición relativa", () => {
  const { paths } = svgToNeonPaths(svg('<line x1="0" y1="0" x2="0" y2="100" stroke="#000"/><line x1="100" y1="0" x2="100" y2="100" stroke="#000"/><circle cx="50" cy="50" r="20" fill="none" stroke="#000"/>'), 100);
  assert.equal(paths.length, 3);
  approx(paths[1].points[0][0] - paths[0].points[0][0], 100, 1e-6);
  const c = boundsOf([paths[2]]);
  approx((c.minX + c.maxX) / 2, 50, 0.01);
  approx((c.minY + c.maxY) / 2, 50, 0.01);
});

test("SVG: trazo definido por CSS/herencia cuenta como recorrido; elementos rellenos mezclados se ignoran con aviso", () => {
  const css = svgToNeonPaths(svg('<style>.l{stroke:#f00;fill:none}</style><path class="l" d="M0 0 L0 100"/>'), 50);
  assert.equal(css.paths.length, 1);
  const inherited = svgToNeonPaths(svg('<g stroke="black" fill="none"><path d="M0 0 L0 100"/></g>'), 50);
  assert.equal(inherited.paths.length, 1);
  const mixed = svgToNeonPaths(svg('<path d="M0 0 L0 100" stroke="#000" fill="none"/><rect x="10" y="10" width="20" height="20" fill="black"/>'), 50);
  assert.equal(mixed.paths.length, 1);
  assert.ok(mixed.issues.some((i) => i.code === "IGNORED_FILLED_SHAPES"));
});

test("SVG malicioso: scripts, foreignObject, javascript:, recursos externos, entidades -> rechazado sin ejecutar nada", () => {
  const evil = [
    svg('<script>globalThis.__pwned = true</script><line x1="0" y1="0" x2="0" y2="10" stroke="#000"/>'),
    svg('<foreignObject><div>hola</div></foreignObject><line x1="0" y1="0" x2="0" y2="10" stroke="#000"/>'),
    svg('<a href="javascript:alert(1)"><line x1="0" y1="0" x2="0" y2="10" stroke="#000"/></a>'),
    svg('<image href="https://example.com/a.png"/><line x1="0" y1="0" x2="0" y2="10" stroke="#000"/>'),
    svg('<line x1="0" y1="0" x2="0" y2="10" stroke="url(https://evil.example/x)"/>'),
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="0" y2="10" stroke="#000"/></svg>',
  ];
  for (const content of evil) {
    const outcome = buildNeonPaths({ type: "svg", fileName: "x.svg", content }, 50);
    assert.equal(outcome.ok, false, content.slice(0, 60));
    assert.ok(outcome.message.length > 10);
  }
  assert.equal(globalThis.__pwned, undefined);
  // Los handlers on* nunca se leen: el SVG legítimo se importa igual.
  const withHandler = buildNeonPaths({ type: "svg", fileName: "x.svg", content: svg('<line x1="0" y1="0" x2="0" y2="10" stroke="#000" onclick="alert(1)"/>', 'onload="alert(1)"') }, 50);
  assert.equal(withHandler.ok, true);
  // clip-path/mask/filter siguen rechazados como "elementos no compatibles" (el <text> ahora se convierte: ver maker-neon-svg-fonts).
  const clipped = buildNeonPaths({ type: "svg", fileName: "x.svg", content: svg('<line x1="0" y1="0" x2="0" y2="10" stroke="#000" clip-path="url(#c)"/>') }, 50);
  assert.equal(clipped.ok, false);
  assert.match(clipped.message, /elementos no compatibles/);
});

test("SVG solo con formas rellenas -> error claro (sin geometría incorrecta)", () => {
  const outcome = buildNeonPaths({ type: "svg", fileName: "logo.svg", content: svg('<path d="M10 10 L90 10 L90 90 L10 90 Z" fill="black"/><circle cx="50" cy="50" r="20"/>') }, 50);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, SVG_FILL_ONLY_MESSAGE);
  assert.match(outcome.message, /formas rellenas/);
  assert.throws(() => svgToNeonPaths(svg('<rect width="10" height="10" fill="red"/>'), 50), /formas rellenas/);
  const empty = buildNeonPaths({ type: "svg", fileName: "vacio.svg", content: svg("") }, 50);
  assert.equal(empty.ok, false);
  const flat = buildNeonPaths({ type: "svg", fileName: "h.svg", content: svg('<line x1="0" y1="5" x2="100" y2="5" stroke="#000"/>') }, 50);
  assert.equal(flat.ok, false, "una línea horizontal no tiene alto para escalar");
});

// --------------------------------------------------------------------------
// 35. Tests de fuente
// --------------------------------------------------------------------------

test("Fuente Neon: I, L, S, O, A — paths esperados, escala y cierre", () => {
  const H = 100;
  const I = neonFromText("I", H).paths;
  assert.equal(I.length, 1);
  assert.equal(I[0].closed, false);
  approx(neonPathLength(I[0]), H, 1e-6, "I = altura de mayúscula");

  const L = neonFromText("L", H).paths;
  assert.equal(L.length, 1);
  assert.equal(L[0].points.length, 3);
  const lb = boundsOf(L);
  approx(lb.maxY - lb.minY, H, 1e-6);
  approx(lb.maxX - lb.minX, 45, 1e-6, "ancho de L a escala 1");

  const S = neonFromText("S", H).paths;
  assert.equal(S.length, 1);
  assert.equal(S[0].closed, false);
  assert.ok(S[0].points.length > 20);

  const O = neonFromText("O", H).paths;
  assert.equal(O.length, 1);
  assert.equal(O[0].closed, true);
  const ob = boundsOf(O);
  approx(ob.maxY - ob.minY, H, 0.1);
  approx(ob.maxX - ob.minX, 60, 0.1);

  const A = neonFromText("A", H).paths;
  assert.equal(A.length, 2, "A = dos lados + travesaño");
  assert.equal(A.filter((p) => p.points.length === 3).length, 1);
  assert.equal(A.filter((p) => p.points.length === 2).length, 1);
  // El travesaño (2 puntos) queda entre la base y el ápice.
  const bar = A.find((p) => p.points.length === 2);
  assert.ok(bar.points[0][1] > 0 && bar.points[0][1] < H);
  approx(bar.points[0][1], bar.points[1][1], 1e-9);
});

test("Fuente Neon: escala proporcional al alto y STAMPA con posiciones relativas", () => {
  const a = neonFromText("STAMPA", 100).paths;
  const b = neonFromText("STAMPA", 200).paths;
  assert.equal(a.length, 9, "S1 T2 A2 M1 P1 A2");
  assert.equal(b.length, 9);
  approx(totalNeonLength(b) / totalNeonLength(a), 2, 0.002);
  // Grupos por letra en orden: [1,2,2,1,1,2]; cada letra queda a la derecha de la anterior sin solaparse.
  const sizes = [1, 2, 2, 1, 1, 2];
  let idx = 0;
  let prevMax = -Infinity;
  for (const n of sizes) {
    const group = a.slice(idx, idx + n);
    idx += n;
    const gb = boundsOf(group);
    assert.ok(gb.minX > prevMax, `letra a la derecha de la anterior (${gb.minX} > ${prevMax})`);
    prevMax = gb.maxX;
  }
  const ab = boundsOf(a);
  approx(ab.maxY - ab.minY, 100, 0.2);
  assert.equal(ab.minX, 0);
});

test("Fuente Neon: minúsculas = mayúsculas, espacios separan, tildes/Ñ suman un trazo, chars raros avisan", () => {
  const lower = neonFromText("stampa", 100).paths;
  const upper = neonFromText("STAMPA", 100).paths;
  assert.equal(JSON.stringify(lower), JSON.stringify(upper));
  const spaced = neonFromText("A A", 100).paths;
  assert.equal(spaced.length, 4);
  const sb = boundsOf(spaced.slice(0, 2)), sb2 = boundsOf(spaced.slice(2));
  assert.ok(sb2.minX - sb.maxX > 30 + 55 - 1e-6, "el espacio agrega SPACE_ADVANCE");
  assert.equal(neonFromText("Ñ", 100).paths.length, neonFromText("N", 100).paths.length + 1);
  assert.equal(neonFromText("É", 100).paths.length, neonFromText("E", 100).paths.length + 1);
  const odd = textToNeonPaths("A§B", "neon-linea", 100);
  assert.ok(odd.issues.some((i) => i.code === "UNSUPPORTED_CHARS" && i.message.includes("§")));
  assert.equal(odd.paths.length, neonFromText("AB", 100).paths.length);
  assert.throws(() => textToNeonPaths("   ", "neon-linea", 100), /texto/i);
  assert.throws(() => textToNeonPaths("§§", "neon-linea", 100), /dibujables/);
});

test("Fuente Neon: la fuente inclinada corre el techo de cada trazo; hay ≥ 2 fuentes registradas", () => {
  assert.ok(NEON_FONTS.length >= 2);
  const straight = neonFromText("I", 100, "neon-linea").paths[0].points;
  const slanted = neonFromText("I", 100, "neon-cursiva").paths[0].points;
  approx(slanted[0][0], straight[0][0], 1e-6);
  approx(slanted[1][0] - straight[1][0], 100 * Math.tan((12 * Math.PI) / 180), 1e-6);
});

// --------------------------------------------------------------------------
// 36. Canal U: caso simple
// --------------------------------------------------------------------------

test("Convención de holgura: canal interior = ancho + holgura TOTAL; exterior = interior + 2 × pared", () => {
  approx(channelInnerWidth(P), 6.3, 1e-9);
  approx(channelOuterWidth(P), 8.7, 1e-9);
  approx(channelInnerWidth({ neonWidthMm: 8, clearanceMm: 0.5 }), 8.5, 1e-9);
});

const STRAIGHT = [line(0, 0, 100, 0)];
const straight = createChannelGeometry(STRAIGHT, P);

test("Canal recto: anchos interior/exterior, piso 1.6, altura 9.6, paredes 1.2", () => {
  assert.deepEqual(straight.errors, []);
  assert.deepEqual(straight.warnings, []);
  const b = meshBounds(straight.mesh.positions);
  approx(b.minZ, 0, 1e-6);
  approx(b.maxZ, TOP, 1e-4, "altura total");
  approx(b.maxY - b.minY, OUTER, 0.01, "ancho exterior");
  approx(b.maxX - b.minX, 100 + OUTER, 0.01, "largo con tapas redondas");

  // Corte transversal en x=50: 4 caras verticales -> exterior, interior, interior, exterior.
  const ys = yHits(straight.mesh, 50, -10, 5);
  assert.equal(ys.length, 4);
  approx(ys[1] - ys[0], 1.2, 0.01, "pared izquierda");
  approx(ys[2] - ys[1], INNER, 0.01, "canal interior");
  approx(ys[3] - ys[2], 1.2, 0.01, "pared derecha");
  approx(ys[3] - ys[0], OUTER, 0.01);

  // Sobre la cavidad: piso a 1.6 y nada por encima (abierta arriba); sobre la pared: base + corona a 9.6.
  const cavity = verticalHits(straight.mesh, 50, 0);
  assert.equal(cavity.length, 2);
  approx(cavity[0], 1.6, 1e-3, "piso");
  approx(cavity[1], 0, 1e-3);
  const wall = verticalHits(straight.mesh, 50, INNER / 2 + 0.6);
  assert.equal(wall.length, 2);
  approx(wall[0], TOP, 1e-3, "corona de la pared");
  approx(wall[1], 0, 1e-3);
  // Debajo de la cavidad nunca hay cara interna extra entre piso y base.
  assert.equal(verticalHits(straight.mesh, 50, -OUTER / 2 - 0.5).length, 0);
});

test("Canal recto: malla watertight, manifold, sin triángulos degenerados, volumen positivo consistente", () => {
  const audit = meshAudit(straight.mesh);
  assert.equal(audit.openOrNonManifold, 0);
  assert.equal(audit.degenerate, 0);
  assert.ok(audit.volume > 0, "normales hacia afuera");
  // Volumen = piso + paredes: área exterior*1.6 + área de pared * 8. Área de pared ≈ 2*1.2*100 + π(4.35²-3.15²) [tapas].
  const wallArea = 2 * 1.2 * 100 + Math.PI * (4.35 ** 2 - 3.15 ** 2);
  const outerArea = OUTER * 100 + Math.PI * 4.35 ** 2;
  approx(audit.volume / (outerArea * 1.6 + wallArea * 8), 1, 0.01, "volumen esperado");
  // Las caras hacia arriba a z=1.6 (piso de la cavidad) y las del fondo hacia abajo existen; nada por encima del piso salvo la corona.
  const n = straight.mesh.normals;
  const p = straight.mesh.positions;
  let down = 0, up16 = 0, upTop = 0;
  for (let t = 0; t < p.length; t += 9) {
    if (n[t + 2] < -0.99 && Math.abs(p[t + 2]) < 1e-4) down++;
    if (n[t + 2] > 0.99 && Math.abs(p[t + 2] - 1.6) < 1e-4) up16++;
    if (n[t + 2] > 0.99 && Math.abs(p[t + 2] - TOP) < 1e-4) upTop++;
  }
  assert.ok(down > 0 && up16 > 0 && upTop > 0);
});

// --------------------------------------------------------------------------
// 37. Open path: tapas redondas
// --------------------------------------------------------------------------

test("Path abierto: tapas redondas en ambos extremos (no cuadradas), cavidad cerrada por la pared de la tapa", () => {
  const m = straight.mesh;
  // Rayo horizontal por el eje: exterior de la tapa, cavidad, y lo mismo en el otro extremo.
  const xs = xHits(m, -20, 0, 5);
  assert.equal(xs.length, 4);
  approx(xs[0], -4.35, 0.02, "tapa izquierda (exterior)");
  approx(xs[1], -3.15, 0.02, "cavidad izquierda");
  approx(xs[2], 103.15, 0.02);
  approx(xs[3], 104.35, 0.02, "tapa derecha (exterior)");
  // Esquina de una tapa cuadrada: un punto a (-4.2, 2.5) (r=4.9 > 4.35) NO tiene material.
  assert.equal(verticalHits(m, -4.2, 2.5).length, 0);
  // Y un punto de la tapa redonda (-3.6, 1.5) (r=3.9, entre 3.15 y 4.35) sí es pared.
  const inCap = verticalHits(m, -3.6, 1.5);
  assert.equal(inCap.length, 2);
  approx(inCap[0], TOP, 1e-3);
  // La cavidad detrás de la tapa (-2.5, 0): solo piso.
  const inCavity = verticalHits(m, -2.5, 0);
  assert.equal(inCavity.length, 2);
  approx(inCavity[0], 1.6, 1e-3);
});

// --------------------------------------------------------------------------
// 38. Closed path
// --------------------------------------------------------------------------

test("Path cerrado (círculo): canal continuo sin tapas, centro libre, manifold", () => {
  const R = 30;
  const ring = createChannelGeometry([circlePath(0, 0, R, 180)], P);
  assert.deepEqual(ring.errors, []);
  const audit = meshAudit(ring.mesh);
  assert.equal(audit.openOrNonManifold, 0);
  assert.equal(audit.degenerate, 0);
  assert.ok(audit.volume > 0);
  // Anillo: huella exterior y cavidad son anillos (1 grupo con 1 hueco cada uno).
  assert.equal(ring.outerGroups.length, 1);
  assert.equal(ring.outerGroups[0].holes.length, 1);
  assert.equal(ring.cavityGroups.length, 1);
  assert.equal(ring.cavityGroups[0].holes.length, 1);
  // El centro del lazo es aire: ningún triángulo.
  assert.equal(verticalHits(ring.mesh, 0, 0).length, 0);
  // Corte radial en y=0, z=5: 8 caras alternando pared/cavidad/pared alrededor del anillo (paredes interior y exterior).
  const xs = xHits(ring.mesh, -R - 20, 0, 5);
  assert.equal(xs.length, 8);
  approx(xs[0], -R - 4.35, 0.02);
  approx(xs[1], -R - 3.15, 0.02);
  approx(xs[2], -R + 3.15, 0.02);
  approx(xs[3], -R + 4.35, 0.02);
  approx(xs[7], R + 4.35, 0.02);
  // La cavidad del anillo es abierta arriba en todo el perímetro (varios ángulos).
  for (const deg of [0, 45, 90, 135, 200, 300]) {
    const a = (deg * Math.PI) / 180;
    const hits = verticalHits(ring.mesh, R * Math.cos(a), R * Math.sin(a));
    assert.equal(hits.length, 2, `ángulo ${deg}`);
    approx(hits[0], 1.6, 1e-3);
  }
  // La "O" de la fuente también es un lazo cerrado válido.
  const oGeo = createNeonGeometry(neonFromText("O", 100).paths, { ...P, designHeightMm: 100 });
  assert.deepEqual(oGeo.errors, []);
  assert.equal(meshAudit(oGeo.geometry.parts[0].mesh).openOrNonManifold, 0);
});

// --------------------------------------------------------------------------
// 39. Curvas (S)
// --------------------------------------------------------------------------

test("Curva S: las paredes siguen la curva, la cavidad queda abierta y la malla es manifold", () => {
  const paths = neonFromText("S", 100).paths;
  const ch = createChannelGeometry(paths, P);
  assert.deepEqual(ch.errors, []);
  assert.deepEqual(ch.warnings, []);
  const audit = meshAudit(ch.mesh);
  assert.equal(audit.openOrNonManifold, 0);
  assert.equal(audit.degenerate, 0);
  assert.ok(audit.volume > 0);

  const pts = paths[0].points;
  const off = INNER / 2 + 0.6; // centro de la pared
  let checked = 0;
  for (let i = 4; i < pts.length - 4; i += 5) {
    const [x, y] = pts[i];
    const [px, py] = pts[i - 2], [nx, ny] = pts[i + 2];
    const tl = Math.hypot(nx - px, ny - py);
    const nrm = [-(ny - py) / tl, (nx - px) / tl];
    const center = verticalHits(ch.mesh, x, y);
    assert.equal(center.length, 2, `centro abierto en i=${i}`);
    approx(center[0], 1.6, 1e-3);
    for (const s of [1, -1]) {
      const w = verticalHits(ch.mesh, x + s * nrm[0] * off, y + s * nrm[1] * off);
      assert.equal(w.length, 2, `pared en i=${i}`);
      approx(w[0], TOP, 1e-3);
    }
    checked++;
  }
  assert.ok(checked > 10);
  // Huella de pared ≈ 2 × pared × largo + tapas (sin auto-solapes: el área coincide con la teórica).
  const L = totalNeonLength(paths);
  const expected = 2 * 1.2 * L + Math.PI * (4.35 ** 2 - 3.15 ** 2);
  approx(region(ch.wallGroups) / expected, 1, 0.03, "área de pared");
});

// --------------------------------------------------------------------------
// 18/19. Múltiples paths, solapes y autointersecciones
// --------------------------------------------------------------------------

test("Dos canales que se cruzan se funden: una sola cavidad, sin paredes internas, manifold", () => {
  const ch = createChannelGeometry([line(0, 0, 60, 60), line(0, 60, 60, 0)], P);
  assert.deepEqual(ch.errors, []);
  assert.equal(ch.cavityGroups.length, 1);
  assert.equal(ch.outerGroups.length, 1);
  const audit = meshAudit(ch.mesh);
  assert.equal(audit.openOrNonManifold, 0);
  assert.equal(audit.degenerate, 0);
  // En el cruce (30,30) la cavidad está abierta (no hay pared de un canal atravesando al otro).
  const hits = verticalHits(ch.mesh, 30, 30);
  assert.equal(hits.length, 2);
  approx(hits[0], 1.6, 1e-3);
});

test("Path que se cruza a sí mismo (lazo en 8): se une correctamente", () => {
  const eight = { points: [[0, 0], [60, 60], [60, 0], [0, 60]], closed: false };
  const ch = createChannelGeometry([eight], P);
  assert.deepEqual(ch.errors, []);
  const audit = meshAudit(ch.mesh);
  assert.equal(audit.openOrNonManifold, 0);
  assert.equal(audit.degenerate, 0);
  assert.equal(ch.cavityGroups.length, 1);
  assert.equal(verticalHits(ch.mesh, 30, 30).length, 2);
});

test("Varios strokes separados mantienen posiciones relativas (un solo STL con todos)", () => {
  const g = createNeonGeometry(neonFromText("HI", 60).paths, { ...P, designHeightMm: 60 });
  assert.deepEqual(g.errors, []);
  assert.equal(g.geometry.parts.length, 1, "una sola pieza física en el preview/STL");
  const audit = meshAudit(g.geometry.parts[0].mesh);
  assert.equal(audit.openOrNonManifold, 0);
  assert.ok(g.geometry.boundingBox.width > 60);
  const gaps = createChannelGeometry([line(0, 0, 0, 40), line(100, 0, 100, 40)], P);
  assert.equal(gaps.outerGroups.length, 2);
  assert.equal(gaps.cavityGroups.length, 2);
  approx(meshBounds(gaps.mesh.positions).maxX - meshBounds(gaps.mesh.positions).minX, 100 + OUTER, 0.02);
});

test("Paths demasiado cercanos: pared compartida fina -> warning, sin geometría corrupta", () => {
  const near = createChannelGeometry([line(0, 0, 80, 0), line(0, 6.8, 80, 6.8)], P);
  assert.deepEqual(near.errors, []);
  assert.ok(near.warnings.some((w) => w.code === "THIN_WALL"), "pared compartida de 0.5 mm");
  assert.equal(meshAudit(near.mesh).openOrNonManifold, 0);
  const ok = createChannelGeometry([line(0, 0, 80, 0), line(0, 12, 80, 12)], P);
  assert.equal(ok.warnings.filter((w) => w.code === "THIN_WALL").length, 0);
  // Canales tan cercanos que se funden (corredores solapados): válido, una sola cavidad.
  const fused = createChannelGeometry([line(0, 0, 80, 0), line(0, 4, 80, 4)], P);
  assert.deepEqual(fused.errors, []);
  assert.equal(fused.cavityGroups.length, 1);
  assert.equal(meshAudit(fused.mesh).openOrNonManifold, 0);
  // Corredores que se tocan exactamente en un borde: sigue sin romper.
  const touching = createChannelGeometry([line(0, 0, 80, 0), line(0, 6.3, 80, 6.3)], P);
  assert.equal(meshAudit(touching.mesh).openOrNonManifold, 0);
});

test("Textos completos (STAMPA, 8B, HOLA 2024): geometría manifold sin errores", () => {
  for (const [text, h] of [["STAMPA", 80], ["8B", 60], ["HOLA 2024", 60], ["QGRJK", 60]]) {
    const g = createNeonGeometry(neonFromText(text, h).paths, { ...P, designHeightMm: h });
    assert.deepEqual(g.errors, [], text);
    const audit = meshAudit(g.geometry.parts[0].mesh);
    assert.equal(audit.openOrNonManifold, 0, text);
    assert.equal(audit.degenerate, 0, text);
    assert.ok(audit.volume > 0, text);
    assert.ok(!g.warnings.some((w) => w.code === "THIN_WALL"), `${text}: sin falsos THIN_WALL`);
  }
});

test("Canal colapsado / sin paths -> error controlado", () => {
  const none = createChannelGeometry([], P);
  assert.equal(none.errors[0].code, "NO_PATHS");
  assert.equal(none.mesh.triangleCount, 0);
  const g = createNeonGeometry([], P);
  assert.equal(g.geometry, null);
  assert.equal(g.errors[0].code, "NO_PATHS");
});

// --------------------------------------------------------------------------
// 40. Métricas
// --------------------------------------------------------------------------

test("Longitud: línea 100 mm, lazo cerrado (incluye cierre), +5 %, suma de múltiples paths", () => {
  approx(neonPathLength(line(0, 0, 100, 0)), 100, 1e-9);
  approx(neonPathLength({ points: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true }), 400, 1e-9);
  approx(neonPathLength({ points: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: false }), 300, 1e-9);
  approx(neonPathLength(circlePath(0, 0, 50, 720)) / (2 * Math.PI * 50), 1, 1e-4);
  approx(recommendedNeonLength(2430), 2551.5, 1e-9);
  approx(totalNeonLength([line(0, 0, 100, 0), circlePath(0, 0, 10, 360)]), 100 + 2 * Math.PI * 10, 0.01);
  const g = createNeonGeometry([line(0, 0, 100, 0)], P);
  approx(g.metrics.lengthMm, 100, 1e-6);
  approx(g.metrics.recommendedLengthMm, 105, 1e-6);
  approx(g.metrics.innerWidthMm, 6.3, 1e-9);
  approx(g.metrics.outerWidthMm, 8.7, 1e-9);
  approx(g.metrics.printedSize.width, 108.7, 0.02);
  approx(g.metrics.printedSize.depth, 9.6, 1e-4);
});

test("Longitud: se mide sobre el recorrido ANTES del offset (no cambia con el ancho del Neon)", () => {
  const paths = neonFromText("STAMPA", 100).paths;
  const a = createNeonGeometry(paths, { ...P, designHeightMm: 100, neonWidthMm: 4 });
  const b = createNeonGeometry(paths, { ...P, designHeightMm: 100, neonWidthMm: 10 });
  approx(a.metrics.lengthMm, b.metrics.lengthMm, 1e-9);
});

test("Curvatura: círculo r=30 mide ≈30; esquina viva dispara warning con radio detectado; recta no avisa", () => {
  const circle = analyzeCurvature([circlePath(0, 0, 30, 360)], 10);
  approx(circle.minRadiusMm / 30, 1, 0.03);
  assert.equal(circle.belowMinimum, false);
  assert.equal(analyzeCurvature([circlePath(0, 0, 30, 360)], 40).belowMinimum, true, "30 < 0.85×40");
  const corner = analyzeCurvature([{ points: [[0, 0], [50, 0], [50, 50]], closed: false }], 10);
  assert.equal(corner.belowMinimum, true);
  assert.ok(corner.minRadiusMm < 8.5);
  const flat = analyzeCurvature([line(0, 0, 100, 0)], 10);
  assert.deepEqual(flat, { minRadiusMm: null, belowMinimum: false });

  const g = createNeonGeometry([{ points: [[0, 0], [50, 0], [50, 50]], closed: false }], P);
  const w = g.warnings.find((x) => x.code === "MIN_BEND_RADIUS");
  assert.ok(w);
  assert.match(w.message, /curvas más cerradas que el radio mínimo configurado del Neon/);
  assert.match(w.message, /Radio detectado ≈ [\d.]+mm; mínimo configurado 10mm/);
  assert.notEqual(g.geometry, null, "el warning no bloquea la exportación");
  const smooth = createNeonGeometry([circlePath(0, 0, 40, 200)], P);
  assert.equal(smooth.warnings.filter((x) => x.code === "MIN_BEND_RADIUS").length, 0);
});

test("Validación de parámetros: defaults válidos, fuera de rango se rechaza", () => {
  assert.deepEqual(validateNeonParams(P), []);
  const bad = validateNeonParams({ ...P, neonWidthMm: 0, wallThicknessMm: 0.1, designHeightMm: NaN });
  assert.deepEqual(bad.map((e) => e.field).sort(), ["designHeightMm", "neonWidthMm", "wallThicknessMm"]);
  assert.equal(P.designHeightMm, 200);
  assert.equal(P.neonWidthMm, 6);
  assert.equal(P.clearanceMm, 0.3);
  assert.equal(P.wallHeightMm, 8);
  assert.equal(P.wallThicknessMm, 1.2);
  assert.equal(P.floorThicknessMm, 1.6);
  assert.equal(P.minBendRadiusMm, 10);
});

// --------------------------------------------------------------------------
// 41. Print bed
// --------------------------------------------------------------------------

test("Vista Cama: minZ=0, piso contra la cama, U hacia arriba, dentro de 256×256", () => {
  const g = createNeonGeometry(neonFromText("OK", 60).paths, { ...P, designHeightMm: 60 });
  const mesh = g.geometry.parts[0].mesh;
  const b = meshBounds(mesh.positions);
  approx(b.minZ, 0, 1e-6);
  // Las tapas redondas se aproximan con arcTolerance 0.02 mm: el borde real queda a <= 0.02 mm del ideal.
  approx(b.minX, 0, 0.03);
  approx(b.minY, 0, 0.03);
  const profile = getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID);
  assert.equal(profile.widthMm, 256);
  const items = collectBedItems(g.geometry);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "body");
  approx(items[0].heightMm, TOP, 1e-4);
  const layout = computeBedLayout(items, profile);
  assert.equal(layout.oversize.length, 0);
  assert.equal(layout.tooTall.length, 0);
  assert.equal(layout.plates.length, 1);
  // Aplicar la matriz de colocación: la malla queda en Z>=0, apoyada, dentro de la cama, sin volcarse.
  const placement = layout.plates[0].placements[0];
  const m = placementMatrix(items[0], placement);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const pos = mesh.positions;
  for (let i = 0; i < pos.length; i += 3) {
    const x = m[0] * pos[i] + m[4] * pos[i + 1] + m[8] * pos[i + 2] + m[12];
    const y = m[1] * pos[i] + m[5] * pos[i + 1] + m[9] * pos[i + 2] + m[13];
    const z = m[2] * pos[i] + m[6] * pos[i + 1] + m[10] * pos[i + 2] + m[14];
    [minX, maxX, minY, maxY, minZ, maxZ] = [Math.min(minX, x), Math.max(maxX, x), Math.min(minY, y), Math.max(maxY, y), Math.min(minZ, z), Math.max(maxZ, z)];
  }
  approx(minZ, 0, 1e-4);
  approx(maxZ, TOP, 1e-3, "sigue con el piso abajo y la U hacia arriba");
  assert.ok(minX >= -1e-6 && minY >= -1e-6 && maxX <= 256 + 1e-6 && maxY <= 256 + 1e-6);
  // Piso hacia abajo: cara en z=0 con normal -Z; cavidad en z=1.6 con normal +Z.
  assert.equal(items[0].kind, "body");
  const n = mesh.normals;
  let downAtZero = 0;
  for (let t = 0; t < pos.length; t += 9) if (n[t + 2] < -0.99 && Math.abs(pos[t + 2]) < 1e-4) downAtZero++;
  assert.ok(downAtZero > 0);
});

test("Vista Cama: un cartel Neon de 200 mm de alto excede la cama y se detecta como oversize", () => {
  const g = createNeonGeometry(neonFromText("STAMPA", 200).paths, P);
  const layout = computeBedLayout(collectBedItems(g.geometry), getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID));
  assert.equal(layout.oversize.length, 1);
  assert.ok(g.geometry.boundingBox.width > 256);
});

// --------------------------------------------------------------------------
// 28. Exportación
// --------------------------------------------------------------------------

test("STL: una sola pieza -> un archivo <nombre>.stl con todos los triángulos", () => {
  const g = createNeonGeometry(neonFromText("HI", 60).paths, { ...P, designHeightMm: 60 });
  const entries = partFileEntries(g.geometry.parts, "neon-hi");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fileName, "neon-hi.stl");
  const blob = buildSTLBlob(entries[0].mesh);
  assert.equal(blob.size, 84 + 50 * g.geometry.triangleCount, "STL binario: 84 + 50 bytes por triángulo");
});

test("Pipeline completo desde SVG de líneas: buildNeonPaths -> createNeonGeometry", () => {
  const content = svg('<path d="M20 100 C20 20 180 20 180 100" fill="none" stroke="#000" stroke-width="2"/><circle cx="100" cy="150" r="30" fill="none" stroke="#000"/>');
  const outcome = buildNeonPaths({ type: "svg", fileName: "arco.svg", content }, 100);
  assert.equal(outcome.ok, true);
  const g = createNeonGeometry(outcome.result.paths, { ...P, designHeightMm: 100 });
  assert.deepEqual(g.errors, []);
  assert.equal(meshAudit(g.geometry.parts[0].mesh).openOrNonManifold, 0);
  assert.ok(g.metrics.lengthMm > 150 && g.metrics.lengthMm < 600, `largo ${g.metrics.lengthMm}`);
});
