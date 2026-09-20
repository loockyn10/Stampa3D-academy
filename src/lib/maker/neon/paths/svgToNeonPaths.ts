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
import { collectIds, scanTree } from "@/lib/maker/import/svgImport";
import { getNeonFont, type NeonFontDefinition } from "@/lib/maker/neon/fonts/neonFonts";
import { FLATTEN_TOLERANCE_MM, pathsBounds, scaleToMm } from "@/lib/maker/neon/paths/flattenNeonPath";
import { cascadeStyle, collectRules, isNoPaint, parseFontSize } from "@/lib/maker/neon/paths/svgStyles";
import { layoutNeonText } from "@/lib/maker/neon/paths/textToNeonPaths";
import { NeonInputError, type NeonFontId, type NeonIssue, type NeonPath, type NeonPathsResult } from "@/lib/maker/neon/types";

/**
 * SVG -> NeonPath[] (Neon LED). El SVG describe RECORRIDOS; qué elementos lo son se
 * decide por su pintura ya resuelta (atributos, `style`, CSS de <style>, herencia):
 *
 *  - STROKE visible (stroke != none/transparente, stroke-opacity > 0): es un
 *    recorrido, con o sin relleno — el fill se ignora y solo importa la geometría
 *    del path (el `stroke-width` NO define el ancho del Neon).
 *  - sin stroke y con FILL visible: forma rellena. No se convierte (no hay
 *    skeletonization); se ignora, y si no queda nada útil se rechaza con un error.
 *  - fill none y stroke sin especificar: recorrido (geometría de línea sin pintar).
 *  - fill none + stroke none explícitos: invisible, se ignora.
 *  - `<text>`: se convierte con la fuente Neon elegida (nunca con su font-family).
 *
 * Seguridad: mismo criterio que el importador de carteles (parser XML propio sin DOM,
 * `scanTree`: scripts, foreignObject, javascript:/data:, url() externos, entidades,
 * animaciones; los handlers on* nunca se leen).
 */

const NON_RENDERED = new Set([
  "defs", "symbol", "clipPath", "mask", "marker", "pattern", "linearGradient", "radialGradient", "filter",
  "style", "title", "desc", "metadata", "namedview", "font", "font-face",
]);
const SHAPE_ELEMENTS = new Set(["path", "line", "polyline", "polygon", "circle", "ellipse", "rect"]);
const MAX_USE_DEPTH = 16;
const MAX_SHAPES = 50000;
const MAX_POINTS = 400000;
const DEFAULT_FONT_SIZE = 16;
/** Altura de mayúscula típica respecto de font-size, para dimensionar el texto SVG. */
const TEXT_CAP_RATIO = 0.7;

export const SVG_FILL_ONLY_MESSAGE =
  "Este SVG contiene únicamente formas rellenas. Neon LED necesita recorridos de línea. La conversión automática a línea central se agregará más adelante.";
export const SVG_NO_ROUTES_MESSAGE = "No se encontraron recorridos de línea en el SVG.";

/** Conteos de diagnóstico de la clasificación (desarrollo/tests; la UI no los muestra). */
export interface NeonSvgStats {
  /** Elementos de geometría visibles considerados (path, line, circle...). */
  shapes: number;
  /** Elementos usados como recorrido (con stroke, o fill none sin stroke). */
  strokeRoutes: number;
  /** Elementos solo rellenos (sin stroke): ignorados. */
  fillOnly: number;
  /** Elementos <text> convertidos con la fuente Neon. */
  textElements: number;
  /** Elementos invisibles (fill y stroke none, display/visibility/opacity) u omitidos. */
  ignored: number;
  /** NeonPaths resultantes. */
  paths: number;
}

interface Inherited {
  fill: string | undefined;
  stroke: string | undefined;
  fillOpacity: number;
  strokeOpacity: number;
  visible: boolean;
  fontSize: number;
  textAnchor: string;
  color: string | undefined;
}

interface Ctx {
  rules: ReturnType<typeof collectRules>;
  byId: Map<string, XmlNode>;
  font: NeonFontDefinition;
  letterSpacingPct: number;
  routes: SubPath[][];
  stats: NeonSvgStats;
  shapeCount: number;
  unsupportedChars: Set<string>;
}

