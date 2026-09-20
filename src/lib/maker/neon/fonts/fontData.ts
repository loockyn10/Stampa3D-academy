/**
 * Formato de datos de una fuente single-line preprocesada (ver scripts/build-neon-fonts.mjs).
 * Coordenadas en unidades de fuente, Y hacia arriba, línea base en y = 0.
 */
export interface NeonFontData {
  unitsPerEm: number;
  /** Altura de mayúscula: referencia de escala ("Alto del diseño"). */
  capHeight: number;
  /** Solo si se calibró: el capHeight que declara la fuente original (referencia; no se usa para escalar). */
  declaredCapHeight?: number;
  xHeight: number;
  /** Carácter -> [avance horizontal, path data SVG (M/L/C, o relativos en Relief)]. Espacio: path vacío. */
  glyphs: Record<string, [number, string]>;
  /** "AV" -> ajuste de avance entre ese par (unidades de fuente). Solo pares con valor distinto de 0. */
  kerning: Record<string, number>;
}
