/**
 * Validación de los datos de un proyecto de impresión. Pura: la usan la UI (feedback inmediato) y las Server Actions
 * (autoridad). El cliente nunca es la fuente de verdad: las acciones vuelven a validar todo.
 */

import { PRINT_FILE_EXTENSION, PRINT_FILE_MIN_BYTES } from "./config";
import { isSlicerId, type SlicerId } from "./slicers";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PRINT_FILE_NAME_MAX = 80;
export const PRINT_FILE_PRINTER_NAME_MAX = 80;
export const PRINT_FILE_MATERIAL_MAX = 60;
export const PRINT_FILE_ORIGINAL_NAME_MAX = 180;
export const PRINT_FILE_MAX_MINUTES = 100000;
export const PRINT_FILE_MAX_GRAMS = 1000000;

function collapse(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/** Nombre original solo para mostrar: sin ruta, sin caracteres de control, acotado. */
export function sanitizeOriginalFileName(rawName: unknown): string {
  const base = String(rawName ?? "").split(/[\\/]/).pop() ?? "";
  const clean = collapse(base);
  if (clean.length <= PRINT_FILE_ORIGINAL_NAME_MAX) return clean;
  const extension = clean.toLowerCase().endsWith(PRINT_FILE_EXTENSION) ? PRINT_FILE_EXTENSION : "";
  return `${clean.slice(0, PRINT_FILE_ORIGINAL_NAME_MAX - extension.length)}${extension}`;
}

export function hasThreeMfExtension(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(PRINT_FILE_EXTENSION);
}

export function stripThreeMfExtension(fileName: string): string {
  return hasThreeMfExtension(fileName) ? fileName.slice(0, -PRINT_FILE_EXTENSION.length) : fileName;
}

/**
 * Último segmento de la URL que se le entrega al laminador. Debe terminar en `.3mf` y no tener caracteres que
 * rompan una ruta o un archivo en Windows (OrcaSlicer toma el nombre de la URL tal cual).
 */
export function toUrlFileName(fileName: string): string {
  const stem = stripThreeMfExtension(fileName)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return `${stem || "proyecto"}${PRINT_FILE_EXTENSION}`;
}

export function validatePrintFileUpload(
  input: { fileName: unknown; size: unknown },
  maxBytes: number,
): { ok: true; fileName: string; size: number } | { ok: false; error: string } {
  const fileName = sanitizeOriginalFileName(input.fileName);
  if (!fileName || !hasThreeMfExtension(fileName)) return { ok: false, error: "El archivo debe ser un proyecto .3mf." };
  const size = Number(input.size);
  if (!Number.isFinite(size) || size < PRINT_FILE_MIN_BYTES) return { ok: false, error: "El archivo está vacío o no es un proyecto 3MF válido." };
  if (size > maxBytes) {
    return { ok: false, error: `El archivo supera el límite de ${Math.floor(maxBytes / (1024 * 1024))} MB.` };
  }
  return { ok: true, fileName, size: Math.floor(size) };
}

export interface PrintFileMetadata {
  name: string;
  slicer: SlicerId;
  componentId: string | null;
  printerId: string | null;
  printerName: string | null;
  estMinutes: number | null;
  estGrams: number | null;
  material: string | null;
}

function optionalText(value: unknown, max: number, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  const text = collapse(String(value));
  if (!text) return { ok: true, value: null };
  if (text.length > max) return { ok: false, error: `${label} no puede superar ${max} caracteres.` };
  return { ok: true, value: text };
}

function optionalUuid(value: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return { ok: false, error: `${label} no es válida.` };
  return { ok: true, value: value.toLowerCase() };
}

function optionalNumber(
  value: unknown,
  { max, integer, label }: { max: number; integer: boolean; label: string },
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return { ok: true, value: null };
  const parsed = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max || (integer && !Number.isInteger(parsed))) {
    return { ok: false, error: `${label} no es válido.` };
  }
  return { ok: true, value: integer ? parsed : Math.round(parsed * 100) / 100 };
}

/** `defaultName`: nombre propuesto (p. ej. el del archivo) cuando el usuario no escribió uno. */
export function validatePrintFileMetadata(
  raw: Record<string, unknown> | null | undefined,
  defaultName = "",
): { ok: true; value: PrintFileMetadata } | { ok: false; error: string } {
  const input = raw ?? {};

  const name = collapse(String(input.name ?? "")) || collapse(defaultName);
  if (!name) return { ok: false, error: "Poné un nombre para identificar el proyecto." };
  if (name.length > PRINT_FILE_NAME_MAX) return { ok: false, error: `El nombre no puede superar ${PRINT_FILE_NAME_MAX} caracteres.` };

  if (!isSlicerId(input.slicer)) return { ok: false, error: "Elegí el laminador del proyecto." };

  const componentId = optionalUuid(input.componentId, "La pieza");
  if (!componentId.ok) return componentId;
  const printerId = optionalUuid(input.printerId, "La impresora");
  if (!printerId.ok) return printerId;
  const printerName = optionalText(input.printerName, PRINT_FILE_PRINTER_NAME_MAX, "El nombre de la impresora");
  if (!printerName.ok) return printerName;
  const material = optionalText(input.material, PRINT_FILE_MATERIAL_MAX, "El material");
  if (!material.ok) return material;
  const estMinutes = optionalNumber(input.estMinutes, { max: PRINT_FILE_MAX_MINUTES, integer: true, label: "El tiempo estimado" });
  if (!estMinutes.ok) return estMinutes;
  const estGrams = optionalNumber(input.estGrams, { max: PRINT_FILE_MAX_GRAMS, integer: false, label: "Los gramos estimados" });
  if (!estGrams.ok) return estGrams;

  return {
    ok: true,
    value: {
      name,
      slicer: input.slicer,
      componentId: componentId.value,
      printerId: printerId.value,
      printerName: printerName.value,
      estMinutes: estMinutes.value,
      estGrams: estGrams.value,
      material: material.value,
    },
  };
}

/** "3 h 40 min" / "45 min" / "2 h". */
export function formatPrintMinutes(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
