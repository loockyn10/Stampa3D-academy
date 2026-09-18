import type { ContourGroup } from "@/lib/maker/types";
import { insetContourGroups, differenceContourGroups, regroupClipperSolution, contourGroupsToRawPaths } from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";

export interface BevelBand {
  z0: number;
  z1: number;
}

const BEVEL_SUBBAND_HEIGHT_MM = 0.5;
const BEVEL_MIN_SUBBANDS = 4;

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

function bevelBreakpoints(band: BevelBand): number[] {
  const height = band.z1 - band.z0;
  const n = Math.max(BEVEL_MIN_SUBBANDS, Math.ceil(height / BEVEL_SUBBAND_HEIGHT_MM));
  const points: number[] = [];
  for (let i = 0; i <= n; i++) points.push(band.z0 + (height * i) / n);
  return points;
}

/** Inset (mm) en una coordenada Z de la banda: 0 en `band.z0` (empalma con la pared normal), `bevelInsetMm` en `band.z1 = depthMm` (empalma con el frente). */
function insetAt(z: number, band: BevelBand, bevelInsetMm: number): number {
  const t = (z - band.z0) / (band.z1 - band.z0);
  return bevelInsetMm * t;
}

function footprintAt(group: ContourGroup, insetMm: number): ContourGroup[] {
  if (insetMm <= 1e-6) return [{ outer: group.outer, holes: group.holes }];
  return regroupClipperSolution(insetContourGroups([group], insetMm));
}

/**
 * Footprint del frente (pieza "frente" del cuerpo, ver body/standard.ts)
 * cuando hay bisel: el borde exterior/de cada counter en z=depthMm ya no
 * es el original, es el inset COMPLETO (`bevelInsetMm`) — necesario para
 * que el frente empalme con el borde real que deja la pared biselada ahí
 * (a diferencia del tapered, acá SÍ cambia la silueta de la interfaz
 * frontal, a propósito: el bisel es visible justo en el borde del frente).
 */
export function beveledFrontFootprint(group: ContourGroup, band: BevelBand | null, bevelInsetMm: number): ContourGroup[] {
  if (!band) return [{ outer: group.outer, holes: group.holes }];
  return footprintAt(group, bevelInsetMm);
}

/**
 * Pared exterior/hueco con bisel: fuera de la banda, la pared normal se
 * encarga (ver body/standard.ts, que acota su propio rango para dejarle
 * lugar a esta banda). Dentro de la banda, el contorno se erosiona
 * progresivamente (`insetContourGroups`, mismo mecanismo uniforme que ya
 * erosiona exterior y huecos a la vez — "hacia adentro" en ambos, ver
 * docs/STAMPA_MAKER.md) desde 0 en `band.z0` hasta `bevelInsetMm` en
 * `band.z1 = depthMm`. Aproximado con varios tramos rectos + escalones,
 * mismo patrón que body/tapered.ts (anclado por el extremo inferior, más
 * ancho, de cada tramo — sin escalón contra lo que viene de abajo).
 */
export function buildBeveledOuterWallPieces(group: ContourGroup, band: BevelBand, bevelInsetMm: number): ExtrudedMeshData[] {
  const zPoints = bevelBreakpoints(band);
  const footprints = zPoints.map((z) => footprintAt(group, insetAt(z, band, bevelInsetMm)));

  const pieces: ExtrudedMeshData[] = [];
  for (let i = 0; i < zPoints.length - 1; i++) {
    const za = zPoints[i];
    const zb = zPoints[i + 1];
    pieces.push(extrudeContourGroups(footprints[i], za, zb, { capStart: false, capEnd: false, sides: true }));

    // Escalón hacia el tramo siguiente (más angosto, más cerca del
    // frente): cierra footprints[i] (abajo) - footprints[i+1] (arriba)
    // mirando +Z, mismo patrón que la repisa del núcleo erosionado.
    const shelfGroups = differenceContourGroups(footprints[i], contourGroupsToRawPaths(footprints[i + 1]));
    pieces.push(extrudeContourGroups(shelfGroups, zb, zb, { capStart: false, capEnd: true, sides: false }));
  }
  return pieces;
}
