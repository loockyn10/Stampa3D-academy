import type { Point2D } from "@/lib/maker/types";
import { NeonInputError, type NeonIssue, type NeonPath } from "@/lib/maker/neon/types";
import { cleanNeonPath, scaleToMm } from "@/lib/maker/neon/paths/flattenNeonPath";
import {
  alphaField,
  backgroundValue,
  cleaningParams,
  cropField,
  distanceTransform,
  foregroundMask,
  gaussianBlur,
  hasSignificantAlpha,
  labelComponents,
  luminanceField,
  majorityFilter,
  maskBoundingBox,
  maskCount,
  otsuThreshold,
  removeSmallFeatures,
  resampleField,
  type FieldKind,
} from "@/lib/maker/neon/raster/imageProcessing";
import { pruneSkeleton } from "@/lib/maker/neon/raster/pruneSkeleton";
import { simplifyRawPaths } from "@/lib/maker/neon/raster/simplifyNeonPaths";
import { skeletonize } from "@/lib/maker/neon/raster/skeletonize";
import { bridgeCloseEndpoints, buildSkeletonGraph, contractDegreeTwo, summarizeGraph } from "@/lib/maker/neon/raster/skeletonGraph";
import { smoothRawPaths } from "@/lib/maker/neon/raster/smoothNeonPaths";
import { extendEndpoints, graphToRawPaths } from "@/lib/maker/neon/raster/traceSkeletonPaths";
import { RASTER_LIMITS, type RasterConversion, type RasterImage, type RasterSettings } from "@/lib/maker/neon/raster/types";

/** Aristas máximas del grafo antes de aceptar procesarlo (las operaciones del grafo son O(nodos × aristas)). */
const MAX_GRAPH_EDGES = 2500;
/** Un hueco entre extremos libres de hasta esto (fracción del lado mayor, mínimo 2.5 px) se considera un corte del umbral y se une. */
const BRIDGE_FRACTION = 0.004;
/** El foreground que ocupa más que esto de la imagen original no se puede distinguir del fondo. */
const MAX_FOREGROUND_RATIO = 0.92;

const TOO_COMPLEX_MESSAGE = "Esta imagen es demasiado compleja para generar un recorrido Neon limpio. Usá un logo, dibujo o imagen de alto contraste.";

function fail(code: ConstructorParameters<typeof NeonInputError>[0], message: string): never {
  throw new NeonInputError(code, message);
}

/**
 * RasterImage -> NeonPath[] (mm). Pipeline único para PNG y JPEG:
 *
 *  campo (alpha | luminancia) -> umbral (alpha fijo | Otsu | manual) -> máscara + invertir -> recorte del foreground
 *  -> resolución de trabajo (campo remuestreado) -> limpieza -> skeleton (Guo–Hall) -> grafo -> puentes de huecos
 *  -> poda -> extensión de extremos -> recorridos -> simplificación -> suavizado -> NeonPath (mm, Y arriba)
 *
 * La escala física sale del ALTO del foreground recortado (`designHeightMm` = alto visible del diseño), no del alto del
 * skeleton: así una barra horizontal (skeleton de alto 0) también se puede escalar y la poda en mm es coherente.
 */
