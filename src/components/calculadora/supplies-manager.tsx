"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Boxes, Edit2, Loader2, Package, Plus, Save, Search, Trash2, X } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { CalculatorSelect } from "@/components/ui/calculator-select";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/page-skeletons";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { useSaveGuard } from "@/lib/forms/use-save-guard";
import {
  SUPPLY_CATEGORY_LABELS,
  SUPPLY_UNITS,
  SUPPLY_UNIT_INFO,
  formatUnitCost,
  isSupplyUnit,
  unitShortLabel,
  validateSupplyDraft,
  type CalculatorSupplyRecord,
  type SupplyCategory,
  type SupplyDraft,
} from "@/lib/calculator/supplies";
import { loadCalculatorSupplies, supplyErrorMessage } from "@/lib/calculator/supplies-data";
import { notifyCalculatorSuppliesChanged, subscribeCalculatorSuppliesChanged } from "@/lib/calculator/supplies-events";

interface SuppliesManagerProps {
  /** Se llama después de cada cambio guardado (alta, edición, archivo, baja). */
  onChanged?: () => void;
}

type StatusFilter = "active" | "archived";
type CategoryFilter = "all" | SupplyCategory;

const EMPTY_DRAFT: SupplyDraft = { name: "", category: "component", unit: "unit", customUnitLabel: "", unitCost: "" };

const inputClass =
  "h-11 w-full rounded-xl border border-fg/10 bg-fg/[0.06] px-3 text-base sm:text-sm text-fg placeholder:text-neutral-500 outline-none transition focus:border-[#ff6a00]/60 focus:ring-2 focus:ring-[#ff6a00]/10";

const UNIT_OPTIONS = SUPPLY_UNITS.map((unit) => ({ value: unit, label: SUPPLY_UNIT_INFO[unit].label }));

/**
 * Catálogo personal de insumos (componentes y embalaje) de la Calculadora.
 * Cada usuario administra los suyos (RLS); cambiar un costo actualiza todos los cálculos futuros que lo usan.
 */
