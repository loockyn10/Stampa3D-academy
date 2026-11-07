"use client";

import React from "react";
import { Search, X } from "lucide-react";

/**
 * Estructura común de las pantallas de Mi Taller (Inventario, Productos, Filamentos, Impresoras).
 * Orden fijo, de arriba abajo, con el mismo ritmo vertical (mb-5) entre bloques:
 *   1. navegación de Mi Taller (layout)      2. WorkshopPageHeader: título, descripción y acciones
 *   3. WorkshopNotice: alertas, si existen   4. WorkshopToolbar: búsqueda, filtros y resumen
 *   5. contenido propio de cada pantalla (tabla, tarjetas, bobinas, equipos), con `WORKSHOP_GRID_GAP`.
 * Cada pantalla conserva su contenido; lo que se unifica es el marco.
 */

/** Separación entre tarjetas del contenido principal. */
export const WORKSHOP_GRID_GAP = "gap-4 sm:gap-5";

export function WorkshopPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  /** Secundarias primero (neutras) y la acción principal al final (naranja); a ancho completo en el celular. */
  actions?: React.ReactNode;
}) {
  // El diseño responde al ancho del contenedor (no del viewport): con el sidebar abierto o contraído el encabezado
  // se acomoda solo. Angosto: texto y acciones apilados (acciones a ancho completo); amplio: fila con acciones a la derecha.
  return (
    <header className="@container mb-5">
      <div className="flex flex-col gap-4 @3xl:flex-row @3xl:items-end @3xl:justify-between">
        <div className="min-w-0 @3xl:max-w-xl">
          <h2 className="text-2xl font-black leading-tight tracking-tight text-fg">{title}</h2>
          {description && <p className="mt-1.5 text-sm leading-6 text-gray-400">{description}</p>}
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

/**
 * Panel de búsqueda y filtros. Siempre en la misma posición (debajo del encabezado y las alertas) y con el mismo marco:
 * - `children`: controles de la fila principal (buscador, selectores, «Limpiar»), todos de 44 px de alto;
 * - `summary`: conteo del contenido («5 productos», «2 de 8 filamentos»);
 * - `extra`: segunda fila para filtros en chips o avisos de filtro activo.
 */
export function WorkshopToolbar({
  children,
  summary,
  extra,
}: {
  children?: React.ReactNode;
  summary?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <section aria-label="Búsqueda y filtros" className="mb-5 flex flex-col justify-center rounded-2xl border border-stampa-border bg-stampa-surface p-3 sm:min-h-[4.75rem] sm:p-4">
      {(children || summary) && <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {children}
        {summary && (
          <p role="status" className={`text-xs font-semibold text-gray-400 lg:whitespace-nowrap ${children ? "lg:ml-auto lg:min-w-[7.5rem] lg:text-right" : ""}`}>
            {summary}
          </p>
        )}
      </div>}
      {extra && <div className={`flex flex-col gap-3 ${children || summary ? "mt-3 border-t border-stampa-border pt-3" : ""}`}>{extra}</div>}
    </section>
  );
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
    <div className="relative w-full lg:min-w-[14rem] lg:flex-1">
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

/** Filtro activo en la fila extra del panel (p. ej. «Mostrando productos sin stock» + «Ver todos»). */
export function WorkshopFilterChip({
  tone = "warning",
  children,
  onClear,
  clearLabel = "Ver todos",
}: {
  tone?: "warning" | "danger";
  children: React.ReactNode;
  onClear: () => void;
  clearLabel?: string;
}) {
  const toneClass = tone === "danger" ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-yellow-500/30 bg-yellow-500/10 text-yellow-200";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>{children}</span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-xs font-semibold text-gray-400 transition-colors hover:bg-fg/5 hover:text-fg"
      >
        <X size={13} aria-hidden="true" /> {clearLabel}
      </button>
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
