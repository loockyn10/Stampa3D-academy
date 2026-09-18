import type * as ClipperLib from "clipper-lib";
import type { ContourGroup } from "@/lib/maker/types";
import { insetContourGroups, regroupClipperSolution, clipperPathsArea } from "@/lib/maker/geometry/offsets";

// Por debajo de esta área (mm²) consideramos el labio colapsado: la
// holgura + el espesor de pared erosionaron el trazo por completo (sección
// 12 del spec, no es un error, es una advertencia).
const MIN_LIP_AREA_MM2 = 1e-4;

// Por debajo de esta profundidad (mm) el labio sería una franja
// prácticamente nula (pared lateral casi sin altura): se trata como
// colapsado en vez de generar geometría degenerada.
const MIN_INSERT_DEPTH_MM = 0.1;

export interface InteriorLipFit {
  /** true si el labio no se pudo generar para este contorno con estos parámetros. */
  collapsed: boolean;
  /** Huella del labio, en paths crudos de Clipper (mismo formato que offsets.ts). Vacío si collapsed. */
  rawPaths: ClipperLib.Paths;
  /** Misma huella, ya agrupada exterior/huecos. Vacío si collapsed. */
  groups: ContourGroup[];
}

const EMPTY_FIT: InteriorLipFit = { collapsed: true, rawPaths: [], groups: [] };

/**
 * Deriva la huella 2D del labio interior de UN contorno del cuerpo (letra o
 * sub-forma). Parte de la MISMA cavidad que ya delimita el cuerpo (núcleo
 * erosionado por `wallMm`, ver createLetterGeometry.ts — no un cuerpo ni
 * una cavidad especial) y la erosiona `clearanceMm` adicionales: esa es la
 * convención de holgura de Stampa Maker, POR LADO (no se divide por dos),
 * porque `insetContourGroups` ya erosiona cada borde exactamente esa
 * distancia, igual que hace con `wallMm` para la pared del cuerpo.
 *
 * No conoce Z ni extrusión: la pieza 3D la arma lid.ts con
 * `extrudeContourGroups`, el mismo mecanismo (grilla compartida + jitter
 * determinístico) que ya suelda fondo/repisa/pared del cuerpo sin booleana
 * 3D — ver "Soldadura fondo/pared" en createLetterGeometry.ts.
 */
export function fitInteriorLip(group: ContourGroup, wallMm: number, clearanceMm: number, insertDepthMm: number): InteriorLipFit {
  if (insertDepthMm < MIN_INSERT_DEPTH_MM) return EMPTY_FIT;

  const cavityRawPaths = insetContourGroups([group], wallMm);
  if (cavityRawPaths.length === 0) return EMPTY_FIT;
  const cavityGroups = regroupClipperSolution(cavityRawPaths);
  if (cavityGroups.length === 0) return EMPTY_FIT;

  const lipRawPaths = insetContourGroups(cavityGroups, clearanceMm);
  const area = Math.abs(clipperPathsArea(lipRawPaths));
  if (area < MIN_LIP_AREA_MM2) return EMPTY_FIT;

  return { collapsed: false, rawPaths: lipRawPaths, groups: regroupClipperSolution(lipRawPaths) };
}
