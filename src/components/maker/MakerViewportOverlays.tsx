"use client";

import React from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileArchive, FileText, Loader2, Package } from "lucide-react";
import { SegmentedControl } from "@/components/maker/MakerTextControls";
import type { MakerDisplayMode } from "@/components/maker/MakerViewport";
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
  /** Exportación de INSTALACIÓN (separadores, plantilla, guía, kit). Ausente = el sistema de instalación no está activo. */
  installation?: InstallationExportProps | null;
}

export interface InstallationExportProps {
  canDownload: boolean;
  /** Cantidad de separadores de pared (0 = sin montaje de separadores). */
  spacerQuantity: number;
  /** Cantidad de soportes de empalme externos (letras - 1; 0 = sin cableado encadenado). */
  clipQuantity: number;
  hasGuide: boolean;
  loading: boolean;
  onSpacers: () => void;
  onClips: () => void;
  onTemplate: () => void;
  onGuide: () => void;
  onKit: () => void;
}

/** Tarjeta flotante TOP-RIGHT: exportación. La lógica real vive en la página (exportWord / downloadLettersZip). */
export function ViewportExportCard({ fromFile, multiPart, canDownload, loading, lettersLoading, onDownloadWord, onDownloadLetters, installation }: ExportCardProps) {
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
      {installation && (
        <>
          <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Instalación</span>
          {installation.spacerQuantity > 0 && (
            <button type="button" onClick={installation.onSpacers} disabled={!installation.canDownload || installation.loading} className={`${btn} border-stampa-border bg-stampa-surface-soft text-stampa-text-muted hover:bg-white/10 hover:text-white`}>
              <Download size={14} />
              Separadores ×{installation.spacerQuantity} (.stl)
            </button>
          )}
          {installation.clipQuantity > 0 && (
            <button type="button" onClick={installation.onClips} disabled={!installation.canDownload || installation.loading} className={`${btn} border-stampa-border bg-stampa-surface-soft text-stampa-text-muted hover:bg-white/10 hover:text-white`}>
              <Download size={14} />
              Soporte empalmes ×{installation.clipQuantity} (.stl)
            </button>
          )}
          <button type="button" onClick={installation.onTemplate} disabled={!installation.canDownload || installation.loading} className={`${btn} border-stampa-border bg-stampa-surface-soft text-stampa-text-muted hover:bg-white/10 hover:text-white`}>
            <FileText size={14} />
            Plantilla 1:1 (PDF)
          </button>
          {installation.hasGuide && (
            <button type="button" onClick={installation.onGuide} disabled={!installation.canDownload || installation.loading} className={`${btn} border-stampa-border bg-stampa-surface-soft text-stampa-text-muted hover:bg-white/10 hover:text-white`}>
              <FileText size={14} />
              Guía de conexión (PDF)
            </button>
          )}
          <button type="button" onClick={installation.onKit} disabled={!installation.canDownload || installation.loading} className={`${btn} border-transparent bg-stampa-orange text-neutral-950 hover:bg-stampa-orange-hover`}>
            {installation.loading ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
            Kit completo (.zip)
          </button>
        </>
      )}
    </div>
  );
}

interface ViewCardProps {
  displayMode: MakerDisplayMode;
  onDisplayModeChange: (mode: MakerDisplayMode) => void;
  /** Con una sola pieza física (frente abierto) explosionar no cambia nada: se oculta el selector. */
  multiPart: boolean;
  /** Separación 0-100: única fuente (0 = ensamblado). */
  explosionAmount: number;
  onExplosionAmountChange: (amount: number) => void;
  profile: PrinterProfile;
  plateCount: number;
  plateIndex: number;
  onPlateChange: (index: number) => void;
  /** Modo Editar recortes activo: el modo/vista quedan fijos (Modelo, separación efectiva 0) hasta terminar. */
  cutoutEditingActive?: boolean;
  onFinishCutoutEditing?: () => void;
}

const DISPLAY_OPTIONS: { value: MakerDisplayMode; label: string }[] = [
  { value: "model", label: "Modelo" },
  { value: "bed", label: "Cama" },
];

/** Tarjeta flotante BOTTOM-RIGHT: modo de visualización y controles de vista. */
export function ViewportViewCard(props: ViewCardProps) {
  const { displayMode, profile, plateCount, plateIndex } = props;
  if (props.cutoutEditingActive) {
    return (
      <div className={`${CARD} flex w-64 flex-col gap-2`}>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Visualización</span>
        <p className="text-xs text-gray-400">Editando recortes: Modelo · sin separación · vista trasera.</p>
        <button
          type="button"
          onClick={props.onFinishCutoutEditing}
          className="h-8 rounded-lg border border-transparent bg-stampa-orange px-3 text-xs font-semibold text-neutral-950 hover:bg-stampa-orange-hover"
        >
          Terminar edición
        </button>
      </div>
    );
  }
  return (
    <div className={`${CARD} flex w-64 flex-col gap-2.5`}>
      <div>
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Visualización</span>
        <SegmentedControl compact options={DISPLAY_OPTIONS} value={displayMode} onChange={props.onDisplayModeChange} />
      </div>

      {displayMode === "model" && props.multiPart && (
        <label className="block">
          <span className="mb-1 flex justify-between text-xs font-semibold text-gray-500">
            <span>Separación</span>
            <span className="text-gray-300">{props.explosionAmount}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={props.explosionAmount}
            onChange={(e) => props.onExplosionAmountChange(Number(e.target.value))}
            className="w-full accent-stampa-orange"
          />
        </label>
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

/** Banner del modo Editar recortes (arriba a la izquierda): instrucciones y aviso de posición inválida. */
export function CutoutEditingBanner({ invalidMessage, mounts = false }: { invalidMessage: string | null; mounts?: boolean }) {
  return (
    <div className={`${CARD} flex max-w-xs flex-col gap-1 text-xs`}>
      <span className="font-semibold text-white">{mounts ? "Editando puntos de montaje" : "Editando recortes traseros"}</span>
      <span className="text-gray-400">
        {mounts
          ? "Vista trasera. Seleccioná un punto de montaje y arrastralo; en rojo, las posiciones inválidas (fuera del material o superpuestas)."
          : "Vista trasera. Seleccioná un recorte y arrastralo. La X guardada se mide visto de frente."}
      </span>
      {invalidMessage && (
        <span className="flex items-start gap-1.5 text-red-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {invalidMessage}
        </span>
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
