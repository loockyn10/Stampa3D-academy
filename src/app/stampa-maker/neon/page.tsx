"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { MakerNeonControls, NeonExportCard } from "@/components/maker/MakerNeonControls";
import { MakerNeonProjectsPanel } from "@/components/maker/MakerNeonProjectsPanel";
import { MakerViewport, type MakerDisplayMode } from "@/components/maker/MakerViewport";
import { BedLabel, BedWarnings, ViewportViewCard } from "@/components/maker/MakerViewportOverlays";
import { useNeonGeometry } from "@/hooks/maker/useNeonGeometry";
import { useNeonProjects, type NeonFileSource } from "@/hooks/maker/useNeonProjects";
import type { LoadedNeonProject, NeonWorkState } from "@/lib/maker/neon/projects/neonProjectData";
import { exportWord } from "@/lib/maker/exporters/exportWord";
import { IMPORT_LIMITS } from "@/lib/maker/import/types";
import { DEFAULT_RASTER_SETTINGS, RASTER_LIMITS, type RasterSettings } from "@/lib/maker/neon/raster/types";
import { sniffRasterKind } from "@/lib/maker/neon/raster/decodeRasterImage";
import { LETTER_SPACING_MAX_PCT, LETTER_SPACING_MIN_PCT } from "@/lib/maker/neon/paths/textToNeonPaths";
import { DEFAULT_LETTER_SPACING_PCT, DEFAULT_NEON_FONT_ID, DEFAULT_NEON_PARAMS, DEFAULT_NEON_TEXT } from "@/lib/maker/neon/defaults";
import type { NeonFontId, NeonParams, NeonSource, NeonSourceType } from "@/lib/maker/neon/types";
import { collectBedItems, computeBedLayout } from "@/lib/maker/printBed/bedLayout";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";

