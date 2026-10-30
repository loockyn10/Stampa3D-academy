"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { FEATURE_UNAVAILABLE_MESSAGE, isFeatureAvailable } from "@/lib/features/server";
import { validateProductCategoryName, type ProductCategory } from "@/lib/products/categories";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUPLICATE_MESSAGE = "Ya tenés una categoría con ese nombre.";
const UNIQUE_VIOLATION = "23505";

type CategoryResult =
  | { success: true; category: ProductCategory }
  | { success: false; error: string };

async function authorize() {
  const supabase = await createClient();
  const { access, error } = await getCurrentUserAccess(supabase);
  if (error || !access.userId || !access.capabilities.accessPlatform) {
    return { ok: false, error: "No tenés permiso para administrar categorías." } as const;
  }
  if (!(await isFeatureAvailable(supabase, "mi_taller", access))) {
    return { ok: false, error: FEATURE_UNAVAILABLE_MESSAGE } as const;
  }
  return { ok: true, supabase, userId: access.userId } as const;
}

function revalidateProducts() {
  revalidatePath("/productos");
  revalidatePath("/mi-taller/productos");
}

export async function createProductCategoryAction(rawName: string): Promise<CategoryResult> {
  const validation = validateProductCategoryName(rawName);
  if (!validation.ok) return { success: false, error: validation.error };

  const auth = await authorize();
  if (!auth.ok) return { success: false, error: auth.error };

  // user_id sale de la sesión del servidor, nunca del cliente; RLS y la unicidad (user_id, name_key) lo vuelven a exigir.
  const { data, error } = await auth.supabase
    .from("product_categories")
    .insert({ user_id: auth.userId, name: validation.name })
    .select("id, name")
    .single();

  if (error) {
    return { success: false, error: error.code === UNIQUE_VIOLATION ? DUPLICATE_MESSAGE : "No se pudo crear la categoría." };
  }
  revalidateProducts();
  return { success: true, category: { id: String(data.id), name: String(data.name) } };
}

export async function renameProductCategoryAction(categoryId: string, rawName: string): Promise<CategoryResult> {
  if (!UUID_PATTERN.test(categoryId)) return { success: false, error: "La categoría seleccionada no es válida." };
  const validation = validateProductCategoryName(rawName);
  if (!validation.ok) return { success: false, error: validation.error };

  const auth = await authorize();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from("product_categories")
    .update({ name: validation.name })
    .eq("id", categoryId)
    .eq("user_id", auth.userId)
    .select("id, name")
    .maybeSingle();

  if (error) {
    return { success: false, error: error.code === UNIQUE_VIOLATION ? DUPLICATE_MESSAGE : "No se pudo renombrar la categoría." };
  }
  if (!data) return { success: false, error: "No se encontró la categoría o no te pertenece." };
  revalidateProducts();
  return { success: true, category: { id: String(data.id), name: String(data.name) } };
}

/**
 * Elimina la categoría. Los productos NO se tocan: la clave foránea `products_category_owner_fkey`
 * (ON DELETE SET NULL (category_id)) los deja sin categoría.
 */
export async function deleteProductCategoryAction(categoryId: string) {
  if (!UUID_PATTERN.test(categoryId)) return { success: false as const, error: "La categoría seleccionada no es válida." };

  const auth = await authorize();
  if (!auth.ok) return { success: false as const, error: auth.error };

  const { count, error: countError } = await auth.supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .eq("category_id", categoryId);
  if (countError) return { success: false as const, error: "No se pudo eliminar la categoría." };

  const { data, error } = await auth.supabase
    .from("product_categories")
    .delete()
    .eq("id", categoryId)
    .eq("user_id", auth.userId)
    .select("id")
    .maybeSingle();

  if (error) return { success: false as const, error: "No se pudo eliminar la categoría." };
  if (!data) return { success: false as const, error: "No se encontró la categoría o no te pertenece." };
  revalidateProducts();
  return { success: true as const, categoryId, unassignedProducts: count ?? 0 };
}
