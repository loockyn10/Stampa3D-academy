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
const { textToNeonPaths, layoutNeonText } = load("lib/maker/neon/paths/textToNeonPaths.ts");
const { svgToNeonPaths, inspectNeonSvg, SVG_FILL_ONLY_MESSAGE, SVG_NO_ROUTES_MESSAGE } = load("lib/maker/neon/paths/svgToNeonPaths.ts");
const { neonPathLength } = load("lib/maker/neon/metrics/pathLength.ts");
const { DEFAULT_NEON_PARAMS } = load("lib/maker/neon/defaults.ts");
const { NEON_FONTS, getNeonFont } = load("lib/maker/neon/fonts/neonFonts.ts");
const { MISTRAL_SINGLELINE_DATA } = load("lib/maker/neon/fonts/data/mistralSingleLine.ts");
const { RELIEF_SINGLELINE_DATA } = load("lib/maker/neon/fonts/data/reliefSingleLine.ts");
const { parsePathData } = load("lib/maker/import/svgGeometry.ts");
const { cascadeStyle, collectRules, isNoPaint } = load("lib/maker/neon/paths/svgStyles.ts");

const P = DEFAULT_NEON_PARAMS;
const svg = (body, attrs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ${attrs}>${body}</svg>`;
const D = 'd="M10 10 L50 90 L90 10"';
const approx = (a, b, tol, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} esperado ${b} ± ${tol}, obtenido ${a}`);
const opts = { fontId: "relief-singleline", letterSpacingPct: 0 };
const boundsOf = (paths) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const [x, y] of p.points) [minX, maxX, minY, maxY] = [Math.min(minX, x), Math.max(maxX, x), Math.min(minY, y), Math.max(maxY, y)];
  return { minX, minY, maxX, maxY };
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
// SVG: clasificación fill / stroke
// --------------------------------------------------------------------------

test("SVG 1: <path fill=none stroke=black> -> acepta", () => {
  const r = svgToNeonPaths(svg(`<path ${D} fill="none" stroke="black"/>`), 100, opts);
  assert.equal(r.paths.length, 1);
  assert.deepEqual(r.stats, { shapes: 1, strokeRoutes: 1, fillOnly: 0, textElements: 0, ignored: 0, paths: 1 });
});

test("SVG 2: <path fill=black stroke=none> -> rechaza con el mensaje de solo-relleno", () => {
  for (const attrs of ['fill="black" stroke="none"', 'fill="#000"', 'style="fill:#000;stroke:none"']) {
    const out = buildNeonPaths({ type: "svg", fileName: "a.svg", content: svg(`<path ${D} Z ${attrs}/>`), ...opts }, 50);
    assert.equal(out.ok, false, attrs);
    assert.equal(out.message, SVG_FILL_ONLY_MESSAGE);
  }
  assert.match(SVG_FILL_ONLY_MESSAGE, /únicamente formas rellenas/);
  assert.match(SVG_FILL_ONLY_MESSAGE, /línea central se agregará más adelante/);
  const stats = inspectNeonSvg(svg(`<path ${D} fill="black" stroke="none"/>`));
  assert.equal(stats.fillOnly, 1);
  assert.equal(stats.strokeRoutes, 0);
});

test("SVG 3: fill=black stroke=black -> usa el stroke (ignora el relleno), sin warning de relleno", () => {
  const r = svgToNeonPaths(svg(`<path ${D} fill="#fff" stroke="#000"/><path d="M0 0 L100 0 L100 100 Z" fill="black" stroke="black" stroke-width="0.1"/>`), 100, opts);
  assert.equal(r.paths.length, 2);
  assert.equal(r.paths[1].closed, true, "el Z se conserva: recorrido cerrado");
  assert.equal(r.issues.filter((i) => i.code === "IGNORED_FILLED_SHAPES").length, 0);
  assert.equal(r.stats.fillOnly, 0);
  // stroke-width NO cambia el recorrido: mismo largo con 0.1 o 30.
  const thin = svgToNeonPaths(svg(`<path ${D} fill="none" stroke="#000" stroke-width="0.1"/>`), 100, opts).paths;
  const thick = svgToNeonPaths(svg(`<path ${D} fill="none" stroke="#000" stroke-width="30"/>`), 100, opts).paths;
  assert.equal(neonPathLength(thin[0]), neonPathLength(thick[0]));
});

