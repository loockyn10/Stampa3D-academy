import { AMBIENT_TIMING } from "@/lib/stl/preview-media";

/**
 * Coordinador del ciclo ambiental de previews 360° de la Librería STL (sin DOM ni React: testeable en Node).
 *
 * Reglas:
 *  - Como máximo UNA card activa a la vez (`activeId`).
 *  - Sin interacción: se recorren las cards candidatas (con preview, visibles, sin error, sin reduced-motion)
 *    en orden de registro: A -> B -> C -> A. Cada preview dura una vuelta (evento `ended`, sin loop).
 *  - Hover/focus tienen prioridad absoluta: cortan el ciclo y reproducen esa card (se repite mientras dure).
 *    Al salir, el ciclo vuelve tras `resumeDelayMs`, continuando desde la card siguiente a la última.
 *  - Una card que sale del viewport o falla deja de ser activa y el ciclo sigue con otra.
 */

export interface CycleCardState {
  /** Card con preview utilizable (hay preview_url y no hay reduced-motion). */
  eligible: boolean;
  /** Suficientemente visible en el viewport. */
  inView: boolean;
}

export interface CycleSnapshot {
  active: boolean;
  /** Cambia en cada (re)inicio: la card reinicia el video aunque siga activa (repetición en hover). */
  token: number;
}

export interface PreviewCycleDeps {
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

interface Entry {
  state: CycleCardState;
  failed: boolean;
  listener: (snapshot: CycleSnapshot) => void;
}

export function createPreviewCycle(deps: PreviewCycleDeps = {}) {
  const setT = deps.setTimeoutFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimeoutFn ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const entries = new Map<string, Entry>();
  let activeId: string | null = null;
  let priorityId: string | null = null;
  let cursor: string | null = null;
  let token = 0;
  let timer: unknown = null;
  let suspended = false;

  const isCandidate = (id: string): boolean => {
    const entry = entries.get(id);
    return Boolean(entry && entry.state.eligible && entry.state.inView && !entry.failed);
  };

  const notify = () => {
    for (const [id, entry] of entries) entry.listener({ active: id === activeId, token });
  };

  const clearTimer = () => {
    if (timer !== null) clearT(timer);
    timer = null;
  };

  const schedule = (delay: number) => {
    clearTimer();
    if (suspended) return;
    timer = setT(() => {
      timer = null;
      advance();
    }, delay);
  };

  /** Siguiente candidata después de `cursor`, dando la vuelta; la propia `cursor` queda última. */
  const pickNext = (): string | null => {
    const ids = [...entries.keys()];
    if (ids.length === 0) return null;
    const start = cursor === null ? -1 : ids.indexOf(cursor);
    for (let step = 1; step <= ids.length; step += 1) {
      const id = ids[(start + step + ids.length) % ids.length];
      if (isCandidate(id)) return id;
    }
    return null;
  };

  function advance() {
    if (suspended || priorityId !== null || activeId !== null) return;
    const next = pickNext();
    if (!next) return;
    activeId = next;
    cursor = next;
    token += 1;
    notify();
  }

  /** Si no hay nada activo ni agendado y existe una candidata, agenda el arranque. */
  const reconcile = (delay: number = AMBIENT_TIMING.startDelayMs) => {
    if (suspended || priorityId !== null) return;
    if (activeId !== null) {
      if (isCandidate(activeId)) return;
      cursor = activeId;
      activeId = null;
      notify();
      schedule(AMBIENT_TIMING.recoverDelayMs);
      return;
    }
    if (timer !== null) return;
    if ([...entries.keys()].some(isCandidate)) schedule(delay);
  };

  const otherCandidates = (id: string) => [...entries.keys()].some((other) => other !== id && isCandidate(other));

  return {
    /** Registra una card; devuelve la función para darla de baja. */
    register(id: string, listener: (snapshot: CycleSnapshot) => void): () => void {
      entries.set(id, { state: { eligible: false, inView: false }, failed: false, listener });
      return () => {
        entries.delete(id);
        if (priorityId === id) priorityId = null;
        if (activeId === id) {
          cursor = id;
          activeId = null;
          notify();
          schedule(AMBIENT_TIMING.recoverDelayMs);
        }
        if (cursor === id) cursor = null;
      };
    },

    update(id: string, patch: Partial<CycleCardState>): void {
      const entry = entries.get(id);
      if (!entry) return;
      entry.state = { ...entry.state, ...patch };
      if (priorityId === id && !entry.state.eligible) priorityId = null;
      reconcile();
    },

    /** Hover o focus: prioridad absoluta. */
    interactStart(id: string): void {
      const entry = entries.get(id);
      if (!entry || !entry.state.eligible || entry.failed) return;
      clearTimer();
      priorityId = id;
      activeId = id;
      cursor = id;
      token += 1;
      notify();
    },

    /** Fin de hover/focus: el ciclo vuelve tras una pausa. */
    interactEnd(id: string): void {
      if (priorityId !== id) return;
      priorityId = null;
      if (activeId === id) {
        activeId = null;
        notify();
      }
      cursor = id;
      schedule(AMBIENT_TIMING.resumeDelayMs);
    },

    /** El video terminó su vuelta. */
    ended(id: string): void {
      if (id !== activeId) return;
      if (priorityId === id) {
        token += 1; // sigue el hover: repite
        notify();
        return;
      }
      cursor = id;
      activeId = null;
      notify();
      schedule(otherCandidates(id) ? AMBIENT_TIMING.betweenDelayMs : AMBIENT_TIMING.soloDelayMs);
    },

    /** El video falló: la card queda fuera del ciclo y se sigue con la próxima. */
    failed(id: string): void {
      const entry = entries.get(id);
      if (!entry) return;
      entry.failed = true;
      if (priorityId === id) priorityId = null;
      if (activeId === id) {
        cursor = id;
        activeId = null;
        notify();
        schedule(AMBIENT_TIMING.recoverDelayMs);
      }
    },

    /** Pestaña oculta: nada se reproduce; al volver el ciclo se reanuda. */
    setSuspended(value: boolean): void {
      if (suspended === value) return;
      suspended = value;
      if (value) {
        clearTimer();
        if (priorityId === null && activeId !== null) {
          cursor = activeId;
          activeId = null;
          notify();
        }
      } else {
        reconcile();
      }
    },

    getActiveId: () => activeId,
    size: () => entries.size,
  };
}

export type PreviewCycle = ReturnType<typeof createPreviewCycle>;

let shared: PreviewCycle | null = null;

/** Coordinador único de la página (todas las cards comparten el mismo). */
export function getPreviewCycle(): PreviewCycle {
  if (!shared) {
    shared = createPreviewCycle();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => shared?.setSuspended(document.visibilityState === "hidden"));
    }
  }
  return shared;
}
