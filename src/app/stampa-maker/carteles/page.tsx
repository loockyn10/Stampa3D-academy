"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { MakerTextControls } from "@/components/maker/MakerTextControls";
import { MakerBackCutoutsSection } from "@/components/maker/MakerBackCutoutsSection";
import { Card } from "@/components/ui/card";
import { MakerLibraryPanel } from "@/components/maker/MakerLibraryPanel";
import { MakerViewport, type MakerDisplayMode, type MakerViewMode } from "@/components/maker/MakerViewport";
import { BedLabel, BedWarnings, CutoutEditingBanner, ViewportExportCard, ViewportViewCard } from "@/components/maker/MakerViewportOverlays";
import { useLetterGeometry } from "@/hooks/maker/useLetterGeometry";
import { useDesignImport } from "@/hooks/maker/useDesignImport";
import { useMakerLibrary } from "@/hooks/maker/useMakerLibrary";
import { detectFileKind, type FileDesignSource } from "@/lib/maker/import/importDesign";
import { DEFAULT_PNG_OPTIONS, IMPORT_LIMITS, type PngImportOptions } from "@/lib/maker/import/types";
import { exportWord } from "@/lib/maker/exporters/exportWord";
import { downloadLettersZip } from "@/lib/maker/exporters/exportLettersZip";
import { DEFAULT_LETTER_SIGN_PARAMS } from "@/lib/maker/defaults";
import { DEFAULT_EXPLODE_PERCENT } from "@/lib/maker/geometry/explodeOrder";
import { checkBackCutoutPlacement, findInvalidBackCutouts, updateBackCutoutPosition } from "@/lib/maker/backCutoutEditor";
import { collectBedItems, computeBedLayout } from "@/lib/maker/printBed/bedLayout";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";
import type { LoadedProject, ProjectWorkState } from "@/lib/maker/projects/projectData";
import type { LetterSignParams } from "@/lib/maker/types";

