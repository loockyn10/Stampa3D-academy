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
import type { MakerViewMode } from "@/components/maker/MakerViewport";

interface MakerTextControlsProps {
  params: LetterSignParams;
  onChange: (patch: Partial<LetterSignParams>) => void;
  fieldErrors: FieldError[];
  /** Errores geométricos (p.ej. LIP_COLLAPSED): el diseño no está listo para exportar mientras existan. */
  geometryErrors: LetterGeometryWarning[];
  warnings: LetterGeometryWarning[];
  error: string | null;
  loading: boolean;
  canDownload: boolean;
  onDownloadWord: () => void;
  onDownloadLetters: () => void;
  lettersZipLoading: boolean;
  viewMode: MakerViewMode;
  onChangeViewMode: (mode: MakerViewMode) => void;
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="grid gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`h-9 rounded-lg text-xs font-semibold transition-colors ${
              active ? "bg-stampa-orange/15 text-stampa-orange" : "text-gray-400 hover:text-white"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-gray-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-white/20 bg-white/[0.06] text-stampa-orange focus:ring-2 focus:ring-stampa-orange/40 focus:ring-offset-0"
      />
      {label}
    </label>
  );
}

const BODY_TYPE_OPTIONS: { value: LetterSignParams["bodyType"]; label: string }[] = [
  { value: "standard", label: "Estándar" },
  { value: "tapered", label: "Tapered" },
];

const RIBS_COUNT_OPTIONS = [
  { value: "0", label: "Sin costillas" },
  { value: "1", label: "1 costilla" },
  { value: "2", label: "2 costillas" },
];

const TAPER_STYLE_OPTIONS: { value: LetterSignParams["taperStyle"]; label: string }[] = [
  { value: "stepped", label: "Escalonado" },
  { value: "smooth", label: "Suave" },
];

/**
 * "Frente" es un selector de 4 vías directo sobre `frontType` (0.4: el
 * pedido separa FRENTE de ENCASTRE — ver más abajo — a diferencia de la
 * versión anterior, que combinaba frontType+lidJoint en un solo control de
 * 3 vías).
 */
const FRONT_TYPE_OPTIONS: { value: LetterSignParams["frontType"]; label: string }[] = [
  { value: "open", label: "Frente abierto" },
  { value: "lid", label: "Tapa completa" },
  { value: "perforated", label: "Perforado" },
  { value: "light-channel", label: "Canal luminoso" },
];

const JOINT_OPTIONS: { value: LetterSignParams["lidJoint"]; label: string }[] = [
  { value: "glue", label: "Pegado" },
  { value: "interior-lip", label: "Labio interior" },
];

const VIEW_MODE_OPTIONS: { value: MakerViewMode; label: string }[] = [
  { value: "assembled", label: "Ensamblada" },
  { value: "exploded", label: "Explosionada" },
];