test("SVG 4: style=\"fill:none;stroke:black\" -> acepta (y style pisa al atributo)", () => {
  assert.equal(svgToNeonPaths(svg(`<path ${D} style="fill:none;stroke:black"/>`), 100, opts).paths.length, 1);
  assert.equal(svgToNeonPaths(svg(`<path ${D} stroke="none" style="stroke:#123"/>`), 100, opts).paths.length, 1);
  // el style con stroke:none gana al atributo stroke: queda solo relleno
  assert.throws(() => svgToNeonPaths(svg(`<path ${D} stroke="#000" style="stroke:none"/>`), 100, opts), /únicamente formas rellenas/);
});

test("SVG 5: stroke/fill heredados desde <g> (atributos, style y grupos anidados)", () => {
  for (const body of [
    `<g stroke="#000" fill="none"><path ${D}/></g>`,
    `<g style="fill:none;stroke:#000"><path ${D}/></g>`,
    `<g stroke="#000"><g fill="none"><path ${D}/></g></g>`,
    `<g stroke="#000" fill="none"><g><g><path ${D}/></g></g></g>`,
  ]) {
    assert.equal(svgToNeonPaths(svg(body), 100, opts).paths.length, 1, body);
  }
  // el stroke del <svg> raíz también se hereda; un hijo puede anularlo
  assert.equal(svgToNeonPaths(svg(`<path ${D} fill="none"/>`, 'stroke="#000"'), 100, opts).paths.length, 1);
  assert.throws(() => svgToNeonPaths(svg(`<g stroke="#000"><path ${D} stroke="none"/></g>`), 100, opts), /únicamente formas rellenas/);
  // stroke-opacity 0 heredado => no hay stroke visible
  assert.throws(() => svgToNeonPaths(svg(`<g stroke="#000" stroke-opacity="0"><path ${D}/></g>`), 100, opts), /únicamente formas rellenas/);
});

test("SVG 6: CSS de <style> — clase, tag, lista, descendiente, hijo, id, CDATA, especificidad, !important", () => {
  const cases = {
    clase: `<style>.cls-1{fill:none;stroke:#000;stroke-miterlimit:10}</style><path class="cls-1" ${D}/>`,
    lista: `<style>.a,.b{fill:none;stroke:#231f20}</style><path class="b" ${D}/>`,
    cdata: `<defs><style><![CDATA[.st0{fill:none;stroke:#000}]]></style></defs><path class="st0" ${D}/>`,
    tag: `<style>path{fill:none;stroke:#000}</style><path ${D}/>`,
    descendiente: `<style>svg path{fill:none;stroke:#000}</style><path ${D}/>`,
    "descendiente con clase": `<style>.wrap path{fill:none;stroke:#000}</style><g class="wrap"><g><path ${D}/></g></g>`,
    hijo: `<style>g > path{fill:none;stroke:#000}</style><g><path ${D}/></g>`,
    id: `<style>#p{fill:none;stroke:#000}</style><path id="p" ${D}/>`,
    "clase en <g>": `<style>.g1{fill:none;stroke:#000}</style><g class="g1"><path ${D}/></g>`,
    "varias clases": `<style>.a.b{fill:none;stroke:#000}</style><path class="a b" ${D}/>`,
    "rgb()": `<style>.a{fill:none;stroke:rgb(10,20,30)}</style><path class="a" ${D}/>`,
  };
  for (const [name, body] of Object.entries(cases)) {
    const r = svgToNeonPaths(svg(body), 100, opts);
    assert.equal(r.paths.length, 1, name);
    assert.equal(r.stats.fillOnly, 0, name);
  }
  // Selectores no soportados NO se interpretan a medias: la regla se ignora (hijo directo que no aplica, pseudo-clase).
  assert.throws(() => svgToNeonPaths(svg(`<style>svg > path{fill:none;stroke:#000}</style><g><path ${D}/></g>`), 100, opts), /únicamente formas rellenas/, "el padre directo es <g>, no <svg>");
  assert.throws(() => svgToNeonPaths(svg(`<style>path:first-child{fill:none;stroke:#000}</style><path ${D}/>`), 100, opts), /únicamente formas rellenas/);
  // Especificidad: #id > .clase > tag; style="" > CSS; !important > style="".
  const spec = (css, attrs) => svgToNeonPaths(svg(`<style>${css}</style><path ${D} ${attrs}/><path d="M0 0 L5 5" stroke="#000"/>`), 100, opts).stats;
  assert.equal(spec("path{stroke:#000} .n{stroke:none}", 'class="n" fill="none"').strokeRoutes, 1, ".clase gana a tag: el primero queda invisible (solo cuenta el trazo de control)");
  assert.equal(spec(".n{stroke:none} #p{stroke:#000}", 'class="n" id="p" fill="none"').strokeRoutes, 2, "#id gana a .clase");
  assert.equal(spec(".n{stroke:none}", 'class="n" style="stroke:#000" fill="none"').strokeRoutes, 2, "style gana a CSS");
  assert.equal(spec(".n{stroke:none !important}", 'class="n" style="stroke:#000" fill="none"').strokeRoutes, 1, "el !important de CSS gana a style");
  assert.equal(spec(".a{stroke:none} .a{stroke:#000}", 'class="a" fill="none"').strokeRoutes, 2, "a igual especificidad gana el último");
});

