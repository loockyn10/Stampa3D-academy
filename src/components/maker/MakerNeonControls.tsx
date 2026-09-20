"use client";

import React from "react";
import { AlertTriangle, Download, Loader2, Upload, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import { NumberField, SegmentedControl } from "@/components/maker/MakerTextControls";
import { MakerRasterPanel } from "@/components/maker/MakerRasterPanel";
import { NEON_FONTS, NEON_FONT_CATEGORY_LABELS, type NeonFontDefinition } from "@/lib/maker/neon/fonts/neonFonts";
import { LETTER_SPACING_MAX_PCT, LETTER_SPACING_MIN_PCT, textToNeonPaths } from "@/lib/maker/neon/paths/textToNeonPaths";
import type { RasterConversion, RasterKind, RasterSettings } from "@/lib/maker/neon/raster/types";
import type { NeonFieldError } from "@/lib/maker/neon/validation/validateNeonParams";
import type { NeonFontId, NeonIssue, NeonMetrics, NeonParams, NeonSourceType } from "@/lib/maker/neon/types";

/** Formatos aceptados por el selector de archivos (la validación real es por firma del archivo, no por esto). */
export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,image/png,image/jpeg";

const SOURCE_OPTIONS: { value: NeonSourceType; label: string }[] = [
  { value: "text", label: "Texto" },
  { value: "svg", label: "SVG" },
  { value: "image", label: "Imagen" },
];

const round1 = (n: number) => Math.round(n * 10) / 10;
const meters = (mm: number) => `${(mm / 1000).toFixed(2)} m`;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{children}</h3>;
}

function InfoRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={strong ? "font-bold text-stampa-orange" : "font-semibold text-gray-200"}>{value}</span>
    </div>
  );
}

const previewCache = new Map<string, { d: string; w: number; h: number } | null>();

/** Mini vista previa 2D: el nombre de la fuente dibujado con SU PROPIA geometría de trazo único (sin 3D). */
function fontPreview(font: NeonFontDefinition) {
  if (previewCache.has(font.id)) return previewCache.get(font.id) ?? null;
  let out: { d: string; w: number; h: number } | null = null;
  try {
    const paths = textToNeonPaths(font.label, font.id, 20).paths;
    let maxX = 0, maxY = 0;
    for (const p of paths) for (const [x, y] of p.points) [maxX, maxY] = [Math.max(maxX, x), Math.max(maxY, y)];
    const d = paths
      .map((p) => "M" + p.points.map(([x, y]) => `${Math.round(x * 10) / 10} ${Math.round((maxY - y) * 10) / 10}`).join("L") + (p.closed ? "Z" : ""))
      .join("");
    out = { d, w: maxX, h: maxY };
  } catch {
    out = null;
  }
  previewCache.set(font.id, out);
  return out;
}

