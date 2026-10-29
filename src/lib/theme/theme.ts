// Sistema de temas de Universo Stampa. Ver docs/ARCHITECTURE.md > Temas.
//
// - La preferencia del usuario ("light" | "dark" | "system") vive en localStorage.
// - El tema resuelto ("light" | "dark") se publica como `data-theme` en <html>.
// - El script de inicializacion (THEME_INIT_SCRIPT) corre en <head> antes del primer render para evitar
//   el parpadeo del tema incorrecto; este modulo comparte sus constantes para mantenerlos sincronizados.

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "stampa-theme";
export const THEME_CHANGE_EVENT = "stampa-theme-change";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

/**
 * Preferencia cuando el usuario todavia no eligio: sigue la apariencia del dispositivo. Los visitantes con SO
 * oscuro ven el aspecto original; con SO claro ven el modo claro.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/** Valores de <meta name="theme-color"> (barra del navegador en mobile). */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: "#171717",
  light: "#f5f3ef",
};

const LIGHT_QUERY = "(prefers-color-scheme: light)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    // Storage bloqueado (modo privado / politicas del navegador): se usa el valor por defecto.
  }
  return DEFAULT_THEME_PREFERENCE;
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

/** Aplica el tema resuelto al documento (atributo, color-scheme y theme-color). */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", THEME_COLORS[resolved]));
  return resolved;
}

export function storePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Sin persistencia: el cambio sigue valiendo durante la sesion de la pestana.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function subscribeThemeChanges(onChange: () => void) {
  const media = window.matchMedia(LIGHT_QUERY);
  // Otra pestana cambio la preferencia: se re-aplica aca y se notifica.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readStoredPreference());
    onChange();
  };
  // Con "system" el tema resuelto sigue al sistema operativo en vivo.
  const onSystemChange = () => {
    if (readStoredPreference() === "system") applyTheme("system");
    onChange();
  };
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onSystemChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onSystemChange);
  };
}

/**
 * Script bloqueante que se inyecta en <head>. Debe ser autocontenido (no puede importar nada) y
 * resolver el tema exactamente igual que `applyTheme`.
 */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;try{var p=null;try{p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}if(p!=="light"&&p!=="dark"&&p!=="system")p=${JSON.stringify(
  DEFAULT_THEME_PREFERENCE,
)};var t=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;d.dataset.theme=t;d.dataset.themePreference=p;d.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?${JSON.stringify(
  THEME_COLORS.light,
)}:${JSON.stringify(THEME_COLORS.dark)})}catch(e){d.dataset.theme="dark"}})();`;
