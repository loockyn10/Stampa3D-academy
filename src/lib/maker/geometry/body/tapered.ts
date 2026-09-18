import type { ContourGroup, LetterSignParams } from "@/lib/maker/types";
import { outsetContourGroups, differenceContourGroups, regroupClipperSolution, contourGroupsToRawPaths } from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { computeWallAndCore } from "@/lib/maker/geometry/body/shared";

// Altura objetivo por sub-banda: `extrudeContourGroups` solo genera paredes
// rectas (footprint constante) por llamada, así que el offset progresivo se
// aproxima con varios tramos rectos apilados en vez de una superficie curva
// (ver docs/STAMPA_MAKER.md) — igual de válido para impresión 3D que la
// propia tolerancia de mallado del resto del pipeline.
const TAPER_BAND_HEIGHT_MM = 2;
const TAPER_MIN_BANDS = 8;

function taperBreakpoints(depthMm: number): number[] {
  const bandCount = Math.max(TAPER_MIN_BANDS, Math.ceil(depthMm / TAPER_BAND_HEIGHT_MM));
  const points: number[] = [];
  for (let i = 0; i <= bandCount; i++) points.push((depthMm * i) / bandCount);
  return points;
}

/** Offset (mm) del contorno exterior/hueco en una coordenada Z: 0 en el frente (z=depthMm, silueta nominal), rearExpansionMm en la base (z=0), progresivo entre medio. */
function taperOffsetAt(z: number, depthMm: number, rearExpansionMm: number): number {
  const t = depthMm > 0 ? z / depthMm : 1; // 0 en la base, 1 en el frente
  return rearExpansionMm * (1 - t);
}

function footprintAt(group: ContourGroup, offsetMm: number): ContourGroup[] {
  if (offsetMm <= 1e-6) return [{ outer: group.outer, holes: group.holes }];
  return regroupClipperSolution(outsetContourGroups([group], offsetMm));
}

/**
 * Cuerpo "tapered" (0.4 Etapa 3): la silueta EXTERIOR (y el borde de cada
 * counter — mismo mecanismo dilatado que las costillas, `outsetContourGroups`
 * afecta exterior y huecos a la vez) crece progresivamente desde el frente
 * (z=depthMm, offset 0 — silueta nominal, compatible con frente/tapa sin
 * cambios) hacia la base (z=0, offset `rearExpansionMm`).
 *
 * Construcción: N bandas ancladas por su extremo INFERIOR (bottom-anchored)
 * — la banda `i` usa el footprint evaluado en su propio `z0`, constante en
 * toda su altura. Esto hace que la tapa/base (z=0) y la banda 0 usen
 * EXACTAMENTE el mismo footprint (sin escalón en la base) y que cada banda
 * necesite un escalón horizontal (mismo patrón que la repisa del núcleo
 * erosionado — bigger-abajo/smaller-arriba, cierra mirando +Z) hacia la
 * banda siguiente, MÁS ANGOSTA. El último escalón (al llegar a z=depthMm)
 * cierra contra el contorno ORIGINAL exacto (offset 0), asegurando que el
 * frente quede con dimensiones nominales — necesario para que `front/`
 * (que sigue recibiendo `contourGroups` sin modificar) suelde igual que en
 * el cuerpo standard.
 *
 * El resto del cuerpo (repisa, paredes de la cavidad oculta, frente) usa el
 * contorno ORIGINAL sin cambios — igual filosofía que las costillas: el
 * tapered solo cambia la silueta VISIBLE, nunca la cavidad interna oculta.
 *
 * Limitación conocida de 0.4: no soporta combinarse con costillas
 * (ribsCount se ignora si bodyType es "tapered") — ver docs/STAMPA_MAKER.md.
 */
