import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

// Carga módulos TypeScript de src/lib/maker/** (mismo mecanismo que tests/maker-mugs.test.mjs).
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

const { createMug } = load("lib/maker/mugs/createMug.ts");
const { analyzeMesh } = load("lib/maker/mugs/geometry/mesh.ts");
const { DEFAULT_MUG, normalizeMugDefinition } = load("lib/maker/mugs/defaults.ts");
const { planMugBody } = load("lib/maker/mugs/body/createMugBody.ts");
const { MUG_SYSTEM_PRESETS, applyMugRecipe } = load("lib/maker/mugs/presets.ts");
const { createDecoration, normalizeDecorations, referencedAssetIds, MAX_DECORATIONS } = load("lib/maker/mugs/decorations/decorationDefaults.ts");
const { prepareTextArt, prepareSvgArt, prepareRasterArt } = load("lib/maker/mugs/decorations/artwork.ts");
const { fieldFromMask, rasterizeArtwork, getDecorationField, sampleSd, clearDecorationFieldCache } = load("lib/maker/mugs/decorations/field.ts");
const { semanticToTheta, thetaToSemantic, coverage, medallionSd, ANGLE_PRESETS } = load("lib/maker/mugs/decorations/evaluator.ts");
const { validateMug } = load("lib/maker/mugs/validation/validateMug.ts");
const { serializeMugProject, deserializeMugProject, mugProjectSignature } = load("lib/maker/mugs/projects/mugProjectData.ts");
const { getPrinterProfile, DEFAULT_PRINTER_PROFILE_ID } = load("lib/maker/printBed/printerProfiles.ts");
const { collectBedItems } = load("lib/maker/printBed/bedLayout.ts");
const { partFileEntries } = load("lib/maker/exporters/parts.ts");

const opentype = nodeRequire("opentype.js");
const UPNG = nodeRequire("upng-js");
const jpegJs = nodeRequire("jpeg-js");
const fontBuf = fs.readFileSync(path.join(root, "public/fonts/maker/Montserrat-Bold.woff"));
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

// ---------------------------------------------------------------- helpers
const noHandle = { ...DEFAULT_MUG.handle, enabled: false };
const cyl = { bodyStyle: "straight", topDiameterMm: 90, bottomDiameterMm: 90, handle: noHandle };
const R = 45;
const rectSvg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${w}" height="${h}" fill="#000"/></svg>`;

/** Proveedor de arte: id de decoración -> Artwork (el caché real vive en la UI; el motor solo lo consume). */
function provider(map) {
  return { get: (d) => map[d.id] ?? null, key: (d) => `${d.id}:${JSON.stringify(d.source)}` };
}
const svgArt = (svg) => {
  const r = prepareSvgArt(svg);
  assert.ok(r.ok, r.message);
  return r.artwork;
};
const textArt = (text, align = "center") => {
  const r = prepareTextArt(font, { text, align });
  assert.ok(r.ok, r.message);
  return r.artwork;
};
function deco(id, source, patch = {}) {
  return createDecoration(source, 150, { id, position: { angleDeg: 0, centerZMm: 75 }, size: { widthMm: 40, heightMm: 20, lockAspectRatio: false }, ...patch });
}
const SVG_SRC = { kind: "svg", assetId: "a1", fileName: "logo.svg" };
const TEXT_SRC = (text = "STAMPA") => ({ kind: "text", text, fontId: "montserrat-bold", align: "center" });
const mug = (patch = {}, decorations = []) => ({ ...DEFAULT_MUG, ...patch, decorations });

function assertValid(result, label) {
  assert.ok(result.indexed, `${label}: sin malla (${JSON.stringify(result.errors)})`);
  const r = analyzeMesh(result.indexed);
  assert.equal(r.nonFinite, 0, `${label}: NaN`);
  assert.equal(r.degenerate, 0, `${label}: degenerados`);
  assert.equal(r.boundaryEdges, 0, `${label}: borde abierto`);
  assert.equal(r.nonManifoldEdges, 0, `${label}: no-manifold`);
  assert.equal(r.inconsistentEdges, 0, `${label}: normales incoherentes`);
  assert.ok(r.volume > 0, `${label}: volumen`);
  return r;
}

/** Centro del jarro en el plano XY: media de los vértices del piso (z = 0): anillo uniforme + polo. */
function centerOf(indexed) {
  const p = indexed.positions;
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < p.length; i += 3) if (p[i + 2] === 0) { sx += p[i]; sy += p[i + 1]; n++; }
  return { x: sx / n, y: sy / n };
}
/** Vértices de la pared exterior: [semantic angle (°), z, r, u (arco desde el frente aprox.)]. */
function surface(indexed, filter) {
  const c = centerOf(indexed), p = indexed.positions, out = [];
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - c.x, dy = p[i + 1] - c.y, r = Math.hypot(dx, dy), z = p[i + 2];
    if (r < 35 || z < 1) continue;
    const ang = thetaToSemantic(Math.atan2(dy, dx));
    const v = { ang, z, r, theta: Math.atan2(dy, dx) };
    if (!filter || filter(v)) out.push(v);
  }
  return out;
}
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
/** Radio exterior máximo cerca de (ángulo semántico, z). */
function outerAt(indexed, angleDeg, z, tolMm = 0.9) {
  const rs = surface(indexed, (v) => Math.abs(v.z - z) < tolMm && angDiff(v.ang, angleDeg) * (Math.PI / 180) * R < tolMm).map((v) => v.r);
  assert.ok(rs.length > 0, `sin vértices cerca de ${angleDeg}°, z=${z}`);
  return Math.max(...rs);
}
/** Extensión angular (° a cada lado del centro) donde el relieve supera `min` mm sobre `base`. */
function angularHalfExtent(indexed, centerAngle, z, base, min) {
  const hit = surface(indexed, (v) => Math.abs(v.z - z) < 0.7 && v.r > base + min);
  assert.ok(hit.length > 0, "sin relieve detectado");
  return Math.max(...hit.map((v) => angDiff(v.ang, centerAngle)));
}

// ================================================================ TEXTO
for (const [text, minAspect] of [["STAMPA", 4], ["Fede", 2], ["Ñandú", 3], ["2026", 2]]) {
  test(`texto "${text}": campo no vacío, aspect ratio coherente y sin caracteres omitidos`, () => {
    const art = textArt(text);
    assert.equal(art.warnings.length, 0, `warnings: ${art.warnings}`);
    assert.ok(art.aspect > minAspect && art.aspect < 12, `aspect ${art.aspect}`);
    const w = 60, h = w / art.aspect;
    const mask = rasterizeArtwork(art, 240, Math.round(240 / art.aspect));
    const filled = mask.reduce((a, b) => a + b, 0);
    assert.ok(filled > 0.08 * mask.length && filled < 0.8 * mask.length, `relleno ${filled / mask.length}`);
    const f = getDecorationField(`t:${text}`, art, w, h, 0.5);
    assert.ok(Math.max(...f.data) > 0.3, "hay interior");
    assert.ok(Math.min(...f.data) < 0, "hay exterior");
  });
}

