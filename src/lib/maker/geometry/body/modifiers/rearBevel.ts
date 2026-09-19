import type { ContourGroup } from "@/lib/maker/types";
import { footprintAtOffset, smoothstepRampProfile, type ZBand } from "@/lib/maker/geometry/body/shared";

export interface RearBevelBand {
  z0: number;
  z1: number;
}

/**
 * Banda del bisel posterior (0.4.2), pegada a la BASE: `[0,
 * min(rearBevelDepthMm, depthMm)]` — a diferencia del bisel frontal
 * (`computeBevelBand`), no se acota contra `baseMm`: el bisel posterior
 * reshapea justamente el extremo trasero (incluida la base maciza), así que
 * su banda puede empezar en Z=0 sin restricción. `null` si está desactivado
 * o no cabe (profundidad total nula).
 */
export function computeRearBevelBand(depthMm: number, rearBevelEnabled: boolean, rearBevelDepthMm: number): RearBevelBand | null {
  if (!rearBevelEnabled) return null;
  const z0 = 0;
  const z1 = Math.min(depthMm, rearBevelDepthMm);
  if (z1 - z0 < 1e-6) return null;
  return { z0, z1 };
}

/** Inset (mm) en una coordenada Z de la banda: `rearBevelInsetMm` en `band.z0 = 0` (máximo, el extremo trasero), 0 en `band.z1` (empalma sin quiebre con la pared normal) — perfil espejado del bisel frontal. */
function insetAt(z: number, band: RearBevelBand, rearBevelInsetMm: number): number {
  const t = (band.z1 - z) / (band.z1 - band.z0);
  return smoothstepRampProfile(t, rearBevelInsetMm);
}

/**
 * Footprint del fondo (pieza "fondo" del cuerpo, ver body/standard.ts)
 * cuando hay bisel posterior: el borde exterior/de cada counter en Z=0 ya no
 * es el original, es el inset COMPLETO (`rearBevelInsetMm`) — equivalente
 * trasero de `beveledFrontFootprint`.
 */
export function beveledRearFootprint(group: ContourGroup, band: RearBevelBand | null, rearBevelInsetMm: number): ContourGroup[] {
  if (!band) return [{ outer: group.outer, holes: group.holes }];
  return footprintAtOffset(group, -rearBevelInsetMm);
}

/**
 * Convierte la banda de bisel posterior en un descriptor de banda genérico
 * (ver body/shared.ts#buildBandedOuterWallPieces, combinado junto con
 * costillas/bisel frontal/bisel lateral en body/standard.ts). Mismo perfil
 * smoothstep que el bisel frontal (`bevelBandToZBand`), con el pico en el
 * extremo OPUESTO (Z=0 en vez de Z=depthMm).
 */
export function rearBevelBandToZBand(band: RearBevelBand, rearBevelInsetMm: number): ZBand {
  return { z0: band.z0, z1: band.z1, offsetAt: (z: number) => -insetAt(z, band, rearBevelInsetMm) };
}
