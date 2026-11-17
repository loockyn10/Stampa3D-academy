"use client";

import React from "react";
import { AlertTriangle, PieChart } from "lucide-react";
import type { CostBreakdown, CostGroupId } from "@/lib/calculator/cost-breakdown";
import { InfoTip } from "@/components/ui/info-tip";

const money = (value: number) => `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
const percent = (value: number) => `${(Number.isFinite(value) ? value : 0).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

const SEGMENT_STYLES: Record<CostGroupId | "reserve" | "profit", { bar: string; dot: string; label: string }> = {
  printing: { bar: "bg-stampa-orange", dot: "bg-stampa-orange", label: "Impresión" },
  components: { bar: "bg-amber-300", dot: "bg-amber-300", label: "Componentes" },
  packaging: { bar: "bg-sky-400", dot: "bg-sky-400", label: "Embalaje" },
  other: { bar: "bg-indigo-400", dot: "bg-indigo-400", label: "Otros gastos" },
  reserve: { bar: "bg-gray-500", dot: "bg-gray-500", label: "Contingencias" },
  profit: { bar: "bg-emerald-500", dot: "bg-emerald-500", label: "Ganancia" },
};

/** Desglose del precio sugerido y rentabilidad: qué parte es impresión, componentes, embalaje, contingencias y ganancia. */
export function CostProfitabilityCard({ breakdown }: { breakdown: CostBreakdown }) {
  const { profit } = breakdown;
  const segments = [
    ...breakdown.groups.map((group) => ({ id: group.id as CostGroupId | "reserve" | "profit", amount: group.amount })),
    { id: "reserve" as const, amount: breakdown.contingencyAmount },
    { id: "profit" as const, amount: Math.max(0, profit) },
  ].filter((segment) => segment.amount > 0);
  const barTotal = segments.reduce((total, segment) => total + segment.amount, 0);
  const top = breakdown.topItem;
  const topShare = top && breakdown.realCost > 0 ? (top.amount / breakdown.realCost) * 100 : 0;

  // UX-03: precio, costo total, ganancia y margen ya están en el «Resumen del cálculo»; esta tarjeta muestra
  // cómo se compone el precio, el mayor costo, las contingencias (separadas del costo real) y las advertencias.
  return (
    <section className="rounded-2xl border border-stampa-border bg-stampa-surface p-5 shadow-lg" aria-labelledby="calc-profitability-title">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 id="calc-profitability-title" className="flex items-center gap-2 text-sm font-bold text-fg">
          <PieChart size={17} className="text-stampa-accent" aria-hidden="true" /> Rentabilidad
          <InfoTip label="Cómo se calcula la rentabilidad">
            Margen = ganancia ÷ precio de venta (el markup ×{breakdown.multiplier} se aplica solo al filamento). Venta directa: no incluye comisiones de plataformas ni envío al cliente; para eso mirá el Precio Mercado Libre. Los insumos se cuentan a su costo real; las contingencias (opcionales) se cuentan como costo y no como ganancia.
          </InfoTip>
        </h3>
        {breakdown.isProvisional && (
          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">Provisoria</span>
        )}
      </div>

      {barTotal > 0 && (
        <>
          <p className="mb-1.5 text-[11px] text-gray-500">Composición del precio</p>
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

      {breakdown.contingencyAmount > 0 && (
        <dl className="mt-4 space-y-2 rounded-xl border border-stampa-border bg-stampa-bg-soft p-3">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs text-gray-400">Costo real de fabricación</dt>
            <dd className="text-sm font-bold text-fg">{money(breakdown.realCost)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs text-gray-400">Contingencias sobre insumos ({percent(breakdown.contingencyPercent)})</dt>
            <dd className="text-sm font-medium text-gray-300">{money(breakdown.contingencyAmount)}</dd>
          </div>
        </dl>
      )}

      {top && (
        <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
          <span className="text-gray-500">Mayor costo:</span> <strong className="text-gray-200">{top.label}</strong> ({money(top.amount)} · {percent(topShare)} del costo real)
        </p>
      )}

      {breakdown.warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {breakdown.warnings.map((warning) => (
            <li key={warning.code} className="flex gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] leading-relaxed text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" /> {warning.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
