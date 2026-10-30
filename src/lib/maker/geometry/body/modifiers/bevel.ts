import type { ContourGroup } from "@/lib/maker/types";
import { footprintAtOffset, type ZBand } from "@/lib/maker/geometry/body/shared";

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

/**
 * Inset (mm) en una coordenada Z de la banda: chaflán RECTO, 0 en `band.z0`
 * (donde termina la pared vertical) hasta `bevelInsetMm` en `band.z1 =
 * depthMm` (el borde del frente; la tapa lo continúa, ver geometry/lid.ts).
 * Hasta 0.6 el perfil era un smoothstep (pendiente 0 en ambos extremos): la
 * pared volvía a ser vertical justo en el borde del frente, así que el
 * "bisel" era una S larga que adelgazaba la letra en toda la banda en vez de
 * un corte inclinado cerca de la cara superior. Con el perfil recto la pared
 * es vertical hasta `band.z0` y el ángulo respecto de la vertical es
 * constante: `atan(bevelInsetMm / altura de la banda)`.
 */
function insetAt(z: number, band: BevelBand, bevelInsetMm: number): number {
  const t = Math.min(1, Math.max(0, (z - band.z0) / (band.z1 - band.z0)));
  return bevelInsetMm * t;
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
 * junto con las bandas de costillas/doble bisel). Perfil recto (`insetAt`)
 * aproximado con sub-bandas de ~0.2mm (`MODIFIER_RESOLUTION_MM` en
 * shared.ts). La pared interior (cavidad) acompaña este mismo perfil para
 * conservar el espesor de pared, ver body/cavity.ts.
 */
export function bevelBandToZBand(band: BevelBand, bevelInsetMm: number): ZBand {
  return { z0: band.z0, z1: band.z1, offsetAt: (z: number) => -insetAt(z, band, bevelInsetMm) };
}
