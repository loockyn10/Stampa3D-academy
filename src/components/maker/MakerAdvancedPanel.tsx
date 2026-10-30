"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Card } from "@/components/ui/card";

interface MakerAdvancedPanelProps {
  /** La configuración se apartó del estilo elegido. */
  custom: boolean;
  children: ReactNode;
}

/**
 * "Personalización avanzada": panel plegable (cerrado por defecto) que
 * contiene TODOS los controles que ya existían (biblioteca de presets y
 * proyectos, origen del diseño, medidas, cuerpo, frente, recortes,
 * instalación). Los hijos quedan montados aunque el panel esté plegado, así
 * conservan su estado interno (campos numéricos, etc.).
 */
export function MakerAdvancedPanel({ custom, children }: MakerAdvancedPanelProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex min-h-12 w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-fg/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/60"
      >
        <SlidersHorizontal size={16} className="shrink-0 text-gray-400" />
        <span className="flex-1 text-sm font-bold text-fg">Personalización avanzada</span>
        {custom && <span className="rounded-full border border-stampa-orange/40 bg-stampa-orange/15 px-2 py-0.5 text-[11px] font-semibold text-stampa-accent">Personalizado</span>}
        <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={contentId} hidden={!open} className="flex flex-col gap-4 border-t border-stampa-border p-3">
        <p className="px-1 text-xs text-gray-500">
          Todos los parámetros del generador. Si cambiás alguno, el estilo elegido queda como “Personalizado”; no se restaura solo.
        </p>
        {children}
      </div>
    </Card>
  );
}
