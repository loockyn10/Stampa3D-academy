"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { LampExportButtons, MakerLampControls } from "@/components/maker/MakerLampControls";
import { MakerViewport, type MakerDisplayMode } from "@/components/maker/MakerViewport";
import { BedLabel, BedWarnings, ViewportViewCard } from "@/components/maker/MakerViewportOverlays";
import { useLampGeometry } from "@/hooks/maker/useLampGeometry";
import { downloadLampPart, downloadLampZip } from "@/lib/maker/lamps/exporters/lampFiles";
import { DEFAULT_LAMP } from "@/lib/maker/lamps/defaults";
import { applyLampPreset, type LampPreset } from "@/lib/maker/lamps/presets";
import { generateLampVariation } from "@/lib/maker/lamps/variation";
import type { LampDefinition } from "@/lib/maker/lamps/types";
import type { PartKind } from "@/lib/maker/types";
import { collectBedItems, computeBedLayout } from "@/lib/maker/printBed/bedLayout";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";

type PartView = "all" | "noShade" | "shade" | "insert" | "base";

const VIEW_OPTIONS: { value: PartView; label: string }[] = [
  { value: "all", label: "Todo" },
  { value: "noShade", label: "Sin pantalla" },
  { value: "shade", label: "Pantalla" },
  { value: "insert", label: "Inserto" },
  { value: "base", label: "Base" },
];

const HIDDEN_BY_VIEW: Record<PartView, PartKind[]> = {
  all: [],
  noShade: ["lampShade"],
  shade: ["body", "lampInsert"],
  insert: ["body", "lampShade"],
  base: ["lampShade", "lampInsert"],
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
  const [view, setView] = useState<PartView>("all");
  const [explosion, setExplosion] = useState(0);
  const [displayMode, setDisplayMode] = useState<MakerDisplayMode>("model");
  const [plateIndex, setPlateIndex] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useAppFeedback();

  const { result, pending } = useLampGeometry(def);
  const geometry = result.geometry;
  const canDownload = !pending && !!geometry && geometry.triangleCount > 0 && result.errors.length === 0;

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

  const exportButtons = (
    <LampExportButtons
      hasInsert={def.insert.enabled}
      canDownload={canDownload}
      busy={busy}
      onDownloadPart={onDownloadPart}
      onDownloadZip={onDownloadZip}
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
  const hiddenKinds = HIDDEN_BY_VIEW[view];

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
          hiddenKinds={hiddenKinds}
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
                  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Piezas visibles">
                    {VIEW_OPTIONS.filter((o) => def.insert.enabled || o.value !== "insert").map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={view === o.value}
                        onClick={() => setView(o.value)}
                        className={`h-7 rounded-lg px-2 text-xs font-semibold transition-colors ${view === o.value ? "bg-stampa-orange/15 text-stampa-accent" : "text-gray-400 hover:text-fg"}`}
                      >
                        {o.label}
                      </button>
                    ))}
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
