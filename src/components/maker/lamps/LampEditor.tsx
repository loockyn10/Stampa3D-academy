"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { LampBottomBar, type BarComponent } from "@/components/maker/lamps/LampBottomBar";
import { LampExportList, type LampExportListProps } from "@/components/maker/lamps/LampExportList";
import { LampLibraryPanel } from "@/components/maker/lamps/LampLibraryPanel";
import { LampPropertiesPanel } from "@/components/maker/lamps/LampPropertiesPanel";
import { LampTopBar } from "@/components/maker/lamps/LampTopBar";
import { MakerViewport, type MakerDisplayMode } from "@/components/maker/MakerViewport";
import { BedLabel, BedWarnings } from "@/components/maker/MakerViewportOverlays";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { useLampConstraints } from "@/hooks/maker/useLampConstraints";
import { useLampGeometry } from "@/hooks/maker/useLampGeometry";
import { useSavedLampDesigns } from "@/hooks/maker/useSavedLampDesigns";
import { DIFFUSER_KIND_LABELS, diffuserKind, LAMP_FAMILIES, LAMP_FAMILY_ORDER, type FamilyMemory } from "@/lib/maker/lamps/capabilities";
import { insertKind } from "@/lib/maker/lamps/createLamp";
import { decodeLampDesign, encodeLampDesign } from "@/lib/maker/lamps/designCode";
import { editorIssueSummary, newLampDesign, type EditorComponent } from "@/lib/maker/lamps/editor";
import { downloadLampPart, downloadLampTestZip, downloadLampZip, isTestPieceBlocker } from "@/lib/maker/lamps/exporters/lampFiles";
import { isProfileStyle, profilePrintKind } from "@/lib/maker/lamps/insert/profile";
import { switchFamily } from "@/lib/maker/lamps/openwork/presets";
import { applyLampPreset, type LampPreset } from "@/lib/maker/lamps/presets";
import { DEFAULT_LAMP_NAME, type SavedLampDesign } from "@/lib/maker/lamps/savedDesigns";
import { applyStandardMechanics, describeDeviations, mechanicalDeviations, preserveMechanics } from "@/lib/maker/lamps/standard";
import { generateLampVariation } from "@/lib/maker/lamps/variation";
import type { LampDefinition, LampShadeType } from "@/lib/maker/lamps/types";
import type { PartKind } from "@/lib/maker/types";
import { collectBedItems, computeBedLayout } from "@/lib/maker/printBed/bedLayout";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";

function newSeed(): number {
  const buf = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(buf);
  else buf[0] = Math.floor(Math.random() * 4294967296);
  return buf[0];
}

/** Piezas (tipos de malla) que pertenecen a cada componente seleccionable. */
function kindsOf(component: EditorComponent, def: LampDefinition): PartKind[] {
  if (component === "shade") return ["lampShade"];
  if (component === "diffuser") return [insertKind(def)];
  return ["body", ...(def.thread.connection === "collar" ? (["lampCollar"] as const) : [])];
}

type MobilePanel = "library" | "properties" | "export" | null;

/**
 * EDITOR VISUAL DE LÁMPARAS E27 (`/stampa-maker/lamparas`).
 *
 *   barra superior  — nombre, nuevo, guardar, mis diseños, restablecer, exportar
 *   izquierda       — biblioteca: familia y estilo (miniaturas)
 *   centro          — visor 3D (protagonista) + barra inferior: componentes y vistas
 *   derecha         — propiedades del componente seleccionado (2–3 controles principales por familia)
 *
 * En móvil no se trasladan los tres paneles: el visor queda arriba y fijo, el selector de familia es compacto y un solo panel (estilos, ajustes o exportar)
 * se abre bajo demanda debajo del visor. Solo guarda la `LampDefinition`: toda la geometría sale del motor (`lib/maker/lamps`). La mecánica (portalámparas,
 * rosca, encastre y canal del difusor) es el estándar validado (`standard.ts`) y no es editable.
 */