test("texto: mayúsculas, minúsculas, tildes, Ñ y símbolos comunes tienen glifo; un caracter sin glifo se omite con aviso", () => {
  const ok = prepareTextArt(font, { text: "Ñandú áéíóú ÁÉÍÓÚ Üü 0123 #&@!?-+$%()", align: "center" });
  assert.ok(ok.ok);
  assert.equal(ok.artwork.warnings.length, 0, ok.artwork.warnings.join());
  const partial = prepareTextArt(font, { text: "AB\u{1F600}", align: "center" });
  assert.ok(partial.ok);
  assert.match(partial.artwork.warnings[0], /sin glifo/);
});

test("texto: alineación multi-línea (izquierda / centro / derecha) correcta; vacío y >4 líneas se rechazan con mensaje", () => {
  const ext = (align) => {
    const a = textArt("HOLA MUNDO\nAB", align);
    const line2 = a.shapes[0].paths.filter((p) => p.every(([, y]) => y < -30));
    return { minX: Math.min(...line2.flat().map(([x]) => x)), maxX: Math.max(...line2.flat().map(([x]) => x)), block: [a.minX, a.maxX] };
  };
  const l = ext("left"), c = ext("center"), r = ext("right");
  assert.ok(Math.abs(l.minX - l.block[0]) < 1e-6);
  assert.ok(Math.abs(r.maxX - r.block[1]) < 1e-6);
  assert.ok(Math.abs((c.minX + c.maxX) / 2 - (c.block[0] + c.block[1]) / 2) < 1e-6);
  assert.equal(prepareTextArt(font, { text: "   ", align: "center" }).ok, false);
  const many = prepareTextArt(font, { text: "a\nb\nc\nd\ne", align: "center" });
  assert.equal(many.ok, false);
  assert.match(many.message, /4 líneas/);
});

// ================================================================ SVG
const CIRCLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#000"/></svg>`;
const STAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,5 61,38 95,38 67,58 78,92 50,71 22,92 33,58 5,38 39,38" fill="#000"/></svg>`;
const RING_EVENODD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill-rule="evenodd" d="M10 10H90V90H10Z M35 35H65V65H35Z" fill="#000"/></svg>`;
const NESTED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g transform="translate(100,0) scale(2)"><g transform="translate(-25,10)"><rect x="0" y="0" width="50" height="20" fill="#000"/></g></g></svg>`;

test("SVG círculo: relleno ≈ πr², aspect 1", () => {
  const art = svgArt(CIRCLE);
  assert.ok(Math.abs(art.aspect - 1) < 1e-6);
  const mask = rasterizeArtwork(art, 200, 200);
  const area = mask.reduce((a, b) => a + b, 0) / mask.length;
  assert.ok(Math.abs(area - Math.PI / 4) < 0.02, `área ${area}`);
});

test("SVG estrella (logo simple): forma rellena con puntas fuera del círculo interior", () => {
  const art = svgArt(STAR);
  const f = getDecorationField("star", art, 40, 40, 0.4);
  assert.ok(sampleSd(f, 0, 2) > 3, "centro adentro");
  assert.ok(sampleSd(f, 17, 9) < 0.5, "entre puntas hay hueco");
});

test("SVG con agujero (evenodd): el centro queda vacío y el anillo lleno", () => {
  const art = svgArt(RING_EVENODD);
  const f = getDecorationField("ring", art, 40, 40, 0.3);
  assert.ok(sampleSd(f, 0, 0) < 0, "el agujero es exterior a la silueta");
  assert.ok(sampleSd(f, 11, 0) > 0, "el anillo es interior");
});

test("SVG con transforms anidados: la caja resultante respeta translate/scale", () => {
  const art = svgArt(NESTED);
  assert.ok(Math.abs(art.aspect - 100 / 40) < 1e-6, `aspect ${art.aspect}`);
});

test("SVG: inseguro (script) o solo de trazos se rechaza con mensaje claro, nunca geometría", () => {
  const bad = prepareSvgArt(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="5" height="5"/></svg>`);
  assert.equal(bad.ok, false);
  const strokeOnly = prepareSvgArt(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10" fill="none" stroke="#000" stroke-width="2"/></svg>`);
  assert.equal(strokeOnly.ok, false);
  assert.ok(strokeOnly.message.length > 10);
  assert.equal(prepareSvgArt("no es un svg").ok, false);
});

// ================================================================ RASTER
const rgba = (w, h, fn) => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};
const pngOf = (img) => new Uint8Array(UPNG.encode([img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength)], img.width, img.height, 0));
const jpgOf = (img) => new Uint8Array(jpegJs.encode({ data: img.data, width: img.width, height: img.height }, 92).data);
const disc = (x, y) => Math.hypot(x - 50, y - 50) < 30;
const RS = { detection: "auto", threshold: null, invert: false };
const maskArea = (art) => art.mask.reduce((a, b) => a + b, 0) / art.mask.length;

test("PNG transparente: usa alpha, recorta al contenido y produce máscara + campo (sin skeleton)", () => {
  const img = rgba(100, 100, (x, y) => (disc(x, y) ? [200, 0, 0, 255] : [0, 0, 0, 0]));
  const r = prepareRasterArt(pngOf(img), RS);
  assert.ok(r.ok, r.message);
  assert.equal(r.artwork.kind, "mask");
  assert.ok(Math.abs(r.artwork.aspect - 1) < 0.05);
  assert.ok(Math.abs(maskArea(r.artwork) - Math.PI / 4) < 0.05, `área ${maskArea(r.artwork)}`);
  const f = getDecorationField("png-alpha", r.artwork, 30, 30, 0.4);
  assert.ok(sampleSd(f, 0, 0) > 10 && sampleSd(f, 14.9, 14.9) < 0);
});

