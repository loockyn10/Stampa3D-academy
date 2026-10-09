import { slugifyGroupName } from "@/lib/stl/library";

export interface StlModelFormValues {
  title: string;
  description: string;
  difficulty: string;
  estimated_print_time: string;
  material_type: string;
  thumbnail_url: string;
  is_active: boolean;
  category_id: string;
}

/** Nombre del modelo para mostrar: `title` y `name` pueden convivir en filas viejas y nuevas. */
export function stlModelDisplayName(row: { title?: string | null; name?: string | null }): string {
  return row.title?.trim() || row.name?.trim() || "Sin título";
}

/**
 * Payload de insert/update de `stl_models`.
 * `stl_models.name` es NOT NULL (schema real): el título del formulario se escribe en `name`
 * y también en `title`, que es lo que lee la Librería para filas existentes.
 */
export function buildStlModelPayload(values: StlModelFormValues) {
  const title = values.title.trim();
  if (!title) throw new Error("El modelo necesita un título.");
  const categoryId = values.category_id && values.category_id !== "undefined" ? values.category_id : null;
  return {
    name: title,
    title,
    description: values.description || null,
    difficulty: values.difficulty || null,
    estimated_print_time: values.estimated_print_time || null,
    material_type: values.material_type || null,
    thumbnail_url: values.thumbnail_url || null,
    is_active: values.is_active,
    category_id: categoryId,
  };
}

/** Slug base del modelo (reutiliza el slugify de la Librería STL; fallback si el título no tiene caracteres válidos). */
export function buildStlModelSlug(title: string): string {
  return slugifyGroupName(title) || "modelo";
}

/** Primer slug libre: base, base-2, base-3… dado el conjunto de slugs ya usados. */
export function pickAvailableSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * Variante descargable. Columnas NOT NULL reales: model_id, name, file_url.
 * El formulario no pide un nombre de variante: la primera variante hereda el título del modelo.
 */
export function buildStlVariantPayload(modelId: string, values: StlModelFormValues, fileUrl: string) {
  const title = values.title.trim();
  if (!modelId) throw new Error("Falta el modelo de la variante.");
  if (!title) throw new Error("La variante necesita un nombre.");
  if (!fileUrl) throw new Error("La variante necesita un archivo.");
  return {
    model_id: modelId,
    name: title,
    title,
    description: values.description || null,
    file_url: fileUrl,
    thumbnail_url: values.thumbnail_url || null,
    material_type: values.material_type || null,
    is_active: true,
    sort_order: 0,
  };
}

export interface StlVariantManagerValues {
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  file_url: string;
  material_type?: string | null;
  color?: string | null;
  print_settings?: string | null;
  is_active: boolean;
}

/** Payload del editor de variantes: el campo "título" de la UI es el `name` obligatorio (y `title`). */
export function buildStlVariantManagerPayload(modelId: string, values: StlVariantManagerValues) {
  const name = (values.title ?? "").trim();
  if (!modelId || modelId === "undefined") throw new Error("No se puede guardar una variante sin un ID de modelo válido.");
  if (!name) throw new Error("La variante necesita un nombre.");
  if (!values.file_url?.trim()) throw new Error("La variante necesita un archivo (subí uno o pegá una URL).");
  return {
    model_id: modelId,
    name,
    title: name,
    description: values.description || null,
    thumbnail_url: values.thumbnail_url || null,
    file_url: values.file_url.trim(),
    material_type: values.material_type || null,
    color: values.color || null,
    print_settings: values.print_settings || null,
    is_active: values.is_active,
  };
}
