// Genera src/lib/maker/neon/fonts/data/*.ts a partir de los assets single-line ORIGINALES
// (paths abiertos reales, nunca los contornos cerrados "Outline" de esas familias).
//
//   git clone https://github.com/isdat-type/Mistral-SingleLine.git  <dir>/Mistral-SingleLine
//   git clone https://github.com/isdat-type/Relief-SingleLine.git   <dir>/Relief-SingleLine
//   (checkout de los SHA fijados abajo)
//   node scripts/build-neon-fonts.mjs <dir>
//
// Es una herramienta de desarrollo: NO corre en build ni en runtime. La salida se versiona.
// Ver docs/STAMPA_MAKER.md (sección 26) y src/lib/maker/neon/fonts/licenses/.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const SOURCES = {
  mistral: { dir: "Mistral-SingleLine", sha: "fc23517bfea2f84a8c73d08c1ce5cb717c39e870" },
  relief: { dir: "Relief-SingleLine", sha: "01dfc5779ec1e9e4b288d96c6c96c23bfccbaf9d" },
};

const root = process.argv[2];
if (!root) throw new Error("Uso: node scripts/build-neon-fonts.mjs <carpeta con los repos clonados>");
const outDir = path.resolve("src/lib/maker/neon/fonts/data");
fs.mkdirSync(outDir, { recursive: true });

for (const s of Object.values(SOURCES)) {
  const head = execSync("git rev-parse HEAD", { cwd: path.join(root, s.dir) }).toString().trim();
  if (head !== s.sha) throw new Error(`${s.dir}: HEAD ${head} != SHA fijado ${s.sha}`);
}

// Charset: ASCII imprimible + Latin-1 (acentos, ñ, ¿ ¡). Sin ligaduras ni alternativas contextuales.
function charset() {
  const out = [];
  for (let c = 0x20; c <= 0x7e; c++) out.push(String.fromCodePoint(c));
  for (const c of [0xa1, 0xbf, 0x20ac]) out.push(String.fromCodePoint(c));
  for (let c = 0xc0; c <= 0xff; c++) if (c !== 0xd7 && c !== 0xf7) out.push(String.fromCodePoint(c));
  return out;
}
const CHARS = charset();
const KERN_CHARS = CHARS.filter((c) => c.codePointAt(0) > 0x20 && c.codePointAt(0) <= 0x7e);

const num = (v) => String(Math.round(v * 100) / 100);

function emit(id, meta, data) {
  const lines = [];
  lines.push("// ARCHIVO GENERADO por scripts/build-neon-fonts.mjs — no editar a mano.");
  for (const l of meta) lines.push(`// ${l}`);
  lines.push('import type { NeonFontData } from "@/lib/maker/neon/fonts/fontData";');
  lines.push("");
  lines.push(`export const ${id}: NeonFontData = ${JSON.stringify(data)};`);
  lines.push("");
  const name = { MISTRAL_SINGLELINE_DATA: "mistralSingleLine", RELIEF_SINGLELINE_DATA: "reliefSingleLine" }[id];
  fs.writeFileSync(path.join(outDir, `${name}.ts`), lines.join("\n"));
  const glyphCount = Object.keys(data.glyphs).length;
  console.log(`${name}.ts: ${glyphCount} glifos, ${Object.keys(data.kerning).length} pares de kerning, ${(JSON.stringify(data).length / 1024).toFixed(1)} KB`);
}

// ------------------------------------------------------------------ plist mínimo
function parsePlist(xml) {
  const tokens = [...xml.matchAll(/<(\/?)(dict|array|key|string|integer|real|true|false)\s*(\/?)>([^<]*)/g)];
  let i = 0;
  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  function value() {
    const [, close, tag, selfClose, text] = tokens[i++];
    if (close) throw new Error("plist inesperado");
    if (tag === "dict") {
      const obj = {};
      if (selfClose) return obj;
      while (!(tokens[i][1] === "/" && tokens[i][2] === "dict")) {
        const k = unesc(tokens[i++][4]); // <key>text</key>: el texto viene pegado a la apertura
        i++; // </key>
        obj[k] = value();
      }
      i++;
      return obj;
    }
    if (tag === "array") {
      const arr = [];
      if (selfClose) return arr;
      while (!(tokens[i][1] === "/" && tokens[i][2] === "array")) arr.push(value());
      i++;
      return arr;
    }
    if (tag === "string") { i++; return unesc(text); }
    if (tag === "integer" || tag === "real") { i++; return Number(text); }
    return tag === "true";
  }
  // saltar hasta el <dict> raíz
  while (tokens[i][2] !== "dict") i++;
  return value();
}

