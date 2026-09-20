"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { MakerMugControls, MugExportCard } from "@/components/maker/MakerMugControls";
import { MakerNeonProjectsPanel } from "@/components/maker/MakerNeonProjectsPanel";
import { MakerViewport, type MakerDisplayMode } from "@/components/maker/MakerViewport";
import { BedLabel, BedWarnings, ViewportViewCard } from "@/components/maker/MakerViewportOverlays";
import { useMugGeometry } from "@/hooks/maker/useMugGeometry";
import { useMugProjects } from "@/hooks/maker/useMugProjects";
import { exportWord } from "@/lib/maker/exporters/exportWord";
import { createMug } from "@/lib/maker/mugs/createMug";
import { DEFAULT_MUG } from "@/lib/maker/mugs/defaults";
import { applyMugRecipe, type MugSystemPreset } from "@/lib/maker/mugs/presets";
import type { MugDefinition } from "@/lib/maker/mugs/types";
import { collectBedItems, computeBedLayout } from "@/lib/maker/printBed/bedLayout";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";

export default function StampaMakerMugsPage() {
  // La página solo guarda la MugDefinition: toda la geometría sale del motor (lib/maker/mugs).
  const [def, setDef] = useState<MugDefinition>(DEFAULT_MUG);
  const [showInsert, setShowInsert] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useAppFeedback();

  // Estado puramente visual (no viaja al proyecto ni a la exportación).
  const [displayMode, setDisplayMode] = useState<MakerDisplayMode>("model");
  const [plateIndex, setPlateIndex] = useState(1);

  const { result } = useMugGeometry(def);
  const geometry = result.geometry;
  const canDownload = !!geometry && geometry.triangleCount > 0 && result.errors.length === 0;

  const handleApplyPreset = useCallback((preset: MugSystemPreset) => setDef((prev) => applyMugRecipe(prev, preset.recipe)), []);

  const handleReset = useCallback((): MugDefinition => {
    setDef(DEFAULT_MUG);
    return DEFAULT_MUG;
  }, []);
  const library = useMugProjects({ def, onLoad: setDef, onReset: handleReset });

  // El STL se genera aparte en calidad export (no en cada movimiento de slider). El inserto nunca se exporta.
  const handleDownload = useCallback(() => {
    setDownloading(true);
    setTimeout(async () => {
      try {
        const exported = createMug(def, { quality: "export" });
        if (!exported.geometry || exported.errors.length > 0) throw new Error(exported.errors[0]?.message ?? "No se pudo generar el jarro.");
        await exportWord(exported.geometry, "jarro");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo exportar el STL.");
      } finally {
        setDownloading(false);
      }
    }, 30);
  }, [def, toast]);

  // Vista Cama: el jarro apoya sobre su base (identidad de orientación), mismo perfil y packing que Carteles/Neon.
  const profile = getPrinterProfile(DEFAULT_PRINTER_PROFILE_ID);
  const bed = useMemo(() => {
    if (displayMode !== "bed" || !geometry) return null;
    const items = collectBedItems(geometry);
    return { items, layout: computeBedLayout(items, profile) };
  }, [displayMode, geometry, profile]);
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
          <h1 className="text-lg font-bold text-white">Jarros 3D</h1>
        </div>

        <MakerNeonProjectsPanel library={library} emptyText="Todavía no guardaste proyectos de Jarros." showType={false} />

        <MakerMugControls
          def={def}
          onChange={setDef}
          onApplyPreset={handleApplyPreset}
          errors={result.errors}
          warnings={result.warnings}
          metrics={result.metrics}
          showInsert={showInsert}
          onShowInsertChange={setShowInsert}
        />
      </aside>

      <section className="relative h-[70dvh] min-h-[420px] overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface lg:h-auto lg:min-h-0 lg:flex-1 lg:rounded-none lg:border-0">
        <MakerViewport
          geometry={geometry}
          displayMode={displayMode}
          bed={bed ? { items: bed.items, layout: bed.layout, profile, plateIndex: currentPlate } : null}
          helperMesh={def.mode === "insert-shell" && showInsert ? result.insertHelper : null}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>{displayMode === "bed" && bed && <BedWarnings layout={bed.layout} profile={profile} />}</div>
            <MugExportCard canDownload={canDownload} loading={downloading} onDownload={handleDownload} />
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
