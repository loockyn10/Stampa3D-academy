"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { DEFAULT_RASTER_SETTINGS, type RasterSettings } from "@/lib/maker/neon/raster/types";
import { ingestRasterFile } from "@/lib/maker/neon/raster/ingestRasterFile";
import { LETTER_SPACING_MAX_PCT, LETTER_SPACING_MIN_PCT } from "@/lib/maker/neon/paths/textToNeonPaths";
import { DEFAULT_LETTER_SPACING_PCT, DEFAULT_NEON_FONT_ID, DEFAULT_NEON_PARAMS, DEFAULT_NEON_TEXT } from "@/lib/maker/neon/defaults";
import type { NeonFontId, NeonParams, NeonSource, NeonSourceType } from "@/lib/maker/neon/types";
import { collectBedItems, computeBedLayout } from "@/lib/maker/printBed/bedLayout";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";
import { DEFAULT_NEON_INSTALLATION_OVERRIDES, DEFAULT_NEON_INSTALLATION_RECIPE, type NeonInstallationOverrides, type NeonInstallationRecipe } from "@/lib/maker/neon/installation/types";
import { emptyNeonInstallationResult } from "@/lib/maker/neon/installation/orchestrate";
import { buildNeonInstallationHelperMesh } from "@/lib/maker/neon/installation/helperMesh";
import {
  addManualBridge,
  clearManualBridges,
  movePassThroughOverride,
  passThroughEditorCutouts,
  removeManualBridge,
  resetAllOverrides,
  setManualOrder,
  toggleInvertOverride,
} from "@/lib/maker/neon/installation/editing";
import { componentsOf, nearestPointPair, segmentOuterFootprint } from "@/lib/maker/neon/installation/bridges";
import { findInvalidBackCutouts } from "@/lib/maker/backCutoutEditor";
import type { NeonWiringPlan } from "@/lib/maker/neon/installation/wiring";
import type { NeonSegment } from "@/lib/maker/neon/installation/segments";
import { downloadNeonInstallKit, downloadNeonWallClipStl } from "@/lib/maker/neon/exporters/exportNeonInstallKit";

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

  // --- Instalación 0.3: receta (viaja al proyecto completa) + overrides por segmento. ---
  const [installationRecipe, setInstallationRecipe] = useState<NeonInstallationRecipe>(DEFAULT_NEON_INSTALLATION_RECIPE);
  const [installationOverrides, setInstallationOverrides] = useState<NeonInstallationOverrides>(DEFAULT_NEON_INSTALLATION_OVERRIDES);
  const [editingConnections, setEditingConnections] = useState(false);
  const [showWiringHelper, setShowWiringHelper] = useState(true);
  const [showMountHelper, setShowMountHelper] = useState(true);
  const [selectedCutoutId, setSelectedCutoutId] = useState<string | null>(null);
  const handleInstallationRecipeChange = useCallback((patch: Partial<NeonInstallationRecipe>) => setInstallationRecipe((prev) => ({ ...prev, ...patch })), []);
  const handleToggleEditConnections = useCallback(() => {
    setEditingConnections((prev) => !prev);
    setDisplayMode("model");
  }, []);
  // Ref: los handlers de abajo son estables (deps []) pero necesitan el plan de cableado
  // VIGENTE (ya con overrides aplicados) para calcular el próximo swap/inversión sobre lo
  // que el usuario está viendo, no sobre un valor obsoleto capturado en el closure.
  const wiringRef = useRef<NeonWiringPlan | null>(null);
  const handleMoveSegment = useCallback((segmentId: string, direction: -1 | 1) => {
    const wiring = wiringRef.current;
    if (!wiring) return;
    const i = wiring.order.indexOf(segmentId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= wiring.order.length) return;
    const next = [...wiring.order];
    [next[i], next[j]] = [next[j], next[i]];
    setInstallationOverrides((prev) => setManualOrder(prev, next));
  }, []);
  const handleInvertSegment = useCallback((segmentId: string) => {
    const wiring = wiringRef.current;
    const wasInverted = wiring?.segments.find((s) => s.segmentId === segmentId)?.inverted ?? false;
    setInstallationOverrides((prev) => toggleInvertOverride(prev, segmentId, wasInverted));
  }, []);
  const handleResetOverrides = useCallback(() => setInstallationOverrides(resetAllOverrides()), []);

  // Ref: mismo motivo que wiringRef — el handler necesita los segmentos VIGENTES (ya
  // recalculados con el diseño actual), no un valor obsoleto capturado en el closure.
  const segmentsRef = useRef<NeonSegment[]>([]);
  const handleAddManualBridge = useCallback((fromSegmentId: string, toSegmentId: string) => {
    const segmentsById = new Map(segmentsRef.current.map((s) => [s.id, s]));
    const from = segmentsById.get(fromSegmentId);
    const to = segmentsById.get(toSegmentId);
    if (!from || !to) return;
    const fa = segmentOuterFootprint(from, params);
    const fb = segmentOuterFootprint(to, params);
    if (fa.length === 0 || fb.length === 0) return;
    const { a, b } = nearestPointPair(fa, fb);
    setInstallationOverrides((prev) => addManualBridge(prev, fromSegmentId, toSegmentId, a, b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const handleRemoveManualBridge = useCallback((id: string) => setInstallationOverrides((prev) => removeManualBridge(prev, id)), []);
  const handleClearManualBridges = useCallback(() => setInstallationOverrides((prev) => clearManualBridges(prev)), []);

  const source = useMemo<NeonSource | null>(() => {
    // Fuera de rango se acota (el panel muestra el error de campo); NaN/vacío = espaciado recomendado.
    const spacing = Number.isFinite(letterSpacingPct) ? Math.min(Math.max(letterSpacingPct, LETTER_SPACING_MIN_PCT), LETTER_SPACING_MAX_PCT) : 0;
    if (sourceType === "text") return { type: "text", text, fontId, letterSpacingPct: spacing };
    if (sourceType === "image") return imageFile ? { type: "image", fileName: imageFile.fileName, bytes: imageFile.bytes, kind: imageFile.kind, raster } : null;
    return svgFile ? { type: "svg", fileName: svgFile.fileName, content: svgFile.content, fontId, letterSpacingPct: spacing } : null;
  }, [sourceType, text, fontId, letterSpacingPct, svgFile, imageFile, raster]);

  const installationInput = useMemo(() => ({ recipe: installationRecipe, overrides: installationOverrides }), [installationRecipe, installationOverrides]);

  const { result, inputError, fieldErrors, raster: rasterConversion, pending } = useNeonGeometry(source, params, installationInput);

  const handleChange = useCallback((patch: Partial<NeonParams>) => setParams((prev) => ({ ...prev, ...patch })), []);

  const handleFile = useCallback(async (picked: File) => {
    setFileError(null);
    if (sourceType === "image") {
      // El formato lo decide el CONTENIDO (firma), no la extensión ni el MIME; cada fallo tiene su mensaje.
      const ingested = await ingestRasterFile(picked);
      if (!ingested.ok || !ingested.bytes) {
        setFileError(ingested.ok ? "No se pudo leer el archivo." : ingested.message);
        return;
      }
      setImageFile({ kind: ingested.kind, fileName: picked.name, bytes: ingested.bytes });
      // El JPEG trae artefactos de compresión alrededor de los bordes: arranca con una limpieza media (se puede cambiar)
      // y siempre en luminosidad (no tiene transparencia). Los mismos controles que el PNG.
      if (ingested.kind === "jpg") setRaster((prev) => ({ ...prev, detectionMode: "luminance", cleaning: prev.cleaning < 2 ? 2 : prev.cleaning }));
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
      installationRecipe,
      installationOverrides,
    }),
    [params, sourceType, text, fontId, letterSpacingPct, raster, file, installationRecipe, installationOverrides],
  );
  const handleLoadWork = useCallback((loaded: LoadedNeonProject, loadedFile: NeonFileSource | null) => {
    setParams(loaded.params);
    setSourceType(loaded.sourceType);
    setText(loaded.text);
    setFontId(loaded.fontId);
    setLetterSpacingPct(loaded.letterSpacingPct);
    setRaster(loaded.raster);
    setFileError(null);
    setInstallationRecipe(loaded.installationRecipe);
    setInstallationOverrides(loaded.installationOverrides);
    setEditingConnections(false);
    setSelectedCutoutId(null);
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
    setInstallationRecipe(DEFAULT_NEON_INSTALLATION_RECIPE);
    setInstallationOverrides(DEFAULT_NEON_INSTALLATION_OVERRIDES);
    setEditingConnections(false);
    setSelectedCutoutId(null);
    return {
      params: DEFAULT_NEON_PARAMS,
      sourceType: "text",
      text: DEFAULT_NEON_TEXT,
      fontId: DEFAULT_NEON_FONT_ID,
      letterSpacingPct: DEFAULT_LETTER_SPACING_PCT,
      raster: { ...DEFAULT_RASTER_SETTINGS },
      fileMeta: null,
      installationRecipe: DEFAULT_NEON_INSTALLATION_RECIPE,
      installationOverrides: DEFAULT_NEON_INSTALLATION_OVERRIDES,
    };
  }, []);
  const library = useNeonProjects({ work, file, onLoad: handleLoadWork, onReset: handleResetWork });

  const geometry = result?.geometry ?? null;
  const errors = result?.errors ?? [];
  const canDownload = !!geometry && geometry.triangleCount > 0 && errors.length === 0 && fieldErrors.length === 0 && !inputError;

  // --- Instalación 0.3: derivados para el panel + helpers del viewport + editor manual. ---
  const installationResult = result?.installation ?? emptyNeonInstallationResult();
  wiringRef.current = installationResult.wiring;
  segmentsRef.current = installationResult.segments;
  const clipCount = useMemo(
    () => [...installationResult.clipPositions.values()].reduce((sum, arr) => sum + arr.length, 0),
    [installationResult.clipPositions],
  );
  const helperMesh = useMemo(
    () =>
      buildNeonInstallationHelperMesh(installationResult, {
        showWiring: showWiringHelper && installationRecipe.wiringEnabled,
        showMount: showMountHelper && installationRecipe.mountMode === "clips",
        wallGapMm: installationRecipe.wallGapMm,
      }),
    [installationResult, showWiringHelper, showMountHelper, installationRecipe.wiringEnabled, installationRecipe.mountMode, installationRecipe.wallGapMm],
  );
  const cutoutEditing = useMemo(() => {
    if (!editingConnections || !geometry) return null;
    const cutouts = passThroughEditorCutouts(installationResult.passThroughs);
    const safeZone = result?.passThroughSafeZone ?? null;
    const origin = { x: 0, y: 0 };
    return {
      cutouts,
      selectedId: selectedCutoutId,
      origin,
      invalidIds: findInvalidBackCutouts(cutouts, origin, safeZone),
      safeZone,
      onSelect: setSelectedCutoutId,
      onMove: (id: string, x: number, y: number, final: boolean) => {
        if (final) setInstallationOverrides((prev) => movePassThroughOverride(prev, id, x, y));
      },
    };
  }, [editingConnections, geometry, installationResult.passThroughs, result?.passThroughSafeZone, selectedCutoutId]);

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

  const [downloadingClip, setDownloadingClip] = useState(false);
  const [downloadingKit, setDownloadingKit] = useState(false);
  const handleDownloadClip = useCallback(() => {
    if (!result) return;
    setDownloadingClip(true);
    try {
      downloadNeonWallClipStl(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo exportar el Wall Clip.");
    } finally {
      setDownloadingClip(false);
    }
  }, [result, toast]);
  const handleDownloadKit = useCallback(async () => {
    if (!result) return;
    setDownloadingKit(true);
    try {
      await downloadNeonInstallKit(result, baseFileName, baseFileName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo exportar el kit de instalación.");
    } finally {
      setDownloadingKit(false);
    }
  }, [result, baseFileName, toast]);

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
          installation={{
            recipe: installationRecipe,
            onRecipeChange: handleInstallationRecipeChange,
            segmentCount: installationResult.segments.length,
            wiring: installationResult.wiring,
            passThroughCount: installationResult.passThroughs.length,
            passThroughs: installationResult.passThroughs,
            bridges: installationResult.bridges,
            manualBridges: installationOverrides.manualBridges,
            segmentIds: installationResult.segments.map((s) => s.id),
            connectivityOk: componentsOf(installationResult.segments, installationResult.bridges).length <= 1,
            onAddManualBridge: handleAddManualBridge,
            onRemoveManualBridge: handleRemoveManualBridge,
            onClearManualBridges: handleClearManualBridges,
            clipCount,
            installationWarnings: inputError ? [] : installationResult.warnings,
            installationErrors: inputError ? [] : installationResult.errors,
            editingConnections,
            onToggleEditConnections: handleToggleEditConnections,
            showWiringHelper,
            onShowWiringHelperChange: setShowWiringHelper,
            showMountHelper,
            onShowMountHelperChange: setShowMountHelper,
            onMoveSegment: handleMoveSegment,
            onInvertSegment: handleInvertSegment,
            onResetOverrides: handleResetOverrides,
          }}
        />
      </aside>

      <section className="relative h-[70dvh] min-h-[420px] overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface lg:h-auto lg:min-h-0 lg:flex-1 lg:rounded-none lg:border-0">
        <MakerViewport
          geometry={shownGeometry}
          displayMode={displayMode}
          bed={bed ? { items: bed.items, layout: bed.layout, profile, plateIndex: currentPlate } : null}
          cutoutEditing={cutoutEditing}
          helperMesh={helperMesh}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>{displayMode === "bed" && bed && <BedWarnings layout={bed.layout} profile={profile} />}</div>
            <NeonExportCard
              canDownload={canDownload}
              loading={downloading}
              onDownload={handleDownload}
              installation={{ clipCount, onDownloadClip: handleDownloadClip, downloadingClip, onDownloadKit: handleDownloadKit, downloadingKit }}
            />
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
