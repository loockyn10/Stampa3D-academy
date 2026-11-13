"use client";

import { useCallback, useSyncExternalStore } from "react";
import { newSavedLampId, parseSavedLampDesigns, removeSavedLampDesign, SAVED_LAMPS_KEY, upsertSavedLampDesign, type SavedLampDesign } from "@/lib/maker/lamps/savedDesigns";

const EMPTY: SavedLampDesign[] = [];
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedList: SavedLampDesign[] = EMPTY;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(SAVED_LAMPS_KEY);
  } catch {
    return null;
  }
}

/** Instantánea estable de la lista guardada (misma referencia mientras el texto guardado no cambie). */
function getSnapshot(): SavedLampDesign[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parseSavedLampDesigns(raw);
  }
  return cachedList;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function persist(next: SavedLampDesign[]): boolean {
  try {
    window.localStorage.setItem(SAVED_LAMPS_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  listeners.forEach((l) => l());
  return true;
}

/**
 * Diseños guardados en este navegador. El servidor renderiza la lista vacía y el cliente lee `localStorage` al hidratar; si el navegador bloquea el
 * almacenamiento, `save` devuelve null y la lista queda vacía: el editor sigue funcionando y el código del diseño (copiar / pegar) es el respaldo.
 */
export function useSavedLampDesigns() {
  const items = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  /** Guarda el diseño (nuevo, o reemplaza el `id` dado). Devuelve el id o null si el navegador no dejó guardar. */
  const save = useCallback((name: string, code: string, id?: string | null): string | null => {
    const now = Date.now();
    const savedId = id ?? newSavedLampId(now);
    return persist(upsertSavedLampDesign(getSnapshot(), { id: savedId, name, code, now })) ? savedId : null;
  }, []);
  const remove = useCallback((id: string) => void persist(removeSavedLampDesign(getSnapshot(), id)), []);
  return { items, save, remove };
}
