import type { ContourGroup, LetterSignParams } from "@/lib/maker/types";
import { extrudeContourGroups, type ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";
import { differenceContourGroups, clipperPathsArea, contourGroupsToRawPaths } from "@/lib/maker/geometry/offsets";
import { footprintAtOffset } from "@/lib/maker/geometry/body/shared";
import { computeBevelBand } from "@/lib/maker/geometry/body/modifiers/bevel";
import { fitInteriorLip } from "@/lib/maker/geometry/joints/interiorLip";

export interface LidResult {
  /** Tapa (placa, o placa+labio soldados en una sola pieza), o null si frontType !== "lid". */
  lid: ExtrudedMeshData | null;
  /** true si el labio no se pudo generar en alguna zona del contorno (solo lidJoint === "interior-lip"). */
  lipCollapsed: boolean;
  /** true si el bisel frontal (ver bevelPlateInsetMm) erosionó por completo la placa en alguna letra (0.4.1 corrección 3A). */
  plateCollapsed: boolean;
}

const MIN_PLATE_AREA_MM2 = 1e-4;

/**
 * Cuánto se achica la silueta de la tapa para continuar el bisel frontal del
 * cuerpo (0.4.1 corrección 3A: "cuerpo biselado + tapa rectangular
 * sobresaliendo" era el problema reportado). El bisel frontal (SOLO cuerpo
 * "standard" — tapered no lo aplica, ver body/tapered.ts) angosta la
 * silueta visible del cuerpo justo en el borde del frente hasta
 * `bevelInsetMm` (exterior Y cada counter, ver body/modifiers/bevel.ts); la
 * tapa reusa exactamente ese mismo inset para su propia silueta (exterior Y
 * counters), así el borde de la tapa queda del mismo tamaño que el borde
 * real que deja la pared biselada, sin escalón ni voladizo.
 */
function bevelPlateInsetMm(params: LetterSignParams): number {
  if (params.bodyType !== "standard") return 0;
  const wallHeight = params.depthMm - params.baseMm;
  if (wallHeight <= 0) return 0;
  const band = computeBevelBand(params.baseMm, params.depthMm, params.bevelEnabled, params.bevelDepthMm);
  return band ? params.bevelInsetMm : 0;
}

/**
 * Concepto "tapa": arma la pieza de tapa de UN carácter a partir de sus
 * contornos crudos (mismos `contourGroups` que ya procesa el cuerpo, ver
 * createLetterGeometry.ts). No conoce nada del cuerpo más allá de los
 * parámetros compartidos (wallMm, depthMm) y, desde 0.4.1, el bisel frontal
 * (ver `bevelPlateInsetMm` — única excepción documentada a "front no conoce
 * el cuerpo", igual patrón que la excepción ya documentada de
 * body/standard.ts para el canal luminoso, pero en sentido inverso).
 *
 * El sistema de unión (`lidJoint`) es la única decisión ramificada acá, en
 * un solo lugar: "glue" arma una placa plana (0.2, sin cambios de forma más
 * allá del inset de bisel); "interior-lip" delega la huella del labio a
 * geometry/joints/interiorLip.ts y suelda placa+labio por coordenadas
 * compartidas (mismo mecanismo que ya suelda fondo/repisa/pared del cuerpo,
 * sin booleana 3D).
 */
export function buildLid(contourGroups: ContourGroup[], params: LetterSignParams, insertDepthUsedMm: number): LidResult {
  if (params.frontType !== "lid") return { lid: null, lipCollapsed: false, plateCollapsed: false };

  const plateInsetMm = bevelPlateInsetMm(params);

  if (params.lidJoint !== "interior-lip") {
    // Misma silueta que el fondo del cuerpo (exterior menos huecos
    // ORIGINALES del glifo, nunca un disco), angostada por `plateInsetMm`
    // si hay bisel activo (0 = sin cambios, byte-idéntico a 0.2/0.3).
    const plateGroups: ContourGroup[] = contourGroups.flatMap((g) => footprintAtOffset(g, -plateInsetMm));
    const plateArea = Math.abs(clipperPathsArea(contourGroupsToRawPaths(plateGroups)));
    if (plateInsetMm > 1e-6 && plateArea < MIN_PLATE_AREA_MM2) {
      return { lid: null, lipCollapsed: false, plateCollapsed: true };
    }
    const plate = extrudeContourGroups(plateGroups, params.depthMm, params.depthMm + params.lidMm, { capStart: true, capEnd: true });
    return { lid: plate, lipCollapsed: false, plateCollapsed: false };
  }

  return buildInteriorLipLid(contourGroups, params, insertDepthUsedMm, plateInsetMm);
}

/**
 * Tapa encastrable (0.3/0.3.1, continuidad de bisel 0.4.1): placa fina +
 * labio PERIMETRAL (un anillo de espesor `lipWallMm`, no toda la cavidad —
 * ver joints/interiorLip.ts) soldados en un único sólido, ver
 * docs/STAMPA_MAKER.md sección 12. Pieza:
 *
 *  - z = depthMm -> depthMm+lidMm: paredes de la placa (silueta completa,
 *    angostada por `plateInsetMm` si hay bisel) + tapa superior (cara
 *    exterior de la tapa). Sin tapar acá la cara inferior (z=depthMm): la
 *    cierran la repisa (zona sin labio, que incluye el centro vacío detrás
 *    de la placa) y el propio labio (solo la zona del anillo) — igual
 *    patrón que fondo/repisa/pared del cuerpo. Esto es lo que mantiene la
 *    placa en exactamente `lidMm` de espesor en el centro: ahí no hay nada
 *    más que placa+repisa, el labio no llega (crítico para difusión de
 *    luz).
 *  - z = depthMm (repisa): tapa la cara inferior de la placa donde NO hay
 *    pared de labio (huella de la placa menos el ANILLO del labio — incluye
 *    tanto el borde exterior como el centro vacío), mirando hacia -Z (hacia
 *    la cavidad).
 *  - z = depthMm-insertDepth -> depthMm (labio): paredes del ANILLO del
 *    labio (ver joints/interiorLip.ts — sigue ambos bordes del anillo,
 *    exterior e interior), sin tapa en ninguno de los dos extremos acá — la
 *    punta se tapa aparte, el extremo superior se suelda contra la cara
 *    inferior de la placa. El labio se posiciona sobre la CAVIDAD real del
 *    cuerpo (`wallMm`, ajena al bisel — el bisel solo angosta la silueta
 *    VISIBLE cerca del frente, nunca la cavidad oculta, ver
 *    body/standard.ts), así que no cambia con `plateInsetMm`.
 *  - z = depthMm-insertDepth (tapa de la punta del labio): cierra el
 *    extremo que entra en la cavidad, mirando hacia -Z.
 *
 * Todas las piezas comparten coordenadas exactas en cada frontera (misma
 * grilla + jitter determinístico que ya suelda el cuerpo), así que el
 * resultado es un único componente conectado, sin booleana 3D. Para un
 * trazo anular (p.ej. "O") el anillo del labio da naturalmente 2 bandas
 * separadas (una por borde de la cavidad) y la repisa da 3 regiones
 * separadas (borde exterior, centro vacío, borde del counter) — mismo
 * mecanismo de multi-ContourGroup que ya usa el resto del pipeline (p.ej.
 * "STAMPA" con 6 letras), sin lógica especial.
 *
 * Calcula placa y labio en el MISMO loop por contorno original (no dos
 * pasadas independientes): el labio depende de la cavidad real (`group` sin
 * modificar), la placa depende de `plateInsetMm` (bisel) — ambos por
 * separado, pero la "repisa" (huella de la placa MENOS el anillo del labio)
 * necesita las dos huellas del MISMO contorno para no desalinearse (si el
 * inset de bisel dividiera un contorno en más de una región, cada región
 * sigue viniendo del mismo `group`, así que la resta sigue siendo
 * consistente).
 */
function buildInteriorLipLid(
  contourGroups: ContourGroup[],
  params: LetterSignParams,
  insertDepthUsedMm: number,
  plateInsetMm: number,
): LidResult {
  const allPlateGroups: ContourGroup[] = [];
  const allLipGroups: ContourGroup[] = [];
  const plateShelfGroups: ContourGroup[] = [];
  let lipCollapsed = false;

  for (const group of contourGroups) {
    const plateFootprint = footprintAtOffset(group, -plateInsetMm);
    allPlateGroups.push(...plateFootprint);

    const fit = fitInteriorLip(group, params.wallMm, params.clearanceMm, params.lipWallMm, insertDepthUsedMm);
    if (fit.collapsed) {
      lipCollapsed = true;
      // Sin labio para este contorno: la placa queda maciza en esa zona
      // (mismo resultado que la tapa plana ahí), en vez de romper.
      plateShelfGroups.push(...plateFootprint);
      continue;
    }
    allLipGroups.push(...fit.groups);
    plateShelfGroups.push(...differenceContourGroups(plateFootprint, fit.rawPaths));
  }

  const plateArea = Math.abs(clipperPathsArea(contourGroupsToRawPaths(allPlateGroups)));
  if (plateInsetMm > 1e-6 && plateArea < MIN_PLATE_AREA_MM2) {
    return { lid: null, lipCollapsed, plateCollapsed: true };
  }

  const z0 = params.depthMm - insertDepthUsedMm;
  const pieces: ExtrudedMeshData[] = [
    extrudeContourGroups(allPlateGroups, params.depthMm, params.depthMm + params.lidMm, { capStart: false, capEnd: true }),
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
  return { lid, lipCollapsed, plateCollapsed: false };
}
