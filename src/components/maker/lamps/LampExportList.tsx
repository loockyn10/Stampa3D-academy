"use client";

import React from "react";
import { Download, Loader2 } from "lucide-react";
import type { LampInsertStyle } from "@/lib/maker/lamps/types";
import { INSERT_STYLE_LABELS } from "@/lib/maker/lamps/defaults";

export type LampDownloadKind = "lampShade" | "lampInsert" | "lampInsertDrop" | "lampCollar" | "body";

export interface LampExportListProps {
  hasInsert: boolean;
  insertStyle: LampInsertStyle;
  /** Pieza del difusor de perfil (según su orientación de impresión); sin esto: la gota va parada y el resto invertido. */
  insertPrintKind?: "lampInsert" | "lampInsertDrop";
  /** Nombre de la forma del difusor (p. ej. «cilíndrico»); sin esto se usa el del estilo del inserto. */
  insertLabel?: string;
  hasCollar: boolean;
  canDownload: boolean;
  canDownloadTests: boolean;
  busy: string | null;
  onDownloadPart: (kind: LampDownloadKind) => void;
  onDownloadZip: () => void;
  onDownloadTests: () => void;
  holderMeasured: boolean;
}

/** Descargas del diseño: todo en un ZIP, pieza por pieza y piezas de prueba. Las usan el menú «Exportar» de la barra superior y el panel móvil. */
export function LampExportList({ hasInsert, insertStyle, insertPrintKind, insertLabel, hasCollar, canDownload, canDownloadTests, busy, onDownloadPart, onDownloadZip, onDownloadTests, holderMeasured }: LampExportListProps) {
  const button = "inline-flex h-10 sm:h-8 w-full items-center justify-start gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const icon = (id: string) => (busy === id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />);
  const insertKind = insertPrintKind ?? (insertStyle === "drop" ? "lampInsertDrop" : "lampInsert");
  return (
    <div className="flex flex-col gap-1.5" data-export-list>
      <button type="button" disabled={!canDownload || busy !== null} onClick={onDownloadZip} className={`${button} border-transparent bg-stampa-orange text-neutral-950 hover:bg-stampa-orange-hover`}>
        {icon("zip")} Todo en un ZIP
      </button>
      <button type="button" disabled={!canDownload || busy !== null} onClick={() => onDownloadPart("lampShade")} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`}>
        {icon("lampShade")} Pantalla (STL)
      </button>
      {hasCollar && (
        <button type="button" disabled={!canDownload || busy !== null} onClick={() => onDownloadPart("lampCollar")} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`}>
          {icon("lampCollar")} Collar roscado (STL)
        </button>
      )}
      {hasInsert && (
        <button type="button" disabled={!canDownload || busy !== null} onClick={() => onDownloadPart(insertKind)} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`}>
          {icon(insertKind)} {insertLabel ? `Difusor ${insertLabel}` : `Inserto ${INSERT_STYLE_LABELS[insertStyle].toLowerCase()}`} (STL)
        </button>
      )}
      <button type="button" disabled={!canDownload || busy !== null} onClick={() => onDownloadPart("body")} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`}>
        {icon("body")} {holderMeasured ? "Base (STL)" : "Base preliminar (STL)"}
      </button>
      <button type="button" disabled={!canDownloadTests || busy !== null} onClick={onDownloadTests} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`} title="Rosca macho y hembra + disco de ajuste del portalámparas: para validar el encastre sin imprimir la lámpara entera">
        {icon("tests")} Piezas de prueba (ZIP)
      </button>
    </div>
  );
}
