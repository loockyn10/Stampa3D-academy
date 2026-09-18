import { raisedCosineProfile, type ZBand } from "@/lib/maker/geometry/body/shared";

export interface RibBand {
  z0: number;
  z1: number;
}

/**
 * Bandas de costilla dentro de `[baseMm, depthMm]` (la pared, nunca la base
 * maciza): 1 costilla al medio del rango, 2 costillas en 1/3 y 2/3 —
 * "distribuirlas de manera razonablemente simétrica", sin exponer un
 * parámetro de posición (el pedido no lo exige). Descarta bandas que no
 * entren con margen (letra/profundidad muy chica para el ancho pedido) en
 * vez de generar una banda pegada a la base o al frente, que rompería la
 * soldadura con la repisa/el frente.
 */
export function computeRibBands(baseMm: number, depthMm: number, ribsCount: 0 | 1 | 2, ribWidthMm: number): RibBand[] {
  if (ribsCount !== 1 && ribsCount !== 2) return [];
  const range = depthMm - baseMm;
  const centersT = ribsCount === 1 ? [0.5] : [1 / 3, 2 / 3];
  const halfWidth = ribWidthMm / 2;
  const margin = 1e-6;
  return centersT
    .map((t) => baseMm + range * t)
    .map((centerZ) => ({ z0: centerZ - halfWidth, z1: centerZ + halfWidth }))
    .filter((band) => band.z0 > baseMm + margin && band.z1 < depthMm - margin);
}

/**
 * Convierte bandas de costilla en descriptores de banda genéricos (ver
 * body/shared.ts#buildBandedOuterWallPieces, usado por body/standard.ts
 * junto con las bandas de bisel/doble bisel). Perfil de MONTÍCULO progresivo
 * (0.4.1 corrección 1: antes era un prisma de tope plano — "camino
 * rectangular" — con un salto abrupto al entrar/salir de la banda; ahora es
 * media onda coseno vía `raisedCosineProfile`): arranca EXACTAMENTE al ras
 * del cuerpo en `band.z0` (offset 0, mismo contorno que la pared plana —
 * suelda sin escalón visible), crece progresivamente hasta `protrusionMm` a
 * mitad de banda y vuelve a 0 en `band.z1`, sin salto vertical en ningún
 * extremo — un "lomo" suave, no un escalón. El offset POSITIVO dilata
 * exterior Y huecos a la vez (`footprintAtOffset`/`outsetContourGroups`): el
 * montículo sigue la silueta real de la letra, incluidos los counters.
 */
export function ribBandsToZBands(bands: RibBand[], protrusionMm: number): ZBand[] {
  return bands.map((band) => ({
    z0: band.z0,
    z1: band.z1,
    offsetAt: (z: number) => raisedCosineProfile((z - band.z0) / (band.z1 - band.z0), protrusionMm),
  }));
}