export default function StampaMakerNeonPage() {
  const [params, setParams] = useState<NeonParams>(DEFAULT_NEON_PARAMS);
  const [sourceType, setSourceType] = useState<NeonSourceType>("text");
  const [text, setText] = useState(DEFAULT_NEON_TEXT);
  const [fontId, setFontId] = useState<NeonFontId>(DEFAULT_NEON_FONT_ID);
  const [letterSpacingPct, setLetterSpacingPct] = useState(DEFAULT_LETTER_SPACING_PCT);
  // Los archivos se guardan como NeonFileSource (misma identidad de objeto que ve el hook de proyectos).
  const [svgFile, setSvgFile] = useState<Extract<NeonFileSource, { kind: "svg" }> | null>(null);
  const [imageFile, setImageFile] = useState<Extract<NeonFileSource, { kind: "png" | "jpg" }> | null>(null);
  const [raster, setRaster] = useState<RasterSettings>(DEFAULT_RASTER_SETTINGS);
  const [fileError, setFileError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useAppFeedback();

  // Estado puramente visual, igual que en Carteles (no viaja a la exportación).
  const [displayMode, setDisplayMode] = useState<MakerDisplayMode>("model");
  const [plateIndex, setPlateIndex] = useState(1);

  const source = useMemo<NeonSource | null>(() => {
    // Fuera de rango se acota (el panel muestra el error de campo); NaN/vacío = espaciado recomendado.
    const spacing = Number.isFinite(letterSpacingPct) ? Math.min(Math.max(letterSpacingPct, LETTER_SPACING_MIN_PCT), LETTER_SPACING_MAX_PCT) : 0;
    if (sourceType === "text") return { type: "text", text, fontId, letterSpacingPct: spacing };
    if (sourceType === "image") return imageFile ? { type: "image", fileName: imageFile.fileName, bytes: imageFile.bytes, kind: imageFile.kind, raster } : null;
    return svgFile ? { type: "svg", fileName: svgFile.fileName, content: svgFile.content, fontId, letterSpacingPct: spacing } : null;
  }, [sourceType, text, fontId, letterSpacingPct, svgFile, imageFile, raster]);

  const { result, inputError, fieldErrors, raster: rasterConversion, pending } = useNeonGeometry(source, params);

  const handleChange = useCallback((patch: Partial<NeonParams>) => setParams((prev) => ({ ...prev, ...patch })), []);

  const handleFile = useCallback(async (picked: File) => {
    setFileError(null);
    if (sourceType === "image") {
      if (picked.size > RASTER_LIMITS.maxFileBytes) {
        setFileError("El archivo es demasiado grande (máximo 10 MB).");
        return;
      }
      try {
        const bytes = new Uint8Array(await picked.arrayBuffer());
        // El formato lo decide la FIRMA del archivo, no la extensión ni el MIME.
        const kind = sniffRasterKind(bytes);
        if (!kind) {
          setFileError("Formato no soportado. Subí una imagen PNG o JPG.");
          return;
        }
        setImageFile({ kind, fileName: picked.name, bytes });
        // El JPEG trae artefactos de compresión alrededor de los bordes: arranca con una limpieza media (se puede cambiar)
        // y siempre en luminosidad (no tiene transparencia). Los mismos controles que el PNG.
        if (kind === "jpg") setRaster((prev) => ({ ...prev, detectionMode: "luminance", cleaning: prev.cleaning < 2 ? 2 : prev.cleaning }));
      } catch {
        setFileError("No se pudo leer el archivo.");
      }
      return;
    }
    if (!/\.svg$/i.test(picked.name)) {
      setFileError("Formato no soportado. Neon LED acepta archivos .svg de líneas/trazos.");
      return;
    }
    if (picked.size > IMPORT_LIMITS.maxFileBytes) {
      setFileError("El archivo es demasiado grande (máximo 10 MB).");
      return;
    }
    try {
      setSvgFile({ kind: "svg", fileName: picked.name, content: await picked.text() });
    } catch {
      setFileError("No se pudo leer el archivo.");
    }
  }, [sourceType]);

  // --- Proyectos (guardar / abrir): origen + receta, nunca el skeleton ---
  const file: NeonFileSource | null = sourceType === "image" ? imageFile : sourceType === "svg" ? svgFile : null;
  const work: NeonWorkState = useMemo(
    () => ({
      params,
      sourceType,
      text,
      fontId,
      letterSpacingPct,
      raster,
      fileMeta: file
        ? { kind: file.kind, fileName: file.fileName, sizeBytes: file.kind === "svg" ? new TextEncoder().encode(file.content).length : file.bytes.length }
        : null,
    }),
    [params, sourceType, text, fontId, letterSpacingPct, raster, file],
  );
  const handleLoadWork = useCallback((loaded: LoadedNeonProject, loadedFile: NeonFileSource | null) => {
    setParams(loaded.params);
    setSourceType(loaded.sourceType);
    setText(loaded.text);
    setFontId(loaded.fontId);
    setLetterSpacingPct(loaded.letterSpacingPct);
    setRaster(loaded.raster);
    setFileError(null);
    if (loadedFile?.kind === "svg") setSvgFile(loadedFile);
    else if (loadedFile) setImageFile(loadedFile);
  }, []);
  const handleResetWork = useCallback((): NeonWorkState => {
    setParams(DEFAULT_NEON_PARAMS);
    setSourceType("text");
    setText(DEFAULT_NEON_TEXT);
    setFontId(DEFAULT_NEON_FONT_ID);
    setLetterSpacingPct(DEFAULT_LETTER_SPACING_PCT);
    setRaster({ ...DEFAULT_RASTER_SETTINGS });
    setSvgFile(null);
    setImageFile(null);
    setFileError(null);
    return {
      params: DEFAULT_NEON_PARAMS,
      sourceType: "text",
      text: DEFAULT_NEON_TEXT,
      fontId: DEFAULT_NEON_FONT_ID,
      letterSpacingPct: DEFAULT_LETTER_SPACING_PCT,
      raster: { ...DEFAULT_RASTER_SETTINGS },
      fileMeta: null,
    };
  }, []);
  const library = useNeonProjects({ work, file, onLoad: handleLoadWork, onReset: handleResetWork });

  const geometry = result?.geometry ?? null;
  const errors = result?.errors ?? [];
  const canDownload = !!geometry && geometry.triangleCount > 0 && errors.length === 0 && fieldErrors.length === 0 && !inputError;

  const baseFileName =
    sourceType === "image"
      ? `neon-${imageFile?.fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imagen"}`
      : sourceType === "svg"
      ? `neon-${svgFile?.fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "diseno"}`
      : `neon-${text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "texto"}`;

  const handleDownload = useCallback(async () => {
    if (!geometry) return;
    setDownloading(true);
    try {
      await exportWord(geometry, baseFileName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo exportar el STL.");
    } finally {
      setDownloading(false);
    }
  }, [geometry, baseFileName, toast]);

  // Vista Cama: mismo perfil, packing y orientación que Carteles (body = identidad: piso contra la cama, U hacia arriba).
  const profile = getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID);
  const shownGeometry = inputError ? null : geometry;
  const bed = useMemo(() => {
    if (displayMode !== "bed" || !shownGeometry) return null;
    const items = collectBedItems(shownGeometry);
    return { items, layout: computeBedLayout(items, profile) };
  }, [displayMode, shownGeometry, profile]);
  const plateCount = bed?.layout.plates.length ?? 0;
  const currentPlate = Math.min(Math.max(plateIndex, 1), Math.max(plateCount, 1));

  return (
    <div className="flex flex-col gap-4 lg:-mx-8 lg:-my-8 lg:h-[calc(100dvh-4rem)] lg:flex-row lg:gap-0 lg:overflow-hidden">
      <aside className="flex min-h-0 flex-col gap-4 lg:w-[380px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-stampa-border lg:p-4">
        <div className="flex flex-col gap-1">
          <Link href="/stampa-maker" className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white">
            <ArrowLeft size={14} />
            Stampa Maker
          </Link>
          <h1 className="text-lg font-bold text-white">Neon LED</h1>
        </div>

        <MakerNeonProjectsPanel library={library} />

        <MakerNeonControls
          params={params}
          onChange={handleChange}
          fieldErrors={fieldErrors}
          sourceType={sourceType}
          onSourceTypeChange={setSourceType}
          text={text}
          onTextChange={setText}
          fontId={fontId}
          onFontChange={setFontId}
          letterSpacingPct={letterSpacingPct}
          onLetterSpacingChange={setLetterSpacingPct}
          fileName={sourceType === "image" ? (imageFile?.fileName ?? null) : (svgFile?.fileName ?? null)}
          raster={
            sourceType === "image" && imageFile
              ? {
                  fileName: imageFile.fileName,
                  bytes: imageFile.bytes,
                  kind: imageFile.kind,
                  settings: raster,
                  onChange: (patch) => setRaster((prev) => ({ ...prev, ...patch })),
                  conversion: rasterConversion,
                  analyzing: pending,
                }
              : null
          }
          onFile={handleFile}
          onClearFile={() => {
            if (sourceType === "image") setImageFile(null);
            else setSvgFile(null);
            setFileError(null);
          }}
          fileError={fileError}
          inputError={inputError}
          metrics={inputError ? null : (result?.metrics ?? null)}
          errors={inputError ? [] : errors}
          warnings={inputError ? [] : (result?.warnings ?? [])}
        />
      </aside>

      <section className="relative h-[70dvh] min-h-[420px] overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface lg:h-auto lg:min-h-0 lg:flex-1 lg:rounded-none lg:border-0">
        <MakerViewport
          geometry={shownGeometry}
          displayMode={displayMode}
          bed={bed ? { items: bed.items, layout: bed.layout, profile, plateIndex: currentPlate } : null}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>{displayMode === "bed" && bed && <BedWarnings layout={bed.layout} profile={profile} />}</div>
            <NeonExportCard canDownload={canDownload} loading={downloading} onDownload={handleDownload} />
          </div>
          {/* Safe zone para el botón flotante de Stampy (ver Carteles). */}
          <div className="flex items-end justify-between gap-3 lg:pr-[5.5rem]">
            <div>{displayMode === "bed" && <BedLabel profile={profile} plateIndex={currentPlate} plateCount={plateCount} />}</div>
            <ViewportViewCard
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
              multiPart={false}
              explosionAmount={0}
              onExplosionAmountChange={() => {}}
              profile={profile}
              plateCount={plateCount}
              plateIndex={currentPlate}
              onPlateChange={setPlateIndex}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
