"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Boxes, Check, Loader2, Package, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { Dialog } from "@/components/ui/dialog";
import { CalculatorSelect } from "@/components/ui/calculator-select";
import { InfoTip } from "@/components/ui/info-tip";
import { useAppFeedback } from "@/components/ui/app-feedback";
import {
  SUPPLY_UNIT_INFO,
  buildProductTypeSupplyLines,
  compatibleUnits,
  formatSupplyMoney,
  formatUnitCost,
  isSupplyUnit,
  priceSupplyLines,
  unitShortLabel,
  validateSupplyQuantity,
  type CalculatorSupplyRecord,
  type ProductTypeSupplyRecord,
  type SupplyUnit,
} from "@/lib/calculator/supplies";
import { PRODUCT_TYPE_SUPPLY_COLUMNS, supplyErrorMessage } from "@/lib/calculator/supplies-data";

interface ProductTypeSuppliesDialogProps {
  open: boolean;
  /** Cierra el modal (ya confirmado si había cambios sin guardar). */
  onClose: () => void;
  productTypeId: string;
  productTypeName: string;
  /** "Insumos extra" (monto fijo) del tipo, para advertir una posible doble contabilización. */
  legacyFixedCost: number;
  userId: string;
  supplies: CalculatorSupplyRecord[];
  associations: ProductTypeSupplyRecord[];
  onAssociationsChange: (next: ProductTypeSupplyRecord[]) => void;
  onClearLegacyFixedCost?: () => Promise<void> | void;
  /** Lleva al catálogo de insumos (el modal se cierra antes). */
  onOpenCatalog?: () => void;
}

const fieldClass =
  "h-10 w-full min-w-0 rounded-lg border border-fg/10 bg-fg/[0.06] px-2.5 text-base sm:text-sm text-fg outline-none transition focus:border-[#ff6a00]/60 focus:ring-2 focus:ring-[#ff6a00]/10 disabled:opacity-50";

function unitOptions(unit: SupplyUnit, customLabel?: string | null) {
  return compatibleUnits(unit).map((candidate) => ({
    value: candidate,
    label: candidate === "custom" ? unitShortLabel(candidate, customLabel) : `${SUPPLY_UNIT_INFO[candidate].label} (${SUPPLY_UNIT_INFO[candidate].short})`,
  }));
}

/**
 * «Componentes y embalaje» de UN tipo de producto, en un modal (UX-01A). Cada operación se guarda al momento
 * (agregar, guardar cantidad ✓, quitar), igual que antes: no hay botón «Guardar» general. Si quedan cantidades
 * editadas sin confirmar o un agregado a medio cargar, cerrar pide confirmación.
 * El costo se lee siempre del catálogo personal: si cambia el precio de un insumo, cambia aquí y en la calculadora.
 */
