"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { CalculatorSelect } from "@/components/ui/calculator-select";
import { useAppFeedback } from "@/components/ui/app-feedback";
import {
  SUPPLY_UNIT_INFO,
  buildProductTypeSupplyLines,
  compatibleUnits,
  describeSupplyLine,
  formatSupplyMoney,
  isSupplyUnit,
  priceSupplyLines,
  unitShortLabel,
  validateSupplyQuantity,
  type CalculatorSupplyRecord,
  type ProductTypeSupplyRecord,
  type SupplyUnit,
} from "@/lib/calculator/supplies";
import { PRODUCT_TYPE_SUPPLY_COLUMNS, supplyErrorMessage } from "@/lib/calculator/supplies-data";

interface ProductTypeSuppliesEditorProps {
  productTypeId: string;
  productTypeName: string;
  /** "Insumos extra" (monto fijo) del tipo, para advertir una posible doble contabilización. */
  legacyFixedCost: number;
  userId: string;
  supplies: CalculatorSupplyRecord[];
  associations: ProductTypeSupplyRecord[];
  onAssociationsChange: (next: ProductTypeSupplyRecord[]) => void;
  onClearLegacyFixedCost?: () => Promise<void> | void;
  onOpenCatalog?: () => void;
}

const fieldClass =
  "h-10 w-full rounded-lg border border-fg/10 bg-fg/[0.06] px-2.5 text-base sm:text-sm text-fg outline-none transition focus:border-[#ff6a00]/60 focus:ring-2 focus:ring-[#ff6a00]/10";

function unitOptions(unit: SupplyUnit, customLabel?: string | null) {
  return compatibleUnits(unit).map((candidate) => ({
    value: candidate,
    label: candidate === "custom" ? unitShortLabel(candidate, customLabel) : `${SUPPLY_UNIT_INFO[candidate].label} (${SUPPLY_UNIT_INFO[candidate].short})`,
  }));
}

/**
 * Componentes y embalaje de UN tipo de producto del usuario. Las asociaciones guardan cantidad y unidad;
 * el costo se lee siempre del catálogo personal (si cambia el precio de un insumo, cambia aquí y en la calculadora).
 */
