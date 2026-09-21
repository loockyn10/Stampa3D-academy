import type { Point2D } from "@/lib/maker/types";

/**
 * Fuente de píxeles 3x5 mínima para las etiquetas impresas en relieve ("+", "-",
 * "IN", "OUT"). Cada píxel es un cuadrado de `LABEL_PIXEL_MM`: geometría muy
 * simple (rectángulos que se unen con Clipper), sin cargar fuentes ni curvas.
 */
export const LABEL_PIXEL_MM = 0.8;
export const LABEL_HEIGHT_MM = 0.6;

const GLYPHS: Record<string, string[]> = {
  "+": [".#.", ".#.", "###", ".#.", ".#."],
  "-": ["...", "...", "###", "...", "..."],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  N: ["#.#", "###", "###", "#.#", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
};

export function supportedLabelText(text: string): boolean {
  return text.length > 0 && [...text].every((c) => c in GLYPHS);
}

/** Ancho total del texto en mm (3 px por glifo + 1 px de separación). */
export function textWidthMm(text: string): number {
  return (text.length * 4 - 1) * LABEL_PIXEL_MM;
}

/** Cuadrados (píxeles encendidos) del texto centrado en (cx, cy), sin rotar. */
export function glyphPolygons(text: string, cx: number, cy: number): Point2D[][] {
  if (!supportedLabelText(text)) return [];
  const px = LABEL_PIXEL_MM;
  const width = textWidthMm(text);
  const x0 = cx - width / 2;
  const y0 = cy + (5 * px) / 2;
  const polys: Point2D[][] = [];
  [...text].forEach((ch, gi) => {
    GLYPHS[ch].forEach((row, r) => {
      [...row].forEach((cell, c) => {
        if (cell !== "#") return;
        const x = x0 + (gi * 4 + c) * px;
        const y = y0 - (r + 1) * px;
        polys.push([[x, y], [x + px, y], [x + px, y + px], [x, y + px]]);
      });
    });
  });
  return polys;
}
