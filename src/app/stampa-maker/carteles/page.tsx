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
import { useDesignImport } from "@/hooks/maker/useDesignImport";
import { detectFileKind, type FileDesignSource } from "@/lib/maker/import/importDesign";
import { DEFAULT_PNG_OPTIONS, IMPORT_LIMITS, type PngImportOptions } from "@/lib/maker/import/types";
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
  bodyType: "standard",
  rearExpansionMm: 2,
  taperStyle: "stepped",
  ribsCount: 0,
  ribProtrusionMm: 0.8,
  ribWidthMm: 1.2,
  bevelEnabled: false,
  bevelDepthMm: 2,
  bevelInsetMm: 1,
  grooveEnabled: false,
  grooveInsetMm: 1,
  grooveWidthMm: 4,
  groovePositionMm: 20,
  rearBevelEnabled: false,
  rearBevelDepthMm: 2,
  rearBevelInsetMm: 1,
  frontType: "open",
  lidMm: 1.2,
  lidJoint: "glue",
  insertDepthMm: 3,
  clearanceMm: 0.2,
  lipWallMm: 0.8,
  lidBevelEnabled: false,
  lidBevelDepthMm: 0.4,
  lidBevelInsetMm: 0.3,
  maskThicknessMm: 1,
  maskWallThicknessMm: 1.2,
  maskSideDepthMm: 5,
  maskClearanceMm: 0.2,
  diffuserThicknessMm: 0.6,
  holeDiameterMm: 2,
  pitchMm: 4,
  edgeMarginMm: 2,
  channelWidthMm: 6,
  channelDepthMm: 4,
  channelOffsetMm: 2,
  diffuserClearanceMm: 0.2,
};

export default function StampaMakerCartelesPage() {
  const [params, setParams] = useState<LetterSignParams>(DEFAULT_PARAMS);
  // Origen del diseño (0.5): texto, o archivo SVG/PNG -> ContourGroups (lib/maker/import).
  const [sourceMode, setSourceMode] = useState<"text" | "file">("text");
  const [file, setFile] = useState<FileDesignSource | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [designHeightMm, setDesignHeightMm] = useState(100);
  const [pngOptions, setPngOptions] = useState<PngImportOptions>(DEFAULT_PNG_OPTIONS);
  const fromFile = sourceMode === "file";
  const designImport = useDesignImport(fromFile ? file : null, designHeightMm, pngOptions);
  const { geometry, loading, error, fieldErrors } = useLetterGeometry(params, designImport.design, fromFile);
  const { toast } = useAppFeedback();
  const [lettersZipLoading, setLettersZipLoading] = useState(false);
  const [wordDownloading, setWordDownloading] = useState(false);
  const [viewMode, setViewMode] = useState<MakerViewMode>("assembled");

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

  const baseFileName = fromFile
    ? (file?.fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "diseno")
    : params.text.trim().toLowerCase().replace(/\s+/g, "-") || "stampa-maker";

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
    !loading && !designImport.loading && !error && !designImport.error && fieldErrors.length === 0 && !!geometry && geometry.triangleCount > 0 && geometry.errors.length === 0;

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
          loading={loading || designImport.loading || wordDownloading}
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
          canDownload={canDownload}
          onDownloadWord={handleDownloadWord}
          onDownloadLetters={handleDownloadLetters}
          lettersZipLoading={lettersZipLoading}
          viewMode={viewMode}
          onChangeViewMode={setViewMode}
        />
        <Card className="overflow-hidden p-0 h-[clamp(400px,60vh,500px)] lg:h-[clamp(650px,75vh,750px)]">
          <MakerViewport geometry={fromFile && !designImport.design ? null : geometry} viewMode={viewMode} />
        </Card>
      </div>
    </div>
  );
}
