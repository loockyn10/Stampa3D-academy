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


const UPNG = nodeRequire("upng-js");

const R = "lib/maker/neon/raster/";
const { rasterToNeonPaths } = load(`${R}rasterToNeonPaths.ts`);
const { decodeRasterImage, sniffRasterKind } = load(`${R}decodeRasterImage.ts`);
const { otsuThreshold, luminanceField, alphaField, hasSignificantAlpha, foregroundMask, maskBoundingBox, resampleField, gaussianBlur, labelComponents, removeSmallFeatures, cropField } = load(`${R}imageProcessing.ts`);
const { skeletonize } = load(`${R}skeletonize.ts`);
const { buildSkeletonGraph, contractDegreeTwo, summarizeGraph, bridgeCloseEndpoints, polylineLength } = load(`${R}skeletonGraph.ts`);
const { pruneSkeleton } = load(`${R}pruneSkeleton.ts`);
const { rdp, simplifyRawPath } = load(`${R}simplifyNeonPaths.ts`);
const { smoothRawPath, resamplePolyline } = load(`${R}smoothNeonPaths.ts`);
const { DEFAULT_RASTER_SETTINGS } = load(`${R}types.ts`);
const { buildNeonPaths, createNeonGeometry } = load("lib/maker/neon/createNeonGeometry.ts");
const { neonPathLength, totalNeonLength } = load("lib/maker/neon/metrics/pathLength.ts");
const { DEFAULT_NEON_PARAMS } = load("lib/maker/neon/defaults.ts");
const { buildSTLBlob } = load("lib/maker/exporters/exportSTL.ts");
const { collectBedItems, computeBedLayout } = load("lib/maker/printBed/bedLayout.ts");
const { getPrinterProfile, DEFAULT_PRINTER_PROFILE_ID } = load("lib/maker/printBed/printerProfiles.ts");

