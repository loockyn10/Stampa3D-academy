import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

// Importación SVG/PNG de Stampa Maker (0.5). Mismo mecanismo de carga de
// módulos TypeScript que tests/maker-letter-geometry.test.mjs.

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
const { importDesign, designToContourPieces, detectFileKind, extractRawDesign, normalizeDesign } = load("lib/maker/import/importDesign.ts");
const { DesignImportError } = load("lib/maker/import/types.ts");
const { simplifyClosed } = load("lib/maker/import/rasterTrace.ts");
const { createGeometryFromContourPieces } = load("lib/maker/geometry/createLetterGeometry.ts");
const { validateLetterSignParams } = load("lib/maker/validation.ts");
const UPNG = nodeRequire("upng-js");

const PARAMS = {
  text: "", fontId: "montserrat-bold", heightMm: 100, depthMm: 40, wallMm: 1.6, baseMm: 1.2,
  bodyType: "standard", rearExpansionMm: 2, taperStyle: "stepped",
  ribsCount: 0, ribProtrusionMm: 0.8, ribWidthMm: 1.2,
  bevelEnabled: false, bevelDepthMm: 2, bevelInsetMm: 1,
  grooveEnabled: false, grooveInsetMm: 1, grooveWidthMm: 4, groovePositionMm: 20,
  rearBevelEnabled: false, rearBevelDepthMm: 2, rearBevelInsetMm: 1,
  frontType: "open", lidMm: 1.2, lidJoint: "glue", insertDepthMm: 3, clearanceMm: 0.2, lipWallMm: 0.8,
  lidBevelEnabled: false, lidBevelDepthMm: 0.4, lidBevelInsetMm: 0.3,
  maskThicknessMm: 1, maskWallThicknessMm: 1.2, maskSideDepthMm: 5, maskClearanceMm: 0.2,
  diffuserThicknessMm: 0.6, holeDiameterMm: 2, pitchMm: 4, edgeMarginMm: 2,
  channelWidthMm: 6, channelDepthMm: 4, channelOffsetMm: 2, diffuserClearanceMm: 0.2,
};

// --- helpers ---

const svgFile = (content, fileName = "t.svg") => ({ type: "svg", fileName, content });
const pngFile = (bytes, fileName = "t.png") => ({ type: "png", fileName, bytes });
const wrap = (body, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const svgDesign = (body, h = 100, attrs) => importDesign(svgFile(wrap(body, attrs)), h);

function importError(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof DesignImportError, `se esperaba DesignImportError, fue: ${err && err.stack}`);
    return err;
  }
  assert.fail("se esperaba un DesignImportError");
}

function ringArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}
const groupArea = (g) => ringArea(g.outer) - g.holes.reduce((s, h) => s + ringArea(h), 0);
const totalArea = (d) => d.contourGroups.reduce((s, g) => s + groupArea(g), 0);
const vertexCount = (d) => d.contourGroups.reduce((s, g) => s + g.outer.length + g.holes.reduce((a, h) => a + h.length, 0), 0);

function bounds(d) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of d.contourGroups) for (const [x, y] of g.outer) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function makePng(w, h, pixel) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = pixel(x, y);
    const o = (y * w + x) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
  }
  return new Uint8Array(UPNG.encode([data.buffer], w, h, 0));
}

const inCircle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const TRANSPARENT = [0, 0, 0, 0], BLACK_OPAQUE = [0, 0, 0, 255], WHITE = [255, 255, 255, 255];
const alphaImage = (w, h, inside) => makePng(w, h, (x, y) => (inside(x, y) ? BLACK_OPAQUE : TRANSPARENT));
const logoImage = (w, h, inside) => makePng(w, h, (x, y) => (inside(x, y) ? BLACK_OPAQUE : WHITE));
const donut = (cx, cy, ro, ri) => (x, y) => inCircle(cx, cy, ro)(x, y) && !inCircle(cx, cy, ri)(x, y);
const pngDesign = (bytes, h = 100, opts) => importDesign(pngFile(bytes), h, { threshold: 128, invert: false, smoothing: "medium", ...opts });

// --- SVG ---