test("SVG 6b: colores 'sin pintura' (rgba alfa 0, #rgba 0, transparent, opacity 0)", () => {
  for (const v of ["none", "transparent", "rgba(0,0,0,0)", "rgba(0, 0, 0, 0.0)", "#0000", "#00000000", "hsla(0,0%,0%,0)"]) assert.equal(isNoPaint(v), true, v);
  for (const v of ["#000", "black", "rgb(0,0,0)", "rgba(0,0,0,.5)", "#000f", "currentColor", "url(#g)"]) assert.equal(isNoPaint(v), false, v);
  assert.throws(() => svgToNeonPaths(svg(`<path ${D} fill="none" stroke="rgba(0,0,0,0)"/>`), 100, opts), new RegExp(SVG_NO_ROUTES_MESSAGE));
  assert.equal(svgToNeonPaths(svg(`<path ${D} fill="none" stroke="#000" opacity="0.5"/>`), 100, opts).paths.length, 1);
  const hidden = svg(`<path ${D} fill="none" stroke="#000" opacity="0"/><path ${D} fill="none" stroke="#000" display="none"/>`);
  assert.throws(() => svgToNeonPaths(hidden, 100, opts), new RegExp(SVG_NO_ROUTES_MESSAGE));
  assert.equal(inspectNeonSvg(hidden).ignored, 2);
});

test("SVG 7: 2 paths de trazo + 1 forma rellena -> importa 2, warning por 1 (no bloquea)", () => {
  const content = svg(`<path ${D} fill="none" stroke="#000"/><path d="M0 50 L100 50" fill="none" stroke="#000"/><rect x="10" y="10" width="20" height="20" fill="black"/>`);
  const out = buildNeonPaths({ type: "svg", fileName: "mix.svg", content, ...opts }, 50);
  assert.equal(out.ok, true);
  assert.equal(out.result.paths.length, 2);
  const w = out.result.issues.find((i) => i.code === "IGNORED_FILLED_SHAPES");
  assert.equal(w.message, "Se importaron 2 recorridos. 1 forma rellena fue ignorada.");
  const two = svgToNeonPaths(svg(`<path ${D} stroke="#000" fill="none"/><rect width="5" height="5"/><circle r="5" cx="9" cy="9"/>`), 50, opts);
  assert.equal(two.issues[0].message, "Se importaron 1 recorrido. 2 formas rellenas fueron ignoradas.");
  assert.deepEqual([two.stats.strokeRoutes, two.stats.fillOnly], [1, 2]);
  // y la geometría del canal se genera igual
  const g = createNeonGeometry(out.result.paths, { ...P, designHeightMm: 50 }, out.result.issues);
  assert.deepEqual(g.errors, []);
  assert.ok(g.warnings.some((x) => x.code === "IGNORED_FILLED_SHAPES"));
});

