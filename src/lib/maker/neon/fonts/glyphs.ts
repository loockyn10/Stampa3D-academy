/**
 * "Stampa Neon Línea": fuente de TRAZOS (single-line) propia de Stampa, dibujada
 * para este proyecto (sin datos de terceros: no hay licencia que atribuir).
 *
 * Cada glifo es el recorrido central que seguirá el Neon Flex, expresado como
 * `d` de un <path> SVG (M L C A Z...) en unidades de fuente, Y HACIA ARRIBA:
 *   - baseline en y = 0, altura de mayúscula = 100 (CAP_HEIGHT);
 *   - x = 0 es el borde izquierdo del glifo; `width` es su extensión en x.
 * Los arcos `A` usan la convención SVG sobre estas coordenadas crudas: con Y
 * arriba, sweep=1 gira en sentido antihorario.
 *
 * Un glifo puede tener varios trazos (subpaths `M`): p.ej. la "A" son los dos
 * lados más el travesaño. Un subpath terminado en `Z` es un recorrido cerrado
 * (la "O", el "0", la "D"): el canal forma un lazo sin tapas.
 *
 * Agregar más caracteres es sumar una entrada; agregar otra fuente (Hershey u
 * otra) es registrar otro `NeonFontDefinition` en fonts/neonFonts.ts.
 */
export interface NeonGlyph {
  /** Extensión horizontal del glifo (unidades de fuente). */
  width: number;
  /** Trazos del glifo (path data SVG). */
  d: string;
}

export const CAP_HEIGHT = 100;
/** Separación entre glifos consecutivos. */
export const GLYPH_GAP = 30;
export const SPACE_ADVANCE = 55;

const oval = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx} ${cy - ry} A${rx} ${ry} 0 0 1 ${cx} ${cy + ry} A${rx} ${ry} 0 0 1 ${cx} ${cy - ry} Z`;

export const GLYPHS: Record<string, NeonGlyph> = {
  A: { width: 60, d: "M0 0 L30 100 L60 0 M12 40 L48 40" },
  B: { width: 56, d: "M0 0 L0 100 L30 100 A22 24 0 0 0 30 52 L0 52 M30 52 A26 26 0 0 0 30 0 L0 0" },
  C: { width: 53, d: "M53 82 A30 50 0 1 1 53 18" },
  D: { width: 56, d: "M0 0 L0 100 L20 100 A36 50 0 0 0 20 0 Z" },
  E: { width: 50, d: "M50 100 L0 100 L0 0 L50 0 M0 50 L40 50" },
  F: { width: 50, d: "M50 100 L0 100 L0 0 M0 50 L40 50" },
  G: { width: 60, d: "M53 82 A30 50 0 1 1 60 50 L34 50" },
  H: { width: 56, d: "M0 0 L0 100 M56 0 L56 100 M0 50 L56 50" },
  I: { width: 0, d: "M0 0 L0 100" },
  J: { width: 40, d: "M40 100 L40 30 A20 30 0 0 0 0 30" },
  K: { width: 52, d: "M0 0 L0 100 M50 100 L0 35 M16 52 L52 0" },
  L: { width: 45, d: "M0 100 L0 0 L45 0" },
  M: { width: 60, d: "M0 0 L0 100 L30 40 L60 100 L60 0" },
  N: { width: 56, d: "M0 0 L0 100 L56 0 L56 100" },
  O: { width: 60, d: oval(30, 50, 30, 50) },
  P: { width: 56, d: "M0 0 L0 100 L30 100 A26 26 0 0 0 30 48 L0 48" },
  Q: { width: 60, d: `${oval(30, 50, 30, 50)} M38 22 L58 -6` },
  R: { width: 56, d: "M0 0 L0 100 L30 100 A26 26 0 0 0 30 48 L0 48 M28 48 L56 0" },
  S: {
    width: 54,
    d: "M52 80 C48 96 38 100 28 100 C12 100 2 90 2 76 C2 60 14 54 28 50 C42 46 54 42 54 26 C54 10 42 0 26 0 C14 0 4 6 0 20",
  },
  T: { width: 60, d: "M0 100 L60 100 M30 100 L30 0" },
  U: { width: 56, d: "M0 100 L0 28 A28 28 0 0 1 56 28 L56 100" },
  V: { width: 60, d: "M0 100 L30 0 L60 100" },
  W: { width: 60, d: "M0 100 L15 0 L30 60 L45 0 L60 100" },
  X: { width: 56, d: "M0 0 L56 100 M0 100 L56 0" },
  Y: { width: 56, d: "M0 100 L28 50 L56 100 M28 50 L28 0" },
  Z: { width: 52, d: "M0 100 L52 100 L0 0 L52 0" },

  "0": { width: 50, d: oval(25, 50, 25, 50) },
  "1": { width: 22, d: "M0 78 L22 100 L22 0" },
  "2": { width: 56, d: "M2 76 C6 94 16 100 28 100 C44 100 54 88 54 72 C54 50 24 30 0 0 L56 0" },
  "3": {
    width: 54,
    d: "M2 84 C8 96 18 100 28 100 C42 100 52 92 52 78 C52 62 40 54 24 54 C42 54 54 46 54 28 C54 10 42 0 26 0 C12 0 4 6 0 18",
  },
  "4": { width: 56, d: "M42 0 L42 100 L0 30 L56 30" },
  "5": { width: 54, d: "M50 100 L6 100 L2 54 C10 60 18 62 28 62 C44 62 54 52 54 34 C54 14 42 0 26 0 C12 0 4 6 0 18" },
  "6": {
    width: 54,
    d: "M48 94 C42 99 35 100 28 100 C6 100 0 66 0 30 M0 30 A27 30 0 0 0 54 30 A27 30 0 0 0 0 30 Z",
  },
  "7": { width: 56, d: "M0 100 L56 100 L20 0" },
  "8": { width: 54, d: `${oval(26, 76, 24, 24)} ${oval(26, 26, 28, 26)}` },
  "9": {
    width: 54,
    d: "M6 6 C12 1 19 0 26 0 C48 0 54 34 54 70 M0 70 A27 30 0 0 0 54 70 A27 30 0 0 0 0 70 Z",
  },

  ".": { width: 0, d: "M0 0 L0 5" },
  ",": { width: 6, d: "M6 7 L0 -14" },
  "-": { width: 36, d: "M0 50 L36 50" },
  "_": { width: 50, d: "M0 -10 L50 -10" },
  "!": { width: 0, d: "M0 100 L0 30 M0 0 L0 5" },
  "?": { width: 50, d: "M0 76 C0 94 12 100 26 100 C40 100 50 92 50 78 C50 60 26 54 26 34 M26 0 L26 5" },
  ":": { width: 0, d: "M0 66 L0 72 M0 20 L0 26" },
  "+": { width: 40, d: "M0 50 L40 50 M20 30 L20 70" },
  "=": { width: 40, d: "M0 38 L40 38 M0 62 L40 62" },
  "/": { width: 40, d: "M0 0 L40 100" },
  "'": { width: 0, d: "M0 100 L0 72" },
};

/** Marcas combinantes (NFD) soportadas como trazos sobre la letra base; el resto de marcas se descarta. Coordenadas relativas al CENTRO del glifo base. */
export const ACCENT_STROKES: Record<string, string> = {
  "́": "M-7 108 L7 124", // acento agudo
  "̀": "M-7 124 L7 108", // acento grave
  "̃": "M-14 112 C-8 124 -2 124 0 116 C2 108 8 108 14 120", // tilde (Ñ)
  "̈": "M-10 112 L-10 117 M10 112 L10 117", // diéresis
};
