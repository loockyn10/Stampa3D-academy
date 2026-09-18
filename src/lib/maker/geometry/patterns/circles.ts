import type { ContourGroup, Point2D } from "@/lib/maker/types";
import { insetContourGroups, differenceContourGroups, regroupClipperSolution, isPointInsideContourGroups, pointsToRawPath, cleanContourGroups } from "@/lib/maker/geometry/offsets";

export interface CirclePatternConfig {
  holeDiameterMm: number;
  /** Espaciado CENTRO A CENTRO, en mm. */
  pitchMm: number;
  edgeMarginMm: number;
}

const CIRCLE_SEGMENTS = 28;

function circlePolygon(cx: number, cy: number, r: number): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return points;
}

function boundsOf(groups: ContourGroup[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const group of groups) {
    for (const [x, y] of group.outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}

/**
 * PATTERN = circles (0.4 Etapa 5): perfora `maskGroups` con una grilla de
 * círculos espaciados `pitchMm` CENTRO A CENTRO, respetando `edgeMarginMm`
 * respecto de cualquier borde (exterior o counter) — nunca solo el centro,
 * el círculo COMPLETO debe quedar dentro de la silueta real de la letra.
 *
 * Se logra erosionando la región de CENTROS válidos por `edgeMarginMm +
 * holeDiameterMm/2` (mismo mecanismo uniforme de `insetContourGroups` que
 * ya usa el resto del pipeline: erosiona exterior y huecos a la vez) antes
 * de aceptar un candidato — así un círculo aceptado nunca puede sobresalir
 * del margen, sin necesidad de recortar cada círculo por separado.
 *
 * Sin bounding boxes para decidir qué perforar: la grilla se recorta contra
 * la región segura real (con la forma de la letra, huecos incluidos) vía
 * Clipper (`isPointInsideRawPaths`), no contra un rectángulo.
 *
 * Firma pensada para que un futuro patrón (honeycomb, triángulos, etc. —
 * fuera de alcance de 0.4) sea otra función con la misma firma, sin
 * necesitar un registry dinámico (el pedido lo permite explícitamente).
 */
export function punchCirclePattern(maskGroups: ContourGroup[], config: CirclePatternConfig): ContourGroup[] {
  const radius = config.holeDiameterMm / 2;
  const safeCenterGroups = regroupClipperSolution(insetContourGroups(maskGroups, config.edgeMarginMm + radius));
  if (safeCenterGroups.length === 0) return maskGroups; // no entra ningún agujero completo: máscara sólida para esta letra

  const { minX, maxX, minY, maxY } = boundsOf(maskGroups);
  const circles: Point2D[][] = [];
  for (let x = minX; x <= maxX; x += config.pitchMm) {
    for (let y = minY; y <= maxY; y += config.pitchMm) {
      if (isPointInsideContourGroups(safeCenterGroups, [x, y])) {
        circles.push(circlePolygon(x, y, radius));
      }
    }
  }
  if (circles.length === 0) return maskGroups;

  // Limpieza de vértices casi duplicados/spikes (ver cleanContourGroups):
  // con muchos círculos perforados, earcut puede elegir un puente
  // degenerado si quedan vértices casi colineales entre agujeros
  // cercanos — mismo mecanismo que ya usa el resto del pipeline para
  // trazos próximos (p.ej. el travesaño de una "B"), sin afectar la
  // soldadura de otras piezas (la máscara es independiente, no suelda con
  // nada).
  return cleanContourGroups(differenceContourGroups(maskGroups, circles.map(pointsToRawPath)));
}
