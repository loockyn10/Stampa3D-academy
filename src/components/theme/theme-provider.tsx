"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  readStoredPreference,
  resolveTheme,
  storePreference,
  subscribeThemeChanges,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme/theme";

interface ThemeContextValue {
  /** Lo que eligio el usuario: "light", "dark" o "system". */
  preference: ThemePreference;
  /** Tema efectivamente aplicado ("system" ya resuelto contra el sistema operativo). */
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// En el servidor (y en la hidratacion) se asume la preferencia por defecto; el <html data-theme>
// ya lo fijo el script de inicializacion, asi que no hay parpadeo aunque el estado de React llegue despues.
const getServerPreference = (): ThemePreference => DEFAULT_THEME_PREFERENCE;
const getServerResolved = (): ResolvedTheme => (DEFAULT_THEME_PREFERENCE === "light" ? "light" : "dark");

function getResolvedSnapshot(): ResolvedTheme {
  return resolveTheme(readStoredPreference());
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(subscribeThemeChanges, readStoredPreference, getServerPreference);
  const resolvedTheme = useSyncExternalStore(subscribeThemeChanges, getResolvedSnapshot, getServerResolved);
  const setPreference = useCallback((next: ThemePreference) => storePreference(next), []);
  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme debe usarse dentro de <ThemeProvider>.");
  return context;
}
