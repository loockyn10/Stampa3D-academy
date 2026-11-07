/**
 * Preferencia de sidebar contraído (escritorio).
 *
 * El estado vive en `<html data-sidebar="collapsed">` y en localStorage. Un script inline en <head> lo aplica
 * ANTES del primer pintado, y el ancho se resuelve solo con CSS (`.app-sidebar` en globals.css): al recargar no hay
 * salto de layout ni diferencia entre servidor y cliente. Mismo enfoque que el tema (lib/theme/theme.ts).
 */

export const SIDEBAR_STORAGE_KEY = "stampa-sidebar-collapsed";
export const SIDEBAR_ATTRIBUTE = "data-sidebar";
export const SIDEBAR_COLLAPSED_VALUE = "collapsed";
export const SIDEBAR_CHANGE_EVENT = "stampa-sidebar-change";

/** Script inline: aplica la preferencia guardada antes de pintar. Falla en silencio si el storage no está disponible. */
export const SIDEBAR_INIT_SCRIPT = `(function(){try{if(window.localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})==="1"){document.documentElement.setAttribute(${JSON.stringify(SIDEBAR_ATTRIBUTE)},${JSON.stringify(SIDEBAR_COLLAPSED_VALUE)});}}catch(e){}})();`;

export function readSidebarCollapsed(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE) === SIDEBAR_COLLAPSED_VALUE;
}

function applyAttribute(collapsed: boolean) {
  if (collapsed) document.documentElement.setAttribute(SIDEBAR_ATTRIBUTE, SIDEBAR_COLLAPSED_VALUE);
  else document.documentElement.removeAttribute(SIDEBAR_ATTRIBUTE);
}

/** Guarda la preferencia, actualiza <html> y avisa a los componentes suscriptos. */
export function writeSidebarCollapsed(collapsed: boolean): void {
  if (typeof document === "undefined") return;
  applyAttribute(collapsed);
  try {
    if (collapsed) window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "1");
    else window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    // Storage bloqueado (modo privado, política del navegador): la preferencia vale solo para esta pestaña.
  }
  window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
}

/** Suscripción para `useSyncExternalStore`; también sigue los cambios hechos desde otra pestaña. */
export function subscribeSidebarPreference(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SIDEBAR_STORAGE_KEY) return;
    applyAttribute(event.newValue === "1");
    onChange();
  };
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
