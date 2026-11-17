"use client";

import React, { useMemo, useState } from "react";
import { Boxes, Plus, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { CalculatorSelect } from "@/components/ui/calculator-select";
import {
  SUPPLY_UNIT_INFO,
  compatibleUnits,
  describeSupplyLine,
  formatSupplyMoney,
  isSupplyUnit,
  unitShortLabel,
  validateSupplyQuantity,
  type CalculatorSupplyRecord,
  type PricedSupplyLine,
  type SupplyLinesPricing,
  type SupplyUnit,
} from "@/lib/calculator/supplies";
import {
  addProductSupply,
  removeSupplyLine,
  restoreDefaultSupply,
  setSupplyLineQuantity,
  type RemovedDefaultSupply,
  type ResolvedSupplyLine,
  type SupplyAdjustment,
} from "@/lib/calculator/product-supplies";

type PricedResolvedLine = PricedSupplyLine & Partial<ResolvedSupplyLine>;

interface ProductSuppliesAdjusterProps {
  /** Tipo de producto elegido (null si no hay). */
  productTypeName: string | null;
  /** Líneas resueltas y costeadas (predeterminadas del tipo + propias). */
  pricing: SupplyLinesPricing;
  removed: RemovedDefaultSupply[];
  /** Catálogo completo del usuario (para agregar insumos). */
  supplies: CalculatorSupplyRecord[];
  adjustments: SupplyAdjustment[];
  onChange: (next: SupplyAdjustment[]) => void;
  /** "este cálculo" (Calculadora) o "este producto" (Mi Taller). */
  scopeLabel: string;
  /** Contingencias configuradas (0–100), solo para explicar el cálculo. */
  contingencyPercent?: number;
  /** Abre la configuración de componentes del tipo. */
  onEditType?: () => void;
  /** Abre el catálogo de insumos. */
  onOpenCatalog?: () => void;
  compact?: boolean;
}

const fieldClass =
  "h-10 w-full min-w-0 rounded-lg border border-fg/10 bg-fg/[0.06] px-2.5 text-base sm:text-sm text-fg outline-none transition focus:border-[#ff6a00]/60 focus:ring-2 focus:ring-[#ff6a00]/10";

function unitOptions(unit: SupplyUnit, customLabel?: string | null) {
  return compatibleUnits(unit).map((candidate) => ({
    value: candidate,
    label: candidate === "custom" ? unitShortLabel(candidate, customLabel) : SUPPLY_UNIT_INFO[candidate].short,
  }));
}

const money = (value: number) => formatSupplyMoney(value);

/**
 * Componentes y embalaje de UN cálculo o producto (D059). Parte de los componentes predeterminados del tipo y
 * permite ajustarlos SOLO para este cálculo/producto: cambiar una cantidad, quitar un predeterminado o agregar
 * otro insumo del catálogo. Nunca modifica el tipo ni otros productos. El costo sale siempre del catálogo.
 */
export function ProductSuppliesAdjuster({
  productTypeName,
  pricing,
  removed,
  supplies,
  adjustments,
  onChange,
  scopeLabel,
  contingencyPercent = 0,
  onEditType,
  onOpenCatalog,
  compact = false,
}: ProductSuppliesAdjusterProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [newSupplyId, setNewSupplyId] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newUnit, setNewUnit] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const lines = pricing.lines as PricedResolvedLine[];
  const usedIds = useMemo(() => new Set(lines.map((line) => line.supplyId)), [lines]);
  const removedIds = useMemo(() => new Set(removed.map((item) => item.supplyId)), [removed]);
  const addable = supplies.filter((supply) => !supply.archived_at && !usedIds.has(supply.id) && isSupplyUnit(supply.unit));
  const selected = supplies.find((supply) => supply.id === newSupplyId) ?? null;
  const selectedUnit = selected && isSupplyUnit(selected.unit) ? selected.unit : null;
  const hasAdjustments = lines.some((line) => line.origin === "product" || line.adjusted) || removed.length > 0;

  const commitQuantity = (line: PricedResolvedLine, rawQuantity: string, unit: string) => {
    const validation = validateSupplyQuantity(rawQuantity, unit, line.supplyUnit);
    if (!validation.ok) {
      setLineErrors((current) => ({ ...current, [line.supplyId]: validation.error }));
      return;
    }
    setLineErrors((current) => {
      const next = { ...current };
      delete next[line.supplyId];
      return next;
    });
    onChange(setSupplyLineQuantity(adjustments, {
      supplyId: line.supplyId,
      origin: line.origin ?? "type",
      defaultQuantity: line.defaultQuantity,
      defaultUnit: line.defaultUnit,
      supplyUnit: line.supplyUnit,
    }, validation.quantity, validation.unit));
  };

  const addSupply = () => {
    if (!selected || !selectedUnit) {
      setAddError("Elegí un insumo del catálogo.");
      return;
    }
    const validation = validateSupplyQuantity(newQuantity, newUnit || selectedUnit, selectedUnit);
    if (!validation.ok) {
      setAddError(validation.error);
      return;
    }
    setAddError(null);
    onChange(addProductSupply(adjustments, selected.id, validation.quantity, validation.unit, removedIds.has(selected.id)));
    setNewSupplyId("");
    setNewQuantity("1");
    setNewUnit("");
  };

  return (
    <section
      className={`rounded-2xl border border-stampa-border bg-stampa-surface ${compact ? "p-3 sm:p-4" : "p-4 shadow-lg sm:p-6"}`}
      aria-labelledby="product-supplies-title"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="product-supplies-title" className={`flex items-center gap-2 font-bold text-fg ${compact ? "text-sm" : "text-lg"}`}>
            <Boxes size={compact ? 15 : 18} className="text-stampa-accent" aria-hidden="true" /> Componentes y embalaje
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">
            {productTypeName ? <>Parte de los componentes de «{productTypeName}». </> : null}
            Los cambios de cantidad, quitas o agregados valen solo para {scopeLabel}: no modifican el tipo ni otros productos.
          </p>
        </div>
        {onEditType && (
          <button
            type="button"
            onClick={onEditType}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-stampa-border bg-fg/5 px-3 text-xs font-semibold text-fg transition-colors hover:bg-fg/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
            title="Editar los componentes predeterminados del tipo"
          >
            <Settings2 size={15} aria-hidden="true" /> <span className="hidden min-[420px]:inline">Editar tipo</span>
          </button>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stampa-border p-3 text-center text-xs text-gray-400">
          {productTypeName ? `«${productTypeName}» no tiene componentes predeterminados.` : "Sin componentes."} Podés agregar insumos solo para {scopeLabel}.
        </p>
      ) : (
        <ul className="divide-y divide-stampa-border rounded-xl border border-stampa-border">
          {lines.map((line) => {
            const draft = drafts[line.supplyId];
            const quantityText = draft ?? String(Number(line.quantity));
            const isProduct = line.origin === "product";
            return (
              <li key={line.supplyId} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-fg">
                      {line.name}
                      {isProduct && <Badge tone="orange">Solo {scopeLabel}</Badge>}
                      {line.adjusted && <Badge tone="orange">Cantidad propia</Badge>}
                      {line.archived && <Badge>Archivado</Badge>}
                      {line.missing && <Badge>Ya no está en el catálogo</Badge>}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {line.category === "packaging" ? "Embalaje" : "Componente"} · {describeSupplyLine(line)}
                      {line.adjusted && line.defaultQuantity !== undefined && line.defaultUnit
                        ? ` · tipo: ${Number(line.defaultQuantity).toLocaleString("es-AR")} ${unitShortLabel(line.defaultUnit, line.customUnitLabel)}`
                        : ""}
                    </p>
                  </div>
                  <p className={`shrink-0 text-sm font-semibold ${line.valid && line.unitCost === 0 ? "text-amber-400" : "text-gray-200"}`}>
                    {!line.valid ? "Inválido" : line.unitCost === 0 ? "Sin costo" : money(line.cost)}
                  </p>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_auto] items-center gap-1.5 sm:grid-cols-[8rem_7rem_auto] sm:justify-start">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Cantidad de ${line.name} para ${scopeLabel}`}
                    value={quantityText}
                    disabled={line.missing}
                    onChange={(event) => {
                      const value = event.target.value.replace(/[^\d.,]/g, "");
                      setDrafts((current) => ({ ...current, [line.supplyId]: value }));
                      // Se aplica en vivo si es válido; si no, se espera a que termine de escribir.
                      if (validateSupplyQuantity(value, line.quantityUnit, line.supplyUnit).ok) commitQuantity(line, value, line.quantityUnit);
                    }}
                    onBlur={() => {
                      if (draft !== undefined) commitQuantity(line, draft, line.quantityUnit);
                      setDrafts((current) => {
                        const next = { ...current };
                        delete next[line.supplyId];
                        return next;
                      });
                    }}
                    className={fieldClass}
                  />
                  <CalculatorSelect
                    options={unitOptions(line.supplyUnit, line.customUnitLabel)}
                    value={line.quantityUnit}
                    onChange={(value) => commitQuantity(line, quantityText, value)}
                    searchable={false}
                    disabled={line.missing}
                    usePortal
                  />
                  <div className="flex gap-1.5">
                    {line.adjusted && (
                      <button
                        type="button"
                        onClick={() => onChange(restoreDefaultSupply(adjustments, line.supplyId))}
                        aria-label={`Volver a la cantidad del tipo para ${line.name}`}
                        title="Volver a la cantidad del tipo"
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-stampa-border text-gray-300 transition-colors hover:bg-fg/10"
                      >
                        <RotateCcw size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onChange(removeSupplyLine(adjustments, { supplyId: line.supplyId, origin: line.origin ?? "type" }))}
                      aria-label={`Quitar ${line.name} de ${scopeLabel}`}
                      title={`Quitar de ${scopeLabel}`}
                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/20 text-red-400 transition-colors hover:bg-red-500/10"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {lineErrors[line.supplyId] && <p role="alert" className="mt-1 text-[11px] text-red-400">{lineErrors[line.supplyId]}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {removed.length > 0 && (
        <div className="mt-2 rounded-lg border border-dashed border-stampa-border p-2.5 text-[11px] text-gray-400">
          <p className="mb-1 font-semibold text-gray-300">Quitados de {scopeLabel}</p>
          <ul className="flex flex-wrap gap-1.5">
            {removed.map((item) => (
              <li key={item.supplyId}>
                <button
                  type="button"
                  onClick={() => onChange(restoreDefaultSupply(adjustments, item.supplyId))}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-stampa-border px-2 font-semibold text-gray-300 hover:bg-fg/10"
                  aria-label={`Restaurar ${item.name}`}
                >
                  <RotateCcw size={12} aria-hidden="true" /> {item.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 space-y-2 rounded-lg border border-dashed border-fg/15 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-gray-400">Agregar insumo solo para {scopeLabel}</span>
          {onOpenCatalog && (
            <button type="button" onClick={onOpenCatalog} className="text-[11px] font-semibold text-stampa-accent hover:underline">
              Ir a Insumos →
            </button>
          )}
        </div>
        {addable.length === 0 ? (
          <p className="text-[11px] text-gray-500">
            {supplies.some((supply) => !supply.archived_at) ? "Ya usás todos tus insumos activos." : "Todavía no cargaste insumos en tu catálogo."}
          </p>
        ) : (
          <>
            <CalculatorSelect
              options={addable.map((supply) => ({
                value: supply.id,
                label: `${supply.name} · ${formatSupplyMoney(Number(supply.unit_cost) || 0, 4)} / ${isSupplyUnit(supply.unit) ? unitShortLabel(supply.unit, supply.custom_unit_label) : ""}`,
              }))}
              value={newSupplyId}
              onChange={(value) => {
                setNewSupplyId(value);
                setNewUnit(supplies.find((supply) => supply.id === value)?.unit ?? "");
                setAddError(null);
              }}
              placeholder="Elegí un insumo de tu catálogo…"
              searchable={addable.length > 6}
              usePortal
            />
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_auto] gap-1.5">
              <input
                type="text"
                inputMode="decimal"
                aria-label="Cantidad del insumo a agregar"
                value={newQuantity}
                onChange={(event) => setNewQuantity(event.target.value.replace(/[^\d.,]/g, ""))}
                className={fieldClass}
                disabled={!selected}
              />
              <CalculatorSelect
                options={selectedUnit ? unitOptions(selectedUnit, selected?.custom_unit_label) : []}
                value={newUnit}
                onChange={setNewUnit}
                searchable={false}
                disabled={!selected}
                placeholder="Unidad"
                usePortal
              />
              <button
                type="button"
                onClick={addSupply}
                disabled={!selected}
                className="inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-stampa-orange px-3 text-xs font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:opacity-40"
              >
                <Plus size={14} aria-hidden="true" /> Agregar
              </button>
            </div>
          </>
        )}
        {addError && <p role="alert" className="text-[11px] text-red-400">{addError}</p>}
      </div>

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
        Se suman a su costo real, sin markup.{" "}
        {contingencyPercent > 0
          ? `Tus contingencias del ${contingencyPercent.toLocaleString("es-AR", { maximumFractionDigits: 2 })} % se suman aparte, sobre los insumos.`
          : "Las contingencias sobre insumos son opcionales (hoy 0 %, se configuran en Ajustes)."}
        {hasAdjustments ? " Hay ajustes propios: se guardan con el producto." : ""}
      </p>
    </section>
  );
}

function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "orange" }) {
  return (
    <span
      className={`ml-2 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase ${tone === "orange" ? "bg-stampa-orange/15 text-stampa-accent" : "bg-fg/10 text-gray-400"}`}
    >
      {children}
    </span>
  );
}
