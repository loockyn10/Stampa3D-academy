import type { FeatureId } from "./registry";
import { findFeatureForPath } from "./registry";
import { resolveFeatureAccess, type FeatureFlagSnapshot } from "./resolve";

/**
 * Visibilidad en la interfaz (navegación, accesos rápidos, buscador, recomendaciones, enlaces contextuales).
 * Es solo UX: la protección real está en el proxy, las Server Actions y las API routes.
 *
 * Mientras el snapshot o el acceso del usuario no cargaron (`ready = false`) las entradas controladas por una
 * funcionalidad se ocultan: es preferible que aparezcan al cargar a mostrar un acceso que luego desaparece.
 */
export interface FeatureVisibility {
  ready: boolean;
  isAdmin: boolean;
  isFeatureVisible(featureId: FeatureId): boolean;
  /** Rutas sin funcionalidad dueña (perfil, configuración, admin…) siempre son visibles. */
  isPathVisible(path: string | null | undefined): boolean;
}

export function buildFeatureVisibility(
  snapshot: FeatureFlagSnapshot | null,
  options: { isAdmin: boolean; accessReady: boolean },
): FeatureVisibility {
  const ready = snapshot !== null && options.accessReady;
  const isFeatureVisible = (featureId: FeatureId): boolean =>
    snapshot !== null &&
    options.accessReady &&
    resolveFeatureAccess(snapshot, featureId, { isAdmin: options.isAdmin }).allowed;

  return {
    ready,
    isAdmin: options.isAdmin,
    isFeatureVisible,
    isPathVisible(path) {
      if (!path) return true;
      const feature = findFeatureForPath(path);
      return feature ? isFeatureVisible(feature.id) : true;
    },
  };
}

/** Sin proveedor (rutas públicas, tests): no se filtra nada; el proxy sigue siendo la barrera real. */
export const PERMISSIVE_FEATURE_VISIBILITY: FeatureVisibility = {
  ready: true,
  isAdmin: false,
  isFeatureVisible: () => true,
  isPathVisible: () => true,
};

/** Quita grupos que quedaron sin elementos para no dejar títulos ni separadores vacíos. */
export function pruneEmptyGroups<G extends { items: readonly unknown[] }>(groups: readonly G[]): G[] {
  return groups.filter((group) => group.items.length > 0);
}
