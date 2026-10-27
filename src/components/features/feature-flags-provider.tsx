"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFeatureFlagSnapshot } from "@/lib/features/loader";
import type { FeatureFlagSnapshot } from "@/lib/features/resolve";
import {
  buildFeatureVisibility,
  PERMISSIVE_FEATURE_VISIBILITY,
  type FeatureVisibility,
} from "@/lib/features/visibility";

const FeatureVisibilityContext = createContext<FeatureVisibility>(PERMISSIVE_FEATURE_VISIBILITY);

/**
 * Lee el estado público de las funcionalidades con la sesión del navegador (RLS: lectura abierta, sin datos de
 * usuarios) y lo vuelve a consultar en cada navegación, de modo que un cambio hecho por un Admin se refleja sin
 * redeploy y sin depender de ningún caché persistente del navegador (la PWA no tiene service worker).
 */
export function useFeatureFlagSnapshot(supabase: SupabaseClient, pathname: string | null): FeatureFlagSnapshot | null {
  const [snapshot, setSnapshot] = useState<FeatureFlagSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    loadFeatureFlagSnapshot(supabase).then((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
    };
  }, [supabase, pathname]);

  return snapshot;
}

export function FeatureVisibilityProvider({
  snapshot,
  isAdmin,
  accessReady,
  children,
}: {
  snapshot: FeatureFlagSnapshot | null;
  isAdmin: boolean;
  accessReady: boolean;
  children: ReactNode;
}) {
  const value = useMemo(
    () => buildFeatureVisibility(snapshot, { isAdmin, accessReady }),
    [snapshot, isAdmin, accessReady],
  );
  return <FeatureVisibilityContext.Provider value={value}>{children}</FeatureVisibilityContext.Provider>;
}

export function useFeatureVisibility(): FeatureVisibility {
  return useContext(FeatureVisibilityContext);
}