export function ProductTypeSuppliesEditor({
  productTypeId,
  productTypeName,
  legacyFixedCost,
  userId,
  supplies,
  associations,
  onAssociationsChange,
  onClearLegacyFixedCost,
  onOpenCatalog,
}: ProductTypeSuppliesEditorProps) {
  const [supabase] = useState(() => createClient());
  const { toast } = useAppFeedback();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { quantity: string; unit: string }>>({});
  const [newSupplyId, setNewSupplyId] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newUnit, setNewUnit] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

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
  const addable = supplies.filter((supply) => !supply.archived_at && !usedSupplyIds.has(supply.id));
  const selectedNewSupply = suppliesById.get(newSupplyId) ?? null;
  const selectedNewUnit: SupplyUnit | null = selectedNewSupply && isSupplyUnit(selectedNewSupply.unit) ? selectedNewSupply.unit : null;

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
    setNewSupplyId("");
    setNewQuantity("1");
    setNewUnit("");
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
    toast.info("Insumo quitado del tipo de producto.");
  };

  return (
    <div className="space-y-3 rounded-xl border border-stampa-border bg-stampa-bg-soft/60 p-3 sm:p-4">
      <div>
        <h5 className="text-sm font-bold text-fg">Componentes y embalaje de «{productTypeName}»</h5>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          Cantidades por unidad de producto. El costo sale de tu catálogo de insumos; como los insumos extra, recibe el recargo del 30 % y no el markup.
        </p>
      </div>

      {typeAssociations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stampa-border p-3 text-center text-xs text-gray-400">
          Este tipo todavía no tiene componentes. Agregá el primero abajo.
        </p>
      ) : (
        <ul className="space-y-2">
          {typeAssociations.map((association) => {
            const supply = suppliesById.get(association.supply_id);
            const priced = pricedBySupply.get(association.supply_id);
            if (!supply || !isSupplyUnit(supply.unit)) return null;
            const draft = drafts[association.id] ?? { quantity: String(Number(association.quantity)), unit: association.quantity_unit };
            const dirty = Boolean(drafts[association.id]);
            const busy = busyId === association.id;
            return (
              <li key={association.id} className="rounded-lg border border-stampa-border bg-stampa-surface p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-fg">
                      {supply.name}
                      {supply.archived_at && <span className="ml-2 rounded bg-fg/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-400">Archivado</span>}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {supply.category === "packaging" ? "Embalaje" : "Componente"}
                      {priced ? ` · ${describeSupplyLine(priced)}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-gray-200">{formatSupplyMoney(priced?.cost ?? 0)}</p>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem_2.5rem] items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Cantidad de ${supply.name}`}
                    value={draft.quantity}
                    onChange={(event) => setDrafts((current) => ({ ...current, [association.id]: { ...draft, quantity: event.target.value.replace(/[^\d.,]/g, "") } }))}
                    className={fieldClass}
                  />
                  <CalculatorSelect
                    options={unitOptions(supply.unit, supply.custom_unit_label)}
                    value={draft.unit}
                    onChange={(value) => setDrafts((current) => ({ ...current, [association.id]: { ...draft, unit: value } }))}
                    searchable={false}
                    usePortal
                  />
                  <button
                    type="button"
                    onClick={() => void saveQuantity(association)}
                    disabled={!dirty || busy}
                    aria-label={`Guardar cantidad de ${supply.name}`}
                    title="Guardar cantidad"
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-stampa-border text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-30"
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
              </li>
            );
          })}
        </ul>
      )}

      {supplies.filter((supply) => !supply.archived_at).length === 0 ? (
        <div className="rounded-lg border border-dashed border-stampa-orange/30 bg-stampa-orange/5 p-3 text-xs text-gray-300">
          Primero cargá tus insumos (focos, cables, cajas…) en el catálogo.
          {onOpenCatalog && (
            <button type="button" onClick={onOpenCatalog} className="ml-1 font-semibold text-stampa-accent hover:underline">Ir a Insumos →</button>
          )}
        </div>
      ) : addable.length === 0 ? (
        <p className="text-[11px] text-gray-500">Ya agregaste todos tus insumos activos a este tipo.</p>
      ) : (
        <div className="space-y-2 rounded-lg border border-dashed border-fg/15 p-2.5">
          <span className="block text-xs font-semibold text-gray-400">Agregar insumo</span>
          <CalculatorSelect
            options={addable.map((supply) => ({
              value: supply.id,
              label: `${supply.name} · ${formatSupplyMoney(Number(supply.unit_cost) || 0, 4)} / ${isSupplyUnit(supply.unit) ? unitShortLabel(supply.unit, supply.custom_unit_label) : ""}`,
            }))}
            value={newSupplyId}
            onChange={chooseNewSupply}
            placeholder="Elegí un insumo de tu catálogo…"
            searchable={addable.length > 6}
            usePortal
          />
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              aria-label="Cantidad"
              value={newQuantity}
              onChange={(event) => setNewQuantity(event.target.value.replace(/[^\d.,]/g, ""))}
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
            <button
              type="button"
              onClick={() => void addSupply()}
              disabled={!selectedNewSupply || busyId === "new"}
              className="inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-stampa-orange px-3 text-xs font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:opacity-40"
            >
              {busyId === "new" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Agregar
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-400">{error}</p>}

      {typeAssociations.length > 0 && legacyFixedCost > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5 text-[11px] text-amber-200 sm:flex-row sm:items-center">
          <AlertTriangle size={14} className="shrink-0 text-amber-400" aria-hidden="true" />
          <p className="flex-1">
            Este tipo también suma {formatSupplyMoney(legacyFixedCost)} de «Insumos extra». Si ese monto ya cubría estos componentes o el embalaje, ponelo en $0 para no contarlos dos veces.
          </p>
          {onClearLegacyFixedCost && (
            <button type="button" onClick={() => void onClearLegacyFixedCost()} className="min-h-9 shrink-0 rounded-lg border border-amber-500/30 px-2.5 font-semibold text-amber-200 hover:bg-amber-500/10">
              Poner en $0
            </button>
          )}
        </div>
      )}

      <dl className="grid grid-cols-3 gap-2 border-t border-stampa-border pt-3 text-center">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Componentes</dt>
          <dd className="text-sm font-bold text-fg">{formatSupplyMoney(pricing.componentsCost)}</dd>
        </div>
        <div className="border-x border-stampa-border">
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Embalaje</dt>
          <dd className="text-sm font-bold text-fg">{formatSupplyMoney(pricing.packagingCost)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Total</dt>
          <dd className="text-sm font-bold text-stampa-accent">{formatSupplyMoney(pricing.total)}</dd>
        </div>
      </dl>
    </div>
  );
}
