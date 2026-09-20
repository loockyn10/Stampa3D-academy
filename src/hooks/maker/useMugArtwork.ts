"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IMPORT_LIMITS } from "@/lib/maker/import/types";
import { loadMakerFont, MAKER_FONTS } from "@/lib/maker/fonts/registry";
import { prepareSvgArt } from "@/lib/maker/mugs/decorations/artwork";
import { createArtworkProvider, type MugAsset, type MugFonts } from "@/lib/maker/mugs/decorations/artworkProvider";
import { ingestRasterFile } from "@/lib/maker/neon/raster/ingestRasterFile";

export type AddAssetResult = { ok: true; asset: MugAsset } | { ok: false; message: string };

/**
 * Assets (SVG / PNG / JPG) y fuentes de las decoraciones de Jarros. Carga las fuentes de Maker una sola vez, guarda
 * los archivos originales por `assetId` y expone el proveedor de arte que consume el motor (cacheado por contenido:
 * mover / escalar / cambiar la profundidad no vuelve a parsear ni a decodificar).
 */
export function useMugArtwork() {
  const [assets, setAssets] = useState<ReadonlyMap<string, MugAsset>>(() => new Map());
  const [fonts, setFonts] = useState<MugFonts>({});

  useEffect(() => {
    let alive = true;
    for (const def of MAKER_FONTS) {
      loadMakerFont(def.id)
        .then((font) => alive && setFonts((prev) => ({ ...prev, [def.id]: font })))
        .catch(() => undefined); // sin fuente, las decoraciones de texto se omiten con un aviso
    }
    return () => {
      alive = false;
    };
  }, []);

  const provider = useMemo(() => createArtworkProvider(assets, fonts), [assets, fonts]);

  const put = useCallback((asset: MugAsset) => setAssets((prev) => new Map(prev).set(asset.id, asset)), []);

  const addSvg = useCallback(
    async (file: File): Promise<AddAssetResult> => {
      if (!/\.svg$/i.test(file.name)) return { ok: false, message: "Formato no soportado. Subí un archivo .svg." };
      if (file.size > IMPORT_LIMITS.maxFileBytes) return { ok: false, message: "El archivo es demasiado grande (máximo 10 MB)." };
      try {
        const content = await file.text();
        const probe = prepareSvgArt(content);
        if (!probe.ok) return { ok: false, message: probe.message };
        const asset: MugAsset = { id: crypto.randomUUID(), kind: "svg", fileName: file.name, content };
        put(asset);
        return { ok: true, asset };
      } catch {
        return { ok: false, message: "No se pudo leer el archivo." };
      }
    },
    [put],
  );

  const addRaster = useCallback(
    async (file: File): Promise<AddAssetResult> => {
      // El formato lo decide el CONTENIDO (firma), igual que en Neon; cada fallo tiene su mensaje.
      const ingested = await ingestRasterFile(file);
      if (!ingested.ok || !ingested.bytes) return { ok: false, message: ingested.ok ? "No se pudo leer el archivo." : ingested.message };
      const asset: MugAsset = { id: crypto.randomUUID(), kind: "raster", format: ingested.kind, fileName: file.name, bytes: ingested.bytes };
      put(asset);
      return { ok: true, asset };
    },
    [put],
  );

  const replaceAssets = useCallback((next: Iterable<MugAsset>) => setAssets(new Map([...next].map((a) => [a.id, a]))), []);

  return { assets, provider, addSvg, addRaster, replaceAssets };
}
