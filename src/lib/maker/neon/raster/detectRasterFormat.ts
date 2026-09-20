import type { RasterKind } from "@/lib/maker/neon/raster/types";

/**
 * Detección central del formato de una imagen raster por su CONTENIDO (firma / magic bytes). La extensión y el MIME
 * son solo pistas (`hint`): un JPEG válido con MIME vacío, `application/octet-stream` o extensión .png se detecta como
 * JPEG; un archivo .jpg cuyo contenido NO es JPEG/PNG se rechaza. Puro: sin DOM ni Node.
 */
export type RasterFormat = "png" | "jpeg" | "unsupported";

/** Formatos que no soportamos pero reconocemos, para explicar el rechazo (típico: un WebP descargado como .jpg). */
export type UnsupportedImageKind = "webp" | "gif" | "bmp" | "tiff" | "heic" | "avif" | "jp2" | "pdf" | "svg" | "unknown";

export interface RasterFormatDetection {
  /** Formato según el CONTENIDO real. */
  format: RasterFormat;
  /** Si es "unsupported": qué parece ser. */
  unsupportedKind: UnsupportedImageKind | null;
  /** Formato que sugieren la extensión / el MIME (pista, puede contradecir al contenido). */
  hint: "png" | "jpeg" | null;
  /** true si la pista contradice al contenido (p.ej. "a.png" con firma JPEG): manda el contenido. */
  hintContradicts: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(b: Uint8Array, from: number, len: number): string {
  let s = "";
  for (let i = from; i < from + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function detectUnsupported(b: Uint8Array): UnsupportedImageKind {
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (ascii(b, 0, 3) === "GIF") return "gif";
  if (ascii(b, 0, 2) === "BM") return "bmp";
  if (ascii(b, 0, 4) === "II*\0" || ascii(b, 0, 4) === "MM\0*") return "tiff";
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (brand === "avif" || brand === "avis") return "avif";
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand)) return "heic";
  }
  if (b.length >= 12 && b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0x0c && ascii(b, 4, 4) === "jP  ") return "jp2";
  if (ascii(b, 0, 4) === "%PDF") return "pdf";
  const head = ascii(b, 0, 256).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return "unknown";
}

/** Pista de la extensión (sin distinguir mayúsculas) y/o del MIME. Tolera `image/jpg`, `image/pjpeg` y MIME vacío. */
export function hintFromNameAndMime(fileName?: string, mimeType?: string): "png" | "jpeg" | null {
  const mime = (mimeType ?? "").trim().toLowerCase();
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg" || mime === "image/pjpeg") return "jpeg";
  const name = (fileName ?? "").trim().toLowerCase();
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".jpe") || name.endsWith(".jfif")) return "jpeg";
  return null;
}

export function detectRasterFormat(bytes: Uint8Array, fileName?: string, mimeType?: string): RasterFormatDetection {
  const hint = hintFromNameAndMime(fileName, mimeType);
  let format: RasterFormat = "unsupported";
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) format = "png";
  else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) format = "jpeg";
  return {
    format,
    unsupportedKind: format === "unsupported" ? detectUnsupported(bytes) : null,
    hint,
    hintContradicts: format !== "unsupported" && hint !== null && hint !== format,
  };
}

/** `RasterKind` interno ("jpg") a partir del formato detectado. */
export function rasterKindOf(format: RasterFormat): RasterKind | null {
  return format === "png" ? "png" : format === "jpeg" ? "jpg" : null;
}

export const UNSUPPORTED_KIND_LABEL: Record<UnsupportedImageKind, string> = {
  webp: "WebP",
  gif: "GIF",
  bmp: "BMP",
  tiff: "TIFF",
  heic: "HEIC",
  avif: "AVIF",
  jp2: "JPEG 2000",
  pdf: "PDF",
  svg: "SVG",
  unknown: "un formato desconocido",
};
