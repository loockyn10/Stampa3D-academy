import React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * Piezas compartidas de los dashboards V2 (Inicio, Mi Taller, Mi Negocio).
 * Deliberadamente chicas: encabezado compacto, tarjeta de indicador y panel con título.
 */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stampa-orange">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 md:shrink-0 md:flex-nowrap md:justify-end">{actions}</div>}
    </header>
  );
}

const STAT_TONES = {
  neutral: { icon: "bg-white/5 text-gray-300", value: "text-white" },
  orange: { icon: "bg-stampa-orange/10 text-stampa-orange", value: "text-white" },
  green: { icon: "bg-emerald-500/10 text-emerald-400", value: "text-white" },
  red: { icon: "bg-red-500/10 text-red-400", value: "text-red-300" },
  yellow: { icon: "bg-yellow-500/10 text-yellow-400", value: "text-yellow-200" },
} as const;

export type StatTone = keyof typeof STAT_TONES;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "neutral",
  loading = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: LucideIcon;
  href?: string;
  tone?: StatTone;
  loading?: boolean;
}) {
  const colors = STAT_TONES[tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-tight text-gray-400">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colors.icon}`} aria-hidden="true">
          <Icon size={16} />
        </span>
      </div>
      {loading ? (
        <span className="mt-2 block h-7 w-16 animate-pulse rounded-md bg-white/10" aria-hidden="true" />
      ) : (
        <p className={`mt-1 text-2xl font-bold tabular-nums leading-tight ${colors.value}`}>{value}</p>
      )}
      {hint && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-400">{hint}</p>}
    </>
  );
  const className =
    "block min-w-0 rounded-xl border border-stampa-border bg-stampa-surface p-3 sm:p-4";

  if (!href) return <div className={className}>{body}</div>;
  return (
    <Link
      href={href}
      className={`${className} transition-colors hover:border-stampa-orange/40 hover:bg-white/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange`}
    >
      {body}
    </Link>
  );
}

export function Panel({
  title,
  icon: Icon,
  action,
  children,
  className = "",
}: {
  title: string;
  icon?: LucideIcon;
  action?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-stampa-border bg-stampa-surface p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold text-white">
          {Icon && <Icon size={16} className="shrink-0 text-stampa-orange" aria-hidden="true" />}
          <span className="truncate">{title}</span>
        </h2>
        {action && (
          <Link href={action.href} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-1 text-xs font-semibold text-stampa-orange hover:text-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
            {action.label} <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function PanelEmpty({ children, action }: { children: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-xl border border-dashed border-stampa-border px-4 py-5 text-center">
      <p className="text-sm text-gray-400">{children}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-3 inline-flex min-h-9 items-center justify-center rounded-lg bg-stampa-orange/10 px-3 text-xs font-bold text-stampa-orange transition-colors hover:bg-stampa-orange/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
