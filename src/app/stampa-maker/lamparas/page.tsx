"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Layers, Scissors } from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { LampExportButtons, MakerLampControls } from "@/components/maker/MakerLampControls";
import { MakerViewport, type MakerDisplayMode } from "@/components/maker/MakerViewport";
import { BedLabel, BedWarnings, ViewportViewCard } from "@/components/maker/MakerViewportOverlays";
import { useLampConstraints } from "@/hooks/maker/useLampConstraints";
import { useLampGeometry } from "@/hooks/maker/useLampGeometry";
import { downloadLampPart, downloadLampTestZip, downloadLampZip, isTestPieceBlocker } from "@/lib/maker/lamps/exporters/lampFiles";
import { DEFAULT_LAMP } from "@/lib/maker/lamps/defaults";
import { insertKind } from "@/lib/maker/lamps/createLamp";
import { createInsertComparison } from "@/lib/maker/lamps/insert/compare";
import { applyLampPreset, type LampPreset } from "@/lib/maker/lamps/presets";
import { generateLampVariation } from "@/lib/maker/lamps/variation";
import type { LampDefinition } from "@/lib/maker/lamps/types";
import type { PartKind } from "@/lib/maker/types";
import { collectBedItems, computeBedLayout } from "@/lib/maker/printBed/bedLayout";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";

const PART_LABELS: Partial<Record<PartKind, string>> = {
  lampShade: "Pantalla",
  lampCollar: "Collar",
  lampInsert: "Inserto",
  lampInsertDrop: "Inserto",
  body: "Base",
};

function newSeed(): number {
  const buf = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(buf);
  else buf[0] = Math.floor(Math.random() * 4294967296);
  return buf[0];
}