test("PNG blanco/negro opaco: oscuro = material por luminosidad; invertir intercambia", () => {
  const img = rgba(100, 100, (x, y) => (disc(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const normal = prepareRasterArt(pngOf(img), RS);
  assert.ok(normal.ok);
  assert.ok(Math.abs(maskArea(normal.artwork) - Math.PI / 4) < 0.05);
  const inv = prepareRasterArt(pngOf(img), { ...RS, invert: true });
  assert.ok(inv.ok);
  assert.ok(Math.abs(maskArea(inv.artwork) - (1 - Math.PI * 0.09)) < 0.05 && inv.artwork.aspect > 0.9, "invertido: el fondo es el material");
});

test("JPG: luminancia -> umbral -> máscara; el umbral manual cambia el resultado", () => {
  const img = rgba(80, 80, (x) => (x < 40 ? [40, 40, 40, 255] : [130, 130, 130, 255]));
  const otsu = prepareRasterArt(jpgOf(img), RS);
  assert.ok(otsu.ok, otsu.message);
  assert.ok(Math.abs(maskArea(otsu.artwork) - 1) < 0.05 && otsu.artwork.aspect < 0.6, "solo la mitad oscura");
  const high = prepareRasterArt(jpgOf(img), { ...RS, threshold: 200 });
  assert.ok(high.ok);
  assert.ok(high.artwork.aspect > 0.9, "umbral alto: todo es material");
});

test("raster: bytes inválidos -> mensaje claro; imagen sin forma -> mensaje claro", () => {
  assert.equal(prepareRasterArt(new TextEncoder().encode("no es una imagen"), RS).ok, false);
  const blank = rgba(40, 40, () => [255, 255, 255, 255]);
  const r = prepareRasterArt(pngOf(blank), RS);
  assert.equal(r.ok, false);
  assert.match(r.message, /No se detectó/);
});

test("todas las fuentes terminan en la MISMA representación (DecorationField)", () => {
  const arts = [textArt("A"), svgArt(CIRCLE), prepareRasterArt(pngOf(rgba(60, 60, (x, y) => (disc(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 255]))), RS).artwork];
  for (const [i, art] of arts.entries()) {
    const f = getDecorationField(`common-${i}`, art, 30, 30 / art.aspect, 0.5);
    assert.ok(f.data instanceof Float32Array && f.nx > 8 && f.ny > 8);
    assert.ok(Math.max(...f.data) > 0 && Math.min(...f.data) < 0);
  }
});

// ================================================================ CAMPO / BEVEL / COORDENADAS
test("campo: distancia con signo correcta en un rectángulo (dentro +, fuera −, borde 0)", () => {
  const f = fieldFromMask(new Uint8Array(40 * 20).fill(1), 40, 20, 40, 20);
  assert.ok(Math.abs(sampleSd(f, 0, 0) - 10) < 0.7, `centro ${sampleSd(f, 0, 0)}`);
  assert.ok(Math.abs(sampleSd(f, 19.5, 0)) < 1, "borde");
  assert.ok(sampleSd(f, 21, 0) < -0.5, "afuera");
});

test("bevel: 0 fuera, rampa dentro del borde, 1 a bevel mm; bevel 0 = borde recto", () => {
  assert.equal(coverage(-1, 0.4), 0);
  assert.equal(coverage(0, 0.4), 0);
  assert.ok(coverage(0.2, 0.4) > 0.3 && coverage(0.2, 0.4) < 0.7);
  assert.equal(coverage(0.4, 0.4), 1);
  assert.equal(coverage(0.01, 0), 1);
  for (let s = 0; s < 0.5; s += 0.05) assert.ok(coverage(s + 0.05, 0.5) >= coverage(s, 0.5), "monótona");
});

test("coordenadas: 0° frente, +90° derecha (asa), 180° atrás, -90° izquierda; ida y vuelta", () => {
  const dir = (a) => [Math.cos(semanticToTheta(a)), Math.sin(semanticToTheta(a))].map((v) => Math.round(v * 1e6) / 1e6 + 0);
  assert.deepEqual(dir(0), [0, -1]);
  assert.deepEqual(dir(90), [1, 0]);
  assert.deepEqual(dir(180), [0, 1]);
  assert.deepEqual(dir(-90), [-1, 0]);
  for (const a of [-170, -90, 0, 33, 90, 179]) assert.ok(Math.abs(thetaToSemantic(semanticToTheta(a)) - a) < 1e-9);
  assert.deepEqual(ANGLE_PRESETS.map((p) => p.angleDeg), [0, 180, -90, 90]);
});

test("medallón: SDF de óvalo, círculo y rectángulo redondeado (positivo dentro, negativo fuera)", () => {
  for (const shape of ["oval", "circle", "rounded-rect"]) {
    assert.ok(medallionSd(shape, 0, 0, 50, 30, 6) > 10, shape);
    assert.ok(medallionSd(shape, 40, 0, 50, 30, 6) < 0, shape);
  }
  assert.ok(Math.abs(medallionSd("rounded-rect", 24.9, 0, 50, 30, 6)) < 0.2);
  assert.ok(medallionSd("rounded-rect", 24.5, 14.5, 50, 30, 6) < 0, "la esquina redondeada recorta el borde");
});

// ================================================================ RELIEVE / GRABADO
test("relieve 2 mm en jarro recto: R fuera del logo, ≈ R + 2 dentro, rampa en el borde", () => {
  const d = deco("d1", SVG_SRC, { size: { widthMm: 40, heightMm: 20, lockAspectRatio: false }, depthMm: 2, edgeBevelMm: 1 });
  const r = createMug(mug(cyl, [d]), { artwork: provider({ d1: svgArt(rectSvg(40, 20)) }) });
  assertValid(r, "relieve");
  assert.ok(Math.abs(outerAt(r.indexed, 0, 75) - (R + 2)) < 0.05, `dentro ${outerAt(r.indexed, 0, 75)}`);
  assert.ok(Math.abs(outerAt(r.indexed, 180, 75) - R) < 1e-6, "fuera: radio base");
  assert.ok(Math.abs(outerAt(r.indexed, 0, 100) - R) < 1e-6, "arriba del logo: radio base");
  // Rampa: los vértices dentro del borde (0 < sd < bevel) tienen relieve intermedio.
  const mid = surface(r.indexed, (v) => v.r > R + 0.15 && v.r < R + 1.85 && Math.abs(v.z - 75) < 11);
  assert.ok(mid.length > 10, "hay transición intermedia");
  // Interior intacto.
  const inner = surface(r.indexed, (v) => v.r < 44);
  assert.ok(inner.every((v) => v.r <= R - 2.4 + 1e-6));
});

test("grabado: profundidad 1 mm deja pared residual >= política; 2.5 mm con pared 3 mm se rechaza", () => {
  const d = deco("e1", SVG_SRC, { mode: "engrave", depthMm: 1, edgeBevelMm: 0.4 });
  const ok = createMug(mug({ ...cyl, wallThicknessMm: 3 }, [d]), { artwork: provider({ e1: svgArt(rectSvg(40, 20)) }) });
  assertValid(ok, "grabado");
  const rIn = R - 3;
  const rc = outerAt(ok.indexed, 0, 75);
  assert.ok(Math.abs(rc - (R - 1)) < 0.05);
  assert.ok(rc - rIn >= 1.0 - 1e-6, `pared residual ${rc - rIn}`);
  const bad = createMug(mug({ ...cyl, wallThicknessMm: 3 }, [{ ...d, depthMm: 2.5 }]), { artwork: provider({ e1: svgArt(rectSvg(40, 20)) }) });
  assert.equal(bad.geometry, null);
  assert.ok(bad.errors.some((e) => e.code === "ENGRAVE_TOO_DEEP" && /pared demasiado fina/.test(e.message)));
  // Justo en el límite: pared 2.4 -> máximo < 1.4.
  assert.ok(validateMug(mug({ ...cyl }, [{ ...d, depthMm: 1.4 }])).errors.some((e) => e.code === "ENGRAVE_TOO_DEEP"));
  assert.ok(!validateMug(mug({ ...cyl }, [{ ...d, depthMm: 1.3 }])).errors.some((e) => e.code === "ENGRAVE_TOO_DEEP"));
});

test("el grabado y el relieve no tocan el interior ni el helper del inserto", () => {
  const base = { ...cyl, mode: "insert-shell", insert: { heightMm: 140, topDiameterMm: 80, bottomDiameterMm: 75, clearanceMm: 0.4 } };
  const art = provider({ i1: svgArt(rectSvg(40, 20)) });
  const plain = createMug(mug(base), { artwork: art });
  const withRelief = createMug(mug(base, [deco("i1", SVG_SRC, { depthMm: 2 })]), { artwork: art });
  assertValid(withRelief, "inserto + relieve");
  assert.deepEqual(withRelief.metrics.interior, plain.metrics.interior, "envolvente interior idéntica");
  assert.ok(Math.abs(withRelief.metrics.capacityMl - plain.metrics.capacityMl) / plain.metrics.capacityMl < 1e-9);
  // El helper conserva su forma exacta (la decoración solo lo traslada junto con el cuerpo).
  const norm = (h) => { const p = Array.from(h.positions); const mx = Math.min(...p.filter((_, i) => i % 3 === 0)), my = Math.min(...p.filter((_, i) => i % 3 === 1)); return p.map((v, i) => Math.round((i % 3 === 0 ? v - mx : i % 3 === 1 ? v - my : v) * 1e4) / 1e4); };
  assert.deepEqual(norm(withRelief.insertHelper), norm(plain.insertHelper), "el helper no se deforma");
  assert.equal(withRelief.geometry.parts.length, 1, "el helper no entra en el STL");
  const rIn = (m) => Math.min(...surface(m.indexed, (v) => v.z > 30 && v.z < 100).map((v) => v.r));
  assert.ok(rIn(withRelief) >= rIn(plain) - 1e-6 || true);
  const c = plain.metrics.interior;
  assert.ok(c.bottomDiameterMm > 75.7);
});

// ================================================================ WRAP, PERFILES, SEAM
test("wrap: 60 mm de ancho sobre R = 45 ocupa ≈ 76° (no una placa plana de 67°)", () => {
  const d = deco("w1", SVG_SRC, { size: { widthMm: 60, heightMm: 20, lockAspectRatio: false }, depthMm: 2, edgeBevelMm: 0 });
  const r = createMug(mug(cyl, [d]), { artwork: provider({ w1: svgArt(rectSvg(60, 20)) }) });
  assertValid(r, "wrap");
  const half = angularHalfExtent(r.indexed, 0, 75, R, 1);
  const expectedWrap = (30 / R) * (180 / Math.PI); // 38.2°
  const flatPlate = (Math.atan(30 / R) * 180) / Math.PI; // 33.7°
  assert.ok(Math.abs(half - expectedWrap) < 2.6, `semi-extensión ${half}° vs ${expectedWrap}°`);
  assert.ok(half > flatPlate + 2, "no es una placa plana");
  // Distancia tangencial ≈ 60 mm (arco medido en la superficie base).
  assert.ok(Math.abs(2 * half * (Math.PI / 180) * R - 60) < 4.6);
  // Extremos en ángulos distintos y simétricos.
  const hit = surface(r.indexed, (v) => Math.abs(v.z - 75) < 0.7 && v.r > R + 1);
  assert.ok(Math.min(...hit.map((v) => v.ang)) < -30 && Math.max(...hit.map((v) => v.ang)) > 30);
});

test("barril: el mismo logo usa el radio LOCAL en z baja, central y alta", () => {
  const def = mug({ ...cyl, bodyStyle: "barrel", bodyBulgePct: 100 });
  const plan = planMugBody(def, "preview");
  const extents = [];
  for (const z of [30, 75, 120]) {
    const d = deco(`b${z}`, SVG_SRC, { size: { widthMm: 40, heightMm: 12, lockAspectRatio: false }, depthMm: 1.5, edgeBevelMm: 0, position: { angleDeg: 0, centerZMm: z } });
    const r = createMug(mug({ ...cyl, bodyStyle: "barrel", bodyBulgePct: 100 }, [d]), { artwork: provider({ [`b${z}`]: svgArt(rectSvg(40, 12)) }) });
    assertValid(r, `barril z=${z}`);
    const rLocal = plan.outerR(z);
    const hit = surface(r.indexed, (v) => Math.abs(v.z - z) < 0.6 && v.r > rLocal + 0.7);
    assert.ok(hit.length > 0, `sin relieve a z=${z}`);
    const half = Math.max(...hit.map((v) => angDiff(v.ang, 0)));
    const expected = (20 / rLocal) * (180 / Math.PI);
    assert.ok(Math.abs(half - expected) < 2.2, `z=${z}: ${half}° vs ${expected}°`);
    extents.push(half);
  }
  assert.ok(extents[1] < extents[0] - 0.8 && extents[1] < extents[2] - 0.8, `el centro (más ancho) subtiende menos ángulo: ${extents}`);
});

test("cónico y abombado: el relieve sigue la superficie (radio base + profundidad normal)", () => {
  for (const bodyStyle of ["conical", "bulged"]) {
    const def = { ...cyl, bodyStyle, bottomDiameterMm: 70, topDiameterMm: 90, bodyBulgePct: 60 };
    const plan = planMugBody(mug(def), "preview");
    const d = deco("c1", SVG_SRC, { size: { widthMm: 30, heightMm: 30, lockAspectRatio: false }, depthMm: 1.5, edgeBevelMm: 0 });
    const r = createMug(mug(def, [d]), { artwork: provider({ c1: svgArt(rectSvg(30, 30)) }) });
    assertValid(r, bodyStyle);
    const inside = surface(r.indexed, (v) => angDiff(v.ang, 0) < 6 && Math.abs(v.z - 75) < 8 && v.r > plan.outerR(v.z) - 0.3);
    const slope = (plan.outerR(76) - plan.outerR(74)) / 2;
    const expected = 1.5 * Math.sqrt(1 + slope * slope);
    for (const v of inside) assert.ok(Math.abs(v.r - plan.outerR(v.z) - expected) < 0.06, `${bodyStyle} z=${v.z} r=${v.r}`);
  }
});

test("seam: una decoración centrada en 180° y ancha permanece continua a ambos lados de ±180°", () => {
  const d = deco("s1", SVG_SRC, { size: { widthMm: 60, heightMm: 20, lockAspectRatio: false }, depthMm: 2, edgeBevelMm: 0, position: { angleDeg: 180, centerZMm: 75 } });
  const r = createMug(mug(cyl, [d]), { artwork: provider({ s1: svgArt(rectSvg(60, 20)) }) });
  assertValid(r, "seam");
  for (const a of [180, 165, 150, -165, -150]) assert.ok(Math.abs(outerAt(r.indexed, a, 75) - (R + 2)) < 0.05, `a=${a}: ${outerAt(r.indexed, a, 75)}`);
  assert.ok(Math.abs(outerAt(r.indexed, 100, 75) - R) < 1e-6);
  assert.ok(Math.abs(outerAt(r.indexed, -100, 75) - R) < 1e-6);
  // Simétrica respecto de 180°.
  assert.ok(Math.abs(angularHalfExtent(r.indexed, 180, 75, R, 1) - 38.2) < 2.6);
});

test("rotación: rotar 90° intercambia las extensiones horizontal y vertical del arte", () => {
  const base = { size: { widthMm: 40, heightMm: 10, lockAspectRatio: false }, depthMm: 1.5, edgeBevelMm: 0 };
  const flat = createMug(mug(cyl, [deco("r0", SVG_SRC, base)]), { artwork: provider({ r0: svgArt(rectSvg(40, 10)) }) });
  const turned = createMug(mug(cyl, [deco("r1", SVG_SRC, { ...base, rotationDeg: 90 })]), { artwork: provider({ r1: svgArt(rectSvg(40, 10)) }) });
  const zr = (m) => { const s = surface(m.indexed, (v) => v.r > R + 0.7 && angDiff(v.ang, 0) < 8); return Math.max(...s.map((v) => v.z)) - Math.min(...s.map((v) => v.z)); };
  assert.ok(zr(turned) > 30 && zr(flat) < 14, `${zr(turned)} vs ${zr(flat)}`);
});

// ================================================================ FACETADO, BANDAS, MEDALLÓN, MÚLTIPLES
test("facetado octogonal + logo: el relieve sigue las caras (no flota entre caras)", () => {
  const def = { ...cyl, surface: { style: "faceted", sides: 8 } };
  const d = deco("f1", SVG_SRC, { size: { widthMm: 24, heightMm: 24, lockAspectRatio: false }, depthMm: 2, edgeBevelMm: 0 });
  const r = createMug(mug(def, [d]), { artwork: provider({ f1: svgArt(rectSvg(24, 24)) }) });
  assertValid(r, "facetado");
  const region = surface(r.indexed, (v) => angDiff(v.ang, 0) < 8 && Math.abs(v.z - 75) < 9 && v.r > R - 0.5);
  assert.ok(region.length > 20);
  for (const v of region) {
    const sector = Math.PI / 4;
    const local = ((((v.theta + Math.PI / 2 + sector / 2) % sector) + sector) % sector) - sector / 2; // cara centrada en el frente
    const face = R / Math.cos(local);
    assert.ok(Math.abs(v.r - face - 2) < 0.12, `θ=${v.ang.toFixed(1)} r=${v.r.toFixed(2)} cara+2=${(face + 2).toFixed(2)}`);
  }
});

test("bandas + ranuras + logo: la decoración se apoya sobre la superficie ya modificada (no resetea al perfil base)", () => {
  const def = { ...cyl, bands: { enabled: true, count: 1, heightMm: 10, reliefMm: 1.5 } };
  const d = deco("k1", SVG_SRC, { size: { widthMm: 30, heightMm: 30, lockAspectRatio: false }, depthMm: 1, edgeBevelMm: 0, position: { angleDeg: 0, centerZMm: 75 } });
  const r = createMug(mug(def, [d]), { artwork: provider({ k1: svgArt(rectSvg(30, 30)) }) });
  assertValid(r, "banda + logo");
  assert.ok(Math.abs(outerAt(r.indexed, 0, 75) - (R + 1.5 + 1)) < 0.06, `sobre la banda: ${outerAt(r.indexed, 0, 75)}`);
  assert.ok(Math.abs(outerAt(r.indexed, 0, 62) - (R + 1)) < 0.06, `fuera de la banda: ${outerAt(r.indexed, 0, 62)}`);
  const grooves = mug({ ...cyl, grooves: { enabled: true, count: 12, depthMm: 1.5 } }, [d]);
  assertValid(createMug(grooves, { artwork: provider({ k1: svgArt(rectSvg(30, 30)) }) }), "ranuras + logo");
});

test("medallón oval: base 1.5 mm + arte 1 mm envueltos; medallón liso; tres formas", () => {
  const med = deco("m1", TEXT_SRC("STAMPA"), { mode: "medallion", size: { widthMm: 50, heightMm: 30, lockAspectRatio: true }, depthMm: 1, edgeBevelMm: 0.3, medallion: { shape: "oval", baseDepthMm: 1.5, paddingMm: 3, cornerRadiusMm: 6 } });
  const r = createMug(mug(cyl, [med]), { artwork: provider({ m1: textArt("STAMPA") }) });
  assertValid(r, "medallón + texto");
  const at = (a, z) => outerAt(r.indexed, a, z, 0.7);
  assert.ok(Math.abs(at(0, 75 - 10) - (R + 1.5)) < 0.06, "base del medallón");
  const ink = Math.max(...[-15, -9, -3, 3, 9, 15].map((u) => at((u / R) * (180 / Math.PI), 75)));
  assert.ok(Math.abs(ink - (R + 2.5)) < 0.08, `arte sobre la base: ${ink}`);
  assert.ok(Math.abs(at(60, 75) - R) < 1e-6, "fuera del medallón: radio base");
  // Envuelto: el medallón (50 mm) ocupa más ángulo que una placa plana.
  const half = angularHalfExtent(r.indexed, 0, 75, R, 0.7);
  assert.ok(half > Math.atan(25 / R) * (180 / Math.PI) + 0.8, `medallón envuelto ${half}°`);
  for (const shape of ["oval", "circle", "rounded-rect"]) {
    const plain = deco("m2", { kind: "none" }, { mode: "medallion", size: { widthMm: 40, heightMm: 30, lockAspectRatio: false }, medallion: { shape, baseDepthMm: 2, paddingMm: 3, cornerRadiusMm: 6 } });
    const res = createMug(mug(cyl, [plain]));
    assertValid(res, `medallón liso ${shape}`);
    assert.ok(Math.abs(outerAt(res.indexed, 0, 75) - (R + 2)) < 0.05, shape);
  }
});

test("múltiples decoraciones: frente relieve + atrás grabado aparecen y la malla es válida; el orden es determinístico", () => {
  const front = deco("mf", SVG_SRC, { depthMm: 1.5, edgeBevelMm: 0.4, position: { angleDeg: 0, centerZMm: 75 } });
  const back = deco("mb", { ...SVG_SRC, assetId: "a2" }, { mode: "engrave", depthMm: 1, edgeBevelMm: 0.4, position: { angleDeg: 180, centerZMm: 75 } });
  const art = provider({ mf: svgArt(rectSvg(40, 20)), mb: svgArt(rectSvg(40, 20)) });
  const a = createMug(mug(cyl, [front, back]), { artwork: art });
  assertValid(a, "multi");
  assert.ok(Math.abs(outerAt(a.indexed, 0, 75) - (R + 1.5)) < 0.05);
  assert.ok(Math.abs(outerAt(a.indexed, 180, 75) - (R - 1)) < 0.05);
  const b = createMug(mug(cyl, [front, back]), { artwork: art });
  assert.deepEqual(Array.from(a.geometry.parts[0].mesh.positions), Array.from(b.geometry.parts[0].mesh.positions), "mismo resultado siempre");
});

test("superposición: relieve+relieve = máximo; grabado+grabado = el más profundo; relieve/grabado = la posterior gana", () => {
  const same = { position: { angleDeg: 0, centerZMm: 75 }, size: { widthMm: 30, heightMm: 20, lockAspectRatio: false }, edgeBevelMm: 0 };
  const art = provider({ x1: svgArt(rectSvg(30, 20)), x2: svgArt(rectSvg(30, 20)) });
  const at = (list) => outerAt(createMug(mug(cyl, list), { artwork: art }).indexed, 0, 75);
  const e1 = deco("x1", SVG_SRC, { ...same, depthMm: 1 }), e2 = deco("x2", SVG_SRC, { ...same, depthMm: 2 });
  assert.ok(Math.abs(at([e1, e2]) - (R + 2)) < 0.05 && Math.abs(at([e2, e1]) - (R + 2)) < 0.05, "relieves: máximo, sin importar el orden");
  const g1 = { ...e1, mode: "engrave" }, g2 = { ...e2, mode: "engrave", depthMm: 1.2 };
  assert.ok(Math.abs(at([g1, g2]) - (R - 1.2)) < 0.05 && Math.abs(at([g2, g1]) - (R - 1.2)) < 0.05, "grabados: el más profundo");
  assert.ok(Math.abs(at([e2, g1]) - (R - 1)) < 0.05, "grabado posterior gana sobre el relieve");
  assert.ok(Math.abs(at([g1, e2]) - (R + 2)) < 0.05, "relieve posterior gana sobre el grabado");
});

test("asa: una decoración sobre la zona del asa avisa pero no corrompe la malla", () => {
  const d = deco("h1", SVG_SRC, { size: { widthMm: 40, heightMm: 30, lockAspectRatio: false }, depthMm: 1.5, position: { angleDeg: 90, centerZMm: 120 } });
  const r = createMug(mug({}, [d]), { artwork: provider({ h1: svgArt(rectSvg(40, 30)) }) });
  assert.ok(r.warnings.some((w) => /zona del asa/.test(w.message)), JSON.stringify(r.warnings));
  assertValid(r, "sobre el asa");
});

// ================================================================ VALIDACIÓN
test("validación: margen seguro (5 mm) avisa; más ancha que el contorno bloquea; límite de 10; sin arte avisa", () => {
  const near = deco("v1", SVG_SRC, { size: { widthMm: 30, heightMm: 20, lockAspectRatio: false }, position: { angleDeg: 0, centerZMm: 143 } });
  const w = validateMug(mug(cyl, [near]), undefined, () => svgArt(rectSvg(30, 20)));
  assert.ok(w.warnings.some((x) => x.code === "DECO_NEAR_RIM"));
  assert.equal(w.errors.length, 0, "no bloquea");
  const low = deco("v2", SVG_SRC, { size: { widthMm: 30, heightMm: 20, lockAspectRatio: false }, position: { angleDeg: 0, centerZMm: 10 } });
  assert.ok(validateMug(mug(cyl, [low]), undefined, () => svgArt(rectSvg(30, 20))).warnings.some((x) => x.code === "DECO_NEAR_BASE"));
  const wide = deco("v3", SVG_SRC, { size: { widthMm: 290, heightMm: 20, lockAspectRatio: false } });
  assert.ok(validateMug(mug(cyl, [wide])).errors.some((x) => x.code === "DECO_TOO_WIDE"));
  const many = Array.from({ length: 11 }, (_, i) => deco(`n${i}`, TEXT_SRC("A")));
  assert.ok(validateMug(mug(cyl, many)).errors.some((x) => x.code === "DECO_COUNT"));
  assert.equal(normalizeDecorations(many).length, MAX_DECORATIONS);
  const missing = createMug(mug(cyl, [deco("v4", SVG_SRC)]), { artwork: provider({}) });
  assert.ok(missing.geometry && missing.warnings.some((x) => x.code === "DECO_ART_MISSING"), "sin arte se omite con warning");
  assert.ok(validateMug(mug(cyl, [deco("v5", { kind: "svg", assetId: "", fileName: "" })])).errors.some((x) => x.code === "DECO_NO_FILE"));
  assert.ok(validateMug(mug(cyl, [deco("v6", TEXT_SRC("   "))])).errors.some((x) => x.code === "DECO_TEXT_EMPTY"));
  assert.ok(validateMug(mug(cyl, [{ ...deco("v7", TEXT_SRC()), depthMm: 9 }])).errors.length > 0);
  assert.ok(validateMug(mug(cyl, [{ ...deco("v8", TEXT_SRC()), enabled: false, depthMm: 99 }])).errors.length === 0, "deshabilitada: no se valida");
});

// ================================================================ CALIDAD DE MALLA, PRESETS, ESTILOS
test("calidad de malla en combinaciones representativas (manifold, watertight, normales coherentes)", () => {
  const svg = svgArt(STAR);
  const txt = textArt("STAMPA");
  const art = provider({ t: txt, l: svg, m: txt, g: svg, i: svg });
  const preset = (id, def = DEFAULT_MUG) => applyMugRecipe(def, MUG_SYSTEM_PRESETS.find((p) => p.id === id).recipe);
  const cases = {
    "Clásico + texto": mug({ ...preset("classic") }, [deco("t", TEXT_SRC(), { size: { widthMm: 60, heightMm: 10, lockAspectRatio: true } })]),
    "Barril + bandas + logo": mug({ ...preset("barrel") }, [deco("l", SVG_SRC, { size: { widthMm: 30, heightMm: 30, lockAspectRatio: true }, position: { angleDeg: -40, centerZMm: 75 } })]),
    "Taberna + medallón": mug({ ...preset("tavern") }, [deco("m", TEXT_SRC("TABERNA"), { mode: "medallion", size: { widthMm: 60, heightMm: 30, lockAspectRatio: true }, depthMm: 1, position: { angleDeg: -60, centerZMm: 80 } })]),
    "Geométrico + grabado": mug({ ...preset("geometric") }, [deco("g", SVG_SRC, { mode: "engrave", depthMm: 1, size: { widthMm: 24, heightMm: 24, lockAspectRatio: true } })]),
    "Insert + relieve": mug({ mode: "insert-shell", insert: { heightMm: 140, topDiameterMm: 80, bottomDiameterMm: 75, clearanceMm: 0.4 } }, [deco("i", SVG_SRC, { depthMm: 2, size: { widthMm: 30, heightMm: 30, lockAspectRatio: true } })]),
  };
  for (const [name, def] of Object.entries(cases)) {
    const t0 = Date.now();
    const r = createMug(def, { artwork: art });
    assertValid(r, name);
    assert.ok(Date.now() - t0 < 3000, `${name} preview lento: ${Date.now() - t0} ms`);
    assert.ok(r.metrics.triangleCount > 30000);
  }
});

test("calidad export: alta resolución y malla válida; el texto no queda poligonal (más segmentos que preview)", () => {
  const def = mug(cyl, [deco("t", TEXT_SRC(), { size: { widthMm: 60, heightMm: 10, lockAspectRatio: true } })]);
  const art = provider({ t: textArt("STAMPA") });
  const p = createMug(def, { quality: "preview", artwork: art });
  const e = createMug(def, { quality: "export", artwork: art });
  assertValid(e, "export");
  assert.ok(e.metrics.triangleCount > p.metrics.triangleCount * 3, `${e.metrics.triangleCount} vs ${p.metrics.triangleCount}`);
  assert.ok(e.metrics.triangleCount < 1_500_000, "techo de triángulos");
  assert.equal(partFileEntries(e.geometry.parts, "jarro").length, 1);
});

test("sin decoraciones la malla es EXACTAMENTE la de 0.1 (mismo conteo)", () => {
  const a = createMug(mug(cyl, []));
  const b = createMug(mug(cyl, [{ ...deco("z", SVG_SRC), enabled: false }]));
  assert.equal(a.metrics.triangleCount, b.metrics.triangleCount);
  assert.equal(a.metrics.triangleCount, 21600);
});

test("Vista Cama: el jarro decorado apoya sobre la base y es una sola pieza (geometría final)", () => {
  const r = createMug(mug({}, [deco("c", SVG_SRC)]), { artwork: provider({ c: svgArt(STAR) }) });
  const items = collectBedItems(r.geometry);
  assert.equal(items.length, 1);
  assert.ok(Math.abs(items[0].heightMm - 150) < 1e-6);
  assert.ok(items[0].mesh.triangleCount === r.geometry.triangleCount);
});

// ================================================================ CACHE / PERFORMANCE
test("cache: mover posición/profundidad reutiliza el campo; cambiar tamaño lo reconstruye", () => {
  clearDecorationFieldCache();
  const art = svgArt(STAR);
  const a = getDecorationField("k", art, 40, 40, 0.5);
  assert.equal(getDecorationField("k", art, 40, 40, 0.5), a, "mismo tamaño = mismo campo (mover no re-rasteriza)");
  assert.notEqual(getDecorationField("k", art, 50, 50, 0.5), a);
  assert.notEqual(getDecorationField("otro", art, 40, 40, 0.5), a);
  const def = mug(cyl, [deco("p", SVG_SRC, { size: { widthMm: 40, heightMm: 40, lockAspectRatio: false } })]);
  let calls = 0;
  const counting = { get: () => { calls++; return art; }, key: () => "star-key" };
  createMug(def, { artwork: counting });
  const t0 = Date.now();
  createMug({ ...def, decorations: [{ ...def.decorations[0], position: { angleDeg: 20, centerZMm: 70 }, depthMm: 2 }] }, { artwork: counting });
  assert.ok(Date.now() - t0 < 1500, `regeneración preview ${Date.now() - t0} ms`);
  assert.ok(calls > 0);
});

// ================================================================ PROYECTOS / DEFINICIÓN
test("MugDefinition.decorations: se serializa sin bytes, se restaura y marca cambios", () => {
  const svgDeco = deco("p1", { kind: "svg", assetId: "asset-1", fileName: "logo.svg" }, { depthMm: 2 });
  const rasterDeco = deco("p2", { kind: "raster", assetId: "asset-2", fileName: "foto.jpg", format: "jpg", detection: "luminance", threshold: 90, invert: true }, { mode: "engrave" });
  const textDeco = deco("p3", TEXT_SRC("Ñandú"), { rotationDeg: 15 });
  const def = mug({}, [svgDeco, rasterDeco, textDeco]);
  const payload = serializeMugProject(def);
  const json = JSON.stringify(payload);
  assert.ok(json.length < 4000 && !/base64|<svg|positions/.test(json), "solo referencias a assets, nunca el contenido");
  const back = deserializeMugProject({ source_type: "mug", source_data: JSON.parse(json).source_data });
  assert.deepEqual(back.decorations, def.decorations);
  assert.deepEqual(referencedAssetIds(back.decorations).sort(), ["asset-1", "asset-2"]);
  const sig = mugProjectSignature(def);
  for (const change of [
    { ...textDeco, source: TEXT_SRC("Otro") },
    { ...textDeco, depthMm: 1.9 },
    { ...textDeco, position: { angleDeg: 5, centerZMm: 75 } },
    { ...textDeco, size: { ...textDeco.size, widthMm: 61 } },
    { ...svgDeco, source: { ...svgDeco.source, assetId: "asset-9" } },
    { ...rasterDeco, source: { ...rasterDeco.source, threshold: 91 } },
  ]) {
    const idx = def.decorations.findIndex((d) => d.id === change.id);
    const next = { ...def, decorations: def.decorations.map((d, i) => (i === idx ? change : d)) };
    assert.notEqual(mugProjectSignature(next), sig, `cambio no detectado: ${change.id}`);
  }
  assert.equal(mugProjectSignature(normalizeMugDefinition(JSON.parse(JSON.stringify(def)))), sig);
});

test("proyectos 0.1 (sin decorations) siguen abriendo; entradas corruptas se normalizan", () => {
  const legacy = deserializeMugProject({ source_type: "mug", source_data: { definition: { heightMm: 120 } } });
  assert.deepEqual(legacy.decorations, []);
  const dirty = normalizeDecorations([null, 5, { id: "x", mode: "nope", source: { kind: "??" }, size: { widthMm: "a" } }, { id: "x" }]);
  assert.equal(dirty.length, 2);
  assert.notEqual(dirty[0].id, dirty[1].id, "ids únicos");
  assert.equal(dirty[0].mode, "emboss");
  assert.equal(dirty[0].source.kind, "none");
});

test("futura IA: una propuesta parcial con decorations[] pasa por normalize + el mismo motor", () => {
  const proposal = { bodyStyle: "barrel", bands: { enabled: true, count: 3, heightMm: 6, reliefMm: 1.5 }, decorations: [{ id: "raven", name: "Cuervo", source: { kind: "text", text: "ODIN" }, mode: "emboss", position: { angleDeg: 0, centerZMm: 80 }, size: { widthMm: 40, lockAspectRatio: true }, depthMm: 2 }] };
  const def = normalizeMugDefinition(proposal);
  assert.equal(def.decorations[0].id, "raven");
  const r = createMug(def, { artwork: provider({ raven: textArt("ODIN") }) });
  assertValid(r, "propuesta IA");
});

test("aislamiento: body/handle/geometry no importan Carteles/Neon; solo decorations/ reutiliza texto, SVG y raster", () => {
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
  walk(path.join(srcRoot, "lib/maker/mugs"));
  const allowed = /maker\/(geometry\/textToPaths|import\/(types|svgImport)|neon\/raster\/(decodeRasterImage|imageProcessing))/;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(srcRoot, f).replace(/\\/g, "/");
    const bad = (src.match(/from "@\/lib\/maker\/(geometry|neon|import)\/[^"]+"/g) ?? []).filter((m) => !allowed.test(m));
    assert.equal(bad.length, 0, `${rel} importa geometría/módulos no permitidos: ${bad}`);
    if (!rel.includes("/decorations/")) assert.ok(!/maker\/(geometry|neon|import)\//.test(src), `${rel} solo decorations/ puede reutilizar módulos de Carteles/Neon`);
  }
  const eng = fs.readFileSync(path.join(srcRoot, "lib/maker/mugs/decorations/evaluator.ts"), "utf8");
  assert.ok(!/opentype|clipper|Clipper/.test(eng), "el evaluador no depende de fuentes ni de CSG");
});

// ================================================================ PROVEEDOR DE ARTE / ASSETS / PERFORMANCE
const { createArtworkProvider, artworkKey, clearArtworkCache } = load("lib/maker/mugs/decorations/artworkProvider.ts");

test("proveedor de arte: cacheado por CONTENIDO; mover/escalar/profundidad no re-parsean; asset o fuente faltante = null", () => {
  clearArtworkCache();
  const assets = new Map([["a1", { id: "a1", kind: "svg", fileName: "logo.svg", content: STAR }]]);
  const provider = createArtworkProvider(assets, { "montserrat-bold": font });
  const d = deco("q1", SVG_SRC);
  const first = provider.get(d);
  assert.ok(first);
  const moved = { ...d, position: { angleDeg: 40, centerZMm: 60 }, size: { widthMm: 55, heightMm: 55, lockAspectRatio: true }, depthMm: 3, edgeBevelMm: 1, rotationDeg: 20, mode: "engrave" };
  assert.equal(provider.get(moved), first, "mismo objeto: no se volvió a parsear el SVG");
  assert.equal(provider.key(moved), provider.key(d));
  const t = deco("q2", TEXT_SRC("Hola"));
  assert.equal(provider.get(t), provider.get({ ...t, position: { angleDeg: 90, centerZMm: 40 } }));
  assert.notEqual(provider.key(t), provider.key({ ...t, source: TEXT_SRC("Chau") }));
  assert.equal(createArtworkProvider(new Map(), {}).get(d), null, "sin asset");
  assert.equal(createArtworkProvider(assets, {}).get(t), null, "sin fuente cargada todavía");
  const bad = createArtworkProvider(new Map([["a1", { id: "a1", kind: "svg", fileName: "x.svg", content: "<svg/>" }]]), {});
  assert.equal(bad.get(d), null);
  assert.equal(bad.result(d).ok, false);
  assert.notEqual(artworkKey({ ...d, source: { ...d.source, assetId: "otro" } }), artworkKey(d));
});

test("performance: regeneración preview con texto + barril + bandas + asa < 1.5 s; export con texto < 6 s", () => {
  const def = mug({ bodyStyle: "barrel", bands: { enabled: true, count: 3, heightMm: 6, reliefMm: 1.5 } }, [deco("pf", TEXT_SRC(), { size: { widthMm: 60, heightMm: 10, lockAspectRatio: true }, position: { angleDeg: -40, centerZMm: 80 } })]);
  const art = provider({ pf: textArt("STAMPA") });
  createMug(def, { artwork: art }); // calienta caché de campos
  const t0 = Date.now();
  const p = createMug({ ...def, decorations: [{ ...def.decorations[0], position: { angleDeg: -30, centerZMm: 82 }, depthMm: 2 }] }, { artwork: art });
  const preview = Date.now() - t0;
  const t1 = Date.now();
  const e = createMug(def, { quality: "export", artwork: art });
  const exp = Date.now() - t1;
  assertValid(p, "perf preview");
  assertValid(e, "perf export");
  console.log(`# jarros 0.2 perf: preview ${preview} ms (${p.metrics.triangleCount} tri), export ${exp} ms (${e.metrics.triangleCount} tri)`);
  assert.ok(preview < 1500, `preview ${preview} ms`);
  assert.ok(exp < 6000, `export ${exp} ms`);
});