// ------------------------------------------------------------------ Mistral (UFO, contornos abiertos)
function buildMistral() {
  const ufo = path.join(root, SOURCES.mistral.dir, "sources/Mistral_SingleLine.ufo");
  const contents = parsePlist(fs.readFileSync(path.join(ufo, "glyphs/contents.plist"), "utf8"));
  const groups = parsePlist(fs.readFileSync(path.join(ufo, "groups.plist"), "utf8"));
  const kerning = parsePlist(fs.readFileSync(path.join(ufo, "kerning.plist"), "utf8"));
  const fontinfo = parsePlist(fs.readFileSync(path.join(ufo, "fontinfo.plist"), "utf8"));

  const byChar = new Map(); // char -> nombre de glifo
  const glyphs = new Map(); // nombre -> {advance, contours}
  for (const [name, file] of Object.entries(contents)) {
    const xml = fs.readFileSync(path.join(ufo, "glyphs", file), "utf8");
    const advance = Number(/<advance width="([-\d.]+)"/.exec(xml)?.[1] ?? 0);
    for (const m of xml.matchAll(/<unicode hex="([0-9A-Fa-f]+)"/g)) {
      const ch = String.fromCodePoint(parseInt(m[1], 16));
      if (!byChar.has(ch)) byChar.set(ch, name);
    }
    if (/<component /.test(xml)) throw new Error(`${name}: componentes no soportados por este conversor`);
    const contours = [...xml.matchAll(/<contour>([\s\S]*?)<\/contour>/g)].map((c) =>
      [...c[1].matchAll(/<point x="([-\d.]+)" y="([-\d.]+)"(?: type="(\w+)")?/g)].map((p) => ({ x: Number(p[1]), y: Number(p[2]), type: p[3] ?? null })),
    );
    glyphs.set(name, { advance, contours });
  }

  // Contorno UFO -> segmentos. Todos los contornos de Mistral son ABIERTOS (primer punto "move").
  function contourToSegments(points) {
    if (points[0].type !== "move") throw new Error("contorno cerrado inesperado: Mistral SingleLine solo tiene paths abiertos");
    const segs = [];
    let pending = [];
    for (const p of points.slice(1)) {
      if (p.type === null) { pending.push(p); continue; }
      if (p.type === "line") segs.push({ t: "L", p });
      else if (p.type === "curve") {
        if (pending.length === 2) segs.push({ t: "C", c1: pending[0], c2: pending[1], p });
        else if (pending.length === 0) segs.push({ t: "L", p });
        else if (pending.length === 1) segs.push({ t: "C", c1: pending[0], c2: pending[0], p });
        else throw new Error("curve con >2 offcurves");
      } else throw new Error(`tipo de punto no soportado: ${p.type}`);
      pending = [];
    }
    return { start: points[0], segs };
  }

  // Encadena contornos consecutivos cuando el final de uno coincide con el inicio del siguiente (un trazo partido en varios contornos).
  function glyphToPathData(contours) {
    const parts = [];
    let cur = null;
    for (const c of contours) {
      const { start, segs } = contourToSegments(c);
      if (segs.length === 0) continue;
      const same = cur && cur.x === start.x && cur.y === start.y;
      if (!same) parts.push(`M${num(start.x)} ${num(start.y)}`);
      for (const s of segs) {
        parts.push(s.t === "L" ? `L${num(s.p.x)} ${num(s.p.y)}` : `C${num(s.c1.x)} ${num(s.c1.y)} ${num(s.c2.x)} ${num(s.c2.y)} ${num(s.p.x)} ${num(s.p.y)}`);
      }
      cur = segs[segs.length - 1].p;
    }
    return parts.join("");
  }

  const out = { unitsPerEm: fontinfo.unitsPerEm, capHeight: fontinfo.capHeight, xHeight: fontinfo.xHeight, glyphs: {}, kerning: {} };
  const nameOf = new Map();
  for (const ch of CHARS) {
    const name = byChar.get(ch);
    if (!name) continue;
    const g = glyphs.get(name);
    nameOf.set(ch, name);
    out.glyphs[ch] = [g.advance, glyphToPathData(g.contours)];
  }

  // capHeight CALIBRADO: en Mistral las mayúsculas (script) miden ~14 % más que el capHeight declarado en fontinfo (580),
  // así que "Alto del diseño" no coincidiría con lo que se ve. Se mide sobre los glifos reales (coordenadas absolutas M/L/C).
  const glyphTop = (ch) => {
    const nums = out.glyphs[ch][1].match(/-?\d+(?:\.\d+)?/g).map(Number);
    let top = -Infinity, bottom = Infinity;
    for (let i = 1; i < nums.length; i += 2) [top, bottom] = [Math.max(top, nums[i]), Math.min(bottom, nums[i])];
    return top - bottom; // extensión visible (el trazo de una mayúscula script puede arrancar bajo la línea base)
  };
  out.declaredCapHeight = out.capHeight;
  out.capHeight = Math.round(Math.max(...["H", "E", "T", "M", "N"].map(glyphTop)));

  // Kerning UFO: prioridad glifo-glifo > glifo-grupo2 > grupo1-glifo > grupo1-grupo2.
  const group1Of = new Map(), group2Of = new Map();
  for (const [g, members] of Object.entries(groups)) {
    for (const m of members) {
      if (g.startsWith("public.kern1.")) group1Of.set(m, g);
      else if (g.startsWith("public.kern2.")) group2Of.set(m, g);
    }
  }
  const lookup = (l, r) => {
    const g1 = group1Of.get(l), g2 = group2Of.get(r);
    const cands = [[l, r], [l, g2], [g1, r], [g1, g2]];
    for (const [a, b] of cands) if (a && b && kerning[a] && kerning[a][b] !== undefined) return kerning[a][b];
    return 0;
  };
  for (const a of KERN_CHARS) for (const b of KERN_CHARS) {
    const na = nameOf.get(a), nb = nameOf.get(b);
    if (!na || !nb) continue;
    const k = lookup(na, nb);
    if (k) out.kerning[a + b] = k;
  }
  emit("MISTRAL_SINGLELINE_DATA", [
    "Fuente: Mistral SingleLine (isdat-type) — capa single-line REAL (sources/Mistral_SingleLine.ufo, contornos abiertos), NO el OTF de contornos cerrados.",
    `Repositorio: https://github.com/isdat-type/Mistral-SingleLine  SHA ${SOURCES.mistral.sha}`,
    "Licencia: SIL Open Font License 1.1, Copyright 2025 The Mistral SingleLine Project Authors. Sin Reserved Font Name. Ver ./../licenses/OFL-Mistral-SingleLine.txt",
    "Modificaciones: formato + capHeight calibrado sobre las mayúsculas reales (H/E/T/M/N). Coordenadas originales (1000 upm); los contornos consecutivos que se tocan se encadenan en un solo trazo;",
    "  se descartan ligaduras/alternativas contextuales (GSUB); el kerning UFO (con clases) se resuelve a pares planos.",
  ], out);
}

