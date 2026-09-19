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

/** Convierte un `ContourGroup[]` ya armado a paths crudos de Clipper (sin offsetear), para encadenar con otra operación booleana (p.ej. el escalón de una costilla, ver body/modifiers/ribs.ts). */
export function contourGroupsToRawPaths(groups: ContourGroup[]): ClipperLib.Paths {
  return groups.flatMap(groupToClipperPaths);
}

/** Convierte un polígono simple (en mm) a un path crudo de Clipper, para construir formas nuevas (p.ej. un círculo del patrón, ver patterns/circles.ts) sin exponer la escala interna de Clipper. */
export function pointsToRawPath(points: Point2D[]): ClipperLib.Path {
  return toClipperPath(points);
}

/**
 * true si `point` (en mm) cae dentro de la región SÓLIDA que describen
 * `groups` (exterior MENOS huecos, regla par/impar correcta) — a
 * diferencia de probar cada path por separado con OR (que ignoraría los
 * huecos: un punto adentro del exterior pero TAMBIÉN adentro de un hueco
 * no es material), acá un grupo cuenta como "adentro" solo si el punto
 * está dentro de `group.outer` y fuera de TODOS sus `group.holes`.
 *
 * `PointInPolygon` devuelve `1` adentro, `0` afuera, `-1` exactamente
 * sobre el borde — un candidato exactamente sobre el borde (p.ej. un
 * centro de patrón que cae justo en el límite de la región segura,
 * frecuente con una grilla regular) se trata como "afuera": aceptarlo
 * dejaría el círculo tangente al borde real, un caso degenerado (espesor
 * cero) en vez de con margen real.
 */
export function isPointInsideContourGroups(groups: ContourGroup[], point: Point2D): boolean {
  const scaled = { X: Math.round(point[0] * CLIPPER_SCALE), Y: Math.round(point[1] * CLIPPER_SCALE) };
  for (const group of groups) {
    if (ClipperLib.Clipper.PointInPolygon(scaled, toClipperPath(group.outer)) !== 1) continue;
    const insideAnyHole = group.holes.some((hole) => ClipperLib.Clipper.PointInPolygon(scaled, toClipperPath(hole)) === 1);
    if (!insideAnyHole) return true;
  }
  return false;
}

/**
 * Limpia vértices casi duplicados/spikes de un `ContourGroup[]` ya armado
 * (mismo mecanismo que ya usa `insetContourGroups` internamente vía
 * `cleanSolution`, expuesto acá para operaciones que no pasan por un
 * offset — p.ej. perforar muchos círculos cercanos entre sí, ver
 * patterns/circles.ts). A diferencia de `differenceContourGroups` (que a
 * propósito NO limpia su salida, ver docs/STAMPA_MAKER.md sección 3 — la
 * soldadura fondo/pared necesita coordenadas exactas), esta función es
 * para piezas independientes sin soldadura que proteger, donde earcut
 * puede elegir un puente degenerado si quedan muchos vértices casi
 * colineales (frecuente con una grilla regular de agujeros).
 */
export function cleanContourGroups(groups: ContourGroup[]): ContourGroup[] {
  return regroupClipperSolution(cleanSolution(contourGroupsToRawPaths(groups)));
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

/**
 * Dilata (offset positivo) un conjunto de contornos exterior/huecos hacia
 * afuera por `outsetMm`: el exterior crece y cada hueco se achica — lo
 * opuesto de `insetContourGroups`, mismo mecanismo (Clipper erosiona o
 * dilata material de forma uniforme sin importar si el contorno es exterior
 * u hueco). Usado por los modificadores de cuerpo (costillas, 0.4 Etapa 2)
 * para engrosar la pared en una banda de Z sin tocar el resto del cuerpo.
 */
export function outsetContourGroups(groups: ContourGroup[], outsetMm: number): ClipperLib.Paths {
  if (groups.length === 0) return [];
  const arcToleranceMm = 0.01;
  const offset = new ClipperLib.ClipperOffset(2, arcToleranceMm * CLIPPER_SCALE);
  for (const group of groups) {
    offset.AddPaths(groupToClipperPaths(group), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  }
  const solution: ClipperLib.Paths = [];
  offset.Execute(solution, outsetMm * CLIPPER_SCALE);
  return cleanSolution(solution);
}

/**
 * Resta `clipRawPaths` de `subjectRawPaths` (diferencia booleana, regla
 * nonzero), ambos ya en paths crudos de Clipper. Es el mismo cálculo que
 * usa `differenceContourGroups`, pero sin pasar por ContourGroup en
 * ninguno de los dos lados: sirve para encadenar una diferencia sobre el
 * resultado de OTRA operación de Clipper (p.ej. la pared perimetral del
 * labio, ver joints/interiorLip.ts) sin un round-trip extra por mm/hueco.
 */
export function differenceRawPaths(subjectRawPaths: ClipperLib.Paths, clipRawPaths: ClipperLib.Paths): ClipperLib.Paths {
  if (subjectRawPaths.length === 0) return [];

  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subjectRawPaths, ClipperLib.PolyType.ptSubject, true);
  if (clipRawPaths.length > 0) {
    clipper.AddPaths(clipRawPaths, ClipperLib.PolyType.ptClip, true);
  }
  const solution: ClipperLib.Paths = [];
  clipper.Execute(ClipperLib.ClipType.ctDifference, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return solution;
}

/** Resta `clipPaths` de `subjectGroups` (diferencia booleana, regla nonzero). */
export function differenceContourGroups(subjectGroups: ContourGroup[], clipPaths: ClipperLib.Paths): ContourGroup[] {
  const subjectPaths = subjectGroups.flatMap(groupToClipperPaths);
  return regroupClipperSolution(differenceRawPaths(subjectPaths, clipPaths));
}

/** Área total (mm²) de un conjunto de paths crudos de Clipper, con signo. */
export function clipperPathsArea(paths: ClipperLib.Paths): number {
  return paths.reduce((sum, p) => sum + ClipperLib.Clipper.Area(p) / (CLIPPER_SCALE * CLIPPER_SCALE), 0);
}

/** Intersección booleana de dos conjuntos de paths crudos (regla nonzero). */
export function intersectRawPaths(subjectRawPaths: ClipperLib.Paths, clipRawPaths: ClipperLib.Paths): ClipperLib.Paths {
  if (subjectRawPaths.length === 0 || clipRawPaths.length === 0) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subjectRawPaths, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(clipRawPaths, ClipperLib.PolyType.ptClip, true);
  const solution: ClipperLib.Paths = [];
  clipper.Execute(ClipperLib.ClipType.ctIntersection, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return solution;
}

/** Unión booleana de un conjunto de paths crudos (regla nonzero): las formas solapadas se funden en una sola abertura. */
export function unionRawPaths(rawPaths: ClipperLib.Paths): ClipperLib.Paths {
  if (rawPaths.length === 0) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(rawPaths, ClipperLib.PolyType.ptSubject, true);
  const solution: ClipperLib.Paths = [];
  clipper.Execute(ClipperLib.ClipType.ctUnion, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return solution;
}
