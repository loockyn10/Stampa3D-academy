"use client";

import React from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileArchive, Loader2 } from "lucide-react";
import { SegmentedControl } from "@/components/maker/MakerTextControls";
import type { MakerDisplayMode, MakerViewMode } from "@/components/maker/MakerViewport";
import type { BedLayout } from "@/lib/maker/printBed/bedLayout";
import type { PrinterProfile } from "@/lib/maker/printBed/printerProfiles";

const CARD = "pointer-events-auto rounded-2xl border border-white/10 bg-stampa-surface/80 p-3 shadow-lg shadow-black/30 backdrop-blur-md";

const round = (n: number) => Math.round(n * 10) / 10;

interface ExportCardProps {
  /** true = el origen es un SVG/PNG importado (evita decir "Palabra"). */
  fromFile: boolean;
  /** Más de una pieza física => la exportación completa es un .zip. */
  multiPart: boolean;
  canDownload: boolean;
  loading: boolean;
  lettersLoading: boolean;
  onDownloadWord: () => void;
  onDownloadLetters: () => void;
}

/** Tarjeta flotante TOP-RIGHT: exportación. La lógica real vive en la página (exportWord / downloadLettersZip). */
export function ViewportExportCard({ fromFile, multiPart, canDownload, loading, lettersLoading, onDownloadWord, onDownloadLetters }: ExportCardProps) {
  const fullLabel = `${fromFile ? "Diseño completo" : "Palabra completa"} (${multiPart ? ".zip" : ".stl"})`;
  const btn =
    "inline-flex h-8 w-full items-center justify-start gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className={`${CARD} flex w-52 flex-col gap-2`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Exportar</span>
      <button
        type="button"
        onClick={onDownloadWord}
        disabled={!canDownload || loading}
        className={`${btn} border-transparent bg-stampa-orange text-neutral-950 hover:bg-stampa-orange-hover`}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        {fullLabel}
      </button>
      {!fromFile && (
        <button
          type="button"
          onClick={onDownloadLetters}
          disabled={!canDownload || loading || lettersLoading}
          className={`${btn} border-stampa-border bg-stampa-surface-soft text-stampa-text-muted hover:bg-white/10 hover:text-white`}
        >
          {lettersLoading ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
          Letras individuales (.zip)
        </button>
      )}
    </div>
  );
}

interface ViewCardProps {
  displayMode: MakerDisplayMode;
  onDisplayModeChange: (mode: MakerDisplayMode) => void;
  viewMode: MakerViewMode;
  onViewModeChange: (mode: MakerViewMode) => void;
  /** Con una sola pieza física (frente abierto) explosionar no cambia nada: se oculta el selector. */
  multiPart: boolean;
  explodePercent: number;
  onExplodePercentChange: (percent: number) => void;
  profile: PrinterProfile;
  plateCount: number;
  plateIndex: number;
  onPlateChange: (index: number) => void;
}

const DISPLAY_OPTIONS: { value: MakerDisplayMode; label: string }[] = [
  { value: "model", label: "Modelo" },
  { value: "bed", label: "Cama" },
];
const VIEW_OPTIONS: { value: MakerViewMode; label: string }[] = [
  { value: "assembled", label: "Ensamblada" },
  { value: "exploded", label: "Explosionada" },
];

/** Tarjeta flotante BOTTOM-RIGHT: modo de visualización y controles de vista. */
export function ViewportViewCard(props: ViewCardProps) {
  const { displayMode, viewMode, profile, plateCount, plateIndex } = props;
  return (
    <div className={`${CARD} flex w-64 flex-col gap-2.5`}>
      <div>
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Visualización</span>
        <SegmentedControl compact options={DISPLAY_OPTIONS} value={displayMode} onChange={props.onDisplayModeChange} />
      </div>

      {displayMode === "model" && props.multiPart && (
        <div>
          <SegmentedControl compact options={VIEW_OPTIONS} value={viewMode} onChange={props.onViewModeChange} />
          {viewMode === "exploded" && (
            <label className="mt-2.5 block">
              <span className="mb-1 flex justify-between text-xs font-semibold text-gray-500">
                <span>Separación</span>
                <span className="text-gray-300">{props.explodePercent}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={props.explodePercent}
                onChange={(e) => props.onExplodePercentChange(Number(e.target.value))}
                className="w-full accent-stampa-orange"
              />
            </label>
          )}
        </div>
      )}

      {displayMode === "bed" && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-gray-400">
            <span className="font-semibold text-white">{profile.name}</span>
            <span className="ml-1.5">
              {profile.widthMm}×{profile.depthMm}×{profile.heightMm}
            </span>
          </div>
          {plateCount > 1 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-500">Placa</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Placa anterior"
                  disabled={plateIndex <= 1}
                  onClick={() => props.onPlateChange(plateIndex - 1)}
                  className="rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="min-w-12 text-center text-xs font-semibold text-white">
                  {plateIndex} / {plateCount}
                </span>
                <button
                  type="button"
                  aria-label="Placa siguiente"
                  disabled={plateIndex >= plateCount}
                  onClick={() => props.onPlateChange(plateIndex + 1)}
                  className="rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Etiqueta de la cama (perfil, medidas, placa) — esquina inferior izquierda, solo en Vista Cama. */
export function BedLabel({ profile, plateIndex, plateCount }: { profile: PrinterProfile; plateIndex: number; plateCount: number }) {
  return (
    <div className="pointer-events-none rounded-xl border border-white/10 bg-stampa-surface/70 px-3 py-2 text-xs backdrop-blur-md">
      <div className="font-semibold text-white">{profile.name}</div>
      <div className="text-gray-400">
        {profile.widthMm} × {profile.depthMm} mm
      </div>
      <div className="text-stampa-orange">
        Placa {plateIndex}
        {plateCount > 1 ? ` de ${plateCount}` : ""}
      </div>
    </div>
  );
}

/** Avisos de la Vista Cama: piezas que no entran en el área o superan la altura. */
export function BedWarnings({ layout, profile }: { layout: BedLayout; profile: PrinterProfile }) {
  if (layout.oversize.length === 0 && layout.tooTall.length === 0) return null;
  return (
    <div className={`${CARD} flex max-w-sm flex-col gap-2 border-amber-500/30 text-xs text-amber-300`}>
      {layout.oversize.map((o) => (
        <div key={o.id} className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Esta pieza supera el área de impresión de la {profile.name}.
            <br />
            <span className="text-amber-200/80">
              Pieza ({o.label}): {round(o.widthMm)} × {round(o.depthMm)} mm · Cama: {profile.widthMm} × {profile.depthMm} mm
            </span>
          </span>
        </div>
      ))}
      {layout.tooTall.map((t) => (
        <div key={t.id} className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Esta pieza supera la altura de impresión de la {profile.name}.
            <br />
            <span className="text-amber-200/80">
              Pieza ({t.label}): {round(t.heightMm)} mm · Máximo: {profile.heightMm} mm
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
