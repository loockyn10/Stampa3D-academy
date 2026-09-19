import type { ContourGroup, LetterSignParams, SignPart } from "@/lib/maker/types";
import { extrudeContourGroups, type ExtrudedMeshData, toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";
import { differenceContourGroups, contourGroupsToRawPaths, clipperPathsArea } from "@/lib/maker/geometry/offsets";
import { footprintAtOffset } from "@/lib/maker/geometry/body/shared";
import { punchCirclePattern } from "@/lib/maker/geometry/patterns/circles";
import { computePlateBevelBand, plateBevelTopFootprint, buildBeveledPlateWallAndTopCap } from "@/lib/maker/geometry/plateBevel";

const MIN_SKIRT_AREA_MM2 = 1e-4;
const MIN_DIFFUSER_TOP_AREA_MM2 = 1e-4;

export interface PerforatedFrontResult {
  /** diffuser + mask, SIEMPRE 2 piezas separadas (ver docs/STAMPA_MAKER.md). */
  parts: SignPart[];
  /** true si el faldón lateral no se pudo generar (ring vacío) en alguna zona del contorno, con maskSideDepthUsedMm > 0. */
  skirtCollapsed: boolean;
  /** true si el bisel de difusor (0.4.2, ver geometry/plateBevel.ts) erosionó por completo su cara visible en alguna letra. NUNCA aplica a la máscara. */
  diffuserBevelCollapsed: boolean;
}

/**
 * Frente perforado (0.4 Etapa 5, máscara-carcasa 0.4.1 corrección 4B):
 * máscara opaca (cara perforada + faldón lateral, UNA sola pieza soldada) +
 * difusor plano detrás, SIEMPRE 2 piezas separadas entre sí — nunca
 * fusionadas ni con el cuerpo, mismo mecanismo que la tapa (ver
 * geometry/lid.ts). Orden Z (assembled, sin cambios 0.4.1: solo el offset
 * EXPLOSIONADO del viewport estaba invertido, ver MakerViewport.tsx) desde
 * el cuerpo hacia el observador: difusor (pegado al cuerpo, en depthMm),
 * máscara (más lejos, la pieza más externa).
 *
 * El difusor sigue la silueta COMPLETA de la letra SIN cambios (misma
 * silueta que 0.4: exterior menos huecos ORIGINALES del glifo, nunca un
 * disco, sin faldón ni holgura — el faldón es exclusivo de la máscara) y no
 * tiene perforaciones.
 *
 * La máscara pasa de ser una placa plana a una CARCASA que también cubre el
 * lateral del cuerpo con holgura (`maskClearanceMm`), como una tapa/carcasa
 * que "abraza" el cuerpo:
 *
 *  - `outerGroups`/`innerGroups`: la silueta de cada contorno original
 *    crecida uniformemente (`footprintAtOffset`/`outsetContourGroups`,
 *    mismo mecanismo que costillas/tapered — afecta exterior Y counters a
 *    la vez, nunca un bounding box) por `maskClearanceMm +
 *    maskWallThicknessMm` (outer) y por `maskClearanceMm` solamente
 *    (inner). La CARA frontal perforada usa `outerGroups` (la huella más
 *    grande: cubre exterior Y counters con holgura+espesor de pared).
 *  - `skirtRingGroups` (el faldón): el ANILLO entre `outerGroups` e
 *    `innerGroups` (`differenceContourGroups`, SIN limpiar su salida — a
 *    propósito, igual que el resto del pipeline: preserva coordenadas
 *    exactas para soldar, ver docs/STAMPA_MAKER.md sección 3). Para un
 *    trazo anular (p.ej. "O") esto da naturalmente 2 bandas — un marco
 *    hugging el exterior Y otro hugging el counter — mismo patrón
 *    multi-ContourGroup que ya usa el resto del pipeline (labio interior,
 *    costillas), sin lógica especial por letra: así el faldón cubre
 *    "perímetro exterior; concavidades; counters/interiores" sin
 *    distinguir casos.
 *  - El faldón se extruye desde `maskSideDepthUsedMm` hacia atrás del frente
 *    del cuerpo hasta `maskZ0` (donde empieza la cara), CON tapa en AMBOS
 *    extremos (`capStart`+`capEnd`): es un ANILLO (footprint con "hoyo"),
 *    no un disco, así que necesita su propia tapa en cada extremo para ser
 *    watertight por sí solo — la tapa de la cara (que cubre el disco
 *    COMPLETO de `outerGroups`, incluida el área que ocupa el faldón)
 *    termina coincidiendo exactamente con la tapa superior del faldón en
 *    z=maskZ0: redundante (dos superficies exactamente en el mismo plano)
 *    pero no rompe manifold/watertight, mismo criterio que el resto de las
 *    piezas del frente — cuerpo/tapa/máscara/difusor se TOCAN sin fusionarse
 *    a propósito (ver docs/STAMPA_MAKER.md). Lo que sí conecta cara y
 *    faldón en 1 solo componente son las coordenadas EXACTAMENTE
 *    compartidas del borde exterior/de cada counter en z=maskZ0
 *    (`skirtRingGroups` reusa las mismas coordenadas de `outerGroups`,
 *    nunca recalculadas después de perforar — la perforación
 *    (`punchCirclePattern`) nunca toca esos bordes gracias al margen de
 *    seguridad ya existente, `edgeMarginMm + holeDiameterMm/2`, y ya no
 *    limpia su salida con `CleanPolygons`, ver patterns/circles.ts).
 *
 * Las perforaciones (`punchCirclePattern`) se aplican SOLO a `outerGroups`
 * (la cara): el faldón nunca se perfora, a propósito (spec 0.4.1: "las
 * perforaciones pertenecen únicamente a la cara frontal").
 */
export function buildPerforatedFrontParts(
  contourGroups: ContourGroup[],
  params: LetterSignParams,
  maskSideDepthUsedMm: number,
  lidBevelDepthUsedMm: number,
): PerforatedFrontResult {
  const diffuserZ0 = params.depthMm;
  const diffuserZ1 = diffuserZ0 + params.diffuserThicknessMm;
  // Bisel de difusor (0.4.2, ver geometry/plateBevel.ts): NUNCA aplica a la
  // máscara (tiene su propia geometría de carcasa, ver más abajo) — solo al
  // difusor plano, misma silueta completa de siempre (exterior menos huecos
  // ORIGINALES del glifo, sin holgura ni faldón).
  const diffuserBevelBand = computePlateBevelBand(diffuserZ0, diffuserZ1, params.lidBevelEnabled, lidBevelDepthUsedMm);
  const diffuserPieces: ExtrudedMeshData[] = diffuserBevelBand
    ? [extrudeContourGroups(contourGroups, diffuserZ0, diffuserZ0, { capStart: true, capEnd: false, sides: false })]
    : [];
  let diffuserBevelCollapsed = false;
  for (const g of contourGroups) {
    const group: ContourGroup = { outer: g.outer, holes: g.holes };
    if (!diffuserBevelBand) {
      diffuserPieces.push(extrudeContourGroups([group], diffuserZ0, diffuserZ1, { capStart: true, capEnd: true }));
      continue;
    }
    // Igual criterio que LIP_COLLAPSED (joints/interiorLip.ts): el difusor
    // es una pieza OBLIGATORIA del frente perforado (siempre 2 piezas, ver
    // docs/STAMPA_MAKER.md), así que un contorno donde el bisel erosiona la
    // cara visible por completo degrada a difusor plano SOLO en esa zona
    // (en vez de descartar la pieza entera) — el error igual bloquea la
    // exportación hasta que se ajusten los parámetros.
    const topFootprint = plateBevelTopFootprint(group, diffuserBevelBand, params.lidBevelInsetMm);
    const collapsedHere =
      params.lidBevelInsetMm > 1e-6 && Math.abs(clipperPathsArea(contourGroupsToRawPaths(topFootprint))) < MIN_DIFFUSER_TOP_AREA_MM2;
    if (collapsedHere) {
      diffuserBevelCollapsed = true;
      diffuserPieces.push(buildBeveledPlateWallAndTopCap(group, diffuserZ0, diffuserZ1, null, 0));
    } else {
      diffuserPieces.push(buildBeveledPlateWallAndTopCap(group, diffuserZ0, diffuserZ1, diffuserBevelBand, params.lidBevelInsetMm));
    }
  }
  const diffuser: ExtrudedMeshData = {
    positions: diffuserPieces.flatMap((p) => p.positions),
    normals: diffuserPieces.flatMap((p) => p.normals),
  };

  const clearance = params.maskClearanceMm;
  const wallThickness = params.maskWallThicknessMm;
  const outerGroups: ContourGroup[] = [];
  const innerGroups: ContourGroup[] = [];
  const skirtRingGroups: ContourGroup[] = [];
  for (const group of contourGroups) {
    const outer = footprintAtOffset(group, clearance + wallThickness);
    const inner = footprintAtOffset(group, clearance);
    outerGroups.push(...outer);
    innerGroups.push(...inner);
    skirtRingGroups.push(...differenceContourGroups(outer, contourGroupsToRawPaths(inner)));
  }

  const skirtArea = Math.abs(clipperPathsArea(contourGroupsToRawPaths(skirtRingGroups)));
  const skirtCollapsed = maskSideDepthUsedMm > 1e-6 && skirtArea < MIN_SKIRT_AREA_MM2;

  const maskFaceGroups = punchCirclePattern(outerGroups, {
    holeDiameterMm: params.holeDiameterMm,
    pitchMm: params.pitchMm,
    edgeMarginMm: params.edgeMarginMm,
  });
  const maskZ0 = diffuserZ1;
  const maskZ1 = maskZ0 + params.maskThicknessMm;

  const maskPieces: ExtrudedMeshData[] = [extrudeContourGroups(maskFaceGroups, maskZ0, maskZ1, { capStart: true, capEnd: true })];

  if (maskSideDepthUsedMm > 1e-6 && !skirtCollapsed) {
    const skirtZ1 = maskZ0;
    const skirtZ0 = Math.max(0, params.depthMm - maskSideDepthUsedMm);
    // El faldón es un ANILLO (huella con "hoyo", ver skirtRingGroups), no un
    // disco: necesita su PROPIA tapa en AMBOS extremos para quedar
    // watertight por sí solo. La tapa de la cara (`capStart` de
    // `facePieces`) cubre el disco COMPLETO de `outerGroups` — incluida el
    // área del faldón — así que en z=maskZ0 quedan dos superficies
    // exactamente coincidentes ahí (la tapa de la cara y la tapa superior
    // del faldón): redundante pero NO rompe manifold/watertight (cada pieza
    // es cerrada por sí sola, mismo criterio que cuerpo/tapa/máscara/
    // difusor — piezas que se TOCAN sin fusionarse — ver docs/STAMPA_MAKER.md).
    // Lo que si suelda de verdad es el borde EXTERIOR/de cada counter en
    // z=maskZ0 (`skirtRingGroups` reusa las mismas coordenadas exactas de
    // `outerGroups`, nunca recalculadas después de perforar): por eso
    // cuentan como 1 solo componente conectado.
    maskPieces.push(extrudeContourGroups(skirtRingGroups, skirtZ0, skirtZ1, { capStart: true, capEnd: true, sides: true }));
  }

  const mask: ExtrudedMeshData = {
    positions: maskPieces.flatMap((p) => p.positions),
    normals: maskPieces.flatMap((p) => p.normals),
  };

  return {
    parts: [
      { kind: "diffuser", filenameSuffix: "difusor", mesh: toTriangleSoupData(diffuser) },
      { kind: "mask", filenameSuffix: "mascara", mesh: toTriangleSoupData(mask) },
    ],
    skirtCollapsed,
    diffuserBevelCollapsed,
  };
}
