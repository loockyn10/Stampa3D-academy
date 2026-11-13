"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, Copy, Download, FilePlus2, FolderOpen, RotateCcw, Save, Trash2 } from "lucide-react";
import { LampExportList, type LampExportListProps } from "@/components/maker/lamps/LampExportList";
import { primaryButton, softButton } from "@/components/maker/lamps/controls";
import type { SavedLampDesign } from "@/lib/maker/lamps/savedDesigns";

/** Menú desplegable simple (se cierra al elegir algo, al tocar fuera o con Escape). */
function Popover({ label, icon, children, className = softButton, align = "right", ariaLabel }: { label: string; icon: React.ReactNode; children: (close: () => void) => React.ReactNode; className?: string; align?: "left" | "right"; ariaLabel?: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} aria-label={ariaLabel ?? label} onClick={() => setOpen((v) => !v)} className={className}>
        {icon}
        <span className="max-sm:hidden">{label}</span>
        <ChevronDown size={12} aria-hidden="true" className="max-sm:hidden" />
      </button>
      {open && (
        <div role="menu" className={`absolute top-full z-50 mt-1.5 w-[min(88vw,320px)] rounded-2xl border border-fg/10 bg-stampa-surface p-3 shadow-xl shadow-shade/40 ${align === "right" ? "right-0" : "left-0"}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export interface LampTopBarProps {
  name: string;
  onNameChange: (name: string) => void;
  onNew: () => void;
  onSave: () => void;
  /** El diseño cambió desde que se abrió o guardó. */
  dirty: boolean;
  /** Hay algo que restablecer (el diseño difiere del que se abrió o creó). */
  canReset: boolean;
  onReset: () => void;
  saved: SavedLampDesign[];
  onOpenSaved: (item: SavedLampDesign) => void;
  onDeleteSaved: (item: SavedLampDesign) => void;
  designCode: string;
  onCopyCode: () => void;
  /** Abrir un código pegado: devuelve un mensaje de error (o null si se abrió o el usuario lo canceló). */
  onLoadCode: (code: string) => Promise<string | null>;
  copied: boolean;
  /** Frase corta de lo que impide exportar (null si se puede). */
  exportBlocker: string | null;
  exportProps: LampExportListProps;
}

/** BARRA SUPERIOR — acciones globales: nombre del diseño, nuevo, guardar, mis diseños, restablecer y exportar. Ningún ajuste geométrico vive acá. */
export function LampTopBar({ name, onNameChange, onNew, onSave, dirty, canReset, onReset, saved, onOpenSaved, onDeleteSaved, designCode, onCopyCode, onLoadCode, copied, exportBlocker, exportProps }: LampTopBarProps) {
  const [pasted, setPasted] = React.useState("");
  const [codeError, setCodeError] = React.useState<string | null>(null);
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-stampa-border px-1 pb-2 lg:min-h-12 lg:px-4 lg:py-2" data-topbar>
      <Link href="/stampa-maker" aria-label="Volver a Stampa Maker" className="inline-flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:text-fg sm:h-8">
        <ArrowLeft size={16} />
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:max-w-md">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Nombre del diseño</span>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            maxLength={60}
            placeholder="Nombre del diseño"
            className="h-10 w-full min-w-0 rounded-lg border border-transparent bg-fg/[0.04] px-2.5 text-sm font-bold text-fg placeholder:text-neutral-500 hover:border-fg/10 focus:border-stampa-orange/50 focus:outline-none sm:h-8"
          />
        </label>
        <span className="hidden shrink-0 rounded-full bg-stampa-orange/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stampa-accent sm:inline">Beta</span>
        {dirty && <span className="shrink-0 text-[11px] font-semibold text-gray-500" title="Hay cambios sin guardar">●<span className="sr-only">Cambios sin guardar</span></span>}
      </div>

      <div className="flex items-center gap-1.5 max-lg:ml-auto">
        <button type="button" onClick={onNew} aria-label="Nuevo diseño" className={softButton}>
          <FilePlus2 size={14} aria-hidden="true" />
          <span className="max-sm:hidden">Nuevo</span>
        </button>
        <button type="button" onClick={onSave} aria-label="Guardar" className={softButton}>
          <Save size={14} aria-hidden="true" />
          <span className="max-sm:hidden">Guardar</span>
        </button>
        <Popover label="Mis diseños" icon={<FolderOpen size={14} aria-hidden="true" />}>
          {(close) => (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Guardados en este navegador</span>
                {saved.length === 0 ? (
                  <p className="text-xs text-gray-500">Todavía no guardaste ninguno.</p>
                ) : (
                  <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                    {saved.map((item) => (
                      <li key={item.id} className="flex items-center gap-1">
                        <button type="button" onClick={() => { onOpenSaved(item); close(); }} className="min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-xs font-semibold text-gray-200 hover:bg-fg/[0.06]" title={`Abrir ${item.name}`}>
                          {item.name}
                        </button>
                        <button type="button" onClick={() => onDeleteSaved(item)} aria-label={`Borrar ${item.name}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:text-red-300">
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-col gap-1.5 border-t border-fg/10 pt-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Código del diseño</span>
                <p className="text-[11px] text-gray-500">Todo el diseño en un texto: copialo para compartirlo o pegá uno para abrirlo.</p>
                <div className="flex items-center gap-2">
                  <input readOnly value={designCode} aria-label="Código del diseño" onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-lg border border-fg/10 bg-fg/[0.04] px-2 font-mono text-[11px] text-gray-300" />
                  <button type="button" onClick={onCopyCode} aria-label="Copiar código" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-fg/10 text-gray-300 hover:text-fg">
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input value={pasted} onChange={(e) => { setPasted(e.target.value); setCodeError(null); }} placeholder="Pegá un código SL1:…" aria-label="Pegar un código de diseño" className="h-9 min-w-0 flex-1 rounded-lg border border-fg/10 bg-fg/[0.04] px-2 text-xs text-white placeholder:text-neutral-500" />
                  <button
                    type="button"
                    disabled={!pasted.trim()}
                    onClick={async () => {
                      const error = await onLoadCode(pasted);
                      if (error) setCodeError(error);
                      else {
                        setPasted("");
                        close();
                      }
                    }}
                    className="h-9 shrink-0 rounded-lg border border-fg/10 px-3 text-xs font-semibold text-gray-200 hover:text-fg disabled:opacity-40"
                  >
                    Abrir
                  </button>
                </div>
                {codeError && <span role="alert" className="text-xs text-red-400">{codeError}</span>}
              </div>
            </div>
          )}
        </Popover>
        {canReset && (
          <button type="button" onClick={onReset} aria-label="Restablecer" title="Volver al diseño con el que empezaste" className={softButton}>
            <RotateCcw size={14} aria-hidden="true" />
            <span className="max-xl:hidden">Restablecer</span>
          </button>
        )}
        <Popover label="Exportar" icon={<Download size={14} aria-hidden="true" />} className={primaryButton}>
          {() => (
            <div className="flex flex-col gap-2">
              {exportBlocker && <p role="alert" className="text-xs text-red-300">{exportBlocker} Resolvelo para descargar.</p>}
              <LampExportList {...exportProps} />
              <p className="text-[11px] text-gray-500">Las piezas se descargan en su orientación de impresión. Pendiente de validación física y térmica antes de usarlas con una bombilla conectada.</p>
            </div>
          )}
        </Popover>
      </div>
    </header>
  );
}
