import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFeatureFlagSnapshot } from "@/lib/features/loader";
import {
  listUnavailableFeatures,
  resolveFeatureAccess,
  resolvePathAccess,
  type FeatureFlagSnapshot,
} from "@/lib/features/resolve";
import type { FeatureId } from "@/lib/features/registry";

/**
 * Lanzamiento progresivo en Stampy: el asistente sigue respondiendo preguntas generales, pero no recomienda,
 * enlaza ni ejecuta acciones de herramientas deshabilitadas públicamente. Los administradores no tienen
 * restricciones (igual que en el resto de la plataforma). Es contexto de producto, no autorización: cada acción
 * vuelve a validar membresía, ownership y feature flags en su propio servidor.
 */
export interface StampyFeatureGate {
  isFeatureAvailable(featureId: FeatureId): boolean;
  /** `true` si la ruta no pertenece a ninguna funcionalidad o está disponible para este usuario. */
  isRouteAvailable(route: string | null | undefined): boolean;
  /** Descarta elementos cuya ruta (herramienta recomendada, contrato, acción) está deshabilitada. */
  filterByRoute<T>(items: readonly T[], getRoute: (item: T) => string | null | undefined): T[];
  /** Instrucción para el turno del modelo, o `null` si no hay nada restringido. */
  buildPromptNotice(): string | null;
}

export function buildStampyFeatureGate(snapshot: FeatureFlagSnapshot, options: { isAdmin: boolean }): StampyFeatureGate {
  const unavailable = listUnavailableFeatures(snapshot, options);

  const isRouteAvailable = (route: string | null | undefined): boolean =>
    !route || resolvePathAccess(snapshot, route, options).allowed;

  return {
    isFeatureAvailable: (featureId) => resolveFeatureAccess(snapshot, featureId, options).allowed,
    isRouteAvailable,
    filterByRoute: (items, getRoute) => items.filter((item) => isRouteAvailable(getRoute(item))),
    buildPromptNotice() {
      if (unavailable.length === 0) return null;
      return [
        "HERRAMIENTAS TODAVÍA NO DISPONIBLES (lanzamiento progresivo de Universo Stampa):",
        ...unavailable.map((feature) => `- ${feature.name}`),
        "Reglas: no recomiendes, no enlaces ni ofrezcas acciones de estas herramientas, y no inventes otras rutas para llegar a ellas.",
        "Si el usuario pregunta por una, decile brevemente que todavía no está disponible y que se incorporará próximamente.",
        "Seguí respondiendo con normalidad las preguntas generales y las de las herramientas que sí están disponibles.",
      ].join("\n");
    },
  };
}

/** Gate del usuario actual: lee el estado público de las funcionalidades y aplica el bypass de administrador. */
export async function loadStampyFeatureGate(
  supabase: SupabaseClient,
  access: { capabilities: { accessAdmin?: boolean } },
): Promise<StampyFeatureGate> {
  return buildStampyFeatureGate(await loadFeatureFlagSnapshot(supabase), {
    isAdmin: access.capabilities.accessAdmin === true,
  });
}

export const STAMPY_FEATURE_UNAVAILABLE_ANSWER = "Esta herramienta todavía no está disponible.";
