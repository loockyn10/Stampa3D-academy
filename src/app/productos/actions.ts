"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function deleteProductAction(productId: string) {
  if (!UUID_PATTERN.test(productId)) {
    return { success: false as const, error: "El producto seleccionado no es válido." };
  }

  const supabase = await createClient();
  const { access, error: accessError } = await getCurrentUserAccess(supabase);
  if (accessError || !access.userId || !access.capabilities.accessPlatform) {
    return { success: false as const, error: "No tenés permiso para eliminar productos." };
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("user_id", access.userId)
    .maybeSingle();

  if (productError) return { success: false as const, error: productError.message };
  if (!product) {
    return { success: false as const, error: "No se encontró el producto o no te pertenece." };
  }

  const [componentsResult, requirementsResult] = await Promise.all([
    supabase
      .from("product_components")
      .select("id")
      .eq("product_id", productId)
      .eq("user_id", access.userId)
      .eq("is_active", true),
    supabase
      .from("product_part_requirements")
      .select("id")
      .eq("product_id", productId)
      .eq("user_id", access.userId)
      .eq("is_active", true),
  ]);

  if (componentsResult.error) {
    return { success: false as const, error: componentsResult.error.message };
  }
  if (requirementsResult.error) {
    return { success: false as const, error: requirementsResult.error.message };
  }

  const componentIds = (componentsResult.data || []).map((component) => component.id);
  const requirementIds = (requirementsResult.data || []).map((requirement) => requirement.id);

  if (componentIds.length > 0) {
    const { error } = await supabase
      .from("product_components")
      .update({ is_active: false })
      .in("id", componentIds)
      .eq("user_id", access.userId);
    if (error) return { success: false as const, error: error.message };
  }

  if (requirementIds.length > 0) {
    const { error } = await supabase
      .from("product_part_requirements")
      .update({ is_active: false })
      .in("id", requirementIds)
      .eq("user_id", access.userId);
    if (error) {
      if (componentIds.length > 0) {
        await supabase
          .from("product_components")
          .update({ is_active: true })
          .in("id", componentIds)
          .eq("user_id", access.userId);
      }
      return { success: false as const, error: error.message };
    }
  }

  const { data: archivedProduct, error: archiveError } = await supabase
    .from("products")
    .update({ is_active: false })
    .eq("id", productId)
    .eq("user_id", access.userId)
    .select("id")
    .maybeSingle();

  if (archiveError || !archivedProduct) {
    if (componentIds.length > 0) {
      await supabase
        .from("product_components")
        .update({ is_active: true })
        .in("id", componentIds)
        .eq("user_id", access.userId);
    }
    if (requirementIds.length > 0) {
      await supabase
        .from("product_part_requirements")
        .update({ is_active: true })
        .in("id", requirementIds)
        .eq("user_id", access.userId);
    }
    return {
      success: false as const,
      error: archiveError?.message || "El producto no pudo archivarse.",
    };
  }

  revalidatePath("/productos");
  return { success: true as const, productId: archivedProduct.id };
}
