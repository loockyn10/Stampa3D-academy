/**
 * Verificación básica de un 3MF sin descomprimirlo.
 *
 * 3MF es un ZIP (Open Packaging Conventions). Un archivo con extensión .3mf no es necesariamente un 3MF: acá se lee
 * SOLO el directorio central del ZIP (nombres y tamaños declarados, a unos pocos KB del final del archivo) y se
 * comprueba que tenga la forma de un paquete 3MF y que no sea una bomba de compresión ni lleve rutas peligrosas.
 * Nunca se descomprime nada: los laminadores sí lo harán al abrirlo, por eso se rechazan tamaños y rutas anómalos.
 *
 * Es lógica pura sobre un lector de rangos (`RangeSource`): el cliente la usa con `File.slice` y el servidor con
 * peticiones HTTP `Range` a una URL firmada, así que el servidor nunca descarga el archivo entero para validarlo.
 */

import { THREE_MF_LIMITS } from "@/lib/stl/three-mf-package";

export interface RangeSource {
  /** Último tramo del archivo (hasta `length` bytes) y el tamaño total. */
  readTail(length: number): Promise<{ bytes: Uint8Array; totalSize: number }>;
  /** Bytes [start, endExclusive). */
  readRange(start: number, endExclusive: number): Promise<Uint8Array>;
}

export type ThreeMfContainerErrorCode =
  | "not_zip"
  | "corrupt"
  | "unsupported_zip64"
  | "encrypted"
  | "too_many_entries"
  | "entry_too_large"
  | "archive_too_large"
  | "unsafe_entry_name"
  | "not_3mf";

export type ThreeMfContainerResult =
  | { ok: true; totalSize: number; entryCount: number; uncompressedBytes: number }
  | { ok: false; code: ThreeMfContainerErrorCode; message: string };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
/** Techo del directorio central: 20 000 entradas con nombres largos caben holgadas. */
const MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;

const MESSAGES: Record<ThreeMfContainerErrorCode, string> = {
  not_zip: "El archivo no es un proyecto 3MF válido (no es un paquete ZIP).",
  corrupt: "El archivo 3MF está dañado o incompleto.",
  unsupported_zip64: "El archivo usa un formato ZIP que no se admite.",
  encrypted: "El archivo 3MF está cifrado y no se puede usar.",
  too_many_entries: "El 3MF tiene demasiados archivos internos.",
  entry_too_large: "El 3MF contiene un archivo interno demasiado grande.",
  archive_too_large: "El 3MF descomprimido es demasiado grande.",
  unsafe_entry_name: "El 3MF contiene rutas internas no permitidas.",
  not_3mf: "El archivo es un ZIP pero no tiene la estructura de un proyecto 3MF.",
};

function fail(code: ThreeMfContainerErrorCode): ThreeMfContainerResult {
  return { ok: false, code, message: MESSAGES[code] };
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export interface ZipEntrySummary {
  name: string;
  uncompressedSize: number;
  flags: number;
}

interface EndOfCentralDirectory {
  entryCount: number;
  directorySize: number;
  directoryOffset: number;
}

/** Busca el registro EOCD recorriendo el tramo final hacia atrás (el comentario del ZIP puede contener la firma). */
export function findEndOfCentralDirectory(tail: Uint8Array): EndOfCentralDirectory | null | "zip64" {
  if (tail.length < EOCD_MIN_LENGTH) return null;
  const dv = view(tail);
  const lowest = Math.max(0, tail.length - EOCD_MIN_LENGTH - MAX_COMMENT_LENGTH);
  for (let pos = tail.length - EOCD_MIN_LENGTH; pos >= lowest; pos -= 1) {
    if (dv.getUint32(pos, true) !== EOCD_SIGNATURE) continue;
    const commentLength = dv.getUint16(pos + 20, true);
    if (pos + EOCD_MIN_LENGTH + commentLength > tail.length) continue;
    const entryCount = dv.getUint16(pos + 10, true);
    const directorySize = dv.getUint32(pos + 12, true);
    const directoryOffset = dv.getUint32(pos + 16, true);
    if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return "zip64";
    return { entryCount, directorySize, directoryOffset };
  }
  return null;
}

/** Lee las entradas del directorio central. Devuelve null si está truncado o mal formado. */
export function parseCentralDirectory(bytes: Uint8Array, entryCount: number): ZipEntrySummary[] | "zip64" | null {
  const dv = view(bytes);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntrySummary[] = [];
  let pos = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (pos + 46 > bytes.length || dv.getUint32(pos, true) !== CENTRAL_SIGNATURE) return null;
    const flags = dv.getUint16(pos + 8, true);
    const compressedSize = dv.getUint32(pos + 20, true);
    const uncompressedSize = dv.getUint32(pos + 24, true);
    const nameLength = dv.getUint16(pos + 28, true);
    const extraLength = dv.getUint16(pos + 30, true);
    const commentLength = dv.getUint16(pos + 32, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) return "zip64";
    const nameStart = pos + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > bytes.length) return null;
    entries.push({ name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)), uncompressedSize, flags });
    pos = next;
  }
  return entries;
}

