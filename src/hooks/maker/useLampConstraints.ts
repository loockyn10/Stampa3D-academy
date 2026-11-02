"use client";

import { useEffect, useMemo, useState } from "react";
import { computeControlRange, rangeCacheKey, specsFor, type ControlRange } from "@/lib/maker/lamps/constraints";
import { lampGeometryKey } from "@/lib/maker/lamps/createLamp";
import type { LampDefinition } from "@/lib/maker/lamps/types";

/** Espera sin cambios antes de recalcular: mientras se arrastra un slider no se recalcula nada (el rango del propio control no depende de su valor). */
const IDLE_MS = 280;
const CACHE_SIZE = 600;
/** Rangos ya calculados por (control + toda la definición menos el valor del control). Es la fuente de verdad: el hook solo la lee y la completa. */
const cache = new Map<string, ControlRange>();
/** Último rango conocido de cada control: se muestra atenuado mientras se recalcula el que corresponde a los valores nuevos. */
const lastKnown = new Map<string, ControlRange>();

export interface LampRangeState {
  /** Rango de cada control de la pantalla activa (el vigente si ya se calculó; si no, el último conocido, marcado en `stale`). */
  ranges: Record<string, ControlRange>;
  /** Controles cuyo rango todavía no corresponde a los valores actuales (se está recalculando): la interfaz los muestra atenuados. */
  stale: ReadonlySet<string>;
  computing: boolean;
}

/**
 * Calcula los rangos válidos de los controles (`constraints.ts`) en tandas, sin bloquear la interfaz: primero los controles principales y,
 * si `advanced`, el resto. Cada control se resuelve en su propio turno del navegador; si la definición cambia mientras tanto, la tanda se cancela y
 * empieza otra. El cache usa como clave toda la definición menos el valor del propio control: arrastrar un slider reutiliza su rango.
 */
export function useLampConstraints(def: LampDefinition, advanced: boolean): LampRangeState {
  const [tick, setTick] = useState(0);
  const geometryKey = lampGeometryKey(def);

  const wanted = useMemo(
    () => specsFor(def).filter((s) => advanced || s.main || s.path === "thread.majorDiameterMm"),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depende de la definición serializada
    [geometryKey, advanced],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = wanted.filter((s) => !cache.has(rangeCacheKey(def, s.path)));
    if (pending.length === 0) return;
    let i = 0;
    const step = () => {
      if (cancelled) return;
      const spec = pending[i++];
      try {
        const range = computeControlRange(def, spec);
        cache.set(rangeCacheKey(def, spec.path), range);
        lastKnown.set(spec.path, range);
        while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
      } catch {
        // un control sin rango calculable conserva el anterior (la validación del motor sigue bloqueando lo inválido)
      }
      setTick((t) => t + 1);
      if (i < pending.length) timer = setTimeout(step, 0);
    };
    timer = setTimeout(step, IDLE_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `def` entra por su clave serializada
  }, [geometryKey, wanted]);

  return useMemo(() => {
    const ranges: Record<string, ControlRange> = {};
    const stale = new Set<string>();
    for (const spec of wanted) {
      const hit = cache.get(rangeCacheKey(def, spec.path));
      if (hit) {
        ranges[spec.path] = hit;
        lastKnown.set(spec.path, hit);
      } else {
        const old = lastKnown.get(spec.path);
        if (old) ranges[spec.path] = old;
        stale.add(spec.path);
      }
    }
    return { ranges, stale, computing: stale.size > 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se recalcula cuando cambia la definición o llega un rango nuevo (`tick`)
  }, [geometryKey, wanted, tick]);
}