export function SuppliesManager({ onChanged }: SuppliesManagerProps = {}) {
  const [supabase] = useState(() => createClient());
  const { confirmAction, toast } = useAppFeedback();
  const { saving, runSave } = useSaveGuard();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [supplies, setSupplies] = useState<CalculatorSupplyRecord[]>([]);
  const [usage, setUsage] = useState<Map<string, number>>(new Map());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SupplyDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Identidad de este panel para el aviso de cambios (D059): no se recarga con sus propios avisos.
  const [syncSource] = useState(() => `supplies-manager-${Math.random().toString(36).slice(2)}`);

  const reload = useCallback(async (isCancelled: () => boolean = () => false) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (isCancelled()) return;
    if (!user) {
      setLoading(false);
      return;
    }
    const data = await loadCalculatorSupplies(supabase, user.id);
    if (isCancelled()) return;
    setUserId(user.id);
    setAvailable(data.available);
    setSupplies(data.supplies);
    const counts = new Map<string, number>();
    for (const association of data.associations) {
      counts.set(association.supply_id, (counts.get(association.supply_id) ?? 0) + 1);
    }
    setUsage(counts);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    // Carga inicial diferida a una microtarea (el estado se actualiza al llegar los datos, no dentro del efecto).
    void Promise.resolve().then(() => reload(() => cancelled));
    // Otro panel (tipos de producto, otra pestaña del modal) cambió insumos o componentes: se recarga.
    const unsubscribe = subscribeCalculatorSuppliesChanged(() => void reload(() => cancelled), syncSource);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [reload, syncSource]);

  // «Ir a Insumos» desde Mi Taller llega con #catalogo-insumos: se lleva la vista al catálogo una vez cargado.
  useEffect(() => {
    if (loading || typeof window === "undefined" || window.location.hash !== "#catalogo-insumos") return;
    document.getElementById("catalogo-insumos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading]);

  const announceChange = () => {
    notifyCalculatorSuppliesChanged(syncSource);
    onChanged?.();
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    return supplies.filter((supply) => {
      if ((status === "archived") !== Boolean(supply.archived_at)) return false;
      if (category !== "all" && supply.category !== category) return false;
      return !needle || supply.name.toLocaleLowerCase("es").includes(needle);
    });
  }, [supplies, query, status, category]);

  const activeCount = supplies.filter((supply) => !supply.archived_at).length;
  const archivedCount = supplies.length - activeCount;

  const startCreate = () => {
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setFormError(null);
    setEditingId("new");
  };

  const startEdit = (supply: CalculatorSupplyRecord) => {
    setDraft({
      name: supply.name,
      category: supply.category,
      unit: supply.unit,
      customUnitLabel: supply.custom_unit_label ?? "",
      unitCost: String(Number(supply.unit_cost)),
    });
    setErrors({});
    setFormError(null);
    setEditingId(supply.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setErrors({});
    setFormError(null);
  };

  const save = () => runSave(async () => {
    const validation = validateSupplyDraft(draft);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    if (editingId === "new") {
      // user_id lo completa la base con auth.uid(); la RLS rechaza cualquier otro valor.
      const { data, error } = await supabase
        .from("calculator_supplies")
        .insert([{ ...validation.value, user_id: userId }])
        .select("id, name, category, unit, custom_unit_label, unit_cost, archived_at")
        .single();
      if (error || !data) {
        setFormError(supplyErrorMessage(error));
        return;
      }
      setSupplies((current) => [...current, data as CalculatorSupplyRecord].sort((a, b) => a.name.localeCompare(b.name, "es")));
      toast.success("Insumo agregado.");
    } else if (editingId) {
      const { data, error } = await supabase
        .from("calculator_supplies")
        .update(validation.value)
        .eq("id", editingId)
        .select("id, name, category, unit, custom_unit_label, unit_cost, archived_at")
        .single();
      if (error || !data) {
        setFormError(supplyErrorMessage(error));
        return;
      }
      setSupplies((current) => current.map((supply) => (supply.id === editingId ? data as CalculatorSupplyRecord : supply)));
      toast.success("Insumo actualizado. Los cálculos que lo usan ya toman el nuevo valor.");
    }
    setEditingId(null);
    announceChange();
  });

  const setArchived = async (supply: CalculatorSupplyRecord, archive: boolean) => {
    const uses = usage.get(supply.id) ?? 0;
    if (archive && uses > 0) {
      const confirmed = await confirmAction({
        title: "Archivar insumo",
        description: `«${supply.name}» está en ${uses === 1 ? "1 tipo de producto" : `${uses} tipos de producto`}. Se va a seguir contando con su último costo hasta que lo quites de esos tipos.`,
        confirmLabel: "Archivar",
      });
      if (!confirmed) return;
    }
    const { data, error } = await supabase
      .from("calculator_supplies")
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq("id", supply.id)
      .select("id, name, category, unit, custom_unit_label, unit_cost, archived_at")
      .single();
    if (error || !data) {
      toast.error(supplyErrorMessage(error));
      return;
    }
    setSupplies((current) => current.map((item) => (item.id === supply.id ? data as CalculatorSupplyRecord : item)));
    toast.success(archive ? "Insumo archivado." : "Insumo reactivado.");
    announceChange();
  };

  const remove = async (supply: CalculatorSupplyRecord) => {
    const confirmed = await confirmAction({
      title: "Eliminar insumo",
      description: `¿Eliminar «${supply.name}» de tu catálogo? Los productos ya guardados conservan el costo con el que se calcularon.`,
      confirmLabel: "Eliminar",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await supabase.from("calculator_supplies").delete().eq("id", supply.id);
    if (error) {
      toast.error(supplyErrorMessage(error));
      return;
    }
    setSupplies((current) => current.filter((item) => item.id !== supply.id));
    toast.success("Insumo eliminado.");
    announceChange();
  };

  if (loading) return <TableSkeleton rows={4} columns={3} />;

  if (!available) {
    return (
      <div id="catalogo-insumos" className="scroll-mt-24 rounded-xl border border-dashed border-stampa-border p-4 text-sm text-gray-400">
        El catálogo de insumos todavía no está disponible en tu cuenta. La calculadora sigue funcionando como siempre.
      </div>
    );
  }

  return (
    <div id="catalogo-insumos" className="scroll-mt-24 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-fg">Mis insumos</h3>
          <p className="text-xs text-gray-400">Componentes y embalajes con su costo. Si cambia un precio, lo actualizás acá una sola vez.</p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-stampa-orange px-4 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
        >
          <Plus size={16} aria-hidden="true" /> Nuevo insumo
        </button>
      </div>

      {editingId === "new" && (
        <SupplyForm
          title="Nuevo insumo"
          draft={draft}
          setDraft={setDraft}
          errors={errors}
          formError={formError}
          saving={saving}
          onSave={save}
          onCancel={cancelEdit}
        />
      )}

      {supplies.length > 0 && (
        <div className="space-y-2">
          <label className="relative block">
            <span className="sr-only">Buscar insumos</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nombre…"
              className={`${inputClass} pl-9`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar insumos">
            {([
              ["active", `Activos (${activeCount})`],
              ["archived", `Archivados (${archivedCount})`],
            ] as const).map(([value, label]) => (
              <FilterChip key={value} active={status === value} onClick={() => setStatus(value)}>{label}</FilterChip>
            ))}
            <span className="mx-1 h-4 w-px bg-stampa-border" aria-hidden="true" />
            {([
              ["all", "Todos"],
              ["component", "Componentes"],
              ["packaging", "Embalaje"],
            ] as const).map(([value, label]) => (
              <FilterChip key={value} active={category === value} onClick={() => setCategory(value)}>{label}</FilterChip>
            ))}
          </div>
        </div>
      )}

      {supplies.length === 0 && editingId !== "new" ? (
        <EmptyState
          icon={Boxes}
          title="Todavía no cargaste insumos"
          hint="Sumá focos, cables, cajas o papel burbuja con su costo. Después los asociás a tus tipos de producto y la calculadora los suma sola."
          action={
            <button type="button" onClick={startCreate} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-stampa-orange/40 px-4 text-sm font-semibold text-stampa-accent hover:bg-stampa-orange/10">
              <Plus size={15} aria-hidden="true" /> Cargar mi primer insumo
            </button>
          }
        />
      ) : supplies.length > 0 && visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stampa-border p-4 text-center text-sm text-gray-400">
          {status === "archived" ? "No hay insumos archivados con ese filtro." : "No encontramos insumos con ese filtro."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((supply) => (
            <li key={supply.id}>
              {editingId === supply.id ? (
                <SupplyForm
                  title="Editar insumo"
                  draft={draft}
                  setDraft={setDraft}
                  errors={errors}
                  formError={formError}
                  saving={saving}
                  onSave={save}
                  onCancel={cancelEdit}
                  usageCount={usage.get(supply.id) ?? 0}
                />
              ) : (
                <SupplyRow
                  supply={supply}
                  usageCount={usage.get(supply.id) ?? 0}
                  onEdit={() => startEdit(supply)}
                  onArchive={() => void setArchived(supply, !supply.archived_at)}
                  onDelete={() => void remove(supply)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange ${
        active ? "border-stampa-orange/40 bg-stampa-orange/10 text-stampa-accent" : "border-stampa-border text-gray-400 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const packaging = category === "packaging";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
      packaging ? "bg-sky-500/10 text-sky-300" : "bg-stampa-orange/10 text-stampa-accent"
    }`}>
      {packaging ? <Package size={10} aria-hidden="true" /> : <Boxes size={10} aria-hidden="true" />}
      {SUPPLY_CATEGORY_LABELS[packaging ? "packaging" : "component"]}
    </span>
  );
}

function SupplyRow({
  supply,
  usageCount,
  onEdit,
  onArchive,
  onDelete,
}: {
  supply: CalculatorSupplyRecord;
  usageCount: number;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const unit = isSupplyUnit(supply.unit) ? supply.unit : "unit";
  const archived = Boolean(supply.archived_at);
  const cost = Number(supply.unit_cost) || 0;
  return (
    <div className={`flex flex-col gap-3 rounded-xl border border-stampa-border bg-fg/[0.03] p-3 sm:flex-row sm:items-center ${archived ? "opacity-70" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="break-words text-sm font-semibold text-fg">{supply.name}</p>
          <CategoryBadge category={supply.category} />
          {archived && <span className="rounded-md bg-fg/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Archivado</span>}
        </div>
        <p className="mt-1 text-xs text-gray-400">
          <span className={`font-semibold ${cost === 0 ? "text-amber-400" : "text-gray-200"}`}>
            {cost === 0 ? "Sin costo cargado" : formatUnitCost(cost, unit, supply.custom_unit_label)}
          </span>
          <span className="mx-1.5 text-gray-600" aria-hidden="true">·</span>
          {usageCount === 0 ? "Sin usar en tipos" : usageCount === 1 ? "En 1 tipo de producto" : `En ${usageCount} tipos de producto`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
        <IconButton label={`Editar ${supply.name}`} onClick={onEdit}><Edit2 size={16} /></IconButton>
        <IconButton label={archived ? `Reactivar ${supply.name}` : `Archivar ${supply.name}`} onClick={onArchive}>
          {archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
        </IconButton>
        {usageCount === 0 && (
          <IconButton label={`Eliminar ${supply.name}`} onClick={onDelete} destructive><Trash2 size={16} /></IconButton>
        )}
      </div>
    </div>
  );
}

function IconButton({ label, onClick, destructive = false, children }: { label: string; onClick: () => void; destructive?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange ${
        destructive ? "hover:bg-red-500/10 hover:text-red-400" : "hover:bg-fg/10 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function SupplyForm({
  title,
  draft,
  setDraft,
  errors,
  formError,
  saving,
  onSave,
  onCancel,
  usageCount = 0,
}: {
  title: string;
  draft: SupplyDraft;
  setDraft: React.Dispatch<React.SetStateAction<SupplyDraft>>;
  errors: Partial<Record<string, string>>;
  formError: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  usageCount?: number;
}) {
  const unit = isSupplyUnit(draft.unit) ? draft.unit : "unit";
  const costUnitLabel = unit === "custom" ? (draft.customUnitLabel || "unidad") : unitShortLabel(unit);
  const update = (patch: Partial<SupplyDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const errorText = (key: string) => errors[key] ? <p className="mt-1 text-[11px] text-red-400">{errors[key]}</p> : null;

  return (
    <form
      className="space-y-4 rounded-xl border border-stampa-orange/30 bg-stampa-surface p-4 shadow-md"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-fg">{title}</h4>
        <button type="button" onClick={onCancel} aria-label="Cancelar" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-fg/10 hover:text-fg">
          <X size={16} />
        </button>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-300">Nombre</span>
        <input
          type="text"
          value={draft.name}
          onChange={(event) => update({ name: event.target.value })}
          maxLength={80}
          placeholder="Ej. Foco LED E27, Caja 20×20, Papel burbuja"
          className={inputClass}
          aria-invalid={Boolean(errors.name)}
        />
        {errorText("name")}
      </label>

      <div>
        <span className="mb-1 block text-xs font-semibold text-gray-300">Tipo de insumo</span>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de insumo">
          {(["component", "packaging"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={draft.category === value}
              onClick={() => update({ category: value })}
              className={`min-h-11 rounded-xl border px-3 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange ${
                draft.category === value ? "border-stampa-orange/50 bg-stampa-orange/10 text-fg" : "border-stampa-border text-gray-400 hover:text-fg"
              }`}
            >
              <span className="block font-semibold">{SUPPLY_CATEGORY_LABELS[value]}</span>
              <span className="block text-[11px] text-gray-500">{value === "component" ? "Focos, cables, tornillos…" : "Cajas, papel burbuja, etiquetas…"}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-xs font-semibold text-gray-300">Unidad de medida</span>
          <CalculatorSelect
            options={UNIT_OPTIONS}
            value={unit}
            onChange={(value) => update({ unit: value })}
            searchable={false}
          />
          {errorText("unit")}
          {usageCount > 0 && (
            <p className="mt-1 text-[11px] text-gray-500">Está en tipos de producto: podés pasar a una unidad equivalente (kg ↔ g, m ↔ cm).</p>
          )}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-300">Costo por {costUnitLabel}</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={String(draft.unitCost)}
              onChange={(event) => update({ unitCost: event.target.value.replace(/[^\d.,]/g, "") })}
              placeholder="0"
              className={`${inputClass} pl-7`}
              aria-invalid={Boolean(errors.unitCost)}
            />
          </div>
          {errorText("unitCost")}
        </label>
      </div>

      {unit === "custom" && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-300">Nombre de la unidad</span>
          <input
            type="text"
            value={draft.customUnitLabel ?? ""}
            onChange={(event) => update({ customUnitLabel: event.target.value })}
            maxLength={20}
            placeholder="Ej. rollo, pack, par"
            className={inputClass}
            aria-invalid={Boolean(errors.customUnitLabel)}
          />
          {errorText("customUnitLabel")}
          <p className="mt-1 text-[11px] text-gray-500">Una unidad personalizada no se convierte a otras: las cantidades se cargan en esa misma unidad.</p>
        </label>
      )}

      {formError && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-400">{formError}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-xl px-4 text-sm font-semibold text-gray-400 hover:bg-fg/5 hover:text-fg">Cancelar</button>
        <button
          type="submit"
          disabled={saving}
          aria-busy={saving}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-stampa-orange px-4 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar insumo
        </button>
      </div>
    </form>
  );
}