test("SVG rect: 1 grupo sin huecos, alto exacto, origen en (0,0), aspect ratio conservado (20x10 -> 200x100)", () => {
  const d = svgDesign('<rect x="30" y="40" width="20" height="10"/>');
  assert.equal(d.contourGroups.length, 1);
  assert.equal(d.contourGroups[0].holes.length, 0);
  const b = bounds(d);
  assert.ok(Math.abs(b.minX) < 1e-6 && Math.abs(b.minY) < 1e-6, "el mínimo debe quedar en el origen");
  assert.ok(Math.abs(d.heightMm - 100) < 1e-3, `alto ${d.heightMm}`);
  assert.ok(Math.abs(d.widthMm - 200) < 1e-3, `ancho ${d.widthMm}`);
});

test("SVG normalización: distintos alto en mm dan escala uniforme (mismo aspect ratio)", () => {
  const a = svgDesign('<rect width="30" height="10"/>', 50);
  const b = svgDesign('<rect width="30" height="10"/>', 200);
  assert.ok(Math.abs(a.widthMm / a.heightMm - 3) < 1e-6);
  assert.ok(Math.abs(b.widthMm / b.heightMm - 3) < 1e-6);
  assert.ok(Math.abs(b.heightMm - 200) < 1e-3);
});

test("SVG circle: 1 grupo vectorial (curva aplanada con varios puntos), redondo, área ~ pi*r^2", () => {
  const d = svgDesign('<circle cx="50" cy="50" r="40"/>', 80);
  assert.equal(d.contourGroups.length, 1);
  assert.ok(vertexCount(d) >= 24, `pocos puntos para un círculo: ${vertexCount(d)}`);
  assert.ok(Math.abs(d.widthMm - d.heightMm) < 0.05);
  assert.ok(Math.abs(totalArea(d) / (Math.PI * 40 * 40) - 1) < 0.01, `área ${totalArea(d)}`);
});

const DONUT_PATH_NONZERO = "M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z M 50 25 A 25 25 0 1 0 50 75 A 25 25 0 1 0 50 25 Z";
const DONUT_PATH_SAMEDIR = "M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z M 50 25 A 25 25 0 1 1 50 75 A 25 25 0 1 1 50 25 Z";

test("SVG donut (nonzero, huecos con winding opuesto): UN grupo con 1 hueco, no dos sólidos", () => {
  const d = svgDesign(`<path d="${DONUT_PATH_NONZERO}"/>`);
  assert.equal(d.contourGroups.length, 1);
  assert.equal(d.contourGroups[0].holes.length, 1);
  assert.ok(Math.abs(totalArea(d) / (Math.PI * (50 * 50 - 25 * 25)) - 1) < 0.02);
});

test("SVG donut con fill-rule=evenodd (mismo sentido): 1 hueco; con nonzero el mismo path queda macizo", () => {
  const eo = svgDesign(`<path fill-rule="evenodd" d="${DONUT_PATH_SAMEDIR}"/>`);
  assert.equal(eo.contourGroups.length, 1);
  assert.equal(eo.contourGroups[0].holes.length, 1);
  const nz = svgDesign(`<path d="${DONUT_PATH_SAMEDIR}"/>`);
  assert.equal(nz.contourGroups[0].holes.length, 0, "nonzero con mismo winding no hace hueco");
  // heredado desde el grupo y desde style=
  const inherited = svgDesign(`<g fill-rule="evenodd"><path d="${DONUT_PATH_SAMEDIR}"/></g>`);
  assert.equal(inherited.contourGroups[0].holes.length, 1);
  const styled = svgDesign(`<path style="fill-rule:evenodd" d="${DONUT_PATH_SAMEDIR}"/>`);
  assert.equal(styled.contourGroups[0].holes.length, 1);
});

test("SVG donut hecho con dos círculos (path de círculos concéntricos, evenodd) también da counter", () => {
  const d = svgDesign('<path fill-rule="evenodd" d="M10 50a40 40 0 1 0 80 0a40 40 0 1 0 -80 0zM30 50a20 20 0 1 0 40 0a20 20 0 1 0 -40 0z"/>');
  assert.equal(d.contourGroups.length, 1);
  assert.equal(d.contourGroups[0].holes.length, 1);
});

