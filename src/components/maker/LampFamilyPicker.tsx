"use client";

import React from "react";
import { LAMP_FAMILIES, LAMP_FAMILY_ORDER } from "@/lib/maker/lamps/capabilities";
import type { LampShadeType } from "@/lib/maker/lamps/types";

/** Paso 1: elegir el tipo de lámpara con tarjetas visuales. Las etiquetas y la descripción salen de `capabilities.ts` (una sola definición por familia). */
const ICONS: Record<LampShadeType, React.ReactNode> = {
  solid: <path d="M24 8 C19 20 29 28 22 40 C17 50 27 58 24 68 L56 68 C53 58 63 50 58 40 C51 28 61 20 56 8 Z" />,
  openwork: (
    <>
      <path d="M24 8 L56 8 L62 68 L18 68 Z" />
      <path d="M28 8 L40 38 L52 8 M40 38 L22 68 M40 38 L58 68 M32 28 L48 28 M26 48 L54 48" />
    </>
  ),
  double: (
    <>
      <path d="M22 8 C14 26 14 50 22 68 L58 68 C66 50 66 26 58 8 Z" />
      <path d="M34 12 C38 28 38 50 34 64 L46 64 C42 50 42 28 46 12 Z" />
    </>
  ),
};

export function LampFamilyPicker({ value, onSelect }: { value: LampShadeType; onSelect: (type: LampShadeType) => void }) {
  return (
    <div role="radiogroup" aria-label="Tipo de lámpara" className="grid grid-cols-3 gap-2">
      {LAMP_FAMILY_ORDER.map((type) => {
        const caps = LAMP_FAMILIES[type];
        const selected = value === type;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={selected}
            data-family={type}
            title={caps.tagline}
            onClick={() => onSelect(type)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border px-1.5 pb-2 pt-2.5 transition-colors ${selected ? "border-stampa-orange bg-stampa-orange/10" : "border-fg/10 bg-fg/[0.03] hover:border-stampa-orange/40"}`}
          >
            <svg viewBox="0 0 80 76" height={52} aria-hidden="true" className={`max-w-full fill-none stroke-current ${selected ? "text-stampa-accent" : "text-gray-500"}`} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round">
              {ICONS[type]}
            </svg>
            <span className={`text-center text-xs font-semibold leading-tight ${selected ? "text-fg" : "text-gray-300"}`}>{caps.label}</span>
          </button>
        );
      })}
    </div>
  );
}
