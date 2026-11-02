"use client";

import { useEffect, useMemo, useState } from "react";
import { createLamp, lampGeometryKey } from "@/lib/maker/lamps/createLamp";
import { selectLampView } from "@/lib/maker/lamps/view";
import type { LampDefinition, LampResult } from "@/lib/maker/lamps/types";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";

const DEBOUNCE_MS = 150;

export interface UseLampGeometryState {
  result: LampResult;
  /** true mientras el debounce no alcanzó la definición actual: no se debe exportar (el STL no coincidiría con lo que se ve). */
  pending: boolean;
  /**
   * true cuando el visor muestra la ÚLTIMA lámpara válida porque los valores actuales no se pueden aplicar (tienen errores): esa vista NO corresponde a
   * los controles. `outdatedReason` es el primer error. Con `outdated` no se exporta nada (`result.errors` no está vacío).
   */
  outdated: boolean;
  outdatedReason: string | null;
}

/**
 * Corre el motor de Lámparas con debounce. Hay UN solo nivel de calidad: lo que ve el visor es la misma malla que se
 * descarga. Cambiar solo el color no regenera nada (la clave de geometría lo ignora) y el cache por pieza del motor
 * evita rehacer la pantalla cuando solo cambia el inserto o la base. Con errores de validación el visor conserva la
 * última lámpara válida, pero `result.errors` bloquea la descarga.
 */
export function useLampGeometry(def: LampDefinition): UseLampGeometryState {
  const [debounced, setDebounced] = useState(def);
  useEffect(() => {
    if (lampGeometryKey(def) === lampGeometryKey(debounced)) return;
    const timer = setTimeout(() => setDebounced(def), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [def, debounced]);

  const key = lampGeometryKey(debounced);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- la clave serializa toda la definición que importa a la geometría
  const computed = useMemo(() => createLamp(debounced, { printer: getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID) }), [key]);
  const [lastValid, setLastValid] = useState<LampResult | null>(null);
  if (computed.geometry && computed !== lastValid) setLastValid(computed);

  return { ...selectLampView(computed, lastValid), pending: lampGeometryKey(def) !== key };
}