function NeonFontPicker({ value, onChange }: { value: NeonFontId; onChange: (id: NeonFontId) => void }) {
  return (
    <div role="radiogroup" aria-label="Fuente Neon" className="flex flex-col gap-1.5">
      {NEON_FONTS.map((font) => {
        const active = font.id === value;
        const preview = fontPreview(font);
        return (
          <button
            key={font.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(font.id)}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
              active ? "border-stampa-orange/60 bg-stampa-orange/10" : "border-white/10 bg-white/[0.04] hover:border-white/25"
            }`}
          >
            <span className="flex h-9 w-28 shrink-0 items-center">
              {preview && (
                <svg viewBox={`-2 -2 ${preview.w + 4} ${preview.h + 4}`} className={`h-full w-full ${active ? "text-stampa-orange" : "text-gray-300"}`} preserveAspectRatio="xMinYMid meet" aria-hidden>
                  <path d={preview.d} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-gray-100">{font.label}</span>
              <span className="block truncate text-[11px] text-gray-500">{NEON_FONT_CATEGORY_LABELS[font.category]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FileDropZone({ onFile, disabled, accept, hint }: { onFile: (file: File) => void; disabled: boolean; accept: string; hint: string }) {
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
      <p className="text-xs text-gray-400">{hint}</p>
      <GhostButton type="button" onClick={() => inputRef.current?.click()} disabled={disabled}>
        Seleccionar archivo
      </GhostButton>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
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

export interface MakerNeonControlsProps {
  params: NeonParams;
  onChange: (patch: Partial<NeonParams>) => void;
  fieldErrors: NeonFieldError[];
  sourceType: NeonSourceType;
  onSourceTypeChange: (type: NeonSourceType) => void;
  text: string;
  onTextChange: (text: string) => void;
  fontId: NeonFontId;
  onFontChange: (id: NeonFontId) => void;
  letterSpacingPct: number;
  onLetterSpacingChange: (pct: number) => void;
  fileName: string | null;
  /** Solo origen "imagen" con un archivo cargado: conversión raster (preview + controles). */
  raster: {
    fileName: string;
    bytes: Uint8Array;
    kind: RasterKind;
    settings: RasterSettings;
    onChange: (patch: Partial<RasterSettings>) => void;
    conversion: Pick<RasterConversion, "preview" | "stats"> | null;
    analyzing: boolean;
  } | null;
  onFile: (file: File) => void;
  onClearFile: () => void;
  fileError: string | null;
  inputError: string | null;
  metrics: NeonMetrics | null;
  errors: NeonIssue[];
  warnings: NeonIssue[];
}

/** Panel izquierdo de /stampa-maker/neon. Solo presentación: el estado vive en la página. */
export function MakerNeonControls(props: MakerNeonControlsProps) {
  const { params, onChange, fieldErrors, metrics } = props;
  const err = (field: keyof NeonParams) => fieldErrors.find((e) => e.field === field)?.message;
  const innerWidth = params.neonWidthMm + params.clearanceMm;
  const innerWidthValid = Number.isFinite(innerWidth);

  return (
    <Card className="flex flex-col gap-5 p-5">
      <section className="flex flex-col gap-3">
        <SectionLabel>Origen</SectionLabel>
        <SegmentedControl options={SOURCE_OPTIONS} value={props.sourceType} onChange={props.onSourceTypeChange} />

        {props.sourceType === "text" ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Texto</span>
              <input
                type="text"
                value={props.text}
                maxLength={40}
                onChange={(e) => props.onTextChange(e.target.value)}
                placeholder="STAMPA"
                className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white placeholder:text-neutral-500 outline-none transition focus:border-stampa-orange/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-stampa-orange/10"
              />
            </label>
          </>
        ) : props.fileName ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <span className="truncate text-xs font-semibold text-gray-200">{props.fileName}</span>
            <button type="button" onClick={props.onClearFile} aria-label="Quitar archivo" className="text-gray-500 hover:text-white">
              <X size={14} />
            </button>
          </div>
        ) : (
          <FileDropZone
            onFile={props.onFile}
            disabled={false}
            accept={props.sourceType === "image" ? IMAGE_ACCEPT : ".svg,image/svg+xml"}
            hint={props.sourceType === "image" ? "Arrastrá un PNG o JPG de alto contraste (logo, dibujo, texto) o seleccioná un archivo." : "Arrastrá un SVG de líneas/trazos o seleccioná un archivo."}
          />
        )}
        {props.sourceType !== "text" && props.fileError && <p className="text-xs text-red-400">{props.fileError}</p>}
        {props.sourceType === "image" && props.raster && (
          <MakerRasterPanel
            fileName={props.raster.fileName}
            bytes={props.raster.bytes}
            kind={props.raster.kind}
            settings={props.raster.settings}
            onChange={props.raster.onChange}
            conversion={props.raster.conversion}
            analyzing={props.raster.analyzing}
            metrics={metrics}
          />
        )}
        {props.inputError && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{props.inputError}</span>
          </div>
        )}
      </section>

      {props.sourceType !== "image" && (
      <section className="flex flex-col gap-3">
        <SectionLabel>Fuente Neon</SectionLabel>
        <NeonFontPicker value={props.fontId} onChange={props.onFontChange} />
        <NumberField
          label="Espaciado entre letras"
          value={props.letterSpacingPct}
          onChange={props.onLetterSpacingChange}
          suffix="%"
          error={
            props.letterSpacingPct < LETTER_SPACING_MIN_PCT || props.letterSpacingPct > LETTER_SPACING_MAX_PCT
              ? `Debe estar entre ${LETTER_SPACING_MIN_PCT} y ${LETTER_SPACING_MAX_PCT} %.`
              : undefined
          }
        />
        <p className="text-xs text-gray-500">
          0 % = espaciado recomendado por la fuente. Fuentes de trazo único: cada letra es el recorrido del Neon.
          {props.sourceType === "svg" ? " En un SVG se usa para los <text>." : ""}
        </p>
      </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionLabel>Tamaño</SectionLabel>
        <NumberField label="Alto del diseño" value={params.designHeightMm} onChange={(v) => onChange({ designHeightMm: v })} suffix="mm" error={err("designHeightMm")} />
        <InfoRow label="Ancho resultante" value={metrics ? `${round1(metrics.pathBounds.width)} mm` : "—"} />
        <p className="text-xs text-gray-500">Medido sobre el recorrido del Neon (línea central); el canal impreso suma su ancho exterior.</p>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Neon Flex</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Ancho" value={params.neonWidthMm} onChange={(v) => onChange({ neonWidthMm: v })} suffix="mm" error={err("neonWidthMm")} />
          <NumberField label="Holgura total" value={params.clearanceMm} onChange={(v) => onChange({ clearanceMm: v })} suffix="mm" error={err("clearanceMm")} />
        </div>
        <InfoRow label="Canal interior" value={innerWidthValid ? `${Math.round(innerWidth * 100) / 100} mm` : "—"} strong />
        <p className="text-xs text-gray-500">Canal interior = ancho + holgura total (no por lado).</p>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Canal</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Altura pared" value={params.wallHeightMm} onChange={(v) => onChange({ wallHeightMm: v })} suffix="mm" error={err("wallHeightMm")} />
          <NumberField label="Espesor pared" value={params.wallThicknessMm} onChange={(v) => onChange({ wallThicknessMm: v })} suffix="mm" error={err("wallThicknessMm")} />
        </div>
        <NumberField label="Espesor fondo" value={params.floorThicknessMm} onChange={(v) => onChange({ floorThicknessMm: v })} suffix="mm" error={err("floorThicknessMm")} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Curvatura</SectionLabel>
        <NumberField label="Radio mínimo" value={params.minBendRadiusMm} onChange={(v) => onChange({ minBendRadiusMm: v })} suffix="mm" error={err("minBendRadiusMm")} />
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Información</SectionLabel>
        <InfoRow label="Ancho total diseño" value={metrics && metrics.printedSize.width > 0 ? `${round1(metrics.printedSize.width)} mm` : "—"} />
        <InfoRow label="Alto total diseño" value={metrics && metrics.printedSize.height > 0 ? `${round1(metrics.printedSize.height)} mm` : "—"} />
        <InfoRow label="Longitud del recorrido" value={metrics ? meters(metrics.lengthMm) : "—"} />
        <InfoRow label="Neon recomendado (+5%)" value={metrics ? meters(metrics.recommendedLengthMm) : "—"} strong />
      </section>

      {props.errors.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <span className="font-semibold">Diseño no listo para exportar</span>
          {props.errors.map((e, i) => (
            <span key={`${e.code}-${i}`}>{e.message}</span>
          ))}
        </div>
      )}
      {props.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          {props.warnings.map((w, i) => (
            <div key={`${w.code}-${i}`} className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Tarjeta flotante de exportación del Neon: una sola pieza, un solo .stl. */
export function NeonExportCard({ canDownload, loading, onDownload }: { canDownload: boolean; loading: boolean; onDownload: () => void }) {
  return (
    <div className="pointer-events-auto flex w-52 flex-col gap-2 rounded-2xl border border-white/10 bg-stampa-surface/80 p-3 shadow-lg shadow-black/30 backdrop-blur-md">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Exportar</span>
      <button
        type="button"
        onClick={onDownload}
        disabled={!canDownload || loading}
        className="inline-flex h-8 w-full items-center justify-start gap-2 rounded-lg border border-transparent bg-stampa-orange px-3 text-xs font-semibold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        Descargar STL
      </button>
    </div>
  );
}