export default function StampaMakerLampsPage() {
  // La página solo guarda la LampDefinition: toda la geometría sale del motor (lib/maker/lamps).
  const [def, setDef] = useState<LampDefinition>(DEFAULT_LAMP);
  const [hidden, setHidden] = useState<PartKind[]>([]);
  const [section, setSection] = useState(false);
  const [explosion, setExplosion] = useState(0);
  const [displayMode, setDisplayMode] = useState<MakerDisplayMode>("model");
  const [plateIndex, setPlateIndex] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const { toast } = useAppFeedback();

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { result, pending, outdated, outdatedReason } = useLampGeometry(def);
  const { ranges, stale } = useLampConstraints(def, advancedOpen);
  const geometry = result.geometry;
  // Se exporta solo la lámpara que corresponde a los controles: sin cambios pendientes, sin errores y sin que el visor esté mostrando una vista anterior.
  const canDownload = !pending && !outdated && !!geometry && geometry.triangleCount > 0 && result.errors.length === 0;
  const canDownloadTests = !pending && !result.errors.some(isTestPieceBlocker);

  const handlePreset = useCallback((preset: LampPreset) => setDef((prev) => applyLampPreset(prev, preset)), []);
  const handleVariation = useCallback(() => {
    const variation = generateLampVariation(def, newSeed());
    setDef(variation.def);
    if (variation.fellBack) toast.error("No se encontró una variación válida con estas medidas; se cargó un diseño inicial.");
  }, [def, toast]);

  // El STL sale de la MISMA malla que ve el visor (un solo nivel de calidad): descargar no regenera nada.
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
    if (!canDownload) throw new Error("La lámpara del visor no corresponde a los valores actuales: resolvé los errores antes de descargar.");
  }, [canDownload]);
  const onDownloadPart = useCallback((kind: PartKind) => void run(kind, () => { guard(); return downloadLampPart(result, kind); }), [run, result, guard]);
  const onDownloadZip = useCallback(() => void run("zip", () => { guard(); return downloadLampZip(result, def); }), [run, result, def, guard]);
  const onDownloadTests = useCallback(() => void run("tests", () => downloadLampTestZip(def)), [run, def]);

  const exportButtons = (
    <LampExportButtons
      hasInsert={def.insert.enabled}
      insertStyle={def.insert.style}
      hasCollar={def.thread.connection === "collar"}
      canDownload={canDownload}
      canDownloadTests={canDownloadTests}
      busy={busy}
      onDownloadPart={onDownloadPart}
      onDownloadZip={onDownloadZip}
      onDownloadTests={onDownloadTests}
      holderMeasured={def.holder.measured}
    />
  );

  // Vista Cama: cada pieza en su orientación de impresión (misma tabla que la exportación).
  const profile = getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID);
  const bed = useMemo(() => {
    if (displayMode !== "bed" || !geometry) return null;
    const items = collectBedItems(geometry);
    return { items, layout: computeBedLayout(items, profile) };
  }, [displayMode, geometry, profile]);
  const plateCount = bed?.layout.plates.length ?? 0;
  const currentPlate = Math.min(Math.max(plateIndex, 1), Math.max(plateCount, 1));

  const partColors = useMemo(() => ({ lampInsert: def.insert.previewColor, lampInsertDrop: def.insert.previewColor }), [def.insert.previewColor]);
  const currentInsertKind = insertKind(def);
  const presentKinds: PartKind[] = ["lampShade", ...(def.thread.connection === "collar" ? (["lampCollar"] as const) : []), ...(def.insert.enabled ? ([currentInsertKind] as const) : []), "body"];
  // Comparar estilos: los tres insertos reales lado a lado (mismo generador y validación); no reemplaza el ensamblado exportable.
  const comparison = useMemo(() => (compare && def.insert.enabled ? createInsertComparison(def) : null), [compare, def]);
  const viewGeometry = comparison?.geometry ?? geometry;
  const toggleKind = (kind: PartKind) => setHidden((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  const showAll = () => {
    setHidden([]);
    setSection(false);
  };
  const only = (kind: PartKind) => {
    setHidden(presentKinds.filter((k) => k !== kind));
    setSection(false);
    setExplosion(0);
  };
  // Para examinar la rosca: sin el inserto (tapa la vista de la unión) y en sección longitudinal.
  const inspectThread = () => {
    setHidden([currentInsertKind]);
    setSection(true);
    setExplosion(0);
  };

  // Para examinar el reborde interno de adhesión: solo la pantalla (o el collar) en sección.
  const inspectFlange = () => {
    setCompare(false);
    setHidden(presentKinds.filter((k) => k !== (def.thread.connection === "collar" ? "lampCollar" : "lampShade")));
    setSection(true);
    setExplosion(0);
  };

  return (
    <div className="flex flex-col gap-4 lg:-mx-8 lg:-my-8 lg:h-[calc(100dvh-4rem)] lg:flex-row lg:gap-0 lg:overflow-hidden">
      <aside className="order-2 flex min-h-0 flex-col gap-4 lg:order-none lg:w-[380px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-stampa-border lg:p-4">
        <div className="flex flex-col gap-1">
          <Link href="/stampa-maker" className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-fg">
            <ArrowLeft size={14} />
            Stampa Maker
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-bold text-fg">
            Lámparas E27
            <span className="rounded-full bg-stampa-orange/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stampa-accent">Beta</span>
          </h1>
        </div>
        <MakerLampControls
          def={def}
          onChange={setDef}
          onApplyPreset={handlePreset}
          onGenerateVariation={handleVariation}
          onLoadDesign={setDef}
          onError={(message) => toast.error(message)}
          errors={result.errors}
          warnings={result.warnings}
          metrics={result.metrics}
          exportButtons={exportButtons}
          ranges={ranges}
          stale={stale}
          outdated={outdated}
          onAdvancedToggle={setAdvancedOpen}
        />
      </aside>

      <section className={"theme-force-dark relative order-1 " + (outdated ? "[&_canvas]:opacity-40 " : "") + " h-[52dvh] min-h-[340px] overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface max-lg:sticky max-lg:top-2 max-lg:z-20 lg:order-none lg:h-auto lg:min-h-0 lg:flex-1 lg:rounded-none lg:border-0"}>
        <MakerViewport
          geometry={viewGeometry}
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
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              {outdated && (
                <span role="alert" className="pointer-events-auto max-w-sm rounded-lg border border-red-500/50 bg-stampa-surface/90 px-2.5 py-1.5 text-[11px] font-semibold text-red-300 backdrop-blur-md">
                  Vista anterior: los valores actuales no se pueden aplicar{outdatedReason ? ` — ${outdatedReason}` : ""} Esta lámpara NO corresponde a los controles y no se puede descargar.
                </span>
              )}
              {displayMode === "bed" && bed && <BedWarnings layout={bed.layout} profile={profile} />}
              {comparison && (
                <span className="pointer-events-auto max-w-sm rounded-lg border border-fg/10 bg-stampa-surface/80 px-2.5 py-1 text-[11px] font-semibold text-gray-300 backdrop-blur-md">
                  Comparando: plano · gota · ondulado (parámetros iniciales de cada estilo sobre tus medidas){comparison.skipped.length > 0 ? ` — no se pudo generar: ${comparison.skipped.map((x) => x.style).join(", ")}` : ""}
                </span>
              )}
              <span className="pointer-events-auto w-fit rounded-lg border border-amber-500/40 bg-stampa-surface/80 px-2.5 py-1 text-[11px] font-semibold text-amber-300 backdrop-blur-md">
                Pendiente de validación física{def.holder.measured ? "" : " · base NO VALIDADA"}
              </span>
            </div>
            <div className="pointer-events-auto hidden w-52 flex-col gap-2 rounded-2xl border border-fg/10 bg-stampa-surface/80 p-3 shadow-lg shadow-shade/30 backdrop-blur-md lg:flex">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Descargar</span>
              {exportButtons}
            </div>
          </div>
          <div className="flex items-end justify-between gap-3 lg:pr-[5.5rem]">
            <div className="flex flex-col gap-2">
              {displayMode === "bed" && <BedLabel profile={profile} plateIndex={currentPlate} plateCount={plateCount} />}
              {displayMode === "model" && (
                <div className="pointer-events-auto flex w-60 flex-col gap-2 rounded-2xl border border-fg/10 bg-stampa-surface/80 p-2 shadow-lg shadow-shade/30 backdrop-blur-md lg:w-64 lg:p-2.5">
                  <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-gray-500 lg:block">Ver piezas</span>
                  <div className="flex flex-wrap gap-1" role="group" aria-label="Piezas visibles">
                    {presentKinds.map((kind) => {
                      const visible = !hidden.includes(kind);
                      return (
                        <button
                          key={kind}
                          type="button"
                          aria-pressed={visible}
                          title={visible ? `Ocultar ${PART_LABELS[kind]?.toLowerCase()}` : `Mostrar ${PART_LABELS[kind]?.toLowerCase()}`}
                          onClick={() => toggleKind(kind)}
                          className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold transition-colors ${visible ? "bg-stampa-orange/15 text-stampa-accent" : "text-gray-500 hover:text-fg"}`}
                        >
                          {visible ? <Eye size={12} /> : <EyeOff size={12} />}
                          {PART_LABELS[kind]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" aria-pressed={section} onClick={() => setSection((v) => !v)} className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold transition-colors ${section ? "bg-stampa-orange/15 text-stampa-accent" : "text-gray-400 hover:text-fg"}`} title="Corte longitudinal por el eje: se ven roscas, tope, encastres y holguras por dentro">
                      <Scissors size={12} />
                      Sección
                    </button>
                    <button type="button" onClick={inspectThread} className="h-7 rounded-lg px-2 text-xs font-semibold text-gray-400 transition-colors hover:text-fg">
                      Ver rosca
                    </button>
                    <button type="button" onClick={inspectFlange} className="h-7 rounded-lg px-2 text-xs font-semibold text-gray-400 transition-colors hover:text-fg" title="Corte de la pantalla sola: se ve el reborde interno de adhesión del extremo inferior">
                      Ver reborde
                    </button>
                    {def.insert.enabled && (
                      <button type="button" aria-pressed={compare} onClick={() => setCompare((v) => !v)} className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold transition-colors ${compare ? "bg-stampa-orange/15 text-stampa-accent" : "text-gray-400 hover:text-fg"}`} title="Los tres estilos de inserto lado a lado, con las medidas actuales">
                        <Layers size={12} />
                        Comparar estilos
                      </button>
                    )}
                    <button type="button" onClick={() => setExplosion((v) => (v > 0 ? 0 : 60))} aria-pressed={explosion > 0} className={`h-7 rounded-lg px-2 text-xs font-semibold transition-colors ${explosion > 0 ? "bg-stampa-orange/15 text-stampa-accent" : "text-gray-400 hover:text-fg"}`}>
                      Piezas separadas
                    </button>
                    {presentKinds.map((kind) => (
                      <button key={`only-${kind}`} type="button" onClick={() => only(kind)} className="h-7 rounded-lg px-2 text-xs font-semibold text-gray-400 transition-colors hover:text-fg">
                        Solo {PART_LABELS[kind]?.toLowerCase()}
                      </button>
                    ))}
                    <button type="button" onClick={() => { showAll(); setExplosion(0); }} className="h-7 rounded-lg px-2 text-xs font-semibold text-gray-400 transition-colors hover:text-fg">
                      Completa
                    </button>
                  </div>
                  <label className="block max-lg:hidden">
                    <span className="mb-1 flex justify-between text-xs font-semibold text-gray-500">
                      <span>Separación</span>
                      <span className="text-gray-300">{explosion}%</span>
                    </span>
                    <input type="range" min={0} max={100} step={1} value={explosion} onChange={(e) => setExplosion(Number(e.target.value))} className="w-full accent-stampa-orange" />
                  </label>
                </div>
              )}
            </div>
            <div className="max-lg:hidden">
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
        </div>
      </section>
    </div>
  );
}
