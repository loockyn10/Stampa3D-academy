"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { MakerStatusNotices, MakerTextControls } from "@/components/maker/MakerTextControls";
import { MakerAdvancedPanel } from "@/components/maker/MakerAdvancedPanel";
import { MakerQuickText } from "@/components/maker/MakerQuickText";
import { MakerStyleGallery } from "@/components/maker/MakerStyleGallery";
import { MakerStrengthSelector } from "@/components/maker/MakerStrengthSelector";
import { MakerBackCutoutsSection } from "@/components/maker/MakerBackCutoutsSection";
import { MakerInstallationSection } from "@/components/maker/MakerInstallationSection";
import { Card } from "@/components/ui/card";
import { MakerLibraryPanel } from "@/components/maker/MakerLibraryPanel";
import { MakerViewport, type MakerDisplayMode } from "@/components/maker/MakerViewport";
import { BedLabel, BedWarnings, CutoutEditingBanner, ViewportExportCard, ViewportViewCard } from "@/components/maker/MakerViewportOverlays";
import { useLetterGeometry } from "@/hooks/maker/useLetterGeometry";
import { useDesignImport } from "@/hooks/maker/useDesignImport";
import { useMakerLibrary } from "@/hooks/maker/useMakerLibrary";
import { detectFileKind, type FileDesignSource } from "@/lib/maker/import/importDesign";
import { DEFAULT_PNG_OPTIONS, IMPORT_LIMITS, type PngImportOptions } from "@/lib/maker/import/types";
import { exportWord } from "@/lib/maker/exporters/exportWord";
import { downloadLettersZip } from "@/lib/maker/exporters/exportLettersZip";
import { downloadAuxParts, downloadInstallKit, downloadTemplatePdf, downloadWiringGuidePdf } from "@/lib/maker/exporters/exportInstallKit";
import { buildInstallationHelperMesh } from "@/lib/maker/installation/helper";
import { invalidMountEditorIds, mountEditorCutouts, mountSafeZone, moveMountPoint } from "@/lib/maker/installation/editing";
import { DEFAULT_LETTER_SIGN_PARAMS } from "@/lib/maker/defaults";
import { DEFAULT_EXPLOSION_AMOUNT, effectiveExplosionAmount } from "@/lib/maker/geometry/explodeOrder";
import { checkBackCutoutPlacement, findInvalidBackCutouts, updateBackCutoutPosition } from "@/lib/maker/backCutoutEditor";
import { collectBedItems, computeBedLayout } from "@/lib/maker/printBed/bedLayout";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";
import { DEFAULT_STYLE_ID, STYLE_PRESETS, applyStylePreset, detectStylePreset, getStylePreset, matchesStylePreset } from "@/lib/maker/presets/stylePresets";
import type { LoadedProject, ProjectWorkState } from "@/lib/maker/projects/projectData";
import type { LetterSignParams } from "@/lib/maker/types";
import { applyWallStrength, type WallStrength } from "@/lib/maker/wallStrength";

