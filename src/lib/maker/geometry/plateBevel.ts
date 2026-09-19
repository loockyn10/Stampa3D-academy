import type { ContourGroup } from "@/lib/maker/types";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { footprintAtOffset, subdivideRange, buildOffsetProfileWallPieces, smoothstepRampProfile } from "@/lib/maker/geometry/body/shared";

/**
 * Bisel de tapa/difusor (0.4.2): infraestructura COMPARTIDA para achicar el
 * canto recto exterior de una placa fina (tapa `frontType === "lid"`, o
 * difusor plano `frontType === "perforated"`) con una transición inclinada,
 * en vez de un modificador separado por pieza. Reusa el mismo mecanismo de
 * banda+perfil suave (`subdivideRange`/`buildOffsetProfileWallPieces`,
 * `smoothstepRampProfile`) que ya usa el bisel frontal/posterior del cuerpo
 * (ver body/modifiers/bevel.ts, rearBevel.ts) — nunca CSG.
 *
 * A diferencia del bisel del CUERPO (que opera sobre una pared con cavidad
 * interior propia), una placa es un sólido macizo: el bisel acá solo cambia
 * la PARED LATERAL + la TAPA de la cara visible (`z1`), nunca la cara
 * trasera (`z0`) — esa cara sigue siendo responsabilidad de quien arma la
 * pieza completa (una tapa "glue" la tapa con una cara plana nominal; una
 * tapa "interior-lip" la deja abierta, cerrada por la repisa/el labio; el
 * difusor la tapa con una cara plana nominal). Esto preserva el sistema de
 * encastre: el bisel pertenece a la cara visible, nunca al lip interior.
 */
export interface PlateBevelBand {
  z0: number;
  z1: number;
}

const PLATE_BEVEL_RESOLUTION_MM = 0.2;
const PLATE_BEVEL_MIN_STEPS = 6;
const PLATE_BEVEL_MAX_STEPS = 60;

/**
 * Banda del bisel de placa, pegada a la cara VISIBLE (`plateZ1`): `[max(
 * plateZ0, plateZ1-bevelDepthMm), plateZ1]` — mismo criterio que el bisel
 * frontal del cuerpo (nunca más abajo que la propia cara trasera de la
 * placa). `bevelDepthMm` YA debe venir acotado al espesor real de la pieza
 * (ver createLetterGeometry.ts#lidBevelDepthUsedMm, `LID_BEVEL_DEPTH_CLAMPED`)
 * — acá solo se aplica un clamp defensivo adicional.
 */
export function computePlateBevelBand(plateZ0: number, plateZ1: number, enabled: boolean, bevelDepthMm: number): PlateBevelBand | null {
  if (!enabled) return null;
  const z0 = Math.max(plateZ0, plateZ1 - bevelDepthMm);
  if (plateZ1 - z0 < 1e-6) return null;
  return { z0, z1: plateZ1 };
}

/** Inset (mm) en una coordenada Z de la banda: 0 en `band.z0` (empalma sin quiebre con la pared normal), `insetMm` en `band.z1` (la cara visible). */
function insetAt(z: number, band: PlateBevelBand, insetMm: number): number {
  const t = (z - band.z0) / (band.z1 - band.z0);
  return smoothstepRampProfile(t, insetMm);
}

/** Footprint de la cara visible (`z1`) de la placa cuando hay bisel: el inset COMPLETO (`insetMm`), igual mecanismo que `beveledFrontFootprint` del cuerpo. Sin bisel, el contorno original (nominal). */
export function plateBevelTopFootprint(group: ContourGroup, band: PlateBevelBand | null, insetMm: number): ContourGroup[] {
  if (!band) return [{ outer: group.outer, holes: group.holes }];
  return footprintAtOffset(group, -insetMm);
}

/**
 * Pared lateral + tapa de la cara visible (`z1`) de UNA región de placa
 * (`group`, ya con cualquier otro offset previo aplicado — p.ej. la
 * continuidad con el bisel frontal del cuerpo, ver geometry/lid.ts). NUNCA
 * emite la tapa de `z0`: el llamador decide cómo cerrar esa cara (tapa
 * completa para una placa "glue"/el difusor, o dejarla abierta para que la
 * repisa/el labio de una tapa encastrable la cierren).
 */
export function buildBeveledPlateWallAndTopCap(group: ContourGroup, z0: number, z1: number, band: PlateBevelBand | null, insetMm: number): ExtrudedMeshData {
  if (!band) {
    return extrudeContourGroups([group], z0, z1, { capStart: false, capEnd: true, sides: true });
  }
  const pieces: ExtrudedMeshData[] = [];
  if (band.z0 - z0 > 1e-9) {
    pieces.push(extrudeContourGroups([group], z0, band.z0, { capStart: false, capEnd: false, sides: true }));
  }
  const zPoints = subdivideRange(band.z0, band.z1, PLATE_BEVEL_RESOLUTION_MM, PLATE_BEVEL_MIN_STEPS, PLATE_BEVEL_MAX_STEPS);
  pieces.push(...buildOffsetProfileWallPieces(group, zPoints, (z) => -insetAt(z, band, insetMm)));
  const topFootprint = plateBevelTopFootprint(group, band, insetMm);
  pieces.push(extrudeContourGroups(topFootprint, z1, z1, { capStart: false, capEnd: true, sides: false }));
  return {
    positions: pieces.flatMap((p) => p.positions),
    normals: pieces.flatMap((p) => p.normals),
  };
}