const P = DEFAULT_NEON_PARAMS;
const S = { ...DEFAULT_RASTER_SETTINGS };
const approx = (a, b, tol, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} esperado ${b} ± ${tol}, obtenido ${a}`);

// --------------------------------------------------------------------------
// Fixtures raster programáticos
// --------------------------------------------------------------------------

/** Imagen RGBA w×h; `fn(x, y)` devuelve true (tinta) / false (fondo) o [r,g,b,a]. */
function makeImage(w, h, fn, { ink = [0, 0, 0, 255], bg = [255, 255, 255, 255] } = {}) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      const px = v === true ? ink : v === false ? bg : v;
      data.set(px, (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ring = (cx, cy, ro, ri) => (x, y) => {
  const d = (x - cx) ** 2 + (y - cy) ** 2;
  return d <= ro * ro && d >= ri * ri;
};
const thickLine = (x0, y0, x1, y1, half) => (x, y) => {
  const dx = x1 - x0, dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) <= half;
};
const union = (...fns) => (x, y) => fns.some((f) => f(x, y));
const pngBytes = (img) => new Uint8Array(UPNG.encode([img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength)], img.width, img.height, 0));
const convert = (img, settings = {}, height = 40) => rasterToNeonPaths(img, { ...S, ...settings }, height);
const closedCount = (r) => r.paths.filter((p) => p.closed).length;
const bboxOf = (paths) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const [x, y] of p.points) [minX, maxX, minY, maxY] = [Math.min(minX, x), Math.max(maxX, x), Math.min(minY, y), Math.max(maxY, y)];
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
};

function meshAudit(mesh) {
  const pos = mesh.positions;
  const key = (i) => `${pos[i].toFixed(4)},${pos[i + 1].toFixed(4)},${pos[i + 2].toFixed(4)}`;
  const directed = new Map();
  let degenerate = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const ux = pos[t + 3] - pos[t], uy = pos[t + 4] - pos[t + 1], uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t], vy = pos[t + 7] - pos[t + 1], vz = pos[t + 8] - pos[t + 2];
    if (0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-9) degenerate++;
    for (let e = 0; e < 3; e++) {
      const k = `${key(t + e * 3)}>${key(t + ((e + 1) % 3) * 3)}`;
      directed.set(k, (directed.get(k) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const [k, c] of directed) {
    const [a, b] = k.split(">");
    if (c !== 1 || directed.get(`${b}>${a}`) !== 1) bad++;
  }
  return { bad, degenerate };
}

// --------------------------------------------------------------------------
// Procesamiento de imagen
// --------------------------------------------------------------------------

test("Otsu: bimodal separa las dos clases; una sola clase no rompe; luminancia Rec.709 y composición sobre blanco", () => {
  const f = new Uint8Array(1000);
  for (let i = 0; i < f.length; i++) f[i] = i < 400 ? 30 : 220;
  const t = otsuThreshold(f);
  assert.ok(t >= 30 && t < 220, `umbral ${t}`);
  assert.equal(otsuThreshold(new Uint8Array(50).fill(200)), 127);
  const img = { width: 3, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0]) };
  const lum = luminanceField(img);
  assert.deepEqual([...lum], [Math.round(0.2126 * 255), Math.round(0.7152 * 255), 255], "rojo, verde, y un píxel transparente = blanco");
  assert.equal(hasSignificantAlpha(img), true);
  assert.equal(hasSignificantAlpha(makeImage(4, 4, () => true)), false);
  assert.deepEqual([...alphaField(img)], [255, 255, 0]);
});

test("Máscara: alpha, luminosidad y invertir (la invierte la MÁSCARA)", () => {
  const f = new Uint8Array([0, 100, 200, 255]);
  assert.deepEqual([...foregroundMask(f, 128, "luminance", false)], [1, 1, 0, 0]);
  assert.deepEqual([...foregroundMask(f, 128, "luminance", true)], [0, 0, 1, 1]);
  assert.deepEqual([...foregroundMask(f, 128, "alpha", false)], [0, 0, 1, 1]);
  assert.deepEqual([...foregroundMask(f, 128, "alpha", true)], [1, 1, 0, 0]);
  assert.deepEqual(maskBoundingBox(new Uint8Array([0, 0, 0, 0, 1, 1, 0, 0, 0]), 3, 3), { x0: 1, y0: 1, x1: 3, y1: 2 });
  assert.equal(maskBoundingBox(new Uint8Array(9), 3, 3), null);
});

test("Remuestreo (área al reducir, bilinear al ampliar), blur, componentes, islas/agujeros y recorte con margen", () => {
  const f = new Uint8Array(16).fill(100);
  assert.deepEqual([...resampleField(f, 4, 4, 2, 2)], [100, 100, 100, 100], "promedio de un campo constante");
  assert.equal(resampleField(f, 4, 4, 8, 8).every((v) => v === 100), true);
  const half = Uint8Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? 0 : 200));
  assert.deepEqual([...resampleField(half, 4, 4, 2, 2)], [0, 200, 0, 200]);
  const blurred = gaussianBlur(Uint8Array.from({ length: 25 }, (_, i) => (i === 12 ? 255 : 0)), 5, 5, 1);
  assert.ok(blurred[12] < 255 && blurred[12] > blurred[11] && blurred[11] > 0);
  const m = new Uint8Array(100);
  for (const i of [11, 12, 21, 22, 77]) m[i] = 1; // blob de 4 + isla de 1
  const lab = labelComponents(m, 10, 10, 1);
  assert.equal(lab.count, 2);
  const cleaned = removeSmallFeatures(m, 10, 10, 3, 0);
  assert.equal(cleaned.mask[77], 0);
  assert.equal(cleaned.mask[11], 1);
  assert.equal(cleaned.islandsRemoved, 1);
  const ringMask = makeImage(20, 20, (x, y) => ring(10, 10, 8, 2)(x, y)).data; // solo para tamaño
  void ringMask;
  const withHole = new Uint8Array(100).fill(1);
  withHole[44] = 0; // agujero de 1 px, interno
  assert.equal(removeSmallFeatures(withHole, 10, 10, 1, 4).mask[44], 1, "agujero diminuto rellenado");
  const crop = cropField(new Uint8Array([9, 9, 9, 9, 5, 9, 9, 9, 9]), 3, 3, { x0: 1, y0: 1, x1: 2, y1: 2 }, 1, 255);
  assert.deepEqual([crop.width, crop.height], [3, 3]);
  assert.equal(crop.data[4], 5);
});

// --------------------------------------------------------------------------
// Skeleton: propiedades
// --------------------------------------------------------------------------

function skelOf(mask, w, h) {
  const g = buildSkeletonGraph(skeletonize(mask, w, h), w, h);
  contractDegreeTwo(g);
  return g;
}
function maskOf(w, h, fn) {
  const m = new Uint8Array(w * h);
  for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) m[y * w + x] = fn(x, y) ? 1 : 0;
  return m;
}

test("Skeleton: barra horizontal gruesa -> un recorrido horizontal; es 1 px y sin píxeles fuera de la máscara", () => {
  const w = 120, h = 40;
  const mask = maskOf(w, h, rect(10, 14, 110, 26));
  const skel = skeletonize(mask, w, h);
  for (let i = 0; i < skel.length; i++) if (skel[i]) assert.equal(mask[i], 1, "el skeleton vive dentro de la máscara");
  const g = buildSkeletonGraph(skel, w, h);
  contractDegreeTwo(g);
  const s = summarizeGraph(g);
  assert.equal(s.edges, 1);
  assert.equal(s.junctions, 0);
  assert.equal(s.loops, 0);
  const pts = [...g.edges.values()][0].pts;
  const ys = pts.map((p) => p[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) <= 1.5, "horizontal");
  approx((ys[0] + ys[ys.length - 1]) / 2, 20, 1.5, "en el centro de la barra");
  assert.ok(polylineLength(pts) > 70, "recorre buena parte de la barra");
});

test("Skeleton: donut -> un loop cerrado, sin nodos; T -> exactamente una bifurcación; + -> una bifurcación con 4 ramas", () => {
  const donut = skelOf(maskOf(100, 100, ring(50, 50, 40, 22)), 100, 100);
  const sd = summarizeGraph(donut);
  assert.equal(sd.loops + [...donut.edges.values()].filter((e) => e.a === e.b).length, 1, "un único lazo");
  assert.equal(sd.junctions, 0);
  assert.equal(sd.endpoints, 0);
  const t = skelOf(maskOf(120, 100, union(rect(10, 10, 110, 26), rect(52, 10, 68, 90))), 120, 100);
  const st = summarizeGraph(t);
  assert.equal(st.junctions, 1);
  assert.equal(st.endpoints, 3);
  assert.equal(st.edges, 3);
  const plus = skelOf(maskOf(120, 120, union(rect(10, 52, 110, 68), rect(52, 10, 68, 110))), 120, 120);
  const sp = summarizeGraph(plus);
  assert.equal(sp.junctions, 1);
  assert.equal(sp.endpoints, 4);
});

test("Poda: un espolón corto desaparece; las ramas reales, los lazos y las conexiones entre bifurcaciones se conservan", () => {
  const w = 160, h = 80;
  const bar = rect(10, 30, 150, 50);
  const spur = rect(70, 22, 78, 30); // bultito de 8×8 sobre la barra
  const g0 = skelOf(maskOf(w, h, union(bar, spur)), w, h);
  const before = summarizeGraph(g0);
  assert.ok(before.junctions >= 1, `hay un espolón antes de podar (${JSON.stringify(before)})`);
  const res = pruneSkeleton(g0, 40);
  const after = summarizeGraph(g0);
  assert.ok(res.branches >= 1);
  assert.equal(after.junctions, 0);
  assert.equal(after.edges, 1, "queda la barra");
  // Una T real (ramas largas) no se poda con el mismo umbral corto.
  const t = skelOf(maskOf(140, 120, union(rect(10, 10, 130, 26), rect(62, 10, 78, 100))), 140, 120);
  const pt = pruneSkeleton(t, 20);
  assert.equal(pt.branches, 0);
  assert.equal(summarizeGraph(t).junctions, 1);
  // Un lazo con espolón: el lazo sigue, el espolón cae.
  const lp = skelOf(maskOf(120, 120, union(ring(60, 60, 45, 27), rect(55, 5, 65, 20))), 120, 120);
  pruneSkeleton(lp, 30);
  const sl = summarizeGraph(lp);
  assert.equal(sl.loops + [...lp.edges.values()].filter((e) => e.a === e.b).length, 1, "el lazo se conserva");
  assert.equal(sl.endpoints, 0);
  // Un trazo suelto más corto que el mínimo es ruido; uno largo no.
  const shortStroke = skelOf(maskOf(60, 40, rect(20, 17, 34, 23)), 60, 40);
  pruneSkeleton(shortStroke, 30);
  assert.equal(summarizeGraph(shortStroke).edges, 0);
});

test("Puentes: dos extremos libres a pocos px se unen; lejanos no", () => {
  const w = 120, h = 40;
  const close = skelOf(maskOf(w, h, union(rect(10, 18, 55, 22), rect(58, 18, 110, 22))), w, h);
  assert.equal(summarizeGraph(close).edges, 2);
  assert.equal(bridgeCloseEndpoints(close, 10), 1);
  assert.equal(summarizeGraph(close).edges, 1);
  const far = skelOf(maskOf(w, h, union(rect(10, 18, 40, 22), rect(70, 18, 110, 22))), w, h);
  assert.equal(bridgeCloseEndpoints(far, 10), 0);
  assert.equal(summarizeGraph(far).edges, 2);
});

test("Simplificación (RDP) y suavizado: extremos exactos, cerrados siguen cerrados, sin encoger el círculo", () => {
  const line = Array.from({ length: 50 }, (_, i) => [i, i % 2 === 0 ? 0 : 0.2]);
  const simp = rdp(line, 0.5);
  assert.deepEqual(simp, [line[0], line[49]]);
  const circle = { pts: Array.from({ length: 200 }, (_, i) => [50 + 30 * Math.cos((i / 200) * 2 * Math.PI), 50 + 30 * Math.sin((i / 200) * 2 * Math.PI)]), closed: true };
  const sc = simplifyRawPath(circle, 1.3);
  assert.equal(sc.closed, true);
  assert.ok(sc.pts.length < 60 && sc.pts.length >= 8);
  const zig = { pts: [[0, 0], [10, 8], [20, -6], [30, 8], [40, 0]], closed: false };
  const sm = smoothRawPath(zig, 100);
  assert.deepEqual(sm.pts[0], [0, 0], "extremo inicial fijo");
  assert.deepEqual(sm.pts[sm.pts.length - 1], [40, 0], "extremo final fijo");
  const amp = (pts) => Math.max(...pts.map((p) => Math.abs(p[1])));
  assert.ok(amp(sm.pts) < amp(zig.pts), "el zigzag se atenúa");
  assert.equal(smoothRawPath(zig, 0), zig, "0 = sin cambios");
  const smc = smoothRawPath(sc, 60);
  const rMean = smc.pts.reduce((s, p) => s + Math.hypot(p[0] - 50, p[1] - 50), 0) / smc.pts.length;
  approx(rMean, 30, 1.0, "Taubin no encoge el círculo");
  assert.equal(smc.closed, true);
  const rs = resamplePolyline([[0, 0], [10, 0]], false, 2);
  assert.equal(rs.length, 6);
});

// --------------------------------------------------------------------------
// Pipeline completo: formas
// --------------------------------------------------------------------------

test("PNG 1: rectángulo sólido -> un recorrido abierto horizontal de largo ≈ el del rectángulo (extremos extendidos)", () => {
  const r = convert(makeImage(300, 120, rect(30, 45, 270, 75)), {}, 30);
  assert.equal(r.paths.length, 1);
  assert.equal(r.paths[0].closed, false);
  const b = bboxOf(r.paths);
  assert.ok(b.h < 1.5, `horizontal (alto ${b.h})`);
  // 240×30 px -> 30 mm de alto => 1 mm por px original: largo esperado 240 mm (el skeleton se extiende hasta el borde).
  approx(neonPathLength(r.paths[0]) / 240, 1, 0.06, "largo");
  assert.equal(r.stats.modeUsed, "luminance");
  assert.equal(r.stats.junctions, 0);
});

test("PNG 2: línea gruesa diagonal -> un recorrido con el largo de la línea", () => {
  const r = convert(makeImage(260, 260, thickLine(40, 40, 220, 200, 7)), {}, 60);
  assert.equal(r.paths.length, 1);
  const segPx = Math.hypot(180, 160);
  const mmPerSrcPx = 60 / (160 + 14); // alto del foreground original = 160 + 2*7
  approx(neonPathLength(r.paths[0]) / (segPx * mmPerSrcPx), 1, 0.08, "largo diagonal");
});

test("PNG 3: círculo sólido -> no hay recorrido de línea (error claro), sin geometría corrupta", () => {
  let err = null;
  let r = null;
  try {
    r = convert(makeImage(200, 200, disc(100, 100, 60)));
  } catch (e) {
    err = e;
  }
  if (err) assert.equal(err.code, "RASTER_NO_PATH");
  else assert.ok(totalNeonLength(r.paths) < 0.35 * 120 * r.stats.mmPerPx, "a lo sumo un trazo corto en el centro");
});

test("PNG 4/5: donut y letra O -> un loop cerrado cerca de la mitad del grosor; sin bifurcaciones ni extremos", () => {
  for (const [ro, ri] of [[80, 45], [90, 60]]) {
    const r = convert(makeImage(240, 240, ring(120, 120, ro, ri)), {}, 100);
    assert.equal(r.paths.length, 1, `ring ${ro}/${ri}`);
    assert.equal(r.paths[0].closed, true);
    assert.equal(r.stats.junctions, 0);
    assert.equal(r.stats.endpoints, 0);
    assert.equal(r.stats.loops, 1);
    const b = bboxOf(r.paths);
    // Diámetro medio = (ro+ri) px originales; el alto del foreground (2*ro px) equivale a 100 mm.
    const expectedMm = (100 * (ro + ri)) / (2 * ro);
    approx(b.w / expectedMm, 1, 0.05, "ancho del loop");
    approx(b.h / expectedMm, 1, 0.05, "alto del loop");
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const rm = r.paths[0].points.reduce((s, [x, y]) => s + Math.hypot(x - cx, y - cy), 0) / r.paths[0].points.length;
    approx(rm / (expectedMm / 2), 1, 0.05, "radio medio");
  }
  // "O" elíptica gruesa (más alta que ancha), como una letra
  const o = convert(makeImage(200, 280, (x, y) => {
    const a = ((x - 100) / 80) ** 2 + ((y - 140) / 120) ** 2;
    const b = ((x - 100) / 45) ** 2 + ((y - 140) / 85) ** 2;
    return a <= 1 && b >= 1;
  }), {}, 120);
  assert.equal(o.paths.length, 1);
  assert.equal(o.paths[0].closed, true);
  assert.ok(bboxOf(o.paths).h > bboxOf(o.paths).w * 1.2);
});

test("PNG 6: un 8 simplificado (dos anillos que se unen) -> dos lazos conectados por al menos una bifurcación", () => {
  const eight = union(ring(100, 70, 50, 26), ring(100, 155, 50, 26)); // se solapan 15 px
  const r = convert(makeImage(200, 230, eight), {}, 100);
  assert.ok(r.stats.junctions >= 1, `bifurcaciones ${r.stats.junctions}`);
  assert.ok(r.stats.loops >= 2, `lazos independientes ${r.stats.loops}`);
  assert.ok(r.issues.some((i) => i.code === "RASTER_JUNCTIONS" && /bifurcaci/.test(i.message)));
  assert.match(r.issues.find((i) => i.code === "RASTER_JUNCTIONS").message, /segmentos separados de Neon Flex/);
});

test("PNG 7: varias islas -> un recorrido por isla, con posiciones relativas", () => {
  const r = convert(makeImage(400, 140, union(rect(20, 60, 100, 80), rect(160, 60, 240, 80), rect(300, 60, 380, 80))), {}, 40);
  assert.equal(r.paths.length, 3);
  const xs = r.paths.map((p) => bboxOf([p]).minX).sort((a, b) => a - b);
  approx((xs[1] - xs[0]) / (xs[2] - xs[1]), 1, 0.1, "separación regular");
});

// --------------------------------------------------------------------------
// Detección: alpha / luminosidad / umbral / invertir
// --------------------------------------------------------------------------

test("PNG 8: alpha transparente (aunque el RGB sea blanco) -> modo Transparencia en Automático", () => {
  const img = makeImage(240, 240, ring(120, 120, 80, 45), { ink: [255, 255, 255, 255], bg: [255, 255, 255, 0] });
  const r = convert(img, {}, 100);
  assert.equal(r.stats.modeUsed, "alpha");
  assert.equal(r.paths.length, 1);
  assert.equal(r.paths[0].closed, true);
  // forzando luminosidad, blanco sobre blanco = sin foreground
  assert.throws(() => convert(img, { detectionMode: "luminance" }), (e) => e.code === "RASTER_EMPTY" || e.code === "RASTER_FULL");
  // alpha threshold: un ring semitransparente (alpha 100) con umbral 128 no cuenta; con 50 sí
  const soft = makeImage(240, 240, ring(120, 120, 80, 45), { ink: [0, 0, 0, 100], bg: [0, 0, 0, 0] });
  assert.throws(() => convert(soft, { alphaThreshold: 128 }), (e) => e.code === "RASTER_EMPTY");
  assert.equal(convert(soft, { alphaThreshold: 50 }).paths.length, 1);
});

test("PNG 9/10/11: negro sobre blanco, blanco sobre negro con Invertir, y equivalencia; Invertir cambia la máscara", () => {
  const shape = union(ring(110, 90, 60, 34), rect(190, 80, 300, 100));
  const bw = makeImage(340, 180, shape);
  const wb = makeImage(340, 180, shape, { ink: [255, 255, 255, 255], bg: [0, 0, 0, 255] });
  const a = convert(bw, {}, 60);
  const b = convert(wb, { invert: true }, 60);
  assert.equal(a.stats.modeUsed, "luminance");
  assert.equal(a.paths.length, b.paths.length);
  approx(totalNeonLength(a.paths) / totalNeonLength(b.paths), 1, 0.03, "mismo recorrido");
  // sin invertir, blanco sobre negro toma el FONDO como foreground (foreground ocupa > 50 %): aviso y otro resultado
  const wrong = (() => {
    try {
      return convert(wb, {}, 60);
    } catch (e) {
      return e;
    }
  })();
  assert.ok(wrong instanceof Error ? wrong.code.startsWith("RASTER_") : wrong.issues.some((i) => i.code === "RASTER_HINT") || Math.abs(totalNeonLength(wrong.paths) - totalNeonLength(a.paths)) > 1);
  // La máscara de preview es exactamente el complemento (mismo foreground): con Invertir, blanco/negro da la misma máscara que negro/blanco
  const ma = a.preview.mask, mb = b.preview.mask;
  assert.deepEqual([ma.width, ma.height], [mb.width, mb.height]);
  let diff = 0;
  for (let i = 0; i < ma.data.length; i++) if (ma.data[i] !== mb.data[i]) diff++;
  assert.ok(diff / ma.data.length < 0.002, `máscaras equivalentes (${diff} px distintos)`);
});

test("PNG 12: umbral automático (Otsu) informado, y manual", () => {
  const gray = makeImage(300, 150, rect(40, 60, 260, 90), { ink: [100, 100, 100, 255], bg: [255, 255, 255, 255] });
  const auto = convert(gray, {}, 30);
  assert.equal(auto.stats.thresholdAuto, true);
  assert.ok(auto.stats.thresholdUsed >= 100 && auto.stats.thresholdUsed < 255, `Otsu ${auto.stats.thresholdUsed}`);
  assert.throws(() => convert(gray, { threshold: 50 }), (e) => e.code === "RASTER_EMPTY");
  const manual = convert(gray, { threshold: 150 }, 30);
  assert.equal(manual.stats.thresholdAuto, false);
  assert.equal(manual.stats.thresholdUsed, 150);
  assert.equal(manual.paths.length, 1);
  // un umbral que incluye el fondo (254 con fondo 255... ) => foreground casi total
  assert.throws(() => convert(gray, { threshold: 255 }), (e) => e.code === "RASTER_FULL");
});

// --------------------------------------------------------------------------
// Limpieza, poda, crop, resolución
// --------------------------------------------------------------------------

test("PNG 13: píxeles de ruido -> la limpieza los elimina (componentes) y el recorrido queda igual", () => {
  const bar = rect(20, 55, 280, 70);
  // ruido "sal" (1 px) y motitas de 2×2 cerca de la barra, dentro del mismo encuadre
  const salt = (x, y) => y >= 30 && y <= 95 && (y < 48 || y > 78) && ((x * 7 + y * 13) % 211 === 0) && x > 15 && x < 285;
  const specks = union(...[0, 1, 2, 3, 4, 5].map((i) => rect(30 + i * 40, 35, 32 + i * 40, 37)));
  const img = makeImage(300, 110, union(bar, salt, specks));
  const raw = convert(img, { cleaning: 0 }, 30);
  const c1 = convert(img, { cleaning: 1 }, 30);
  const c2 = convert(img, { cleaning: 2 }, 30);
  assert.ok(raw.stats.components >= 10, `sin limpieza: ${raw.stats.components} componentes`);
  assert.ok(c1.stats.components < raw.stats.components, "la limpieza suave quita el ruido sal");
  assert.equal(c2.stats.components, 1, "la media también quita las motitas de 2×2");
  assert.equal(c2.paths.length, 1);
  assert.equal(convert(img, { cleaning: 3 }, 30).paths.length, 1);
  // los píxeles aislados nunca forman recorrido aunque sobrevivan a la máscara
  assert.equal(raw.paths.length, 1);
});

test("PNG 14: espolón corto -> se poda con la longitud en mm; con poda 0 sobrevive; ramas reales no se tocan", () => {
  const bar = rect(20, 50, 280, 70);
  const bump = rect(140, 34, 152, 50);
  const img = makeImage(300, 110, union(bar, bump));
  const noPrune = convert(img, { pruneMm: 0 }, 40);
  const pruned = convert(img, { pruneMm: 40 }, 40);
  assert.ok(noPrune.stats.junctions >= 1 || noPrune.paths.length > 1, "el espolón existe sin poda");
  assert.equal(pruned.stats.junctions, 0);
  assert.equal(pruned.paths.length, 1);
  assert.ok(pruned.stats.prunedBranches >= 1);
  // Una "A"-like real: dos patas largas y travesaño: nada se poda
  const A = union(thickLine(30, 200, 100, 30, 6), thickLine(100, 30, 170, 200, 6), thickLine(55, 140, 145, 140, 6));
  const ra = convert(makeImage(200, 230, A), { pruneMm: 3 }, 100);
  assert.ok(ra.stats.junctions >= 1);
  assert.ok(ra.paths.length >= 4, `A: ${ra.paths.length} ramas`);
});

test("PNG 16: junction en T -> 1 bifurcación, 3 ramas y aviso con el conteo", () => {
  const r = convert(makeImage(200, 180, union(rect(20, 20, 180, 42), rect(90, 20, 112, 160))), {}, 80);
  assert.equal(r.stats.junctions, 1);
  assert.equal(r.paths.length, 3);
  assert.equal(r.stats.endpoints, 3);
  assert.equal(r.issues.find((i) => i.code === "RASTER_JUNCTIONS").message, "El recorrido contiene 1 bifurcación. Las bifurcaciones pueden requerir segmentos separados de Neon Flex.");
});

test("PNG 17: recorte automático de márgenes -> mismo diseño con o sin un lienzo enorme vacío", () => {
  const logo = union(ring(250, 250, 200, 130), rect(400, 235, 480, 265));
  const small = makeImage(520, 520, logo);
  const big = makeImage(2000, 2000, (x, y) => logo(x - 750, y - 750));
  const a = convert(small, {}, 80);
  const b = convert(big, {}, 80);
  assert.equal(a.paths.length, b.paths.length);
  approx(totalNeonLength(a.paths) / totalNeonLength(b.paths), 1, 0.04, "longitud");
  approx(bboxOf(a.paths).h / bboxOf(b.paths).h, 1, 0.04);
  assert.ok(bboxOf(b.paths).h > 40, "el diseño no queda diminuto");
});

test("Resolución de trabajo: nunca más de 1024 px de lado (+ borde); imágenes chicas se amplían solo hasta 320", () => {
  const big = convert(makeImage(3000, 1500, union(rect(100, 700, 2900, 800), rect(1400, 100, 1500, 1400))), {}, 100);
  assert.ok(Math.max(big.stats.workingWidth, big.stats.workingHeight) <= 1024 + 8);
  const tiny = convert(makeImage(60, 60, ring(30, 30, 25, 14)), {}, 50);
  assert.ok(Math.max(tiny.stats.workingWidth, tiny.stats.workingHeight) > 60 * 2, "se amplía (bilinear sobre el campo)");
  assert.ok(Math.max(tiny.stats.workingWidth, tiny.stats.workingHeight) <= 60 * 4 + 12, "pero nunca más de 4x");
  assert.equal(tiny.paths.length, 1);
  assert.equal(tiny.paths[0].closed, true);
});

test("Escala física: el alto del diseño rige (mm) y la longitud se mide DESPUÉS de escalar", () => {
  const img = makeImage(300, 200, union(ring(100, 100, 80, 50), rect(180, 90, 290, 110)));
  const a = convert(img, {}, 50), b = convert(img, {}, 100);
  approx(totalNeonLength(b.paths) / totalNeonLength(a.paths), 2, 0.02, "doble alto = doble largo");
  approx(a.stats.mmPerPx * (a.preview.mask.height), 50 * (a.preview.mask.height / 50 / 1), 1e9); // sanity: finito
  const ga = createNeonGeometry(a.paths, { ...P, designHeightMm: 50 });
  approx(ga.metrics.lengthMm, totalNeonLength(a.paths), 1e-6);
});

test("Controles de calidad: simplificación reduce puntos sin cambiar la topología; suavizado atenúa el dentado y conserva extremos", () => {
  const img = makeImage(300, 200, union(ring(100, 100, 80, 50), rect(180, 90, 290, 110)));
  const lo = convert(img, { simplify: "low", smoothing: 0 }, 60);
  const hi = convert(img, { simplify: "high", smoothing: 0 }, 60);
  const count = (r) => r.paths.reduce((s, p) => s + p.points.length, 0);
  assert.ok(count(hi) < count(lo), `${count(hi)} < ${count(lo)}`);
  assert.equal(hi.paths.length, lo.paths.length);
  assert.equal(closedCount(hi), closedCount(lo));
  assert.equal(hi.stats.junctions, lo.stats.junctions);
  const rough = convert(img, { simplify: "low", smoothing: 0 }, 60);
  const smooth = convert(img, { simplify: "low", smoothing: 100 }, 60);
  assert.equal(smooth.paths.length, rough.paths.length);
  approx(totalNeonLength(smooth.paths) / totalNeonLength(rough.paths), 1, 0.04, "el suavizado no cambia el largo de forma apreciable");
});

// --------------------------------------------------------------------------
// Errores y límites
// --------------------------------------------------------------------------

test("Errores PNG: vacío, todo foreground, ruido excesivo, demasiado complejo, firma/tamaño/dimensiones inválidas", () => {
  assert.throws(() => convert(makeImage(100, 100, () => false)), (e) => e.code === "RASTER_EMPTY" && /foreground/i.test(e.message));
  assert.throws(() => convert(makeImage(100, 100, () => true)), (e) => e.code === "RASTER_FULL" && /casi toda la imagen/.test(e.message));
  assert.throws(() => convert(makeImage(100, 100, () => [0, 0, 0, 0])), (e) => e.code === "RASTER_EMPTY");
  // un punto suelto que la limpieza se come
  assert.throws(() => convert(makeImage(100, 100, rect(50, 50, 52, 52)), { cleaning: 3 }), (e) => e.code === "RASTER_EMPTY" || e.code === "RASTER_NO_PATH");
  // polka dots: demasiados componentes => imagen demasiado compleja
  const dots = makeImage(640, 640, (x, y) => x < 600 && y < 600 && (x % 40 - 20) ** 2 + (y % 40 - 20) ** 2 <= 81);
  assert.throws(() => convert(dots), (e) => e.code === "RASTER_TOO_COMPLEX" && /demasiado compleja/.test(e.message));
  // decodificación
  assert.throws(() => decodeRasterImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), (e) => e.code === "RASTER_INVALID");
  assert.throws(() => decodeRasterImage(new Uint8Array(0)), (e) => e.code === "RASTER_INVALID");
  const huge = new Uint8Array(11 * 1024 * 1024);
  assert.throws(() => decodeRasterImage(huge), (e) => e.code === "RASTER_TOO_LARGE" && /10 MB/.test(e.message));
  // PNG con IHDR de 9000×9000: se rechaza ANTES de decodificar
  const forged = new Uint8Array(64);
  forged.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  new DataView(forged.buffer).setUint32(16, 9000);
  new DataView(forged.buffer).setUint32(20, 9000);
  assert.throws(() => decodeRasterImage(forged), (e) => e.code === "RASTER_TOO_LARGE" && /9000×9000/.test(e.message));
  // Una firma PNG con cuerpo dañado
  const trunc = pngBytes(makeImage(20, 20, rect(5, 5, 15, 15))).slice(0, 40);
  assert.throws(() => decodeRasterImage(trunc), (e) => e.code === "RASTER_INVALID");
  // el MIME/extensión no cuentan: un PNG real se acepta se llame como se llame, y la firma decide
  assert.equal(sniffRasterKind(pngBytes(makeImage(8, 8, () => true))), "png");
  assert.equal(sniffRasterKind(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0])), null, "GIF no");
});

test("decodeRasterImage: PNG real -> RGBA; recuerda el resultado por identidad de los bytes", () => {
  const bytes = pngBytes(makeImage(30, 20, rect(5, 5, 20, 12), { ink: [10, 20, 30, 255], bg: [255, 255, 255, 0] }));
  const d = decodeRasterImage(bytes);
  assert.equal(d.kind, "png");
  assert.deepEqual([d.image.width, d.image.height], [30, 20]);
  assert.deepEqual([...d.image.data.slice((6 * 30 + 6) * 4, (6 * 30 + 6) * 4 + 4)], [10, 20, 30, 255]);
  assert.equal(d.image.data[3], 0);
  assert.equal(decodeRasterImage(bytes), d, "cache");
});

// --------------------------------------------------------------------------
// End to end PNG -> canal U -> STL
// --------------------------------------------------------------------------

test("PNG 34 (end to end): 'O' gruesa -> máscara -> skeleton -> NeonPaths -> canal U manifold -> STL -> cama", () => {
  const O = makeImage(320, 400, (x, y) => {
    const a = ((x - 160) / 130) ** 2 + ((y - 200) / 170) ** 2;
    const b = ((x - 160) / 80) ** 2 + ((y - 200) / 115) ** 2;
    return a <= 1 && b >= 1;
  });
  const bytes = pngBytes(O);
  const out = buildNeonPaths({ type: "image", fileName: "o.png", bytes, kind: "png", raster: { ...S } }, 60);
  assert.equal(out.ok, true, out.message);
  assert.ok(out.result.paths.length >= 1);
  assert.equal(out.result.paths.filter((p) => p.closed).length, 1, "loop");
  assert.ok(out.result.raster.preview.mask.width > 0 && out.result.raster.stats.paths === 1);
  const g = createNeonGeometry(out.result.paths, { ...P, designHeightMm: 60 }, out.result.issues);
  assert.deepEqual(g.errors, []);
  const mesh = g.geometry.parts[0].mesh;
  const audit = meshAudit(mesh);
  assert.equal(audit.bad, 0, "watertight y manifold");
  assert.equal(audit.degenerate, 0);
  assert.equal(buildSTLBlob(mesh).size, 84 + 50 * mesh.triangleCount, "STL exportable");
  const layout = computeBedLayout(collectBedItems(g.geometry), getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID));
  assert.equal(layout.oversize.length, 0);
  assert.equal(layout.plates.length, 1);
  // errores del decodificador llegan como mensaje (sin excepciones crudas)
  const bad = buildNeonPaths({ type: "image", fileName: "x.png", bytes: new Uint8Array([1, 2, 3]), kind: "png", raster: { ...S } }, 60);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /PNG/);
});

test("PNG 34b: un logo con loop + rama + islas (tipo 'P' y punto) pasa por todo el pipeline y da un canal válido", () => {
  const P_ = union(rect(40, 30, 66, 250), ring(120, 90, 70, 44), rect(40, 30, 120, 56));
  const dot = disc(200, 250, 14);
  const r = convert(makeImage(260, 290, union(P_, dot)), {}, 90);
  assert.ok(r.stats.junctions >= 1);
  assert.ok(r.paths.length >= 2);
  const g = createNeonGeometry(r.paths, { ...P, designHeightMm: 90 }, r.issues);
  assert.deepEqual(g.errors, []);
  assert.equal(meshAudit(g.geometry.parts[0].mesh).bad, 0);
});

test("Rendimiento: imagen de 2000×1500 con un logo complejo convierte en tiempo razonable (medido, sin Web Worker)", () => {
  const glyphs = union(ring(400, 700, 300, 200), rect(750, 400, 800, 1100), ring(1300, 700, 300, 200), thickLine(1700, 400, 1900, 1100, 25), thickLine(1900, 400, 1700, 1100, 25));
  const img = makeImage(2000, 1500, glyphs);
  const t = Date.now();
  const r = convert(img, {}, 100);
  const ms = Date.now() - t;
  console.log(`  [perf] 2000×1500 -> ${r.stats.workingWidth}×${r.stats.workingHeight}, ${r.paths.length} paths, ${ms} ms (pipeline ${r.stats.ms} ms)`);
  assert.ok(ms < 8000, `demasiado lento: ${ms} ms`);
  assert.ok(r.paths.length >= 3);
});

// --------------------------------------------------------------------------
// Persistencia de proyectos Neon (imagen)
// --------------------------------------------------------------------------

const { serializeNeonProject, deserializeNeonProject, normalizeRasterSettings, neonProjectSignature } = load("lib/maker/neon/projects/neonProjectData.ts");
const { listProjects, saveProject, fetchProjectRow } = load("lib/maker/persistence/makerRepository.ts");

const workBase = (over = {}) => ({
  params: { ...P, designHeightMm: 120, neonWidthMm: 8 },
  sourceType: "image",
  text: "Stampa",
  fontId: "relief-singleline",
  letterSpacingPct: 10,
  raster: { ...S, threshold: 90, invert: true, cleaning: 2, pruneMm: 3.5, simplify: "high", smoothing: 70, detectionMode: "luminance" },
  fileMeta: { kind: "png", fileName: "logo.png", sizeBytes: 1234 },
  ...over,
});

test("Proyectos Neon: un PNG se guarda como neon-png con la receta de conversión (y nunca el skeleton ni los bytes)", () => {
  const payload = serializeNeonProject(workBase(), { storagePath: "u/p/source.png" });
  assert.equal(payload.source_type, "neon-png");
  assert.equal(payload.preset_id, null);
  const src = payload.source_data;
  assert.equal(src.storagePath, "u/p/source.png");
  assert.equal(src.mimeType, "image/png");
  assert.equal(src.designHeightMm, 120);
  assert.deepEqual(src.raster, { detectionMode: "luminance", alphaThreshold: 128, threshold: 90, invert: true, contrast: 0, cleaning: 2, pruneMm: 3.5, simplify: "high", smoothing: 70 });
  assert.deepEqual(Object.keys(payload.settings).sort(), ["clearanceMm", "floorThicknessMm", "minBendRadiusMm", "neonWidthMm", "wallHeightMm", "wallThicknessMm"]);
  assert.equal(payload.settings.neonWidthMm, 8);
  const json = JSON.stringify(payload);
  assert.ok(!/skeleton|pathsPx|"mask"/i.test(json), "no se persiste nada derivado");
  assert.ok(json.length < 4000, "muy por debajo del límite de 16 KB de source_data");
  assert.equal(serializeNeonProject(workBase({ fileMeta: { kind: "jpg", fileName: "a.jpg", sizeBytes: 9 } })).source_type, "neon-jpg");
  assert.equal(serializeNeonProject(workBase({ sourceType: "svg", fileMeta: { kind: "svg", fileName: "a.svg", sizeBytes: 9 } })).source_type, "neon-svg");
  const text = serializeNeonProject(workBase({ sourceType: "text", fileMeta: null }));
  assert.equal(text.source_type, "neon-text");
  assert.equal(text.source_data.raster, undefined);
  assert.throws(() => serializeNeonProject(workBase({ fileMeta: null })), /archivo/);
  assert.throws(() => serializeNeonProject(workBase({ sourceType: "image", fileMeta: { kind: "svg", fileName: "a.svg", sizeBytes: 1 } })), /archivo/);
});

test("Proyectos Neon: round-trip completo y lectura tolerante (campos faltantes / fuera de rango / otra versión)", () => {
  const w = workBase();
  const p = serializeNeonProject(w, { storagePath: "u/p/source.png" });
  const back = deserializeNeonProject(p);
  assert.equal(back.sourceType, "image");
  assert.deepEqual(back.params, w.params);
  assert.deepEqual(back.raster, w.raster);
  assert.equal(back.fontId, "relief-singleline");
  assert.equal(back.letterSpacingPct, 10);
  assert.deepEqual(back.fileRef, { storagePath: "u/p/source.png", originalFilename: "logo.png", mimeType: "image/png", sizeBytes: 1234, kind: "png" });
  assert.equal(neonProjectSignature(w), neonProjectSignature({ ...w }), "firma estable");
  assert.notEqual(neonProjectSignature(w), neonProjectSignature({ ...w, raster: { ...w.raster, smoothing: 10 } }), "un cambio de receta cambia la firma");
  // threshold null (automático) sobrevive
  const auto = deserializeNeonProject(serializeNeonProject(workBase({ raster: { ...S } }), { storagePath: "x" }));
  assert.equal(auto.raster.threshold, null);
  // tolerancia
  const sparse = deserializeNeonProject({ source_type: "neon-jpg", source_data: { storagePath: "u/p/source.jpg", raster: { threshold: 999, cleaning: 9, simplify: "zzz", pruneMm: -4 } }, settings: {} });
  assert.equal(sparse.fileRef.kind, "jpg");
  assert.equal(sparse.sourceType, "image");
  assert.deepEqual(sparse.params, { ...P });
  assert.deepEqual(sparse.raster, { ...S });
  assert.deepEqual(normalizeRasterSettings(null), { ...S });
  assert.throws(() => deserializeNeonProject({ source_type: "neon-png", source_data: {}, settings: {} }), /archivo de origen/);
  assert.throws(() => deserializeNeonProject({ source_type: "png", source_data: {}, settings: {} }), /no es de Neon/);
  assert.equal(deserializeNeonProject({ source_type: "neon-text", source_data: { text: "Hola" }, settings: {} }).text, "Hola");
});

/** Cliente Supabase mínimo para verificar filtros y subidas sin red. */
function fakeSupabase() {
  const calls = { in: [], upload: [], rows: [], removed: [] };
  const query = (table) => {
    const q = {
      select: () => q,
      in: (col, vals) => (calls.in.push([col, vals]), q),
      order: () => Promise.resolve({ data: [{ id: "1", name: "n", source_type: "neon-png", updated_at: "2026-01-01" }], error: null }),
      insert: (row) => (calls.rows.push(["insert", table, row]), Promise.resolve({ error: null })),
      update: (row) => ({ eq: () => (calls.rows.push(["update", table, row]), Promise.resolve({ error: null })) }),
      eq: () => q,
      single: () => Promise.resolve({ data: { id: "1", name: "n", source_type: "neon-png", source_data: {}, settings: {} }, error: null }),
    };
    return q;
  };
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: query,
    storage: { from: () => ({ upload: async (path, blob) => (calls.upload.push([path, blob.type]), { error: null }), remove: async (p) => (calls.removed.push(p), { error: null }) }) },
  };
}

test("Repositorio: Neon lista solo neon-*, Carteles nunca los ve; subida a Storage privado como source.png/jpg", async () => {
  const sb = fakeSupabase();
  await listProjects(sb, "neon");
  await listProjects(sb);
  assert.deepEqual(sb.calls.in[0], ["source_type", ["neon-text", "neon-svg", "neon-png", "neon-jpg"]]);
  assert.deepEqual(sb.calls.in[1], ["source_type", ["text", "svg", "png"]], "Carteles filtra por sus tipos: los proyectos Neon no le aparecen");
  const png = serializeNeonProject(workBase());
  const r1 = await saveProject(sb, { id: "proj-1", isNew: true, name: "Logo", payload: png, upload: { kind: "png", blob: new Blob([new Uint8Array([1])], { type: "image/png" }) } });
  assert.equal(r1.storagePath, "user-1/proj-1/source.png");
  const jpg = serializeNeonProject(workBase({ fileMeta: { kind: "jpg", fileName: "a.jpg", sizeBytes: 5 } }));
  const r2 = await saveProject(sb, { id: "proj-2", isNew: true, name: "Foto", payload: jpg, upload: { kind: "jpg", blob: new Blob([new Uint8Array([1])], { type: "image/jpeg" }) } });
  assert.equal(r2.storagePath, "user-1/proj-2/source.jpg");
  assert.deepEqual(sb.calls.upload.map((u) => u[0]), ["user-1/proj-1/source.png", "user-1/proj-2/source.jpg"]);
  const inserted = sb.calls.rows.find((r) => r[0] === "insert")[2];
  assert.equal(inserted.source_type, "neon-png");
  assert.equal(inserted.source_data.storagePath, "user-1/proj-1/source.png", "el path del archivo queda en source_data");
  // un proyecto de texto no sube nada
  const before = sb.calls.upload.length;
  const rt = await saveProject(sb, { id: "proj-3", isNew: true, name: "Txt", payload: serializeNeonProject(workBase({ sourceType: "text", fileMeta: null })) });
  assert.equal(rt.storagePath, null);
  assert.equal(sb.calls.upload.length, before);
  // sin archivo un proyecto de imagen no se guarda
  await assert.rejects(saveProject(sb, { id: "p", isNew: true, name: "x", payload: png }), /archivo de origen/);
  const row = await fetchProjectRow(sb, "1");
  assert.equal(row.row.source_type, "neon-png");
});

test("Migration: amplía source_type a neon-*, bucket privado con image/jpeg, sin tocar RLS ni filas", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260920120000_maker_neon_projects.sql"), "utf8");
  assert.match(sql, /'neon-text', 'neon-svg', 'neon-png', 'neon-jpg'/);
  assert.match(sql, /image\/jpeg/);
  assert.ok(!/create policy|drop policy|delete from|truncate|drop table/i.test(sql), "no toca policies ni datos");
  assert.ok(!/public\s*=\s*true/i.test(sql), "el bucket sigue privado");
  // los tipos que Carteles usa siguen permitidos
  assert.match(sql, /'text', 'svg', 'png'/);
});

// --------------------------------------------------------------------------
// Calidad: texto real (fuente single-line) engrosado -> pipeline -> ¿recupera el centerline original?
// --------------------------------------------------------------------------

const { textToNeonPaths } = load("lib/maker/neon/paths/textToNeonPaths.ts");

/** Rasteriza NeonPaths (mm, Y arriba) con un trazo de radio `halfPx` a `pxPerMm`; devuelve la imagen y la caja usada. */
function renderThick(paths, pxPerMm, halfPx, margin = 20) {
  let maxX = 0, maxY = 0;
  for (const p of paths) for (const [x, y] of p.points) [maxX, maxY] = [Math.max(maxX, x), Math.max(maxY, y)];
  const w = Math.ceil(maxX * pxPerMm + 2 * margin), h = Math.ceil(maxY * pxPerMm + 2 * margin);
  const m = new Uint8Array(w * h);
  const segs = [];
  for (const p of paths) {
    const pts = p.points.map(([x, y]) => [margin + x * pxPerMm, margin + (maxY - y) * pxPerMm]);
    for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
    if (p.closed) segs.push([pts[pts.length - 1], pts[0]]);
  }
  for (const [[x0, y0], [x1, y1]] of segs) {
    const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - halfPx - 1)), bx1 = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + halfPx + 1));
    const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - halfPx - 1)), by1 = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + halfPx + 1));
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
        if (Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) <= halfPx) m[y * w + x] = 1;
      }
    }
  }
  const img = makeImage(w, h, (x, y) => m[y * w + x] === 1);
  return { img, heightMm: (maxY * pxPerMm + 2 * halfPx) / pxPerMm, maxY };
}

function densify(paths, step) {
  const out = [];
  for (const p of paths) {
    const pts = p.closed ? [...p.points, p.points[0]] : p.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  return out;
}

for (const [fontId, text] of [["relief-singleline", "STAMPA"], ["relief-singleline", "neon 8"], ["mistral-singleline", "amor"]]) {
  test(`Calidad (${fontId}, "${text}"): el recorrido extraído de un trazo grueso coincide con el centerline original`, () => {
    const original = textToNeonPaths(text, fontId, 50).paths;
    const pxPerMm = 8, halfPx = 5; // trazo de 10 px ≈ 1.25 mm
    const { img, heightMm } = renderThick(original, pxPerMm, halfPx);
    const r = convert(img, { simplify: "medium", smoothing: 40, pruneMm: 2 }, heightMm);
    assert.ok(r.paths.length >= 1);
    // Alinear por el centro de las cajas (el foreground incluye el ancho del trazo).
    const bo = bboxOf(original), be = bboxOf(r.paths);
    const dx = (bo.minX + bo.maxX) / 2 - (be.minX + be.maxX) / 2, dy = (bo.minY + bo.maxY) / 2 - (be.minY + be.maxY) / 2;
    const ref = densify(original, 0.15);
    let within = 0, sum = 0, n = 0;
    for (const p of densify(r.paths, 0.4)) {
      let best = Infinity;
      for (const q of ref) best = Math.min(best, Math.hypot(p[0] + dx - q[0], p[1] + dy - q[1]));
      sum += best;
      n++;
      if (best <= 0.9) within++; // < 0.72 del ancho del trazo (1.25 mm)
    }
    assert.ok(within / n > 0.95, `${((100 * within) / n).toFixed(1)} % de los puntos a <= 0.9 mm del centerline original`);
    assert.ok(sum / n < 0.5, `distancia media ${(sum / n).toFixed(2)} mm`);
    // El largo total es comparable (los extremos se extienden hasta el borde del trazo: puede ser algo mayor)
    approx(totalNeonLength(r.paths) / totalNeonLength(original), 1, 0.15, "largo total");
    // Y el canal U del resultado es válido
    const g = createNeonGeometry(r.paths, { ...P, designHeightMm: 50 }, r.issues);
    assert.deepEqual(g.errors, []);
    assert.equal(meshAudit(g.geometry.parts[0].mesh).bad, 0);
  });
}

// ==========================================================================
// FASE B — JPEG / JPG (mismo pipeline raster que PNG)
// ==========================================================================

const jpegJs = nodeRequire("jpeg-js");
const { readJpegInfo, applyExifOrientation } = load(`${R}decodeRasterImage.ts`);

const jpgBytes = (img, quality = 90) => new Uint8Array(jpegJs.encode({ data: img.data, width: img.width, height: img.height }, quality).data);
const imageSource = (bytes, kind, raster = {}) => ({ type: "image", fileName: `x.${kind}`, bytes, kind, raster: { ...S, ...raster } });
const viaBuild = (bytes, kind, raster = {}, height = 60) => {
  const out = buildNeonPaths(imageSource(bytes, kind, raster), height);
  assert.equal(out.ok, true, out.message);
  return out.result;
};
/** Distancia media (mm) de los puntos de A a la polilínea densa de B, con B alineada por el centro de la caja. */
function meanDistance(a, b) {
  const ba = bboxOf(a), bb = bboxOf(b);
  const dx = (bb.minX + bb.maxX) / 2 - (ba.minX + ba.maxX) / 2, dy = (bb.minY + bb.maxY) / 2 - (ba.minY + ba.maxY) / 2;
  const dense = (paths, step) => paths.flatMap((p) => {
    const pts = p.closed ? [...p.points, p.points[0]] : p.points;
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const n = Math.max(1, Math.ceil(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) / step));
      for (let k = 0; k < n; k++) out.push([pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / n, pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * k) / n]);
    }
    return out;
  });
  const ref = dense(b, 0.2);
  const pa = dense(a, 0.5);
  let sum = 0, max = 0;
  for (const p of pa) {
    let best = Infinity;
    for (const q of ref) best = Math.min(best, Math.hypot(p[0] + dx - q[0], p[1] + dy - q[1]));
    sum += best;
    max = Math.max(max, best);
  }
  return { mean: sum / pa.length, max };
}

const ringLogo = union(ring(130, 130, 110, 70), rect(230, 120, 300, 140));

test("JPEG: firma, dimensiones y EXIF se leen sin decodificar; JPEG real -> RGBA; el MIME/extensión no cuentan", () => {
  const bytes = jpgBytes(makeImage(80, 50, rect(10, 10, 60, 30)));
  assert.equal(sniffRasterKind(bytes), "jpg");
  assert.deepEqual(readJpegInfo(bytes), { width: 80, height: 50, orientation: 1 });
  const d = decodeRasterImage(bytes);
  assert.equal(d.kind, "jpg");
  assert.deepEqual([d.image.width, d.image.height], [80, 50]);
  assert.equal(d.image.data[3], 255, "un JPEG no tiene transparencia");
  assert.equal(decodeRasterImage(bytes), d, "cache por identidad");
  // un PNG con nombre .jpg sigue siendo PNG: manda la firma
  assert.equal(sniffRasterKind(pngBytes(makeImage(8, 8, () => true))), "png");
});

test("JPEG: seguridad de decodificación — dimensiones falsificadas, dañado, truncado, basura con firma JPEG, >10 MB", () => {
  // SOF0 con 9000×9000: rechazado ANTES de decodificar
  const forged = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x23, 0x28, 0x23, 0x28, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0, 0, 0]);
  assert.throws(() => decodeRasterImage(forged), (e) => e.code === "RASTER_TOO_LARGE" && /9000×9000/.test(e.message));
  assert.throws(() => decodeRasterImage(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44])), (e) => e.code === "RASTER_INVALID" && /JPEG/.test(e.message));
  const good = jpgBytes(makeImage(120, 80, rect(20, 20, 100, 60)));
  const outcome = (() => {
    try {
      return decodeRasterImage(good.slice(0, Math.floor(good.length / 2)));
    } catch (e) {
      return e;
    }
  })();
  assert.ok(!(outcome instanceof Error) || outcome.code === "RASTER_INVALID", "un JPEG truncado o se decodifica parcialmente o da un error claro, nunca una excepción cruda");
  const huge = new Uint8Array(11 * 1024 * 1024);
  huge.set([0xff, 0xd8, 0xff]);
  assert.throws(() => decodeRasterImage(huge), (e) => e.code === "RASTER_TOO_LARGE");
  assert.equal(buildNeonPaths(imageSource(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), "jpg"), 50).ok, false);
});

test("JPEG: la orientación EXIF se aplica (una foto de costado se ve como el usuario la ve)", () => {
  const img = makeImage(60, 30, (x) => x < 30); // mitad izquierda oscura
  const plain = jpgBytes(img, 100);
  // Inserta un APP1 Exif con Orientation = 6 (rotar 90° horario) justo después del SOI.
  const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
  const app1Body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app1 = [0xff, 0xe1, (app1Body.length + 2) >> 8, (app1Body.length + 2) & 0xff, ...app1Body];
  const withExif = new Uint8Array([0xff, 0xd8, ...app1, ...plain.slice(2)]);
  assert.equal(readJpegInfo(withExif).orientation, 6);
  const d = decodeRasterImage(withExif);
  assert.deepEqual([d.image.width, d.image.height], [30, 60], "ancho y alto intercambiados");
  const lum = (x, y) => d.image.data[(y * 30 + x) * 4];
  assert.ok(lum(15, 5) < 100 && lum(15, 55) > 150, "la mitad oscura (izquierda) pasa a estar ARRIBA con orientación 6");
  // unitario de la transformación: 3 = 180°
  const t3 = applyExifOrientation({ width: 2, height: 1, data: new Uint8Array([1, 1, 1, 255, 9, 9, 9, 255]) }, 3);
  assert.deepEqual([...t3.data], [9, 9, 9, 255, 1, 1, 1, 255]);
});

test("JPEG 1/2/4: negro sobre blanco, blanco sobre negro + invertir; siempre luminosidad (aunque se pida alpha)", () => {
  const bw = jpgBytes(makeImage(340, 280, ringLogo));
  const wb = jpgBytes(makeImage(340, 280, ringLogo, { ink: [255, 255, 255, 255], bg: [0, 0, 0, 255] }));
  const a = viaBuild(bw, "jpg");
  const b = viaBuild(wb, "jpg", { invert: true });
  assert.equal(a.raster.stats.modeUsed, "luminance");
  assert.equal(a.paths.length, b.paths.length);
  assert.ok(a.raster.stats.loops >= 1);
  approx(totalNeonLength(a.paths) / totalNeonLength(b.paths), 1, 0.03, "mismo recorrido");
  // sin invertir, blanco sobre negro toma el fondo como foreground: aviso (foreground > 50 %)
  const wrong = buildNeonPaths(imageSource(wb, "jpg"), 60);
  assert.ok(!wrong.ok || wrong.result.issues.some((i) => i.code === "RASTER_HINT"));
  // un settings guardado con detectionMode "alpha" no se aplica a un JPEG: se fuerza luminosidad
  const forced = viaBuild(bw, "jpg", { detectionMode: "alpha" });
  assert.equal(forced.raster.stats.modeUsed, "luminance");
  assert.equal(forced.paths.length, a.paths.length);
});

test("JPEG 5/6: umbral automático (Otsu) informado y umbral manual", () => {
  const gray = jpgBytes(makeImage(300, 150, rect(40, 60, 260, 90), { ink: [90, 90, 90, 255], bg: [240, 240, 240, 255] }));
  const auto = viaBuild(gray, "jpg", {}, 30);
  assert.equal(auto.raster.stats.thresholdAuto, true);
  assert.ok(auto.raster.stats.thresholdUsed > 90 && auto.raster.stats.thresholdUsed < 240, `Otsu ${auto.raster.stats.thresholdUsed}`);
  const manual = viaBuild(gray, "jpg", { threshold: 160 }, 30);
  assert.equal(manual.raster.stats.thresholdAuto, false);
  assert.equal(manual.raster.stats.thresholdUsed, 160);
  assert.equal(manual.paths.length, 1);
  const none = buildNeonPaths(imageSource(gray, "jpg", { threshold: 20 }), 30);
  assert.equal(none.ok, false);
  assert.match(none.message, /foreground/i);
});

test("JPEG 3: artefactos de compresión (calidad muy baja) -> misma topología y recorrido que el original sin compresión", () => {
  const img = makeImage(340, 280, ringLogo);
  const reference = viaBuild(pngBytes(img), "png");
  for (const q of [50, 20, 8]) {
    const r = viaBuild(jpgBytes(img, q), "jpg", { cleaning: 2 });
    assert.equal(r.raster.stats.loops, reference.raster.stats.loops, `calidad ${q}: lazos`);
    assert.equal(r.paths.length, reference.paths.length, `calidad ${q}: recorridos`);
    approx(totalNeonLength(r.paths) / totalNeonLength(reference.paths), 1, 0.06, `calidad ${q}: largo`);
    const d = meanDistance(r.paths, reference.paths);
    assert.ok(d.mean < 0.7, `calidad ${q}: distancia media ${d.mean.toFixed(2)} mm`);
  }
  // sin limpieza el ruido del JPEG puede dejar más ramitas, pero el pipeline no se rompe
  const raw = buildNeonPaths(imageSource(jpgBytes(img, 8), "jpg", { cleaning: 0 }), 60);
  assert.ok(raw.ok || /compleja|foreground/.test(raw.message));
});

test("JPEG 7: la misma forma en PNG y en JPEG da centerlines equivalentes (no idénticos píxel a píxel)", () => {
  const shapes = [
    makeImage(300, 300, ring(150, 150, 120, 80)),
    makeImage(340, 240, union(rect(20, 20, 320, 60), rect(150, 20, 190, 220))),
    makeImage(300, 300, union(thickLine(30, 270, 150, 30, 12), thickLine(150, 30, 270, 270, 12), thickLine(75, 180, 225, 180, 12))),
  ];
  for (const [i, img] of shapes.entries()) {
    const png = viaBuild(pngBytes(img), "png", {}, 80);
    const jpg = viaBuild(jpgBytes(img, 85), "jpg", {}, 80);
    assert.equal(jpg.paths.length, png.paths.length, `forma ${i}: recorridos`);
    assert.equal(jpg.raster.stats.junctions, png.raster.stats.junctions, `forma ${i}: bifurcaciones`);
    assert.equal(jpg.raster.stats.loops, png.raster.stats.loops, `forma ${i}: lazos`);
    approx(totalNeonLength(jpg.paths) / totalNeonLength(png.paths), 1, 0.04, `forma ${i}: largo`);
    const d = meanDistance(jpg.paths, png.paths);
    assert.ok(d.mean < 0.5 && d.max < 2.5, `forma ${i}: distancia media ${d.mean.toFixed(2)} / máx ${d.max.toFixed(2)} mm`);
  }
});

test("Contraste (común a PNG luminosidad y JPEG): estira la luminancia alrededor de 128 y llega al pipeline", () => {
  const img = { width: 3, height: 1, data: new Uint8Array([100, 100, 100, 255, 128, 128, 128, 255, 160, 160, 160, 255]) };
  const base = [...luminanceField(img, 0)];
  const more = [...luminanceField(img, 60)];
  const less = [...luminanceField(img, -60)];
  assert.deepEqual(base, [100, 128, 160]);
  assert.ok(more[0] < 100 && more[1] === 128 && more[2] > 160, "más contraste separa");
  assert.ok(less[0] > 100 && less[2] < 160, "menos contraste junta");
  // una imagen de bajo contraste: con umbral manual fijo, subir el contraste cambia qué queda como foreground
  const flat = makeImage(300, 150, rect(40, 60, 260, 90), { ink: [118, 118, 118, 255], bg: [140, 140, 140, 255] });
  assert.throws(() => convert(flat, { threshold: 100, contrast: 0 }, 30), (e) => e.code === "RASTER_EMPTY");
  assert.equal(convert(flat, { threshold: 100, contrast: 100 }, 30).paths.length, 1, "con contraste el gris oscuro cae por debajo del umbral");
  // y el mismo control existe para JPEG
  const jflat = jpgBytes(flat, 95);
  assert.equal(buildNeonPaths(imageSource(jflat, "jpg", { threshold: 100, contrast: 0 }), 30).ok, false);
  assert.equal(buildNeonPaths(imageSource(jflat, "jpg", { threshold: 100, contrast: 100 }), 30).ok, true);
});

test("JPEG 43 (end to end): 'O' gruesa JPG -> máscara -> skeleton -> NeonPaths -> canal U manifold -> STL -> cama", () => {
  const O = makeImage(320, 400, (x, y) => {
    const a = ((x - 160) / 130) ** 2 + ((y - 200) / 170) ** 2;
    const b = ((x - 160) / 80) ** 2 + ((y - 200) / 115) ** 2;
    return a <= 1 && b >= 1;
  });
  const out = buildNeonPaths(imageSource(jpgBytes(O, 80), "jpg", { cleaning: 2 }), 60);
  assert.equal(out.ok, true, out.message);
  assert.equal(out.result.raster.stats.loops, 1);
  assert.equal(out.result.paths.filter((p) => p.closed).length, 1);
  const g = createNeonGeometry(out.result.paths, { ...P, designHeightMm: 60 }, out.result.issues);
  assert.deepEqual(g.errors, []);
  const mesh = g.geometry.parts[0].mesh;
  const audit = meshAudit(mesh);
  assert.equal(audit.bad, 0, "watertight y manifold");
  assert.equal(audit.degenerate, 0);
  assert.equal(buildSTLBlob(mesh).size, 84 + 50 * mesh.triangleCount);
  const layout = computeBedLayout(collectBedItems(g.geometry), getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID));
  assert.equal(layout.plates.length, 1);
  assert.equal(layout.oversize.length, 0);
});

test("JPEG: una foto (ruido natural, sin contraste de logo) NO produce un recorrido absurdo: error o aviso de complejidad", () => {
  // "Foto" sintética: campo de ruido suave multi-escala (sin regiones limpias), como una textura fotográfica.
  const w = 480, h = 360;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const layer = (cell) => {
    const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    const g = Array.from({ length: gw * gh }, rnd);
    return (x, y) => {
      const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const v = (i, j) => g[(y0 + j) * gw + (x0 + i)];
      return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty;
    };
  };
  const l1 = layer(6), l2 = layer(14), l3 = layer(40);
  const photo = makeImage(w, h, (x, y) => {
    const v = Math.round(255 * (0.4 * l1(x, y) + 0.35 * l2(x, y) + 0.25 * l3(x, y)));
    return [v, v, v, 255];
  });
  const out = buildNeonPaths(imageSource(jpgBytes(photo, 75), "jpg", { cleaning: 1 }), 100);
  if (out.ok) {
    assert.ok(out.result.issues.some((i) => i.code === "RASTER_COMPLEX" || i.code === "RASTER_HINT"), "si genera algo, avisa");
  } else {
    assert.match(out.message, /demasiado compleja|foreground|recorrido/i);
  }
  assert.match(
    (() => {
      try {
        convert(makeImage(640, 640, (x, y) => x < 600 && y < 600 && (x % 40 - 20) ** 2 + (y % 40 - 20) ** 2 <= 81));
        return "";
      } catch (e) {
        return e.message;
      }
    })(),
    /Usá un logo, dibujo o imagen de alto contraste/,
  );
});

test("Proyectos Neon con JPG: neon-jpg con contraste y receta; Storage como source.jpg", () => {
  const w = workBase({ fileMeta: { kind: "jpg", fileName: "foto.jpeg", sizeBytes: 4321 }, raster: { ...S, contrast: 35, cleaning: 2, threshold: 111 } });
  const p = serializeNeonProject(w, { storagePath: "u/p/source.jpg" });
  assert.equal(p.source_type, "neon-jpg");
  assert.equal(p.source_data.mimeType, "image/jpeg");
  assert.equal(p.source_data.raster.contrast, 35);
  const back = deserializeNeonProject(p);
  assert.equal(back.fileRef.kind, "jpg");
  assert.equal(back.sourceType, "image");
  assert.deepEqual(back.raster, w.raster);
  assert.equal(normalizeRasterSettings({ contrast: 500 }).contrast, 0, "fuera de rango -> default");
});

test("Transformada de distancia exacta y poda con radio local: el vértice grueso de una 'A' no deja espolones", () => {
  const { distanceTransform } = load(`${R}imageProcessing.ts`);
  const w = 40, h = 20;
  const m = new Uint8Array(w * h);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 35; x++) m[y * w + x] = 1; // barra 30×10
  const d = distanceTransform(m, w, h);
  assert.equal(d[2 * w + 2], 0, "fondo = 0");
  approx(d[9 * w + 20], 5, 1e-6, "centro de una barra de 10 px de alto");
  approx(d[5 * w + 20], 1, 1e-6, "primera fila de foreground");
  // diagonal: distancia euclídea exacta (no de tablero)
  const m2 = new Uint8Array(9 * 9);
  m2[4 * 9 + 4] = 1;
  approx(distanceTransform(m2, 9, 9)[4 * 9 + 4], 1, 1e-6);
  // 'A' gruesa: PNG limpio y con ruido dan la MISMA topología (sin espolones de esquina)
  const A = union(thickLine(30, 270, 150, 30, 12), thickLine(150, 30, 270, 270, 12), thickLine(75, 180, 225, 180, 12));
  const clean = convert(makeImage(300, 300, A), {}, 80);
  const noisy = convert(jpegRoundTrip(makeImage(300, 300, A), 25), {}, 80);
  assert.equal(noisy.paths.length, clean.paths.length);
  assert.equal(noisy.stats.junctions, clean.stats.junctions);
  assert.equal(clean.stats.junctions, 2, "dos bifurcaciones: donde el travesaño toca cada pata");
  assert.equal(clean.stats.loops, 1, "el triángulo entre el travesaño y el vértice");
  assert.equal(clean.stats.endpoints, 2, "los dos pies");
});

function jpegRoundTrip(img, q) {
  const d = jpegJs.decode(jpegJs.encode({ data: img.data, width: img.width, height: img.height }, q).data, { useTArray: true, formatAsRGBA: true });
  return { width: d.width, height: d.height, data: new Uint8Array(d.data) };
}