export default function StampaMakerCartelesPage() {
  // Única fuente de la configuración: `params` (lo que edita Personalización avanzada). El estilo elegido es solo una etiqueta
  // (`styleId`): "Personalizado" se deduce comparando `params` con la receta del estilo, nunca se guarda una segunda copia.
  const [params, setParams] = useState<LetterSignParams>(DEFAULT_LETTER_SIGN_PARAMS);
  const [styleId, setStyleId] = useState<string | null>(DEFAULT_STYLE_ID);
  const viewerRef = useRef<HTMLElement>(null);
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
  // Única fuente de la vista ensamblada/explosionada (0 = ensamblado). Solo visualización: no va a presets, proyectos ni exportación.
  const [explosionAmount, setExplosionAmount] = useState(DEFAULT_EXPLOSION_AMOUNT);
  const [plateIndex, setPlateIndex] = useState(1);

  // Modo Editar recortes: solo sobre Model View. La selección es única y compartida entre lista y viewport.
  const [editingCutouts, setEditingCutouts] = useState(false);
  const [selectedBackCutoutId, setSelectedBackCutoutId] = useState<string | null>(null);
  // Modo Editar montaje (misma arquitectura que Editar recortes; mutuamente excluyentes) y helpers visuales de instalación (no exportables).
  const [editingMounts, setEditingMounts] = useState(false);
  const [selectedMountId, setSelectedMountId] = useState<string | null>(null);
  const [showWiring, setShowWiring] = useState(false);
  const [showWall, setShowWall] = useState(false);
  const [installLoading, setInstallLoading] = useState(false);

  // Edición manual: se aplica tal cual, sin restaurar nada del estilo (el estilo pasa a "Personalizado" si deja de coincidir).
  const handleChange = useCallback((patch: Partial<LetterSignParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
  }, []);

  // Params que llegan de afuera (preset del usuario, proyecto, "nuevo"): se reconoce el estilo si coinciden, si no queda "Personalizado".
  const handleExternalParams = useCallback((next: LetterSignParams) => {
    setParams(next);
    setStyleId(detectStylePreset(next)?.id ?? null);
  }, []);

  const handleSelectStyle = useCallback(
    (id: string) => {
      const preset = getStylePreset(id);
      if (!preset) return;
      setStyleId(id);
      if (matchesStylePreset(params, preset)) return; // ya está aplicado: sin regenerar el modelo
      setParams((prev) => applyStylePreset(prev, preset));
      // En mobile el visor queda arriba de la galería: si no se ve, se lo trae a la vista para que el cambio no pase desapercibido.
      const viewer = viewerRef.current;
      if (viewer && window.matchMedia("(max-width: 1023px)").matches) {
        const rect = viewer.getBoundingClientRect();
        const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        if (visible < rect.height * 0.35) viewer.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }
    },
    [params],
  );
  // Resistencia (Normal / Reforzado): atajo para wallMm. No toca el texto ni el estilo (matchesStylePreset ignora la pared).
  const handleSelectStrength = useCallback((strength: WallStrength) => setParams((prev) => applyWallStrength(prev, strength)), []);
  const selectedStyle = getStylePreset(styleId);
  const styleCustom = !selectedStyle || !matchesStylePreset(params, selectedStyle);

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
    handleExternalParams(loaded.params);
    setSourceMode(loaded.sourceMode);
    setDesignHeightMm(loaded.designHeightMm);
    setPngOptions(loaded.pngOptions);
    setFile(loadedFile);
    setFileError(null);
  }, [handleExternalParams]);
  const handleResetWork = useCallback((next: LetterSignParams) => {
    handleExternalParams(next);
    setSourceMode("text");
    setFile(null);
    setFileError(null);
    setDesignHeightMm(DEFAULT_LETTER_SIGN_PARAMS.heightMm);
    setPngOptions({ ...DEFAULT_PNG_OPTIONS });
  }, [handleExternalParams]);
  const library = useMakerLibrary({ work, file, onParams: handleExternalParams, onLoadWork: handleLoadWork, onResetWork: handleResetWork });

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

  // Drag: el handle se mueve por ref en el viewport; acá llega el commit throttled (X/Y) y el final exacto. Una única fuente: params.backCutouts
  // (recortes) o params.installationOverrides (puntos de montaje).
  const installationPlan = geometry?.installation ?? null;
  const handleCutoutMove = useCallback(
    (id: string, x: number, y: number) => {
      if (editingMounts) {
        if (installationPlan) setParams((prev) => ({ ...prev, installationOverrides: moveMountPoint(prev.installationOverrides ?? {}, installationPlan, id, x, y) }));
        return;
      }
      setParams((prev) => ({ ...prev, backCutouts: updateBackCutoutPosition(prev.backCutouts, id, x, y) }));
    },
    [editingMounts, installationPlan],
  );
  const startCutoutEditing = useCallback(() => {
    setDisplayMode("model");
    setEditingMounts(false);
    setEditingCutouts(true);
  }, []);
  const finishCutoutEditing = useCallback(() => {
    setEditingCutouts(false);
    setEditingMounts(false);
  }, []);
  const toggleMountEditing = useCallback(() => {
    setDisplayMode("model");
    setEditingCutouts(false);
    setEditingMounts((v) => !v);
  }, []);

  const installTitle = params.text.trim() || "Cartel";
  const runInstall = useCallback(
    async (fn: () => void | Promise<void>, failure: string) => {
      setInstallLoading(true);
      try {
        await fn();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : failure);
      } finally {
        setInstallLoading(false);
      }
    },
    [toast],
  );

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
  const hasGeometry = !!shownGeometry && shownGeometry.triangleCount > 0;
  const editingCutoutsOn = editingCutouts && hasGeometry;
  const editingMountsOn = editingMounts && hasGeometry && !!shownGeometry?.installation;
  const editing = editingCutoutsOn || editingMountsOn;
  const selectedId = params.backCutouts.some((c) => c.id === selectedBackCutoutId) ? selectedBackCutoutId : null;
  const invalidIds = useMemo(
    () => (editingCutoutsOn && shownGeometry ? findInvalidBackCutouts(params.backCutouts, shownGeometry.designCenter, shownGeometry.backCutoutSafeZone) : new Set<string>()),
    [editingCutoutsOn, shownGeometry, params.backCutouts],
  );
  const selectedCutout = params.backCutouts.find((c) => c.id === selectedId) ?? null;
  const invalidMessage =
    editingCutoutsOn && shownGeometry && selectedCutout && invalidIds.has(selectedCutout.id)
      ? checkBackCutoutPlacement(selectedCutout, shownGeometry.designCenter, shownGeometry.backCutoutSafeZone).message
      : null;
  // Puntos de montaje como "recortes" sintéticos para el MISMO editor de arrastre (ver lib/maker/installation/editing.ts).
  const mountCutouts = useMemo(() => (editingMountsOn ? mountEditorCutouts(installationPlan, params) : []), [editingMountsOn, installationPlan, params]);
  const mountZone = useMemo(() => (editingMountsOn && shownGeometry ? mountSafeZone(shownGeometry, params) : null), [editingMountsOn, shownGeometry, params]);
  const mountInvalid = useMemo(() => (editingMountsOn ? invalidMountEditorIds(installationPlan) : new Set<string>()), [editingMountsOn, installationPlan]);
  const cutoutEditing = useMemo(
    () =>
      editingMountsOn && shownGeometry
        ? {
            cutouts: mountCutouts,
            selectedId: selectedMountId,
            origin: shownGeometry.designCenter,
            invalidIds: mountInvalid,
            safeZone: mountZone,
            onSelect: setSelectedMountId,
            onMove: handleCutoutMove,
          }
        : editingCutoutsOn && shownGeometry
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
    [editingMountsOn, editingCutoutsOn, shownGeometry, mountCutouts, selectedMountId, mountInvalid, mountZone, params.backCutouts, selectedId, invalidIds, handleCutoutMove],
  );
  const helperMesh = useMemo(
    () => (displayMode === "model" && !editing ? buildInstallationHelperMesh(installationPlan, params, { showWiring, showWall }) : null),
    [displayMode, editing, installationPlan, params, showWiring, showWall],
  );
  const spacerQuantity = shownGeometry?.installationParts.filter((p) => p.kind === "wallSpacer").reduce((n, p) => n + p.quantity, 0) ?? 0;
  const clipQuantity = shownGeometry?.installationParts.filter((p) => p.kind === "bipolarSpliceClip").reduce((n, p) => n + p.quantity, 0) ?? 0;
  const installExport = installationPlan
    ? {
        canDownload,
        spacerQuantity,
        clipQuantity,
        hasGuide: !!installationPlan.wiring,
        loading: installLoading,
        onSpacers: () => shownGeometry && runInstall(() => downloadAuxParts(shownGeometry, "wallSpacer"), "No se pudieron exportar los separadores."),
        onClips: () => shownGeometry && runInstall(() => downloadAuxParts(shownGeometry, "bipolarSpliceClip"), "No se pudo exportar el soporte de empalmes."),
        onTemplate: () => shownGeometry && runInstall(() => downloadTemplatePdf(shownGeometry, params, baseFileName, installTitle), "No se pudo generar la plantilla."),
        onGuide: () => shownGeometry && runInstall(() => downloadWiringGuidePdf(shownGeometry, params, baseFileName, installTitle), "No se pudo generar la guía de conexión."),
        onKit: () => shownGeometry && runInstall(() => downloadInstallKit(shownGeometry, params, baseFileName, installTitle), "No se pudo generar el kit de instalación."),
      }
    : null;
  const plateCount = bed?.layout.plates.length ?? 0;
  const currentPlate = Math.min(Math.max(plateIndex, 1), Math.max(plateCount, 1));

  const textError = fieldErrors.find((e) => e.field === "text")?.message;

  return (
    <div className="flex flex-col gap-4 lg:-mx-8 lg:-my-8 lg:h-[calc(100dvh-4rem)] lg:flex-row lg:gap-0 lg:overflow-hidden">
      {/* Mobile: el <aside> se disuelve (contents) y sus bloques se ordenan con el visor en el medio: texto -> visor -> estilos -> avanzada. Desktop: columna izquierda con scroll propio. */}
      <aside className="contents lg:order-1 lg:flex lg:min-h-0 lg:w-[380px] lg:shrink-0 lg:flex-col lg:gap-4 lg:overflow-y-auto lg:border-r lg:border-stampa-border lg:p-4">
        <div className="order-1 flex flex-col gap-1">
          <Link href="/stampa-maker" className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-fg">
            <ArrowLeft size={14} />
            Stampa Maker
          </Link>
          <h1 className="text-lg font-bold text-fg">Creador de Carteles</h1>
        </div>

        <div className="order-2 flex flex-col gap-3">
          <MakerQuickText
            value={params.text}
            onChange={(text) => handleChange({ text })}
            error={textError}
            fromFile={fromFile}
            onUseText={() => setSourceMode("text")}
            updating={loading || designImport.loading}
            size={shownGeometry && shownGeometry.triangleCount > 0 ? shownGeometry.boundingBox : null}
            bedWidthMm={profile.widthMm}
            bedName={profile.name}
          />
          <MakerStatusNotices error={error} geometryErrors={geometry?.errors ?? []} warnings={geometry?.warnings ?? []} />
        </div>

        <div className="order-4 flex flex-col gap-3">
          <MakerStyleGallery
            styles={STYLE_PRESETS}
            selectedId={styleId}
            custom={styleCustom}
            onSelect={handleSelectStyle}
            onReset={() => styleId && handleSelectStyle(styleId)}
          />
          <MakerStrengthSelector wallMm={params.wallMm} onSelect={handleSelectStrength} />
        </div>

        <div className="order-5 flex flex-col gap-3">
          <MakerAdvancedPanel custom={styleCustom}>
            <MakerLibraryPanel library={library} />

            <MakerTextControls
              params={params}
              onChange={handleChange}
              fieldErrors={fieldErrors}
              geometryErrors={geometry?.errors ?? []}
              warnings={geometry?.warnings ?? []}
              error={error}
              hideTextField
              hideNotices
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
                editing={editingCutoutsOn}
                canEdit={hasGeometry}
                onToggleEditing={editingCutoutsOn ? finishCutoutEditing : startCutoutEditing}
                errors={[
                  ...fieldErrors.filter((e) => e.field === "backCutouts").map((e) => e.message),
                  ...(geometry?.errors ?? []).filter((e) => e.code === "BACK_CUTOUT_INVALID").map((e) => e.message),
                ]}
              />
            </Card>

            <Card className="p-5">
              <MakerInstallationSection
                params={params}
                onChange={handleChange}
                geometry={shownGeometry}
                editingMounts={editingMountsOn}
                onToggleEditingMounts={toggleMountEditing}
                showWiring={showWiring}
                onShowWiring={setShowWiring}
                showWall={showWall}
                onShowWall={setShowWall}
              />
            </Card>
          </MakerAdvancedPanel>
        </div>
      </aside>

      <section
        ref={viewerRef}
        aria-label="Visor 3D del cartel"
        className="theme-force-dark relative order-3 h-[58dvh] min-h-[380px] scroll-mt-16 overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface lg:order-2 lg:h-auto lg:min-h-0 lg:flex-1 lg:rounded-none lg:border-0"
      >
        <MakerViewport
          geometry={shownGeometry}
          displayMode={editing ? "model" : displayMode}
          explosionAmount={effectiveExplosionAmount(explosionAmount, editing)}
          cutoutEditing={cutoutEditing}
          helperMesh={helperMesh}
          bed={bed ? { items: bed.items, layout: bed.layout, profile, plateIndex: currentPlate } : null}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              {editing && <CutoutEditingBanner invalidMessage={invalidMessage} mounts={editingMountsOn} />}
              {!editing && displayMode === "bed" && bed && <BedWarnings layout={bed.layout} profile={profile} />}
              {(loading || designImport.loading) && !editing && (
                <span role="status" className="inline-flex items-center gap-1.5 rounded-full border border-fg/15 bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                  <Loader2 size={12} className="animate-spin" />
                  Actualizando…
                </span>
              )}
            </div>
            <ViewportExportCard
              fromFile={fromFile}
              multiPart={multiPart}
              canDownload={canDownload}
              loading={wordDownloading}
              lettersLoading={lettersZipLoading}
              onDownloadWord={handleDownloadWord}
              onDownloadLetters={handleDownloadLetters}
              installation={installExport}
            />
          </div>
          {/* Safe zone para el botón flotante de Stampy (fixed, 56px, a 24px del borde): la card se corre a la izquierda en desktop. */}
          <div className="flex items-end justify-between gap-3 lg:pr-[5.5rem]">
            <div>{displayMode === "bed" && <BedLabel profile={profile} plateIndex={currentPlate} plateCount={plateCount} />}</div>
            <ViewportViewCard
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
              multiPart={multiPart}
              explosionAmount={explosionAmount}
              onExplosionAmountChange={setExplosionAmount}
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
