"use client";

import { useEffect, useRef, useState } from "react";
import { DesignImportError, type ImportedDesign, type PngImportOptions, type RawDesign } from "@/lib/maker/import/types";
import { extractRawDesign, normalizeDesign, type FileDesignSource } from "@/lib/maker/import/importDesign";

export interface UseDesignImportState {
  design: ImportedDesign | null;
  loading: boolean;
  error: string | null;
}

interface Settled {
  file: FileDesignSource;
  heightMm: number;
  optionsKey: string;
  design: ImportedDesign | null;
  error: string | null;
}

const DEBOUNCE_MS = 250;
const MAX_HEIGHT_MM = 2000;

/**
 * Importa un archivo SVG/PNG a ContourGroups (mm) con debounce y estado de
 * carga (ver lib/maker/import). La etapa 1 (SVG parseado / PNG trazado) se
 * cachea por archivo + opciones de PNG: cambiar solo el alto en mm re-ejecuta
 * únicamente la etapa 2 (escala + unión), que es barata. `loading` se deriva
 * de "los insumos actuales todavía no tienen resultado", no de un setState
 * sincrónico dentro del efecto.
 */
export function useDesignImport(file: FileDesignSource | null, heightMm: number, pngOptions: PngImportOptions): UseDesignImportState {
  const [settled, setSettled] = useState<Settled | null>(null);
  const rawCache = useRef<{ file: FileDesignSource; optionsKey: string; raw: RawDesign } | null>(null);
  const optionsKey = JSON.stringify(pngOptions);
  const heightValid = heightMm > 0 && heightMm <= MAX_HEIGHT_MM;

  useEffect(() => {
    if (!file || !heightValid) return;

    // El trabajo corre en el hilo principal: el timeout deja pintar el estado de carga antes.
    const timer = setTimeout(() => {
      try {
        const cached = rawCache.current;
        const reuse = cached && cached.file === file && (file.type === "svg" || cached.optionsKey === optionsKey);
        const raw = reuse ? cached.raw : extractRawDesign(file, pngOptions);
        rawCache.current = { file, optionsKey, raw };
        setSettled({ file, heightMm, optionsKey, design: normalizeDesign(raw, file, heightMm), error: null });
      } catch (err) {
        const error = err instanceof DesignImportError ? err.message : "No se pudo importar el archivo. Verificá que sea un SVG o PNG válido.";
        setSettled({ file, heightMm, optionsKey, design: null, error });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, heightMm, optionsKey, heightValid]);

  if (!file) return { design: null, loading: false, error: null };
  if (!heightValid) return { design: null, loading: false, error: `El alto del diseño debe estar entre 0 y ${MAX_HEIGHT_MM} mm.` };
  if (!settled || settled.file !== file) return { design: null, loading: true, error: null };
  const upToDate = settled.heightMm === heightMm && settled.optionsKey === optionsKey;
  return { design: settled.design, loading: !upToDate, error: upToDate ? settled.error : null };
}