test("SVG múltiples islas: 3 grupos separados, sin puentes, posiciones relativas conservadas", () => {
  const d = svgDesign('<rect x="0" y="0" width="10" height="10"/><circle cx="50" cy="5" r="5"/><polygon points="80,10 100,10 90,0"/>', 10, 'viewBox="0 0 100 10"');
  assert.equal(d.contourGroups.length, 3);
  const centers = d.contourGroups.map((g) => g.outer.reduce((s, p) => s + p[0], 0) / g.outer.length).sort((a, b) => a - b);
  assert.ok(centers[0] < centers[1] && centers[1] < centers[2]);
  assert.ok(Math.abs(centers[1] - centers[0] - 45) < 3, `separación relativa ${centers[1] - centers[0]}`);
  assert.ok(Math.abs(d.widthMm - 100) < 0.01);
});

test("SVG path con Bézier cúbica/cuadrática/arco: la curva se aplana con precisión (bbox exacto)", () => {
  const cubic = svgDesign('<path d="M0 0 C 0 -30 100 -30 100 0 Z"/>', 100);
  // La cúbica alcanza y=-22.5 (3/4*30): alto = 22.5 -> escala 100/22.5
  assert.ok(vertexCount(cubic) > 10, "la curva debe estar subdividida");
  assert.ok(Math.abs(cubic.widthMm / cubic.heightMm - 100 / 22.5) < 0.05, `aspect ${cubic.widthMm / cubic.heightMm}`);
  const quad = svgDesign('<path d="M0 0 Q 50 -40 100 0 Z"/>', 100);
  assert.ok(Math.abs(quad.widthMm / quad.heightMm - 100 / 20) < 0.05);
  const smooth = svgDesign('<path d="M0 50 C 20 0 40 0 50 50 S 80 100 100 50 L 100 100 L0 100Z"/>');
  assert.equal(smooth.contourGroups.length, 1);
});

test("SVG transforms anidados: translate/scale/rotate/matrix se componen correctamente", () => {
  const a = svgDesign('<g transform="translate(10 5)"><g transform="scale(2 1)"><rect width="10" height="10"/></g></g>', 10);
  assert.ok(Math.abs(a.widthMm - 20) < 1e-3, `ancho ${a.widthMm} (10x escala 2)`);
  const rot = svgDesign('<rect width="40" height="10" transform="rotate(90)"/>', 40);
  assert.ok(Math.abs(rot.widthMm - 10) < 1e-3 && Math.abs(rot.heightMm - 40) < 1e-3, "rotate(90) intercambia ancho/alto");
  const mat = svgDesign('<rect width="10" height="10" transform="matrix(3 0 0 1 7 7)"/>', 10);
  assert.ok(Math.abs(mat.widthMm - 30) < 1e-3);
  const rotPivot = svgDesign('<rect width="40" height="10" transform="rotate(90 20 5)"/>', 40);
  assert.ok(Math.abs(rotPivot.heightMm - 40) < 1e-3);
  const nested = svgDesign('<g transform="rotate(90)"><g transform="scale(2)"><rect width="10" height="5"/></g></g>', 20);
  assert.ok(Math.abs(nested.widthMm - 10) < 1e-3, `ancho ${nested.widthMm}`);
});

test("SVG formas solapadas: se unen en UN sólido (no shells duplicados)", () => {
  const d = svgDesign('<rect x="0" y="0" width="60" height="40"/><rect x="40" y="10" width="60" height="40" fill="red"/>');
  assert.equal(d.contourGroups.length, 1);
  assert.equal(d.contourGroups[0].holes.length, 0);
  const b = bounds(d);
  const sx = 100 / 50; // alto 50 unidades -> 100 mm
  const expectedArea = (60 * 40 + 60 * 40 - 20 * 30) * sx * sx;
  assert.ok(Math.abs(totalArea(d) / expectedArea - 1) < 0.01, `área ${totalArea(d)} vs ${expectedArea}`);
  assert.ok(b.maxX > 0);
});

