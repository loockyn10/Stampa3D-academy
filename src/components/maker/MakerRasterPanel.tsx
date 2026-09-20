"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { NumberField, SegmentedControl } from "@/components/maker/MakerTextControls";
import { NEON_LENGTH_MARGIN } from "@/lib/maker/neon/defaults";
import type { NeonMetrics } from "@/lib/maker/neon/types";
import type { RasterCleaning, RasterConversion, RasterDetectionMode, RasterKind, RasterSettings, RasterSimplify } from "@/lib/maker/neon/raster/types";

type PreviewTab = "original" | "mask" | "path";

const TABS: { value: PreviewTab; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "mask", label: "Máscara" },
  { value: "path", label: "Recorrido" },
];

const MODES: { value: RasterDetectionMode; label: string }[] = [
  { value: "auto", label: "Automático" },
  { value: "alpha", label: "Transparencia" },
  { value: "luminance", label: "Luminosidad" },
];

const SIMPLIFY: { value: RasterSimplify; label: string }[] = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
];

const CLEANING: { value: string; label: string }[] = [
  { value: "0", label: "Ninguna" },
  { value: "1", label: "Suave" },
  { value: "2", label: "Media" },
  { value: "3", label: "Fuerte" },
];

const MIME: Record<RasterKind, string> = { png: "image/png", jpg: "image/jpeg" };

/** La imagen ORIGINAL (con su transparencia) dibujada en un canvas reducido: sin URLs de objeto ni estado. */
function OriginalCanvas({ bytes, kind, label }: { bytes: Uint8Array; kind: RasterKind; label: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    let cancelled = false;
    createImageBitmap(new Blob([bytes as BlobPart], { type: MIME[kind] }))
      .then((bmp) => {
        const canvas = ref.current;
        if (cancelled || !canvas) {
          bmp.close();
          return;
        }
        const s = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
        canvas.width = Math.max(1, Math.round(bmp.width * s));
        canvas.height = Math.max(1, Math.round(bmp.height * s));
        canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bytes, kind]);
  return (
    <canvas
      ref={ref}
      aria-label={label}
      className="h-full w-full object-contain"
      style={{ background: "repeating-conic-gradient(#2a2d33 0% 25%, #202226 0% 50%) 50% / 16px 16px" }}
    />
  );
}

function Slider({ label, value, min, max, onChange, suffix, disabled }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs font-semibold text-gray-500">
        <span>{label}</span>
        <span className="text-gray-300">
          {value}
          {suffix}
        </span>
      </span>
      <input type="range" min={min} max={max} step={1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-stampa-orange disabled:opacity-40" />
    </label>
  );
}

/** Máscara binaria dibujada en un canvas 2D (una sola vez por máscara): sin 3D. */
function MaskCanvas({ mask }: { mask: RasterConversion["preview"]["mask"] }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = mask.width;
    canvas.height = mask.height;
    const img = ctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      const v = mask.data[i] ? 235 : 28;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [mask]);
  return <canvas ref={ref} className="h-full w-full object-contain" style={{ imageRendering: "pixelated" }} aria-label="Máscara de la imagen" />;
}

