import React from "react";
import { Settings, Store } from "lucide-react";
import type { MarketplacePriceResult } from "@/lib/calculator/pricing";

interface MarketplacePriceCardProps {
  result: MarketplacePriceResult;
  /** Hay un cálculo válido (filamento, gramos y precio > 0). */
  hasValidCalc: boolean;
  /** "user" = valores guardados por el usuario; "reference" = valores de ejemplo editables en Modo Avanzado. */
  source: "user" | "reference";
  onConfigure: () => void;
  configureLabel: string;
}

const money = (value: number) => `$${value.toFixed(2)}`;

/**
 * Resultado "Precio Mercado Libre": componente propio (amarillo) para diferenciarlo del precio sugerido.
 * Sin comisión configurada no muestra una cifra: pide configurarla en lugar de presentar una estimación engañosa.
 */
export function MarketplacePriceCard({ result, hasValidCalc, source, onConfigure, configureLabel }: MarketplacePriceCardProps) {
  return (
    <section
      aria-labelledby="marketplace-price-title"
      className="relative overflow-hidden rounded-xl border border-yellow-400/35 bg-gradient-to-br from-yellow-400/[0.14] via-yellow-400/[0.06] to-transparent p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-yellow-400 text-neutral-950" aria-hidden="true">
            <Store size={15} />
          </span>
          <h3 id="marketplace-price-title" className="text-[11px] font-black uppercase tracking-wider text-yellow-200">
            Precio Mercado Libre
          </h3>
        </div>
        <button
          type="button"
          onClick={onConfigure}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-yellow-400/30 px-2 text-[11px] font-semibold text-yellow-100 transition-colors hover:bg-yellow-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300"
        >
          <Settings size={12} aria-hidden="true" /> {configureLabel}
        </button>
      </div>

      {result.status === "not_configured" ? (
        <p className="mt-3 text-xs leading-relaxed text-yellow-100/85" data-testid="marketplace-price-missing">
          Configurá la comisión de venta de tu publicación para estimar este precio. No usamos porcentajes oficiales por defecto.
        </p>
      ) : result.status === "invalid_commission" ? (
        <p className="mt-3 text-xs leading-relaxed text-red-200" role="alert" data-testid="marketplace-price-invalid">
          La comisión tiene que ser mayor a 0 % y menor a 100 %. Revisá el valor configurado.
        </p>
      ) : (
        <>
          <p className="mt-3 text-2xl font-black tabular-nums text-yellow-300" data-testid="marketplace-price-value">
            {hasValidCalc ? money(result.price) : "—"}
          </p>
          {hasValidCalc && (
            <dl className="mt-3 space-y-1 border-t border-yellow-400/20 pt-2 text-[11px] text-yellow-100/80">
              <div className="flex justify-between gap-2">
                <dt>Comisión ({result.commissionPercent}% del precio final)</dt>
                <dd className="tabular-nums">−{money(result.commissionAmount)}</dd>
              </div>
              {result.fixedFee > 0 && (
                <div className="flex justify-between gap-2">
                  <dt>Cargo fijo</dt>
                  <dd className="tabular-nums">−{money(result.fixedFee)}</dd>
                </div>
              )}
              {result.shippingCost > 0 && (
                <div className="flex justify-between gap-2">
                  <dt>Envío a tu cargo</dt>
                  <dd className="tabular-nums">−{money(result.shippingCost)}</dd>
                </div>
              )}
              {result.otherSellingCosts > 0 && (
                <div className="flex justify-between gap-2">
                  <dt>Otros costos de venta</dt>
                  <dd className="tabular-nums">−{money(result.otherSellingCosts)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2 border-t border-yellow-400/15 pt-1 font-semibold text-yellow-100">
                <dt>Recibís</dt>
                <dd className="tabular-nums">{money(result.netReceived)}</dd>
              </div>
            </dl>
          )}
          <p className="mt-2 text-[10px] leading-snug text-yellow-100/60">
            {source === "user"
              ? "Calculado para recibir el precio sugerido con tu comisión y cargos. Verificá los valores vigentes de tu publicación."
              : "Comisión de ejemplo, no oficial. Ajustala en Modo Avanzado según tu publicación."}
          </p>
        </>
      )}
    </section>
  );
}
