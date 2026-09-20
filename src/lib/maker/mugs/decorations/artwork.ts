import type * as opentype from "opentype.js";
import { flattenOpentypePath, textToOpentypePath } from "@/lib/maker/geometry/textToPaths";
import { DesignImportError, IMPORT_LIMITS } from "@/lib/maker/import/types";
import { extractSvgShapes } from "@/lib/maker/import/svgImport";
import { decodeRasterImage } from "@/lib/maker/neon/raster/decodeRasterImage";
import { alphaField, cropField, foregroundMask, hasSignificantAlpha, luminanceField, maskBoundingBox, otsuThreshold, resampleField } from "@/lib/maker/neon/raster/imageProcessing";
import { MAX_TEXT_LENGTH, MAX_TEXT_LINES } from "@/lib/maker/mugs/decorations/decorationDefaults";
import type { MugRasterSource, MugTextSource } from "@/lib/maker/mugs/types";
import type { Point2D } from "@/lib/maker/types";

/**
 * ARTE de una decoración: etapa 1 del pipeline (fuente -> geometría 2D en unidades propias), independiente del
 * tamaño en mm y de la posición. Es lo que se cachea: mover / escalar / cambiar la profundidad NO vuelve a parsear
 * el SVG ni a decodificar la imagen. Etapa 2 (field.ts): arte + tamaño + resolución -> campo de distancia.
 *
 *  - vector: polígonos rellenos con su regla de relleno (texto y SVG). \`yDown\`: el SVG tiene Y hacia abajo.
 *  - mask: máscara binaria recortada al contenido (PNG / JPG), fila 0 = arriba.
 */
export interface VectorArt {
  kind: "vector";
  shapes: { paths: Point2D[][]; fillRule: "nonzero" | "evenodd" }[];
  yDown: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface MaskArt {
  kind: "mask";
  mask: Uint8Array;
  width: number;
  height: number;
}
export type Artwork = (VectorArt | MaskArt) & {
  /** Ancho/alto del contenido (relación de aspecto nativa). */
  aspect: number;
  warnings: string[];
};

export type ArtworkResult = { ok: true; artwork: Artwork } | { ok: false; message: string };

function vectorArt(shapes: VectorArt["shapes"], yDown: boolean, warnings: string[]): Artwork {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) for (const path of s.paths) for (const [x, y] of path) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!(maxX > minX) || !(maxY > minY)) throw new DesignImportError("SVG_EMPTY", "El diseño no tiene contenido con área para decorar.");
  return { kind: "vector", shapes, yDown, minX, minY, maxX, maxY, aspect: (maxX - minX) / (maxY - minY), warnings };
}

/** Texto (1 a 4 líneas) -> siluetas rellenas. Sin salto de línea parcial: cada línea se alinea por su ancho de tinta. */
export function prepareTextArt(font: opentype.Font, source: Pick<MugTextSource, "text" | "align">): ArtworkResult {
  const lines = source.text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd());
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0 || lines.every((l) => !l.trim())) return { ok: false, message: "Escribí un texto para la decoración." };
  if (lines.length > MAX_TEXT_LINES) return { ok: false, message: `El texto admite hasta ${MAX_TEXT_LINES} líneas.` };
  if (lines.join("").length > MAX_TEXT_LENGTH) return { ok: false, message: `El texto admite hasta ${MAX_TEXT_LENGTH} caracteres.` };

  const REF_HEIGHT = 100; // alto de mayúscula de referencia; la escala final la fija el tamaño de la decoración
  const lineAdvance = REF_HEIGHT * 1.45;
  const unsupported = new Set<string>();
  const perLine: { contours: Point2D[][]; minX: number; maxX: number }[] = [];
  for (const raw of lines) {
    const line = Array.from(raw)
      .filter((ch) => {
        if (ch === " " || font.charToGlyph(ch).index !== 0) return true;
        unsupported.add(ch);
        return false;
      })
      .join("");
    const contours = line.trim() ? flattenOpentypePath(textToOpentypePath(font, line, REF_HEIGHT), { curveSegmentLengthMm: 0.6 }) : [];
    let minX = Infinity, maxX = -Infinity;
    for (const c of contours) for (const [x] of c) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    perLine.push({ contours, minX, maxX });
  }
  const inked = perLine.filter((l) => l.contours.length > 0);
  if (inked.length === 0) return { ok: false, message: "Ningún carácter del texto puede dibujarse con esta fuente." };
  const blockMin = Math.min(...inked.map((l) => l.minX)), blockMax = Math.max(...inked.map((l) => l.maxX));
  const paths: Point2D[][] = [];
  perLine.forEach((l, i) => {
    if (l.contours.length === 0) return;
    const shift = source.align === "left" ? blockMin - l.minX : source.align === "right" ? blockMax - l.maxX : (blockMin + blockMax) / 2 - (l.minX + l.maxX) / 2;
    for (const c of l.contours) paths.push(c.map(([x, y]) => [x + shift, y - i * lineAdvance] as const));
  });
  const warnings = unsupported.size > 0 ? [`Caracteres sin glifo en la fuente (omitidos): ${[...unsupported].join(" ")}`] : [];
  try {
    return { ok: true, artwork: vectorArt([{ paths, fillRule: "nonzero" }], false, warnings) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "No se pudo preparar el texto." };
  }
}