test("SVG 8: <text> se convierte con la fuente Neon elegida (no se rechaza)", () => {
  const content = svg('<text x="10" y="60" font-size="40" font-family="Arial">amor</text>');
  for (const fontId of ["mistral-singleline", "relief-singleline", "neon-linea"]) {
    const r = svgToNeonPaths(content, 100, { fontId, letterSpacingPct: 0 });
    assert.ok(r.paths.length >= 4, fontId);
    assert.equal(r.stats.textElements, 1);
    const font = getNeonFont(fontId);
    const note = r.issues.find((i) => i.code === "SVG_TEXT_FONT");
    assert.equal(note.message, `El texto del SVG se convirtió usando ${font.label}.`);
    // misma composición que el modo Texto (mismas letras, misma forma)
    const direct = textToNeonPaths("amor", fontId, 100, { letterSpacingPct: 0 }).paths;
    assert.equal(r.paths.length, direct.length);
    const rb = boundsOf(r.paths), db = boundsOf(direct);
    approx((rb.maxX - rb.minX) / (rb.maxY - rb.minY), (db.maxX - db.minX) / (db.maxY - db.minY), 0.01, `proporción ${fontId}`);
  }
  // la fuente original NO se reproduce: el mismo <text> con otra font-family da lo mismo
  const a = svgToNeonPaths(svg('<text x="0" y="50" font-family="Comic Sans MS">neon</text>'), 50, opts).paths;
  const b = svgToNeonPaths(svg('<text x="0" y="50" font-family="Times">neon</text>'), 50, opts).paths;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  // el SVG con solo <text> pasa por todo el pipeline y genera un canal válido
  const out = buildNeonPaths({ type: "svg", fileName: "t.svg", content, fontId: "mistral-singleline", letterSpacingPct: 0 }, 60);
  const g = createNeonGeometry(out.result.paths, { ...P, designHeightMm: 60 }, out.result.issues);
  assert.deepEqual(g.errors, []);
  assert.equal(meshAudit(g.geometry.parts[0].mesh).bad, 0);
});

