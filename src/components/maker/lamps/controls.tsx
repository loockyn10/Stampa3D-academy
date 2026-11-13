"use client";

import React from "react";
import { nearestInRange, specFor, type ControlRange } from "@/lib/maker/lamps/constraints";
import type { LampDefinition } from "@/lib/maker/lamps/types";

/** Piezas de formulario del editor de lámparas (compartidas por la biblioteca, las propiedades y la barra superior). */

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const fmt = (n: number) => String(round1(n)).replace(".", ",");
/** Dos decimales (medidas de montaje: 80, 81, 0,5). */
export const fmt2 = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
/** Con los decimales que pide la grilla del control (0,05 → dos; 0,5 → uno). */
export const fmtStep = (n: number, step: number) => String(step < 0.1 ? Math.round(n * 100) / 100 : step < 1 ? Math.round(n * 10) / 10 : Math.round(n)).replace(".", ",");

/** Rangos dinámicos de los controles (calculados por `constraints.ts` a partir de la validación real); sin contexto, cada control usa su envolvente fija. */
export interface RangeContextValue {
  def: LampDefinition;
  ranges: Record<string, ControlRange>;
  /** Controles cuyo rango todavía corresponde a valores anteriores (se está recalculando). */
  stale: ReadonlySet<string>;
}
export const RangeContext = React.createContext<RangeContextValue | null>(null);
export const NO_RANGES: Record<string, ControlRange> = {};
export const NO_STALE: ReadonlySet<string> = new Set();

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{children}</h3>;
}

export function InfoRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={strong ? "text-right font-bold text-stampa-accent" : "text-right font-semibold text-gray-200"}>{value}</span>
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-gray-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-fg/20 bg-fg/[0.06] text-stampa-accent focus:ring-2 focus:ring-stampa-orange/40 focus:ring-offset-0"
      />
      {label}
    </label>
  );
}

/** Slider con el valor visible y el rango de la envolvente fija (sin restricciones dinámicas). */
export function SliderField({ label, value, min, max, step, suffix = "", onChange, error }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs font-semibold text-gray-500">
        <span>{label}</span>
        <span className="text-gray-300">
          {fmt(value)}
          {suffix}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-stampa-orange" />
      {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
    </label>
  );
}

/**
 * Slider cuyo rango es el VÁLIDO para el estado actual (restricciones dinámicas): la interfaz no ofrece valores que el motor rechaza. Nunca modifica el
 * valor por su cuenta: si el valor actual quedó fuera del rango (p. ej. porque otro control cambió), se marca en rojo y se ofrece llevarlo al más cercano.
 */
export function RangeSlider({ path, label, value, onChange, suffix = "", error, step, min, max }: { path: string; label: string; value: number; onChange: (v: number) => void; suffix?: string; error?: string; step?: number; min?: number; max?: number }) {
  const ctx = React.useContext(RangeContext);
  const spec = ctx ? specFor(ctx.def, path) : undefined;
  const range = ctx?.ranges[path];
  const stale = !!ctx?.stale.has(path);
  const st = step ?? spec?.step ?? 1;
  const lo = range && !range.conflict ? range.min : (spec?.min ?? min ?? 0);
  const hi = range && !range.conflict ? range.max : (spec?.max ?? max ?? 100);
  const outside = Number.isFinite(value) && (value < lo - 1e-9 || value > hi + 1e-9);
  const limited = !!range && !range.conflict && (range.limitedMin || range.limitedMax);
  return (
    <div className={stale ? "opacity-75" : undefined} data-control={path}>
      <label className="block">
        <span className="mb-1 flex justify-between text-xs font-semibold text-gray-500">
          <span>{label}</span>
          <span className={outside ? "font-bold text-red-400" : "text-gray-300"}>
            {fmtStep(value, st)}
            {suffix}
          </span>
        </span>
        <input type="range" min={lo} max={hi} step={st} value={Math.min(hi, Math.max(lo, value))} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-stampa-orange" />
      </label>
      {limited && range && (
        <span className="mt-0.5 block text-[11px] text-gray-500">
          Válido: {fmtStep(range.min, st)}–{fmtStep(range.max, st)}
          {suffix}
          {range.limitedMax && range.maxReason ? " · máx.: " + range.maxReason : ""}
          {range.limitedMin && range.minReason ? " · mín.: " + range.minReason : ""}
        </span>
      )}
      {outside && range && !range.conflict && (
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-red-400">
          Fuera del rango válido.
          <button type="button" onClick={() => onChange(nearestInRange(range, value))} className="rounded-md border border-red-400/40 px-2 py-0.5 font-semibold hover:bg-red-400/10">
            Llevar a {fmtStep(nearestInRange(range, value), st)}
            {suffix}
          </button>
        </span>
      )}
      {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
    </div>
  );
}

/** Sección plegable (la única forma de plegado del editor: «Más ajustes» y «Detalles técnicos»). */
export function Details({ title, children, defaultOpen = false, onToggle, id }: { title: string; children: React.ReactNode; defaultOpen?: boolean; onToggle?: (open: boolean) => void; id?: string }) {
  return (
    <details open={defaultOpen} data-section={id} onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined} className="group rounded-xl border border-fg/10 bg-fg/[0.03]">
      <summary className="flex min-h-10 cursor-pointer select-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold text-gray-300">
        {title}
        <span aria-hidden className="text-gray-500 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3">{children}</div>
    </details>
  );
}

/** Diseños, estilos o formas que no se ofrecen con las medidas actuales: una línea discreta; las razones, al expandir. */
export function HiddenNote({ items, noun }: { items: { label: string; reason: string }[]; noun: string }) {
  if (items.length === 0) return null;
  return (
    <details className="text-xs text-gray-500">
      <summary className="cursor-pointer select-none">{items.length === 1 ? `1 ${noun} no disponible con estas medidas` : `${items.length} ${noun}s no disponibles con estas medidas`}</summary>
      <ul className="mt-1 list-disc pl-4">
        {items.map((h) => (
          <li key={h.label}>
            {h.label}: {h.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

export const MAIN_LABEL = "text-xs font-semibold uppercase tracking-wide text-gray-500";

/** Botón secundario del editor (altura táctil de 40 px en móvil). */
export const softButton = "inline-flex h-10 sm:h-8 items-center justify-center gap-1.5 rounded-lg border border-fg/10 bg-fg/[0.05] px-3 text-xs font-semibold text-gray-200 transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";
export const accentButton = "inline-flex h-10 sm:h-8 items-center justify-center gap-1.5 rounded-lg border border-stampa-orange/40 bg-stampa-orange/10 px-3 text-xs font-semibold text-stampa-accent transition-colors hover:bg-stampa-orange/20 disabled:cursor-not-allowed disabled:opacity-50";
export const primaryButton = "inline-flex h-10 sm:h-8 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-stampa-orange px-3 text-xs font-semibold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:cursor-not-allowed disabled:opacity-50";
