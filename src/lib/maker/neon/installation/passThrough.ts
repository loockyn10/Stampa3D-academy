// Cable pass-through (Secciones 6-9 del pedido de Instalación 0.3): UNA sola abertura
// bipolar tipo cápsula (no dos agujeros circulares separados como el puerto de Carteles)
// que perfora el PISO del canal cerca de un extremo de segmento abierto, sin tocar nunca
// la pared visible del canal. Este módulo es geometría 2D pura (forma, posición,
// validez); la extrusión real (el split de piso por bandas) vive en
// createChannelGeometry.ts.
import type * as ClipperLib from "clipper-lib";
import type { ContourGroup, Point2D } from "@/lib/maker/types";
import { capsulePolygon } from "@/lib/maker/geometry/backCutouts";
import { clipperPathsArea, differenceRawPaths, insetContourGroups, pointsToRawPath } from "@/lib/maker/geometry/offsets";
import type { NeonSegment } from "@/lib/maker/neon/installation/segments";
import { buildArclengthTable, pointAtT } from "@/lib/maker/neon/installation/arclength";

export interface NeonPassThroughSettings {
  widthMm: number;
  heightMm: number;
  /** Distancia desde la punta del segmento al centro del pass-through (mm); nunca exactamente en la punta. */
  endpointInsetMm: number;
}

export type NeonPassThroughSide = "start" | "end";

/**
 * Rol eléctrico del agujero (Secciones 1-3, 10-11 del pedido de corrección de
 * cableado): `powerIn` es la entrada de alimentación (primer segmento de la cadena,
 * sin jumper entrante); `in`/`out` son entrada/salida de un jumper en un segmento
 * intermedio o el `in` final del último segmento (sin salida); `inOut` es el agujero
 * único y compartido de un loop cerrado (Sección 9 — IN y OUT del cableado comparten
 * el mismo agujero físico, documentado, no se generan dos agujeros próximos en V1).
 */
export type NeonPassThroughRole = "powerIn" | "in" | "out" | "inOut";

export interface NeonPassThrough {
  segmentId: string;
  side: NeonPassThroughSide;
  role: NeonPassThroughRole;
  center: Point2D;
  rotationDeg: number;
  widthMm: number;
  heightMm: number;
  /** Longitud de arco (mm) del centro sobre el propio segmento — para reservar la zona ante la colocación de clips (Etapa 6). */
  arcMm: number;
}

/** Margen mínimo entre el borde de la cápsula y el borde de la cavidad: nunca toca la pared visible del canal (misma idea que `BACK_CUTOUT_EDGE_MARGIN_MM` de Carteles). */
export const PASS_THROUGH_EDGE_MARGIN_MM = 0.5;
const AREA_TOLERANCE_MM2 = 1e-3;

function rotate(points: Point2D[], rotationDeg: number, tx: number, ty: number): Point2D[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return points.map(([x, y]) => [x * c - y * s + tx, x * s + y * c + ty] as Point2D);
}

/** Cápsula del pass-through en coordenadas globales del recorrido, ya rotada/posicionada. */
export function passThroughPolygon(pt: Pick<NeonPassThrough, "center" | "rotationDeg" | "widthMm" | "heightMm">): Point2D[] {
  return rotate(capsulePolygon(pt.widthMm, pt.heightMm), pt.rotationDeg, pt.center[0], pt.center[1]);
}

/**
 * Posición/orientación por defecto cerca de un extremo abierto: centrada a
 * `endpointInsetMm` de la punta (acotado a la mitad del segmento, para que los
 * pass-through de ambos extremos nunca se crucen en un segmento corto), orientada según
 * la TANGENTE LOCAL del recorrido — el eje largo de la cápsula corre a lo largo del
 * trazo, así encaja con más margen dentro de un corredor angosto que si corriera
 * perpendicular. Elección determinística (Sección 8 del pedido). null en segmentos
 * cerrados (no tienen extremos).
 */
