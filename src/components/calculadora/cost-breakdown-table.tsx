"use client";

import React from "react";
import { ListOrdered } from "lucide-react";
import { COST_GROUP_LABELS, type CostBreakdown, type CostGroupId } from "@/lib/calculator/cost-breakdown";

/** "$10.450,00" (es-AR, siempre 2 decimales). */
export function formatBreakdownMoney(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `$${safe.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const percent = (value: number) => `${(Number.isFinite(value) ? value : 0).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

const GROUP_ORDER: CostGroupId[] = ["printing", "components", "packaging", "other"];
const GROUP_DOT: Record<CostGroupId, string> = {
  printing: "bg-stampa-orange",
  components: "bg-amber-300",
  packaging: "bg-sky-400",
  other: "bg-indigo-400",
};

interface CostBreakdownTableProps {
  breakdown: CostBreakdown;
  /** Agrega precio sugerido, ganancia y margen al pie (Mi Taller, donde no hay tarjeta de Rentabilidad). */
  showPricing?: boolean;
  compact?: boolean;
}

/**
 * «Desglose de costos» (D059): cada concepto por separado (filamento, electricidad, desgaste, mano de obra,
 * cada componente y embalaje del catálogo, cada gasto adicional) y las contingencias aparte del costo real.
 * Solo presenta lo que calculó el motor (`buildCostBreakdown`): los importes por fila están repartidos al
 * centavo para que la suma mostrada sea exactamente el costo real.
 */
export function CostBreakdownTable({ breakdown, showPricing = false, compact = false }: CostBreakdownTableProps) {
  const groups = GROUP_ORDER
    .map((id) => {
      const items = breakdown.items.filter((item) => item.group === id && (id === "printing" || item.displayAmount > 0 || item.key.startsWith("supply:")));
      const subtotal = items.reduce((total, item) => total + Math.round(item.displayAmount * 100), 0) / 100;
      return { id, label: COST_GROUP_LABELS[id], items, subtotal };
    })
    .filter((group) => group.items.length > 0);
  const realCostShown = groups.reduce((total, group) => total + Math.round(group.subtotal * 100), 0) / 100;

  return (
    <section
      className={`rounded-2xl border border-stampa-border bg-stampa-surface ${compact ? "p-3 sm:p-4" : "p-4 shadow-lg sm:p-5"}`}
      aria-labelledby="cost-breakdown-title"
    >
      <div className="mb-3">
        <h3 id="cost-breakdown-title" className="flex items-center gap-2 text-sm font-bold text-fg">
          <ListOrdered size={17} className="text-stampa-accent" aria-hidden="true" /> Desglose de costos
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          Cada concepto que forma el costo, tal como lo usa el cálculo. Las contingencias van aparte del costo real.
        </p>
      </div>

      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">Desglose de costos por concepto</caption>
        <colgroup>
          <col />
          <col className="w-[7.5rem] sm:w-[9rem]" />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">Concepto</th>
            <th scope="col">Importe</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id} className="border-b border-stampa-border last:border-b-0">
            <tr>
              <th scope="rowgroup" className="pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 first:pt-0">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${GROUP_DOT[group.id]}`} aria-hidden="true" /> {group.label}
                </span>
              </th>
              <td className="pb-1 pt-3 text-right text-[11px] font-semibold text-gray-400">{formatBreakdownMoney(group.subtotal)}</td>
            </tr>
            {group.items.map((item) => (
              <tr key={item.key} className="align-top">
                <th scope="row" className="py-1.5 pr-2 font-normal">
                  <span className="block break-words text-sm text-gray-200">{item.label}</span>
                  {(item.detail || item.notes?.length) && (
                    <span className="block text-[11px] leading-snug text-gray-500">
                      {[item.detail, ...(item.notes ?? [])].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </th>
                <td className={`py-1.5 text-right text-sm font-medium tabular-nums ${item.notes?.includes("Sin costo cargado") ? "text-amber-400" : "text-gray-200"}`}>
                  {formatBreakdownMoney(item.displayAmount)}
                  {breakdown.realCost > 0 && item.displayAmount > 0 && (
                    <span className="block text-[10px] font-normal text-gray-500">{percent((item.amount / breakdown.realCost) * 100)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot>
          <tr className="border-t-2 border-stampa-border">
            <th scope="row" className="pt-3 text-sm font-bold text-fg">Costo real de fabricación</th>
            <td className="pt-3 text-right text-base font-black tabular-nums text-fg">{formatBreakdownMoney(realCostShown)}</td>
          </tr>
          {breakdown.contingencyBase > 0 && (
            <tr>
              <th scope="row" className="pt-1.5 text-xs font-normal text-gray-400">
                Contingencias sobre insumos ({percent(breakdown.contingencyPercent)})
                <span className="block text-[10px] text-gray-500">Sobre {formatBreakdownMoney(breakdown.contingencyBase)} de insumos · opcionales, no son costo real</span>
              </th>
              <td className="pt-1.5 text-right text-sm tabular-nums text-gray-300">{formatBreakdownMoney(breakdown.contingencyAmount)}</td>
            </tr>
          )}
          {breakdown.contingencyAmount > 0 && (
            <tr>
              <th scope="row" className="pt-1.5 text-xs font-semibold text-gray-300">Costo total con contingencias</th>
              <td className="pt-1.5 text-right text-sm font-bold tabular-nums text-gray-200">{formatBreakdownMoney(breakdown.baseCost)}</td>
            </tr>
          )}
          {showPricing && (
            <>
              <tr>
                <th scope="row" className="pt-3 text-xs font-semibold text-gray-300">Precio de venta sugerido (markup x{breakdown.multiplier} solo sobre filamento)</th>
                <td className="pt-3 text-right text-sm font-bold tabular-nums text-emerald-400">{formatBreakdownMoney(breakdown.salePrice)}</td>
              </tr>
              <tr>
                <th scope="row" className="pt-1.5 text-xs font-normal text-gray-400">Ganancia estimada{breakdown.isProvisional ? " (provisoria)" : ""}</th>
                <td className={`pt-1.5 text-right text-sm font-bold tabular-nums ${breakdown.profit < 0 ? "text-red-400" : "text-emerald-400"}`}>{formatBreakdownMoney(breakdown.profit)}</td>
              </tr>
              <tr>
                <th scope="row" className="pt-1.5 text-xs font-normal text-gray-400">Margen sobre el precio</th>
                <td className="pt-1.5 text-right text-sm font-bold tabular-nums text-emerald-400">{breakdown.marginPercent === null ? "—" : percent(breakdown.marginPercent)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>

      {!breakdown.matchesEngine && (
        <p role="alert" className="mt-2 text-[11px] text-amber-300">
          El desglose no coincide con el costo calculado. Revisá los valores ingresados.
        </p>
      )}
    </section>
  );
}
