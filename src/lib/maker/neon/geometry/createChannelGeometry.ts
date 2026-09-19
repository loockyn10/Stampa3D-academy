import * as ClipperLib from "clipper-lib";
import type { ContourGroup, Point2D, TriangleSoupData } from "@/lib/maker/types";
import { buildContourHierarchy } from "@/lib/maker/geometry/contourHierarchy";
import { extrudeContourGroups, toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";
import { clipperPathsArea, differenceRawPaths, isPointInsideContourGroups, regroupClipperSolution } from "@/lib/maker/geometry/offsets";
import { bufferNeonPaths } from "@/lib/maker/neon/geometry/bufferPath";
import { channelInnerWidth, channelOuterWidth } from "@/lib/maker/neon/defaults";
import type { NeonChannelParams, NeonIssue, NeonPath } from "@/lib/maker/neon/types";

export interface ChannelGeometry {
  /** Sólido del canal U (piso + paredes): sin caras internas, soldado por vértices compartidos. */
  mesh: TriangleSoupData;
  /** Huella exterior (piso), cavidad (corredor interior) y huella de paredes, en 2D. */
  outerGroups: ContourGroup[];
  cavityGroups: ContourGroup[];
  wallGroups: ContourGroup[];
  errors: NeonIssue[];
  warnings: NeonIssue[];
}

const CLIPPER_SCALE = 10000;
/** Una pared se considera "fina" por debajo de esta fracción del espesor configurado. */
const THIN_WALL_FACTOR = 0.5;

function emptyResult(errors: NeonIssue[]): ChannelGeometry {
  return {
    mesh: { positions: new Float32Array(0), normals: new Float32Array(0), triangleCount: 0 },
    outerGroups: [],
    cavityGroups: [],
    wallGroups: [],
    errors,
    warnings: [],
  };
}

/**
 * Lado del borde de un anillo donde NO hay pared: se toma un punto apenas
 * fuera del material, al costado del tramo más largo del anillo. Si ese punto
 * cae dentro de la cavidad, el anillo es borde de cavidad; si no, es borde
 * exterior (aire).
 */
function isCavityRing(ring: Point2D[], wallGroups: ContourGroup[], cavity: ContourGroup[], probeMm: number): boolean {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const a = ring[best];
  const b = ring[(best + 1) % ring.length];
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const nx = -(b[1] - a[1]) / bestLen, ny = (b[0] - a[0]) / bestLen;
  const p1: Point2D = [mx + nx * probeMm, my + ny * probeMm];
  const p2: Point2D = [mx - nx * probeMm, my - ny * probeMm];
  const nonMaterial = isPointInsideContourGroups(wallGroups, p1) ? p2 : p1;
  return isPointInsideContourGroups(cavity, nonMaterial);
}

/** Apertura morfológica (erosión + dilatación): lo que desaparece es más fino que `2 * radiusMm`. Devuelve el área que sobrevive. */
function openedArea(paths: ClipperLib.Paths, radiusMm: number): number {
  const shrink = new ClipperLib.ClipperOffset(2, 0.01 * CLIPPER_SCALE);
  shrink.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const eroded: ClipperLib.Paths = [];
  shrink.Execute(eroded, -radiusMm * CLIPPER_SCALE);
  if (eroded.length === 0) return 0;
  const grow = new ClipperLib.ClipperOffset(2, 0.01 * CLIPPER_SCALE);
  grow.AddPaths(eroded, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const restored: ClipperLib.Paths = [];
  grow.Execute(restored, radiusMm * CLIPPER_SCALE);
  return clipperPathsArea(restored);
}

/**
 * Canal U abierto por arriba alrededor de los centerlines (ver docs/STAMPA_MAKER.md, Neon LED).
 *
 * 2D:  outer = buffer(paths, innerW/2 + pared)   -> huella del piso
 *      inner = buffer(paths, innerW/2)           -> corredor (cavidad)
 *      pared = outer - inner                      -> huella de las paredes
 * 3D:  todo se arma con las MISMAS coordenadas de los anillos de `pared`, sin
 *      CSG 3D, así que las caras se sueldan por vértices compartidos:
 *        - base z=0 y paredes exteriores z=0..top   (anillos de borde exterior)
 *        - piso de la cavidad z=floor               (anillos de borde de cavidad)
 *        - paredes interiores floor..top            (anillos de borde de cavidad, normal invertida)
 *        - corona z=top                             (huella de pared)
 *      No queda ninguna cara interna: el piso no se dibuja bajo las paredes.
 */
export function createChannelGeometry(paths: NeonPath[], params: NeonChannelParams): ChannelGeometry {
  if (paths.length === 0) return emptyResult([{ code: "NO_PATHS", message: "No hay recorridos para generar el canal." }]);

  const innerRadius = channelInnerWidth(params) / 2;
  const outerRadius = channelOuterWidth(params) / 2;
  const zFloor = params.floorThicknessMm;
  const zTop = params.floorThicknessMm + params.wallHeightMm;

  let innerRaw: ClipperLib.Paths;
  let wallRaw: ClipperLib.Paths;
  try {
    const outerRaw = bufferNeonPaths(paths, outerRadius);
    innerRaw = bufferNeonPaths(paths, innerRadius);
    wallRaw = differenceRawPaths(outerRaw, innerRaw);
  } catch {
    return emptyResult([{ code: "GEOMETRY_FAILED", message: "No se pudo calcular el canal para este recorrido." }]);
  }

  const cavityRegion = regroupClipperSolution(innerRaw);
  const wallGroups = regroupClipperSolution(wallRaw);
  if (cavityRegion.length === 0 || wallGroups.length === 0) {
    return emptyResult([
      { code: "CAVITY_COLLAPSED", message: "El canal colapsó: el recorrido es demasiado corto o los parámetros no dejan cavidad ni paredes." },
    ]);
  }

  // Cada anillo de la huella de pared es borde exterior o borde de cavidad.
  const probe = Math.min(0.05, params.wallThicknessMm * 0.25);
  const outerRings: Point2D[][] = [];
  const cavityRings: Point2D[][] = [];
  for (const group of wallGroups) {
    for (const ring of [group.outer, ...group.holes]) {
      (isCavityRing(ring, wallGroups, cavityRegion, probe) ? cavityRings : outerRings).push(ring);
    }
  }
  const outerGroups = buildContourHierarchy(outerRings);
  const cavityGroups = buildContourHierarchy(cavityRings);
  if (outerGroups.length === 0 || cavityGroups.length === 0) {
    return emptyResult([{ code: "CAVITY_COLLAPSED", message: "El canal colapsó: no quedó cavidad para alojar el Neon." }]);
  }

  const parts = [
    extrudeContourGroups(outerGroups, 0, zTop, { capStart: true, capEnd: false, sides: true }),
    extrudeContourGroups(cavityGroups, zFloor, zFloor, { capStart: false, capEnd: true, sides: false }),
    extrudeContourGroups(cavityGroups, zFloor, zTop, { capStart: false, capEnd: false, sides: true, flipSides: true }),
    extrudeContourGroups(wallGroups, zTop, zTop, { capStart: false, capEnd: true, sides: false }),
  ];
  const mesh = toTriangleSoupData({ positions: parts.flatMap((p) => p.positions), normals: parts.flatMap((p) => p.normals) });

  const warnings: NeonIssue[] = [];
  const wallArea = clipperPathsArea(wallRaw);
  const lost = wallArea - openedArea(wallRaw, (params.wallThicknessMm * THIN_WALL_FACTOR) / 2);
  if (lost > Math.max(1, wallArea * 0.02)) {
    warnings.push({
      code: "THIN_WALL",
      message: `Hay zonas donde dos recorridos están tan cerca que la pared entre canales queda más fina que ${(params.wallThicknessMm * THIN_WALL_FACTOR).toFixed(1)} mm. Separá los recorridos o reducí el ancho del Neon.`,
    });
  }

  return { mesh, outerGroups, cavityGroups, wallGroups, errors: [], warnings };
}