export function planPassThrough(
  segment: NeonSegment,
  side: NeonPassThroughSide,
  role: NeonPassThroughRole,
  settings: NeonPassThroughSettings,
  overrideCenter?: Point2D,
  /** Distancia de inset (mm) a usar en vez de `settings.endpointInsetMm` — solo la usa `planValidPassThrough` para buscar una alternativa cercana SOBRE EL MISMO path (Sección 8: nunca cambia de lado/segmento). */
  insetOverrideMm?: number,
): NeonPassThrough | null {
  if (segment.closed) {
    // Sin extremos: un único punto de conexión/corte sugerido (`connectionAnchorT`,
    // Sección 13). `side` no distingue nada acá (IN y OUT del cableado comparten el
    // mismo agujero físico bipolar), pero se conserva para que el llamador identifique
    // este pass-through igual que los de un segmento abierto.
    const table = buildArclengthTable(segment.points, true);
    const anchorMm = (segment.connectionAnchorT ?? 0) * table.totalMm;
    const { point, tangent } = pointAtT(table, anchorMm);
    const tangentAngleDeg = (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI;
    const rotationDeg = settings.widthMm >= settings.heightMm ? tangentAngleDeg : tangentAngleDeg - 90;
    return { segmentId: segment.id, side, role, center: overrideCenter ?? point, rotationDeg, widthMm: settings.widthMm, heightMm: settings.heightMm, arcMm: anchorMm };
  }
  const endpoint = side === "start" ? segment.start : segment.end;
  if (!endpoint) return null;
  const table = buildArclengthTable(segment.points, false);
  const requestedInsetMm = insetOverrideMm ?? settings.endpointInsetMm;
  const insetMm = Math.min(Math.max(0, requestedInsetMm), Math.max(0, table.totalMm / 2 - 1e-6));
  const arcT = side === "start" ? insetMm : table.totalMm - insetMm;
  const { point, tangent } = pointAtT(table, arcT);
  const tangentAngleDeg = (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI;
  // capsulePolygon() ya nace con su eje largo en X si width>=height, o en Y si height>width:
  // hay que restar 90° en ese segundo caso para que el eje largo (no el corto) siga la tangente.
  const rotationDeg = settings.widthMm >= settings.heightMm ? tangentAngleDeg : tangentAngleDeg - 90;
  return { segmentId: segment.id, side, role, center: overrideCenter ?? point, rotationDeg, widthMm: settings.widthMm, heightMm: settings.heightMm, arcMm: arcT };
}

const PASS_THROUGH_SEARCH_STEP_MM = 1;

/**
 * Como `planPassThrough`, pero si la posición por defecto (o el inset pedido) no
 * entra en la cavidad, busca una distancia de inset cercana que sí sea válida —
 * recorriendo EL MISMO path, sin cambiar de lado/segmento (Sección 8: "recorrer pocos
 * mm sobre ESE MISMO path" conserva la semántica inicio/final). Corrige el
 * under-generation real reportado: antes, un pass-through cuya posición por defecto
 * caía fuera de la cavidad (trazo curvo/angosto cerca de la punta) se perdía en
 * silencio con solo un warning, en vez de reintentar una posición cercana como ya
 * hace `planClipPositionsForSegment` (Etapa 6) para los clips de pared. Un override
 * manual (`overrideCenter`) nunca dispara la búsqueda: el usuario ya eligió esa
 * posición a mano.
 */
export function planValidPassThrough(
  segment: NeonSegment,
  side: NeonPassThroughSide,
  role: NeonPassThroughRole,
  settings: NeonPassThroughSettings,
  cavityGroups: ContourGroup[],
  overrideCenter?: Point2D,
): NeonPassThrough | null {
  const base = planPassThrough(segment, side, role, settings, overrideCenter);
  if (!base) return null;
  if (overrideCenter || segment.closed || isPassThroughValid(base, cavityGroups)) return base;

  const table = buildArclengthTable(segment.points, false);
  const maxInset = Math.max(0, table.totalMm / 2 - 1e-6);
  const baseInset = Math.min(Math.max(0, settings.endpointInsetMm), maxInset);
  for (let d = PASS_THROUGH_SEARCH_STEP_MM; baseInset + d <= maxInset + 1e-9 || baseInset - d >= -1e-9; d += PASS_THROUGH_SEARCH_STEP_MM) {
    if (baseInset + d <= maxInset + 1e-9) {
      const candidate = planPassThrough(segment, side, role, settings, undefined, baseInset + d);
      if (candidate && isPassThroughValid(candidate, cavityGroups)) return candidate;
    }
    if (baseInset - d >= -1e-9) {
      const candidate = planPassThrough(segment, side, role, settings, undefined, Math.max(0, baseInset - d));
      if (candidate && isPassThroughValid(candidate, cavityGroups)) return candidate;
    }
  }
  return base;
}

/**
 * ¿La cápsula (posición automática o arrastrada a mano) cae ENTERA dentro de la
 * cavidad, con margen? Nunca toca la pared visible del canal. Misma técnica que
 * `isCutoutInsideSafeZone` de Carteles: diferencia de áreas exacta, no muestreo de
 * puntos — una cápsula que sobresale aunque sea un poco da área > 0 y se rechaza.
 */
export function isPassThroughValid(pt: Pick<NeonPassThrough, "center" | "rotationDeg" | "widthMm" | "heightMm">, cavityGroups: ContourGroup[]): boolean {
  if (cavityGroups.length === 0) return false;
  const allowed = insetContourGroups(cavityGroups, PASS_THROUGH_EDGE_MARGIN_MM);
  const raw = pointsToRawPath(passThroughPolygon(pt));
  return Math.abs(clipperPathsArea(differenceRawPaths([raw], allowed))) <= AREA_TOLERANCE_MM2;
}

/** Paths crudos de Clipper de un conjunto de pass-throughs, para restarlos del piso en `createChannelGeometry`. */
export function passThroughsToRawPaths(passThroughs: Pick<NeonPassThrough, "center" | "rotationDeg" | "widthMm" | "heightMm">[]): ClipperLib.Paths {
  return passThroughs.map((pt) => pointsToRawPath(passThroughPolygon(pt)));
}