export default function StampaMakerCartelesPage() {
  const [params, setParams] = useState<LetterSignParams>(DEFAULT_LETTER_SIGN_PARAMS);
  // Origen del diseño (0.5): texto, o archivo SVG/PNG -> ContourGroups (lib/maker/import).
  const [sourceMode, setSourceMode] = useState<"text" | "file">("text");
  const [file, setFile] = useState<FileDesignSource | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [designHeightMm, setDesignHeightMm] = useState(DEFAULT_LETTER_SIGN_PARAMS.heightMm);
  const [pngOptions, setPngOptions] = useState<PngImportOptions>(DEFAULT_PNG_OPTIONS);
  const fromFile = sourceMode === "file";
  const designImport = useDesignImport(fromFile ? file : null, designHeightMm, pngOptions);
  const { geometry, loading, error, fieldErrors } = useLetterGeometry(params, designImport.design, fromFile);
  const { toast } = useAppFeedback();
  const [lettersZipLoading, setLettersZipLoading] = useState(false);
  const [wordDownloading, setWordDownloading] = useState(false);

  // Estado puramente visual (no viaja en presets ni proyectos).
  const [displayMode, setDisplayMode] = useState<MakerDisplayMode>("model");
  const [viewMode, setViewMode] = useState<MakerViewMode>("assembled");
  const [explodePercent, setExplodePercent] = useState(DEFAULT_EXPLODE_PERCENT);
  const [plateIndex, setPlateIndex] = useState(1);

  // Modo Editar recortes: solo sobre Model View. La selección es única y compartida entre lista y viewport.
  const [editingCutouts, setEditingCutouts] = useState(false);
  const [selectedBackCutoutId, setSelectedBackCutoutId] = useState<string | null>(null);

  const handleChange = useCallback((patch: Partial<LetterSignParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleFile = useCallback(async (picked: File) => {
    setFileError(null);
    const kind = detectFileKind(picked.name);
    if (!kind) {
      setFileError("Formato no soportado. Subí un archivo .svg o .png.");
      return;
    }
    if (picked.size > IMPORT_LIMITS.maxFileBytes) {
      setFileError("El archivo es demasiado grande (máximo 10 MB).");
      return;
    }
    try {
      if (kind === "svg") setFile({ type: "svg", fileName: picked.name, content: await picked.text() });
      else setFile({ type: "png", fileName: picked.name, bytes: new Uint8Array(await picked.arrayBuffer()) });
    } catch {
      setFileError("No se pudo leer el archivo.");
    }
  }, []);

  // --- Presets y proyectos ---
  const fileSize = useMemo(
    () => (file ? (file.type === "svg" ? new TextEncoder().encode(file.content).length : file.bytes.length) : 0),
    [file],
  );
  const work: ProjectWorkState = useMemo(
    () => ({
      params,
      sourceMode,
      designHeightMm,
      pngOptions,
      fileMeta: file ? { kind: file.type, fileName: file.fileName, sizeBytes: fileSize } : null,
    }),
    [params, sourceMode, designHeightMm, pngOptions, file, fileSize],
  );
  const handleLoadWork = useCallback((loaded: LoadedProject, loadedFile: FileDesignSource | null) => {
    setParams(loaded.params);
    setSourceMode(loaded.sourceMode);
    setDesignHeightMm(loaded.designHeightMm);
    setPngOptions(loaded.pngOptions);
    setFile(loadedFile);
    setFileError(null);
  }, []);
  const handleResetWork = useCallback((next: LetterSignParams) => {
    setParams(next);
    setSourceMode("text");
    setFile(null);
    setFileError(null);
    setDesignHeightMm(DEFAULT_LETTER_SIGN_PARAMS.heightMm);
    setPngOptions({ ...DEFAULT_PNG_OPTIONS });
  }, []);
  const library = useMakerLibrary({ work, file, onParams: setParams, onLoadWork: handleLoadWork, onResetWork: handleResetWork });

  const baseFileName = fromFile
    ? (file?.fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "diseno")
    : params.text.trim().toLowerCase().replace(/\s+/g, "-") || "stampa-maker";

  const handleDownloadWord = useCallback(async () => {
    if (!geometry || geometry.triangleCount === 0) return;
    setWordDownloading(true);
    try {
      await exportWord(geometry, baseFileName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `No se pudo exportar ${fromFile ? "el diseño completo" : "la palabra completa"}.`);
    } finally {
      setWordDownloading(false);
    }
  }, [geometry, baseFileName, toast, fromFile]);

  const handleDownloadLetters = useCallback(async () => {
    if (!geometry || geometry.letters.length === 0) return;
    setLettersZipLoading(true);
    try {
      await downloadLettersZip(geometry, `${baseFileName}_letras`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo exportar el ZIP de letras.");
    } finally {
      setLettersZipLoading(false);
    }
  }, [geometry, baseFileName, toast]);

  // Drag: el handle se mueve por ref en el viewport; acá llega el commit throttled (X/Y) y el final exacto. Una única fuente: params.backCutouts.
  const handleCutoutMove = useCallback((id: string, x: number, y: number) => {
    setParams((prev) => ({ ...prev, backCutouts: updateBackCutoutPosition(prev.backCutouts, id, x, y) }));
  }, []);
  const startCutoutEditing = useCallback(() => {
    setDisplayMode("model");
    setEditingCutouts(true);
  }, []);
  const finishCutoutEditing = useCallback(() => setEditingCutouts(false), []);

  const canDownload =
    !loading && !designImport.loading && !error && !designImport.error && fieldErrors.length === 0 && !!geometry && geometry.triangleCount > 0 && geometry.errors.length === 0;

  // --- Vista ---
  const shownGeometry = fromFile && !designImport.design ? null : geometry;
  const multiPart = params.frontType !== "open";
  const profile = getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID);
  // Se calcula solo en Vista Cama: una única geometría fuente, las piezas se instancian con transformaciones de escena.
  const bed = useMemo(() => {
    if (displayMode !== "bed" || !shownGeometry) return null;
    const items = collectBedItems(shownGeometry);
    return { items, layout: computeBedLayout(items, profile) };
  }, [displayMode, shownGeometry, profile]);
  const editing = editingCutouts && !!shownGeometry && shownGeometry.triangleCount > 0;
  const selectedId = params.backCutouts.some((c) => c.id === selectedBackCutoutId) ? selectedBackCutoutId : null;
  const invalidIds = useMemo(
    () => (editing && shownGeometry ? findInvalidBackCutouts(params.backCutouts, shownGeometry.designCenter, shownGeometry.backCutoutSafeZone) : new Set<string>()),
    [editing, shownGeometry, params.backCutouts],
  );
  const selectedCutout = params.backCutouts.find((c) => c.id === selectedId) ?? null;
  const invalidMessage =
    editing && shownGeometry && selectedCutout && invalidIds.has(selectedCutout.id)
      ? checkBackCutoutPlacement(selectedCutout, shownGeometry.designCenter, shownGeometry.backCutoutSafeZone).message
      : null;
  const cutoutEditing = useMemo(
    () =>
      editing && shownGeometry
        ? {
            cutouts: params.backCutouts,
            selectedId,
            origin: shownGeometry.designCenter,
            invalidIds,
            safeZone: shownGeometry.backCutoutSafeZone,
            onSelect: setSelectedBackCutoutId,
            onMove: handleCutoutMove,
          }
        : null,
    [editing, shownGeometry, params.backCutouts, selectedId, invalidIds, handleCutoutMove],
  );
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
          <h1 className="text-lg font-bold text-white">Creador de Carteles</h1>
        </div>

        <MakerLibraryPanel library={library} />

        <MakerTextControls
          params={params}
          onChange={handleChange}
          fieldErrors={fieldErrors}
          geometryErrors={geometry?.errors ?? []}
          warnings={geometry?.warnings ?? []}
          error={error}
          source={{
            mode: sourceMode,
            onModeChange: setSourceMode,
            fileName: file?.fileName ?? null,
            fileKind: file?.type ?? null,
            importing: designImport.loading,
            importError: fileError ?? designImport.error,
            importWarnings: designImport.design?.warnings ?? [],
            onFile: handleFile,
            onClear: () => {
              setFile(null);
              setFileError(null);
            },
            heightMm: designHeightMm,
            onHeightChange: setDesignHeightMm,
            widthMm: designImport.design?.widthMm ?? null,
            pngMode: designImport.design?.pngMode ?? null,
            pngOptions,
            onPngOptionsChange: (patch) => setPngOptions((prev) => ({ ...prev, ...patch })),
          }}
        />

        <Card className="p-5">
          <MakerBackCutoutsSection
            cutouts={params.backCutouts}
            onChange={(backCutouts) => handleChange({ backCutouts })}
            selectedId={selectedId}
            onSelect={setSelectedBackCutoutId}
            editing={editing}
            canEdit={!!shownGeometry && shownGeometry.triangleCount > 0}
            onToggleEditing={editing ? finishCutoutEditing : startCutoutEditing}
            errors={[
              ...fieldErrors.filter((e) => e.field === "backCutouts").map((e) => e.message),
              ...(geometry?.errors ?? []).filter((e) => e.code === "BACK_CUTOUT_INVALID").map((e) => e.message),
            ]}
          />
        </Card>
      </aside>

      <section className="relative h-[70dvh] min-h-[420px] overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface lg:h-auto lg:min-h-0 lg:flex-1 lg:rounded-none lg:border-0">
        <MakerViewport
          geometry={shownGeometry}
          displayMode={editing ? "model" : displayMode}
          viewMode={editing ? "assembled" : viewMode}
          explodePercent={explodePercent}
          cutoutEditing={cutoutEditing}
          bed={bed ? { items: bed.items, layout: bed.layout, profile, plateIndex: currentPlate } : null}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              {editing && <CutoutEditingBanner invalidMessage={invalidMessage} />}
              {!editing && displayMode === "bed" && bed && <BedWarnings layout={bed.layout} profile={profile} />}
            </div>
            <ViewportExportCard
              fromFile={fromFile}
              multiPart={multiPart}
              canDownload={canDownload}
              loading={wordDownloading}
              lettersLoading={lettersZipLoading}
              onDownloadWord={handleDownloadWord}
              onDownloadLetters={handleDownloadLetters}
            />
          </div>
          {/* Safe zone para el botón flotante de Stampy (fixed, 56px, a 24px del borde): la card se corre a la izquierda en desktop. */}
          <div className="flex items-end justify-between gap-3 lg:pr-[5.5rem]">
            <div>{displayMode === "bed" && <BedLabel profile={profile} plateIndex={currentPlate} plateCount={plateCount} />}</div>
            <ViewportViewCard
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              multiPart={multiPart}
              explodePercent={explodePercent}
              onExplodePercentChange={setExplodePercent}
              profile={profile}
              plateCount={plateCount}
              plateIndex={currentPlate}
              onPlateChange={setPlateIndex}
              cutoutEditingActive={editing}
              onFinishCutoutEditing={finishCutoutEditing}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
