import type * as ClipperLib from "clipper-lib";
import type { ContourGroup } from "@/lib/maker/types";
import { insetContourGroups, regroupClipperSolution, clipperPathsArea, differenceRawPaths } from "@/lib/maker/geometry/offsets";

// Por debajo de esta área (mm²) consideramos vacía una región: el trazo
// (o la holgura, o el espesor del labio) erosionaron por completo lo que
// tenía que quedar (sección 12 del spec, no es un error, es una
// advertencia — ver createLetterGeometry.ts, LIP_COLLAPSED).
const MIN_AREA_MM2 = 1e-4;

// Por debajo de esta profundidad (mm) el labio sería una franja
// prácticamente nula (pared lateral casi sin altura): se trata como
// colapsado en vez de generar geometría degenerada.
const MIN_INSERT_DEPTH_MM = 0.1;

export interface InteriorLipFit {
  /** true si el labio no se pudo generar para este contorno con estos parámetros. */
  collapsed: boolean;
  /** Huella del ANILLO/marco del labio (no toda la cavidad), en paths crudos de Clipper. Vacío si collapsed. */
  rawPaths: ClipperLib.Paths;
  /** Misma huella, ya agrupada exterior/huecos. Vacío si collapsed. */
  groups: ContourGroup[];
}

const EMPTY_FIT: InteriorLipFit = { collapsed: true, rawPaths: [], groups: [] };

/**
 * Deriva la huella 2D del labio interior de UN contorno del cuerpo (letra o
 * sub-forma): un ANILLO/marco perimetral de espesor `lipWallMm`, no toda la
 * región interior de la cavidad — crítico para cartelería luminosa, ver
 * docs/STAMPA_MAKER.md sección 12: la placa frontal debe quedar fina en
 * el centro, solo el perímetro del labio ocupa `insertDepthMm` de
 * profundidad.
 *
 * Tres pasos, todos con las mismas operaciones robustas de Clipper que ya
 * usa el resto del pipeline (nada nuevo, mismo patrón que ya arma la pared
 * del cuerpo en createLetterGeometry.ts: outer menos su propio inset):
 *
 * 1. Cavidad real del cuerpo: núcleo erosionado por `wallMm` (la MISMA
 *    cavidad que ya delimita el cuerpo — nunca una cavidad especial).
 * 2. Holgura (`clearanceMm`, por lado, sin dividir por dos): erosiona la
 *    cavidad esa distancia adicional. Esto posiciona el labio; el
 *    resultado ("fit region") todavía es la región COMPLETA, no el anillo.
 * 3. Pared perimetral (`lipWallMm`): fit region menos su propio inset por
 *    `lipWallMm` — dos (o más) bandas finas siguiendo los bordes de la fit
 *    region, dejando VACÍO el centro. Para un trazo anular (p.ej. "O") esto
 *    da naturalmente dos bandas separadas (una por cada borde de la
 *    cavidad), exactamente el "marco" que se ve en sección transversal.
 *
 * Colapsa (día no generar el labio) en dos casos, ambos por
 * "no convertir silenciosamente en una placa maciza" (sección 12 del
 * spec): (a) la fit region desaparece (trazo/holgura ya erosionan todo:
 * no hay dónde poner un labio); (b) el vacío CENTRAL del anillo desaparece
 * (lipWallMm es tan grande respecto a la fit region que el "anillo"
 * pasaría a ser la región completa, macizo — el mismo problema que esta
 * corrección busca eliminar, así que se trata como error, no como
 * degradación silenciosa).
 */
export function fitInteriorLip(
  group: ContourGroup,
  wallMm: number,
  clearanceMm: number,
  lipWallMm: number,
  insertDepthMm: number,
): InteriorLipFit {
  if (insertDepthMm < MIN_INSERT_DEPTH_MM) return EMPTY_FIT;

  // 1) Cavidad real del cuerpo.
  const cavityRawPaths = insetContourGroups([group], wallMm);
  if (cavityRawPaths.length === 0) return EMPTY_FIT;
  const cavityGroups = regroupClipperSolution(cavityRawPaths);
  if (cavityGroups.length === 0) return EMPTY_FIT;

  // 2) Holgura: posiciona el labio dentro de la cavidad.
  const fitRawPaths = insetContourGroups(cavityGroups, clearanceMm);
  const fitArea = Math.abs(clipperPathsArea(fitRawPaths));
  if (fitArea < MIN_AREA_MM2) return EMPTY_FIT;
  const fitGroups = regroupClipperSolution(fitRawPaths);
  if (fitGroups.length === 0) return EMPTY_FIT;

  // 3) Pared perimetral: el vacío central (inset de la fit region por
  // lipWallMm) debe sobrevivir — si desaparece, el "anillo" sería la fit
  // region completa (macizo), exactamente lo que hay que evitar.
  const voidRawPaths = insetContourGroups(fitGroups, lipWallMm);
  const voidArea = Math.abs(clipperPathsArea(voidRawPaths));
  if (voidArea < MIN_AREA_MM2) return EMPTY_FIT;

  const ringRawPaths = differenceRawPaths(fitRawPaths, voidRawPaths);
  if (ringRawPaths.length === 0) return EMPTY_FIT;
  const ringGroups = regroupClipperSolution(ringRawPaths);
  if (ringGroups.length === 0) return EMPTY_FIT;

  return { collapsed: false, rawPaths: ringRawPaths, groups: ringGroups };
}
