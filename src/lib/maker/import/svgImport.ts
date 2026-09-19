import type { Point2D } from "@/lib/maker/types";
import { DesignImportError, IMPORT_LIMITS, type RawDesign, type RawShape } from "@/lib/maker/import/types";
import { parseXml, type XmlNode } from "@/lib/maker/import/xml";
import {
  IDENTITY,
  multiply,
  parseTransform,
  parsePathData,
  rectSubPaths,
  ellipseSubPaths,
  polySubPaths,
  transformSubPaths,
  subPathsBounds,
  flattenSubPath,
  type Matrix,
  type SubPath,
} from "@/lib/maker/import/svgGeometry";

/**
 * Importación SVG (0.5): la geometría se mantiene VECTORIAL (nunca se
 * rasteriza) — cada forma visible se convierte a polígonos aplanando las
 * curvas ya transformadas, y la unión/counters se resuelven después en
 * import/normalize.ts con Clipper. El SVG es una SILUETA: colores, trazos
 * (stroke) y gradientes se ignoran; solo cuenta qué está relleno y visible.
 *
 * Seguridad: nunca se inserta en el DOM ni se usa DOMParser (ver xml.ts);
 * se rechaza todo lo que pueda ejecutar o cargar algo (script,
 * foreignObject, referencias externas/`javascript:`/`data:`, entidades) y
 * los handlers `on*` simplemente se ignoran (nunca se leen).
 */

const UNSAFE_ELEMENTS = new Set(["script", "foreignObject", "iframe", "embed", "object", "audio", "video", "canvas"]);
const ANIMATION_ELEMENTS = new Set(["animate", "animateTransform", "animateMotion", "set", "animateColor"]);
/** Elementos que definen recursos pero no se dibujan directamente (solo vía <use>). */
const NON_RENDERED = new Set([
  "defs", "symbol", "clipPath", "mask", "marker", "pattern", "linearGradient", "radialGradient", "filter",
  "style", "title", "desc", "metadata", "namedview", "font", "font-face",
]);
const TEXT_ELEMENTS = new Set(["text", "tspan", "textPath", "tref"]);
const MAX_USE_DEPTH = 16;
const MAX_SHAPES = 50000;
const MAX_PRE_UNION_VERTICES = 600000;

type Props = Record<string, string>;

interface CssRule {
  selector: string;
  props: Props;
}

function parseDeclarations(css: string): Props {
  const props: Props = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).trim().replace(/\s*!important\s*$/i, "");
    if (k) props[k] = v;
  }
  return props;
}

function parseStyleSheet(css: string): CssRule[] {
  if (/@import/i.test(css)) throw new DesignImportError("SVG_UNSAFE", "El SVG importa hojas de estilo externas, que no se admiten por seguridad.");
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const props = parseDeclarations(m[2]);
    for (const sel of m[1].split(",")) rules.push({ selector: sel.trim(), props });
  }
  return rules;
}