test("SVG 8b: <text> — posición, anchor, tamaño, transform, tspan, mezcla con trazos, ocultos", () => {
  const at = (attrs, body = "abc") => svgToNeonPaths(svg(`<text ${attrs}>${body}</text>`), 100, opts).paths;
  // text-anchor: el bloque se desplaza a la izquierda sin cambiar su tamaño
  // (se mide contra una línea vertical de referencia en x=0, así la escala es común a las tres variantes)
  const ref = (anchor) =>
    svgToNeonPaths(svg(`<line x1="0" y1="0" x2="0" y2="100" stroke="#000"/><text x="50" y="50" font-size="20" style="text-anchor:${anchor}">abc</text>`), 100, opts).paths;
  const textOf = (anchor) => boundsOf(ref(anchor).slice(1)); // [0] es la línea de referencia
  const w = textOf("start").maxX - textOf("start").minX;
  // el anchor desplaza por el AVANCE del texto (como SVG): middle = la mitad de end, y end >= ancho visible.
  const shiftMiddle = textOf("start").minX - textOf("middle").minX;
  const shiftEnd = textOf("start").minX - textOf("end").minX;
  approx(shiftMiddle * 2, shiftEnd, 1e-6, "middle es la mitad de end");
  assert.ok(shiftEnd >= w - 1e-6 && shiftEnd < w * 1.3, "el avance es apenas mayor que el ancho visible");
  approx(textOf("middle").maxX - textOf("middle").minX, w, 1e-6, "el anchor no cambia el tamaño");
  // tamaño relativo: font-size doble => el doble de alto (misma fuente)
  const both = svgToNeonPaths(svg('<text x="0" y="100" font-size="10">HH</text><text x="0" y="50" font-size="20">HH</text>'), 100, opts).paths;
  const hs = both.map((p) => boundsOf([p])).map((b) => b.maxY - b.minY).filter((h) => h > 0.01).sort((x, y) => x - y); // sin los travesaños (alto 0)
  approx(hs[hs.length - 1] / hs[0], 2, 0.05, "font-size 20 vs 10");
  // transform del <text>: rotate(90) intercambia los ejes
  const rotated = boundsOf(at('x="0" y="0" font-size="20" transform="rotate(90)"'));
  const plain = boundsOf(at('x="0" y="0" font-size="20"'));
  approx((rotated.maxY - rotated.minY) / (rotated.maxX - rotated.minX), (plain.maxX - plain.minX) / (plain.maxY - plain.minY), 0.02, "rotate(90)");
  // tspan: sin x/y se concatena; con x/y abre otra línea
  assert.equal(svgToNeonPaths(svg('<text x="0" y="10">ne<tspan>on</tspan></text>'), 50, opts).paths.length, textToNeonPaths("neon", "relief-singleline", 50).paths.length);
  const lines = svgToNeonPaths(svg('<text x="0" y="10">ab<tspan x="0" y="40">cd</tspan></text>'), 50, opts);
  assert.equal(lines.paths.length, textToNeonPaths("ab", "relief-singleline", 50).paths.length + textToNeonPaths("cd", "relief-singleline", 50).paths.length);
  // mezcla trazos + texto: ambos entran
  const mix = svgToNeonPaths(svg(`<path ${D} fill="none" stroke="#000"/><text x="10" y="95" font-size="12">hi</text>`), 100, opts);
  assert.equal(mix.stats.strokeRoutes, 1);
  assert.equal(mix.stats.textElements, 1);
  // texto oculto / vacío no cuenta
  assert.throws(() => svgToNeonPaths(svg('<text x="0" y="10" display="none">hola</text>'), 50, opts), new RegExp(SVG_NO_ROUTES_MESSAGE));
  assert.throws(() => svgToNeonPaths(svg('<text x="0" y="10">   </text>'), 50, opts), new RegExp(SVG_NO_ROUTES_MESSAGE));
  // caracteres sin trazo: aviso
  const odd = svgToNeonPaths(svg('<text x="0" y="10">a§b</text>'), 50, opts);
  assert.ok(odd.issues.some((i) => i.code === "UNSUPPORTED_CHARS" && i.message.includes("§")));
  // el espaciado elegido en la UI rige el <text>
  const wide = boundsOf(svgToNeonPaths(svg('<text x="0" y="50" font-size="20">neon</text>'), 50, { fontId: "relief-singleline", letterSpacingPct: 100 }).paths);
  const norm = boundsOf(svgToNeonPaths(svg('<text x="0" y="50" font-size="20">neon</text>'), 50, { fontId: "relief-singleline", letterSpacingPct: 0 }).paths);
  assert.ok(wide.maxX - wide.minX > norm.maxX - norm.minX);
});

test("SVG 9: texto convertido a CONTORNOS (paths rellenos sin stroke) -> error fill-only", () => {
  // Lo que exporta un programa al "convertir texto a curvas": glifos como formas cerradas rellenas.
  const outlines = svg('<g fill="#000"><path d="M10 10 L30 10 L30 60 L10 60 Z M15 15 L25 15 L25 55 L15 55 Z"/><path d="M40 10 L60 10 L50 60 Z"/></g>');
  const out = buildNeonPaths({ type: "svg", fileName: "amor-outlines.svg", content: outlines, ...opts }, 50);
  assert.equal(out.ok, false);
  assert.equal(out.message, SVG_FILL_ONLY_MESSAGE);
  assert.equal(inspectNeonSvg(outlines).fillOnly, 2);
  // sin ninguna geometría útil ni rellena: otro mensaje
  const empty = buildNeonPaths({ type: "svg", fileName: "e.svg", content: svg("<g/>"), ...opts }, 50);
  assert.equal(empty.message, SVG_NO_ROUTES_MESSAGE);
  assert.notEqual(empty.message, SVG_FILL_ONLY_MESSAGE);
  // elementos no compatibles: tercer mensaje distinto
  const image = buildNeonPaths({ type: "svg", fileName: "i.svg", content: svg('<image href="#x"/>'), ...opts }, 50);
  assert.match(image.message, /elementos no compatibles/);
  assert.notEqual(image.message, SVG_FILL_ONLY_MESSAGE);
  assert.notEqual(image.message, SVG_NO_ROUTES_MESSAGE);
});

