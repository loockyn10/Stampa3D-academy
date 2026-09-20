import type { Point2D } from "@/lib/maker/types";
import { parsePathData, transformSubPaths, type Matrix, type SubPath } from "@/lib/maker/import/svgGeometry";
import { getNeonFont, type NeonFontDefinition } from "@/lib/maker/neon/fonts/neonFonts";
import { FLATTEN_TOLERANCE_MM, flattenSubPathToPoints, scaleToMm } from "@/lib/maker/neon/paths/flattenNeonPath";
import { NeonInputError, type NeonFontId, type NeonIssue, type NeonPath, type NeonPathsResult } from "@/lib/maker/neon/types";

/** Opciones de texto. `letterSpacingPct`: 0 = espaciado recomendado por la fuente; 100 = +¼ de la altura de mayúscula por letra. */
export interface NeonTextOptions {
  letterSpacingPct?: number;
}

export const LETTER_SPACING_MIN_PCT = -20;
export const LETTER_SPACING_MAX_PCT = 100;
const SPACING_UNIT = 0.25; // fracción de capHeight que equivale a 100 %

const pathCache = new Map<string, SubPath[]>();

function glyphSubPaths(d: string): SubPath[] {
  if (!d) return [];
  let subs = pathCache.get(d);
  if (!subs) {
    subs = parsePathData(d);
    pathCache.set(d, subs);
  }
  return subs;
}

export interface TextLayout {
  /** Trazos en unidades de fuente, Y arriba, origen en el inicio de la línea base. */
  subs: SubPath[];
  /** Caracteres sin glifo (omitidos). */
  unsupported: string[];
  /** Avance total de la línea (unidades de fuente). */
  width: number;
}

/**
 * Compone una línea de texto con una fuente de trazos: avance de cada glifo +
 * kerning del par + espaciado extra. Solo geometría (sin escalar ni aplanar);
 * la reutiliza el importador SVG para `<text>`.
 */
export function layoutNeonText(text: string, font: NeonFontDefinition, letterSpacingPct = 0): TextLayout {
  const clean = text.replace(/[\r\n\t]+/g, " ");
  const source = font.caseMode === "upper" ? clean.toLocaleUpperCase("es") : clean;
  const extra = (letterSpacingPct / 100) * SPACING_UNIT * font.capHeight;
  const shear: Matrix = [1, 0, Math.tan((font.shearDeg * Math.PI) / 180), 1, 0, 0];

  const unsupported = new Set<string>();
  const subs: SubPath[] = [];
  let cursor = 0;
  let prev: string | null = null; // último carácter dibujado (para kerning)
  let last: { x: number; width: number } | null = null; // para posicionar acentos sintetizados

  const place = (d: string, dx: number) => {
    for (const sub of transformSubPaths(glyphSubPaths(d), [1, 0, 0, 1, dx, 0])) subs.push(sub);
  };

  // Composición (NFC) primero, para que "é" encuentre su glifo precompuesto; si no existe, se descompone.
  for (const unit of source.normalize("NFC")) {
    if (unit === " ") {
      cursor += font.spaceAdvance + extra;
      prev = null;
      last = null;
      continue;
    }
    const direct = font.getGlyph(unit);
    const pieces = direct ? [unit] : [...unit.normalize("NFD")];
    for (const ch of pieces) {
      const mark = font.getAccentStroke(ch);
      if (mark !== null) {
        if (last) place(mark, last.x + last.width / 2);
        continue;
      }
      if (/[̀-ͯ]/.test(ch)) continue; // marcas combinantes sin trazo en esta fuente: se descartan
      const glyph = font.getGlyph(ch);
      if (!glyph) {
        unsupported.add(ch);
        continue;
      }
      if (prev !== null) cursor += font.getKerning(prev, ch);
      place(glyph.d, cursor);
      last = { x: cursor, width: glyph.width };
      cursor += glyph.advance + extra;
      prev = ch;
    }
  }
  return { subs: transformSubPaths(subs, shear), unsupported: [...unsupported], width: cursor };
}

/**
 * Texto -> NeonPath[] con una fuente de trazos. Cada carácter aporta uno o más
 * trazos (la "A" de Stampa Línea son dos); se conserva su posición relativa
 * dentro de la línea. Un solo renglón.
 *
 * Escala: `heightMm` es la altura de mayúscula de la fuente — la misma
 * referencia para "A" que para "-", a diferencia de la caja del recorrido, que
 * cambiaría con cada carácter. En fuentes script, las minúsculas quedan más bajas.
 */
export function textToNeonPaths(text: string, fontId: NeonFontId, heightMm: number, options: NeonTextOptions = {}): NeonPathsResult {
  if (text.trim() === "") throw new NeonInputError("EMPTY_TEXT", "Escribí un texto para generar el recorrido.");
  const font = getNeonFont(fontId);
  const scale = heightMm / font.capHeight;
  const tol = FLATTEN_TOLERANCE_MM / scale;

  const layout = layoutNeonText(text, font, options.letterSpacingPct ?? 0);
  const issues: NeonIssue[] = [];
  if (layout.unsupported.length > 0) {
    issues.push({ code: "UNSUPPORTED_CHARS", message: `Caracteres sin trazo en esta fuente (omitidos): ${layout.unsupported.join(" ")}` });
  }

  const raw: NeonPath[] = [];
  for (const sub of layout.subs) {
    const points: Point2D[] = flattenSubPathToPoints(sub, tol);
    if (points.length >= 2) raw.push({ points, closed: !!sub.closed });
  }
  const paths = scaleToMm(raw, scale, { flipY: false });
  if (paths.length === 0) throw new NeonInputError("NO_GLYPHS", "El texto no tiene caracteres dibujables con esta fuente.");
  return { paths, issues };
}
