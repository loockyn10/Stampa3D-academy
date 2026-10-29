"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import type { ThemePreference } from "@/lib/theme/theme";

const OPTIONS: { value: ThemePreference; label: string; description: string; icon: LucideIcon }[] = [
  { value: "light", label: "Claro", description: "Fondo claro, ideal para ambientes iluminados.", icon: Sun },
  { value: "dark", label: "Oscuro", description: "El aspecto clásico de Universo Stampa.", icon: Moon },
  { value: "system", label: "Automático", description: "Sigue la apariencia de tu dispositivo.", icon: Monitor },
];

/** Selector completo (tres opciones con descripcion) para la pantalla de Configuracion. */
export function ThemeSwitcher() {
  const { preference, setPreference } = useTheme();
  const groupId = useId();

  return (
    <div role="radiogroup" aria-labelledby={`${groupId}-label`} className="grid gap-3 sm:grid-cols-3">
      <span id={`${groupId}-label`} className="sr-only">Apariencia</span>
      {OPTIONS.map(({ value, label, description, icon: Icon }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setPreference(value)}
            className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/60 ${
              selected
                ? "border-stampa-orange bg-stampa-orange/10"
                : "border-stampa-border bg-stampa-surface-soft hover:border-fg/20"
            }`}
          >
            <Icon size={20} className={selected ? "mt-0.5 text-stampa-accent" : "mt-0.5 text-gray-400"} aria-hidden="true" />
            <span className="min-w-0">
              <span className={`block text-sm font-bold ${selected ? "text-stampa-accent" : "text-fg"}`}>{label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-gray-400">{description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Boton compacto para los headers: abre un menu con las tres opciones. */
export function ThemeMenu({ className = "" }: { className?: string }) {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const TriggerIcon = resolvedTheme === "light" ? Sun : Moon;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Cambiar apariencia"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-fg/5 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/60"
      >
        <TriggerIcon size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Apariencia"
          className="absolute right-0 top-full z-50 mt-2 w-48 rounded-xl border border-stampa-border bg-stampa-surface p-1 shadow-xl shadow-shade/30"
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = preference === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setPreference(value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-fg/5 ${
                  selected ? "font-bold text-stampa-accent" : "text-gray-300"
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
