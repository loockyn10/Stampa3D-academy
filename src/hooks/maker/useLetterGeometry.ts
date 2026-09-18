"use client";

import { useEffect, useMemo, useState } from "react";
import { loadMakerFont } from "@/lib/maker/fonts/registry";
import { createLetterGeometry } from "@/lib/maker/geometry/createLetterGeometry";
import { validateLetterSignParams, type FieldError } from "@/lib/maker/validation";
import type { LetterGeometryResult, LetterSignParams } from "@/lib/maker/types";

export interface UseLetterGeometryState {
  geometry: LetterGeometryResult | null;
  loading: boolean;
  error: string | null;
  fieldErrors: FieldError[];
}

interface AsyncGeometryState {
  geometry: LetterGeometryResult | null;
  loading: boolean;
  error: string | null;
}

const DEBOUNCE_MS = 200;

/**
 * Corre el pipeline geométrico de Stampa Maker con debounce, separado del
 * render de UI y del preview 3D (ver src/lib/maker/geometry).
 *
 * Mientras el texto/parámetros no validan, se conserva la última geometría
 * válida (el panel de controles ya bloquea la descarga vía fieldErrors).
 */
export function useLetterGeometry(params: LetterSignParams): UseLetterGeometryState {
  const [debounced, setDebounced] = useState(params);
  const [asyncState, setAsyncState] = useState<AsyncGeometryState>({
    geometry: null,
    loading: true,
    error: null,
  });

  // Depende de una serialización de `params` en vez de enumerar cada campo
  // individualmente: LetterSignParams crece con cada sistema de cuerpo/
  // frente nuevo (0.4+) y una lista manual de campos es fácil de olvidar
  // actualizar (un campo nuevo sin agregar acá rompería el debounce en
  // silencio para ese campo). `params` cambia de identidad en cada patch
  // (ver page.tsx#handleChange), así que comparar por valor es necesario
  // para no reiniciar el timer en cada render sin cambios reales.
  const paramsKey = JSON.stringify(params);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(params), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  const fieldErrors = useMemo(() => validateLetterSignParams(debounced), [debounced]);

  useEffect(() => {
    if (fieldErrors.length > 0) return;

    let cancelled = false;
    setAsyncState((prev) => ({ ...prev, loading: true, error: null }));

    loadMakerFont(debounced.fontId)
      .then((font) => {
        if (cancelled) return;
        try {
          const geometry = createLetterGeometry(font, debounced);
          setAsyncState({ geometry, loading: false, error: null });
        } catch (err) {
          setAsyncState({
            geometry: null,
            loading: false,
            error: err instanceof Error ? err.message : "No se pudo generar la geometría.",
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setAsyncState({
          geometry: null,
          loading: false,
          error: err instanceof Error ? err.message : "No se pudo cargar la fuente seleccionada.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [debounced, fieldErrors.length]);

  return { ...asyncState, fieldErrors };
}
