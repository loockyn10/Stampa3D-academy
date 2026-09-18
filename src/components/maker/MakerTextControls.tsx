"use client";

import React from "react";
import { AlertTriangle, Download, FileArchive, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button, GhostButton } from "@/components/ui/button";
import { CalculatorSelect } from "@/components/ui/calculator-select";
import { MAKER_FONTS } from "@/lib/maker/fonts/registry";
import type { LetterSignParams } from "@/lib/maker/types";
import type { LetterGeometryWarning } from "@/lib/maker/types";
import type { FieldError } from "@/lib/maker/validation";

interface MakerTextControlsProps {
  params: LetterSignParams;
  onChange: (patch: Partial<LetterSignParams>) => void;
  fieldErrors: FieldError[];
  warnings: LetterGeometryWarning[];
  error: string | null;
  loading: boolean;
  canDownload: boolean;
  onDownloadWord: () => void;
  onDownloadLetters: () => void;
  lettersZipLoading: boolean;
}

function fieldError(fieldErrors: FieldError[], field: keyof LetterSignParams): string | undefined {
  return fieldErrors.find((e) => e.field === field)?.message;
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  error,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  error?: string;
}) {
  const [text, setText] = React.useState(() => String(value));

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(",", ".");
            setText(raw);
            const parsed = parseFloat(raw);
            onChange(Number.isFinite(parsed) ? parsed : 0);
          }}
          placeholder="0"
          className={`h-11 w-full rounded-xl border bg-white/[0.06] px-4 pr-12 text-sm text-white placeholder:text-neutral-500 outline-none transition focus:border-stampa-orange/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-stampa-orange/10 ${
            error ? "border-red-500/50" : "border-white/10"
          }`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-neutral-500">
            {suffix}
          </span>
        )}
      </div>
      {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
    </label>
  );
}

export function MakerTextControls({
  params,
  onChange,
  fieldErrors,
  warnings,
  error,
  loading,
  canDownload,
  onDownloadWord,
  onDownloadLetters,
  lettersZipLoading,
}: MakerTextControlsProps) {
  return (
    <Card className="flex flex-col gap-5 p-5">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-500">Texto</span>
        <input
          type="text"
          value={params.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="STAMPA"
          className={`h-11 w-full rounded-xl border bg-white/[0.06] px-4 text-sm text-white placeholder:text-neutral-500 outline-none transition focus:border-stampa-orange/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-stampa-orange/10 ${
            fieldError(fieldErrors, "text") ? "border-red-500/50" : "border-white/10"
          }`}
        />
        {fieldError(fieldErrors, "text") && (
          <span className="mt-1 block text-xs text-red-400">{fieldError(fieldErrors, "text")}</span>
        )}
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-500">Fuente</span>
        <CalculatorSelect
          value={params.fontId}
          onChange={(value) => onChange({ fontId: value as LetterSignParams["fontId"] })}
          options={MAKER_FONTS.map((font) => ({ value: font.id, label: font.label }))}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Alto"
          value={params.heightMm}
          onChange={(v) => onChange({ heightMm: v })}
          suffix="mm"
          error={fieldError(fieldErrors, "heightMm")}
        />
        <NumberField
          label="Profundidad"
          value={params.depthMm}
          onChange={(v) => onChange({ depthMm: v })}
          suffix="mm"
          error={fieldError(fieldErrors, "depthMm")}
        />
        <NumberField
          label="Pared"
          value={params.wallMm}
          onChange={(v) => onChange({ wallMm: v })}
          suffix="mm"
          error={fieldError(fieldErrors, "wallMm")}
        />
        <NumberField
          label="Fondo"
          value={params.baseMm}
          onChange={(v) => onChange({ baseMm: v })}
          suffix="mm"
          error={fieldError(fieldErrors, "baseMm")}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {warnings.map((warning) => (
        <div
          key={warning.code}
          className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{warning.message}</span>
        </div>
      ))}

      <div className="flex flex-col gap-2">
        <Button onClick={onDownloadWord} disabled={!canDownload || loading} className="w-full">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Palabra completa (.stl)
        </Button>
        <GhostButton onClick={onDownloadLetters} disabled={!canDownload || loading || lettersZipLoading} className="w-full">
          {lettersZipLoading ? <Loader2 size={16} className="animate-spin" /> : <FileArchive size={16} />}
          Letras individuales (.zip)
        </GhostButton>
      </div>
    </Card>
  );
}
