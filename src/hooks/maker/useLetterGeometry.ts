"use client";

import { useEffect, useMemo, useState } from "react";
import { loadMakerFont } from "@/lib/maker/fonts/registry";
import { createLetterGeometry, createGeometryFromContourPieces } from "@/lib/maker/geometry/createLetterGeometry";
import { designToContourPieces } from "@/lib/maker/import/importDesign";
import type { ImportedDesign } from "@/lib/maker/import/types";
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
export function useLetterGeometry(params: LetterSignParams, importedDesign: ImportedDesign | null = null, fromFile = false): UseLetterGeometryState {
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

  const fieldErrors = useMemo(() => validateLetterSignParams(debounced, { textSource: !fromFile }), [debounced, fromFile]);

  useEffect(() => {
    if (fieldErrors.length > 0) return;

    // Origen archivo (0.5): se resuelve más abajo (fileResult), sin fuente tipográfica.
    if (fromFile) return;

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
  }, [debounced, fieldErrors.length, fromFile, importedDesign]);

  // Origen archivo (0.5): la forma ya viene normalizada a ContourGroups
  // (lib/maker/import) — mismo motor (createGeometryFromContourPieces), sin
  // fuente tipográfica y sin carga asíncrona.
  const fileResult = useMemo(() => {
    if (!fromFile || !importedDesign || fieldErrors.length > 0) return { geometry: null, error: null as string | null };
    try {
      return { geometry: createGeometryFromContourPieces(designToContourPieces(importedDesign), debounced), error: null as string | null };
    } catch (err) {
      return { geometry: null, error: err instanceof Error ? err.message : "No se pudo generar la geometría." };
    }
  }, [fromFile, importedDesign, fieldErrors.length, debounced]);

  if (fromFile) return { geometry: fileResult.geometry, loading: false, error: fileResult.error, fieldErrors };
  return { ...asyncState, fieldErrors };
}
