// Malla helper de Instalación 0.3 (Sección 15, 39 del pedido): cableado trasero
// (jumpers + flechas OUT->IN, nunca solo por color), marcadores de clips de pared y un
// plano de referencia de la pared — TODO esto es una malla auxiliar TRANSLÚCIDA, NUNCA
// forma parte de `geometry.parts` ni se exporta (mismo patrón ya usado por
// `MakerViewport`'s prop `helperMesh`, que hoy sirve al inserto de Jarros).
import type { Point2D, TriangleSoupData } from "@/lib/maker/types";
import { capsulePolygon, circlePolygon } from "@/lib/maker/geometry/backCutouts";
import { extrudeContourGroups, toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";
import { normalizePolygons, rectPolygon } from "@/lib/maker/installation/prismStack";
import { buildArclengthTable, pointAtT } from "@/lib/maker/neon/installation/arclength";
import type { NeonInstallationResult } from "@/lib/maker/neon/installation/orchestrate";

export interface NeonHelperMeshOptions {
  /** "Mostrar cableado": jumpers traseros + flechas OUT->IN. */
  showWiring: boolean;
  /** "Mostrar montaje": marcadores de clips de pared + plano de referencia de la pared. */
  showMount: boolean;
  /** Separación configurada (mm) — dónde vive el plano de referencia de la pared. */
  wallGapMm: number;
}

const JUMPER_Z = -2;
const JUMPER_THICKNESS_MM = 0.6;
const JUMPER_WIDTH_MM = 1.4;
const ARROW_LENGTH_MM = 5;
const ARROW_WIDTH_MM = 3.5;
const CLIP_MARKER_Z = -1.4;
const CLIP_MARKER_THICKNESS_MM = 0.6;
const CLIP_MARKER_DIAMETER_MM = 6;
const WALL_PLANE_THICKNESS_MM = 0.3;
const WALL_PLANE_MARGIN_MM = 40;

function rotate(points: Point2D[], rotationDeg: number, tx: number, ty: number): Point2D[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return points.map(([x, y]) => [x * c - y * s + tx, x * s + y * c + ty] as Point2D);
}

function flatPiece(polygons: Point2D[][], z0: number, z1: number) {
  return extrudeContourGroups(normalizePolygons(polygons), z0, z1, { capStart: true, capEnd: true, sides: true });
}

/** Barra (cápsula) + flecha triangular en la punta, apuntando de `from` (OUT) a `to` (IN) — nunca depende solo del color. */
function jumperPieces(from: Point2D, to: Point2D): Point2D[][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return [];
  const ux = dx / length;
  const uy = dy / length;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const bar = rotate(capsulePolygon(Math.max(length, JUMPER_WIDTH_MM), JUMPER_WIDTH_MM), angleDeg, mx, my);
  const back: Point2D = [to[0] - ux * ARROW_LENGTH_MM, to[1] - uy * ARROW_LENGTH_MM];
  const nx = -uy;
  const ny = ux;
  const arrow: Point2D[] = [
    to,
    [back[0] + nx * (ARROW_WIDTH_MM / 2), back[1] + ny * (ARROW_WIDTH_MM / 2)],
    [back[0] - nx * (ARROW_WIDTH_MM / 2), back[1] - ny * (ARROW_WIDTH_MM / 2)],
  ];
  return [bar, arrow];
}

function segmentsBounds(segments: NeonInstallationResult["segments"]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.bounds.minX);
    minY = Math.min(minY, s.bounds.minY);
    maxX = Math.max(maxX, s.bounds.maxX);
    maxY = Math.max(maxY, s.bounds.maxY);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function buildNeonInstallationHelperMesh(installation: NeonInstallationResult, options: NeonHelperMeshOptions): TriangleSoupData | null {
  const pieces: ReturnType<typeof extrudeContourGroups>[] = [];

  if (options.showWiring && installation.wiring) {
    for (const jumper of installation.wiring.jumpers) {
      // Bar y flecha se extruyen POR SEPARADO (no como un único contorno unido por
      // Clipper): cerca de la punta se solapan, y unirlos ahí puede dejarle a earcut un
      // borde casi tangente que triangula con algún triángulo de área ~0 (cosmético,
      // nunca se exporta, pero evitable extruyendo cada forma por su cuenta).
      for (const poly of jumperPieces(jumper.fromPoint, jumper.toPoint)) pieces.push(flatPiece([poly], JUMPER_Z, JUMPER_Z + JUMPER_THICKNESS_MM));
    }
  }

  if (options.showMount) {
    const segmentsById = new Map(installation.segments.map((s) => [s.id, s]));
    const markers: Point2D[] = [];
    for (const [segmentId, positions] of installation.clipPositions) {
      const segment = segmentsById.get(segmentId);
      if (!segment) continue;
      const table = buildArclengthTable(segment.points, segment.closed);
      for (const t of positions) markers.push(pointAtT(table, t).point);
    }
    if (markers.length > 0) {
      pieces.push(flatPiece(markers.map(([x, y]) => circlePolygon(x, y, CLIP_MARKER_DIAMETER_MM)), CLIP_MARKER_Z, CLIP_MARKER_Z + CLIP_MARKER_THICKNESS_MM));
    }

    const bounds = segmentsBounds(installation.segments);
    if (bounds) {
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      const w = bounds.maxX - bounds.minX + 2 * WALL_PLANE_MARGIN_MM;
      const h = bounds.maxY - bounds.minY + 2 * WALL_PLANE_MARGIN_MM;
      const planeZ = -Math.max(options.wallGapMm, 0);
      pieces.push(flatPiece([rectPolygon(cx, cy, w, h)], planeZ - WALL_PLANE_THICKNESS_MM / 2, planeZ + WALL_PLANE_THICKNESS_MM / 2));
    }
  }

  if (pieces.length === 0) return null;
  return toTriangleSoupData({ positions: pieces.flatMap((p) => p.positions), normals: pieces.flatMap((p) => p.normals) });
}
