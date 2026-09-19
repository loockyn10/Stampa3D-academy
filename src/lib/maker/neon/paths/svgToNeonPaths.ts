import type { Point2D } from "@/lib/maker/types";
import { DesignImportError, IMPORT_LIMITS } from "@/lib/maker/import/types";
import { parseXml, type XmlNode } from "@/lib/maker/import/xml";
import {
  IDENTITY,
  ellipseSubPaths,
  flattenSubPath,
  multiply,
  parsePathData,
  parseTransform,
  rectSubPaths,
  subPathsBounds,
  transformSubPaths,
  type Matrix,
  type SubPath,
} from "@/lib/maker/import/svgGeometry";
import { collectIds, collectStyles, parseDeclarations, scanTree, selectorMatches, type CssRule } from "@/lib/maker/import/svgImport";
import { FLATTEN_TOLERANCE_MM, pathsBounds, scaleToMm } from "@/lib/maker/neon/paths/flattenNeonPath";
import { NeonInputError, type NeonIssue, type NeonPath, type NeonPathsResult } from "@/lib/maker/neon/types";

/**
 * SVG -> NeonPath[] (Neon 0.1). El SVG describe RECORRIDOS, no formas rellenas:
 * cada <path>/<line>/<polyline>/<polygon>/<circle>/<ellipse>/<rect> cuenta como
 * centerline si tiene trazo (stroke) o si no tiene relleno (fill="none"). Un
 * elemento solo relleno (sin trazo) es una FORMA: se ignora, y si no queda
 * ningún recorrido se rechaza con un error claro (no se intenta obtener el
 * esqueleto de formas rellenas: eso queda para una versión futura).
 *
 * Seguridad: mismo criterio que el importador de carteles — parser XML propio
 * sin DOM (import/xml.ts) y `scanTree` (scripts, foreignObject, handlers vía
 * href, javascript:/data:, url() externos, animaciones). Solo se lee geometría.
 */

const NON_RENDERED = new Set([
  "defs", "symbol", "clipPath", "mask", "marker", "pattern", "linearGradient", "radialGradient", "filter",
  "style", "title", "desc", "metadata", "namedview", "font", "font-face",
]);
const TEXT_ELEMENTS = new Set(["text", "tspan", "textPath", "tref"]);
const MAX_USE_DEPTH = 16;
const MAX_SHAPES = 50000;
const MAX_POINTS = 400000;

export const SVG_FILL_ONLY_MESSAGE =
  "Este SVG contiene formas rellenas. Para Neon LED necesitás un SVG de línea/trazo. La conversión automática de formas a recorrido central se agregará más adelante.";

type Props = Record<string, string>;

const STYLE_PROPS = ["fill", "stroke", "display", "visibility", "opacity", "stroke-opacity", "clip-path", "mask", "filter"];

function declaredProps(node: XmlNode, rules: CssRule[]): Props {
  const props: Props = {};
  for (const p of STYLE_PROPS) if (node.attrs[p] !== undefined) props[p] = node.attrs[p].trim();
  for (const r of rules) if (selectorMatches(r.selector, node)) Object.assign(props, r.props);
  if (node.attrs.style) Object.assign(props, parseDeclarations(node.attrs.style));
  return props;
}

interface Inherited {
  fill: string;
  stroke: string;
  visible: boolean;
}

interface PendingRoute {
  subs: SubPath[];
}

interface Ctx {
  rules: CssRule[];
  byId: Map<string, XmlNode>;
  routes: PendingRoute[];
  filledShapes: number;
  shapeCount: number;
}

