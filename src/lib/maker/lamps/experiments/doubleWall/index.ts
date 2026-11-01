import { analyzeMeshFast } from "@/lib/maker/lamps/geometry/fastAnalyze";
import { buildDoubleWall, type DoubleWallBuild } from "@/lib/maker/lamps/experiments/doubleWall/build";
import { DEFAULT_DOUBLE_WALL, measureChamberGap, minFluteCurvatureRadius, type DoubleWallParams, type DoubleWallStrategy, type GapReport } from "@/lib/maker/lamps/experiments/doubleWall/profiles";
import { countComponents, summarizeLayer } from "@/lib/maker/lamps/experiments/doubleWall/sliceAnalysis";
import { indexedBounds } from "@/lib/maker/mugs/geometry/mesh";

export * from "@/lib/maker/lamps/experiments/doubleWall/profiles";
export * from "@/lib/maker/lamps/experiments/doubleWall/sliceAnalysis";
export { buildDoubleWall, type DoubleWallBuild } from "@/lib/maker/lamps/experiments/doubleWall/build";

export interface DoubleWallIssue {
  code: string;
  message: string;
}

/** Valida los parámetros y la geometría resultante. Devuelve errores (no se exporta) y avisos. Nada se corrige en silencio. */
export function validateDoubleWall(p: DoubleWallParams): { errors: DoubleWallIssue[]; warnings: DoubleWallIssue[]; gap: GapReport } {
  const errors: DoubleWallIssue[] = [];
  const warnings: DoubleWallIssue[] = [];
  const o = p.outer, i = p.inner;
  const positive = [p.heightMm, p.wallMm, p.minGapMm, o.maxDiameterMm, o.endDiameterMm, i.endDiameterMm, p.rowMm, p.samplesPerFlute, p.innerSegments];
  if (positive.some((v) => !Number.isFinite(v) || v <= 0)) errors.push({ code: "DW_PARAM_RANGE", message: "Altura, espesor, separación, diámetros y resolución deben ser números positivos." });
  if (!Number.isInteger(o.flutes) || o.flutes < 3) errors.push({ code: "DW_FLUTES", message: "Las estrías deben ser un entero ≥ 3." });
  if (errors.length) return { errors, warnings, gap: { minGapMm: NaN, atZ: 0, minRadialGapMm: NaN, minInnerVoidRadiusMm: NaN } };
  if (p.wallMm < 0.8) errors.push({ code: "DW_WALL_THIN", message: "El espesor del modelo (< 0,8 mm) es menor que 2 líneas de 0,4 mm: el laminador puede no reconocer la pared." });
  if (o.maxDiameterMm < o.endDiameterMm) errors.push({ code: "DW_BULGE", message: "El diámetro máximo no puede ser menor que el de los bordes (la pared exterior es abombada)." });
  if (o.fluteAmplitudeMm < 0 || o.fluteAmplitudeMm > 0.2 * o.endDiameterMm / 2) errors.push({ code: "DW_FLUTE_DEPTH", message: "La profundidad de las estrías es negativa o excesiva." });
  const rc = minFluteCurvatureRadius(p);
  if (rc < p.wallMm * 1.5) errors.push({ code: "DW_FLUTE_SHARP", message: `Las crestas de las estrías tienen un radio de curvatura de ${rc.toFixed(2)} mm: con ${p.wallMm} mm de espesor la pared interior del desfase se pliega. Reducí la profundidad o la cantidad de estrías.` });
  if (!Number.isFinite(p.slitMm) || p.slitMm < 0.5 || p.slitMm > 6) errors.push({ code: "DW_SLIT", message: "La abertura posterior debe estar entre 0,5 y 6 mm." });
  if (p.ribs < 2 || p.ribs > 12) errors.push({ code: "DW_RIBS", message: "Los nervios del prototipo convencional deben ser entre 2 y 12." });
  if (p.ribMm < 0.8) errors.push({ code: "DW_RIB_THIN", message: "Los nervios deben medir al menos 0,8 mm." });
  const gap = measureChamberGap(p);
  if (!(gap.minGapMm >= p.minGapMm)) {
    errors.push({ code: "DW_GAP", message: `La separación mínima medida entre las paredes (estrías incluidas) es ${gap.minGapMm.toFixed(2)} mm a ${gap.atZ.toFixed(0)} mm de altura: menos de los ${p.minGapMm} mm exigidos. Reducí el diámetro de la pared interior o achicá la cintura/estrías; no se corrige automáticamente.` });
  }
  if (gap.minInnerVoidRadiusMm < 15) warnings.push({ code: "DW_VOID_SMALL", message: `El vacío central queda con un radio mínimo de ${gap.minInnerVoidRadiusMm.toFixed(1)} mm: no entra una bombilla ni un portalámparas E27 (esto es solo el experimento de fabricación).` });
  return { errors, warnings, gap };
}

