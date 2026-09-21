"use client";

import { useState } from "react";
import Link from "next/link";
import { Calculator, Download, ExternalLink, Eye, Heart, ImageOff } from "lucide-react";
import { MODEL_SOURCE_LABELS } from "@/lib/model-search/sources";
import { buildCalculatorLink } from "@/lib/model-search/calculator-link";
import type { ModelSearchResult } from "@/lib/model-search/types";

const compactNumber = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });

function PriceBadge({ isFree }: { isFree: boolean | null }) {
  if (isFree === true) {
    return <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">Gratis</span>;
  }
  if (isFree === false) {
    return <span className="rounded-full border border-stampa-orange/20 bg-stampa-orange/10 px-2 py-0.5 text-[11px] font-semibold text-stampa-orange">De pago</span>;
  }
  return <span className="rounded-full border border-stampa-border bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-gray-400">Precio no informado</span>;
}

function CommercialBadge({ value }: { value: ModelSearchResult["license"]["commercialUse"] }) {
  if (value === "allowed") {
    return <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">✅ Uso comercial permitido</span>;
  }
  if (value === "prohibited") {
    return <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-400">🚫 No comercial</span>;
  }
  return <span className="rounded-full border border-stampa-border bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-gray-300">? Revisar licencia</span>;
}

interface ModelResultCardProps {
  result: ModelSearchResult;
  /** Solo usuarios con acceso pago ven la integración con la Calculadora. */
  canCalculate: boolean;
}

export function ModelResultCard({ result, canCalculate }: ModelResultCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const sourceLabel = MODEL_SOURCE_LABELS[result.source];
  const showImage = result.thumbnailUrl && !imageFailed;
  const metrics = [
    { key: "likes", value: result.likes, icon: Heart, label: "Me gusta" },
    { key: "views", value: result.views, icon: Eye, label: "Vistas" },
    { key: "downloads", value: result.downloads, icon: Download, label: "Descargas" },
  ].filter((metric) => metric.value !== null);

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface shadow-lg shadow-black/20">
      <div className="relative aspect-[4/3] w-full bg-stampa-bg-soft">
        {showImage ? (
          // Imagen servida directamente por la fuente (sin proxy ni copia en storage de Stampa).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.thumbnailUrl ?? undefined}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-600" aria-hidden="true">
            <ImageOff size={28} />
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
          {sourceLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="line-clamp-2 break-words text-sm font-bold leading-snug text-white">{result.title}</h3>
          {result.authorName && (
            <p className="mt-1 truncate text-xs text-gray-400">
              por{" "}
              {result.authorUrl ? (
                <a href={result.authorUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-300 underline-offset-2 hover:underline">
                  {result.authorName}
                </a>
              ) : (
                <span className="font-medium text-gray-300">{result.authorName}</span>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <PriceBadge isFree={result.isFree} />
          <CommercialBadge value={result.license.commercialUse} />
        </div>

        {(result.license.name || result.license.commercialUse === "unknown") && (
          <p className="text-[11px] leading-snug text-gray-500">
            {result.license.name ? `Licencia: ${result.license.name}. ` : ""}
            {result.license.commercialUse === "unknown" ? "Verificá la licencia en la fuente." : ""}
          </p>
        )}

        {metrics.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400" aria-label="Métricas">
            {metrics.map(({ key, value, icon: Icon, label }) => (
              <li key={key} className="flex items-center gap-1" title={label}>
                <Icon size={13} aria-hidden="true" />
                <span className="sr-only">{label}: </span>
                {compactNumber.format(value as number)}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-1">
          <a
            href={result.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-transparent bg-stampa-orange px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-stampa-orange-hover"
          >
            Ver modelo en {sourceLabel}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
          {canCalculate && (
            <Link
              href={buildCalculatorLink(result)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-stampa-border bg-stampa-surface-soft px-4 py-2.5 text-sm font-semibold text-stampa-text-muted transition-colors hover:bg-white/10 hover:text-white"
            >
              <Calculator size={14} aria-hidden="true" />
              Calcular en Stampa
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
