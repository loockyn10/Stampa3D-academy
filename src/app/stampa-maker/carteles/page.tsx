"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SectionTitle } from "@/components/ui/section-title";
import { Card } from "@/components/ui/card";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { MakerTextControls } from "@/components/maker/MakerTextControls";
import { MakerViewport } from "@/components/maker/MakerViewport";
import { useLetterGeometry } from "@/hooks/maker/useLetterGeometry";
import { exportLetterGeometryToSTL } from "@/lib/maker/exporters/exportSTL";
import { DEFAULT_MAKER_FONT_ID } from "@/lib/maker/fonts/registry";
import type { LetterSignParams } from "@/lib/maker/types";

const DEFAULT_PARAMS: LetterSignParams = {
  text: "STAMPA",
  fontId: DEFAULT_MAKER_FONT_ID,
  heightMm: 100,
  depthMm: 40,
  wallMm: 1.6,
  baseMm: 1.2,
};

export default function StampaMakerCartelesPage() {
  const [params, setParams] = useState<LetterSignParams>(DEFAULT_PARAMS);
  const { geometry, loading, error, fieldErrors } = useLetterGeometry(params);
  const { toast } = useAppFeedback();

  const handleChange = useCallback((patch: Partial<LetterSignParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleDownload = useCallback(() => {
    if (!geometry || geometry.triangleCount === 0) return;
    try {
      const fileName = params.text.trim().toLowerCase().replace(/\s+/g, "-") || "stampa-maker";
      exportLetterGeometryToSTL(geometry, fileName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo exportar el STL.");
    }
  }, [geometry, params.text, toast]);

  const canDownload = !loading && !error && fieldErrors.length === 0 && !!geometry && geometry.triangleCount > 0;

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
          warnings={geometry?.warnings ?? []}
          error={error}
          loading={loading}
          canDownload={canDownload}
          onDownload={handleDownload}
        />
        <Card className="overflow-hidden p-0">
          <MakerViewport geometry={geometry} />
        </Card>
      </div>
    </div>
  );
}
