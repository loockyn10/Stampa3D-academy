import type { ContourGroup } from "@/lib/maker/types";
import { outsetContourGroups, differenceContourGroups, regroupClipperSolution, contourGroupsToRawPaths } from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";

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
 * Pared exterior/hueco de UN contorno (la parte "lateral" del fondo, ver
 * body/standard.ts) con costillas: sin bandas, es EXACTAMENTE la misma
 * franja continua de siempre (mismo resultado byte a byte que antes de
 * 0.4 Etapa 2). Dentro de cada banda, el contorno se dilata
 * (`outsetContourGroups`: exterior crece, huecos se achican — el
 * montículo sobresale hacia afuera Y hacia el counter) siguiendo la
 * silueta real de la letra, nunca un bounding box. Los "escalones"
 * (anillos horizontales entre la pared plana y la costilla) sueldan por
 * coordenadas compartidas, mismo mecanismo que ya usa la repisa del
 * núcleo erosionado — sin CSG.
 */
export function buildRibbedOuterWallPieces(
  group: ContourGroup,
  z0: number,
  z1: number,
  bands: RibBand[],
  protrusionMm: number,
): ExtrudedMeshData[] {
  const plainGroups: ContourGroup[] = [{ outer: group.outer, holes: group.holes }];

  if (bands.length === 0) {
    return [extrudeContourGroups(plainGroups, z0, z1, { capStart: false, capEnd: false, sides: true })];
  }

  const ribGroups = regroupClipperSolution(outsetContourGroups([group], protrusionMm));
  const plainRawPaths = contourGroupsToRawPaths(plainGroups);
  // El "rim" es solo el material AGREGADO por la costilla (costilla menos
  // pared plana): es lo que hay que tapar en cada escalón, no toda la
  // costilla (que ya comparte su borde interior con la pared plana).
  const rimGroups = differenceContourGroups(ribGroups, plainRawPaths);

  const pieces: ExtrudedMeshData[] = [];
  const breakpoints = [z0, ...bands.flatMap((b) => [b.z0, b.z1]), z1].sort((a, b) => a - b);

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const za = breakpoints[i];
    const zb = breakpoints[i + 1];
    if (zb - za < 1e-9) continue;
    const midZ = (za + zb) / 2;
    const inBand = bands.some((b) => midZ > b.z0 && midZ < b.z1);
    pieces.push(extrudeContourGroups(inBand ? ribGroups : plainGroups, za, zb, { capStart: false, capEnd: false, sides: true }));
  }

  for (const band of bands) {
    // Escalón de entrada (pared plana -> costilla, footprint crece hacia
    // arriba): el rim nuevo aparece por encima, cierra su piso mirando -Z
    // (no hay nada debajo de él salvo la pared delgada).
    pieces.push(extrudeContourGroups(rimGroups, band.z0, band.z0, { capStart: true, capEnd: false, sides: false }));
    // Escalón de salida (costilla -> pared plana, footprint se achica hacia
    // arriba): el rim desaparece por encima, cierra su techo mirando +Z —
    // mismo patrón que la repisa del núcleo erosionado.
    pieces.push(extrudeContourGroups(rimGroups, band.z1, band.z1, { capStart: false, capEnd: true, sides: false }));
  }

  return pieces;
}
