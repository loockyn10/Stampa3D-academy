import type { SupabaseClient } from "@supabase/supabase-js";
import type { StlGroupRow, StlModelRow } from "@/lib/stl/library";
import { stlModelDisplayName } from "@/lib/stl/model-payload";

export interface StlLibraryModel extends StlModelRow {
  title: string;
  name?: string | null;
  description: string | null;
  difficulty: string | null;
  material_type: string | null;
  estimated_print_time: string | null;
  thumbnail_url: string | null;
  /** WebM 360° prerenderizado (null = solo thumbnail). */
  preview_url?: string | null;
  created_at: string | null;
}

export interface StlLibraryVariant {
  id: string;
  model_id: string;
  file_url: string | null;
  is_active: boolean | null;
}

const GROUP_COLUMNS = "id, name, slug, description, thumbnail_url, sort_order, is_active";
const MODEL_COLUMNS =
  "id, name, title, description, difficulty, material_type, estimated_print_time, thumbnail_url, category_id, is_active, created_at";
const MODEL_COLUMNS_WITH_PREVIEW = `${MODEL_COLUMNS}, preview_url`;
const VARIANT_COLUMNS = "id, model_id, file_url, is_active";

/**
 * Carga la librería pública. La publicación se filtra en la query (`is_active = true`);
 * `library.ts` la vuelve a exigir al armar grupos/contadores.
 */
export async function fetchStlLibrary(supabase: SupabaseClient) {
  const fetchModels = (columns: string) =>
    supabase.from("stl_models").select(columns).eq("is_active", true).order("created_at", { ascending: false });
  const [groupsRes, initialModelsRes, variantsRes] = await Promise.all([
    supabase.from("stl_categories").select(GROUP_COLUMNS).eq("is_active", true).order("sort_order"),
    fetchModels(MODEL_COLUMNS_WITH_PREVIEW),
    supabase.from("stl_variants").select(VARIANT_COLUMNS).eq("is_active", true).order("created_at"),
  ]);
  // Compat: si la migration de `preview_url` todavía no se aplicó, la librería sigue funcionando sin previews.
  const modelsRes = initialModelsRes.error && isMissingPreviewColumn(initialModelsRes.error) ? await fetchModels(MODEL_COLUMNS) : initialModelsRes;

  const error = groupsRes.error ?? modelsRes.error ?? variantsRes.error ?? null;
  return {
    groups: (groupsRes.data ?? []) as StlGroupRow[],
    models: ((modelsRes.data ?? []) as unknown as StlLibraryModel[]).map(normalizeModel),
    variants: (variantsRes.data ?? []) as StlLibraryVariant[],
    error,
  };
}

export function isMissingPreviewColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /preview_url/i.test(error.message ?? "");
}

export function firstDownloadableVariant(variants: StlLibraryVariant[], modelId: string) {
  return variants.find((variant) => variant.model_id === modelId && variant.is_active && variant.file_url) ?? null;
}

/** `title` puede venir vacío en filas creadas con `name` solamente. */
export function normalizeModel<T extends { title?: string | null; name?: string | null }>(row: T): T & { title: string } {
  return { ...row, title: stlModelDisplayName(row) };
}