export function ProductTypeSuppliesDialog({
  open,
  onClose,
  productTypeId,
  productTypeName,
  legacyFixedCost,
  userId,
  supplies,
  associations,
  onAssociationsChange,
  onClearLegacyFixedCost,
  onOpenCatalog,
}: ProductTypeSuppliesDialogProps) {
  const [supabase] = useState(() => createClient());
  const { toast, confirmAction } = useAppFeedback();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { quantity: string; unit: string }>>({});
  const [adding, setAdding] = useState(false);
  const [newSupplyId, setNewSupplyId] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newUnit, setNewUnit] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const addFormRef = useRef<HTMLDivElement>(null);
  const confirmingRef = useRef(false);

  const typeAssociations = useMemo(
    () => associations
      .filter((association) => association.product_type_id === productTypeId)
      .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)),
    [associations, productTypeId],
  );
  const suppliesById = useMemo(() => new Map(supplies.map((supply) => [supply.id, supply])), [supplies]);
  const pricing = useMemo(
    () => priceSupplyLines(buildProductTypeSupplyLines(productTypeId, associations, supplies)),
    [associations, productTypeId, supplies],
  );
  const pricedBySupply = useMemo(() => new Map(pricing.lines.map((line) => [line.supplyId, line])), [pricing]);

  const usedSupplyIds = new Set(typeAssociations.map((association) => association.supply_id));
  const activeSupplies = supplies.filter((supply) => !supply.archived_at);
  const addable = activeSupplies.filter((supply) => !usedSupplyIds.has(supply.id));
  const selectedNewSupply = suppliesById.get(newSupplyId) ?? null;
  const selectedNewUnit: SupplyUnit | null = selectedNewSupply && isSupplyUnit(selectedNewSupply.unit) ? selectedNewSupply.unit : null;

  const rows = typeAssociations
    .map((association) => ({ association, supply: suppliesById.get(association.supply_id) }))
    .filter((row): row is { association: ProductTypeSupplyRecord; supply: CalculatorSupplyRecord } => Boolean(row.supply && isSupplyUnit(row.supply.unit)));
  const componentRows = rows.filter((row) => row.supply.category !== "packaging");
  const packagingRows = rows.filter((row) => row.supply.category === "packaging");

  const hasUnsavedChanges = Object.keys(drafts).length > 0 || (adding && Boolean(newSupplyId));

  const resetAddForm = () => {
    setAdding(false);
    setNewSupplyId("");
    setNewQuantity("1");
    setNewUnit("");
  };

  const finishClose = useCallback(() => {
    setDrafts({});
    setAdding(false);
    setNewSupplyId("");
    setNewQuantity("1");
    setNewUnit("");
    setError(null);
    onClose();
  }, [onClose]);

  /** Cierre con Escape, ✕, fondo o «Ir a Insumos»: si hay cambios sin guardar, se confirma antes. */
  const requestClose = useCallback(async (): Promise<boolean> => {
    if (confirmingRef.current) return false;
    if (hasUnsavedChanges) {
      confirmingRef.current = true;
      const discard = await confirmAction({
        title: "Cambios sin guardar",
        description: "Hay cantidades o un componente sin guardar. ¿Cerrar igual?",
        confirmLabel: "Descartar y cerrar",
        destructive: true,
      });
      confirmingRef.current = false;
      if (!discard) return false;
    }
    finishClose();
    return true;
  }, [confirmAction, finishClose, hasUnsavedChanges]);

  const goToCatalog = async () => {
    if (!onOpenCatalog) return;
    if (await requestClose()) {
      // Después de que el diálogo devuelva el foco a su botón: el catálogo se lleva el foco y el scroll.
      window.setTimeout(onOpenCatalog, 60);
    }
  };

  useEffect(() => {
    if (!adding) return;
    const frame = window.requestAnimationFrame(() => {
      addFormRef.current?.querySelector<HTMLElement>("button, input")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [adding]);

  const chooseNewSupply = (supplyId: string) => {
    setNewSupplyId(supplyId);
    const supply = suppliesById.get(supplyId);
    setNewUnit(supply?.unit ?? "");
    setError(null);
  };

  const addSupply = async () => {
    if (!selectedNewSupply || !selectedNewUnit) {
      setError("Elegí un insumo del catálogo.");
      return;
    }
    const validation = validateSupplyQuantity(newQuantity, newUnit || selectedNewUnit, selectedNewUnit);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setBusyId("new");
    setError(null);
    const nextOrder = typeAssociations.reduce((max, association) => Math.max(max, Number(association.sort_order) || 0), 0) + 1;
    const { data, error: insertError } = await supabase
      .from("calculator_product_type_supplies")
      .insert([{
        user_id: userId,
        product_type_id: productTypeId,
        supply_id: selectedNewSupply.id,
        quantity: validation.quantity,
        quantity_unit: validation.unit,
        sort_order: nextOrder,
      }])
      .select(PRODUCT_TYPE_SUPPLY_COLUMNS)
      .single();
    setBusyId(null);
    if (insertError || !data) {
      setError(supplyErrorMessage(insertError));
      return;
    }
    onAssociationsChange([...associations, data as ProductTypeSupplyRecord]);
    resetAddForm();
  };

  const saveQuantity = async (association: ProductTypeSupplyRecord) => {
    const draft = drafts[association.id];
    const supply = suppliesById.get(association.supply_id);
    if (!draft || !supply || !isSupplyUnit(supply.unit)) return;
    const validation = validateSupplyQuantity(draft.quantity, draft.unit, supply.unit);
    if (!validation.ok) {
      setError(`${supply.name}: ${validation.error}`);
      return;
    }
    setBusyId(association.id);
    setError(null);
    const { data, error: updateError } = await supabase
      .from("calculator_product_type_supplies")
      .update({ quantity: validation.quantity, quantity_unit: validation.unit })
      .eq("id", association.id)
      .select(PRODUCT_TYPE_SUPPLY_COLUMNS)
      .single();
    setBusyId(null);
    if (updateError || !data) {
      setError(supplyErrorMessage(updateError));
      return;
    }
    onAssociationsChange(associations.map((item) => (item.id === association.id ? data as ProductTypeSupplyRecord : item)));
    setDrafts((current) => {
      const next = { ...current };
      delete next[association.id];
      return next;
    });
  };

  const removeAssociation = async (association: ProductTypeSupplyRecord) => {
    setBusyId(association.id);
    setError(null);
    const { error: deleteError } = await supabase.from("calculator_product_type_supplies").delete().eq("id", association.id);
    setBusyId(null);
    if (deleteError) {
      setError(supplyErrorMessage(deleteError));
      return;
    }
    onAssociationsChange(associations.filter((item) => item.id !== association.id));
    setDrafts((current) => {
      const next = { ...current };
      delete next[association.id];
      return next;
    });
    toast.info("Componente quitado del tipo.");
  };

  const renderRow = ({ association, supply }: { association: ProductTypeSupplyRecord; supply: CalculatorSupplyRecord }) => {
    const unit = supply.unit as SupplyUnit;
    const priced = pricedBySupply.get(association.supply_id);
    const draft = drafts[association.id] ?? { quantity: String(Number(association.quantity)), unit: association.quantity_unit };
    const dirty = Boolean(drafts[association.id]);
    const busy = busyId === association.id;
    const unitCost = Number(supply.unit_cost) || 0;
    const setDraft = (patch: Partial<{ quantity: string; unit: string }>) =>
      setDrafts((current) => ({ ...current, [association.id]: { ...draft, ...patch } }));
    return (
      <li
        key={association.id}
        className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_9.5rem_6.5rem_5.25rem] sm:items-center ${dirty ? "bg-stampa-orange/[0.06]" : ""}`}
      >
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-fg">
            {supply.name}
            {supply.archived_at && <span className="ml-2 rounded bg-fg/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase text-gray-400">Archivado</span>}
          </p>
          <p className={`text-xs ${unitCost === 0 ? "text-amber-400" : "text-gray-500"}`}>
            {unitCost === 0 ? "Sin costo cargado" : formatUnitCost(unitCost, unit, supply.custom_unit_label)}
          </p>
        </div>
        <p className="text-right text-sm font-bold tabular-nums text-gray-100 sm:order-last sm:hidden">{formatSupplyMoney(priced?.cost ?? 0)}</p>
        <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-1.5 sm:contents">
          <input
            type="text"
            inputMode="decimal"
            aria-label={`Cantidad de ${supply.name}`}
            value={draft.quantity}
            onChange={(event) => setDraft({ quantity: event.target.value.replace(/[^\d.,]/g, "") })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && dirty) {
                event.preventDefault();
                void saveQuantity(association);
              }
            }}
            className={fieldClass}
          />
          <CalculatorSelect
            options={unitOptions(unit, supply.custom_unit_label)}
            value={draft.unit}
            onChange={(value) => setDraft({ unit: value })}
            searchable={false}
            usePortal
          />
          <p className="hidden text-right text-sm font-bold tabular-nums text-gray-100 sm:block">{formatSupplyMoney(priced?.cost ?? 0)}</p>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => void saveQuantity(association)}
              disabled={!dirty || busy}
              aria-label={`Guardar cantidad de ${supply.name}`}
              title="Guardar cantidad"
              className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors disabled:opacity-30 ${dirty ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" : "border-stampa-border text-gray-500"}`}
            >
              {busy && dirty ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />}
            </button>
            <button
              type="button"
              onClick={() => void removeAssociation(association)}
              disabled={busy}
              aria-label={`Quitar ${supply.name}`}
              title="Quitar del tipo"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/20 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-30"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </li>
    );
  };

  const renderGroup = (label: string, Icon: typeof Boxes, groupRows: typeof rows, subtotal: number, dot: string) => (
    groupRows.length > 0 && (
      <section aria-label={label} className="overflow-hidden rounded-xl border border-stampa-border">
        <header className="flex items-center justify-between gap-2 bg-fg/[0.04] px-3 py-2">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
            <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
            <Icon size={14} aria-hidden="true" /> {label} <span className="font-semibold text-gray-500">({groupRows.length})</span>
          </h3>
          <span className="text-xs font-semibold tabular-nums text-gray-300">{formatSupplyMoney(subtotal)}</span>
        </header>
        <div className="hidden grid-cols-[minmax(0,1fr)_5.5rem_9.5rem_6.5rem_5.25rem] gap-x-3 border-t border-stampa-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 sm:grid" aria-hidden="true">
          <span>Insumo</span><span>Cantidad</span><span>Unidad</span><span className="text-right">Subtotal</span><span />
        </div>
        <ul className="divide-y divide-stampa-border border-t border-stampa-border">{groupRows.map(renderRow)}</ul>
      </section>
    )
  );

  const catalogLink = onOpenCatalog && (
    <button type="button" onClick={() => void goToCatalog()} className="inline-flex min-h-9 items-center text-xs font-semibold text-stampa-accent hover:underline">
      Ir a Insumos →
    </button>
  );

  return (
    <Dialog
      open={open}
      onClose={() => void requestClose()}
      labelledBy="type-supplies-title"
      fullScreenOnMobile
      panelClassName="flex flex-col bg-stampa-surface sm:max-h-[min(52rem,100%)] sm:max-w-[920px] sm:rounded-2xl sm:border sm:border-stampa-border"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-stampa-border bg-stampa-surface px-4 pb-3 pt-[max(0.875rem,env(safe-area-inset-top))] sm:px-5 sm:pt-4">
        <div className="min-w-0">
          <h2 id="type-supplies-title" className="flex items-center gap-2 text-base font-bold text-fg">
            <Boxes size={17} className="shrink-0 text-stampa-accent" aria-hidden="true" /> Componentes y embalaje
            <InfoTip label="Cómo se usan los componentes">
              Cantidades por unidad de producto. El costo sale de tu catálogo de insumos y se suma a su valor real, sin markup. Las contingencias opcionales se configuran en Ajustes.
            </InfoTip>
          </h2>
          <p className="mt-0.5 truncate text-sm text-gray-400" title={productTypeName}>{productTypeName}</p>
        </div>
        <button
          type="button"
          onClick={() => void requestClose()}
          aria-label="Cerrar componentes y embalaje"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-fg/10 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-3 px-4 py-4 sm:px-5">
        {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 text-xs text-red-400">{error}</p>}

        {rows.length > 0 && legacyFixedCost > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5 text-xs text-amber-200 sm:flex-row sm:items-center">
            <AlertTriangle size={14} className="shrink-0 text-amber-400" aria-hidden="true" />
            <p className="flex-1">
              Este tipo también suma {formatSupplyMoney(legacyFixedCost)} de «Insumos extra». Si ya cubrían estos componentes, ponelo en $0 para no contarlos dos veces.
            </p>
            {onClearLegacyFixedCost && (
              <button type="button" onClick={() => void onClearLegacyFixedCost()} className="min-h-9 shrink-0 rounded-lg border border-amber-500/30 px-2.5 font-semibold text-amber-200 hover:bg-amber-500/10">
                Poner en $0
              </button>
            )}
          </div>
        )}

        {rows.length === 0 && !adding ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-stampa-border px-4 py-8 text-center">
            <p className="text-sm font-semibold text-gray-300">Sin componentes</p>
            {activeSupplies.length > 0 ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-stampa-orange px-4 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover"
              >
                <Plus size={15} aria-hidden="true" /> Agregar componente
              </button>
            ) : (
              <>
                <p className="text-xs text-gray-500">Tu catálogo de insumos está vacío.</p>
                {catalogLink}
              </>
            )}
          </div>
        ) : (
          <>
            {renderGroup("Componentes", Boxes, componentRows, pricing.componentsCost, "bg-amber-300")}
            {renderGroup("Embalaje", Package, packagingRows, pricing.packagingCost, "bg-sky-400")}
          </>
        )}

        {adding && (
          <div ref={addFormRef} className="space-y-2 rounded-xl border border-stampa-orange/30 bg-stampa-orange/[0.04] p-3" role="group" aria-label="Agregar componente">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-gray-300">Agregar componente</span>
              {catalogLink}
            </div>
            {addable.length === 0 ? (
              <p className="text-xs text-gray-500">Ya agregaste todos tus insumos activos.</p>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_9.5rem_auto]">
                <CalculatorSelect
                  options={addable.map((supply) => ({
                    value: supply.id,
                    label: `${supply.name} · ${formatSupplyMoney(Number(supply.unit_cost) || 0, 4)} / ${isSupplyUnit(supply.unit) ? unitShortLabel(supply.unit, supply.custom_unit_label) : ""}`,
                  }))}
                  value={newSupplyId}
                  onChange={chooseNewSupply}
                  placeholder="Elegí un insumo…"
                  searchable={addable.length > 6}
                  usePortal
                />
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-1.5 sm:contents">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Cantidad"
                    value={newQuantity}
                    onChange={(event) => setNewQuantity(event.target.value.replace(/[^\d.,]/g, ""))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void addSupply();
                      }
                    }}
                    className={fieldClass}
                    disabled={!selectedNewSupply}
                  />
                  <CalculatorSelect
                    options={selectedNewUnit ? unitOptions(selectedNewUnit, selectedNewSupply?.custom_unit_label) : []}
                    value={newUnit}
                    onChange={setNewUnit}
                    searchable={false}
                    disabled={!selectedNewSupply}
                    placeholder="Unidad"
                    usePortal
                  />
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={resetAddForm}
                    className="inline-flex h-10 flex-1 items-center justify-center rounded-lg px-3 text-xs font-semibold text-gray-400 transition-colors hover:bg-fg/5 hover:text-fg sm:flex-none"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void addSupply()}
                    disabled={!selectedNewSupply || busyId === "new"}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-stampa-orange px-3 text-xs font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:opacity-40 sm:flex-none"
                  >
                    {busyId === "new" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} aria-hidden="true" />} Agregar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-stampa-border bg-stampa-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pb-3">
        <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-gray-500">Componentes</dt>
            <dd className="font-semibold tabular-nums text-gray-200">{formatSupplyMoney(pricing.componentsCost)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-gray-500">Embalaje</dt>
            <dd className="font-semibold tabular-nums text-gray-200">{formatSupplyMoney(pricing.packagingCost)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="font-semibold text-gray-300">Total</dt>
            <dd className="text-base font-black tabular-nums text-stampa-accent">{formatSupplyMoney(pricing.total)}</dd>
          </div>
        </dl>
        {rows.length > 0 && !adding && activeSupplies.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-stampa-orange/40 px-4 text-sm font-semibold text-stampa-accent transition-colors hover:bg-stampa-orange/10"
          >
            <Plus size={15} aria-hidden="true" /> Agregar componente
          </button>
        )}
      </div>
    </Dialog>
  );
}
