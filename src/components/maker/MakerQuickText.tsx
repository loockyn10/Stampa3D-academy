"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";

interface MakerQuickTextProps {
  value: string;
  onChange: (text: string) => void;
  error?: string;
  /** El diseño viene de un archivo SVG/PNG: el texto no aplica hasta volver al modo texto. */
  fromFile: boolean;
  onUseText: () => void;
  /** Se está regenerando el modelo. */
  updating: boolean;
  /** Medidas del modelo generado, en mm (null si todavía no hay modelo). */
  size: { width: number; height: number; depth: number } | null;
  /** Ancho útil de la cama del perfil de impresora, para avisar cuando la palabra completa no entra. */
  bedWidthMm: number;
  bedName: string;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Creación rápida, paso 1: el texto del cartel. Único input de texto de la pantalla; el resto de parámetros vive en Personalización avanzada. */
export function MakerQuickText({ value, onChange, error, fromFile, onUseText, updating, size, bedWidthMm, bedName }: MakerQuickTextProps) {
  const tooWide = !!size && !fromFile && size.width > bedWidthMm;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <label htmlFor="maker-quick-text" className="text-sm font-bold text-fg">
        <span className="mr-1.5 text-stampa-accent">1</span>¿Qué querés que diga tu cartel?
      </label>

      {fromFile ? (
        <div className="flex flex-col gap-2 rounded-xl border border-fg/10 bg-fg/[0.04] p-3 text-xs text-gray-400">
          <span>Estás usando un archivo SVG/PNG como diseño, no un texto.</span>
          <GhostButton type="button" onClick={onUseText} className="w-fit">
            Escribir un texto
          </GhostButton>
        </div>
      ) : (
        <>
          <input
            id="maker-quick-text"
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Escribí tu texto"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={!!error}
            className={`h-12 w-full rounded-xl border bg-white/[0.06] px-4 text-base font-semibold text-white placeholder:font-normal placeholder:text-neutral-500 outline-none transition focus:border-stampa-orange/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-stampa-orange/10 ${
              error ? "border-red-500/50" : "border-fg/10"
            }`}
          />
          {error && <span className="-mt-1 text-xs text-red-400">{error}</span>}
          <div className="flex min-h-4 items-center justify-between gap-2 text-[11px] text-gray-500" aria-live="polite">
            <span>{size && size.width > 0 ? `Medidas: ${round(size.width)} × ${round(size.height)} × ${round(size.depth)} mm` : " "}</span>
            {updating && (
              <span className="inline-flex items-center gap-1 text-stampa-accent">
                <Loader2 size={11} className="animate-spin" />
                Actualizando…
              </span>
            )}
          </div>
          {tooWide && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                Mide {round(size.width)} mm de ancho y no entra en la cama de la {bedName} ({bedWidthMm} mm). Descargá letras individuales o reducí el alto en Personalización avanzada; el tamaño no se cambia solo.
              </span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
