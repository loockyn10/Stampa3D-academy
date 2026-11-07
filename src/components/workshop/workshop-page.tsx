"use client";

import React from "react";
import { Search, X } from "lucide-react";

/**
 * Piezas compartidas de las pantallas de Mi Taller (Inventario, Productos, Filamentos, Impresoras).
 * Fijan el lenguaje común: encabezado, zona de búsqueda y filtros, y avisos. Cada pantalla conserva su contenido.
 */

export function WorkshopPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  /** Acción principal + secundarias; en el celular se apilan a ancho completo. */
  actions?: React.ReactNode;
}) {
  // El diseño responde al ancho del contenedor (no del viewport): con el sidebar abierto o contraído el encabezado
  // se acomoda solo. Angosto: texto y acciones apilados (acciones a ancho completo); amplio: fila con acciones a la derecha.
  return (
    <header className="@container mb-5">
      <div className="flex flex-col gap-4 @3xl:flex-row @3xl:items-end @3xl:justify-between">
        <div className="min-w-0 @3xl:max-w-xl">
          <p className="mb-1 truncate text-xs font-semibold uppercase tracking-wide text-stampa-accent">Mi taller</p>
          <h2 className="truncate text-lg font-bold text-fg">{title}</h2>
          {description && <p className="mt-1 text-sm leading-6 text-gray-400">{description}</p>}
        </div>
        {actions && (
          <div className="flex flex-col gap-2 @md:flex-row @md:flex-wrap @3xl:shrink-0 @3xl:flex-nowrap @3xl:justify-end">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

/** Zona de búsqueda + filtros: el buscador ocupa el ancho disponible y los filtros se acomodan al lado (o debajo). */
export function WorkshopToolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">{children}</div>;
}

export function WorkshopSearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Nombre accesible; por defecto el placeholder. */
  label?: string;
}) {
  return (
    <div className="relative w-full lg:flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoComplete="off"
        className="h-11 w-full rounded-xl border border-fg/10 bg-fg/[0.06] pl-10 pr-11 text-sm text-fg outline-none transition-all placeholder:text-gray-500 focus:border-orange-500/60 focus:ring-2 focus:ring-orange-500/10"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-fg/5 hover:text-fg"
          aria-label="Limpiar búsqueda"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

type NoticeTone = "info" | "warning" | "success" | "error";

const NOTICE_TONES: Record<NoticeTone, string> = {
  info: "border-stampa-border bg-fg/5 text-gray-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  error: "border-red-500/25 bg-red-500/10 text-red-300",
};

/** Aviso de pantalla (errores, confirmaciones, stock bajo). Los errores se anuncian a lectores de pantalla. */
export function WorkshopNotice({
  tone = "info",
  icon,
  children,
}: {
  tone?: NoticeTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`mb-5 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${NOTICE_TONES[tone]}`}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
