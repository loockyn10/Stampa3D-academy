import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSnapshotFromRows,
  UNAVAILABLE_SNAPSHOT,
  UNINITIALIZED_SNAPSHOT,
  type FeatureFlagRow,
  type FeatureFlagSnapshot,
} from "./resolve";

export const FEATURE_FLAGS_TABLE = "platform_feature_flags";

/** Ventana en la que varias lecturas (proxy + layouts + acciones de un mismo request) comparten una sola consulta. */
export const FEATURE_FLAGS_CACHE_TTL_MS = 5_000;

interface QueryError {
  code?: string | null;
  message?: string | null;
}

/** La tabla todavía no existe (migration sin aplicar): se trata como "sin configurar", no como falla. */
export function isMissingFeatureFlagsTable(error: QueryError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /platform_feature_flags/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

export interface FeatureFlagLoader {
  load(supabase: SupabaseClient, options?: { fresh?: boolean }): Promise<FeatureFlagSnapshot>;
  invalidate(): void;
}

/**
 * Lector con cache corta y "último estado conocido".
 * - Éxito: guarda el snapshot (cache 5 s) y lo recuerda como último bueno.
 * - Tabla inexistente: `uninitialized` (rige el default del registro; no se restringe nada).
 * - Cualquier otro error: reutiliza el último estado conocido (`stale`); si no hay, `unavailable`
 *   (los usuarios no administradores quedan sin acceso a herramientas controladas: falla cerrada).
 * Las lecturas fallidas no se cachean, así que el siguiente request reintenta.
 */
export function createFeatureFlagLoader(now: () => number = Date.now): FeatureFlagLoader {
  let cached: { snapshot: FeatureFlagSnapshot; at: number } | null = null;
  let lastKnownGood: FeatureFlagSnapshot | null = null;
  let inFlight: Promise<FeatureFlagSnapshot> | null = null;

  async function read(supabase: SupabaseClient): Promise<FeatureFlagSnapshot> {
    try {
      const { data, error } = await supabase.from(FEATURE_FLAGS_TABLE).select("feature_id, enabled");
      if (error) {
        if (isMissingFeatureFlagsTable(error)) {
          cached = { snapshot: UNINITIALIZED_SNAPSHOT, at: now() };
          return UNINITIALIZED_SNAPSHOT;
        }
        return lastKnownGood ? { source: "stale", flags: lastKnownGood.flags } : UNAVAILABLE_SNAPSHOT;
      }
      const snapshot = buildSnapshotFromRows((data ?? []) as FeatureFlagRow[]);
      lastKnownGood = snapshot;
      cached = { snapshot, at: now() };
      return snapshot;
    } catch {
      return lastKnownGood ? { source: "stale", flags: lastKnownGood.flags } : UNAVAILABLE_SNAPSHOT;
    }
  }

  return {
    async load(supabase, options) {
      if (!options?.fresh && cached && now() - cached.at < FEATURE_FLAGS_CACHE_TTL_MS) return cached.snapshot;
      if (!options?.fresh && inFlight) return inFlight;
      const pending = read(supabase).finally(() => {
        if (inFlight === pending) inFlight = null;
      });
      inFlight = pending;
      return pending;
    },
    invalidate() {
      cached = null;
    },
  };
}

const sharedLoader = createFeatureFlagLoader();

/** Snapshot compartido (una instancia por runtime: proxy, servidor o navegador). */
export function loadFeatureFlagSnapshot(
  supabase: SupabaseClient,
  options?: { fresh?: boolean },
): Promise<FeatureFlagSnapshot> {
  return sharedLoader.load(supabase, options);
}

export function invalidateFeatureFlagCache(): void {
  sharedLoader.invalidate();
}