function PathPreview({ preview }: { preview: RasterConversion["preview"] }) {
  const { mask, pathsPx, closed } = preview;
  return (
    <svg viewBox={`0 0 ${mask.width} ${mask.height}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-label="Recorrido Neon detectado">
      <rect width={mask.width} height={mask.height} fill="#15171b" />
      {pathsPx.map((pts, i) => (
        <polyline
          key={i}
          points={(closed[i] ? [...pts, pts[0]] : pts).map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`).join(" ")}
          fill="none"
          stroke="#ff8a3d"
          strokeWidth={Math.max(1.5, mask.width / 260)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export interface MakerRasterPanelProps {
  fileName: string;
  bytes: Uint8Array;
  kind: RasterKind;
  settings: RasterSettings;
  onChange: (patch: Partial<RasterSettings>) => void;
  /** Resultado de la conversión (null mientras no hay o falló). */
  conversion: Pick<RasterConversion, "preview" | "stats"> | null;
  /** true mientras se debouncea/recalcula. */
  analyzing: boolean;
  metrics: NeonMetrics | null;
}

/**
 * Panel de conversión imagen -> recorrido: preview 2D (Original / Máscara / Recorrido) y controles del pipeline raster.
 * PNG y JPEG usan exactamente los mismos controles.
 */
export function MakerRasterPanel({ fileName, bytes, kind, settings, onChange, conversion, analyzing, metrics }: MakerRasterPanelProps) {
  const [tab, setTab] = React.useState<PreviewTab>("path");

  const stats = conversion?.stats ?? null;
  const modeLuminance = (settings.detectionMode === "auto" ? stats?.modeUsed : settings.detectionMode) !== "alpha";
  const detected = stats && stats.modeUsed === "luminance" ? stats.thresholdUsed : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(ellipse_at_center,#23262c_0%,#15171b_75%)]">
        {tab === "original" && <OriginalCanvas bytes={bytes} kind={kind} label={fileName} />}
        {tab === "mask" && conversion && <MaskCanvas mask={conversion.preview.mask} />}
        {tab === "path" && conversion && <PathPreview preview={conversion.preview} />}
        {tab !== "original" && !conversion && <div className="flex h-full items-center justify-center px-4 text-center text-xs text-gray-500">Sin resultado todavía.</div>}
        {analyzing && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 text-xs font-semibold text-gray-100">
            <Loader2 size={14} className="animate-spin" />
            Analizando imagen…
          </div>
        )}
      </div>
      <SegmentedControl compact options={TABS} value={tab} onChange={setTab} />

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-gray-500">Modo de detección</span>
        {kind === "jpg" ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-gray-300">Luminosidad (el JPEG no tiene transparencia).</p>
        ) : (
          <SegmentedControl compact options={MODES} value={settings.detectionMode} onChange={(detectionMode) => onChange({ detectionMode })} />
        )}
        {kind === "png" && settings.detectionMode === "auto" && stats && (
          <span className="text-[11px] text-gray-500">Detectado: {stats.modeUsed === "alpha" ? "Transparencia" : "Luminosidad"}.</span>
        )}
      </div>

      {modeLuminance ? (
        <div className="flex flex-col gap-1.5">
          <Slider
            label="Umbral"
            value={settings.threshold ?? detected ?? 128}
            min={0}
            max={255}
            onChange={(threshold) => onChange({ threshold })}
          />
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-gray-300">
            <input
              type="checkbox"
              checked={settings.threshold === null}
              onChange={(e) => onChange({ threshold: e.target.checked ? null : (detected ?? 128) })}
              className="h-4 w-4 rounded border-white/20 bg-white/[0.06] text-stampa-orange"
            />
            Automático (Otsu){settings.threshold === null && detected !== null ? ` · detectado ${detected}` : ""}
          </label>
        </div>
      ) : (
        <Slider label="Umbral de transparencia" value={settings.alphaThreshold} min={0} max={255} onChange={(alphaThreshold) => onChange({ alphaThreshold })} />
      )}

      {modeLuminance && <Slider label="Contraste" value={settings.contrast} min={-100} max={100} onChange={(contrast) => onChange({ contrast })} />}

      <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-gray-300">
        <input type="checkbox" checked={settings.invert} onChange={(e) => onChange({ invert: e.target.checked })} className="h-4 w-4 rounded border-white/20 bg-white/[0.06] text-stampa-orange" />
        Invertir
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-gray-500">Limpieza</span>
        <SegmentedControl compact options={CLEANING} value={String(settings.cleaning)} onChange={(v) => onChange({ cleaning: Number(v) as RasterCleaning })} />
      </div>
      <NumberField label="Eliminar ramas menores de" value={settings.pruneMm} onChange={(pruneMm) => onChange({ pruneMm })} suffix="mm" error={settings.pruneMm < 0 || settings.pruneMm > 100 ? "Entre 0 y 100 mm." : undefined} />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-gray-500">Simplificación</span>
        <SegmentedControl compact options={SIMPLIFY} value={settings.simplify} onChange={(simplify) => onChange({ simplify })} />
      </div>
      <Slider label="Suavizado" value={settings.smoothing} min={0} max={100} onChange={(smoothing) => onChange({ smoothing })} />

      {stats && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs">
          <dt className="text-gray-500">Recorridos</dt>
          <dd className="text-right font-semibold text-gray-200">{stats.paths}</dd>
          <dt className="text-gray-500">Bifurcaciones</dt>
          <dd className="text-right font-semibold text-gray-200">{stats.junctions}</dd>
          <dt className="text-gray-500">Extremos</dt>
          <dd className="text-right font-semibold text-gray-200">{stats.endpoints}</dd>
          {metrics && (
            <>
              <dt className="text-gray-500">Longitud Neon</dt>
              <dd className="text-right font-semibold text-gray-200">{(metrics.lengthMm / 1000).toFixed(2)} m</dd>
              <dt className="text-gray-500">Neon recomendado (+{Math.round(NEON_LENGTH_MARGIN * 100)}%)</dt>
              <dd className="text-right font-bold text-stampa-orange">{(metrics.recommendedLengthMm / 1000).toFixed(2)} m</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