function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function pointList(attr: string): Point2D[] {
  const nums = (attr.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const pts: Point2D[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

function lineSubPath(points: Point2D[], closed: boolean): SubPath[] {
  if (points.length < 2) return [];
  return [{ start: points[0], segs: points.slice(1).map((p) => ({ t: "L", p }) as const), closed }];
}

/** Subpaths de un elemento como CENTERLINE, y si es una forma inherentemente cerrada (círculo, rect, polígono). */
function routeSubPaths(node: XmlNode): SubPath[] {
  const a = node.attrs;
  switch (node.name) {
    case "path":
      return a.d ? parsePathData(a.d) : [];
    case "line":
      return lineSubPath([[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]], false);
    case "polyline":
      return a.points ? lineSubPath(pointList(a.points), false) : [];
    case "polygon":
      return a.points ? lineSubPath(pointList(a.points), true).map((s) => (s.segs.length >= 2 ? s : { ...s, closed: false })) : [];
    case "circle":
      return ellipseSubPaths(num(a.cx), num(a.cy), num(a.r), num(a.r)).map((s) => ({ ...s, closed: true }));
    case "ellipse":
      return ellipseSubPaths(num(a.cx), num(a.cy), num(a.rx), num(a.ry)).map((s) => ({ ...s, closed: true }));
    case "rect": {
      const rx = a.rx !== undefined ? num(a.rx) : null;
      const ry = a.ry !== undefined ? num(a.ry) : null;
      return rectSubPaths(num(a.x), num(a.y), num(a.width), num(a.height), rx, ry).map((s) => ({ ...s, closed: true }));
    }
    default:
      return [];
  }
}

const SHAPE_ELEMENTS = new Set(["path", "line", "polyline", "polygon", "circle", "ellipse", "rect"]);

function isNone(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "none" || s === "transparent";
}

function walk(node: XmlNode, matrix: Matrix, inherited: Inherited, ctx: Ctx, useDepth: number): void {
  const props = declaredProps(node, ctx.rules);
  if ((props.display ?? "").toLowerCase() === "none") return;
  if (props.opacity !== undefined && parseFloat(props.opacity) === 0) return;

  for (const [k, what] of [["clip-path", "recortes (clip-path)"], ["mask", "máscaras (mask)"], ["filter", "filtros (filter)"]] as const) {
    const v = props[k];
    if (v && v.toLowerCase() !== "none") {
      throw new DesignImportError("SVG_UNSUPPORTED", `El SVG usa ${what}, que no se admiten. Expandí/aplanó el diseño antes de importarlo.`);
    }
  }

  let stroke = props.stroke ?? inherited.stroke;
  if (props["stroke-opacity"] !== undefined && parseFloat(props["stroke-opacity"]) === 0) stroke = "none";
  const style: Inherited = {
    fill: props.fill ?? inherited.fill,
    stroke,
    visible: props.visibility !== undefined ? !/^(hidden|collapse)$/i.test(props.visibility) : inherited.visible,
  };

  const m = multiply(matrix, parseTransform(node.attrs.transform));

  if (TEXT_ELEMENTS.has(node.name)) {
    throw new DesignImportError("SVG_TEXT", "Este SVG contiene texto editable. Convertí el texto a curvas/trazados antes de importarlo.");
  }
  if (node.name === "image") {
    throw new DesignImportError("SVG_UNSUPPORTED", "El SVG contiene imágenes incrustadas, que no se admiten. Usá un SVG vectorial de líneas.");
  }

  if (node.name === "use") {
    const href = (node.attrs.href ?? "").trim();
    const target = href.startsWith("#") ? ctx.byId.get(href.slice(1)) : undefined;
    if (!target) return;
    if (useDepth >= MAX_USE_DEPTH) throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (referencias <use> anidadas en exceso).");
    const um = multiply(m, [1, 0, 0, 1, num(node.attrs.x), num(node.attrs.y)]);
    if (target.name === "symbol" || target.name === "svg") {
      for (const c of target.children) walkChild(c, um, style, ctx, useDepth + 1);
    } else {
      walk(target, um, style, ctx, useDepth + 1);
    }
    return;
  }

  if (node.name === "svg" || node.name === "g" || node.name === "a" || node.name === "switch") {
    for (const c of node.children) walkChild(c, m, style, ctx, useDepth);
    return;
  }

  if (!SHAPE_ELEMENTS.has(node.name) || !style.visible) return;
  const subs = routeSubPaths(node);
  if (subs.length === 0) return;

  const hasStroke = !isNone(style.stroke);
  const hasFill = !isNone(style.fill);
  // <line> no tiene área: siempre es un recorrido. El resto, solo si tiene trazo o no tiene relleno.
  const isRoute = node.name === "line" || hasStroke || !hasFill;
  if (!isRoute) {
    ctx.filledShapes++;
    return;
  }
  if (++ctx.shapeCount > MAX_SHAPES) throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (demasiadas formas).");
  ctx.routes.push({ subs: transformSubPaths(subs, m) });
}

function walkChild(node: XmlNode, matrix: Matrix, inherited: Inherited, ctx: Ctx, useDepth: number): void {
  if (NON_RENDERED.has(node.name)) return;
  walk(node, matrix, inherited, ctx, useDepth);
}

/** Traslación del viewBox del <svg> raíz (la escala uniforme se absorbe al normalizar por el alto del recorrido). */
function viewBoxMatrix(root: XmlNode): Matrix {
  const vb = root.attrs.viewBox ?? root.attrs.viewbox;
  if (!vb) return IDENTITY;
  const n = (vb.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return IDENTITY;
  return [1, 0, 0, 1, -n[0], -n[1]];
}

export function svgToNeonPaths(content: string, heightMm: number): NeonPathsResult {
  if (content.length > IMPORT_LIMITS.maxFileBytes) {
    throw new DesignImportError("FILE_TOO_LARGE", "El archivo SVG es demasiado grande (máximo 10 MB).");
  }
  const root = parseXml(content);
  scanTree(root);

  const rules: CssRule[] = [];
  collectStyles(root, rules);
  const byId = new Map<string, XmlNode>();
  collectIds(root, byId);

  const ctx: Ctx = { rules, byId, routes: [], filledShapes: 0, shapeCount: 0 };
  // El <svg> raíz también puede declarar su propio transform/estilo; el viewBox se aplica una sola vez, acá.
  walk(root, viewBoxMatrix(root), { fill: "black", stroke: "none", visible: true }, ctx, 0);

  if (ctx.routes.length === 0) {
    if (ctx.filledShapes > 0) throw new NeonInputError("SVG_FILL_ONLY", SVG_FILL_ONLY_MESSAGE);
    throw new NeonInputError("SVG_NO_PATHS", "El SVG no tiene recorridos (líneas/trazos) utilizables.");
  }

  // Pasada 1: tolerancia gruesa relativa al dibujo para conocer el alto; pasada 2: tolerancia en mm reales.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of ctx.routes) {
    const b = subPathsBounds(r.subs);
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX)) throw new NeonInputError("SVG_NO_PATHS", "El SVG no tiene recorridos (líneas/trazos) utilizables.");

  const flattenAll = (tol: number): NeonPath[] => {
    const out: NeonPath[] = [];
    let points = 0;
    for (const r of ctx.routes) {
      for (const sub of r.subs) {
        const pts = flattenSubPath(sub, tol);
        if (pts.length < 2) continue;
        points += pts.length;
        if (points > MAX_POINTS) throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (demasiados puntos). Simplificá el trazado antes de importarlo.");
        out.push({ points: pts, closed: !!sub.closed });
      }
    }
    return out;
  };

  const coarse = flattenAll(Math.max(maxX - minX, maxY - minY, 1e-9) / 3000);
  const bounds = pathsBounds(coarse);
  const heightSrc = bounds ? bounds.maxY - bounds.minY : 0;
  if (!bounds || heightSrc < 1e-9) {
    throw new NeonInputError("SVG_ZERO_HEIGHT", "El recorrido del SVG no tiene alto (es una línea horizontal): no se puede escalar por alto del diseño.");
  }
  const scale = heightMm / heightSrc;
  const fine = flattenAll(FLATTEN_TOLERANCE_MM / scale);
  const paths = scaleToMm(fine, scale, { flipY: true });
  if (paths.length === 0) throw new NeonInputError("SVG_NO_PATHS", "El SVG no tiene recorridos (líneas/trazos) utilizables.");

  const issues: NeonIssue[] = [];
  if (ctx.filledShapes > 0) {
    issues.push({
      code: "IGNORED_FILLED_SHAPES",
      message: `Se ignoraron ${ctx.filledShapes} forma${ctx.filledShapes === 1 ? "" : "s"} rellena${ctx.filledShapes === 1 ? "" : "s"} sin trazo: Neon LED solo usa líneas/trazos.`,
    });
  }
  return { paths, issues };
}
