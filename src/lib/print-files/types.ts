import type { SlicerId } from "./slicers";

/** Fila de `product_print_files` tal como la lee la UI (solo `status = 'ready'`). */
export interface PrintFile {
  id: string;
  product_id: string;
  component_id: string | null;
  name: string;
  slicer: SlicerId | string;
  printer_id: string | null;
  printer_name: string | null;
  file_name: string;
  file_size: number | null;
  est_minutes: number | null;
  est_grams: number | null;
  material: string | null;
  created_at: string;
}

/** Columnas que se piden a la base: nunca `select("*")` ni `storage_path` en el navegador. */
export const PRINT_FILE_COLUMNS =
  "id, product_id, component_id, name, slicer, printer_id, printer_name, file_name, file_size, est_minutes, est_grams, material, created_at";

export interface PrintFileOption {
  value: string;
  label: string;
}

/** Cómo se lee una pieza vinculada: la UI solo conoce estos datos de las piezas de la receta. */
export interface PrintFileComponent {
  id: string;
  name: string;
}
