"use client";

import Image from "next/image";
import { Check, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { styleThumbnailPath, type StylePreset } from "@/lib/maker/presets/stylePresets";

interface MakerStyleGalleryProps {
  styles: readonly StylePreset[];
  /** Estilo elegido (null = la configuración actual no corresponde a ningún estilo). */
  selectedId: string | null;
  /** La configuración dejó de coincidir con el estilo elegido (se editó a mano en Personalización avanzada). */
  custom: boolean;
  onSelect: (id: string) => void;
  /** Vuelve a aplicar el estilo elegido (conserva texto, fuente y alto). */
  onReset: () => void;
}

/**
 * Galería de estilos (creación rápida, paso 2). Las miniaturas son recursos
 * estáticos generados con el motor real (scripts/generate-maker-style-
 * thumbnails.mjs), siempre sobre fondo oscuro como el visor — el resto de la
 * tarjeta sigue el tema claro/oscuro/automático.
 */
export function MakerStyleGallery({ styles, selectedId, custom, onSelect, onReset }: MakerStyleGalleryProps) {
  const selected = styles.find((s) => s.id === selectedId) ?? null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-bold text-fg">
          <span className="mr-1.5 text-stampa-accent">2</span>Elegí un estilo
        </h2>
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-live="polite">
          <span className="text-gray-500">{selected ? selected.name : "Configuración propia"}</span>
          {(custom || !selected) && (
            <span className="rounded-full border border-stampa-orange/40 bg-stampa-orange/15 px-2 py-0.5 text-[11px] font-semibold text-stampa-accent">Personalizado</span>
          )}
          {selected && custom && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-gray-400 transition-colors hover:bg-fg/10 hover:text-fg"
            >
              <RotateCcw size={12} />
              Restablecer estilo
            </button>
          )}
        </div>
      </div>

      <div role="radiogroup" aria-label="Estilo del cartel" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2">
        {styles.map((style) => {
          const active = style.id === selectedId;
          return (
            <button
              key={style.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${style.name}: ${style.description}`}
              title={style.description}
              onClick={() => onSelect(style.id)}
              className={`group relative overflow-hidden rounded-xl border-2 text-left transition-all duration-200 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/60 ${
                active
                  ? "border-stampa-orange shadow-md shadow-stampa-orange/20"
                  : "border-fg/10 hover:border-fg/30"
              }`}
            >
              <div className="theme-force-dark relative aspect-[4/3] bg-[radial-gradient(ellipse_at_center,#23262c_0%,#15171b_80%)]">
                <Image
                  src={styleThumbnailPath(style)}
                  alt=""
                  width={400}
                  height={300}
                  unoptimized
                  loading="eager"
                  draggable={false}
                  className="h-full w-full select-none object-contain transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
                  <span className="text-xs font-semibold text-white">{style.name}</span>
                </div>
                {active && (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-stampa-orange text-black shadow">
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] leading-snug text-gray-500">
        Los colores de las miniaturas son solo de vista previa: cada pieza (cuerpo, tapa, máscara…) se exporta como un STL separado, sin información de color.
      </p>
    </Card>
  );
}