function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function opacityOf(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const t = v.trim();
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return fallback;
  return t.endsWith("%") ? n / 100 : n;
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

/** Subpaths de un elemento de geometría tomado como CENTERLINE. */
function routeSubPaths(node: XmlNode): SubPath[] {
  const a = node.attrs;
  switch (node.name) {
    case "path":
      return a.d ? parsePathData(a.d) : [];
    case "line":
      return lineSubPath([[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]], false);
    case "polyline":
      return a.points ? lineSubPath(pointList(a.points), false) : [];
    case "polygon": {
      const pts = a.points ? pointList(a.points) : [];
      return lineSubPath(pts, pts.length >= 3);
    }
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

/** Texto plano y posición de cada "línea" de un <text> (un tspan con x/y propios abre una línea nueva). */
function textRuns(node: XmlNode): { text: string; x: number; y: number }[] {
  const x0 = num(node.attrs.x?.split(/[\s,]+/)[0]);
  const y0 = num(node.attrs.y?.split(/[\s,]+/)[0]);
  const runs: { text: string; x: number; y: number }[] = [{ text: node.text, x: x0, y: y0 }];
  const collect = (n: XmlNode) => {
    for (const child of n.children) {
      if (child.name === "tspan" || child.name === "textPath" || child.name === "tref") {
        const hasPos = child.attrs.x !== undefined || child.attrs.y !== undefined;
        if (hasPos) {
          runs.push({ text: child.text, x: num(child.attrs.x?.split(/[\s,]+/)[0], runs[runs.length - 1].x), y: num(child.attrs.y?.split(/[\s,]+/)[0], runs[runs.length - 1].y) });
        } else {
          runs[runs.length - 1].text += child.text;
        }
        collect(child);
      }
    }
  };
  collect(node);
  return runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ").trim() })).filter((r) => r.text !== "");
}

function walk(node: XmlNode, ancestors: XmlNode[], matrix: Matrix, inherited: Inherited, ctx: Ctx, useDepth: number): void {
  const props = cascadeStyle(node, ancestors, ctx.rules);
  if ((props.display ?? "").toLowerCase() === "none") {
    if (SHAPE_ELEMENTS.has(node.name) || node.name === "text") ctx.stats.ignored++;
    return;
  }
  if (props.opacity !== undefined && opacityOf(props.opacity, 1) === 0) {
    if (SHAPE_ELEMENTS.has(node.name) || node.name === "text") ctx.stats.ignored++;
    return;
  }

  for (const [k, what] of [["clip-path", "recortes (clip-path)"], ["mask", "máscaras (mask)"], ["filter", "filtros (filter)"]] as const) {
    const v = props[k];
    if (v && v.toLowerCase() !== "none") {
      throw new DesignImportError("SVG_UNSUPPORTED", `El SVG usa ${what}. Expandí/aplanó el diseño antes de importarlo.`);
    }
  }

  const pick = (v: string | undefined, inh: string | undefined) => (v === undefined || v.trim().toLowerCase() === "inherit" ? inh : v.trim());
  const color = pick(props.color, inherited.color);
  const resolvePaint = (v: string | undefined) => (v && v.toLowerCase() === "currentcolor" ? (color ?? "black") : v);
  const style: Inherited = {
    fill: resolvePaint(pick(props.fill, inherited.fill)),
    stroke: resolvePaint(pick(props.stroke, inherited.stroke)),
    fillOpacity: opacityOf(props["fill-opacity"], inherited.fillOpacity),
    strokeOpacity: opacityOf(props["stroke-opacity"], inherited.strokeOpacity),
    visible: props.visibility !== undefined ? !/^(hidden|collapse)$/i.test(props.visibility) : inherited.visible,
    fontSize: parseFontSize(props["font-size"], inherited.fontSize),
    textAnchor: (props["text-anchor"] ?? inherited.textAnchor).trim().toLowerCase(),
    color,
  };

  const m = multiply(matrix, parseTransform(node.attrs.transform));

  if (node.name === "image") {
    throw new DesignImportError("SVG_UNSUPPORTED", "El SVG contiene imágenes incrustadas. Usá un SVG vectorial de líneas.");
  }

  if (node.name === "text") {
    handleText(node, m, style, ctx);
    return;
  }

  if (node.name === "use") {
    const href = (node.attrs.href ?? "").trim();
    const target = href.startsWith("#") ? ctx.byId.get(href.slice(1)) : undefined;
    if (!target) return;
    if (useDepth >= MAX_USE_DEPTH) throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (referencias <use> anidadas en exceso).");
    const um = multiply(m, [1, 0, 0, 1, num(node.attrs.x), num(node.attrs.y)]);
    const chain = [...ancestors, node];
    if (target.name === "symbol" || target.name === "svg") {
      for (const c of target.children) walkChild(c, [...chain, target], um, style, ctx, useDepth + 1);
    } else {
      walk(target, chain, um, style, ctx, useDepth + 1);
    }
    return;
  }

  if (node.name === "svg" || node.name === "g" || node.name === "a" || node.name === "switch") {
    const chain = [...ancestors, node];
    for (const c of node.children) walkChild(c, chain, m, style, ctx, useDepth);
    return;
  }

  if (!SHAPE_ELEMENTS.has(node.name)) return;
  const subs = routeSubPaths(node);
  if (subs.length === 0) return;
  if (!style.visible) {
    ctx.stats.ignored++;
    return;
  }
  ctx.stats.shapes++;

  const strokeVisible = style.stroke !== undefined && !isNoPaint(style.stroke) && style.strokeOpacity > 0;
  const strokeUnspecified = style.stroke === undefined;
  const fillVisible = (style.fill === undefined || !isNoPaint(style.fill)) && style.fillOpacity > 0; // el fill inicial es negro
  // <line> no tiene área: nunca es "forma rellena"; solo se descarta si su stroke es explícitamente invisible.
  const isRoute = node.name === "line" ? strokeVisible || strokeUnspecified : strokeVisible || (strokeUnspecified && !fillVisible);
  if (isRoute) {
    if (++ctx.shapeCount > MAX_SHAPES) throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (demasiadas formas).");
    ctx.stats.strokeRoutes++;
    ctx.routes.push(transformSubPaths(subs, m));
  } else if (node.name !== "line" && fillVisible) {
    ctx.stats.fillOnly++; // relleno sin trazo (incluye stroke="none" explícito): forma, no recorrido
  } else {
    ctx.stats.ignored++; // fill y stroke ambos invisibles
  }
}

function handleText(node: XmlNode, m: Matrix, style: Inherited, ctx: Ctx): void {
  if (!style.visible) {
    ctx.stats.ignored++;
    return;
  }
  const runs = textRuns(node);
  if (runs.length === 0) {
    ctx.stats.ignored++;
    return;
  }
  ctx.stats.textElements++;
  const capSvg = style.fontSize * TEXT_CAP_RATIO;
  const s = capSvg / ctx.font.capHeight;
  for (const run of runs) {
    const layout = layoutNeonText(run.text, ctx.font, ctx.letterSpacingPct);
    for (const ch of layout.unsupported) ctx.unsupportedChars.add(ch);
    if (layout.subs.length === 0) continue;
    const shift = style.textAnchor === "middle" ? layout.width * s * 0.5 : style.textAnchor === "end" ? layout.width * s : 0;
    // Glifos con Y arriba -> SVG con Y abajo; luego el transform acumulado del <text>.
    const placed = transformSubPaths(layout.subs, [s, 0, 0, -s, run.x - shift, run.y]);
    ctx.routes.push(transformSubPaths(placed, m));
  }
}

function walkChild(node: XmlNode, ancestors: XmlNode[], matrix: Matrix, inherited: Inherited, ctx: Ctx, useDepth: number): void {
  if (NON_RENDERED.has(node.name)) return;
  walk(node, ancestors, matrix, inherited, ctx, useDepth);
}

/** Traslación del viewBox del <svg> raíz (la escala uniforme se absorbe al normalizar por el alto del recorrido). */
function viewBoxMatrix(root: XmlNode): Matrix {
  const vb = root.attrs.viewBox ?? root.attrs.viewbox;
  if (!vb) return IDENTITY;
  const n = (vb.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return IDENTITY;
  return [1, 0, 0, 1, -n[0], -n[1]];
}

export interface NeonSvgOptions {
  /** Fuente Neon para los <text> del SVG. */
  fontId?: NeonFontId;
  letterSpacingPct?: number;
}

interface Collected {
  routes: SubPath[][];
  stats: NeonSvgStats;
  font: NeonFontDefinition;
  unsupportedChars: string[];
}

function collect(content: string, options: NeonSvgOptions): Collected {
  if (content.length > IMPORT_LIMITS.maxFileBytes) {
    throw new DesignImportError("FILE_TOO_LARGE", "El archivo SVG es demasiado grande (máximo 10 MB).");
  }
  const root = parseXml(content);
  scanTree(root);
  const byId = new Map<string, XmlNode>();
  collectIds(root, byId);
  const font = getNeonFont(options.fontId ?? "mistral-singleline");
  const ctx: Ctx = {
    rules: collectRules(root),
    byId,
    font,
    letterSpacingPct: options.letterSpacingPct ?? 0,
    routes: [],
    stats: { shapes: 0, strokeRoutes: 0, fillOnly: 0, textElements: 0, ignored: 0, paths: 0 },
    shapeCount: 0,
    unsupportedChars: new Set(),
  };
  walk(
    root,
    [],
    viewBoxMatrix(root),
    { fill: undefined, stroke: undefined, fillOpacity: 1, strokeOpacity: 1, visible: true, fontSize: DEFAULT_FONT_SIZE, textAnchor: "start", color: undefined },
    ctx,
    0,
  );
  return { routes: ctx.routes, stats: ctx.stats, font, unsupportedChars: [...ctx.unsupportedChars] };
}

/**
 * Diagnóstico de clasificación (desarrollo/tests): cuántos elementos se toman como
 * recorrido, cuántos son solo relleno, cuántos textos, cuántos se ignoran. No escala ni aplana.
 */
export function inspectNeonSvg(content: string, options: NeonSvgOptions = {}): NeonSvgStats {
  const c = collect(content, options);
  return { ...c.stats, paths: c.routes.reduce((n, subs) => n + subs.length, 0) };
}

export function svgToNeonPaths(content: string, heightMm: number, options: NeonSvgOptions = {}): NeonPathsResult & { stats: NeonSvgStats } {
  const { routes, stats, font, unsupportedChars } = collect(content, options);
  const allSubs = routes.flat();

  if (allSubs.length === 0) {
    if (stats.fillOnly > 0) throw new NeonInputError("SVG_FILL_ONLY", SVG_FILL_ONLY_MESSAGE);
    throw new NeonInputError("SVG_NO_PATHS", SVG_NO_ROUTES_MESSAGE);
  }

  // Pasada 1: tolerancia gruesa relativa al dibujo para conocer el alto; pasada 2: tolerancia en mm reales.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const b0 = subPathsBounds(allSubs);
  if (b0) [minX, minY, maxX, maxY] = [b0.minX, b0.minY, b0.maxX, b0.maxY];
  if (!Number.isFinite(minX)) throw new NeonInputError("SVG_NO_PATHS", SVG_NO_ROUTES_MESSAGE);

  const flattenAll = (tol: number): NeonPath[] => {
    const out: NeonPath[] = [];
    let points = 0;
    for (const sub of allSubs) {
      const pts = flattenSubPath(sub, tol);
      if (pts.length < 2) continue;
      points += pts.length;
      if (points > MAX_POINTS) throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (demasiados puntos). Simplificá el trazado antes de importarlo.");
      out.push({ points: pts, closed: !!sub.closed });
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
  const paths = scaleToMm(flattenAll(FLATTEN_TOLERANCE_MM / scale), scale, { flipY: true });
  if (paths.length === 0) throw new NeonInputError("SVG_NO_PATHS", SVG_NO_ROUTES_MESSAGE);
  stats.paths = paths.length;

  const issues: NeonIssue[] = [];
  if (stats.fillOnly > 0) {
    issues.push({
      code: "IGNORED_FILLED_SHAPES",
      message: `Se importaron ${paths.length} recorrido${paths.length === 1 ? "" : "s"}. ${stats.fillOnly} forma${stats.fillOnly === 1 ? " rellena fue ignorada" : "s rellenas fueron ignoradas"}.`,
    });
  }
  if (stats.textElements > 0) {
    issues.push({ code: "SVG_TEXT_FONT", message: `El texto del SVG se convirtió usando ${font.label}.` });
  }
  if (unsupportedChars.length > 0) {
    issues.push({ code: "UNSUPPORTED_CHARS", message: `Caracteres del texto SVG sin trazo en esta fuente (omitidos): ${unsupportedChars.join(" ")}` });
  }
  return { paths, issues, stats };
}
