"use client";

import React from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { IssueFix, IssueSummary, SummaryItem } from "@/lib/maker/lamps/issuesSummary";

/**
 * Estado del diseño en tres niveles y sin ruido: un problema que bloquea se dice en una línea (con una acción concreta cuando la hay); las recomendaciones
 * son un indicador discreto que se expande; lo térmico/eléctrico pendiente es una línea proporcionada. Nada de códigos internos ni de párrafos permanentes:
 * el mensaje completo del motor queda disponible al expandir. Presentacional: recibe el resumen ya calculado (`summarizeIssues`).
 */
export interface LampStatusProps {
  summary: IssueSummary;
  /** El visor muestra la última lámpara válida porque los valores actuales no se pueden aplicar. */
  outdated: boolean;
  onFix: (fix: IssueFix) => void;
  /** Hay un último diseño válido al que volver. */
  onRestoreLast?: () => void;
  onReset: () => void;
}

const actionClass = "inline-flex h-8 items-center justify-center rounded-lg border border-red-400/40 px-2.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-400/10";

function BlockingItem({ item, onFix }: { item: SummaryItem; onFix: (fix: IssueFix) => void }) {
  return (
    <li className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{item.short}</span>
        {item.fix && (
          <button type="button" onClick={() => onFix(item.fix!)} className={actionClass}>
            {item.fix.label}
          </button>
        )}
      </span>
      <details className="text-red-200/80">
        <summary className="cursor-pointer select-none text-[11px] text-red-200/70">Ver detalle</summary>
        <p className="mt-1 text-[11px] leading-snug">{item.detail}</p>
      </details>
    </li>
  );
}

export function LampStatus({ summary, outdated, onFix, onRestoreLast, onReset }: LampStatusProps) {
  const [primary, ...rest] = summary.blocking;
  if (!primary && summary.advice.length === 0 && summary.safety.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="lamp-status">
      {primary && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
          <ul className="flex flex-col gap-2">
            <BlockingItem item={primary} onFix={onFix} />
          </ul>
          {rest.length > 0 && (
            <details>
              <summary className="cursor-pointer select-none text-[11px] font-semibold text-red-200/80">{rest.length === 1 ? "1 problema más" : `${rest.length} problemas más`}</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {rest.map((item) => (
                  <BlockingItem key={item.key} item={item} onFix={onFix} />
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {onRestoreLast && (
              <button type="button" onClick={onRestoreLast} className={actionClass}>
                Volver al último diseño válido
              </button>
            )}
            <button type="button" onClick={onReset} className={actionClass}>
              Restablecer esta pantalla
            </button>
          </div>
          <span className="text-[11px] text-red-200/70">{outdated ? "El visor muestra el último diseño válido. No se puede descargar hasta resolverlo." : "No se puede descargar hasta resolverlo."}</span>
        </div>
      )}
      {summary.advice.length > 0 && (
        <details className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 font-semibold">
            <AlertTriangle size={14} aria-hidden="true" />
            {summary.advice.length === 1 ? "1 recomendación" : `${summary.advice.length} recomendaciones`}
          </summary>
          <ul className="flex flex-col gap-1.5 px-3 pb-3">
            {summary.advice.map((item) => (
              <li key={item.key}>
                <details>
                  <summary className="cursor-pointer select-none">{item.short}</summary>
                  <p className="mt-1 text-[11px] leading-snug text-amber-200/80">{item.detail}</p>
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
      {summary.safety.map((item) => (
        <details key={item.key} className="rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs text-amber-300">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 font-semibold">
            <ShieldAlert size={14} aria-hidden="true" />
            {item.short}
          </summary>
          <p className="whitespace-pre-line px-3 pb-3 text-[11px] leading-snug text-amber-200/80">{item.detail}</p>
        </details>
      ))}
    </div>
  );
}
