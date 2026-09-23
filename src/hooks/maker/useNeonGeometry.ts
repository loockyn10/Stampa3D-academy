"use client";

import { useEffect, useMemo, useState } from "react";
import { buildNeonPaths, createNeonGeometry, type NeonGeometryResult } from "@/lib/maker/neon/createNeonGeometry";
import { validateNeonParams, type NeonFieldError } from "@/lib/maker/neon/validation/validateNeonParams";
import type { NeonParams, NeonSource } from "@/lib/maker/neon/types";
import type { RasterConversion } from "@/lib/maker/neon/raster/types";
import type { NeonInstallationOverrides, NeonInstallationRecipe } from "@/lib/maker/neon/installation/types";

const DEBOUNCE_MS = 200;

export interface NeonInstallationInput {
  recipe: NeonInstallationRecipe;
  overrides: NeonInstallationOverrides;
}

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
 * Corre el pipeline Neon (fuente -> NeonPaths -> canal U [+ Instalación]) con
 * debounce. El parseo del SVG/texto/imagen SOLO se repite cuando cambia la fuente o el
 * alto del diseño: mover el ancho del Neon, la holgura, las paredes o cualquier ajuste
 * de Instalación (cableado, pass-through, puentes, clips, overrides del editor manual)
 * reutiliza los NeonPaths ya parseados — Sección 59 del pedido de Instalación 0.3:
 * "mover pass-through manual no reprocesa PNG/skeleton". `source`/`installation` deben
 * ser estables entre renders (useMemo/useState en la página).
 */
export function useNeonGeometry(source: NeonSource | null, params: NeonParams, installation?: NeonInstallationInput): UseNeonGeometryState {
  const [debounced, setDebounced] = useState({ source, params, installation });
  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ source, params, installation }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source, params, installation]);

  const fieldErrors = useMemo(() => validateNeonParams(debounced.params), [debounced.params]);
  const designHeightMm = debounced.params.designHeightMm;
  const valid = fieldErrors.length === 0;

  const paths = useMemo(() => {
    if (!debounced.source || !valid) return null;
    return buildNeonPaths(debounced.source, designHeightMm);
  }, [debounced.source, designHeightMm, valid]);

  const computed = useMemo(() => {
    if (!paths || !paths.ok || !valid) return null;
    return createNeonGeometry(paths.result.paths, debounced.params, paths.result.issues, debounced.installation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths, debounced.params, debounced.installation, valid]);

  // Con parámetros inválidos se conserva el último resultado válido (la UI ya bloquea la descarga vía fieldErrors).
  const [last, setLast] = useState<NeonGeometryResult | null>(null);
  if (computed && computed !== last) setLast(computed);
  const result = valid ? computed : last;

  return {
    result,
    inputError: paths && !paths.ok ? paths.message : null,
    fieldErrors,
    raster: paths && paths.ok ? (paths.result.raster ?? null) : null,
    pending: debounced.source !== source || debounced.params !== params || debounced.installation !== installation,
  };
}
