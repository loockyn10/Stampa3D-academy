import type * as ClipperLib from "clipper-lib";
import type { LetterGeometryResult } from "@/lib/maker/types";
import { DesignImportError } from "@/lib/maker/import/types";
import { meshBounds } from "@/lib/maker/printOrientation";
import { channelInnerWidth, channelOuterWidth } from "@/lib/maker/neon/defaults";
import { createChannelGeometry } from "@/lib/maker/neon/geometry/createChannelGeometry";
import { analyzeCurvature } from "@/lib/maker/neon/metrics/curvature";
import { recommendedNeonLength, totalNeonLength } from "@/lib/maker/neon/metrics/pathLength";
import { decodeRasterImage } from "@/lib/maker/neon/raster/decodeRasterImage";
import { rasterToNeonPaths } from "@/lib/maker/neon/raster/rasterToNeonPaths";
import { pathsBounds } from "@/lib/maker/neon/paths/flattenNeonPath";
import { svgToNeonPaths } from "@/lib/maker/neon/paths/svgToNeonPaths";
import { textToNeonPaths } from "@/lib/maker/neon/paths/textToNeonPaths";
import { emptyNeonInstallationResult, planNeonInstallation, type NeonInstallationResult } from "@/lib/maker/neon/installation/orchestrate";
import { passThroughPolygon } from "@/lib/maker/neon/installation/passThrough";
import { computePassThroughSafeZone } from "@/lib/maker/neon/installation/editing";
import type { NeonInstallationOverrides, NeonInstallationRecipe } from "@/lib/maker/neon/installation/types";
import {
  NeonInputError,
  type NeonIssue,
  type NeonMetrics,
  type NeonParams,
  type NeonPath,
  type NeonPathsResult,
  type NeonSource,
} from "@/lib/maker/neon/types";

export type NeonPathsOutcome = { ok: true; result: NeonPathsResult } | { ok: false; message: string };

/**
 * Etapa INPUT: fuente (texto | SVG) -> NeonPath[] en mm. Independiente de los
 * parámetros del canal (solo depende del alto del diseño), así la UI puede
 * recalcular el canal al mover un slider sin volver a parsear el SVG.
 */
export function buildNeonPaths(source: NeonSource, designHeightMm: number): NeonPathsOutcome {
  try {
    let result: NeonPathsResult;
    if (source.type === "image") {
      // Imagen raster (PNG/JPEG): mismo pipeline para ambos; el resultado son NeonPaths como cualquier otra fuente.
      const { image } = decodeRasterImage(source.bytes);
      // El JPEG no tiene canal alpha útil: siempre luminosidad (el resto del pipeline es idéntico al PNG).
      const settings = source.kind === "jpg" ? { ...source.raster, detectionMode: "luminance" as const } : source.raster;
      const conv = rasterToNeonPaths(image, settings, designHeightMm);
      result = { paths: conv.paths, issues: conv.issues, raster: { preview: conv.preview, stats: conv.stats } };
    } else {
      const opts = { fontId: source.fontId, letterSpacingPct: source.letterSpacingPct };
      result =
        source.type === "text"
          ? textToNeonPaths(source.text, source.fontId, designHeightMm, opts)
          : svgToNeonPaths(source.content, designHeightMm, opts);
    }
    return { ok: true, result };
  } catch (err) {
    if (err instanceof DesignImportError && err.code === "SVG_UNSUPPORTED") {
      return { ok: false, message: `El SVG contiene elementos no compatibles. ${err.message}` };
    }
    if (err instanceof NeonInputError || err instanceof DesignImportError) return { ok: false, message: err.message };
    return { ok: false, message: "No se pudo interpretar el diseño." };
  }
}

export interface NeonGeometryResult {
  /** Malla lista para MakerViewport / Vista Cama / exportWord (una sola pieza "body"); null si hay errores que impiden generarla. */
  geometry: LetterGeometryResult | null;
  metrics: NeonMetrics;
  errors: NeonIssue[];
  warnings: NeonIssue[];
  /** Instalación 0.3: vacío (wiring=null, todo []) cuando `installation` no se pasa o ningún toggle (cableado/puentes/montaje) está activo. */
  installation: NeonInstallationResult;
  /** Zona segura para el editor manual (Etapa 8): unión de cavidades de todos los segmentos, erosionada. null si Instalación no está activa. */
  passThroughSafeZone: ClipperLib.Paths | null;
}

function formatMm(v: number): string {
  return `${Math.round(v * 10) / 10}`;
}

/**
 * Etapa GEOMETRÍA: NeonPath[] + parámetros -> canal U + métricas. La pieza se
 * traslada para que su esquina mínima (incluido el canal) quede en (0, 0, 0):
 * apoyada en Z=0 y con coordenadas positivas en el STL.
 */
