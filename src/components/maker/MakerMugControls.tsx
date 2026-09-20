"use client";

import React from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { NumberField, SegmentedControl } from "@/components/maker/MakerTextControls";
import { deriveHandleDefaults } from "@/lib/maker/mugs/defaults";
import { MUG_SYSTEM_PRESETS, type MugSystemPreset } from "@/lib/maker/mugs/presets";
import type { MugBodyStyle, MugDefinition, MugHandleDef, MugHandleStyle, MugIssue, MugMetrics, MugMode, MugRimStyle } from "@/lib/maker/mugs/types";

const MODE_OPTIONS: { value: MugMode; label: string }[] = [
  { value: "printed", label: "Jarro impreso" },
  { value: "insert-shell", label: "Para inserto" },
];
const BODY_OPTIONS: { value: MugBodyStyle; label: string }[] = [
  { value: "straight", label: "Recto" },
  { value: "conical", label: "Cónico" },
  { value: "barrel", label: "Barril" },
  { value: "bulged", label: "Abombado" },
];
const RIM_OPTIONS: { value: MugRimStyle; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "thick", label: "Grueso" },
  { value: "rounded", label: "Redondeado" },
];
const HANDLE_OPTIONS: { value: MugHandleStyle; label: string }[] = [
  { value: "classic", label: "Clásica" },
  { value: "square", label: "Cuadrada" },
  { value: "angular", label: "Angular" },
];
const BASE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "reinforced", label: "Reforzada" },
] as const;
const SURFACE_OPTIONS = [
  { value: "smooth", label: "Lisa" },
  { value: "faceted", label: "Facetada" },
] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

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

export interface MakerMugControlsProps {
  def: MugDefinition;
  /** Cambio parcial de la definición: la UI nunca arma geometría, solo edita la MugDefinition. */
  onChange: (next: MugDefinition) => void;
  onApplyPreset: (preset: MugSystemPreset) => void;
  errors: MugIssue[];
  warnings: MugIssue[];
  metrics: MugMetrics | null;
  showInsert: boolean;
  onShowInsertChange: (show: boolean) => void;
  /** Sección DECORACIONES (ver MakerMugDecorationsPanel), se muestra después de ASA. */
  decorationsPanel?: React.ReactNode;
}

