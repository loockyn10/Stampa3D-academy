import type { SupabaseClient } from "@supabase/supabase-js";
import { buildWorkshopSummary, type WorkshopSummary } from "./dashboard";

/**
 * Lecturas (RLS del usuario) que alimentan el resumen de Mi Taller. Compartido por el Dashboard de
 * Mi Taller e Inicio para no duplicar consultas. Mismas columnas y filtros que Productos e Inventario.
 * Devuelve `null` si falla una lectura imprescindible (no se presenta un resumen incompleto como real).
 */
export async function loadWorkshopSummary(supabase: SupabaseClient, userId: string): Promise<WorkshopSummary | null> {
  const [productsRes, componentsRes, filamentsRes, printersRes, typesRes] = await Promise.all([
    supabase.from("products").select("*").eq("user_id", userId).eq("is_active", true),
    supabase.from("product_components").select("id, product_id, name, stock_quantity, quantity_per_product, is_active").eq("user_id", userId).eq("is_active", true),
    supabase.from("filaments").select("*, filament_templates(brand)").eq("user_id", userId),
    supabase.from("printers").select("*").eq("user_id", userId).eq("is_active", true),
    supabase.from("calculator_product_types").select("*").eq("user_id", userId).eq("is_active", true),
  ]);
  if (productsRes.error || filamentsRes.error || printersRes.error) return null;
  return buildWorkshopSummary({
    products: productsRes.data ?? [],
    components: componentsRes.error ? [] : componentsRes.data ?? [],
    filaments: filamentsRes.data ?? [],
    printers: printersRes.data ?? [],
    productTypes: typesRes.error ? [] : typesRes.data ?? [],
  });
}
