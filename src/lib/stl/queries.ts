import type { SupabaseClient } from "@supabase/supabase-js";
import type { StlGroupRow, StlModelRow } from "@/lib/stl/library";

export interface StlLibraryModel extends StlModelRow {
  title: string;
  description: string | null;
  difficulty: string | null;
  material_type: string | null;
  estimated_print_time: string | null;
  thumbnail_url: string | null;
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
  "id, title, description, difficulty, material_type, estimated_print_time, thumbnail_url, category_id, is_active, created_at";
const VARIANT_COLUMNS = "id, model_id, file_url, is_active";

/**
 * Carga la librería pública. La publicación se filtra en la query (`is_active = true`);
 * `library.ts` la vuelve a exigir al armar grupos/contadores.
 */
export async function fetchStlLibrary(supabase: SupabaseClient) {
  const [groupsRes, modelsRes, variantsRes] = await Promise.all([
    supabase.from("stl_categories").select(GROUP_COLUMNS).eq("is_active", true).order("sort_order"),
    supabase.from("stl_models").select(MODEL_COLUMNS).eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("stl_variants").select(VARIANT_COLUMNS).eq("is_active", true).order("created_at"),
  ]);

  const error = groupsRes.error ?? modelsRes.error ?? variantsRes.error ?? null;
  return {
    groups: (groupsRes.data ?? []) as StlGroupRow[],
    models: (modelsRes.data ?? []) as StlLibraryModel[],
    variants: (variantsRes.data ?? []) as StlLibraryVariant[],
    error,
  };
}

export function firstDownloadableVariant(variants: StlLibraryVariant[], modelId: string) {
  return variants.find((variant) => variant.model_id === modelId && variant.is_active && variant.file_url) ?? null;
}
