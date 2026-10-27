import {
  FEATURE_REGISTRY,
  findFeatureForPath,
  getFeatureDefinition,
  isFeatureId,
  type FeatureDefinition,
  type FeatureId,
} from "./registry";

/**
 * Origen del snapshot de flags:
 * - `database`: leído de `platform_feature_flags` ahora.
 * - `stale`: la lectura falló, se reutiliza el último estado conocido (nunca se abre una herramienta restringida).
 * - `uninitialized`: la tabla todavía no existe (migration sin aplicar): rige el default del registro.
 * - `unavailable`: la lectura falló y no hay último estado conocido: se deniega a usuarios no administradores.
 */
export type FeatureFlagSource = "database" | "stale" | "uninitialized" | "unavailable";

export interface FeatureFlagSnapshot {
  source: FeatureFlagSource;
  /** Solo features configuradas explícitamente; las ausentes están "sin configurar". */
  flags: Partial<Record<FeatureId, boolean>>;
}

export type FeatureAccessReason =
  | "enabled"
  | "not_configured"
  | "admin_bypass"
  | "disabled"
  | "unavailable";

export interface FeatureAccessDecision {
  allowed: boolean;
  reason: FeatureAccessReason;
}

export const UNINITIALIZED_SNAPSHOT: FeatureFlagSnapshot = { source: "uninitialized", flags: {} };
export const UNAVAILABLE_SNAPSHOT: FeatureFlagSnapshot = { source: "unavailable", flags: {} };

export interface FeatureFlagRow {
  feature_id: unknown;
  enabled: unknown;
}

/** Convierte filas de la base en un snapshot. Ignora ids desconocidos y valores no booleanos (nunca lanza). */
export function buildSnapshotFromRows(rows: readonly FeatureFlagRow[] | null | undefined): FeatureFlagSnapshot {
  const flags: Partial<Record<FeatureId, boolean>> = {};
  for (const row of rows ?? []) {
    if (isFeatureId(row.feature_id) && typeof row.enabled === "boolean") {
      flags[row.feature_id] = row.enabled;
    }
  }
  return { source: "database", flags };
}

/** Estado público (sin considerar admin) de una funcionalidad. */
export function getPublicFeatureState(
  snapshot: FeatureFlagSnapshot,
  featureId: FeatureId,
): { enabled: boolean; configured: boolean } {
  if (snapshot.source === "unavailable") return { enabled: false, configured: false };
  const explicit = snapshot.flags[featureId];
  if (typeof explicit === "boolean") return { enabled: explicit, configured: true };
  return { enabled: getFeatureDefinition(featureId).defaultEnabled, configured: false };
}

/**
 * Decisión de acceso a una funcionalidad. El bypass de administrador (`isAdmin` debe venir de
 * `capabilities.accessAdmin`, es decir, de `profiles.role`) aplica SOLO a las feature flags: no sustituye ninguna
 * validación de membresía, ownership ni RLS.
 */
export function resolveFeatureAccess(
  snapshot: FeatureFlagSnapshot,
  featureId: FeatureId,
  options: { isAdmin: boolean },
): FeatureAccessDecision {
  if (options.isAdmin) return { allowed: true, reason: "admin_bypass" };
  if (snapshot.source === "unavailable") return { allowed: false, reason: "unavailable" };
  const state = getPublicFeatureState(snapshot, featureId);
  if (!state.enabled) return { allowed: false, reason: "disabled" };
  return { allowed: true, reason: state.configured ? "enabled" : "not_configured" };
}

/** Acceso a una ruta: las rutas sin funcionalidad dueña (o protegidas) siempre están permitidas. */
export function resolvePathAccess(
  snapshot: FeatureFlagSnapshot,
  path: string,
  options: { isAdmin: boolean },
): FeatureAccessDecision & { feature: FeatureDefinition | null } {
  const feature = findFeatureForPath(path);
  if (!feature) return { allowed: true, reason: "enabled", feature: null };
  return { ...resolveFeatureAccess(snapshot, feature.id, options), feature };
}

export function isPathAccessible(snapshot: FeatureFlagSnapshot, path: string, options: { isAdmin: boolean }): boolean {
  return resolvePathAccess(snapshot, path, options).allowed;
}

/** Funcionalidades que un usuario común no puede usar ahora (para prompts de Stampy, tests y mensajes). */
export function listUnavailableFeatures(
  snapshot: FeatureFlagSnapshot,
  options: { isAdmin: boolean },
): FeatureDefinition[] {
  return FEATURE_REGISTRY.filter((feature) => !resolveFeatureAccess(snapshot, feature.id, options).allowed);
}

/** Filtra una lista cualquiera por la ruta de cada elemento (navegación, accesos rápidos, buscador, recomendaciones). */
export function filterByAccessibleRoute<T>(
  items: readonly T[],
  getPath: (item: T) => string | null | undefined,
  snapshot: FeatureFlagSnapshot,
  options: { isAdmin: boolean },
): T[] {
  return items.filter((item) => {
    const path = getPath(item);
    return !path || isPathAccessible(snapshot, path, options);
  });
}