test("SVG 10: los transforms siguen funcionando (con el nuevo resolvedor de estilos)", () => {
  const nested = svgToNeonPaths(
    svg('<g transform="translate(10 20)" stroke="#000" fill="none"><g transform="rotate(90)"><line x1="0" y1="0" x2="10" y2="0"/></g><path d="M0 0 L0 -10"/></g>'),
    20,
    opts,
  ).paths;
  assert.equal(nested.length, 2);
  const r = (n) => Math.round(n * 1e6) / 1e6;
  assert.deepEqual(nested[0].points.map(([x, y]) => [r(x), r(y)]), [[0, 10], [0, 0]]);
  assert.deepEqual(nested[1].points.map(([x, y]) => [r(x), r(y)]), [[0, 10], [0, 20]]);
  const viaUse = svgToNeonPaths(svg('<defs><path id="a" d="M0 0 L0 10" stroke="#000" fill="none"/></defs><use href="#a" transform="translate(30 0)"/><use href="#a"/>'), 10, opts).paths;
  assert.equal(viaUse.length, 2);
  approx(boundsOf(viaUse).maxX, 30, 1e-6);
  // estilos CSS aplicados al elemento referenciado por <use>
  const css = svgToNeonPaths(svg('<style>.l{stroke:#000;fill:none}</style><defs><path id="a" class="l" d="M0 0 L0 10"/></defs><use href="#a"/>'), 10, opts);
  assert.equal(css.paths.length, 1);
  approx(boundsOf(svgToNeonPaths(svg(`<path ${D} fill="none" stroke="#000" transform="matrix(0 1 -1 0 0 0)"/>`), 40, opts).paths).maxY, 40, 1e-6);
});

test("SVG: seguridad intacta — script/foreignObject/url externo se rechazan aunque el resto sea válido", () => {
  for (const evil of [
    "<script>alert(1)</script>",
    "<foreignObject><div/></foreignObject>",
    "<style>@import url(https://evil.example/a.css);</style>",
    "<style>.a{fill:url(https://evil.example/x)}</style>",
  ]) {
    const out = buildNeonPaths({ type: "svg", fileName: "e.svg", content: svg(`${evil}<path ${D} fill="none" stroke="#000"/>`), ...opts }, 50);
    assert.equal(out.ok, false, evil);
  }
});

test("svgStyles: cascadeStyle expone la cascada sin herencia", () => {
  const rules = collectRules({ name: "svg", attrs: {}, text: "", children: [{ name: "style", attrs: {}, text: ".a{stroke:red} svg .b{fill:none}", children: [] }] });
  assert.equal(rules.length, 2);
  const node = { name: "path", attrs: { class: "a b", fill: "blue" }, children: [], text: "" };
  const svgNode = { name: "svg", attrs: {}, children: [], text: "" };
  assert.deepEqual(cascadeStyle(node, [svgNode], rules), { fill: "none", stroke: "red" });
  assert.deepEqual(cascadeStyle(node, [], rules), { fill: "blue", stroke: "red" }, "sin el ancestro <svg> la regla descendiente no aplica");
});

// --------------------------------------------------------------------------
// Fuentes: registro, datos, licencias
// --------------------------------------------------------------------------

test("Registro: orden script-primero, categorías, licencias documentadas y archivos de licencia presentes", () => {
  assert.deepEqual(NEON_FONTS.map((f) => f.id), ["mistral-singleline", "relief-singleline", "neon-linea", "neon-cursiva"]);
  const cats = new Set(NEON_FONTS.map((f) => f.category));
  assert.ok(cats.has("script") && cats.has("modern"), "al menos una Script y una Sans/Moderna");
  assert.equal(NEON_FONTS[0].category, "script");
  for (const f of NEON_FONTS) {
    assert.ok(f.label && f.description && f.source && f.license.name && f.license.holder, f.id);
    if (f.license.file) {
      const p = path.join(srcRoot, "lib/maker/neon/fonts/licenses", f.license.file);
      assert.ok(fs.existsSync(p), `${f.id}: falta ${f.license.file}`);
      const text = fs.readFileSync(p, "utf8");
      assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/);
      assert.match(text, /Copyright \d{4} The .* Project Authors/);
      assert.ok(!/with Reserved Font Name/i.test(text.split("PREAMBLE")[0]), `${f.id}: declara un Reserved Font Name`);
    }
  }
  for (const file of ["mistralSingleLine", "relief" + "SingleLine"]) {
    const header = fs.readFileSync(path.join(srcRoot, `lib/maker/neon/fonts/data/${file}.ts`), "utf8").split("\n").slice(0, 8).join("\n");
    assert.match(header, /GENERADO/);
    assert.match(header, /SHA [0-9a-f]{40}/);
    assert.match(header, /SIL Open Font License/);
    assert.match(header, /Modificaciones/);
  }
});

