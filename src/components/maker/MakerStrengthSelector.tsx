"use client";

import { useRef, type KeyboardEvent } from "react";
import { Card } from "@/components/ui/card";
import {
  MATERIAL_OPTIONS,
  NOMINAL_LINE_WIDTH_MM,
  PERIMETER_HINT,
  WALL_STRENGTH_OPTIONS,
  approxExtrusionLines,
  detectWallStrength,
  materialLabel,
  strengthLabel,
  wallMmFor,
  type MakerMaterial,
  type WallStrength,
} from "@/lib/maker/wallStrength";

interface MakerStrengthSelectorProps {
  /** Material elegido (selección explícita: no se deduce del espesor). */
  material: MakerMaterial;
  /** Espesor de pared actual (única fuente geométrica: `params.wallMm`). La resistencia marcada se deduce de (material, espesor). */
  wallMm: number;
  onMaterialChange: (material: MakerMaterial) => void;
  onStrengthChange: (strength: WallStrength) => void;
}

const formatMm = (mm: number) => (Math.round(mm * 100) / 100).toString().replace(".", ",");

interface SegmentOption<T extends string> {
  id: T;
  label: string;
  detail?: string;
}

/** Grupo de opciones excluyentes (radiogroup): flechas para moverse, Tab entra al grupo una sola vez. Con `value` nulo (p. ej. "Personalizado") ninguna está marcada y la primera recibe el foco. */
function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T | null;
  onChange: (id: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusable = value ?? options[0].id;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].id);
  };

  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option, index) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={option.id === focusable ? 0 : -1}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex min-h-11 flex-col items-center justify-center rounded-xl border-2 px-2 py-1.5 text-center transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/60 ${
              active ? "border-stampa-orange bg-stampa-orange/10 text-fg shadow-md shadow-stampa-orange/20" : "border-fg/10 text-gray-300 hover:border-fg/30"
            }`}
          >
            <span className="text-sm font-semibold leading-tight">{option.label}</span>
            {option.detail && <span className="text-[11px] leading-tight text-gray-400">{option.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Material (PLA / PETG) y resistencia (Ligero / Normal / Reforzado) del cartel
 * (creación rápida, paso 3). Son atajos para el espesor de pared (`wallMm`): el
 * material es una selección explícita (`params.material`) y la resistencia se
 * deduce de (material, wallMm), así nunca se contradice con el campo "Pared" de
 * Personalización avanzada. Un espesor ajustado a mano que no coincide con un
 * perfil se muestra como "Personalizado" y no se fuerza de nuevo.
 */
export function MakerStrengthSelector({ material, wallMm, onMaterialChange, onStrengthChange }: MakerStrengthSelectorProps) {
  const selected = detectWallStrength(material, wallMm);
  const lines = approxExtrusionLines(wallMm);
  const strengthOptions = WALL_STRENGTH_OPTIONS.map((option) => ({ id: option.id, label: option.label, detail: `${formatMm(wallMmFor(material, option.id))} mm` }));

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-bold text-fg">
        <span className="mr-1.5 text-stampa-accent">3</span>Elegí material y resistencia
      </h2>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-400">Material</span>
        <SegmentedChoice label="Material de impresión" options={MATERIAL_OPTIONS} value={material} onChange={onMaterialChange} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          Resistencia
          {!selected && (
            <span className="rounded-full border border-stampa-orange/40 bg-stampa-orange/15 px-2 py-0.5 text-[11px] font-semibold text-stampa-accent">Personalizado</span>
          )}
        </span>
        <SegmentedChoice label="Resistencia del cartel" options={strengthOptions} value={selected} onChange={onStrengthChange} />
      </div>

      <div className="flex min-h-[3.25rem] flex-col gap-0.5 rounded-xl border border-fg/10 bg-fg/[0.03] px-3 py-2" aria-live="polite">
        <p className="text-sm font-bold text-fg">
          {materialLabel(material)} · {strengthLabel(selected)}
        </p>
        <p className="text-xs text-gray-300">Espesor de pared: {formatMm(wallMm)} mm.</p>
        <p className="text-[11px] leading-snug text-gray-500">
          Aproximadamente {lines} {lines === 1 ? "línea" : "líneas"} de extrusión de {formatMm(NOMINAL_LINE_WIDTH_MM)} mm, sujeto a la configuración del laminador.
        </p>
      </div>

      <details className="group text-[11px] leading-snug text-gray-500">
        <summary className="w-fit cursor-pointer select-none font-semibold text-gray-400 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/60">Más información</summary>
        <p className="mt-1.5">
          {PERIMETER_HINT} El material es un perfil de fabricación: no cambia las propiedades del modelo. Los espesores son valores iniciales para boquilla de 0,4 mm; validá siempre en tu laminador. Los trazos más finos que el doble de la pared quedan macizos.
        </p>
      </details>
    </Card>
  );
}
