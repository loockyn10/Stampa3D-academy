"use client";

import { useEffect, useMemo, useState } from "react";
import { createMug, type MugResult } from "@/lib/maker/mugs/createMug";
import type { MugArtworkProvider } from "@/lib/maker/mugs/decorations/artworkProvider";
import type { MugDefinition } from "@/lib/maker/mugs/types";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";

const DEBOUNCE_MS = 150;

export interface UseMugGeometryState {
  result: MugResult;
  /** true mientras el debounce no alcanzó la definición actual. */
  pending: boolean;
}

/**
 * Corre el motor de Jarros con debounce y calidad PREVIEW (pocos segmentos: los sliders se sienten interactivos).
 * El STL se regenera aparte en calidad export al descargar (ver la página). Con errores de validación se conserva
 * el último modelo válido en el viewport, pero `result.errors` bloquea la descarga.
 */
export function useMugGeometry(def: MugDefinition, artwork: MugArtworkProvider): UseMugGeometryState {
  const [debounced, setDebounced] = useState({ def, artwork });
  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ def, artwork }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [def, artwork]);

  const computed = useMemo(() => createMug(debounced.def, { quality: "preview", printer: getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID), artwork: debounced.artwork }), [debounced]);
  const [lastValid, setLastValid] = useState<MugResult | null>(null);
  if (computed.geometry && computed !== lastValid) setLastValid(computed);

  // Con errores: el viewport muestra el último modelo válido; errores/warnings son los actuales.
  const result: MugResult = computed.geometry || !lastValid ? computed : { ...lastValid, errors: computed.errors, warnings: computed.warnings };
  return { result, pending: debounced.def !== def || debounced.artwork !== artwork };
}
