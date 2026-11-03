/**
 * Límites y constantes de la biblioteca de archivos de impresión (Mi Taller → Productos).
 * Sin dependencias de Node ni de React: lo usan el servidor, el cliente y los tests.
 */

export const PRINT_FILES_BUCKET = "product-print-files";

/** Techo absoluto: coincide con `file_size_limit` del bucket (migration 20261102130000). */
export const PRINT_FILE_ABSOLUTE_MAX_BYTES = 150 * 1024 * 1024;
/** Límite por defecto. Un 3MF con varias piezas y texturas supera fácil los 20 MB. */
export const PRINT_FILE_DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
export const PRINT_FILE_MIN_BYTES = 100;

/** Archivos (listos + en subida) por producto. */
export const MAX_PRINT_FILES_PER_PRODUCT = 30;

/** Archivos (listos + en subida) por usuario: freno al abuso de almacenamiento hasta definir una cuota comercial. */
export const MAX_PRINT_FILES_PER_USER = 300;

/** Una subida que no se confirmó en este tiempo se considera abandonada y se limpia. */
export const PENDING_UPLOAD_TTL_MS = 60 * 60 * 1000;

/** El enlace que se le entrega al laminador debe sobrevivir al arranque de la aplicación. */
export const OPEN_LINK_TTL_SECONDS = 10 * 60;
/** Descarga directa desde el navegador: se usa al instante. */
export const DOWNLOAD_LINK_TTL_SECONDS = 60;

export const PRINT_FILE_EXTENSION = ".3mf";

/**
 * Límite efectivo en bytes. `PRINT_FILES_MAX_MB` (variable de servidor) lo ajusta entre 1 MB y el techo del bucket;
 * un valor ausente o inválido usa el valor por defecto.
 */
export function resolvePrintFileMaxBytes(envValue: string | undefined | null): number {
  const megabytes = Number(String(envValue ?? "").trim());
  if (!Number.isFinite(megabytes) || megabytes < 1) return PRINT_FILE_DEFAULT_MAX_BYTES;
  return Math.min(Math.floor(megabytes * 1024 * 1024), PRINT_FILE_ABSOLUTE_MAX_BYTES);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 100 ? Math.round(megabytes) : megabytes.toFixed(1).replace(/\.0$/, "")} MB`;
}
