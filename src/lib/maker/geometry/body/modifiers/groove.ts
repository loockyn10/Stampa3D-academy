import { raisedCosineProfile, type ZBand } from "@/lib/maker/geometry/body/shared";

export interface GrooveBand {
  z0: number;
  z1: number;
}

/**
 * Banda del doble bisel / cintura luminosa (0.4.1 corrección 3B — modificador
 * SEPARADO del bisel frontal, ver docs/STAMPA_MAKER.md sección 14.4b):
 * `groovePositionMm` mide la distancia desde el FRENTE (z=depthMm) hasta el
 * CENTRO de la banda (misma convención "medido desde el frente" que
 * `bevelDepthMm`), `grooveWidthMm` es la extensión total en Z. `null` si
 * está desactivado o no entra con margen dentro de `[baseMm, depthMm]` (la
 * pared, nunca la base maciza) — mismo criterio que costillas/bisel: no
 * generar una banda pegada a un borde que rompería la soldadura con la
 * repisa o el frente.
 */
export function computeGrooveBand(baseMm: number, depthMm: number, grooveEnabled: boolean, groovePositionMm: number, grooveWidthMm: number): GrooveBand | null {
  if (!grooveEnabled) return null;
  const center = depthMm - groovePositionMm;
  const half = grooveWidthMm / 2;
  const z0 = center - half;
  const z1 = center + half;
  const margin = 1e-6;
  if (z0 < baseMm + margin || z1 > depthMm - margin) return null;
  return { z0, z1 };
}

/**
 * Convierte la banda de doble bisel en un descriptor de banda genérico (ver
 * body/shared.ts#buildBandedOuterWallPieces). Perfil: 0 en `band.z0`
 * (empalma al ras con la pared normal), erosiona progresivamente hasta
 * `-grooveInsetMm` (máximo, hacia ADENTRO — "la pared baja hacia adentro")
 * a mitad de banda, y vuelve a 0 en `band.z1` ("y después vuelve a
 * subir/salir") — misma media onda coseno que el montículo de las
 * costillas (`raisedCosineProfile`), con el pico en signo NEGATIVO (inset
 * en vez de outset): es, literalmente, un montículo hacia adentro en vez de
 * hacia afuera. Mismo offset uniforme sobre exterior Y counters que el
 * resto del pipeline (`footprintAtOffset`/`insetContourGroups`).
 */
export function grooveBandToZBand(band: GrooveBand, grooveInsetMm: number): ZBand {
  const height = band.z1 - band.z0;
  return {
    z0: band.z0,
    z1: band.z1,
    offsetAt: (z: number) => raisedCosineProfile((z - band.z0) / height, -grooveInsetMm),
  };
}
