import * as ClipperLib from "clipper-lib";
import type { ContourGroup, Point2D } from "@/lib/maker/types";
import { buildContourHierarchy } from "@/lib/maker/geometry/contourHierarchy";

// Clipper trabaja con enteros. Escalamos mm -> enteros para preservar
// precisión submilimétrica (0.0001 mm) y evitar errores de coma flotante
// en las operaciones booleanas/offset.
const CLIPPER_SCALE = 10000;

// Tolerancia para limpiar vértices casi duplicados / "spikes" que puede
// dejar el offset redondeado cuando dos rasgos quedan muy cerca entre sí
// (p.ej. el travesaño entre los dos counters de una "B" en negrita, más
// angosto que 2x wallMm). Sin esta limpieza, esos vértices casi
// coincidentes generan triángulos degenerados/no-manifold en la
// triangulación posterior. No es específico de ninguna letra: se aplica a
// cualquier resultado de Clipper.
const CLEAN_TOLERANCE_MM = 0.005;

function cleanSolution(paths: ClipperLib.Paths): ClipperLib.Paths {
  return ClipperLib.Clipper.CleanPolygons(paths, CLEAN_TOLERANCE_MM * CLIPPER_SCALE);
}

function toClipperPath(points: Point2D[]): ClipperLib.Path {
  return points.map(([x, y]) => ({ X: Math.round(x * CLIPPER_SCALE), Y: Math.round(y * CLIPPER_SCALE) }));
}

function fromClipperPath(path: ClipperLib.Path): Point2D[] {
  return path.map((p) => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE] as Point2D);
}

function groupToClipperPaths(group: ContourGroup): ClipperLib.Paths {
  return [group.outer, ...group.holes].map(toClipperPath);
}

/** Reagrupa un resultado plano de Clipper en exterior/huecos (par-impar). */
export function regroupClipperSolution(paths: ClipperLib.Paths): ContourGroup[] {
  const rawContours = paths.map(fromClipperPath).filter((c) => c.length >= 3);
  return buildContourHierarchy(rawContours);
}

/**
 * Erosiona (offset negativo) un conjunto de contornos exterior/huecos hacia
 * adentro por `insetMm`. Devuelve los paths crudos resultantes (pueden estar
 * vacíos si el trazo es más angosto que 2x el inset).
 */
export function insetContourGroups(groups: ContourGroup[], insetMm: number): ClipperLib.Paths {
  if (groups.length === 0) return [];
  const arcToleranceMm = 0.01;
  const offset = new ClipperLib.ClipperOffset(2, arcToleranceMm * CLIPPER_SCALE);
  for (const group of groups) {
    offset.AddPaths(groupToClipperPaths(group), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  }
  const solution: ClipperLib.Paths = [];
  offset.Execute(solution, -insetMm * CLIPPER_SCALE);
  return cleanSolution(solution);
}

/** Resta `clipPaths` de `subjectGroups` (diferencia booleana, regla nonzero). */
export function differenceContourGroups(subjectGroups: ContourGroup[], clipPaths: ClipperLib.Paths): ContourGroup[] {
  const subjectPaths = subjectGroups.flatMap(groupToClipperPaths);
  if (subjectPaths.length === 0) return [];

  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true);
  if (clipPaths.length > 0) {
    clipper.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
  }
  const solution: ClipperLib.Paths = [];
  clipper.Execute(ClipperLib.ClipType.ctDifference, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return regroupClipperSolution(solution);
}

/** Área total (mm²) de un conjunto de paths crudos de Clipper, con signo. */
export function clipperPathsArea(paths: ClipperLib.Paths): number {
  return paths.reduce((sum, p) => sum + ClipperLib.Clipper.Area(p) / (CLIPPER_SCALE * CLIPPER_SCALE), 0);
}
