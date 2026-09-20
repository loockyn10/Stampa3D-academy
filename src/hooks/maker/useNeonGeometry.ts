"use client";

import { useEffect, useMemo, useState } from "react";
import { buildNeonPaths, createNeonGeometry, type NeonGeometryResult } from "@/lib/maker/neon/createNeonGeometry";
import { validateNeonParams, type NeonFieldError } from "@/lib/maker/neon/validation/validateNeonParams";
import type { NeonParams, NeonSource } from "@/lib/maker/neon/types";
import type { RasterConversion } from "@/lib/maker/neon/raster/types";

const DEBOUNCE_MS = 200;

export interface UseNeonGeometryState {
  result: NeonGeometryResult | null;
  /** Error de entrada (texto vacío, SVG con formas rellenas, SVG inseguro...) con mensaje listo para la UI. */
  inputError: string | null;
  fieldErrors: NeonFieldError[];
  /** Origen imagen: máscara + paths en px + estadísticas de la conversión (null si no aplica o falló). */
  raster: Pick<RasterConversion, "preview" | "stats"> | null;
  /** true mientras el debounce no alcanzó los valores actuales. */
  pending: boolean;
}

/**
 * Corre el pipeline Neon (fuente -> NeonPaths -> canal U) con debounce. El
 * parseo del SVG/texto solo se repite cuando cambia la fuente o el alto del
 * diseño: mover el ancho del Neon, la holgura o las paredes reutiliza los
 * NeonPaths. `source` debe ser estable entre renders (useMemo en la página).
 */
export function useNeonGeometry(source: NeonSource | null, params: NeonParams): UseNeonGeometryState {
  const [debounced, setDebounced] = useState({ source, params });
  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ source, params }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source, params]);

  const fieldErrors = useMemo(() => validateNeonParams(debounced.params), [debounced.params]);
  const designHeightMm = debounced.params.designHeightMm;
  const valid = fieldErrors.length === 0;

  const paths = useMemo(() => {
    if (!debounced.source || !valid) return null;
    return buildNeonPaths(debounced.source, designHeightMm);
  }, [debounced.source, designHeightMm, valid]);

  const computed = useMemo(() => {
    if (!paths || !paths.ok || !valid) return null;
    return createNeonGeometry(paths.result.paths, debounced.params, paths.result.issues);
  }, [paths, debounced.params, valid]);

  // Con parámetros inválidos se conserva el último resultado válido (la UI ya bloquea la descarga vía fieldErrors).
  const [last, setLast] = useState<NeonGeometryResult | null>(null);
  if (computed && computed !== last) setLast(computed);
  const result = valid ? computed : last;

  return {
    result,
    inputError: paths && !paths.ok ? paths.message : null,
    fieldErrors,
    raster: paths && paths.ok ? (paths.result.raster ?? null) : null,
    pending: debounced.source !== source || debounced.params !== params,
  };
}
