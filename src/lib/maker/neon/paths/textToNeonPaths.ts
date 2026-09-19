import type { Point2D } from "@/lib/maker/types";
import { parsePathData, transformSubPaths, type Matrix, type SubPath } from "@/lib/maker/import/svgGeometry";
import { ACCENT_STROKES, CAP_HEIGHT, GLYPHS, GLYPH_GAP, SPACE_ADVANCE } from "@/lib/maker/neon/fonts/glyphs";
import { getNeonFont } from "@/lib/maker/neon/fonts/neonFonts";
import { FLATTEN_TOLERANCE_MM, flattenSubPathToPoints, scaleToMm } from "@/lib/maker/neon/paths/flattenNeonPath";
import { NeonInputError, type NeonFontId, type NeonIssue, type NeonPath, type NeonPathsResult } from "@/lib/maker/neon/types";

const glyphCache = new Map<string, SubPath[]>();

function glyphSubPaths(d: string): SubPath[] {
  let subs = glyphCache.get(d);
  if (!subs) {
    subs = parsePathData(d);
    glyphCache.set(d, subs);
  }
  return subs;
}

/**
 * Texto -> NeonPath[] con una fuente de trazos. Cada carácter aporta uno o más
 * trazos (la "A" son tres); se conserva su posición relativa dentro de la línea.
 * El texto se pasa a MAYÚSCULAS (la fuente solo dibuja mayúsculas). Las tildes y
 * la Ñ se dibujan como un trazo extra sobre la letra. Un solo renglón.
 *
 * Escala: `heightMm` es la altura de mayúscula (CAP_HEIGHT = 100 unidades de
 * fuente) — la misma referencia para "A" que para "-", a diferencia de la caja
 * del recorrido, que cambiaría con cada carácter.
 */
export function textToNeonPaths(text: string, fontId: NeonFontId, heightMm: number): NeonPathsResult {
  const clean = text.replace(/[\r\n\t]+/g, " ");
  if (clean.trim() === "") throw new NeonInputError("EMPTY_TEXT", "Escribí un texto para generar el recorrido.");

  const font = getNeonFont(fontId);
  const shear: Matrix = [1, 0, Math.tan((font.shearDeg * Math.PI) / 180), 1, 0, 0];
  const scale = heightMm / CAP_HEIGHT;
  const tol = FLATTEN_TOLERANCE_MM / scale;

  const unsupported = new Set<string>();
  let cursor = 0;
  let last: { x: number; width: number } | null = null;
  const allSubs: SubPath[] = [];

  for (const ch of clean.toLocaleUpperCase("es").normalize("NFD")) {
    if (ACCENT_STROKES[ch] !== undefined) {
      if (last) {
        const cx = last.x + last.width / 2;
        for (const sub of transformSubPaths(glyphSubPaths(ACCENT_STROKES[ch]), [1, 0, 0, 1, cx, 0])) allSubs.push(sub);
      }
      continue;
    }
    if (/[̀-ͯ]/.test(ch)) continue; // otras marcas combinantes: se descartan sin avisar
    if (ch === " ") {
      cursor += SPACE_ADVANCE;
      last = null;
      continue;
    }
    const glyph = GLYPHS[ch];
    if (!glyph) {
      unsupported.add(ch);
      continue;
    }
    for (const sub of transformSubPaths(glyphSubPaths(glyph.d), [1, 0, 0, 1, cursor, 0])) allSubs.push(sub);
    last = { x: cursor, width: glyph.width };
    cursor += glyph.width + GLYPH_GAP;
  }

  const issues: NeonIssue[] = [];
  if (unsupported.size > 0) {
    issues.push({ code: "UNSUPPORTED_CHARS", message: `Caracteres sin trazo en esta fuente (omitidos): ${[...unsupported].join(" ")}` });
  }

  const raw: NeonPath[] = [];
  for (const sub of transformSubPaths(allSubs, shear)) {
    const points: Point2D[] = flattenSubPathToPoints(sub, tol);
    // Escalado y limpieza ocurren juntos en scaleToMm; acá solo se conserva la forma.
    if (points.length >= 2) raw.push({ points, closed: !!sub.closed });
  }
  const paths = scaleToMm(raw, scale, { flipY: false });
  if (paths.length === 0) throw new NeonInputError("NO_GLYPHS", "El texto no tiene caracteres dibujables con esta fuente.");
  return { paths, issues };
}