test("SVG formas ocultas/no rellenas: display:none, visibility:hidden, fill:none, stroke-only, opacity 0, clase CSS fill:none se ignoran", () => {
  const d = svgDesign(
    '<style>.ghost{fill:none}</style>' +
      '<rect width="10" height="10"/>' +
      '<rect x="20" width="10" height="10" style="display:none"/>' +
      '<rect x="30" width="10" height="10" visibility="hidden"/>' +
      '<rect x="40" width="10" height="10" fill="none"/>' +
      '<rect x="50" width="10" height="10" fill="none" stroke="black"/>' +
      '<rect x="60" width="10" height="10" opacity="0"/>' +
      '<rect x="70" width="10" height="10" class="ghost"/>' +
      '<g display="none"><circle cx="90" cy="5" r="5"/></g>',
  );
  assert.equal(d.contourGroups.length, 1);
  assert.ok(Math.abs(d.widthMm - d.heightMm) < 1e-6, "solo el primer rect (cuadrado) es visible");
});

test("SVG sin formas utilizables (todo oculto/sin relleno): error claro SVG_EMPTY", () => {
  const err = importError(() => svgDesign('<rect width="10" height="10" fill="none" stroke="red"/>'));
  assert.equal(err.code, "SVG_EMPTY");
  assert.match(err.message, /formas rellenas/);
});

test("SVG usa <use> interno y defs/symbol: se resuelve; referencias rotas se ignoran", () => {
  const d = svgDesign('<defs><rect id="r" width="10" height="10"/></defs><use href="#r" x="0"/><use href="#r" x="30"/><use href="#nope"/>', 10, 'viewBox="0 0 40 10"');
  assert.equal(d.contourGroups.length, 2);
  assert.ok(Math.abs(d.widthMm - 40) < 1e-3);
});

test("SVG malicioso: <script> se rechaza (SVG_UNSAFE) y jamás se ejecuta", () => {
  globalThis.__svgPwned = false;
  const err = importError(() => svgDesign('<script>globalThis.__svgPwned = true</script><rect width="10" height="10"/>'));
  assert.equal(err.code, "SVG_UNSAFE");
  assert.equal(globalThis.__svgPwned, false);
});

test("SVG malicioso: handlers on* se ignoran (no se leen ni ejecutan) y no afectan la geometría", () => {
  globalThis.__svgPwned = false;
  const d = svgDesign('<rect width="10" height="10" onload="globalThis.__svgPwned=true" onclick="globalThis.__svgPwned=true"/>');
  assert.equal(globalThis.__svgPwned, false);
  assert.equal(d.contourGroups.length, 1);
});

test("SVG malicioso: foreignObject, javascript:, data:, href externo, url() externo, @import y entidades XML se rechazan", () => {
  const cases = [
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><rect width="10" height="10"/>',
    '<a href="javascript:alert(1)"><rect width="10" height="10"/></a>',
    '<image href="data:image/png;base64,AAAA" width="10" height="10"/>',
    '<use href="https://evil.example/x.svg#a"/><rect width="10" height="10"/>',
    '<rect width="10" height="10" fill="url(https://evil.example/g)"/>',
    '<style>@import url(https://evil.example/x.css);</style><rect width="10" height="10"/>',
    '<style>rect{fill:url(http://evil.example/x)}</style><rect width="10" height="10"/>',
  ];
  for (const body of cases) {
    const err = importError(() => svgDesign(body));
    assert.equal(err.code, "SVG_UNSAFE", `caso no rechazado como inseguro: ${body}`);
  }
  const xxe = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
  assert.equal(importError(() => importDesign(svgFile(xxe), 100)).code, "SVG_UNSAFE");
});

