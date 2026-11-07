"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, Check, DollarSign, Pencil, RefreshCw, Store, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ProductCategoryBadge } from "@/components/products/product-categories";

export interface ProductCardProduct {
  id: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  sale_price?: number | null;
  stock_quantity?: number | null;
  is_active?: boolean | null;
  product_components?: unknown[] | null;
}

interface ProductCardProps {
  product: ProductCardProduct;
  categoryName?: string;
  needsRecalculation: boolean;
  linkedToBusiness: boolean;
  /** Este producto se está recalculando (spinner). */
  recalculating: boolean;
  /** Hay un recálculo en curso (de este u otro producto): las acciones de recálculo se bloquean. */
  recalculationBusy: boolean;
  onDetail: () => void;
  onEdit: () => void;
  onRecalculate: () => void;
  onDelete: () => void;
}

function RecalculatePriceIcon({ loading }: { loading: boolean }) {
  return (
    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
      <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
      {!loading && <DollarSign size={9} strokeWidth={3} className="absolute" />}
    </span>
  );
}

const ACTION_BUTTON =
  "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-bold transition-colors sm:min-h-10";

/**
 * Tarjeta de producto de Mi Taller. Estructura en tres bloques para que nada dependa del ancho:
 * 1) identidad (imagen, nombre en hasta 2 líneas, tipo y categoría, descripción si existe),
 * 2) datos comerciales (venta y stock),
 * 3) acciones: principales (Ver detalle / Editar) en una fila propia y secundarias (Recalcular, Mi Negocio, Eliminar) debajo.
 * Todo el contenido es `min-w-0` y puede envolver, así que ningún botón sobresale de la tarjeta.
 */
export function ProductCard({
  product: p,
  categoryName,
  needsRecalculation,
  linkedToBusiness,
  recalculating,
  recalculationBusy,
  onDetail,
  onEdit,
  onRecalculate,
  onDelete,
}: ProductCardProps) {
  const stock = p.stock_quantity || 0;
  const isAssembled = (p.product_components?.length ?? 0) > 1;
  const description = p.description?.trim();

  return (
    <Card
      className={`flex h-full min-w-0 flex-col bg-stampa-surface p-4 transition-all hover:border-stampa-orange/30 hover:shadow-[0_0_15px_rgba(255,106,0,0.05)] ${
        p.is_active === false ? "opacity-60 grayscale" : ""
      } ${needsRecalculation ? "border-yellow-500/50 bg-yellow-500/5 ring-1 ring-yellow-500/20" : ""}`}
    >
      {needsRecalculation && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-2.5 py-2">
          <AlertTriangle size={15} className="shrink-0 text-yellow-500" aria-hidden="true" />
          <p className="text-xs font-bold uppercase tracking-wide text-yellow-400">Requiere recalcular</p>
        </div>
      )}

      <div className="flex min-w-0 items-start gap-3">
        {p.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl border border-stampa-border bg-stampa-bg-soft object-cover" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 select-none items-center justify-center rounded-xl border border-stampa-border bg-stampa-bg-soft text-2xl text-gray-400" aria-hidden="true">
            📦
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 break-words text-base font-bold leading-snug text-fg" title={p.name}>{p.name}</h3>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
            {isAssembled ? (
              <span className="shrink-0 rounded-md border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-blue-400">Armable</span>
            ) : (
              <span className="shrink-0 rounded-md border border-fg/15 bg-fg/5 px-1.5 py-0.5 text-[10px] font-bold uppercase text-gray-400">Simple</span>
            )}
            {categoryName && <ProductCategoryBadge name={categoryName} />}
          </div>
        </div>
      </div>

      {description && <p className="mt-3 line-clamp-2 break-words text-xs leading-5 text-gray-400">{description}</p>}

      <dl className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-stampa-border bg-fg/[0.03] px-3 py-2.5">
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase text-gray-500">Venta</dt>
          <dd className="truncate text-sm font-black text-stampa-accent">${p.sale_price?.toFixed(2) || "0.00"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase text-gray-500">Stock</dt>
          <dd className={`text-sm font-bold ${stock > 0 ? "text-fg" : "text-red-500"}`}>{stock}</dd>
        </div>
      </dl>

      <div className="mt-auto space-y-2 pt-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onDetail}
            className={`${ACTION_BUTTON} border-stampa-border bg-fg/5 text-gray-300 hover:bg-fg/10 hover:text-fg`}
          >
            Ver detalle
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            className={`${ACTION_BUTTON} border-stampa-orange bg-stampa-orange text-neutral-950 hover:bg-stampa-orange-hover`}
          >
            <Pencil size={13} aria-hidden="true" /> Editar
          </button>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-t border-stampa-border pt-2">
          <button
            type="button"
            onClick={onRecalculate}
            disabled={recalculationBusy}
            className={`${ACTION_BUTTON} border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400/50 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50`}
            aria-label={`Recalcular precio de ${p.name}`}
            title="Recalcular precio"
          >
            <RecalculatePriceIcon loading={recalculating} />
            <span className="truncate">Recalcular</span>
          </button>
          <Link
            href={linkedToBusiness ? "/mi-negocio/catalogo" : `/mi-negocio/catalogo?producto=${p.id}`}
            className={`${ACTION_BUTTON} ${
              linkedToBusiness
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                : "border-cyan-500/35 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
            }`}
            aria-label={linkedToBusiness ? `${p.name} ya está en Mi Negocio` : `Agregar ${p.name} a Mi Negocio`}
            title={linkedToBusiness ? "Ya está en Mi Negocio" : "Agregar a Mi Negocio"}
          >
            {linkedToBusiness ? <Check size={14} aria-hidden="true" /> : <Store size={14} aria-hidden="true" />}
            <span className="truncate">Mi Negocio</span>
          </Link>
          <button
            type="button"
            onClick={onDelete}
            className={`${ACTION_BUTTON} w-11 border-red-500/25 bg-red-500/10 px-0 text-red-300 hover:border-red-500/40 hover:bg-red-500/20`}
            aria-label={`Eliminar ${p.name}`}
            title="Eliminar producto"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </Card>
  );
}