export function LampEditor() {
  const { toast, confirmAction } = useAppFeedback();
  const [def, setDef] = useState<LampDefinition>(newLampDesign);
  const [baseline, setBaseline] = useState<LampDefinition>(newLampDesign);
  const [name, setName] = useState(DEFAULT_LAMP_NAME);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<EditorComponent>("shade");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("properties");
  const [hidden, setHidden] = useState<PartKind[]>([]);
  const [section, setSection] = useState(false);
  const [explosion, setExplosion] = useState(0);
  const [displayMode, setDisplayMode] = useState<MakerDisplayMode>("model");
  const [plateIndex, setPlateIndex] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const saved = useSavedLampDesigns();

  const { result, pending, outdated } = useLampGeometry(def);
  const { ranges, stale } = useLampConstraints(def, { advanced: moreOpen, insert: selected === "diffuser" });
  const geometry = result.geometry;
  // Se exporta solo la lámpara que corresponde a los controles: sin cambios pendientes, sin errores y sin que el visor esté mostrando una vista anterior.
  const canDownload = !pending && !outdated && !!geometry && geometry.triangleCount > 0 && result.errors.length === 0;
  const canDownloadTests = !pending && !result.errors.some(isTestPieceBlocker);
  const primaryProblem = useMemo(() => editorIssueSummary(def, result.errors, result.warnings).primary?.short ?? null, [def, result.errors, result.warnings]);
  const designCode = useMemo(() => encodeLampDesign(def), [def]);
  const baselineCode = useMemo(() => encodeLampDesign(baseline), [baseline]);
  const dirty = designCode !== baselineCode;
  const deviations = useMemo(() => mechanicalDeviations(def), [def]);

  // Lo que el usuario dejó en cada familia (difusor, extremos, unión) vuelve al regresar; el último diseño sin errores permite recuperarse de un valor inválido.
  const familyMemory = useRef<FamilyMemory>({});
  const [lastGood, setLastGood] = useState<LampDefinition | null>(null);
  if (canDownload && lastGood !== def) setLastGood(def);

  const resetView = useCallback(() => {
    setHidden([]);
    setSection(false);
    setExplosion(0);
    setDisplayMode("model");
  }, []);

  // La mecánica estándar no la cambia ninguna acción del editor: `preserveMechanics` es la red de seguridad de las que reescriben partes del diseño.
  const handleFamily = useCallback(
    (type: LampShadeType) => {
      const next = switchFamily(def, type, familyMemory.current);
      familyMemory.current = next.memory;
      setDef(preserveMechanics(def, next.def));
    },
    [def],
  );
  const handlePreset = useCallback((preset: LampPreset) => setDef((prev) => preserveMechanics(prev, applyLampPreset(prev, preset))), []);
  const handleVariation = useCallback(() => {
    const variation = generateLampVariation(def, newSeed());
    setDef(preserveMechanics(def, variation.def));
    if (variation.fellBack) toast.error("No se encontró una variación válida con estas medidas; se cargó un diseño inicial.");
  }, [def, toast]);
  const handleRestoreLast = useCallback(() => {
    if (lastGood) setDef(lastGood);
  }, [lastGood]);
  const handleApplyStandard = useCallback(async () => {
    const what = describeDeviations(deviations);
    const ok = await confirmAction({
      title: "¿Usar las medidas estándar?",
      description: `Este diseño usa medidas mecánicas anteriores${what.length > 0 ? ` (${what.join(", ")})` : ""}. Pasar al estándar cambia cómo encaja con la base y la rosca: las piezas ya impresas con las medidas anteriores no van a encajar igual.`,
      confirmLabel: "Usar el estándar",
    });
    if (ok) setDef((prev) => applyStandardMechanics(prev));
  }, [confirmAction, deviations]);

  // ---- diseños: nuevo, guardar, abrir, restablecer
  const openDesign = useCallback(
    (next: LampDefinition, nextName: string, id: string | null) => {
      setDef(next);
      setBaseline(next);
      setName(nextName);
      setSavedId(id);
      setSelected("shade");
      familyMemory.current = {};
      setLastGood(null);
      resetView();
    },
    [resetView],
  );
  const confirmDiscard = useCallback(
    async (action: string) => (!dirty ? true : confirmAction({ title: action, description: "Tenés cambios sin guardar en este diseño: se van a perder.", confirmLabel: "Continuar", destructive: true })),
    [dirty, confirmAction],
  );
  const handleNew = useCallback(async () => {
    if (await confirmDiscard("¿Empezar un diseño nuevo?")) openDesign(newLampDesign(), DEFAULT_LAMP_NAME, null);
  }, [confirmDiscard, openDesign]);
  const handleSave = useCallback(() => {
    const id = saved.save(name, designCode, savedId);
    if (id === null) {
      toast.error("No se pudo guardar en este navegador. Copiá el código del diseño desde «Mis diseños».");
      return;
    }
    setSavedId(id);
    setBaseline(def);
    toast.success("Diseño guardado en este navegador.");
  }, [saved, name, designCode, savedId, def, toast]);
  const handleOpenSaved = useCallback(
    async (item: SavedLampDesign) => {
      if (!(await confirmDiscard(`¿Abrir «${item.name}»?`))) return;
      const decoded = decodeLampDesign(item.code);
      if ("error" in decoded) toast.error(decoded.error);
      else openDesign(decoded.def, item.name, item.id);
    },
    [confirmDiscard, openDesign, toast],
  );
  const handleLoadCode = useCallback(
    async (code: string): Promise<string | null> => {
      const decoded = decodeLampDesign(code);
      if ("error" in decoded) return decoded.error;
      if (!(await confirmDiscard("¿Abrir el diseño del código?"))) return null;
      openDesign(decoded.def, DEFAULT_LAMP_NAME, null);
      return null;
    },
    [confirmDiscard, openDesign],
  );
  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(designCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("No se pudo copiar. Seleccioná el código y copialo a mano.");
    }
  }, [designCode, toast]);
  const handleReset = useCallback(async () => {
    if (await confirmAction({ title: "¿Restablecer el diseño?", description: "Vuelve al diseño con el que empezaste (o el último que guardaste). Se pierden los cambios hechos desde entonces.", confirmLabel: "Restablecer", destructive: true })) {
      setDef(baseline);
      familyMemory.current = {};
    }
  }, [confirmAction, baseline]);
  const handleDeleteSaved = useCallback(
    async (item: SavedLampDesign) => {
      if (await confirmAction({ title: `¿Borrar «${item.name}»?`, description: "Se borra de este navegador. No se puede deshacer.", confirmLabel: "Borrar", destructive: true })) {
        saved.remove(item.id);
        if (savedId === item.id) setSavedId(null);
      }
    },
    [confirmAction, saved, savedId],
  );

  // ---- exportación: el STL sale de la MISMA malla que ve el visor (un solo nivel de calidad): descargar no regenera nada
  const run = useCallback(
    async (id: string, task: () => void | Promise<void>) => {
      setBusy(id);
      try {
        await task();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo exportar el STL.");
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  const guard = useCallback(() => {
    if (!canDownload) throw new Error("La lámpara del visor no corresponde a los valores actuales: resolvé el problema antes de descargar.");
  }, [canDownload]);
  const onDownloadPart = useCallback((kind: PartKind) => void run(kind, () => { guard(); return downloadLampPart(result, kind); }), [run, result, guard]);
  const onDownloadZip = useCallback(() => void run("zip", () => { guard(); return downloadLampZip(result, def); }), [run, result, def, guard]);
  const onDownloadTests = useCallback(() => void run("tests", () => downloadLampTestZip(def)), [run, def]);
  const exportProps: LampExportListProps = {
    hasInsert: def.insert.enabled,
    insertStyle: def.insert.style,
    insertPrintKind: isProfileStyle(def.insert.style) ? profilePrintKind(def.insert.style, def.insert.profileTop) : undefined,
    insertLabel: DIFFUSER_KIND_LABELS[diffuserKind(def.insert)].toLowerCase(),
    hasCollar: def.thread.connection === "collar",
    canDownload,
    canDownloadTests,
    busy,
    onDownloadPart,
    onDownloadZip,
    onDownloadTests,
    holderMeasured: def.holder.measured,
  };

  // ---- visor: cama de impresión (cada pieza en su orientación de impresión: misma tabla que la exportación)
  const profile = getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID);
  const bed = useMemo(() => {
    if (displayMode !== "bed" || !geometry) return null;
    const items = collectBedItems(geometry);
    return { items, layout: computeBedLayout(items, profile) };
  }, [displayMode, geometry, profile]);
  const plateCount = bed?.layout.plates.length ?? 0;
  const currentPlate = Math.min(Math.max(plateIndex, 1), Math.max(plateCount, 1));
  const partColors = useMemo(() => ({ lampInsert: def.insert.previewColor, lampInsertDrop: def.insert.previewColor }), [def.insert.previewColor]);

  // ---- componentes y vistas
  const currentInsertKind = insertKind(def);
  const presentKinds: PartKind[] = ["lampShade", ...(def.thread.connection === "collar" ? (["lampCollar"] as const) : []), ...(def.insert.enabled ? ([currentInsertKind] as const) : []), "body"];
  const barItems: BarComponent[] = [
    { kind: "lampShade", component: "shade", label: "Pantalla" },
    { kind: currentInsertKind, component: "diffuser", label: "Difusor" },
    { kind: "body", component: "base", label: "Base", attention: deviations.length > 0 },
  ];
  const toggleKind = (kind: PartKind) => setHidden((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  const selectedKinds = kindsOf(selected, def);
  const isolated = presentKinds.some((k) => selectedKinds.includes(k)) && presentKinds.filter((k) => !hidden.includes(k)).every((k) => selectedKinds.includes(k)) && hidden.length > 0;
  const canIsolate = presentKinds.some((k) => selectedKinds.includes(k));
  const toggleIsolate = () => {
    if (!canIsolate) return;
    if (isolated) setHidden([]);
    else setHidden(presentKinds.filter((k) => !selectedKinds.includes(k)));
    setExplosion(0);
    setSection(false);
  };
  const assembled = hidden.length === 0 && !section && explosion === 0;

  const tab = (id: Exclude<MobilePanel, null>, label: string) => (
    <button key={id} type="button" role="tab" aria-selected={mobilePanel === id} onClick={() => setMobilePanel((p) => (p === id ? null : id))} className={`h-10 flex-1 rounded-lg px-2 text-xs font-semibold transition-colors ${mobilePanel === id ? "bg-stampa-orange/15 text-stampa-accent" : "text-gray-400 hover:text-fg"}`}>
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3 lg:-mx-8 lg:-my-8 lg:h-[calc(100dvh-4rem)] lg:gap-0 lg:overflow-hidden" data-lamp-editor>
      <LampTopBar
        name={name}
        onNameChange={setName}
        onNew={handleNew}
        onSave={handleSave}
        dirty={dirty}
        canReset={dirty}
        onReset={handleReset}
        saved={saved.items}
        onOpenSaved={handleOpenSaved}
        onDeleteSaved={handleDeleteSaved}
        designCode={designCode}
        onCopyCode={handleCopyCode}
        onLoadCode={handleLoadCode}
        copied={copied}
        exportBlocker={canDownload ? null : primaryProblem}
        exportProps={exportProps}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-0">
        {/* ---------------------------------------------------------------- IZQUIERDA: biblioteca */}
        <aside aria-label="Biblioteca de diseños" className={`order-4 min-h-0 lg:order-1 lg:block lg:w-[248px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-stampa-border lg:p-3 ${mobilePanel === "library" ? "block" : "max-lg:hidden"}`}>
          <LampLibraryPanel def={def} onChange={setDef} onSelectFamily={handleFamily} onApplyPreset={handlePreset} onGenerateVariation={handleVariation} />
        </aside>

        {/* ---------------------------------------------------------------- CENTRO: visor + barra inferior */}
        <div className="order-1 flex min-h-0 min-w-0 flex-col max-lg:sticky max-lg:top-2 max-lg:z-20 lg:order-2 lg:flex-1">
          <section aria-label="Visor 3D" className={"theme-force-dark relative h-[36dvh] min-h-[230px] overflow-hidden rounded-t-2xl border border-b-0 border-stampa-border bg-stampa-surface lg:h-auto lg:min-h-0 lg:flex-1 lg:rounded-none lg:border-0 " + (outdated ? "[&_canvas]:opacity-40" : "")}>
            <MakerViewport
              geometry={geometry}
              displayMode={displayMode}
              explosionAmount={explosion}
              bed={bed ? { items: bed.items, layout: bed.layout, profile, plateIndex: currentPlate } : null}
              zUp
              hiddenKinds={hidden}
              sectionView={section}
              partColors={partColors}
              shadeOpacity={def.shadeType === "openwork" ? 0.95 : null}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3">
              <div className="flex flex-col items-start gap-2">
                {outdated && (
                  <span role="alert" className="pointer-events-auto max-w-sm rounded-lg border border-red-500/50 bg-stampa-surface/90 px-2.5 py-1.5 text-[11px] font-semibold text-red-300 backdrop-blur-md">
                    Vista anterior{primaryProblem ? `: ${primaryProblem}` : ""} No corresponde a los controles y no se puede descargar.
                  </span>
                )}
                {displayMode === "bed" && bed && <BedWarnings layout={bed.layout} profile={profile} />}
                <span className="pointer-events-auto w-fit rounded-lg border border-amber-500/40 bg-stampa-surface/80 px-2.5 py-1 text-[11px] font-semibold text-amber-300 backdrop-blur-md">Pendiente de validación física</span>
              </div>
              {displayMode === "bed" && <BedLabel profile={profile} plateIndex={currentPlate} plateCount={plateCount} />}
            </div>
          </section>
          <LampBottomBar
            items={barItems}
            selected={selected}
            onSelect={(component) => {
              setSelected(component);
              setMobilePanel((p) => (p === "library" || p === null ? "properties" : p));
            }}
            hidden={hidden}
            onToggleVisible={toggleKind}
            bed={displayMode === "bed"}
            onBedChange={(isBed) => setDisplayMode(isBed ? "bed" : "model")}
            exploded={explosion > 0}
            onToggleExploded={() => { setExplosion((v) => (v > 0 ? 0 : 60)); }}
            section={section}
            onToggleSection={() => setSection((v) => !v)}
            assembled={assembled}
            onAssembled={() => { setHidden([]); setSection(false); setExplosion(0); }}
            isolated={isolated}
            canIsolate={canIsolate}
            onToggleIsolate={toggleIsolate}
            plateCount={plateCount}
            plateIndex={currentPlate}
            onPlateChange={setPlateIndex}
          />
        </div>

        {/* ---------------------------------------------------------------- MÓVIL: familia compacta y pestañas (un solo panel a la vez) */}
        <div className="order-2 flex flex-col gap-2 lg:hidden">
          <div role="radiogroup" aria-label="Tipo de lámpara" className="grid grid-cols-3 gap-1.5">
            {LAMP_FAMILY_ORDER.map((type) => (
              <button key={type} type="button" role="radio" aria-checked={def.shadeType === type} data-family={type} onClick={() => handleFamily(type)} className={`h-10 rounded-xl border px-2 text-xs font-semibold transition-colors ${def.shadeType === type ? "border-stampa-orange bg-stampa-orange/10 text-fg" : "border-fg/10 bg-fg/[0.03] text-gray-300"}`}>
                {LAMP_FAMILIES[type].label}
              </button>
            ))}
          </div>
          <div role="tablist" aria-label="Paneles" className="flex gap-1 rounded-xl border border-fg/10 bg-fg/[0.03] p-1">
            {tab("library", "Estilos")}
            {tab("properties", "Ajustes")}
            {tab("export", "Exportar")}
          </div>
        </div>

        {/* ---------------------------------------------------------------- DERECHA: propiedades del componente seleccionado */}
        <aside aria-label="Propiedades" className={`order-5 min-h-0 lg:order-3 lg:block lg:w-[320px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-stampa-border lg:p-3 ${mobilePanel === "properties" ? "block" : "max-lg:hidden"}`}>
          <LampPropertiesPanel
            component={selected}
            def={def}
            onChange={setDef}
            errors={result.errors}
            warnings={result.warnings}
            metrics={result.metrics}
            ranges={ranges}
            stale={stale}
            outdated={outdated}
            onAdvancedToggle={setMoreOpen}
            onRestoreLast={lastGood && lastGood !== def ? handleRestoreLast : undefined}
            onApplyStandardMechanics={handleApplyStandard}
          />
        </aside>

        {mobilePanel === "export" && (
          <section aria-label="Exportar" className="order-5 flex flex-col gap-2 lg:hidden">
            {!canDownload && primaryProblem && <p role="alert" className="text-xs text-red-300">{primaryProblem} Resolvelo para descargar.</p>}
            <LampExportList {...exportProps} />
          </section>
        )}
      </div>
    </div>
  );
}
