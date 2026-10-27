"use server";

import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { FEATURE_FLAGS_TABLE, invalidateFeatureFlagCache, isMissingFeatureFlagsTable } from "@/lib/features/loader";
import { isFeatureId, type FeatureId } from "@/lib/features/registry";
import { createClient } from "@/utils/supabase/server";

/** `enabled = null` => todavía sin configurar (rige el default del registro, que es "habilitada"). */
export interface FeatureFlagAdminRow {
  featureId: FeatureId;
  enabled: boolean | null;
  updatedAt: string | null;
}

export type FeatureFlagsAdminResult =
  | { success: true; rows: FeatureFlagAdminRow[] }
  | { success: false; error: string; code: "forbidden" | "migration_missing" | "load_failed" };

export type SetFeatureFlagResult =
  | { success: true; row: FeatureFlagAdminRow }
  | { success: false; error: string };

type RawRow = { feature_id: unknown; enabled: unknown; updated_at: unknown };

function toAdminRow(raw: RawRow): FeatureFlagAdminRow | null {
  if (!isFeatureId(raw.feature_id) || typeof raw.enabled !== "boolean") return null;
  return {
    featureId: raw.feature_id,
    enabled: raw.enabled,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
  };
}

/** Solo administradores (profiles.role = admin vía getCurrentUserAccess); nunca se confía en datos del cliente. */
async function requireAdmin() {
  const supabase = await createClient();
  const { access, error } = await getCurrentUserAccess(supabase);
  if (error || !access.userId || !access.capabilities.accessAdmin) return null;
  return { supabase, userId: access.userId };
}

export async function loadFeatureFlagsAdminAction(): Promise<FeatureFlagsAdminResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, code: "forbidden", error: "No tenés permiso para ver esta configuración." };

  const { data, error } = await admin.supabase.from(FEATURE_FLAGS_TABLE).select("feature_id, enabled, updated_at");
  if (error) {
    if (isMissingFeatureFlagsTable(error)) {
      return {
        success: false,
        code: "migration_missing",
        error: "Falta aplicar la migración de funcionalidades en Supabase. Mientras tanto todas las herramientas siguen habilitadas.",
      };
    }
    console.error("[feature-flags] admin load failed", { code: error.code });
    return { success: false, code: "load_failed", error: "No pudimos cargar la configuración. Probá de nuevo." };
  }

  const rows = ((data ?? []) as RawRow[]).map(toAdminRow).filter((row): row is FeatureFlagAdminRow => row !== null);
  return { success: true, rows };
}

export async function setFeatureFlagAction(input: { featureId: unknown; enabled: unknown }): Promise<SetFeatureFlagResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "No tenés permiso para modificar las funcionalidades." };

  if (!isFeatureId(input?.featureId) || typeof input?.enabled !== "boolean") {
    return { success: false, error: "La funcionalidad indicada no es válida." };
  }

  // updated_by / updated_at los fija un trigger desde la sesión; RLS vuelve a exigir is_admin(auth.uid()).
  const { data, error } = await admin.supabase
    .from(FEATURE_FLAGS_TABLE)
    .upsert({ feature_id: input.featureId, enabled: input.enabled }, { onConflict: "feature_id" })
    .select("feature_id, enabled, updated_at")
    .single();

  if (error || !data) {
    console.error("[feature-flags] admin save failed", { code: error?.code, featureId: input.featureId });
    if (isMissingFeatureFlagsTable(error)) {
      return { success: false, error: "Falta aplicar la migración de funcionalidades en Supabase." };
    }
    return { success: false, error: "No pudimos guardar el cambio. Probá de nuevo." };
  }

  invalidateFeatureFlagCache();
  const row = toAdminRow(data as RawRow);
  if (!row) return { success: false, error: "No pudimos confirmar el cambio. Actualizá la página." };
  return { success: true, row };
}
