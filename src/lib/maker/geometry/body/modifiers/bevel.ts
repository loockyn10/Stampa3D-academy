import type { ContourGroup } from "@/lib/maker/types";
import { footprintAtOffset, smoothstepRampProfile, type ZBand } from "@/lib/maker/geometry/body/shared";

export interface BevelBand {
  z0: number;
  z1: number;
}

/**
 * Banda del bisel, pegada al frente: `[depthMm-bevelDepthMm, depthMm]`,
 * acotada a no invadir la base maciza (nunca por debajo de `baseMm`).
 * `null` si está desactivado o no cabe (profundidad de pared insuficiente).
 */
export function computeBevelBand(baseMm: number, depthMm: number, bevelEnabled: boolean, bevelDepthMm: number): BevelBand | null {
  if (!bevelEnabled) return null;
  const z0 = Math.max(baseMm, depthMm - bevelDepthMm);
  const z1 = depthMm;
  if (z1 - z0 < 1e-6) return null;
  return { z0, z1 };
}

/** Inset (mm) en una coordenada Z de la banda: 0 en `band.z0` (pendiente 0, empalma sin quiebre con la pared normal), `bevelInsetMm` en `band.z1 = depthMm` (pendiente 0 también, empalma sin quiebre con el frente/la tapa — ver geometry/lid.ts). */
function insetAt(z: number, band: BevelBand, bevelInsetMm: number): number {
  const t = (z - band.z0) / (band.z1 - band.z0);
  return smoothstepRampProfile(t, bevelInsetMm);
}

/**
 * Footprint del frente (pieza "frente" del cuerpo, ver body/standard.ts)
 * cuando hay bisel: el borde exterior/de cada counter en z=depthMm ya no es
 * el original, es el inset COMPLETO (`bevelInsetMm`) — necesario para que el
 * frente empalme con el borde real que deja la pared biselada ahí (a
 * diferencia del tapered, acá SÍ cambia la silueta de la interfaz frontal, a
 * propósito: el bisel es visible justo en el borde del frente). Misma huella
 * que reusa la tapa para continuidad visual cuerpo->bisel->tapa (0.4.1
 * corrección 3A, ver geometry/lid.ts#bevelPlateInsetMm).
 */
export function beveledFrontFootprint(group: ContourGroup, band: BevelBand | null, bevelInsetMm: number): ContourGroup[] {
  if (!band) return [{ outer: group.outer, holes: group.holes }];
  return footprintAtOffset(group, -bevelInsetMm);
}

/**
 * Convierte la banda de bisel en un descriptor de banda genérico (ver
 * body/shared.ts#buildBandedOuterWallPieces, usado por body/standard.ts
 * junto con las bandas de costillas/doble bisel). 0.4.1 corrección 3A:
 * perfil smoothstep (`insetAt`, pendiente 0 en ambos extremos, resolución
 * ~0.2mm vía `MODIFIER_RESOLUTION_MM` en shared.ts) en vez del anterior
 * (sub-bandas de 0.5mm, interpolación LINEAL — se percibía "demasiado
 * segmentado", con un quiebre anguloso justo donde la banda empalmaba con
 * la pared normal).
 */
export function bevelBandToZBand(band: BevelBand, bevelInsetMm: number): ZBand {
  return { z0: band.z0, z1: band.z1, offsetAt: (z: number) => -insetAt(z, band, bevelInsetMm) };
}