/** Panel izquierdo de /stampa-maker/jarros. Solo presentación: edita la MugDefinition y muestra métricas/avisos. */
export function MakerMugControls({ def, onChange, onApplyPreset, errors, warnings, metrics, showInsert, onShowInsertChange, decorationsPanel }: MakerMugControlsProps) {
  const err = (field: string) => errors.find((e) => e.field === field)?.message;
  const set = (patch: Partial<MugDefinition>) => onChange({ ...def, ...patch });
  const setHandle = (patch: Partial<MugHandleDef>) => onChange({ ...def, handle: { ...def.handle, ...patch } });
  const insert = def.mode === "insert-shell";
  const bulgeApplies = def.bodyStyle === "barrel" || def.bodyStyle === "bulged";
  const derived = deriveHandleDefaults(metrics?.heightMm ?? def.heightMm, metrics?.maxDiameterMm ?? Math.max(def.topDiameterMm, def.bottomDiameterMm));

  return (
    <Card className="flex flex-col gap-5 p-5">
      <section className="flex flex-col gap-3">
        <SectionLabel>Tipo de jarro</SectionLabel>
        <SegmentedControl options={MODE_OPTIONS} value={def.mode} onChange={(mode) => set({ mode })} />
        {insert ? (
          <p className="text-xs text-gray-500">El inserto no forma parte del STL.</p>
        ) : (
          <p className="text-xs text-gray-500">El uso final del recipiente depende del material, proceso de impresión y acabado utilizado.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Estilos</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {MUG_SYSTEM_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              onClick={() => onApplyPreset(preset)}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:border-stampa-orange/50 hover:text-white"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">Los estilos solo cambian la configuración: podés seguir ajustando todo después.</p>
      </section>

      {insert ? (
        <section className="flex flex-col gap-3">
          <SectionLabel>Inserto</SectionLabel>
          <NumberField label="Altura del inserto" value={def.insert.heightMm} onChange={(v) => set({ insert: { ...def.insert, heightMm: v } })} suffix="mm" error={err("insert.heightMm")} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Diám. superior" value={def.insert.topDiameterMm} onChange={(v) => set({ insert: { ...def.insert, topDiameterMm: v } })} suffix="mm" error={err("insert.topDiameterMm")} />
            <NumberField label="Diám. inferior" value={def.insert.bottomDiameterMm} onChange={(v) => set({ insert: { ...def.insert, bottomDiameterMm: v } })} suffix="mm" error={err("insert.bottomDiameterMm")} />
          </div>
          <NumberField label="Holgura (por lado)" value={def.insert.clearanceMm} onChange={(v) => set({ insert: { ...def.insert, clearanceMm: v } })} suffix="mm" error={err("insert.clearanceMm")} />
          <InfoRow label="Diámetro interior resultante" value={metrics ? `${round1(metrics.interior.bottomDiameterMm)} → ${round1(metrics.interior.topDiameterMm)} mm` : "—"} strong />
          <Toggle label="Mostrar inserto" checked={showInsert} onChange={onShowInsertChange} />
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <SectionLabel>Cuerpo</SectionLabel>
          <SegmentedControl options={BODY_OPTIONS} value={def.bodyStyle} onChange={(bodyStyle) => set({ bodyStyle })} compact />
          <NumberField label="Altura" value={def.heightMm} onChange={(v) => set({ heightMm: v })} suffix="mm" error={err("heightMm")} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Diám. superior" value={def.topDiameterMm} onChange={(v) => set({ topDiameterMm: v })} suffix="mm" error={err("topDiameterMm")} />
            <NumberField label="Diám. inferior" value={def.bottomDiameterMm} onChange={(v) => set({ bottomDiameterMm: v })} suffix="mm" error={err("bottomDiameterMm")} />
          </div>
        </section>
      )}

      {insert && (
        <section className="flex flex-col gap-3">
          <SectionLabel>Cuerpo</SectionLabel>
          <SegmentedControl options={BODY_OPTIONS} value={def.bodyStyle} onChange={(bodyStyle) => set({ bodyStyle })} compact />
          <p className="text-xs text-gray-500">La carcasa envuelve el inserto; Barril y Abombado agregan volumen exterior.</p>
        </section>
      )}

      {bulgeApplies && (
        <section className="flex flex-col gap-3">
          <NumberField label="Abombado (0–100)" value={def.bodyBulgePct} onChange={(v) => set({ bodyBulgePct: v })} suffix="%" error={err("bodyBulgePct")} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionLabel>Paredes</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={insert ? "Espesor carcasa" : "Espesor pared"} value={def.wallThicknessMm} onChange={(v) => set({ wallThicknessMm: v })} suffix="mm" error={err("wallThicknessMm")} />
          <NumberField label={insert ? "Base soporte" : "Espesor base"} value={def.bottomThicknessMm} onChange={(v) => set({ bottomThicknessMm: v })} suffix="mm" error={err("bottomThicknessMm")} />
        </div>
        {!insert && (
          <>
            <span className="text-xs font-semibold text-gray-500">Base</span>
            <SegmentedControl options={[...BASE_OPTIONS]} value={def.base} onChange={(base) => set({ base })} compact />
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Borde</SectionLabel>
        <SegmentedControl options={RIM_OPTIONS} value={def.rim} onChange={(rim) => set({ rim })} compact />
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Superficie</SectionLabel>
        <SegmentedControl options={[...SURFACE_OPTIONS]} value={def.surface.style} onChange={(style) => set({ surface: { ...def.surface, style } })} compact />
        {def.surface.style === "faceted" && (
          <NumberField label="Lados (6–32)" value={def.surface.sides} onChange={(v) => set({ surface: { ...def.surface, sides: Math.round(v) } })} error={err("surface.sides")} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Ranuras verticales</SectionLabel>
        <Toggle label="Activar ranuras" checked={def.grooves.enabled} onChange={(enabled) => set({ grooves: { ...def.grooves, enabled } })} />
        {def.grooves.enabled && (
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Cantidad (8–32)" value={def.grooves.count} onChange={(v) => set({ grooves: { ...def.grooves, count: Math.round(v) } })} error={err("grooves.count")} />
            <NumberField label="Profundidad" value={def.grooves.depthMm} onChange={(v) => set({ grooves: { ...def.grooves, depthMm: v } })} suffix="mm" error={err("grooves.depthMm")} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Bandas</SectionLabel>
        <Toggle label="Activar bandas" checked={def.bands.enabled} onChange={(enabled) => set({ bands: { ...def.bands, enabled } })} />
        {def.bands.enabled && (
          <>
            <NumberField label="Cantidad (0–5)" value={def.bands.count} onChange={(v) => set({ bands: { ...def.bands, count: Math.round(v) } })} error={err("bands.count")} />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Altura banda" value={def.bands.heightMm} onChange={(v) => set({ bands: { ...def.bands, heightMm: v } })} suffix="mm" error={err("bands.heightMm")} />
              <NumberField label="Relieve" value={def.bands.reliefMm} onChange={(v) => set({ bands: { ...def.bands, reliefMm: v } })} suffix="mm" error={err("bands.reliefMm")} />
            </div>
            <p className="text-xs text-gray-500">Distribución uniforme a lo alto del jarro.</p>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Asa</SectionLabel>
        <Toggle label="Con asa" checked={def.handle.enabled} onChange={(enabled) => setHandle({ enabled })} />
        {def.handle.enabled && (
          <>
            <SegmentedControl options={HANDLE_OPTIONS} value={def.handle.style} onChange={(style) => setHandle({ style })} compact />
            <Toggle label="Medidas automáticas (según el jarro)" checked={def.handle.auto} onChange={(auto) => setHandle(auto ? { auto } : { auto, heightMm: derived.heightMm, projectionMm: derived.projectionMm, verticalPositionPct: derived.verticalPositionPct })} />
            {def.handle.auto ? (
              <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <InfoRow label="Altura" value={`${derived.heightMm} mm`} />
                <InfoRow label="Proyección" value={`${derived.projectionMm} mm`} />
                <InfoRow label="Posición vertical" value={`${derived.verticalPositionPct} %`} />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Altura asa" value={def.handle.heightMm} onChange={(v) => setHandle({ heightMm: v })} suffix="mm" error={err("handle.heightMm")} />
                  <NumberField label="Proyección" value={def.handle.projectionMm} onChange={(v) => setHandle({ projectionMm: v })} suffix="mm" error={err("handle.projectionMm")} />
                </div>
                <NumberField label="Posición vertical" value={def.handle.verticalPositionPct} onChange={(v) => setHandle({ verticalPositionPct: v })} suffix="%" error={err("handle.verticalPositionPct")} />
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Espesor" value={def.handle.thicknessMm} onChange={(v) => setHandle({ thicknessMm: v })} suffix="mm" error={err("handle.thicknessMm")} />
              <NumberField label="Ancho sección" value={def.handle.sectionWidthMm} onChange={(v) => setHandle({ sectionWidthMm: v })} suffix="mm" error={err("handle.sectionWidthMm")} />
            </div>
          </>
        )}
      </section>

      {decorationsPanel}

      <section className="flex flex-col gap-2">
        <SectionLabel>Información</SectionLabel>
        <InfoRow label="Altura" value={metrics ? `${round1(metrics.heightMm)} mm` : "—"} />
        <InfoRow label="Diámetro máximo" value={metrics ? `${round1(metrics.maxDiameterMm)} mm` : "—"} />
        <InfoRow label="Capacidad geométrica aproximada" value={metrics?.capacityMl != null ? `≈ ${Math.round(metrics.capacityMl)} ml` : "—"} strong />
        <InfoRow label="Volumen de material" value={metrics?.materialVolumeCm3 != null ? `${round1(metrics.materialVolumeCm3)} cm³` : "—"} />
        <p className="text-xs text-gray-500">La capacidad se calcula sobre el perfil interior hasta el borde; no es el volumen útil real.</p>
      </section>

      {errors.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <span className="font-semibold">Diseño no listo para exportar</span>
          {errors.map((e, i) => (
            <span key={`${e.code}-${i}`}>{e.message}</span>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          {warnings.map((w, i) => (
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

/** Tarjeta flotante de exportación: una sola pieza, un solo .stl (el inserto nunca se exporta). */
export function MugExportCard({ canDownload, loading, onDownload }: { canDownload: boolean; loading: boolean; onDownload: () => void }) {
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
