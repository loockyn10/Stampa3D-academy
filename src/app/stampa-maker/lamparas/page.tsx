"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Scissors } from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { LampExportButtons, MakerLampControls } from "@/components/maker/MakerLampControls";
import { MakerViewport, type MakerDisplayMode } from "@/components/maker/MakerViewport";
import { BedLabel, BedWarnings, ViewportViewCard } from "@/components/maker/MakerViewportOverlays";
import { useLampGeometry } from "@/hooks/maker/useLampGeometry";
import { downloadLampPart, downloadLampTestZip, downloadLampZip, isTestPieceBlocker } from "@/lib/maker/lamps/exporters/lampFiles";
import { DEFAULT_LAMP } from "@/lib/maker/lamps/defaults";
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
  const { toast } = useAppFeedback();

  const { result, pending } = useLampGeometry(def);
  const geometry = result.geometry;
  const canDownload = !pending && !!geometry && geometry.triangleCount > 0 && result.errors.length === 0;
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
  const onDownloadPart = useCallback((kind: PartKind) => void run(kind, () => downloadLampPart(result, kind)), [run, result]);
  const onDownloadZip = useCallback(() => void run("zip", () => downloadLampZip(result, def)), [run, result, def]);
  const onDownloadTests = useCallback(() => void run("tests", () => downloadLampTestZip(def)), [run, def]);

  const exportButtons = (
    <LampExportButtons
      hasInsert={def.insert.enabled}
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

  const partColors = useMemo(() => ({ lampInsert: def.insert.previewColor }), [def.insert.previewColor]);
  const presentKinds: PartKind[] = ["lampShade", ...(def.thread.connection === "collar" ? (["lampCollar"] as const) : []), ...(def.insert.enabled ? (["lampInsert"] as const) : []), "body"];
  const toggleKind = (kind: PartKind) => setHidden((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  const showAll = () => {
    setHidden([]);
    setSection(false);
  };
  // Para examinar la rosca: sin el inserto (tapa la vista de la unión) y en sección longitudinal.
  const inspectThread = () => {
    setHidden(["lampInsert"]);
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
        />
      </aside>

      <section className="theme-force-dark relative order-1 h-[52dvh] min-h-[340px] overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface max-lg:sticky max-lg:top-2 max-lg:z-20 lg:order-none lg:h-auto lg:min-h-0 lg:flex-1 lg:rounded-none lg:border-0">
        <MakerViewport
          geometry={geometry}
          displayMode={displayMode}
          explosionAmount={explosion}
          bed={bed ? { items: bed.items, layout: bed.layout, profile, plateIndex: currentPlate } : null}
          zUp
          hiddenKinds={hidden}
          sectionView={section}
          partColors={partColors}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              {displayMode === "bed" && bed && <BedWarnings layout={bed.layout} profile={profile} />}
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
                    <button type="button" onClick={showAll} className="h-7 rounded-lg px-2 text-xs font-semibold text-gray-400 transition-colors hover:text-fg">
                      Todo
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
