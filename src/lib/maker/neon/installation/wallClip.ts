// NeonWallClip (Secciones 27-34 del pedido de Instalación 0.3): pieza imprimible
// INDEPENDIENTE del STL principal del Neon. Se atornilla a la pared, sostiene el canal
// U separado de ella por `wallGapMm` (deja lugar al cableado/pass-through) y lo retiene
// con labios flexibles suaves (no snap agresivo). Deriva por completo de la sección del
// canal (`NeonChannelParams`) + `NeonWallClipSettings`: es una función PURA, se
// regenera sola cuando cambian los parámetros, sin paso manual.
//
// Geometría (local, "impreso con la base contra la cama", mismo criterio que
// wallSpacer.ts — eje Z = alejándose de la pared):
//
//   Z (aleja de la pared)
//   ▲
//   │   ╭┐            ╭┐   ← pestañas de retención (voladizo corto, igual que spliceClip.ts)
//   │  ╭┤├────────────┤├╮
//   │  │└──── bolsillo ┘│  ← rieles del bolsillo (recibe el canal, presionando hacia -Z)
//   │  └──────┬─┬───────┘
//   │         │ │            ← poste (alto = wallGapMm)
//   │  ┌──────┴─┴──────┬───┐
//   │  │  placa base   │ ⊙ │ ← agujero de tornillo, en una "oreja" que sobresale
//   │  └────────────────────┘   (nada por encima: acceso libre con el destornillador)
//   └──────────────────────────► Y (ancho del canal)
//  (X = a lo largo del canal, "profundidad" del clip — constante en todos los niveles)
//
// Mismo mecanismo sin CSG que wallSpacer.ts/spliceClip.ts: huellas 2D apiladas y
// soldadas por capas (`installation/prismStack.ts`, reusado tal cual).
import type { ContourGroup, Point2D, TriangleSoupData } from "@/lib/maker/types";
import { circlePolygon } from "@/lib/maker/geometry/backCutouts";
import { contourGroupsToRawPaths, differenceContourGroups } from "@/lib/maker/geometry/offsets";
import { toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";
import { buildPrismStack, normalizePolygons, rectPolygon, type PrismLayer } from "@/lib/maker/installation/prismStack";
import { channelOuterWidth } from "@/lib/maker/neon/defaults";
import type { NeonChannelParams } from "@/lib/maker/neon/types";
import type { NeonAuxPart, NeonWallClipSettings } from "@/lib/maker/neon/installation/types";

export const NEON_WALL_CLIP_FILE_BASE_NAME = "neon-wall-clip";

/** Mismo valor que ya probó ser una retención suave y imprimible en `spliceClip.ts`. */
const RAIL_TAB_OVERHANG_MM = 0.4;
const RAIL_TAB_THICKNESS_MM = 0.8;
const SCREW_HEAD_RECESS_MAX_MM = 3;
/** Solape real (no solo tangencia) entre la placa base y la "oreja" del tornillo, para que el Clipper de `normalizePolygons` no deje un pellizco al unirlas. */
const EAR_OVERLAP_MM = 0.5;

/** Alto total del canal (piso + pared), lo que el bolsillo debe recibir. */
function channelHeightMm(channelParams: NeonChannelParams): number {
  return channelParams.floorThicknessMm + channelParams.wallHeightMm;
}

/** Errores de parámetros (vacío = válido). No mira compatibilidad con un montaje específico, solo que las medidas tengan sentido entre sí. */
export function validateNeonWallClip(channelParams: NeonChannelParams, s: NeonWallClipSettings): string[] {
  const errors: string[] = [];
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (!positive(s.clipWallThicknessMm) || !positive(s.clipDepthMm) || !positive(s.screwShankDiameterMm)) {
    errors.push("El espesor, la profundidad y el diámetro de tornillo del clip deben ser mayores a 0.");
  }
  if (!Number.isFinite(s.clipClearanceMm) || s.clipClearanceMm < 0) errors.push("La holgura del clip no puede ser negativa.");
  if (!Number.isFinite(s.wallGapMm) || s.wallGapMm < 0 || s.wallGapMm > 20) errors.push("La separación de pared debe estar entre 0 y 20 mm.");
  if (s.screwHeadDiameterMm > 0 && s.screwHeadDiameterMm <= s.screwShankDiameterMm) errors.push("El rebaje de la cabeza del tornillo debe ser mayor que el vástago.");
  if (channelOuterWidth(channelParams) <= 0) errors.push("El ancho exterior del canal debe ser mayor a 0.");
  return errors;
}

/** Avisos no bloqueantes (p.ej. `wallGapMm` chico y el cableado detrás). Separado de `validateNeonWallClip`: son válidos para exportar, solo conviene revisarlos. */
export function neonWallClipWarnings(s: NeonWallClipSettings): string[] {
  const warnings: string[] = [];
  if (s.wallGapMm < 2) warnings.push("Con una separación de pared tan chica el cableado detrás del canal puede quedar apretado.");
  return warnings;
}

interface ClipLayout {
  halfDepth: number;
  postWidthMm: number;
  pocketWidthMm: number;
  railWidthMm: number;
  baseTop: number;
  postTop: number;
  cradleTop: number;
  railTop: number;
  screwX: number;
  earCenterX: number;
  earSpanX: number;
  earWidthMm: number;
}

function computeLayout(channelParams: NeonChannelParams, s: NeonWallClipSettings): ClipLayout {
  const pocketWidthMm = channelOuterWidth(channelParams) + s.clipClearanceMm;
  const railWidthMm = s.clipWallThicknessMm;
  const postWidthMm = pocketWidthMm + 2 * railWidthMm;
  const halfDepth = s.clipDepthMm / 2;
  const earExtraMm = Math.max(s.screwShankDiameterMm, s.screwHeadDiameterMm) + 4;
  const earX0 = halfDepth - EAR_OVERLAP_MM;
  const earX1 = halfDepth + earExtraMm;
  const baseTop = s.clipWallThicknessMm;
  const postTop = baseTop + s.wallGapMm;
  const cradleTop = postTop + channelHeightMm(channelParams) + s.clipClearanceMm;
  return {
    halfDepth,
    postWidthMm,
    pocketWidthMm,
    railWidthMm,
    baseTop,
    postTop,
    cradleTop,
    railTop: cradleTop + RAIL_TAB_THICKNESS_MM,
    screwX: halfDepth + earExtraMm / 2,
    earCenterX: (earX0 + earX1) / 2,
    earSpanX: earX1 - earX0,
    earWidthMm: Math.max(s.screwShankDiameterMm, s.screwHeadDiameterMm) + 2 * s.clipWallThicknessMm,
  };
}

function basePolygons(layout: ClipLayout): Point2D[][] {
  const underPost = rectPolygon(0, 0, layout.halfDepth * 2, layout.postWidthMm);
  const ear = rectPolygon(layout.earCenterX, 0, layout.earSpanX, layout.earWidthMm);
  return [underPost, ear];
}

function baseGroupsWithHole(layout: ClipLayout, holeD: number): ContourGroup[] {
  const outer = normalizePolygons(basePolygons(layout));
  return holeD > 0 ? differenceContourGroups(outer, contourGroupsToRawPaths(normalizePolygons([circlePolygon(layout.screwX, 0, holeD)]))) : outer;
}

/** Malla del clip (centrado en X/Y=0, apoyado en Z=0). */
export function buildNeonWallClipMesh(channelParams: NeonChannelParams, s: NeonWallClipSettings): TriangleSoupData {
  const layout = computeLayout(channelParams, s);
  const depth = layout.halfDepth * 2;

  const recessMm = s.screwHeadDiameterMm > 0 ? Math.min(SCREW_HEAD_RECESS_MAX_MM, layout.baseTop - 0.3) : 0;
  const baseLayers: PrismLayer[] =
    recessMm > 0
      ? [
          { z0: 0, z1: layout.baseTop - recessMm, groups: baseGroupsWithHole(layout, s.screwShankDiameterMm) },
          { z0: layout.baseTop - recessMm, z1: layout.baseTop, groups: baseGroupsWithHole(layout, s.screwHeadDiameterMm) },
        ]
      : [{ z0: 0, z1: layout.baseTop, groups: baseGroupsWithHole(layout, s.screwShankDiameterMm) }];

  const post: PrismLayer = { z0: layout.baseTop, z1: layout.postTop, groups: normalizePolygons([rectPolygon(0, 0, depth, layout.postWidthMm)]) };

  const railY = layout.pocketWidthMm / 2 + layout.railWidthMm / 2;
  const rails: PrismLayer = {
    z0: layout.postTop,
    z1: layout.cradleTop,
    groups: normalizePolygons([rectPolygon(0, railY, depth, layout.railWidthMm), rectPolygon(0, -railY, depth, layout.railWidthMm)]),
  };

  // Pestañas: voladizo corto hacia adentro desde cada riel, angostando la boca del bolsillo justo en la entrada (mismo criterio que spliceClip.ts).
  const tabInnerY = layout.pocketWidthMm / 2 - RAIL_TAB_OVERHANG_MM;
  const tabOuterY = layout.pocketWidthMm / 2 + layout.railWidthMm;
  const tabCenterY = (tabInnerY + tabOuterY) / 2;
  const tabs: PrismLayer = {
    z0: layout.cradleTop,
    z1: layout.railTop,
    groups: normalizePolygons([rectPolygon(0, tabCenterY, depth, tabOuterY - tabInnerY), rectPolygon(0, -tabCenterY, depth, tabOuterY - tabInnerY)]),
  };

  return toTriangleSoupData(buildPrismStack([...baseLayers, post, rails, tabs], { bottomCap: true, topCap: true }));
}

/** Alto total del clip (mm) — informativo, para UI/validación de espacio. */
export function neonWallClipHeightMm(channelParams: NeonChannelParams, s: NeonWallClipSettings): number {
  return computeLayout(channelParams, s).railTop;
}

/** Separación real (mm) entre la cara trasera del bolsillo (donde apoya el piso del canal) y la placa base — debe coincidir con `wallGapMm`. */
export function neonWallClipWallGapMm(channelParams: NeonChannelParams, s: NeonWallClipSettings): number {
  const layout = computeLayout(channelParams, s);
  return layout.postTop - layout.baseTop;
}

/**
 * Pieza auxiliar exportable (UN solo STL + cantidad): todos los clips de un proyecto
 * comparten sección de canal, así que son geométricamente idénticos — nunca se generan
 * N archivos. Vacía si el montaje no es "clips" o los parámetros no son válidos.
 */
export function buildNeonWallClipPart(channelParams: NeonChannelParams, s: NeonWallClipSettings, quantity: number): NeonAuxPart[] {
  if (quantity <= 0 || validateNeonWallClip(channelParams, s).length > 0) return [];
  return [
    {
      kind: "neonWallClip",
      filenameSuffix: "clip_pared",
      fileBaseName: NEON_WALL_CLIP_FILE_BASE_NAME,
      mesh: buildNeonWallClipMesh(channelParams, s),
      quantity,
    },
  ];
}
