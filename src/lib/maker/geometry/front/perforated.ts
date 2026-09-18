import type { ContourGroup, LetterSignParams, SignPart } from "@/lib/maker/types";
import { extrudeContourGroups, toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";
import { punchCirclePattern } from "@/lib/maker/geometry/patterns/circles";

/**
 * Frente perforado (0.4 Etapa 5): máscara opaca con perforaciones + difusor
 * plano detrás, SIEMPRE 2 piezas separadas — nunca fusionadas entre sí ni
 * con el cuerpo, mismo mecanismo que la tapa (ver geometry/lid.ts). Orden
 * desde el observador hacia el cuerpo: máscara (más lejos), difusor (pegado
 * al cuerpo, en depthMm).
 *
 * El difusor sigue la silueta COMPLETA de la letra (misma silueta que la
 * tapa plana — exterior menos huecos ORIGINALES del glifo, nunca un disco)
 * y no tiene perforaciones. La máscara usa la misma silueta, perforada por
 * `patterns/circles.ts`.
 */
export function buildPerforatedFrontParts(contourGroups: ContourGroup[], params: LetterSignParams): SignPart[] {
  const plateGroups: ContourGroup[] = contourGroups.map((g) => ({ outer: g.outer, holes: g.holes }));

  const diffuserZ0 = params.depthMm;
  const diffuserZ1 = diffuserZ0 + params.diffuserThicknessMm;
  const diffuser = extrudeContourGroups(plateGroups, diffuserZ0, diffuserZ1, { capStart: true, capEnd: true });

  const maskGroups = punchCirclePattern(plateGroups, {
    holeDiameterMm: params.holeDiameterMm,
    pitchMm: params.pitchMm,
    edgeMarginMm: params.edgeMarginMm,
  });
  const maskZ0 = diffuserZ1;
  const maskZ1 = maskZ0 + params.maskThicknessMm;
  const mask = extrudeContourGroups(maskGroups, maskZ0, maskZ1, { capStart: true, capEnd: true });

  return [
    { kind: "diffuser", filenameSuffix: "difusor", mesh: toTriangleSoupData(diffuser) },
    { kind: "mask", filenameSuffix: "mascara", mesh: toTriangleSoupData(mask) },
  ];
}
