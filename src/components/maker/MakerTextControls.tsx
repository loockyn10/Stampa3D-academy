"use client";

import React from "react";
import { AlertTriangle, Loader2, Upload, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import { CalculatorSelect } from "@/components/ui/calculator-select";
import { MAKER_FONTS } from "@/lib/maker/fonts/registry";
import type { LetterSignParams } from "@/lib/maker/types";
import type { LetterGeometryWarning } from "@/lib/maker/types";
import type { FieldError } from "@/lib/maker/validation";
import type { PngImportOptions } from "@/lib/maker/import/types";

/** Origen del diseño (0.5): texto, o archivo SVG/PNG importado a ContourGroups (lib/maker/import). */
export interface MakerSourceControls {
  mode: "text" | "file";
  onModeChange: (mode: "text" | "file") => void;
  fileName: string | null;
  fileKind: "svg" | "png" | null;
  importing: boolean;
  importError: string | null;
  importWarnings: string[];
  onFile: (file: File) => void;
  onClear: () => void;
  /** Alto del diseño importado, en mm (escala uniforme: el ancho sale del aspect ratio). */
  heightMm: number;
  onHeightChange: (heightMm: number) => void;
  widthMm: number | null;
  /** Solo PNG ya importado: "alpha" oculta umbral/invertir (la transparencia manda). */
  pngMode: "alpha" | "luminosity" | null;
  pngOptions: PngImportOptions;
  onPngOptionsChange: (patch: Partial<PngImportOptions>) => void;
}

interface MakerTextControlsProps {
  params: LetterSignParams;
  onChange: (patch: Partial<LetterSignParams>) => void;
  fieldErrors: FieldError[];
  /** Errores geométricos (p.ej. LIP_COLLAPSED): el diseño no está listo para exportar mientras existan. */
  geometryErrors: LetterGeometryWarning[];
  warnings: LetterGeometryWarning[];
  error: string | null;
  source: MakerSourceControls;
}

const SOURCE_MODE_OPTIONS: { value: "text" | "file"; label: string }[] = [
  { value: "text", label: "Texto" },
  { value: "file", label: "SVG / PNG" },
];

const SMOOTHING_OPTIONS: { value: PngImportOptions["smoothing"]; label: string }[] = [
  { value: "low", label: "Bajo" },
  { value: "medium", label: "Medio" },
  { value: "high", label: "Alto" },
];

function FileDropZone({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !disabled) onFile(file);
      }}
      className={`flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center transition-colors ${
        dragging ? "border-stampa-orange/70 bg-stampa-orange/10" : "border-white/15 bg-white/[0.03]"
      }`}
    >
      <Upload size={20} className="text-gray-500" />
      <p className="text-xs text-gray-400">Arrastrá un SVG o PNG o seleccioná un archivo.</p>
      <GhostButton type="button" onClick={() => inputRef.current?.click()} disabled={disabled}>
        Seleccionar archivo
      </GhostButton>
      <input
        ref={inputRef}
        type="file"
        accept=".svg,.png,image/svg+xml,image/png"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  compact = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  compact?: boolean;
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
            className={`${compact ? "h-7" : "h-9"} rounded-lg text-xs font-semibold transition-colors ${
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

export function NumberField({
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
  // Si el valor cambia desde afuera (p.ej. arrastrar un recorte en el viewport), el texto se resincroniza;
  // mientras el usuario escribe, el texto parseado ya coincide con `value` y no se toca.
  const [lastValue, setLastValue] = React.useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    const parsed = parseFloat(text.replace(",", "."));
    if (Number.isFinite(parsed) ? parsed !== value : value !== 0) setText(String(value));
  }

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

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
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

export function MakerTextControls({
  params,
  onChange,
  fieldErrors,
  geometryErrors,
  warnings,
  error,
  source,
}: MakerTextControlsProps) {
  const fromFile = source.mode === "file";
  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-500">Origen del diseño</span>
        <SegmentedControl options={SOURCE_MODE_OPTIONS} value={source.mode} onChange={source.onModeChange} />
      </div>

      {fromFile && (
        <div className="flex flex-col gap-3">
          {source.fileName ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="min-w-0">
                <span className="block text-[11px] font-semibold text-gray-500">Archivo</span>
                <span className="block truncate text-sm text-white">{source.fileName}</span>
              </div>
              <button
                type="button"
                onClick={source.onClear}
                aria-label="Quitar archivo"
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <FileDropZone onFile={source.onFile} disabled={source.importing} />
          )}

          {source.fileName && (
            <>
              <NumberField label="Alto del diseño" value={source.heightMm} onChange={source.onHeightChange} suffix="mm" />
              {source.widthMm !== null && (
                <span className="-mt-1 text-xs text-gray-500">Ancho resultante: {Math.round(source.widthMm * 10) / 10} mm</span>
              )}
            </>
          )}

          {source.fileKind === "png" && source.pngMode !== "alpha" && (
            <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <label className="block">
                <span className="mb-1 flex justify-between text-xs font-semibold text-gray-500">
                  <span>Umbral</span>
                  <span>{source.pngOptions.threshold}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={source.pngOptions.threshold}
                  onChange={(e) => source.onPngOptionsChange({ threshold: Number(e.target.value) })}
                  className="w-full accent-stampa-orange"
                />
              </label>
              <Toggle label="Invertir" checked={source.pngOptions.invert} onChange={(checked) => source.onPngOptionsChange({ invert: checked })} />
            </div>
          )}

          {source.fileKind === "png" && (
            <div className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Suavizado</span>
              <SegmentedControl
                options={SMOOTHING_OPTIONS}
                value={source.pngOptions.smoothing}
                onChange={(smoothing) => source.onPngOptionsChange({ smoothing })}
              />
            </div>
          )}

          {source.importing && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 size={14} className="animate-spin" />
              Procesando archivo…
            </div>
          )}
          {source.importError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{source.importError}</span>
            </div>
          )}
          {source.importWarnings.map((message, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{message}</span>
            </div>
          ))}
        </div>
      )}

      {!fromFile && (
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

      )}

      {!fromFile && (
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-500">Fuente</span>
        <CalculatorSelect
          value={params.fontId}
          onChange={(value) => onChange({ fontId: value as LetterSignParams["fontId"] })}
          options={MAKER_FONTS.map((font) => ({ value: font.id, label: font.label }))}
        />
      </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        {!fromFile && (
        <NumberField
          label="Alto"
          value={params.heightMm}
          onChange={(v) => onChange({ heightMm: v })}
          suffix="mm"
          error={fieldError(fieldErrors, "heightMm")}
        />
        )}
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

    </Card>
  );
}