/** Soporta selectores simples: `tag`, `.clase`, `#id`, `tag.clase`, `*`. Cualquier otro selector (combinadores, atributos, pseudo-clases) se ignora. */
function selectorMatches(selector: string, node: XmlNode): boolean {
  const m = /^([a-zA-Z][\w-]*|\*)?(?:\.([\w-]+))?(?:#([\w-]+))?$/.exec(selector);
  if (!m) return false;
  const [, tag, cls, id] = m;
  if (tag && tag !== "*" && tag !== node.name) return false;
  if (cls && !(node.attrs.class ?? "").split(/\s+/).includes(cls)) return false;
  if (id && node.attrs.id !== id) return false;
  return Boolean(tag || cls || id);
}

const STYLE_PROPS = ["fill", "fill-rule", "fill-opacity", "opacity", "display", "visibility", "clip-path", "mask", "filter"];

function declaredProps(node: XmlNode, rules: CssRule[]): Props {
  const props: Props = {};
  for (const p of STYLE_PROPS) if (node.attrs[p] !== undefined) props[p] = node.attrs[p].trim();
  for (const r of rules) if (selectorMatches(r.selector, node)) Object.assign(props, r.props);
  if (node.attrs.style) Object.assign(props, parseDeclarations(node.attrs.style));
  return props;
}

interface Inherited {
  fill: string;
  fillRule: "nonzero" | "evenodd";
  visible: boolean;
  fillOpacity: number;
}

interface PendingShape {
  subs: SubPath[];
  fillRule: "nonzero" | "evenodd";
}

interface Ctx {
  rules: CssRule[];
  byId: Map<string, XmlNode>;
  pending: PendingShape[];
  shapeCount: number;
}

function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Pre-chequeo de seguridad/soporte sobre TODO el árbol (aunque un nodo no se dibuje). */
function scanTree(node: XmlNode): void {
  if (UNSAFE_ELEMENTS.has(node.name)) {
    throw new DesignImportError("SVG_UNSAFE", `El SVG contiene un elemento no permitido por seguridad (<${node.name}>).`);
  }
  if (ANIMATION_ELEMENTS.has(node.name)) {
    throw new DesignImportError("SVG_UNSUPPORTED", "El SVG contiene animaciones, que no se admiten. Exportá un SVG estático.");
  }
  for (const [name, value] of Object.entries(node.attrs)) {
    const lower = value.trim().toLowerCase();
    if (/^\s*(javascript|vbscript|data):/i.test(lower) || lower.includes("javascript:")) {
      throw new DesignImportError("SVG_UNSAFE", "El SVG contiene una referencia insegura (javascript:/data:).");
    }
    if (name === "href" && !value.trim().startsWith("#")) {
      throw new DesignImportError("SVG_UNSAFE", "El SVG referencia recursos externos, que no se admiten por seguridad.");
    }
    if (/url\(\s*(?!["']?#)/i.test(value)) {
      throw new DesignImportError("SVG_UNSAFE", "El SVG referencia recursos externos (url()), que no se admiten por seguridad.");
    }
  }
  if (node.name === "style" && /url\(\s*(?!["']?#)/i.test(node.text)) {
    throw new DesignImportError("SVG_UNSAFE", "El SVG referencia recursos externos (url()) en sus estilos, que no se admiten por seguridad.");
  }
  for (const c of node.children) scanTree(c);
}

function collectIds(node: XmlNode, byId: Map<string, XmlNode>): void {
  if (node.attrs.id) byId.set(node.attrs.id, node);
  for (const c of node.children) collectIds(c, byId);
}

function collectStyles(node: XmlNode, rules: CssRule[]): void {
  if (node.name === "style") rules.push(...parseStyleSheet(node.text));
  for (const c of node.children) collectStyles(c, rules);
}

function shapeSubPaths(node: XmlNode): SubPath[] {
  const a = node.attrs;
  switch (node.name) {
    case "path":
      return a.d ? parsePathData(a.d) : [];
    case "rect": {
      const rx = a.rx !== undefined ? num(a.rx) : null;
      const ry = a.ry !== undefined ? num(a.ry) : null;
      return rectSubPaths(num(a.x), num(a.y), num(a.width), num(a.height), rx, ry);
    }
    case "circle":
      return ellipseSubPaths(num(a.cx), num(a.cy), num(a.r), num(a.r));
    case "ellipse":
      return ellipseSubPaths(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
    case "polygon":
    case "polyline":
      // Un polyline se rellena cerrado implícitamente; con menos de 3 puntos no hay área.
      return a.points ? polySubPaths(a.points) : [];
    default:
      return [];
  }
}

function walk(node: XmlNode, matrix: Matrix, inherited: Inherited, ctx: Ctx, useDepth: number): void {
  const props = declaredProps(node, ctx.rules);
  if ((props.display ?? "").toLowerCase() === "none") return;
  if (props.opacity !== undefined && parseFloat(props.opacity) === 0) return;

  for (const [k, what] of [["clip-path", "recortes (clip-path)"], ["mask", "máscaras (mask)"], ["filter", "filtros (filter)"]] as const) {
    const v = props[k];
    if (v && v.toLowerCase() !== "none") {
      throw new DesignImportError("SVG_UNSUPPORTED", `El SVG usa ${what}, que todavía no se admiten. Expandí/aplanó el diseño antes de importarlo.`);
    }
  }

  const style: Inherited = {
    fill: props.fill ?? inherited.fill,
    fillRule: props["fill-rule"] === "evenodd" ? "evenodd" : props["fill-rule"] === "nonzero" ? "nonzero" : inherited.fillRule,
    visible: props.visibility !== undefined ? !/^(hidden|collapse)$/i.test(props.visibility) : inherited.visible,
    fillOpacity: props["fill-opacity"] !== undefined ? num(props["fill-opacity"], 1) : inherited.fillOpacity,
  };

  const local = parseTransform(node.attrs.transform);
  const m = multiply(matrix, local);

  if (TEXT_ELEMENTS.has(node.name)) {
    throw new DesignImportError("SVG_TEXT", "Este SVG contiene texto editable. Convertí el texto a curvas/trazados antes de importarlo.");
  }
  if (node.name === "image") {
    throw new DesignImportError("SVG_UNSUPPORTED", "El SVG contiene imágenes incrustadas, que no se admiten. Usá un SVG vectorial puro (o importá la imagen como PNG).");
  }

  if (node.name === "use") {
    const href = (node.attrs.href ?? "").trim();
    const target = href.startsWith("#") ? ctx.byId.get(href.slice(1)) : undefined;
    if (!target) return; // referencia rota: se ignora
    if (useDepth >= MAX_USE_DEPTH) throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (referencias <use> anidadas en exceso).");
    const um = multiply(m, [1, 0, 0, 1, num(node.attrs.x), num(node.attrs.y)]);
    if (target.name === "symbol" || target.name === "svg") {
      for (const c of target.children) walkChild(c, um, style, ctx, useDepth + 1);
    } else {
      walk(target, um, style, ctx, useDepth + 1);
    }
    return;
  }

  const isContainer = node.name === "svg" || node.name === "g" || node.name === "a" || node.name === "switch";
  if (isContainer) {
    for (const c of node.children) walkChild(c, m, style, ctx, useDepth);
    return;
  }

  const subs = shapeSubPaths(node);
  if (subs.length === 0) return;
  const fill = style.fill.trim().toLowerCase();
  const filled = style.visible && fill !== "none" && fill !== "transparent" && style.fillOpacity > 0;
  if (!filled) return;

  if (++ctx.shapeCount > MAX_SHAPES) throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (demasiadas formas).");
  ctx.pending.push({ subs: transformSubPaths(subs, m), fillRule: style.fillRule });
}

function walkChild(node: XmlNode, matrix: Matrix, inherited: Inherited, ctx: Ctx, useDepth: number): void {
  if (NON_RENDERED.has(node.name)) return;
  walk(node, matrix, inherited, ctx, useDepth);
}

/**
 * Etapa 1 SVG: texto SVG -> formas (polígonos + regla de relleno) en las
 * unidades del SVG, Y hacia abajo. La escala a mm y la unión booleana
 * ocurren en import/normalize.ts, común con PNG.
 */
export function extractSvgShapes(content: string): RawDesign {
  if (content.length > IMPORT_LIMITS.maxFileBytes) {
    throw new DesignImportError("FILE_TOO_LARGE", "El archivo SVG es demasiado grande (máximo 10 MB).");
  }
  const root = parseXml(content);
  scanTree(root);

  const rules: CssRule[] = [];
  collectStyles(root, rules);
  const byId = new Map<string, XmlNode>();
  collectIds(root, byId);

  const ctx: Ctx = { rules, byId, pending: [], shapeCount: 0 };
  walk(root, IDENTITY, { fill: "black", fillRule: "nonzero", visible: true, fillOpacity: 1 }, ctx, 0);

  // Tolerancia de aplanado relativa al tamaño del dibujo (~1/3000 de su lado mayor).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ctx.pending) {
    const b = subPathsBounds(p.subs);
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX)) {
    throw new DesignImportError("SVG_EMPTY", "El SVG no tiene formas rellenas utilizables (solo trazos/contornos sin relleno, o formas ocultas).");
  }
  const tol = Math.max(maxX - minX, maxY - minY) / 3000;

  const shapes: RawShape[] = [];
  let vertices = 0;
  for (const p of ctx.pending) {
    const paths: Point2D[][] = [];
    for (const sub of p.subs) {
      const poly = flattenSubPath(sub, tol);
      if (poly.length >= 3) {
        paths.push(poly);
        vertices += poly.length;
      }
    }
    if (vertices > MAX_PRE_UNION_VERTICES) {
      throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (demasiados puntos). Simplificá el trazado antes de importarlo.");
    }
    if (paths.length > 0) shapes.push({ paths, fillRule: p.fillRule });
  }
  if (shapes.length === 0) {
    throw new DesignImportError("SVG_EMPTY", "El SVG no tiene formas rellenas utilizables (solo trazos/contornos sin relleno, o formas ocultas).");
  }
  return { shapes, warnings: [] };
}
