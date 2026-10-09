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

/** Variante descargable del formulario de modelo (mismo criterio name+title que el modelo). */
export function buildStlVariantPayload(modelId: string, values: StlModelFormValues, fileUrl: string) {
  const title = values.title.trim();
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