export function createNeonGeometry(
  paths: NeonPath[],
  params: NeonParams,
  inputIssues: NeonIssue[] = [],
  installation?: { recipe: NeonInstallationRecipe; overrides: NeonInstallationOverrides },
): NeonGeometryResult {
  const inner = channelInnerWidth(params);
  const outer = channelOuterWidth(params);
  const lengthMm = totalNeonLength(paths);
  const bounds = pathsBounds(paths);
  const curvature = analyzeCurvature(paths, params.minBendRadiusMm);
  const metrics: NeonMetrics = {
    lengthMm,
    recommendedLengthMm: recommendedNeonLength(lengthMm),
    innerWidthMm: inner,
    outerWidthMm: outer,
    pathBounds: bounds ? { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY } : { width: 0, height: 0 },
    printedSize: { width: 0, height: 0, depth: params.floorThicknessMm + params.wallHeightMm },
    curvature,
  };

  const warnings: NeonIssue[] = [...inputIssues];
  if (curvature.belowMinimum) {
    warnings.push({
      code: "MIN_BEND_RADIUS",
      message:
        curvature.minRadiusMm !== null
          ? `Hay curvas más cerradas que el radio mínimo configurado del Neon. Radio detectado ≈ ${formatMm(curvature.minRadiusMm)}mm; mínimo configurado ${formatMm(params.minBendRadiusMm)}mm.`
          : "Hay curvas más cerradas que el radio mínimo configurado del Neon.",
    });
  }

  if (!bounds) {
    return {
      geometry: null,
      metrics,
      errors: [{ code: "NO_PATHS", message: "No hay recorridos para generar el canal." }],
      warnings,
      installation: emptyNeonInstallationResult(),
      passThroughSafeZone: null,
    };
  }
  // Origen: esquina mínima de la pieza impresa = (0, 0).
  const shifted: NeonPath[] = paths.map((p) => ({
    closed: p.closed,
    points: p.points.map(([x, y]) => [x - bounds.minX + outer / 2, y - bounds.minY + outer / 2] as const),
  }));

  // Primera pasada SIN instalación: es contra este `cavityGroups` que se valida cada
  // pass-through/puente (Sección 2/24 del pedido — nunca tocan la pared). Si Instalación
  // está apagada esta es también la malla final: mismo resultado byte a byte que 0.1/0.2.
  const baseline = createChannelGeometry(shifted, params);
  warnings.push(...baseline.warnings);
  if (baseline.errors.length > 0 || baseline.mesh.triangleCount === 0) {
    return { geometry: null, metrics, errors: baseline.errors, warnings, installation: emptyNeonInstallationResult(), passThroughSafeZone: null };
  }

  let installationResult = emptyNeonInstallationResult();
  let channel = baseline;
  let passThroughSafeZone: ClipperLib.Paths | null = null;
  const installationActive =
    installation && (installation.recipe.wiringEnabled || installation.recipe.bridgeMode === "bridged" || installation.recipe.mountMode === "clips");
  if (installation && installationActive) {
    installationResult = planNeonInstallation(shifted, params, baseline.cavityGroups, installation.recipe, installation.overrides);
    passThroughSafeZone = computePassThroughSafeZone(baseline.cavityGroups);
    const passThroughFootprints = installationResult.passThroughs.map((pt) => passThroughPolygon(pt));
    const bridgeFootprints = installationResult.bridges.map((b) => b.footprint);
    if (passThroughFootprints.length > 0 || bridgeFootprints.length > 0) {
      channel = createChannelGeometry(shifted, params, { passThroughFootprints, bridgeFootprints });
      if (channel.errors.length > 0 || channel.mesh.triangleCount === 0) {
        return {
          geometry: null,
          metrics,
          errors: channel.errors,
          warnings: [...warnings, ...installationResult.warnings],
          installation: installationResult,
          passThroughSafeZone,
        };
      }
    }
  }

  const b = meshBounds(channel.mesh.positions);
  const width = b.maxX - b.minX, height = b.maxY - b.minY, depth = b.maxZ - b.minZ;
  metrics.printedSize = { width, height, depth };
  const geometry: LetterGeometryResult = {
    parts: [{ kind: "body", filenameSuffix: "neon", mesh: channel.mesh }],
    triangleCount: channel.mesh.triangleCount,
    boundingBox: { width, height, depth },
    errors: [],
    warnings: [],
    letters: [],
    designCenter: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
    backCutoutSafeZone: null,
    installation: null,
    installationParts: [],
  };
  return {
    geometry,
    metrics,
    errors: [...installationResult.errors],
    warnings: [...warnings, ...installationResult.warnings],
    installation: installationResult,
    passThroughSafeZone,
  };
}