/**
 * SVG relleno -> formas (reusa el importador SEGURO de Carteles: parser XML propio sin DOM; sin scripts,
 * foreignObject, recursos externos ni handlers; transforms, viewBox, <use>, fill-rule). A diferencia de Neon acá
 * cuentan los RELLENOS. Los trazos (stroke) NO se convierten a forma en 0.2 (el importador los ignora): un SVG solo de
 * líneas falla con un mensaje claro; convertí el trazo a contorno en tu editor vectorial.
 */
export function prepareSvgArt(content: string): ArtworkResult {
  try {
    if (content.length > IMPORT_LIMITS.maxFileBytes) throw new DesignImportError("FILE_TOO_LARGE", "El archivo es demasiado grande (máximo 10 MB).");
    const raw = extractSvgShapes(content);
    return { ok: true, artwork: vectorArt(raw.shapes.map((s) => ({ paths: s.paths, fillRule: s.fillRule })), true, raw.warnings) };
  } catch (err) {
    if (err instanceof DesignImportError) return { ok: false, message: err.message };
    return { ok: false, message: "No se pudo interpretar el SVG." };
  }
}

const MAX_MASK_SIDE = 1024;

/**
 * PNG / JPG -> silueta completa (NO skeleton). Reusa el decoder y las utilidades de máscara de Neon 0.2: alpha si hay
 * transparencia significativa (o si se fuerza), si no luminosidad con umbral (Otsu por defecto); "invertir" invierte la máscara.
 */
export function prepareRasterArt(bytes: Uint8Array, settings: Pick<MugRasterSource, "detection" | "threshold" | "invert">): ArtworkResult {
  try {
    const { kind, image } = decodeRasterImage(bytes);
    const useAlpha = settings.detection === "alpha" || (settings.detection === "auto" && kind === "png" && hasSignificantAlpha(image));
    const mode = useAlpha ? "alpha" : "luminance";
    const field = useAlpha ? alphaField(image) : luminanceField(image, 0);
    const threshold = settings.threshold ?? (useAlpha ? 128 : otsuThreshold(field));
    const full = foregroundMask(field, Math.min(255, Math.max(0, threshold)), mode, settings.invert);
    const box = maskBoundingBox(full, image.width, image.height);
    if (!box) return { ok: false, message: "No se detectó ninguna forma en la imagen. Probá otro modo de detección, el umbral o «Invertir»." };
    const crop = cropField(full, image.width, image.height, box, 0, 0);
    let { data, width, height } = crop;
    const side = Math.max(width, height);
    if (side > MAX_MASK_SIDE) {
      const f = MAX_MASK_SIDE / side;
      const nw = Math.max(2, Math.round(width * f)), nh = Math.max(2, Math.round(height * f));
      const scaled = resampleField(Uint8Array.from(data, (v) => (v ? 255 : 0)), width, height, nw, nh);
      data = Uint8Array.from(scaled, (v) => (v >= 128 ? 1 : 0));
      width = nw;
      height = nh;
    }
    if (width < 2 || height < 2) return { ok: false, message: "La forma detectada es demasiado pequeña." };
    return { ok: true, artwork: { kind: "mask", mask: data, width, height, aspect: width / height, warnings: [] } };
  } catch (err) {
    if (err instanceof DesignImportError) return { ok: false, message: err.message };
    return { ok: false, message: err instanceof Error && err.message ? err.message : "No se pudo leer la imagen." };
  }
}