export interface DoubleWallReport {
  strategy: DoubleWallStrategy;
  triangles: number;
  stlBytes: number;
  components: number;
  watertight: boolean;
  volumeCm3: number;
  boundingBoxMm: { width: number; depth: number; height: number };
  gap: GapReport;
  /** Capas de muestra (cada 0,2 mm sobre una malla gruesa se resume cada ≈ 10 mm): contornos, huecos y longitudes. */
  layers: { z: number; outerContours: number; holes: number; outerLengthMm: number; totalLengthMm: number }[];
  /** Todas las capas de 0,2 mm: contornos exteriores y huecos mínimo/máximo, y el mayor salto relativo de la longitud del contorno entre capas consecutivas. */
  layerStats: { layers: number; outerContours: [number, number]; holes: [number, number]; outerLengthMm: [number, number]; maxLengthJumpPct: number };
  /** Estimaciones GEOMÉTRICAS (no del laminador) de la ruta jarrón: longitud del contorno exterior × altura de capa × ancho de línea. */
  estimate: { layerHeightMm: number; lineWidthMm: number; vasePathVolumeCm3: number; /** Todos los lazos de la sección con UN perímetro cada uno (impresión convencional con 1 pared). */ onePerimeterVolumeCm3: number; solidVolumeCm3: number; meanOuterContourMm: number };
  warnings: DoubleWallIssue[];
}

export interface DoubleWallPrototype {
  build: DoubleWallBuild;
  report: DoubleWallReport;
}

/** Genera un prototipo ("vase-c" o "conventional") y su informe medido sobre la malla. Lanza si la validación falla. */
export function createDoubleWallPrototype(strategy: DoubleWallStrategy, params: DoubleWallParams = DEFAULT_DOUBLE_WALL, opts: { layerHeightMm?: number; lineWidthMm?: number } = {}): DoubleWallPrototype {
  const check = validateDoubleWall(params);
  if (check.errors.length) throw new Error(check.errors.map((e) => `${e.code}: ${e.message}`).join("\n"));
  const build = buildDoubleWall(params, strategy);
  const a = analyzeMeshFast(build.mesh);
  const b = indexedBounds(build.mesh);
  const layerH = opts.layerHeightMm ?? 0.2;
  const lineW = opts.lineWidthMm ?? 0.42;
  // longitud del contorno exterior por capa (todas las capas de 0,2 mm sobre z + media capa para no caer sobre una fila de la malla)
  const layers: DoubleWallReport["layers"] = [];
  let pathMm = 0;
  let allMm = 0;
  const stats = { oc: [Infinity, 0], h: [Infinity, 0], len: [Infinity, 0], jump: 0, prev: 0 };
  const nLayers = Math.floor(params.heightMm / layerH);
  const sampleEvery = Math.max(1, Math.round(nLayers / 12));
  for (let k = 0; k < nLayers; k++) {
    const z = (k + 0.5) * layerH + 0.0123;
    const wantSample = k % sampleEvery === 0;
    const s = summarizeLayer(build.mesh, z, false);
    pathMm += s.outerLength;
    allMm += s.totalLength;
    stats.oc = [Math.min(stats.oc[0], s.outerContours), Math.max(stats.oc[1], s.outerContours)];
    stats.h = [Math.min(stats.h[0], s.holes), Math.max(stats.h[1], s.holes)];
    stats.len = [Math.min(stats.len[0], s.outerLength), Math.max(stats.len[1], s.outerLength)];
    if (k > 0 && stats.prev > 0) stats.jump = Math.max(stats.jump, Math.abs(s.outerLength - stats.prev) / stats.prev);
    stats.prev = s.outerLength;
    if (wantSample) layers.push({ z: Math.round(z * 100) / 100, outerContours: s.outerContours, holes: s.holes, outerLengthMm: Math.round(s.outerLength * 10) / 10, totalLengthMm: Math.round(s.totalLength * 10) / 10 });
  }
  const mean = pathMm / nLayers;
  return {
    build,
    report: {
      strategy,
      triangles: a.triangleCount,
      stlBytes: 84 + 50 * a.triangleCount,
      components: countComponents(build.mesh),
      watertight: a.boundaryEdges === 0 && a.nonManifoldEdges === 0 && a.inconsistentEdges === 0 && a.degenerate === 0 && a.nonFinite === 0 && a.volume > 0,
      volumeCm3: a.volume / 1000,
      boundingBoxMm: { width: b.maxX - b.minX, depth: b.maxY - b.minY, height: b.maxZ - b.minZ },
      gap: check.gap,
      layers,
      layerStats: { layers: nLayers, outerContours: stats.oc as [number, number], holes: stats.h as [number, number], outerLengthMm: [Math.round(stats.len[0] * 10) / 10, Math.round(stats.len[1] * 10) / 10], maxLengthJumpPct: Math.round(stats.jump * 10000) / 100 },
      estimate: { layerHeightMm: layerH, lineWidthMm: lineW, vasePathVolumeCm3: (pathMm * layerH * lineW) / 1000, onePerimeterVolumeCm3: (allMm * layerH * lineW) / 1000, solidVolumeCm3: a.volume / 1000, meanOuterContourMm: mean },
      warnings: check.warnings,
    },
  };
}
