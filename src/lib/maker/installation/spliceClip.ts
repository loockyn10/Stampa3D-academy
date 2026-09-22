import type { InstallationAuxPart, TriangleSoupData } from "@/lib/maker/types";
import { toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";
import { buildPrismStack, normalizePolygons, rectPolygon, type PrismLayer } from "@/lib/maker/installation/prismStack";
import type { InstallationPlan, SpliceClipSettings } from "@/lib/maker/installation/types";

/**
 * SOPORTE DE EMPALMES EXTERNO (`ExternalSpliceClip` / "bipolar-splice-clip"): pieza impresa aparte que sostiene,
 * ordena, separa y retiene suavemente los DOS empalmes (+ y -) ya terminados y aislados, en el espacio ENTRE una letra
 * y la siguiente. NO es un conector eléctrico, no conduce corriente y no reemplaza la soldadura/termocontraíble.
 *
 *   vista superior (dos canales U abiertos, paralelos):        corte transversal:
 *       +                    -                                   ┌╮      ╭┐    ┌╮      ╭┐   ← pestañas de retención
 *   ╭───────╮            ╭───────╮                               │╰──────╯│    │╰──────╯│
 *   ╰───────╯            ╰───────╯                               └─ placa base ─────────┘
 *
 * Abierto por arriba: se inserta DESPUÉS de hacer el empalme (no hay que pasar el cable por dentro) y los extremos
 * de cada canal quedan abiertos para que salgan los cables. Un solo sólido soldado por capas (sin CSG), impreso
 * plano sobre la placa. NO se ancla a la pared en esta versión (sin tornillo, adhesivo ni orejas).
 */

export const SPLICE_CLIP_FILE_BASE_NAME = "bipolar-splice-clip";
export const CLIP_PLATE_MM = 1.2;
export const CLIP_RAIL_MM = 1.2;
export const CLIP_TAB_OVERHANG_MM = 0.4;
export const CLIP_TAB_THICKNESS_MM = 0.8;
/** Las pestañas quedan estrictamente dentro del riel salvo el voladizo hacia el canal. */
const TAB_OUTER_INSET_MM = 0.3;
/** Borde de placa alrededor de los rieles (los rieles nunca comparten arista con la placa). */
const PLATE_MARGIN_MM = 1;
/** Pared mínima entre los dos alojamientos. */
export const CLIP_MIN_CHANNEL_GAP_MM = 1.2;

export interface SpliceClipSizes {
  innerWidthMm: number;
  innerLengthMm: number;
  outerWidthMm: number;
  railHeightMm: number;
  totalHeightMm: number;
  plateLengthMm: number;
  plateWidthMm: number;
}

export function spliceClipSizes(s: SpliceClipSettings): SpliceClipSizes {
  const innerWidthMm = s.diameterMm + 2 * s.clearanceMm;
  const innerLengthMm = s.lengthMm + 2 * s.clearanceMm;
  const outerWidthMm = innerWidthMm + 2 * CLIP_RAIL_MM;
  const railHeightMm = Math.max(2, 0.65 * s.diameterMm);
  return {
    innerWidthMm,
    innerLengthMm,
    outerWidthMm,
    railHeightMm,
    totalHeightMm: CLIP_PLATE_MM + railHeightMm + CLIP_TAB_THICKNESS_MM,
    plateLengthMm: innerLengthMm + 2 * PLATE_MARGIN_MM,
    plateWidthMm: s.spacingMm + outerWidthMm + 2 * PLATE_MARGIN_MM,
  };
}

/** Errores de parámetros (vacío = válido). */
export function validateSpliceClip(s: SpliceClipSettings): string[] {
  const errors: string[] = [];
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (![s.diameterMm, s.lengthMm, s.spacingMm].every(positive) || !(s.clearanceMm >= 0)) errors.push("Las medidas del soporte de empalmes (Ø, largo, separación, holgura) deben ser válidas y mayores a 0.");
  else if (s.spacingMm < spliceClipSizes(s).outerWidthMm + CLIP_MIN_CHANNEL_GAP_MM) errors.push("La separación entre los dos alojamientos es demasiado chica: deben quedar al menos 1.2 mm de pared entre ellos.");
  return errors;
}

/** Centros (Y) de los dos alojamientos: + arriba, - abajo. */
export function spliceClipChannelCenters(s: SpliceClipSettings): { plusY: number; minusY: number } {
  return { plusY: s.spacingMm / 2, minusY: -s.spacingMm / 2 };
}

export function buildSpliceClipMesh(s: SpliceClipSettings): TriangleSoupData {
  const z = spliceClipSizes(s);
  const plate: PrismLayer = { z0: 0, z1: CLIP_PLATE_MM, groups: normalizePolygons([rectPolygon(0, 0, z.plateLengthMm, z.plateWidthMm)]) };
  const rails: ReturnType<typeof rectPolygon>[] = [];
  const tabs: ReturnType<typeof rectPolygon>[] = [];
  const tabLen = Math.min(4, z.innerLengthMm / 3);
  for (const cy of [s.spacingMm / 2, -s.spacingMm / 2]) {
    for (const side of [1, -1] as const) {
      const railCenter = cy + side * (z.innerWidthMm / 2 + CLIP_RAIL_MM / 2);
      rails.push(rectPolygon(0, railCenter, z.innerLengthMm, CLIP_RAIL_MM));
      // Pestaña: hacia adentro el voladizo; hacia afuera queda a TAB_OUTER_INSET del riel.
      const v0 = z.innerWidthMm / 2 - CLIP_TAB_OVERHANG_MM;
      const v1 = z.innerWidthMm / 2 + CLIP_RAIL_MM - TAB_OUTER_INSET_MM;
      for (const along of [-z.innerLengthMm / 4, z.innerLengthMm / 4]) tabs.push(rectPolygon(along, cy + side * ((v0 + v1) / 2), tabLen, v1 - v0));
    }
  }
  const railTop = CLIP_PLATE_MM + z.railHeightMm;
  const layers: PrismLayer[] = [
    plate,
    { z0: CLIP_PLATE_MM, z1: railTop, groups: normalizePolygons(rails) },
    { z0: railTop, z1: railTop + CLIP_TAB_THICKNESS_MM, groups: normalizePolygons(tabs) },
  ];
  return toTriangleSoupData(buildPrismStack(layers, { bottomCap: true, topCap: true }));
}

/** Pieza auxiliar exportable: UN solo STL + cantidad (letras - 1). Vacía sin cableado encadenado, sin clip activado o con una sola letra. */
export function buildSpliceClipPart(plan: InstallationPlan | null, s: SpliceClipSettings): InstallationAuxPart[] {
  if (!plan || !plan.wiring || !s.enabled || plan.spliceClipCount <= 0 || validateSpliceClip(s).length > 0) return [];
  return [
    {
      kind: "bipolarSpliceClip",
      filenameSuffix: "soporte_empalmes",
      fileBaseName: SPLICE_CLIP_FILE_BASE_NAME,
      mesh: buildSpliceClipMesh(s),
      quantity: plan.spliceClipCount,
    },
  ];
}