test("SVG seguridad: el importador no usa DOMParser/innerHTML/eval/Function (parser propio sobre datos)", () => {
  for (const f of ["xml.ts", "svgImport.ts", "svgGeometry.ts"]) {
    const src = fs.readFileSync(path.join(srcRoot, "lib/maker/import", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/DOMParser|innerHTML|dangerouslySetInnerHTML|\beval\s*\(|new Function|document\./.test(src), `${f} usa una API insegura`);
  }
});

test("SVG con <text>: se rechaza con el mensaje de convertir a curvas (SVG_TEXT)", () => {
  const err = importError(() => svgDesign('<text x="0" y="10">Hola</text>'));
  assert.equal(err.code, "SVG_TEXT");
  assert.match(err.message, /Convertí el texto a curvas/);
});

test("SVG features no soportadas (filter, clip-path, mask, animación, imagen) y SVG inválido dan mensajes claros", () => {
  assert.equal(importError(() => svgDesign('<rect width="10" height="10" filter="url(#f)"/>')).code, "SVG_UNSUPPORTED");
  assert.equal(importError(() => svgDesign('<rect width="10" height="10" clip-path="url(#c)"/>')).code, "SVG_UNSUPPORTED");
  assert.equal(importError(() => svgDesign('<rect width="10" height="10" mask="url(#m)"/>')).code, "SVG_UNSUPPORTED");
  assert.equal(importError(() => svgDesign('<rect width="10" height="10"><animate attributeName="x" from="0" to="5"/></rect>')).code, "SVG_UNSUPPORTED");
  assert.equal(importError(() => importDesign(svgFile("esto no es un svg"), 100)).code, "SVG_INVALID");
  assert.equal(importError(() => importDesign(svgFile("<svg><rect></svg>"), 100)).code, "SVG_INVALID");
  assert.equal(importError(() => svgDesign('<path d="M 0 0 L nope"/>')).code, "SVG_INVALID");
});

test("SVG demasiado grande o forma sin altura: errores controlados", () => {
  const big = wrap("<!--" + "x".repeat(11 * 1024 * 1024) + '--><rect width="1" height="1"/>');
  assert.equal(importError(() => importDesign(svgFile(big), 100)).code, "FILE_TOO_LARGE");
  assert.equal(importError(() => svgDesign('<polygon points="0,5 10,5 20,5"/>')).code, "COLLAPSED");
});

test("SVG evenodd de un logo con counter + isla dentro del counter: jerarquía correcta (anillo, isla interior separada)", () => {
  const d = svgDesign('<path fill-rule="evenodd" d="M0 0H100V100H0Z M20 20H80V80H20Z"/><rect x="40" y="40" width="20" height="20"/>');
  assert.equal(d.contourGroups.length, 2);
  const withHole = d.contourGroups.filter((g) => g.holes.length === 1);
  assert.equal(withHole.length, 1);
});

// --- PNG ---

test("PNG círculo con transparencia (alpha): 1 grupo sin huecos, redondo, área correcta", () => {
  const d = pngDesign(alphaImage(200, 200, inCircle(100, 100, 80)));
  assert.equal(d.contourGroups.length, 1);
  assert.equal(d.contourGroups[0].holes.length, 0);
  assert.ok(Math.abs(d.widthMm / d.heightMm - 1) < 0.02);
  const scale = 100 / 160;
  assert.ok(Math.abs(totalArea(d) / (Math.PI * 80 * 80 * scale * scale) - 1) < 0.03, `área ${totalArea(d)}`);
});

test("PNG donut con transparencia: 1 grupo con 1 counter (no dos sólidos)", () => {
  const d = pngDesign(alphaImage(300, 300, donut(150, 150, 120, 60)));
  assert.equal(d.contourGroups.length, 1);
  assert.equal(d.contourGroups[0].holes.length, 1);
});

test("PNG múltiples islas: 3 grupos independientes con posiciones relativas conservadas", () => {
  const inside = (x, y) => inCircle(50, 50, 30)(x, y) || (x > 150 && x < 230 && y > 20 && y < 80) || inCircle(330, 50, 30)(x, y);
  const d = pngDesign(alphaImage(400, 100, inside));
  assert.equal(d.contourGroups.length, 3);
  const cx = d.contourGroups.map((g) => g.outer.reduce((s, p) => s + p[0], 0) / g.outer.length).sort((a, b) => a - b);
  const scale = 100 / 60;
  assert.ok(Math.abs(cx[2] - cx[0] - 280 * scale) < 4, `distancia ${cx[2] - cx[0]}`);
});

test("PNG logo negro sobre blanco (sin alpha): el fondo NO es material; el logo sí", () => {
  const d = pngDesign(logoImage(200, 200, inCircle(100, 100, 70)));
  assert.equal(d.contourGroups.length, 1);
  assert.equal(d.contourGroups[0].holes.length, 0);
});

test("PNG invertir: logo blanco sobre negro sólo es el logo con Invertir; sin invertir el fondo es material (con hueco)", () => {
  const bytes = makePng(200, 200, (x, y) => (inCircle(100, 100, 60)(x, y) ? WHITE : BLACK_OPAQUE));
  const inverted = pngDesign(bytes, 100, { invert: true });
  assert.equal(inverted.contourGroups.length, 1);
  assert.equal(inverted.contourGroups[0].holes.length, 0);
  assert.ok(Math.abs(inverted.widthMm - inverted.heightMm) < 2, "el logo es un círculo");
  const plain = pngDesign(bytes, 100, { invert: false });
  assert.equal(plain.contourGroups[0].holes.length, 1, "sin invertir el material es el fondo negro, con el círculo como hueco");
  assert.ok(plain.widthMm / plain.heightMm > 0.99 && plain.widthMm / plain.heightMm < 1.01);
});

test("PNG umbral: un gris medio es material o no según el umbral de luminosidad", () => {
  const bytes = makePng(300, 100, (x) => (x < 100 ? [0, 0, 0, 255] : x < 200 ? [128, 128, 128, 255] : WHITE));
  const strict = pngDesign(bytes, 100, { threshold: 60 });
  const loose = pngDesign(bytes, 100, { threshold: 200 });
  assert.ok(loose.widthMm > strict.widthMm * 1.8, `estricto ${strict.widthMm} vs laxo ${loose.widthMm}`);
});

test("PNG simplificación: un círculo grande no genera miles de vértices y conserva la forma", () => {
  const d = pngDesign(alphaImage(800, 800, inCircle(400, 400, 350)));
  const perimeterPx = 2 * Math.PI * 350;
  assert.ok(vertexCount(d) < perimeterPx / 4, `vértices ${vertexCount(d)} (perímetro ${perimeterPx.toFixed(0)}px)`);
  assert.ok(vertexCount(d) > 30);
  const scale = 100 / 700;
  assert.ok(Math.abs(totalArea(d) / (Math.PI * 350 * 350 * scale * scale) - 1) < 0.01);
});

test("simplifyClosed (Douglas-Peucker): colapsa puntos colineales y respeta esquinas", () => {
  const sq = [];
  for (let i = 0; i < 100; i++) sq.push([i, 0]);
  for (let i = 0; i < 100; i++) sq.push([100, i]);
  for (let i = 0; i < 100; i++) sq.push([100 - i, 100]);
  for (let i = 0; i < 100; i++) sq.push([0, 100 - i]);
  const out = simplifyClosed(sq, 0.5);
  assert.ok(out.length <= 8, `quedaron ${out.length} puntos`);
  assert.ok(out.length >= 4);
});

test("PNG ruido: motas de 1-2 píxeles se eliminan; la forma principal y counters relevantes quedan", () => {
  const specks = new Set(["20,20", "180,30", "30,170", "170,175", "100,10", "101,10"]);
  const inside = (x, y) => donut(100, 100, 70, 30)(x, y) || specks.has(`${x},${y}`);
  const d = pngDesign(alphaImage(200, 200, inside));
  assert.equal(d.contourGroups.length, 1, "las motas no deben ser islas");
  assert.equal(d.contourGroups[0].holes.length, 1);
  // agujeros diminutos (pinholes) también se limpian
  const pinholes = (x, y) => inCircle(100, 100, 70)(x, y) && !(x === 100 && y === 100) && !(x === 60 && y === 90);
  const p = pngDesign(alphaImage(200, 200, pinholes));
  assert.equal(p.contourGroups[0].holes.length, 0);
});

test("PNG counters pequeños pero relevantes NO se destruyen", () => {
  const inside = (x, y) => inCircle(200, 200, 150)(x, y) && !inCircle(200, 200, 10)(x, y);
  const d = pngDesign(alphaImage(400, 400, inside));
  assert.equal(d.contourGroups[0].holes.length, 1);
});

test("PNG aspect ratio: 300x100 px a alto 100mm da 300mm de ancho; el mínimo queda en el origen", () => {
  const d = pngDesign(alphaImage(300, 100, (x, y) => x >= 0 && y >= 0 && x < 300 && y < 100 && x > 5 && x < 295 && y > 5 && y < 95));
  const ratio = d.widthMm / d.heightMm;
  assert.ok(Math.abs(ratio - 290 / 90) < 0.06, `ratio ${ratio}`);
  const b = bounds(d);
  assert.ok(Math.abs(b.minX) < 1e-6 && Math.abs(b.minY) < 1e-6);
  assert.ok(Math.abs(d.heightMm - 100) < 1e-3);
});

test("PNG inválido: firma incorrecta, truncado y dimensiones excesivas dan errores controlados", () => {
  assert.equal(importError(() => importDesign(pngFile(new Uint8Array([1, 2, 3, 4])), 100)).code, "PNG_INVALID");
  assert.equal(importError(() => importDesign(pngFile(new TextEncoder().encode("<svg></svg>".repeat(10))), 100)).code, "PNG_INVALID");
  const good = alphaImage(50, 50, inCircle(25, 25, 20));
  assert.equal(importError(() => importDesign(pngFile(good.slice(0, 60)), 100)).code, "PNG_INVALID");
  const header = new Uint8Array(40);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(header.buffer).setUint32(16, 5000);
  new DataView(header.buffer).setUint32(20, 5000);
  const tooBig = importError(() => importDesign(pngFile(header), 100));
  assert.equal(tooBig.code, "PNG_TOO_LARGE");
  assert.match(tooBig.message, /4096/);
  assert.equal(importError(() => importDesign(pngFile(new Uint8Array(11 * 1024 * 1024)), 100)).code, "FILE_TOO_LARGE");
});

test("PNG vacío (todo transparente / todo blanco): TRACE_EMPTY con mensaje claro", () => {
  const empty = importError(() => pngDesign(alphaImage(100, 100, () => false)));
  assert.equal(empty.code, "TRACE_EMPTY");
  const white = importError(() => pngDesign(logoImage(100, 100, () => false)));
  assert.equal(white.code, "TRACE_EMPTY");
});

test("PNG con las mismas opciones es determinístico (mismo resultado dos veces)", () => {
  const bytes = alphaImage(120, 120, donut(60, 60, 50, 20));
  assert.deepEqual(pngDesign(bytes).contourGroups, pngDesign(bytes).contourGroups);
});

test("etapas separadas: normalizeDesign re-escala sin re-trazar (cambiar el alto no rehace el PNG)", () => {
  const src = pngFile(alphaImage(200, 200, inCircle(100, 100, 80)));
  const raw = extractRawDesign(src);
  const a = normalizeDesign(raw, src, 50);
  const b = normalizeDesign(raw, src, 150);
  assert.ok(Math.abs(b.heightMm / a.heightMm - 3) < 1e-6);
});

test("detectFileKind: solo .svg y .png", () => {
  assert.equal(detectFileKind("Logo.SVG"), "svg");
  assert.equal(detectFileKind("a.b.png"), "png");
  assert.equal(detectFileKind("foto.jpg"), null);
  assert.equal(detectFileKind("doc.pdf"), null);
});

// --- Geométricos end-to-end: import -> ContourGroups -> motor Maker ---

function analyzeTopology(positions) {
  const key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
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
  const key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (let t = 0; t < positions.length / 9; t++) {
    const o = t * 9;
    const ks = [0, 1, 2].map((i) => key(positions[o + i * 3], positions[o + i * 3 + 1], positions[o + i * 3 + 2]));
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    parent.set(find(ks[0]), find(ks[1]));
    parent.set(find(ks[1]), find(ks[2]));
  }
  return new Set([...parent.keys()].map(find)).size;
}

function raycast(positions, px, py) {
  const hits = [];
  const sign = (ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
  for (let t = 0; t < positions.length / 9; t++) {
    const o = t * 9;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(o, o + 9);
    const d1 = sign(ax, ay, bx, by), d2 = sign(bx, by, cx, cy), d3 = sign(cx, cy, ax, ay);
    if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.abs(nz) < 1e-9) continue;
    hits.push(az - (nx * (px - ax) + ny * (py - ay)) / nz);
  }
  return hits;
}

const part = (result, kind) => result.parts.find((p) => p.kind === kind)?.mesh;
const holeCenter = (d) => {
  const h = d.contourGroups[0].holes[0];
  return [h.reduce((s, p) => s + p[0], 0) / h.length, h.reduce((s, p) => s + p[1], 0) / h.length];
};

const DONUT_DESIGNS = {
  svg: () => svgDesign(`<path d="${DONUT_PATH_NONZERO}"/>`, 60),
  png: () => pngDesign(alphaImage(400, 400, donut(200, 200, 180, 90)), 60),
};

for (const [kind, make] of Object.entries(DONUT_DESIGNS)) {
  test(`E2E ${kind.toUpperCase()} donut -> ContourGroups -> cuerpo standard: hueco intacto, manifold, watertight, 1 componente`, () => {
    const design = make();
    assert.equal(design.contourGroups[0].holes.length, 1);
    const result = createGeometryFromContourPieces(designToContourPieces(design), PARAMS);
    assert.deepEqual(result.errors, []);
    const body = part(result, "body");
    assert.ok(body.triangleCount > 0);
    const topo = analyzeTopology(body.positions);
    assert.equal(topo.degenerate, 0, "triángulos degenerados");
    assert.equal(topo.nonManifold, 0, "aristas no-manifold");
    assert.equal(topo.boundary, 0, "bordes abiertos");
    assert.equal(components(body.positions), 1);
    const [hx, hy] = holeCenter(design);
    const hits = raycast(body.positions, hx, hy).filter((z) => z > -0.5 && z < PARAMS.depthMm + 0.5);
    assert.deepEqual(hits, [], `el hueco debe estar libre, hay geometría en z=[${hits.join(", ")}]`);
    // El bounding box del resultado sigue las dimensiones importadas.
    assert.ok(Math.abs(result.boundingBox.height - design.heightMm) < 1e-6);
  });

  test(`E2E ${kind.toUpperCase()} donut + tapa con labio interior: sin errores, tapa manifold y 1 componente`, () => {
    const design = make();
    const params = { ...PARAMS, frontType: "lid", lidJoint: "interior-lip", lidMm: 1.2, insertDepthMm: 3, clearanceMm: 0.2, lipWallMm: 0.8 };
    const result = createGeometryFromContourPieces(designToContourPieces(design), params);
    assert.deepEqual(result.errors, []);
    const lid = part(result, "lid");
    const topo = analyzeTopology(lid.positions);
    assert.equal(topo.nonManifold, 0);
    assert.equal(topo.boundary, 0);
    assert.equal(components(lid.positions), 1);
  });
}

test("E2E SVG: bisel frontal + posterior + costillas + tapered + perforado funcionan sobre ContourGroups importados", () => {
  const design = DONUT_DESIGNS.svg();
  const pieces = designToContourPieces(design);
  const bevels = createGeometryFromContourPieces(pieces, { ...PARAMS, bevelEnabled: true, rearBevelEnabled: true, ribsCount: 1 });
  assert.deepEqual(bevels.errors, []);
  assert.equal(analyzeTopology(part(bevels, "body").positions).nonManifold, 0);
  const tapered = createGeometryFromContourPieces(pieces, { ...PARAMS, bodyType: "tapered" });
  assert.equal(analyzeTopology(part(tapered, "body").positions).nonManifold, 0);
  const perforated = createGeometryFromContourPieces(pieces, { ...PARAMS, frontType: "perforated" });
  assert.deepEqual(perforated.errors, []);
  assert.ok(part(perforated, "mask") && part(perforated, "diffuser"));
});

test("E2E múltiples islas: el cuerpo conserva una sola pieza de diseño con todas las islas en sus posiciones", () => {
  const design = svgDesign('<rect width="30" height="30"/><rect x="60" width="30" height="30"/>', 60, 'viewBox="0 0 90 30"');
  const result = createGeometryFromContourPieces(designToContourPieces(design), PARAMS);
  assert.equal(result.letters.length, 1);
  const body = part(result, "body");
  assert.equal(components(body.positions), 2, "cada isla es un componente físico independiente");
  assert.ok(result.boundingBox.width > 170 && result.boundingBox.width < 190);
});

test("Geometría colapsada en un diseño importado: mensaje con 'el diseño importado' (no 'la letra')", () => {
  const design = svgDesign('<rect width="10" height="10"/>', 6);
  const result = createGeometryFromContourPieces(designToContourPieces(design), {
    ...PARAMS, wallMm: 1.6, frontType: "lid", lidJoint: "interior-lip", clearanceMm: 2, lipWallMm: 3,
  });
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.every((e) => /el diseño importado/.test(e.message) && !/la letra/.test(e.message)), result.errors[0].message);
});

test("validateLetterSignParams: con origen archivo no exige texto ni alto de texto", () => {
  const p = { ...PARAMS, text: "", heightMm: 0 };
  assert.ok(validateLetterSignParams(p).some((e) => e.field === "text"));
  assert.deepEqual(validateLetterSignParams(p, { textSource: false }), []);
});
