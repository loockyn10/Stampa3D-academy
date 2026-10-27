import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getCurrentUserAccess, type UserAccessSnapshot } from "@/lib/auth/user-access";
import { loadFeatureFlagSnapshot } from "./loader";
import type { FeatureId } from "./registry";
import { resolveFeatureAccess, resolvePathAccess, type FeatureAccessDecision } from "./resolve";

type AdminCapable = Pick<UserAccessSnapshot, "capabilities">;

export const FEATURE_UNAVAILABLE_MESSAGE = "Esta herramienta todavía no está disponible.";
export const FEATURE_UNAVAILABLE_ERROR_CODE = "feature_unavailable";

/**
 * Decisión de feature flag para el usuario ya resuelto por `getCurrentUserAccess`. El bypass de admin viene de
 * `capabilities.accessAdmin` (profiles.role), nunca de un dato del cliente. Esta comprobación SE SUMA a la de
 * membresía/ownership de cada operación; no la reemplaza.
 */
export async function getFeatureAccess(
  supabase: SupabaseClient,
  featureId: FeatureId,
  access: AdminCapable,
): Promise<FeatureAccessDecision> {
  const snapshot = await loadFeatureFlagSnapshot(supabase);
  return resolveFeatureAccess(snapshot, featureId, { isAdmin: access.capabilities.accessAdmin === true });
}

export async function isFeatureAvailable(
  supabase: SupabaseClient,
  featureId: FeatureId,
  access: AdminCapable,
): Promise<boolean> {
  return (await getFeatureAccess(supabase, featureId, access)).allowed;
}

/** Igual que `isFeatureAvailable` pero por ruta; las rutas sin funcionalidad dueña (o vacías) están permitidas. */
export async function isPathAvailable(
  supabase: SupabaseClient,
  path: string | null | undefined,
  access: AdminCapable,
): Promise<boolean> {
  if (!path) return true;
  const snapshot = await loadFeatureFlagSnapshot(supabase);
  return resolvePathAccess(snapshot, path, { isAdmin: access.capabilities.accessAdmin === true }).allowed;
}

/**
 * Guard para API routes: devuelve la respuesta 403 estándar si la funcionalidad está deshabilitada para quien llama
 * (administradores exceptuados) o `null` si puede continuar. Si el handler ya resolvió el acceso, pásalo en `access`
 * para no repetir consultas.
 */
export async function featureGuardResponse(
  supabase: SupabaseClient,
  featureId: FeatureId,
  access?: AdminCapable,
): Promise<NextResponse | null> {
  const resolved = access ?? (await getCurrentUserAccess(supabase)).access;
  return (await isFeatureAvailable(supabase, featureId, resolved)) ? null : featureUnavailableResponse();
}

/** Respuesta estándar de las API routes para una funcionalidad deshabilitada (sin datos internos). */
export function featureUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: FEATURE_UNAVAILABLE_ERROR_CODE, message: FEATURE_UNAVAILABLE_MESSAGE },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}