/** Una ruta interna es peligrosa si escapa de la carpeta de extracción o es absoluta. */
export function isUnsafeEntryName(name: string): boolean {
  if (!name || name.length > 1024) return true;
  if (/[\u0000]/.test(name)) return true;
  if (name.startsWith("/") || name.startsWith("\\") || /^[a-zA-Z]:/.test(name)) return true;
  return name.split(/[\\/]/).some((part) => part === "..");
}

/** Reglas propias de un paquete 3MF (OPC): tipos de contenido + al menos una parte de modelo. */
export function looksLikeThreeMf(entries: readonly ZipEntrySummary[]): boolean {
  const names = entries.map((entry) => entry.name.toLowerCase());
  return names.includes("[content_types].xml") && names.some((name) => name.endsWith(".model"));
}

export async function inspectThreeMfContainer(source: RangeSource): Promise<ThreeMfContainerResult> {
  let tailResult: { bytes: Uint8Array; totalSize: number };
  try {
    tailResult = await source.readTail(EOCD_MIN_LENGTH + MAX_COMMENT_LENGTH);
  } catch {
    return fail("corrupt");
  }
  const { bytes: tail, totalSize } = tailResult;
  if (!Number.isFinite(totalSize) || totalSize < EOCD_MIN_LENGTH) return fail("not_zip");

  // Firma del primer encabezado local ("PK\x03\x04"): un ZIP real de 3MF nunca empieza de otra forma.
  let head: Uint8Array;
  try {
    head = totalSize <= tail.length ? tail.subarray(0, 4) : await source.readRange(0, 4);
  } catch {
    return fail("corrupt");
  }
  if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) return fail("not_zip");

  const eocd = findEndOfCentralDirectory(tail);
  if (eocd === "zip64") return fail("unsupported_zip64");
  if (!eocd || eocd.entryCount === 0) return fail("not_zip");
  if (eocd.entryCount > THREE_MF_LIMITS.maxEntries) return fail("too_many_entries");
  if (eocd.directorySize > MAX_CENTRAL_DIRECTORY_BYTES) return fail("too_many_entries");
  if (eocd.directoryOffset + eocd.directorySize > totalSize) return fail("corrupt");

  let directory: Uint8Array;
  try {
    const tailStart = totalSize - tail.length;
    directory = eocd.directoryOffset >= tailStart
      ? tail.subarray(eocd.directoryOffset - tailStart, eocd.directoryOffset - tailStart + eocd.directorySize)
      : await source.readRange(eocd.directoryOffset, eocd.directoryOffset + eocd.directorySize);
  } catch {
    return fail("corrupt");
  }

  const entries = parseCentralDirectory(directory, eocd.entryCount);
  if (entries === "zip64") return fail("unsupported_zip64");
  if (!entries) return fail("corrupt");

  let uncompressedBytes = 0;
  for (const entry of entries) {
    if (entry.flags & 0x1) return fail("encrypted");
    if (isUnsafeEntryName(entry.name)) return fail("unsafe_entry_name");
    if (entry.uncompressedSize > THREE_MF_LIMITS.maxEntryUncompressedBytes) return fail("entry_too_large");
    uncompressedBytes += entry.uncompressedSize;
    if (uncompressedBytes > THREE_MF_LIMITS.maxTotalUncompressedBytes) return fail("archive_too_large");
  }
  if (!looksLikeThreeMf(entries)) return fail("not_3mf");

  return { ok: true, totalSize, entryCount: entries.length, uncompressedBytes };
}

/** Lector de rangos sobre un `Blob`/`File` del navegador (o de Node ≥ 18). */
export function blobRangeSource(blob: Blob): RangeSource {
  return {
    async readTail(length) {
      const start = Math.max(0, blob.size - length);
      return { bytes: new Uint8Array(await blob.slice(start, blob.size).arrayBuffer()), totalSize: blob.size };
    },
    async readRange(start, endExclusive) {
      return new Uint8Array(await blob.slice(start, endExclusive).arrayBuffer());
    },
  };
}
