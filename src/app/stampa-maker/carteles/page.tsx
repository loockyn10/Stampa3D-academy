"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SectionTitle } from "@/components/ui/section-title";
import { Card } from "@/components/ui/card";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { MakerTextControls } from "@/components/maker/MakerTextControls";
import { MakerViewport, type MakerViewMode } from "@/components/maker/MakerViewport";
import { useLetterGeometry } from "@/hooks/maker/useLetterGeometry";
import { exportWord } from "@/lib/maker/exporters/exportWord";
import { downloadLettersZip } from "@/lib/maker/exporters/exportLettersZip";
import { DEFAULT_MAKER_FONT_ID } from "@/lib/maker/fonts/registry";
import type { LetterSignParams } from "@/lib/maker/types";

const DEFAULT_PARAMS: LetterSignParams = {
  text: "STAMPA",
  fontId: DEFAULT_MAKER_FONT_ID,
  heightMm: 100,
  depthMm: 40,
  wallMm: 1.6,
  baseMm: 1.2,
  frontType: "open",
  lidMm: 1.2,
  lidJoint: "glue",
  insertDepthMm: 3,
  clearanceMm: 0.2,
  lipWallMm: 0.8,
};

export default function StampaMakerCartelesPage() {
  const [params, setParams] = useState<LetterSignParams>(DEFAULT_PARAMS);
  const { geometry, loading, error, fieldErrors } = useLetterGeometry(params);
  const { toast } = useAppFeedback();
  const [lettersZipLoading, setLettersZipLoading] = useState(false);
  const [wordDownloading, setWordDownloading] = useState(false);
  const [viewMode, setViewMode] = useState<MakerViewMode>("assembled");

  const handleChange = useCallback((patch: Partial<LetterSignParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
  }, []);

  const baseFileName = params.text.trim().toLowerCase().replace(/\s+/g, "-") || "stampa-maker";

  const handleDownloadWord = useCallback(async () => {
    if (!geometry || geometry.triangleCount === 0) return;
    setWordDownloading(true);
    try {
      await exportWord(geometry, baseFileName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo exportar la palabra completa.");
    } finally {
      setWordDownloading(false);
    }
  }, [geometry, baseFileName, toast]);

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

  const canDownload =
    !loading && !error && fieldErrors.length === 0 && !!geometry && geometry.triangleCount > 0 && geometry.errors.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/stampa-maker" className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white">
        <ArrowLeft size={14} />
        Stampa Maker
      </Link>

      <SectionTitle eyebrow="Stampa Maker" title="Creador de Carteles" />

      <div className="grid gap-5 lg:grid-cols-[360px_1fr] lg:items-start">
        <MakerTextControls
          params={params}
          onChange={handleChange}
          fieldErrors={fieldErrors}
          geometryErrors={geometry?.errors ?? []}
          warnings={geometry?.warnings ?? []}
          error={error}
          loading={loading || wordDownloading}
          canDownload={canDownload}
          onDownloadWord={handleDownloadWord}
          onDownloadLetters={handleDownloadLetters}
          lettersZipLoading={lettersZipLoading}
          viewMode={viewMode}
          onChangeViewMode={setViewMode}
        />
        <Card className="overflow-hidden p-0 h-[clamp(400px,60vh,500px)] lg:h-[clamp(650px,75vh,750px)]">
          <MakerViewport geometry={geometry} viewMode={viewMode} />
        </Card>
      </div>
    </div>
  );
}
