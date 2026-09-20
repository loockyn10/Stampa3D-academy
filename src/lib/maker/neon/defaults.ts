import type { NeonFontId, NeonParams } from "@/lib/maker/neon/types";

/** Margen fijo (+5 %) sobre la longitud del recorrido para recomendar cuánto Neon Flex comprar. */
export const NEON_LENGTH_MARGIN = 0.05;

export const DEFAULT_NEON_TEXT = "Stampa";
export const DEFAULT_NEON_FONT_ID: NeonFontId = "mistral-singleline";
/** 0 = espaciado recomendado por la fuente. */
export const DEFAULT_LETTER_SPACING_PCT = 0;

export const DEFAULT_NEON_PARAMS: NeonParams = {
  designHeightMm: 200,
  neonWidthMm: 6,
  clearanceMm: 0.3,
  wallHeightMm: 8,
  wallThicknessMm: 1.2,
  floorThicknessMm: 1.6,
  minBendRadiusMm: 10,
};

/** Ancho interior del canal. Convención: holgura TOTAL (no por lado). */
export function channelInnerWidth(p: Pick<NeonParams, "neonWidthMm" | "clearanceMm">): number {
  return p.neonWidthMm + p.clearanceMm;
}

export function channelOuterWidth(p: Pick<NeonParams, "neonWidthMm" | "clearanceMm" | "wallThicknessMm">): number {
  return channelInnerWidth(p) + 2 * p.wallThicknessMm;
}
