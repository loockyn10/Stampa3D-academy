/**
 * Qué hacer cuando falla la lectura de `product_print_files`. Si la tabla todavía no existe (migration sin aplicar) la
 * sección se oculta por completo —igual que las categorías de producto—; cualquier otro error se muestra con reintento.
 */

// 42P01 = tabla inexistente (Postgres); PGRST205 = no figura en el schema cache de PostgREST.
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);
const MISSING_TABLE_MESSAGE = /could not find the table|relation .* does not exist|schema cache/i;

export type PrintFilesLoadFailure = "unavailable" | "error";

export function classifyPrintFilesLoadError(error: { code?: string | null; message?: string | null } | null | undefined): PrintFilesLoadFailure {
  if (!error) return "error";
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return "unavailable";
  if (error.message && MISSING_TABLE_MESSAGE.test(error.message)) return "unavailable";
  return "error";
}