export function rasterToNeonPaths(image: RasterImage, settings: RasterSettings, designHeightMm: number): RasterConversion {
  const t0 = Date.now();
  const { width: W0, height: H0 } = image;

  // 1. Campo y modo de detección.
  const alphaSignificant = hasSignificantAlpha(image);
  const modeUsed: FieldKind =
    settings.detectionMode === "alpha" ? "alpha" : settings.detectionMode === "luminance" ? "luminance" : alphaSignificant ? "alpha" : "luminance";
  const field = modeUsed === "alpha" ? alphaField(image) : luminanceField(image, settings.contrast ?? 0);

  // 2. Umbral.
  const thresholdAuto = modeUsed === "luminance" && settings.threshold === null;
  const thresholdUsed = modeUsed === "alpha" ? clamp255(settings.alphaThreshold) : thresholdAuto ? otsuThreshold(field) : clamp255(settings.threshold ?? 128);

  // 3. Máscara a resolución original: solo para saber si hay foreground y dónde está.
  const full = foregroundMask(field, thresholdUsed, modeUsed, settings.invert);
  const fgCount = maskCount(full);
  if (fgCount === 0) {
    fail("RASTER_EMPTY", modeUsed === "alpha" ? "No se encontró ningún foreground: la imagen es totalmente transparente con este umbral." : "No se encontró ningún foreground con este umbral. Probá cambiar el umbral o Invertir.");
  }
  if (fgCount / full.length > MAX_FOREGROUND_RATIO) {
    fail("RASTER_FULL", "El foreground ocupa casi toda la imagen, así que no se distingue del fondo. Probá con Invertir o ajustá el umbral.");
  }

  // 4. Recorte automático (con un pequeño margen técnico) y resolución de trabajo.
  const box = maskBoundingBox(full, W0, H0);
  if (!box) fail("RASTER_EMPTY", "No se encontró ningún foreground.");
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const margin = Math.max(2, Math.round(Math.max(bw, bh) * RASTER_LIMITS.cropMarginFraction));
  const fillValue = backgroundValue(modeUsed, settings.invert);
  const crop = cropField(field, W0, H0, box, margin, fillValue);

  const longest = Math.max(crop.width, crop.height);
  let scale = 1;
  if (longest > RASTER_LIMITS.workingMaxPx) scale = RASTER_LIMITS.workingMaxPx / longest;
  else if (longest < RASTER_LIMITS.workingMinPx) scale = Math.min(RASTER_LIMITS.maxUpscale, RASTER_LIMITS.workingMinPx / longest);
  const workW = Math.max(8, Math.round(crop.width * scale));
  const workH = Math.max(8, Math.round(crop.height * scale));
  // Borde extra vacío de 2 px: el skeleton lee vecinos sin salirse de la imagen.
  const PAD = 2;
  const resampled = resampleField(crop.data, crop.width, crop.height, workW, workH);
  const padW = workW + 2 * PAD, padH = workH + 2 * PAD;
  let workField: Uint8Array = new Uint8Array(padW * padH).fill(fillValue);
  for (let y = 0; y < workH; y++) workField.set(resampled.subarray(y * workW, (y + 1) * workW), (y + PAD) * padW + PAD);

  // 5. Limpieza: blur suave del campo -> umbral -> islas/agujeros diminutos -> mayoría 3×3 (niveles altos).
  const clean = cleaningParams(settings.cleaning);
  workField = gaussianBlur(workField, padW, padH, clean.sigma);
  let mask = foregroundMask(workField, thresholdUsed, modeUsed, settings.invert);
  if (clean.sizeFactor > 0) {
    const base = Math.max(6, Math.round(1.5e-4 * padW * padH));
    mask = removeSmallFeatures(mask, padW, padH, base * clean.sizeFactor, base * clean.sizeFactor).mask;
    if (clean.majority) mask = majorityFilter(mask, padW, padH);
  }
  // El borde exterior siempre vacío.
  for (let x = 0; x < padW; x++) {
    mask[x] = 0;
    mask[(padH - 1) * padW + x] = 0;
  }
  for (let y = 0; y < padH; y++) {
    mask[y * padW] = 0;
    mask[y * padW + padW - 1] = 0;
  }

  const fgBox = maskBoundingBox(mask, padW, padH);
  if (!fgBox) fail("RASTER_EMPTY", "La limpieza eliminó todo el foreground (es demasiado pequeño o ruidoso). Bajá el nivel de limpieza.");
  const fgH = fgBox.y1 - fgBox.y0;
  const mmPerPx = designHeightMm / fgH;

  const components = labelComponents(mask, padW, padH, 1);
  if (components.count > RASTER_LIMITS.maxComponents) fail("RASTER_TOO_COMPLEX", TOO_COMPLEX_MESSAGE);

  // 6. Skeleton y grafo.
  const skel = skeletonize(mask, padW, padH);
  const skeletonPixels = maskCount(skel);
  if (skeletonPixels === 0) fail("RASTER_NO_PATH", "No se pudo obtener un recorrido de esta imagen (el foreground es demasiado pequeño o compacto).");
  const graph = buildSkeletonGraph(skel, padW, padH);
  if (graph.edges.size > MAX_GRAPH_EDGES) fail("RASTER_TOO_COMPLEX", TOO_COMPLEX_MESSAGE);
  contractDegreeTwo(graph);
  bridgeCloseEndpoints(graph, Math.max(2.5, Math.max(padW, padH) * BRIDGE_FRACTION));

  // 7. Poda de ramas terminales cortas (mm -> px con la escala física ya conocida).
  const minLenPx = settings.pruneMm > 0 ? settings.pruneMm / mmPerPx : 0;
  // Radio local del trazo: un espolón más corto que ~1.3× el radio en su bifurcación es un abultamiento de esquina (p.ej. el vértice de una "A").
  const dist = minLenPx > 0 ? distanceTransform(mask, padW, padH) : null;
  const radiusAt = (x: number, y: number) => {
    let best = 0;
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = cx + dx, py = cy + dy;
        if (dist && px >= 0 && py >= 0 && px < padW && py < padH) best = Math.max(best, dist[py * padW + px]);
      }
    }
    return best;
  };
  const pruned = pruneSkeleton(graph, minLenPx, dist ? { radiusAt } : {});
  extendEndpoints(graph, mask, padW, padH, Math.max(padW, padH) * 0.06);
  const summary = summarizeGraph(graph);

  // 8. Recorridos -> simplificación -> suavizado (en px), luego a mm.
  const rawPaths = smoothRawPaths(simplifyRawPaths(graphToRawPaths(graph), settings.simplify), settings.smoothing);
  if (rawPaths.length === 0) fail("RASTER_NO_PATH", "No se pudo obtener un recorrido de esta imagen. Probá bajar la poda o la limpieza.");
  if (rawPaths.length > RASTER_LIMITS.maxPaths) fail("RASTER_TOO_COMPLEX", TOO_COMPLEX_MESSAGE);

  // px (Y abajo) -> mm (Y arriba), esquina mínima en (0, 0).
  const yBottom = fgBox.y1;
  const xLeft = fgBox.x0;
  const toMm = (p: Point2D): Point2D => [(p[0] - xLeft) * mmPerPx, (yBottom - p[1]) * mmPerPx];
  const mmPaths: NeonPath[] = [];
  for (const p of rawPaths) {
    const cleaned = cleanNeonPath(p.pts.map(toMm), p.closed);
    if (cleaned) mmPaths.push(cleaned);
  }
  const paths = scaleToMm(mmPaths, 1, { flipY: false });
  if (paths.length === 0) fail("RASTER_NO_PATH", "No se pudo obtener un recorrido de esta imagen.");

  const issues: NeonIssue[] = [];
  if (summary.junctions > 0) {
    issues.push({
      code: "RASTER_JUNCTIONS",
      message: `El recorrido contiene ${summary.junctions} bifurcación${summary.junctions === 1 ? "" : "es"}. Las bifurcaciones pueden requerir segmentos separados de Neon Flex.`,
    });
  }
  if (components.count > RASTER_LIMITS.warnComponents || paths.length > RASTER_LIMITS.warnPaths) {
    issues.push({ code: "RASTER_COMPLEX", message: `La imagen tiene mucho detalle (${paths.length} recorridos). Revisá la máscara; un logo o dibujo de alto contraste da mejores resultados.` });
  }
  if (fgCount / full.length > 0.5) {
    issues.push({ code: "RASTER_HINT", message: "El foreground ocupa más de la mitad de la imagen. Si el recorrido no es el esperado, probá Invertir." });
  }

  return {
    paths,
    issues,
    preview: { mask: { width: padW, height: padH, data: mask }, pathsPx: rawPaths.map((p) => p.pts), closed: rawPaths.map((p) => p.closed) },
    stats: {
      sourceWidth: W0,
      sourceHeight: H0,
      workingWidth: padW,
      workingHeight: padH,
      modeUsed,
      thresholdUsed,
      thresholdAuto,
      components: components.count,
      skeletonPixels,
      paths: paths.length,
      junctions: summary.junctions,
      endpoints: summary.endpoints,
      loops: summary.cycles,
      prunedBranches: pruned.branches,
      mmPerPx,
      ms: Date.now() - t0,
    },
  };
}

function clamp255(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 128;
}