test("Datos de fuentes: charset (ASCII + Latin-1), paths parseables, kerning y métricas coherentes", () => {
  for (const [name, data] of [["mistral", MISTRAL_SINGLELINE_DATA], ["relief", RELIEF_SINGLELINE_DATA]]) {
    assert.ok(Object.keys(data.glyphs).length >= 150, name);
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-ÁÉÍÓÚÑáéíóúñü¿¡ ") assert.ok(data.glyphs[ch], `${name}: falta ${ch}`);
    assert.ok(data.capHeight > 400 && data.xHeight > 200 && data.xHeight < data.capHeight, name);
    assert.ok(Object.keys(data.kerning).length > 100, name);
    for (const [ch, [adv, d]] of Object.entries(data.glyphs)) {
      assert.ok(adv > 0, `${name} ${ch} avance`);
      if (ch !== " ") assert.ok(parsePathData(d).length >= 1, `${name} ${ch} path`);
    }
    // capa single-line real: ningún glifo alfanumérico se cierra (no son contornos rellenos)
    for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
      assert.ok(parsePathData(data.glyphs[ch][1]).every((s) => !s.closed), `${name} ${ch}: path cerrado`);
    }
  }
});

for (const fontId of ["mistral-singleline", "relief-singleline", "neon-linea"]) {
  test(`Fuente ${fontId}: ABC abc 0123 STAMPA Neon amor -> glifos, trazos abiertos, escala, canal válido`, () => {
    const font = getNeonFont(fontId);
    for (const text of ["ABC", "abc", "0123", "STAMPA", "Neon", "amor"]) {
      const r = textToNeonPaths(text, fontId, 60);
      assert.ok(r.paths.length >= text.length - 1, `${text}: trazos`);
      assert.equal(r.issues.length, 0, `${text}: sin caracteres omitidos`);
      if (fontId !== "neon-linea") assert.ok(r.paths.every((p) => !p.closed || /[0O8Q]/.test(text)), `${text}: paths abiertos (single-line real)`);
      const b = boundsOf(r.paths);
      assert.equal(Math.min(b.minX, b.minY), 0, "origen en la esquina");
      assert.ok(b.maxX > 0 && b.maxY > 0);
    }
    // Escala: "H" (mayúscula) mide el alto pedido; el doble de alto duplica el largo total.
    const h = boundsOf(textToNeonPaths("H", fontId, 80).paths);
    approx(h.maxY - h.minY, 80, 80 * 0.05, "cap height");
    const a = neonPathLength(textToNeonPaths("amor", fontId, 50).paths[0]);
    const a2 = neonPathLength(textToNeonPaths("amor", fontId, 100).paths[0]);
    approx(a2 / a, 2, 0.01, "escala lineal");
    // Avances: la palabra es más ancha que la letra sola
    const one = layoutNeonText("o", font).width, three = layoutNeonText("ooo", font).width;
    assert.ok(three > 2 * one * 0.8 && three > one);
    // Canal U válido para cada palabra (warnings de curvatura permitidos, errores no)
    for (const text of ["amor", "neon", "bar", "Stampa"]) {
      const paths = textToNeonPaths(text, fontId, 60).paths;
      const g = createNeonGeometry(paths, { ...P, designHeightMm: 60 });
      assert.deepEqual(g.errors, [], `${fontId} ${text}`);
      const audit = meshAudit(g.geometry.parts[0].mesh);
      assert.equal(audit.bad, 0, `${fontId} ${text}: malla abierta/no-manifold`);
      assert.equal(audit.degenerate, 0, `${fontId} ${text}: triángulos degenerados`);
      assert.ok(g.metrics.lengthMm > 0);
    }
  });
}

