import type { ContourGroup, LetterSignParams, SignPart } from "@/lib/maker/types";
import { insetContourGroups, differenceRawPaths, regroupClipperSolution, clipperPathsArea } from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups, toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";

const MIN_CHANNEL_AREA_MM2 = 1e-4;

export interface ChannelFootprint {
  /** Huella del canal (anillo entre channelOffsetMm y channelOffsetMm+channelWidthMm). Vacío si collapsed. */
  channelGroups: ContourGroup[];
  collapsed: boolean;
}

/**
 * Huella 2D del canal luminoso de UN contorno del cuerpo (letra o
 * sub-forma): mismo mecanismo que ya usa el cuerpo para su propia pared
 * (`ink - inset(ink, wallMm)`, ver body/standard.ts) — acá aplicado dos
 * veces para quedarse con el ANILLO entre `channelOffsetMm` y
 * `channelOffsetMm+channelWidthMm`. Funciona igual para exterior, huecos y
 * múltiples islas, sin lógica especial por letra.
 *
 * Colapsa (no genera el canal) si el anillo resultante tiene área
 * despreciable: un trazo demasiado fino para el ancho de canal pedido —
 * ver createLetterGeometry.ts, CHANNEL_COLLAPSED (error, bloquea
 * exportación, nunca geometría corrupta).
 */
export function computeChannelFootprint(group: ContourGroup, channelOffsetMm: number, channelWidthMm: number): ChannelFootprint {
  const outerRaw = insetContourGroups([group], channelOffsetMm);
  const innerRaw = insetContourGroups([group], channelOffsetMm + channelWidthMm);
  const channelRawPaths = differenceRawPaths(outerRaw, innerRaw);
  const area = Math.abs(clipperPathsArea(channelRawPaths));
  if (area < MIN_CHANNEL_AREA_MM2) return { channelGroups: [], collapsed: true };
  const channelGroups = regroupClipperSolution(channelRawPaths);
  if (channelGroups.length === 0) return { channelGroups: [], collapsed: true };
  return { channelGroups, collapsed: false };
}

/**
 * Difusor del canal: sigue EXACTAMENTE la huella del canal (agregada de
 * todos los contornos de la letra), con `diffuserClearanceMm` de holgura
 * por lado (mismo mecanismo `insetContourGroups` que ya usa la holgura del
 * labio interior) — nunca cubre la letra completa, es una pieza
 * independiente a ras del frente, dejando el resto de la profundidad del
 * canal libre para LEDs.
 */
export function buildChannelDiffuserPart(allChannelGroups: ContourGroup[], params: LetterSignParams): SignPart {
  const diffuserGroups = allChannelGroups.length > 0
    ? regroupClipperSolution(insetContourGroups(allChannelGroups, params.diffuserClearanceMm))
    : [];
  const z1 = params.depthMm;
  const z0 = z1 - params.diffuserThicknessMm;
  const mesh = extrudeContourGroups(diffuserGroups, z0, z1, { capStart: true, capEnd: true });
  return { kind: "channelDiffuser", filenameSuffix: "difusor_canal", mesh: toTriangleSoupData(mesh) };
}
