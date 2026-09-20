import UPNG from "upng-js";
import * as jpegModule from "jpeg-js";
import { detectRasterFormat, rasterKindOf } from "@/lib/maker/neon/raster/detectRasterFormat";
import { NeonInputError } from "@/lib/maker/neon/types";
import { RASTER_LIMITS, type RasterImage, type RasterKind } from "@/lib/maker/neon/raster/types";

/**
 * `jpeg-js` es CommonJS (`module.exports = { encode, decode }`). Según el bundler (webpack/Turbopack, dev/producción) el
 * espacio de nombres expone `decode` directo o bajo `default`: se resuelve acá, en un solo lugar, para que la interop no
 * dependa del entorno. Se usa SIEMPRE con `useTArray: true` (sin `Buffer`, que no existe en el navegador).
 */
type JpegDecode = (data: Uint8Array, opts: Record<string, unknown>) => { width: number; height: number; data: Uint8Array };
function resolveJpegDecode(): JpegDecode {
  const ns = jpegModule as unknown as { decode?: JpegDecode; default?: { decode?: JpegDecode } };
  const fn = ns.decode ?? ns.default?.decode;
  if (typeof fn !== "function") throw new Error("jpeg-js: no se encontró decode() en el bundle");
  return fn;
}

/** Formato real por FIRMA del archivo (no por extensión ni MIME). null si no es un formato raster soportado. */
export function sniffRasterKind(bytes: Uint8Array): RasterKind | null {
  return rasterKindOf(detectRasterFormat(bytes).format);
}

function checkDimensions(width: number, height: number, label: string): void {
  if (!(width > 0 && height > 0)) throw new NeonInputError("RASTER_INVALID", `El archivo ${label} tiene dimensiones inválidas.`);
  if (width > RASTER_LIMITS.maxDimension || height > RASTER_LIMITS.maxDimension || width * height > RASTER_LIMITS.maxPixels) {
    throw new NeonInputError(
      "RASTER_TOO_LARGE",
      `La imagen es demasiado grande (${width}×${height}px). El máximo es ${RASTER_LIMITS.maxDimension}px por lado y ${Math.round(RASTER_LIMITS.maxPixels / 1e6)} megapíxeles.`,
    );
  }
}

function decodePngBytes(bytes: Uint8Array): RasterImage {
  if (bytes.length < 33) throw new NeonInputError("RASTER_INVALID", "El archivo no es un PNG válido.");
  // Dimensiones del IHDR ANTES de decodificar: no se expande en memoria una imagen gigante.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  checkDimensions(view.getUint32(16), view.getUint32(20), "PNG");
  try {
    const img = UPNG.decode(bytes.slice().buffer as ArrayBuffer);
    const frames = UPNG.toRGBA8(img);
    if (!frames.length) throw new Error("sin datos");
    return { width: img.width, height: img.height, data: new Uint8Array(frames[0]) };
  } catch {
    throw new NeonInputError("RASTER_INVALID", "No se pudo leer el PNG (archivo dañado o con un formato no soportado).");
  }
}

/**
 * Lee ancho/alto y la orientación EXIF (1-8) de un JPEG recorriendo sus marcadores, SIN decodificar los píxeles:
 * así una imagen gigante se rechaza antes de expandirla en memoria.
 */
export function readJpegInfo(bytes: Uint8Array): { width: number; height: number; orientation: number } | null {
  let orientation = 1;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // fin / inicio de datos sin haber visto SOF
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    if (marker === 0xe1 && len >= 16) orientation = readExifOrientation(bytes, i + 4, i + 2 + len) ?? orientation;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > bytes.length) return null;
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], orientation };
    }
    i += 2 + len;
  }
  return null;
}

/** Etiqueta 0x0112 (Orientation) del IFD0 de un bloque APP1 "Exif". */
function readExifOrientation(b: Uint8Array, start: number, end: number): number | null {
  if (!(b[start] === 0x45 && b[start + 1] === 0x78 && b[start + 2] === 0x69 && b[start + 3] === 0x66)) return null; // "Exif"
  const t = start + 6; // inicio del encabezado TIFF
  const little = b[t] === 0x49; // "II" little-endian, "MM" big-endian
  const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  if (u16(t + 2) !== 42) return null;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) return null;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** Aplica la orientación EXIF (1-8) al RGBA: una foto tomada de costado se ve como el usuario la ve. */
export function applyExifOrientation(img: RasterImage, orientation: number): RasterImage {
  if (orientation === 1 || orientation < 1 || orientation > 8) return img;
  const { width: w, height: h, data } = img;
  const swap = orientation >= 5;
  const nw = swap ? h : w, nh = swap ? w : h;
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx = x, ny = y;
      switch (orientation) {
        case 2: nx = w - 1 - x; break;
        case 3: nx = w - 1 - x; ny = h - 1 - y; break;
        case 4: ny = h - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = h - 1 - y; ny = x; break;
        case 7: nx = h - 1 - y; ny = w - 1 - x; break;
        case 8: nx = y; ny = w - 1 - x; break;
      }
      const s = (y * w + x) * 4, d = (ny * nw + nx) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  }
  return { width: nw, height: nh, data: out };
}

function decodeJpegBytes(bytes: Uint8Array): RasterImage {
  const info = readJpegInfo(bytes);
  if (!info) throw new NeonInputError("RASTER_INVALID", "No se pudo decodificar el archivo JPEG.");
  checkDimensions(info.width, info.height, "JPEG");
  try {
    const decoded = resolveJpegDecode()(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: Math.ceil(RASTER_LIMITS.maxPixels / 1e6),
      maxMemoryUsageInMB: 512,
    });
    if (decoded.width <= 0 || decoded.height <= 0) throw new Error("vacío");
    return applyExifOrientation({ width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data) }, info.orientation);
  } catch {
    throw new NeonInputError("RASTER_INVALID", "No se pudo decodificar el archivo JPEG.");
  }
}

// Decodificar es lo más caro antes del skeleton y no cambia al mover sliders: se recuerda por identidad de los bytes.
const decodeCache = new WeakMap<Uint8Array, { kind: RasterKind; image: RasterImage }>();

/**
 * Decodifica una imagen raster a RGBA. Valida tamaño de archivo, FIRMA (no confía en el MIME ni la extensión) y
 * dimensiones antes de expandir. PNG y JPEG comparten todo lo que viene después (ver rasterToNeonPaths.ts).
 */
export function decodeRasterImage(bytes: Uint8Array): { kind: RasterKind; image: RasterImage } {
  const cached = decodeCache.get(bytes);
  if (cached) return cached;
  if (bytes.length > RASTER_LIMITS.maxFileBytes) {
    throw new NeonInputError("RASTER_TOO_LARGE", "El archivo es demasiado grande (máximo 10 MB).");
  }
  const kind = sniffRasterKind(bytes);
  if (!kind) throw new NeonInputError("RASTER_INVALID", "El archivo seleccionado no es un PNG o JPEG válido.");
  const decoded = { kind, image: kind === "png" ? decodePngBytes(bytes) : decodeJpegBytes(bytes) };
  decodeCache.set(bytes, decoded);
  return decoded;
}
