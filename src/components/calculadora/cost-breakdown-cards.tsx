"use client";

import React from "react";
import { AlertTriangle, Boxes, PieChart, Settings2 } from "lucide-react";
import type { CostBreakdown, CostGroupId } from "@/lib/calculator/cost-breakdown";
import { describeSupplyLine, type SupplyLinesPricing } from "@/lib/calculator/supplies";

const money = (value: number) => `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
const percent = (value: number) => `${(Number.isFinite(value) ? value : 0).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

const SEGMENT_STYLES: Record<CostGroupId | "reserve" | "profit", { bar: string; dot: string; label: string }> = {
  printing: { bar: "bg-stampa-orange", dot: "bg-stampa-orange", label: "Impresión" },
  components: { bar: "bg-amber-300", dot: "bg-amber-300", label: "Componentes" },
  packaging: { bar: "bg-sky-400", dot: "bg-sky-400", label: "Embalaje" },
  other: { bar: "bg-indigo-400", dot: "bg-indigo-400", label: "Otros gastos" },
  reserve: { bar: "bg-gray-500", dot: "bg-gray-500", label: "Recargo 30 %" },
  profit: { bar: "bg-emerald-500", dot: "bg-emerald-500", label: "Ganancia" },
};

/**
 * Componentes y embalaje del tipo de producto elegido, con su costo actual del catálogo.
 * Solo presentación: el costo ya entró al motor (`suppliesCost`).
 */
export function ProductSuppliesCard({
  productTypeName,
  pricing,
  onEdit,
}: {
  productTypeName: string;
  pricing: SupplyLinesPricing;
  onEdit: () => void;
}) {
  return (
    <section className="rounded-2xl border border-stampa-border bg-stampa-surface p-4 shadow-lg sm:p-6" aria-labelledby="calc-supplies-title">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="calc-supplies-title" className="flex items-center gap-2 text-lg font-bold text-fg">
            <Boxes size={18} className="text-stampa-accent" aria-hidden="true" /> Componentes y embalaje
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            De «{productTypeName}». Costos de tu catálogo de insumos: si cambiás un precio, se actualiza solo.
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-stampa-border bg-fg/5 px-3 text-xs font-semibold text-fg transition-colors hover:bg-fg/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
        >
          <Settings2 size={15} aria-hidden="true" /> <span className="hidden min-[400px]:inline">Editar</span>
        </button>
      </div>

      <ul className="divide-y divide-stampa-border rounded-xl border border-stampa-border">
        {pricing.lines.map((line) => (
          <li key={line.supplyId} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-fg">
                {line.name}
                {line.archived && <span className="ml-2 rounded bg-fg/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-400">Archivado</span>}
              </p>
              <p className="text-[11px] text-gray-500">
                {line.category === "packaging" ? "Embalaje" : "Componente"} · {describeSupplyLine(line)}
              </p>
            </div>
            <p className={`shrink-0 text-sm font-semibold ${line.valid && line.unitCost === 0 ? "text-amber-400" : "text-gray-200"}`}>
              {!line.valid ? "Inválido" : line.unitCost === 0 ? "Sin costo" : money(line.cost)}
            </p>
          </li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-fg/[0.04] p-2">
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Componentes</dt>
          <dd className="text-sm font-bold text-fg">{money(pricing.componentsCost)}</dd>
        </div>
        <div className="rounded-xl bg-fg/[0.04] p-2">
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Embalaje</dt>
          <dd className="text-sm font-bold text-fg">{money(pricing.packagingCost)}</dd>
        </div>
        <div className="rounded-xl bg-stampa-orange/10 p-2">
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Total</dt>
          <dd className="text-sm font-bold text-stampa-accent">{money(pricing.total)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        Igual que los insumos extra: se les suma el recargo del 30 % (envío, desperdicio, fallas) y no se les aplica el markup.
      </p>
    </section>
  );
}

/** Invitación discreta (solo Modo Avanzado) cuando el tipo elegido todavía no tiene componentes. */
export function ProductSuppliesEmptyHint({ productTypeName, onConfigure }: { productTypeName: string; onConfigure: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-stampa-border bg-stampa-surface/60 p-4 sm:flex-row sm:items-center">
      <Boxes size={20} className="shrink-0 text-stampa-accent" aria-hidden="true" />
      <p className="flex-1 text-xs leading-relaxed text-gray-400">
        <strong className="text-gray-200">¿«{productTypeName}» lleva componentes o embalaje?</strong> Cargá focos, cables o cajas una sola vez en tu catálogo y la calculadora los suma con su costo actual.
      </p>
      <button
        type="button"
        onClick={onConfigure}
        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-stampa-orange/40 px-3 text-xs font-semibold text-stampa-accent transition-colors hover:bg-stampa-orange/10"
      >
        Configurar componentes
      </button>
    </div>
  );
}

/** Desglose del precio sugerido y rentabilidad: qué parte es impresión, componentes, embalaje, recargo y ganancia. */
export function CostProfitabilityCard({ breakdown }: { breakdown: CostBreakdown }) {
  const { salePrice, profit } = breakdown;
  const segments = [
    ...breakdown.groups.map((group) => ({ id: group.id as CostGroupId | "reserve" | "profit", amount: group.amount })),
    { id: "reserve" as const, amount: breakdown.overheadAmount },
    { id: "profit" as const, amount: Math.max(0, profit) },
  ].filter((segment) => segment.amount > 0);
  const barTotal = segments.reduce((total, segment) => total + segment.amount, 0);
  const printing = breakdown.groups.find((group) => group.id === "printing");
  const packaging = breakdown.groups.find((group) => group.id === "packaging");
  const components = breakdown.groups.find((group) => group.id === "components");
  const top = breakdown.topItem;
  const topShare = top && breakdown.realCost > 0 ? (top.amount / breakdown.realCost) * 100 : 0;

  return (
    <section className="rounded-2xl border border-stampa-border bg-stampa-surface p-5 shadow-lg" aria-labelledby="calc-profitability-title">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 id="calc-profitability-title" className="flex items-center gap-2 text-sm font-bold text-fg">
          <PieChart size={17} className="text-stampa-accent" aria-hidden="true" /> Rentabilidad
        </h3>
        {breakdown.isProvisional && (
          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">Provisoria</span>
        )}
      </div>

      {barTotal > 0 && (
        <>
          <p className="mb-1.5 text-[11px] text-gray-500">Cómo se compone el precio sugerido</p>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-fg/10" role="img" aria-label={segments.map((segment) => `${SEGMENT_STYLES[segment.id].label} ${percent((segment.amount / barTotal) * 100)}`).join(", ")}>
            {segments.map((segment) => (
              <span key={segment.id} className={`${SEGMENT_STYLES[segment.id].bar} h-full`} style={{ width: `${(segment.amount / barTotal) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {segments.map((segment) => (
              <li key={segment.id} className="flex min-w-0 items-center gap-1.5 text-[11px]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${SEGMENT_STYLES[segment.id].dot}`} aria-hidden="true" />
                <span className="truncate text-gray-400">{SEGMENT_STYLES[segment.id].label}</span>
                <span className="ml-auto shrink-0 font-semibold text-gray-200">{percent((segment.amount / barTotal) * 100)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <dl className="mt-4 space-y-2 rounded-xl border border-stampa-border bg-stampa-bg-soft p-3">
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">Costo real de fabricación</dt>
          <dd className="text-sm font-bold text-fg">{money(breakdown.realCost)}</dd>
        </div>
        {breakdown.overheadAmount > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-xs text-gray-400">Recargo {percent(breakdown.overheadRate * 100)} sobre insumos</dt>
            <dd className="text-sm font-medium text-gray-300">{money(breakdown.overheadAmount)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">Precio de venta sugerido</dt>
          <dd className="text-sm font-bold text-emerald-400">{money(salePrice)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">Ganancia estimada{breakdown.isProvisional ? " (provisoria)" : ""}</dt>
          <dd className={`text-sm font-bold ${profit < 0 ? "text-red-400" : "text-emerald-400"}`}>{money(profit)}</dd>
        </div>
        <div className="flex items-center justify-between border-t border-stampa-border pt-2">
          <dt className="text-xs font-semibold text-gray-300">Margen de ganancia</dt>
          <dd className={`text-base font-black ${profit < 0 ? "text-red-400" : "text-emerald-400"}`}>
            {breakdown.marginPercent === null ? "—" : percent(breakdown.marginPercent)}
          </dd>
        </div>
      </dl>

      <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-gray-400">
        {top && (
          <li>
            <span className="text-gray-500">Mayor costo:</span> <strong className="text-gray-200">{top.label}</strong> ({money(top.amount)} · {percent(topShare)} del costo real)
          </li>
        )}
        {printing && breakdown.realCost > 0 && (
          <li><span className="text-gray-500">Impresión:</span> {percent(printing.share * 100)} del costo real</li>
        )}
        {(components?.amount ?? 0) > 0 && <li><span className="text-gray-500">Componentes:</span> {money(components!.amount)}</li>}
        {(packaging?.amount ?? 0) > 0 && <li><span className="text-gray-500">Embalaje:</span> {money(packaging!.amount)}</li>}
      </ul>

      {breakdown.warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {breakdown.warnings.map((warning) => (
            <li key={warning.code} className="flex gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] leading-relaxed text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" /> {warning.message}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-gray-500">
        Margen = ganancia ÷ precio de venta (el markup x{breakdown.multiplier} se aplica solo al filamento). Venta directa: no incluye comisiones de plataformas ni envío al cliente; para eso mirá el Precio Mercado Libre. El recargo del 30 % cubre envío, desperdicio y fallas, así que se cuenta como costo y no como ganancia.
      </p>
    </section>
  );
}