export function MakerTextControls({
  params,
  onChange,
  fieldErrors,
  geometryErrors,
  warnings,
  error,
  loading,
  canDownload,
  onDownloadWord,
  onDownloadLetters,
  lettersZipLoading,
  viewMode,
  onChangeViewMode,
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

      {/* CUERPO */}
      <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Cuerpo</span>
          <CalculatorSelect
            value={params.bodyType}
            onChange={(value) => onChange({ bodyType: value as LetterSignParams["bodyType"] })}
            options={BODY_TYPE_OPTIONS}
          />
        </label>

        {params.bodyType === "tapered" && (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Modo</span>
              <SegmentedControl options={TAPER_STYLE_OPTIONS} value={params.taperStyle} onChange={(value) => onChange({ taperStyle: value })} />
            </label>
            <NumberField
              label="Expansión de la base"
              value={params.rearExpansionMm}
              onChange={(v) => onChange({ rearExpansionMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "rearExpansionMm")}
            />
          </>
        )}

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold text-gray-500">Modificadores</span>

          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <Toggle
              label="Costillas laterales"
              checked={params.ribsCount > 0}
              onChange={(checked) => onChange({ ribsCount: checked ? 1 : 0 })}
            />
            {params.ribsCount > 0 && (
              <div className="flex flex-col gap-3 pt-1">
                <CalculatorSelect
                  value={String(params.ribsCount)}
                  onChange={(value) => onChange({ ribsCount: Number(value) as 0 | 1 | 2 })}
                  options={RIBS_COUNT_OPTIONS}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Protrusión"
                    value={params.ribProtrusionMm}
                    onChange={(v) => onChange({ ribProtrusionMm: v })}
                    suffix="mm"
                    error={fieldError(fieldErrors, "ribProtrusionMm")}
                  />
                  <NumberField
                    label="Ancho"
                    value={params.ribWidthMm}
                    onChange={(v) => onChange({ ribWidthMm: v })}
                    suffix="mm"
                    error={fieldError(fieldErrors, "ribWidthMm")}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <Toggle
              label="Bisel frontal"
              checked={params.bevelEnabled}
              onChange={(checked) => onChange({ bevelEnabled: checked })}
            />
            {params.bevelEnabled && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <NumberField
                  label="Profundidad"
                  value={params.bevelDepthMm}
                  onChange={(v) => onChange({ bevelDepthMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "bevelDepthMm")}
                />
                <NumberField
                  label="Desplazamiento"
                  value={params.bevelInsetMm}
                  onChange={(v) => onChange({ bevelInsetMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "bevelInsetMm")}
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <Toggle
              label="Bisel lateral luminoso"
              checked={params.grooveEnabled}
              onChange={(checked) => onChange({ grooveEnabled: checked })}
            />
            {params.grooveEnabled && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <NumberField
                  label="Desplazamiento"
                  value={params.grooveInsetMm}
                  onChange={(v) => onChange({ grooveInsetMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "grooveInsetMm")}
                />
                <NumberField
                  label="Ancho"
                  value={params.grooveWidthMm}
                  onChange={(v) => onChange({ grooveWidthMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "grooveWidthMm")}
                />
                <NumberField
                  label="Posición (desde el frente)"
                  value={params.groovePositionMm}
                  onChange={(v) => onChange({ groovePositionMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "groovePositionMm")}
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <Toggle
              label="Bisel posterior"
              checked={params.rearBevelEnabled}
              onChange={(checked) => onChange({ rearBevelEnabled: checked })}
            />
            {params.rearBevelEnabled && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <NumberField
                  label="Profundidad"
                  value={params.rearBevelDepthMm}
                  onChange={(v) => onChange({ rearBevelDepthMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "rearBevelDepthMm")}
                />
                <NumberField
                  label="Desplazamiento"
                  value={params.rearBevelInsetMm}
                  onChange={(v) => onChange({ rearBevelInsetMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "rearBevelInsetMm")}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FRENTE */}
      <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Frente</span>
          <CalculatorSelect
            value={params.frontType}
            onChange={(value) => onChange({ frontType: value as LetterSignParams["frontType"] })}
            options={FRONT_TYPE_OPTIONS}
          />
        </label>

        {(params.frontType === "lid" || params.frontType === "perforated") && (
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <Toggle
              label="Bisel de tapa"
              checked={params.lidBevelEnabled}
              onChange={(checked) => onChange({ lidBevelEnabled: checked })}
            />
            {params.lidBevelEnabled && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <NumberField
                  label="Profundidad"
                  value={params.lidBevelDepthMm}
                  onChange={(v) => onChange({ lidBevelDepthMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "lidBevelDepthMm")}
                />
                <NumberField
                  label="Desplazamiento"
                  value={params.lidBevelInsetMm}
                  onChange={(v) => onChange({ lidBevelInsetMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "lidBevelInsetMm")}
                />
              </div>
            )}
          </div>
        )}

        {params.frontType === "lid" && (
          <>
            <NumberField
              label="Espesor de tapa"
              value={params.lidMm}
              onChange={(v) => onChange({ lidMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "lidMm")}
            />

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Encastre</span>
              <CalculatorSelect
                value={params.lidJoint}
                onChange={(value) => onChange({ lidJoint: value as LetterSignParams["lidJoint"] })}
                options={JOINT_OPTIONS}
              />
            </label>

            {params.lidJoint === "interior-lip" && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Profundidad de encastre"
                  value={params.insertDepthMm}
                  onChange={(v) => onChange({ insertDepthMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "insertDepthMm")}
                />
                <NumberField
                  label="Espesor del labio"
                  value={params.lipWallMm}
                  onChange={(v) => onChange({ lipWallMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "lipWallMm")}
                />
                <NumberField
                  label="Holgura"
                  value={params.clearanceMm}
                  onChange={(v) => onChange({ clearanceMm: v })}
                  suffix="mm"
                  error={fieldError(fieldErrors, "clearanceMm")}
                />
              </div>
            )}
          </>
        )}

        {params.frontType === "perforated" && (
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Diámetro de agujero"
              value={params.holeDiameterMm}
              onChange={(v) => onChange({ holeDiameterMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "holeDiameterMm")}
            />
            <NumberField
              label="Espaciado (centro a centro)"
              value={params.pitchMm}
              onChange={(v) => onChange({ pitchMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "pitchMm")}
            />
            <NumberField
              label="Margen de borde"
              value={params.edgeMarginMm}
              onChange={(v) => onChange({ edgeMarginMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "edgeMarginMm")}
            />
            <NumberField
              label="Espesor de máscara"
              value={params.maskThicknessMm}
              onChange={(v) => onChange({ maskThicknessMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "maskThicknessMm")}
            />
            <NumberField
              label="Cobertura lateral"
              value={params.maskSideDepthMm}
              onChange={(v) => onChange({ maskSideDepthMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "maskSideDepthMm")}
            />
            <NumberField
              label="Espesor lateral"
              value={params.maskWallThicknessMm}
              onChange={(v) => onChange({ maskWallThicknessMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "maskWallThicknessMm")}
            />
            <NumberField
              label="Holgura"
              value={params.maskClearanceMm}
              onChange={(v) => onChange({ maskClearanceMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "maskClearanceMm")}
            />
            <NumberField
              label="Espesor de difusor"
              value={params.diffuserThicknessMm}
              onChange={(v) => onChange({ diffuserThicknessMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "diffuserThicknessMm")}
            />
          </div>
        )}

        {params.frontType === "light-channel" && (
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Ancho del canal"
              value={params.channelWidthMm}
              onChange={(v) => onChange({ channelWidthMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "channelWidthMm")}
            />
            <NumberField
              label="Profundidad del canal"
              value={params.channelDepthMm}
              onChange={(v) => onChange({ channelDepthMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "channelDepthMm")}
            />
            <NumberField
              label="Margen del canal"
              value={params.channelOffsetMm}
              onChange={(v) => onChange({ channelOffsetMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "channelOffsetMm")}
            />
            <NumberField
              label="Espesor de difusor"
              value={params.diffuserThicknessMm}
              onChange={(v) => onChange({ diffuserThicknessMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "diffuserThicknessMm")}
            />
            <NumberField
              label="Holgura de difusor"
              value={params.diffuserClearanceMm}
              onChange={(v) => onChange({ diffuserClearanceMm: v })}
              suffix="mm"
              error={fieldError(fieldErrors, "diffuserClearanceMm")}
            />
          </div>
        )}

        {params.frontType !== "open" && (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-500">Vista</span>
            <SegmentedControl options={VIEW_MODE_OPTIONS} value={viewMode} onChange={onChangeViewMode} />
          </label>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {geometryErrors.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <span className="font-semibold uppercase tracking-wide text-red-200">Diseño no listo para exportar</span>
          {geometryErrors.map((err, i) => (
            <div key={`${err.code}-${i}`} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{err.message}</span>
            </div>
          ))}
        </div>
      )}

      {warnings.map((warning, i) => (
        <div
          key={`${warning.code}-${i}`}
          className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{warning.message}</span>
        </div>
      ))}

      <div className="flex flex-col gap-2">
        <Button onClick={onDownloadWord} disabled={!canDownload || loading} className="w-full">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {params.frontType !== "open" ? "Palabra completa (.zip)" : "Palabra completa (.stl)"}
        </Button>
        <GhostButton onClick={onDownloadLetters} disabled={!canDownload || loading || lettersZipLoading} className="w-full">
          {lettersZipLoading ? <Loader2 size={16} className="animate-spin" /> : <FileArchive size={16} />}
          Letras individuales (.zip)
        </GhostButton>
      </div>
    </Card>
  );
}
