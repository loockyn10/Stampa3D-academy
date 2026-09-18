import type { ContourGroup, LetterSignParams, SignPart } from "@/lib/maker/types";
import { toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";
import { buildLid } from "@/lib/maker/geometry/lid";
import { buildPerforatedFrontParts } from "@/lib/maker/geometry/front/perforated";
import { computeChannelFootprint, buildChannelDiffuserPart } from "@/lib/maker/geometry/front/lightChannel";

export interface BuildFrontPartsResult {
  /** Piezas del sistema de frente de UN carácter (vacío para frente abierto). Nunca incluye "body". */
  parts: SignPart[];
  /**
   * Código de error si el sistema de frente no pudo generarse
   * correctamente para este carácter con los parámetros actuales — `null`
   * si todo OK. "LIP_COLLAPSED": el labio del encastre desapareció (solo
   * lidJoint === "interior-lip"). "CHANNEL_COLLAPSED": el canal luminoso
   * desapareció (trazo demasiado fino, solo frontType === "light-channel").
   * Ver createLetterGeometry.ts: un código acá se traduce en un ERROR por
   * letra, nunca en geometría corrupta silenciosa.
   */
  collapseErrorCode: "LIP_COLLAPSED" | "CHANNEL_COLLAPSED" | "BEVEL_PLATE_COLLAPSED" | "MASK_SKIRT_COLLAPSED" | null;
}

/**
 * Concepto FRONT SYSTEM: arma las piezas de frente de UN carácter a partir
 * de sus contornos crudos (mismos `contourGroups` que ya procesa `body/`,
 * ver createLetterGeometry.ts). Único `switch (params.frontType)` de todo
 * el proyecto para decidir QUÉ PIEZAS agregar — agregar un futuro sistema
 * de frente es sumar un caso acá y su propio módulo bajo `front/`, nunca un
 * `if (frontType === ...)` en el resto del pipeline, los exportadores o el
 * viewport (esos consumen `SignPart[]` genérico).
 *
 * "open" no genera ninguna pieza (el cuerpo ya queda con el frente abierto
 * por su cuenta, sin cambios). "lid" delega en geometry/lid.ts (tapa plana
 * o encastrable, sin cambios de comportamiento — ver docs/STAMPA_MAKER.md
 * secciones 11/12) y envuelve el resultado en una SignPart de kind "lid".
 * "perforated" (0.4 Etapa 5) delega en front/perforated.ts. "light-channel"
 * (0.4 Etapa 6) delega en front/lightChannel.ts para el difusor — el canal
 * en sí se talla en el cuerpo (body/standard.ts es la única excepción
 * documentada a "body no conoce frontType", ver su comentario).
 */
export function buildFrontParts(
  contourGroups: ContourGroup[],
  params: LetterSignParams,
  insertDepthUsedMm: number,
  maskSideDepthUsedMm: number,
): BuildFrontPartsResult {
  switch (params.frontType) {
    case "open":
      return { parts: [], collapseErrorCode: null };
    case "lid": {
      const lidResult = buildLid(contourGroups, params, insertDepthUsedMm);
      const parts: SignPart[] = lidResult.lid
        ? [{ kind: "lid", filenameSuffix: "tapa", mesh: toTriangleSoupData(lidResult.lid) }]
        : [];
      // plateCollapsed (0.4.1: el bisel frontal erosionó toda la tapa) se
      // reporta antes que lipCollapsed — sin placa no hay nada que
      // exportar, el mensaje de labio sería confuso/redundante ahí.
      const collapseErrorCode = lidResult.plateCollapsed ? "BEVEL_PLATE_COLLAPSED" : lidResult.lipCollapsed ? "LIP_COLLAPSED" : null;
      return { parts, collapseErrorCode };
    }
    case "perforated": {
      const perforatedResult = buildPerforatedFrontParts(contourGroups, params, maskSideDepthUsedMm);
      return { parts: perforatedResult.parts, collapseErrorCode: perforatedResult.skirtCollapsed ? "MASK_SKIRT_COLLAPSED" : null };
    }
    case "light-channel": {
      const allChannelGroups: ContourGroup[] = [];
      let anyCollapsed = false;
      for (const group of contourGroups) {
        const channel = computeChannelFootprint(group, params.channelOffsetMm, params.channelWidthMm);
        if (channel.collapsed) {
          anyCollapsed = true;
          continue;
        }
        allChannelGroups.push(...channel.channelGroups);
      }
      const diffuserPart = buildChannelDiffuserPart(allChannelGroups, params);
      return { parts: [diffuserPart], collapseErrorCode: anyCollapsed ? "CHANNEL_COLLAPSED" : null };
    }
  }
}