test("Fuentes script/modern: kerning y espaciado se respetan", () => {
  for (const fontId of ["mistral-singleline", "relief-singleline"]) {
    const font = getNeonFont(fontId);
    const pairs = [["A", "V"], ["T", "o"], ["V", "a"], ["P", "a"], ["r", "o"], ["A", "T"], ["L", "T"]];
    assert.ok(pairs.some(([l, r]) => font.getKerning(l, r) !== 0), `${fontId}: algún par kerneado`);
    const kernedPair = pairs.find(([l, r]) => font.getKerning(l, r) !== 0);
    const text = kernedPair.join("");
    const sum = font.getGlyph(kernedPair[0]).advance + font.getGlyph(kernedPair[1]).advance;
    approx(layoutNeonText(text, font).width, sum + font.getKerning(...kernedPair), 1e-6, "el ancho incluye el kerning del par");
    // kerning por letra base: la letra acentuada usa el del par sin acento
    assert.equal(font.getKerning("Á", "V"), font.getKerning("A", "V"));
    // Espaciado: 0 % recomendado; +100 % agrega ¼ capHeight por carácter; -20 % lo reduce
    const base = layoutNeonText("nnnn", font, 0).width;
    approx(layoutNeonText("nnnn", font, 100).width - base, 4 * 0.25 * font.capHeight, 1e-6, "+100%");
    approx(base - layoutNeonText("nnnn", font, -20).width, 4 * 0.2 * 0.25 * font.capHeight, 1e-6, "-20%");
    // y llega al recorrido final
    const norm = boundsOf(textToNeonPaths("neon", fontId, 50).paths);
    const wide = boundsOf(textToNeonPaths("neon", fontId, 50, { letterSpacingPct: 100 }).paths);
    const tight = boundsOf(textToNeonPaths("neon", fontId, 50, { letterSpacingPct: -20 }).paths);
    assert.ok(wide.maxX > norm.maxX && tight.maxX < norm.maxX, fontId);
    // el espaciado por defecto es exactamente el recomendado por la fuente
    assert.equal(JSON.stringify(textToNeonPaths("neon", fontId, 50).paths), JSON.stringify(textToNeonPaths("neon", fontId, 50, { letterSpacingPct: 0 }).paths));
  }
});

test("Fuentes script: no se inventan puentes entre letras; el canal es válido aunque los trazos se toquen", () => {
  const font = getNeonFont("mistral-singleline");
  const mistral = textToNeonPaths("amor", "mistral-singleline", 60).paths;
  const glyphStrokes = [..."amor"].reduce((n, c) => n + parsePathData(font.getGlyph(c).d).length, 0);
  assert.equal(mistral.length, glyphStrokes, "un NeonPath por trazo de la fuente, sin fusionar letras");
  const g = createNeonGeometry(mistral, { ...P, designHeightMm: 60 });
  assert.deepEqual(g.errors, []);
  assert.equal(meshAudit(g.geometry.parts[0].mesh).bad, 0);
});

test("Texto: acentos/Ñ con fuentes de datos usan glifos propios; con Stampa Línea se sintetizan; mayúsculas conservadas", () => {
  for (const fontId of ["mistral-singleline", "relief-singleline"]) {
    assert.equal(textToNeonPaths("Ñandú ¿Qué?", fontId, 50).issues.length, 0, fontId);
  }
  const font = getNeonFont("relief-singleline");
  assert.notEqual(JSON.stringify(layoutNeonText("A", font).subs), JSON.stringify(layoutNeonText("a", font).subs), "una fuente de datos respeta las minúsculas");
  assert.equal(JSON.stringify(layoutNeonText("a", getNeonFont("neon-linea")).subs), JSON.stringify(layoutNeonText("A", getNeonFont("neon-linea")).subs), "Stampa Línea solo mayúsculas");
  assert.equal(textToNeonPaths("Ñ", "neon-linea", 50).paths.length, textToNeonPaths("N", "neon-linea", 50).paths.length + 1);
});
