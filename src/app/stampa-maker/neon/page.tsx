"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { MakerNeonControls, NeonExportCard } from "@/components/maker/MakerNeonControls";
import { MakerViewport, type MakerDisplayMode } from "@/components/maker/MakerViewport";
import { BedLabel, BedWarnings, ViewportViewCard } from "@/components/maker/MakerViewportOverlays";
import { useNeonGeometry } from "@/hooks/maker/useNeonGeometry";
import { exportWord } from "@/lib/maker/exporters/exportWord";
import { IMPORT_LIMITS } from "@/lib/maker/import/types";
import { DEFAULT_NEON_FONT_ID, DEFAULT_NEON_PARAMS, DEFAULT_NEON_TEXT } from "@/lib/maker/neon/defaults";
import type { NeonFontId, NeonParams, NeonSource, NeonSourceType } from "@/lib/maker/neon/types";
import { collectBedItems, computeBedLayout } from "@/lib/maker/printBed/bedLayout";
import { DEFAULT_PRINTER_PROFILE_ID, getPrinterProfile } from "@/lib/maker/printBed/printerProfiles";

export default function StampaMakerNeonPage() {
  const [params, setParams] = useState<NeonParams>(DEFAULT_NEON_PARAMS);
  const [sourceType, setSourceType] = useState<NeonSourceType>("text");
  const [text, setText] = useState(DEFAULT_NEON_TEXT);
  const [fontId, setFontId] = useState<NeonFontId>(DEFAULT_NEON_FONT_ID);
  const [svgFile, setSvgFile] = useState<{ fileName: string; content: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useAppFeedback();

  // Estado puramente visual, igual que en Carteles (no viaja a la exportación).
  const [displayMode, setDisplayMode] = useState<MakerDisplayMode>("model");
  const [plateIndex, setPlateIndex] = useState(1);

  const source = useMemo<NeonSource | null>(() => {
    if (sourceType === "text") return { type: "text", text, fontId };
    return svgFile ? { type: "svg", fileName: svgFile.fileName, content: svgFile.content } : null;
  }, [sourceType, text, fontId, svgFile]);

  const { result, inputError, fieldErrors } = useNeonGeometry(source, params);

  const handleChange = useCallback((patch: Partial<NeonParams>) => setParams((prev) => ({ ...prev, ...patch })), []);

  const handleFile = useCallback(async (picked: File) => {
    setFileError(null);
    if (!/\.svg$/i.test(picked.name)) {
      setFileError("Formato no soportado. Neon LED acepta archivos .svg de líneas/trazos.");
      return;
    }
    if (picked.size > IMPORT_LIMITS.maxFileBytes) {
      setFileError("El archivo es demasiado grande (máximo 10 MB).");
      return;
    }
    try {
      setSvgFile({ fileName: picked.name, content: await picked.text() });
    } catch {
      setFileError("No se pudo leer el archivo.");
    }
  }, []);

  const geometry = result?.geometry ?? null;
  const errors = result?.errors ?? [];
  const canDownload = !!geometry && geometry.triangleCount > 0 && errors.length === 0 && fieldErrors.length === 0 && !inputError;

  const baseFileName =
    sourceType === "svg"
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
          fileName={svgFile?.fileName ?? null}
          onFile={handleFile}
          onClearFile={() => {
            setSvgFile(null);
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
