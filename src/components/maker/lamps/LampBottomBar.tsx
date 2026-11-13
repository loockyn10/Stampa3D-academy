"use client";

import React from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Scissors } from "lucide-react";
import type { EditorComponent } from "@/lib/maker/lamps/editor";
import type { PartKind } from "@/lib/maker/types";

export interface BarComponent {
  kind: PartKind;
  component: EditorComponent;
  label: string;
  /** Marca un aviso sobre el componente (p. ej. la base de un diseño anterior con otras medidas mecánicas). */
  attention?: boolean;
}

export interface LampBottomBarProps {
  items: BarComponent[];
  selected: EditorComponent;
  onSelect: (component: EditorComponent) => void;
  hidden: readonly PartKind[];
  onToggleVisible: (kind: PartKind) => void;
  /** Vista actual del visor. */
  bed: boolean;
  onBedChange: (bed: boolean) => void;
  exploded: boolean;
  onToggleExploded: () => void;
  section: boolean;
  onToggleSection: () => void;
  /** Vista ensamblada: todas las piezas, juntas y sin corte. */
  assembled: boolean;
  onAssembled: () => void;
  /** Solo la pieza del componente seleccionado. */
  isolated: boolean;
  /** La pieza seleccionada existe en el diseño (un difusor desactivado no se puede aislar). */
  canIsolate?: boolean;
  onToggleIsolate: () => void;
  plateCount: number;
  plateIndex: number;
  onPlateChange: (index: number) => void;
}

const chip = (active: boolean) => `inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-colors sm:h-7 ${active ? "bg-stampa-orange/15 text-stampa-accent" : "text-gray-400 hover:text-fg"}`;

/**
 * BARRA INFERIOR — componentes y vistas. Elegir qué pieza se edita (Pantalla / Difusor / Base: el panel derecho muestra SUS propiedades), ocultarla o aislarla,
 * y cambiar entre vista ensamblada, piezas separadas, corte y cama de impresión. No tiene parámetros del diseño.
 */
export function LampBottomBar({ items, selected, onSelect, hidden, onToggleVisible, bed, onBedChange, exploded, onToggleExploded, section, onToggleSection, assembled, onAssembled, isolated, canIsolate = true, onToggleIsolate, plateCount, plateIndex, onPlateChange }: LampBottomBarProps) {
  return (
    <nav aria-label="Componentes y vistas" data-bottombar className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-stampa-border bg-stampa-surface px-2 py-1 lg:px-3 lg:py-1.5">
      <div role="group" aria-label="Componentes" className="flex flex-wrap items-center gap-1">
        {items.map((item) => {
          const active = selected === item.component;
          const visible = !hidden.includes(item.kind);
          return (
            <span key={item.kind} className={`inline-flex items-center rounded-lg border ${active ? "border-stampa-orange/50 bg-stampa-orange/10" : "border-fg/10"}`}>
              <button type="button" aria-pressed={active} data-component={item.component} onClick={() => onSelect(item.component)} className={`h-8 rounded-l-lg px-2.5 text-xs font-semibold transition-colors sm:h-7 ${active ? "text-fg" : "text-gray-300 hover:text-fg"}`}>
                {item.label}
                {item.attention && <span aria-label="Tiene un aviso" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />}
              </button>
              <button type="button" aria-pressed={visible} aria-label={visible ? `Ocultar ${item.label.toLowerCase()}` : `Mostrar ${item.label.toLowerCase()}`} title={visible ? `Ocultar ${item.label.toLowerCase()}` : `Mostrar ${item.label.toLowerCase()}`} onClick={() => onToggleVisible(item.kind)} className="inline-flex h-8 w-8 items-center justify-center rounded-r-lg text-gray-500 hover:text-fg sm:h-7">
                {visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
            </span>
          );
        })}
        <button type="button" aria-pressed={isolated} disabled={!canIsolate} onClick={onToggleIsolate} className={`${chip(isolated)} disabled:opacity-40`} title="Mostrar solo la pieza seleccionada">
          Aislar
        </button>
      </div>
      <div role="group" aria-label="Vistas" className="flex flex-wrap items-center gap-1">
        <button type="button" aria-pressed={!bed && assembled} onClick={() => { onBedChange(false); onAssembled(); }} className={chip(!bed && assembled)}>
          Ensamblada
        </button>
        <button type="button" aria-pressed={!bed && exploded} onClick={() => { onBedChange(false); onToggleExploded(); }} className={chip(!bed && exploded)}>
          Piezas
        </button>
        <button type="button" aria-pressed={!bed && section} onClick={() => { onBedChange(false); onToggleSection(); }} className={chip(!bed && section)} title="Corte longitudinal por el eje">
          <Scissors size={12} aria-hidden="true" />
          Corte
        </button>
        <button type="button" aria-pressed={bed} onClick={() => onBedChange(!bed)} className={chip(bed)} title="Cama de impresión con las piezas orientadas">
          Cama
        </button>
        {bed && plateCount > 1 && (
          <span className="inline-flex items-center gap-0.5">
            <button type="button" aria-label="Placa anterior" disabled={plateIndex <= 1} onClick={() => onPlateChange(plateIndex - 1)} className="rounded-lg p-1 text-gray-400 hover:bg-fg/10 hover:text-fg disabled:opacity-40">
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-10 text-center text-xs font-semibold text-fg">
              {plateIndex} / {plateCount}
            </span>
            <button type="button" aria-label="Placa siguiente" disabled={plateIndex >= plateCount} onClick={() => onPlateChange(plateIndex + 1)} className="rounded-lg p-1 text-gray-400 hover:bg-fg/10 hover:text-fg disabled:opacity-40">
              <ChevronRight size={15} />
            </button>
          </span>
        )}
      </div>
    </nav>
  );
}
