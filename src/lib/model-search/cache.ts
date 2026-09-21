/**
 * Cache temporal en memoria (por instancia del servidor). Reduce latencia y requests externas sin construir un
 * catálogo: solo guarda páginas de resultados por minutos y respeta el borrado rápido que piden las fuentes.
 */
export interface TtlCache<T> {
  get(key: string, now?: number): T | undefined;
  set(key: string, value: T, now?: number): void;
  clear(): void;
  size(): number;
}

export function createTtlCache<T>(ttlMs: number, maxEntries: number): TtlCache<T> {
  const store = new Map<string, { value: T; expiresAt: number }>();
  return {
    get(key, now = Date.now()) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, now = Date.now()) {
      if (store.size >= maxEntries) {
        for (const [existingKey, entry] of store) {
          if (entry.expiresAt <= now) store.delete(existingKey);
        }
        // Sigue lleno: descartar las más antiguas (orden de inserción de Map).
        while (store.size >= maxEntries) {
          const oldest = store.keys().next().value;
          if (oldest === undefined) break;
          store.delete(oldest);
        }
      }
      store.set(key, { value, expiresAt: now + ttlMs });
    },
    clear: () => store.clear(),
    size: () => store.size,
  };
}
