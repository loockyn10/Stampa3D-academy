"use client";

import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PERIMETER_HINT, WALL_STRENGTH_OPTIONS, detectWallStrength, type WallStrength } from "@/lib/maker/wallStrength";

interface MakerStrengthSelectorProps {
  /** Espesor de pared actual (única fuente: `params.wallMm`). La opción marcada se deduce de él. */
  wallMm: number;
  onSelect: (strength: WallStrength) => void;
}

const formatMm = (mm: number) => (Math.round(mm * 100) / 100).toString().replace(".", ",");

/**
 * Resistencia del cartel (creación rápida, paso 3): Normal o Reforzado. Es un
 * atajo para el espesor de pared (wallMm): no guarda estado propio, así nunca
 * se contradice con el campo "Pared" de Personalización avanzada. Cambiarla no
 * toca el texto ni el estilo elegido.
 */
export function MakerStrengthSelector({ wallMm, onSelect }: MakerStrengthSelectorProps) {
  const selected = detectWallStrength(wallMm);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-bold text-fg">
          <span className="mr-1.5 text-stampa-accent">3</span>Elegí la resistencia
        </h2>
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-live="polite">
          <span className="text-gray-500">Pared de {formatMm(wallMm)} mm</span>
          {!selected && (
            <span className="rounded-full border border-stampa-orange/40 bg-stampa-orange/15 px-2 py-0.5 text-[11px] font-semibold text-stampa-accent">Personalizado</span>
          )}
        </div>
      </div>

      <div role="radiogroup" aria-label="Resistencia del cartel" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
        {WALL_STRENGTH_OPTIONS.map((option) => {
          const active = option.id === selected;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(option.id)}
              className={`relative flex flex-col gap-0.5 rounded-xl border-2 p-3 text-left transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/60 ${
                active ? "border-stampa-orange bg-stampa-orange/10 shadow-md shadow-stampa-orange/20" : "border-fg/10 hover:border-fg/30"
              }`}
            >
              <span className="flex items-baseline justify-between gap-2 pr-6">
                <span className="text-sm font-semibold text-fg">{option.label}</span>
                <span className="text-xs font-semibold text-gray-400">{formatMm(option.wallMm)} mm</span>
              </span>
              <span className="text-xs text-gray-400">{option.summary}</span>
              <span className="text-[11px] text-gray-500">{option.usage}</span>
              {active && (
                <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-stampa-orange text-black shadow">
                  <Check size={13} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] leading-snug text-gray-500">
        Es el espesor físico de la pared, no la cantidad de perímetros. {PERIMETER_HINT} Los trazos más finos que el doble de la pared quedan macizos.
      </p>
    </Card>
  );
}
