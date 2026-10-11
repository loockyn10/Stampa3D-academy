"use client";

import React from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { PREVIEW_STATUS_LABEL, type PreviewGenerationStatus } from "@/lib/stl/preview-media";

interface StlPreviewPanelProps {
  status: PreviewGenerationStatus;
  previewUrl: string | null;
  /** Mensaje no destructivo (p. ej. "No pudimos generar la vista 360°…"). */
  notice: string | null;
  /** Se puede generar (modelo guardado + archivo STL/3MF sin cambios pendientes). */
  canGenerate: boolean;
  disabledReason: string | null;
  onGenerate: () => void;
  /** Miniatura actual del modelo (manual o generada). */
  thumbnailUrl?: string | null;
  /** Acción explícita: reemplaza la miniatura, incluso una cargada a mano. */
  onRegenerateThumbnail?: () => void;
}

/** Estado + acción de la vista 360° de un modelo (Admin). Nunca bloquea el guardado del modelo. */
export function StlPreviewPanel({ status, previewUrl, notice, canGenerate, disabledReason, onGenerate, thumbnailUrl, onRegenerateThumbnail }: StlPreviewPanelProps) {
  const busy = status === "generating";
  const hasPreview = Boolean(previewUrl);
  return (
    <div className="space-y-3 rounded-xl border border-stampa-border bg-stampa-bg-soft p-4 md:col-span-2" data-testid="stl-preview-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-stampa-orange" />
          ) : status === "failed" ? (
            <AlertCircle className="h-4 w-4 text-amber-400" />
          ) : hasPreview || status === "ready" ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : null}
          <span>Vista 360°</span>
          <span className="text-xs font-normal text-gray-400">
            {busy || status === "failed" ? PREVIEW_STATUS_LABEL[status] : hasPreview ? PREVIEW_STATUS_LABEL.ready : PREVIEW_STATUS_LABEL.idle}
          </span>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-stampa-border bg-stampa-surface px-3 py-1.5 text-xs font-bold text-gray-200 transition-colors hover:border-stampa-orange/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          {hasPreview ? "Regenerar vista 360°" : "Generar vista 360°"}
        </button>
      </div>

      {onRegenerateThumbnail && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stampa-border pt-3">
          <div className="flex items-center gap-3 text-xs text-gray-400">
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbnailUrl} alt="Miniatura actual" className="h-12 w-12 rounded-md border border-stampa-border object-cover" />
            ) : null}
            <span>{thumbnailUrl ? "Miniatura cargada" : "Sin miniatura: se genera sola con la vista 360°"}</span>
          </div>
          <button
            type="button"
            onClick={onRegenerateThumbnail}
            disabled={!canGenerate || busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stampa-border bg-stampa-surface px-3 py-1.5 text-xs font-bold text-gray-200 transition-colors hover:border-stampa-orange/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Regenerar miniatura
          </button>
        </div>
      )}

      {notice && <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{notice}</p>}
      {!canGenerate && disabledReason && <p className="text-xs text-gray-500">{disabledReason}</p>}

      {hasPreview && (
        <video
          key={previewUrl ?? "none"}
          src={previewUrl ?? undefined}
          muted
          loop
          autoPlay
          playsInline
          className="h-40 w-40 rounded-lg border border-stampa-border bg-stampa-surface object-cover"
        />
      )}
      <p className="text-[11px] text-gray-500">
        Se genera en este navegador (recomendado: Chrome o Edge). Si falla, la card sigue mostrando la miniatura.
      </p>
    </div>
  );
}