// ------------------------------------------------------------------ Relief (SVG Font)
function buildRelief() {
  const svg = fs.readFileSync(path.join(root, SOURCES.relief.dir, "fonts/open_svg/ReliefSingleLineSVG-Regular.svg"), "utf8");
  const unesc = (s) => s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const face = /<font-face([\s\S]*?)\/>/.exec(svg)[1];
  const attr = (s, k) => new RegExp(`\\b${k}="([^"]*)"`).exec(s)?.[1];
  const defaultAdv = Number(attr(/<font /.exec(svg) ? svg.slice(svg.indexOf("<font "), svg.indexOf(">", svg.indexOf("<font "))) : "", "horiz-adv-x") ?? 0);

  const byName = new Map(); // nombre -> char
  const glyphs = new Map(); // char -> [adv, d]
  for (const m of svg.matchAll(/<glyph\b([\s\S]*?)\/>/g)) {
    const a = m[1];
    const name = attr(a, "glyph-name");
    const u = attr(a, "unicode");
    const d = attr(a, "d");
    if (!u || !d) continue;
    const ch = unesc(u);
    if ([...ch].length !== 1) continue; // ligaduras
    if (name) byName.set(name, ch);
    if (!glyphs.has(ch)) glyphs.set(ch, [Number(attr(a, "horiz-adv-x") ?? defaultAdv), d.replace(/\s+/g, " ").trim()]);
  }
  // espacio: sin path
  const spaceM = /<glyph[^>]*unicode=" "[^>]*horiz-adv-x="([\d.]+)"/.exec(svg);

  const out = { unitsPerEm: Number(attr(face, "units-per-em")), capHeight: Number(attr(face, "cap-height")), xHeight: Number(attr(face, "x-height")), glyphs: {}, kerning: {} };
  for (const ch of CHARS) if (glyphs.has(ch)) out.glyphs[ch] = glyphs.get(ch);
  if (spaceM) out.glyphs[" "] = [Number(spaceM[1]), ""];

  for (const m of svg.matchAll(/<hkern\b([\s\S]*?)\/>/g)) {
    const a = m[1];
    const k = Number(attr(a, "k"));
    const resolve = (u, g) => {
      const set = new Set();
      for (const n of (g ?? "").split(",")) if (n.trim() && byName.has(n.trim())) set.add(byName.get(n.trim()));
      for (const n of (u ?? "").split(",")) { const c = unesc(n.trim()); if ([...c].length === 1) set.add(c); }
      return [...set];
    };
    const left = resolve(attr(a, "u1"), attr(a, "g1"));
    const right = resolve(attr(a, "u2"), attr(a, "g2"));
    for (const l of left) for (const r of right) {
      if (KERN_CHARS.includes(l) && KERN_CHARS.includes(r) && out.kerning[l + r] === undefined) out.kerning[l + r] = k;
    }
  }
  emit("RELIEF_SINGLELINE_DATA", [
    "Fuente: Relief SingleLine (isdat-type) — SVG Font single-line (fonts/open_svg/ReliefSingleLineSVG-Regular.svg), NO el OTF de contornos cerrados.",
    `Repositorio: https://github.com/isdat-type/Relief-SingleLine  SHA ${SOURCES.relief.sha}`,
    "Licencia: SIL Open Font License 1.1, Copyright 2021/2022 The Relief SingleLine Project Authors. Sin Reserved Font Name. Ver ./../licenses/OFL-Relief-SingleLine.txt",
    "Modificaciones: solo formato. Se conservan las coordenadas originales (1000 upm) y el path data original; se descartan ligaduras; el kerning (hkern) se resuelve a pares planos.",
  ], out);
}

buildMistral();
buildRelief();
