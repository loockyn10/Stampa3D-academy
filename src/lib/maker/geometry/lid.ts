import type { ContourGroup, LetterSignParams } from "@/lib/maker/types";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { differenceContourGroups } from "@/lib/maker/geometry/offsets";
import { fitInteriorLip } from "@/lib/maker/geometry/joints/interiorLip";

export interface LidResult {
  /** Tapa (placa, o placa+labio soldados en una sola pieza), o null si frontType !== "lid". */
  lid: ExtrudedMeshData | null;
  /** true si el labio no se pudo generar en alguna zona del contorno (solo lidJoint === "interior-lip"). */
  lipCollapsed: boolean;
}

/**
 * Concepto "tapa": arma la pieza de tapa de UN carácter a partir de sus
 * contornos crudos (mismos `contourGroups` que ya procesa el cuerpo, ver
 * createLetterGeometry.ts). No conoce nada del cuerpo más allá de los
 * parámetros compartidos (wallMm, depthMm) — el cuerpo sigue siendo
 * exactamente el mismo para los 3 modos de frente.
 *
 * El sistema de unión (`lidJoint`) es la única decisión ramificada acá, en
 * un solo lugar: "glue" arma una placa plana (0.2, sin cambios);
 * "interior-lip" delega la huella del labio a
 * geometry/joints/interiorLip.ts y suelda placa+labio por coordenadas
 * compartidas (mismo mecanismo que ya suelda fondo/repisa/pared del
 * cuerpo, sin booleana 3D).
 */
export function buildLid(contourGroups: ContourGroup[], params: LetterSignParams, insertDepthUsedMm: number): LidResult {
  if (params.frontType !== "lid") return { lid: null, lipCollapsed: false };

  // Misma silueta que el fondo del cuerpo (exterior menos huecos
  // ORIGINALES del glifo, nunca un disco): respeta los counters igual que
  // la placa plana de 0.2.
  const plateGroups: ContourGroup[] = contourGroups.map((g) => ({ outer: g.outer, holes: g.holes }));

  if (params.lidJoint !== "interior-lip") {
    const plate = extrudeContourGroups(plateGroups, params.depthMm, params.depthMm + params.lidMm, { capStart: true, capEnd: true });
    return { lid: plate, lipCollapsed: false };
  }

  return buildInteriorLipLid(contourGroups, plateGroups, params, insertDepthUsedMm);
}

/**
 * Tapa encastrable (0.3): placa + labio interior soldados en un único
 * sólido, ver docs/STAMPA_MAKER.md sección 12 (Tapa encastrable). Pieza:
 *
 *  - z = depthMm -> depthMm+lidMm: paredes de la placa (silueta completa)
 *    + tapa superior (cara exterior de la tapa). Sin tapar acá la cara
 *    inferior (z=depthMm): la cierran la repisa (zona sin labio) y el
 *    propio labio (zona con labio) — igual patrón que fondo/repisa/pared
 *    del cuerpo.
 *  - z = depthMm (repisa): tapa la cara inferior de la placa SOLO donde no
 *    hay labio (huella de la placa menos huella del labio), mirando hacia
 *    -Z (hacia la cavidad).
 *  - z = depthMm-insertDepth -> depthMm (labio): paredes de la huella del
 *    labio (ver joints/interiorLip.ts), sin tapa en ninguno de los dos
 *    extremos acá — la punta se tapa aparte, el extremo superior se
 *    suelda contra la cara inferior de la placa.
 *  - z = depthMm-insertDepth (tapa de la punta del labio): cierra el
 *    extremo que entra en la cavidad, mirando hacia -Z.
 *
 * Todas las piezas comparten coordenadas exactas en cada frontera (misma
 * grilla + jitter determinístico que ya suelda el cuerpo), así que el
 * resultado es un único componente conectado, sin booleana 3D.
 */
function buildInteriorLipLid(
  contourGroups: ContourGroup[],
  plateGroups: ContourGroup[],
  params: LetterSignParams,
  insertDepthUsedMm: number,
): LidResult {
  const allLipGroups: ContourGroup[] = [];
  const plateShelfGroups: ContourGroup[] = [];
  let lipCollapsed = false;

  for (const group of contourGroups) {
    const fit = fitInteriorLip(group, params.wallMm, params.clearanceMm, insertDepthUsedMm);
    if (fit.collapsed) {
      lipCollapsed = true;
      // Sin labio para este contorno: la placa queda maciza en esa zona
      // (mismo resultado que la tapa plana), en vez de romper.
      plateShelfGroups.push({ outer: group.outer, holes: group.holes });
      continue;
    }
    allLipGroups.push(...fit.groups);
    plateShelfGroups.push(...differenceContourGroups([group], fit.rawPaths));
  }

  const z0 = params.depthMm - insertDepthUsedMm;
  const pieces: ExtrudedMeshData[] = [
    extrudeContourGroups(plateGroups, params.depthMm, params.depthMm + params.lidMm, { capStart: false, capEnd: true }),
    extrudeContourGroups(plateShelfGroups, params.depthMm, params.depthMm, { capStart: true, capEnd: false, sides: false }),
  ];

  if (allLipGroups.length > 0) {
    pieces.push(
      extrudeContourGroups(allLipGroups, z0, params.depthMm, { capStart: false, capEnd: false, sides: true }),
      extrudeContourGroups(allLipGroups, z0, z0, { capStart: true, capEnd: false, sides: false }),
    );
  }

  const lid: ExtrudedMeshData = {
    positions: pieces.flatMap((p) => p.positions),
    normals: pieces.flatMap((p) => p.normals),
  };
  return { lid, lipCollapsed };
}