export function buildTaperedBodyPieces(
  contourGroups: ContourGroup[],
  params: LetterSignParams,
): { body: ExtrudedMeshData; fullyEroded: boolean } {
  const fondoGroups: ContourGroup[] = [];
  const wallGroups: ContourGroup[] = [];
  const coreGroups: ContourGroup[] = [];
  const taperedWallPieces: ExtrudedMeshData[] = [];
  let fullyEroded = false;

  const wallHeight = params.depthMm - params.baseMm;
  const zPoints = taperBreakpoints(params.depthMm);

  for (const group of contourGroups) {
    fondoGroups.push({ outer: group.outer, holes: group.holes });

    const wac = computeWallAndCore(group, params.wallMm);
    if (wac.fullyEroded) fullyEroded = true;
    wallGroups.push(...wac.wallGroups);
    coreGroups.push(...wac.coreGroups);

    if (wallHeight > 0 && params.rearExpansionMm > 1e-6) {
      const footprints = zPoints.map((z) => footprintAt(group, taperOffsetAt(z, params.depthMm, params.rearExpansionMm)));

      for (let i = 0; i < zPoints.length - 1; i++) {
        const za = zPoints[i];
        const zb = zPoints[i + 1];
        taperedWallPieces.push(extrudeContourGroups(footprints[i], za, zb, { capStart: false, capEnd: false, sides: true }));

        // Escalón hacia la banda siguiente (más angosta), en zb: cierra la
        // diferencia footprints[i] (abajo, más ancho) - footprints[i+1]
        // (arriba, más angosto) mirando +Z. En el último tramo,
        // footprints[i+1] es el contorno original exacto (offset 0),
        // asegurando el empalme nominal con el frente.
        const shelfGroups = differenceContourGroups(footprints[i], contourGroupsToRawPaths(footprints[i + 1]));
        taperedWallPieces.push(extrudeContourGroups(shelfGroups, zb, zb, { capStart: false, capEnd: true, sides: false }));
      }
    } else if (wallHeight > 0) {
      // Sin expansión trasera (rearExpansionMm ~0): mismo resultado que el
      // cuerpo standard, franja continua sin escalones.
      taperedWallPieces.push(extrudeContourGroups([{ outer: group.outer, holes: group.holes }], 0, params.depthMm, { capStart: false, capEnd: false, sides: true }));
    }
  }

  const pieces: ExtrudedMeshData[] = [];

  if (wallHeight <= 0) {
    pieces.push(extrudeContourGroups(fondoGroups, 0, params.depthMm, { capStart: true, capEnd: true }));
  } else {
    // 1) Fondo: tapa en z=0, usando el footprint MÁS ANCHO (rearExpansionMm
    //    completo) — igual al que usa la primera banda, sin escalón.
    const baseGroups = params.rearExpansionMm > 1e-6
      ? fondoGroups.flatMap((g) => footprintAt({ outer: g.outer, holes: g.holes }, params.rearExpansionMm))
      : fondoGroups;
    pieces.push(extrudeContourGroups(baseGroups, 0, 0, { capStart: true, capEnd: false, sides: false }));
    pieces.push(...taperedWallPieces);

    // 2) Repisa, 3) paredes internas, 4) frente: igual que el cuerpo
    //    standard, sin cambios (la cavidad oculta y la interfaz de
    //    frente/tapa no dependen del tipo de cuerpo).
    pieces.push(extrudeContourGroups(coreGroups, params.baseMm, params.baseMm, { capStart: false, capEnd: true, sides: false }));
    pieces.push(extrudeContourGroups(coreGroups, params.baseMm, params.depthMm, { capStart: false, capEnd: false, sides: true, flipSides: true }));
    pieces.push(extrudeContourGroups(wallGroups, params.depthMm, params.depthMm, { capStart: false, capEnd: true, sides: false }));
  }

  const body: ExtrudedMeshData = {
    positions: pieces.flatMap((p) => p.positions),
    normals: pieces.flatMap((p) => p.normals),
  };

  return { body, fullyEroded };
}
