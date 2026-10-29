"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Lock } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
  /** No se puede elegir (la fuente no lo admite o no está disponible); `note` explica por qué. */
  disabled?: boolean;
  /** Requiere cuenta: se puede pulsar, pero el padre responde con la invitación a crear una cuenta. */
  locked?: boolean;
  note?: string;
}

export interface FilterGroup {
  id: string;
  label: string;
  value: string;
  /** Valor sin filtrar ("Todos", "Todas", "Relevancia"): el grupo se marca activo cuando se aparta de él. */
  neutral: string;
  options: FilterOption[];
  /** Aclaración contextual; se muestra dentro del desplegable en vez de ocupar espacio permanente. */
  hint?: string | null;
  onSelect: (value: string) => void;
}

export const isGroupActive = (group: FilterGroup) => group.value !== group.neutral;

function DropdownOption({
  option,
  selected,
  onPick,
  optionRef,
}: {
  option: FilterOption;
  selected: boolean;
  onPick: () => void;
  optionRef: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={optionRef}
      type="button"
      role="option"
      aria-selected={selected}
      disabled={option.disabled}
      onClick={onPick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        selected ? "bg-stampa-orange/10 font-semibold text-stampa-accent" : "text-gray-300 hover:bg-fg/10 hover:text-fg focus-visible:bg-fg/10 focus-visible:text-fg"
      } outline-none`}
    >
      <span className="flex-1 truncate">{option.label}</span>
      {option.note && <span className="shrink-0 text-[11px] font-medium text-gray-500">· {option.note}</span>}
      {option.locked && <Lock size={12} className="shrink-0 text-gray-500" aria-hidden="true" />}
      {selected && <Check size={14} className="shrink-0" aria-hidden="true" />}
    </button>
  );
}

function FilterDropdown({ group }: { group: FilterGroup }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  const selected = group.options.find((option) => option.value === group.value) ?? group.options[0];
  const active = isGroupActive(group);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = group.options.findIndex((option) => option.value === group.value && !option.disabled);
    const first = group.options.findIndex((option) => !option.disabled);
    optionRefs.current[index >= 0 ? index : first]?.focus();
    // Solo al abrir: elegir una opción cierra el desplegable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const moveFocus = (step: number | "first" | "last") => {
    const enabled = optionRefs.current.filter((node): node is HTMLButtonElement => node !== null && !node.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex((node) => node === document.activeElement);
    const next = step === "first" ? 0 : step === "last" ? enabled.length - 1 : (current + step + enabled.length) % enabled.length;
    enabled[next].focus();
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus("first");
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus("last");
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
          active
            ? "border-stampa-orange bg-stampa-orange/10 text-stampa-accent"
            : "border-stampa-border bg-stampa-surface text-gray-300 hover:bg-fg/10 hover:text-fg"
        }`}
      >
        <span className={active ? "" : "text-gray-500"}>{group.label}:</span>
        <span className="font-semibold">{selected?.label}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={group.label}
          onKeyDown={onListKeyDown}
          className="absolute left-0 top-full z-30 mt-1.5 w-max min-w-[13rem] max-w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-stampa-border bg-stampa-surface p-1 shadow-xl shadow-shade/20"
        >
          {group.options.map((option, index) => (
            <DropdownOption
              key={option.value}
              option={option}
              selected={option.value === group.value}
              optionRef={(node) => {
                optionRefs.current[index] = node;
              }}
              onPick={() => {
                group.onSelect(option.value);
                close(true);
              }}
            />
          ))}
          {group.hint && <p className="mt-1 border-t border-stampa-border px-3 pb-1.5 pt-2 text-xs leading-snug text-gray-400">{group.hint}</p>}
        </div>
      )}
    </div>
  );
}

/** Escritorio: una sola fila de desplegables (se parte en dos líneas solo si falta ancho). */
export function FilterDropdowns({ groups, activeCount, onReset }: { groups: FilterGroup[]; activeCount: number; onReset: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros">
      {groups.map((group) => (
        <FilterDropdown key={group.id} group={group} />
      ))}
      {activeCount > 0 && (
        <button type="button" onClick={onReset} className="px-1.5 py-1 text-xs font-semibold text-stampa-accent underline-offset-2 hover:underline">
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

/** Móvil: dentro del panel "Filtros" las mismas opciones se muestran como chips (el panel está cerrado por defecto). */
export function FilterChipGroups({ groups, activeCount, onReset }: { groups: FilterGroup[]; activeCount: number; onReset: () => void }) {
  return (
    <div className="space-y-2.5">
      {groups.map((group) => (
        <div key={group.id} role="group" aria-label={group.label}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{group.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {group.options.map((option) => {
              const selected = option.value === group.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  aria-pressed={selected}
                  onClick={() => group.onSelect(option.value)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    selected
                      ? "border-stampa-orange bg-stampa-orange/10 text-stampa-accent"
                      : "border-stampa-border bg-stampa-surface text-gray-300 hover:bg-fg/10 hover:text-fg"
                  }`}
                >
                  {option.locked && <Lock size={11} aria-hidden="true" />}
                  {option.label}
                  {option.note && <span className="text-[11px] font-medium text-gray-500">· {option.note}</span>}
                </button>
              );
            })}
          </div>
          {group.hint && <p className="mt-1 text-xs text-gray-500">{group.hint}</p>}
        </div>
      ))}
      {activeCount > 0 && (
        <button type="button" onClick={onReset} className="text-xs font-semibold text-stampa-accent underline-offset-2 hover:underline">
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
