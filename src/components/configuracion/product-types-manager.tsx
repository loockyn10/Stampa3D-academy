"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useSaveGuard } from "@/lib/forms/use-save-guard";
import { createClient } from "@/utils/supabase/client";
import { Plus, Edit2, Save, AlertCircle, Trash2, Boxes } from "lucide-react";
import { TableSkeleton } from "@/components/ui/page-skeletons";
import { Card } from "@/components/ui/card";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { ProductTypeSuppliesDialog } from "@/components/calculadora/product-type-supplies-editor";
import { InfoTip } from "@/components/ui/info-tip";
import { loadCalculatorSupplies, type CalculatorSuppliesData } from "@/lib/calculator/supplies-data";
import { buildProductTypeSupplyLines, formatSupplyMoney, priceSupplyLines } from "@/lib/calculator/supplies";
import { notifyCalculatorSuppliesChanged, subscribeCalculatorSuppliesChanged } from "@/lib/calculator/supplies-events";

interface ProductTypesManagerProps {
  /** Se llama después de cada cambio guardado (alta, edición, activar/desactivar o baja). */
  onChanged?: () => void;
  /** Abre el catálogo de insumos (pestaña «Insumos» del modal de la Calculadora). */
  onOpenSupplies?: () => void;
}

export function ProductTypesManager({ onChanged, onOpenSupplies }: ProductTypesManagerProps = {}) {
  const [supabase] = useState(() => createClient());
  const { confirmAction } = useAppFeedback();
  const [types, setTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [suppliesData, setSuppliesData] = useState<CalculatorSuppliesData>({ available: false, supplies: [], associations: [] });
  const [openSuppliesId, setOpenSuppliesId] = useState<string | null>(null);
  const { saving, runSave } = useSaveGuard();
  const [formData, setFormData] = useState({
    name: "",
    multiplier: 2.0,
    fixed_cost: 0,
    sort_order: 0,
    is_active: true,
  });

  // D059: identidad de este panel para sincronizar con el catálogo de insumos sin recargar la página.
  const [syncSource] = useState(() => `product-types-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    fetchTypes();
  }, []);

  // Otro panel creó, editó, archivó o eliminó un insumo: se recargan catálogo y componentes (los tipos no cambian).
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeCalculatorSuppliesChanged(() => {
      void (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const next = await loadCalculatorSupplies(supabase, user.id);
        if (!cancelled) setSuppliesData(next);
      })();
    }, syncSource);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [supabase, syncSource]);

  const fetchTypes = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setUserId(user.id);

    // Ensure defaults exist before fetching
    await supabase.rpc("ensure_default_calculator_product_types");

    const [{ data, error }, supplies] = await Promise.all([
      supabase
        .from("calculator_product_types")
        .select("*")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true }),
      loadCalculatorSupplies(supabase, user.id),
    ]);
    setSuppliesData(supplies);

    if (error) setError(error.message);
    else setTypes(data || []);
    setLoading(false);
  };

  const handleSave = () => runSave(async () => {
    setError(null);
    let failed = false;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      ...formData,
      user_id: user.id,
      multiplier: parseFloat(String(formData.multiplier)) || 1.0,
      fixed_cost: Math.max(0, parseFloat(String(formData.fixed_cost)) || 0),
      sort_order: parseInt(String(formData.sort_order)) || 0,
    };

    if (editingId === "new") {
      const { data, error } = await supabase.from("calculator_product_types").insert([payload]).select().single();
      if (error) { setError(error.message); failed = true; }
      else {
        setTypes([...types, data]);
        onChanged?.();
      }
    } else {
      const { error } = await supabase.from("calculator_product_types").update(payload).eq("id", editingId);
      if (error) { setError(error.message); failed = true; }
      else {
        setTypes(types.map(t => t.id === editingId ? { ...t, ...payload } : t));
        onChanged?.();
      }
    }
    
    if (!failed) setEditingId(null);
  });

  // Resumen de componentes por tipo: costo actual leído del catálogo (no se guarda en el tipo).
  const suppliesSummary = useMemo(() => {
    const summary = new Map<string, { count: number; total: number }>();
    for (const type of types) {
      const lines = buildProductTypeSupplyLines(type.id, suppliesData.associations, suppliesData.supplies);
      if (lines.length > 0) summary.set(type.id, { count: lines.length, total: priceSupplyLines(lines).total });
    }
    return summary;
  }, [types, suppliesData]);

  const updateAssociations = (next: CalculatorSuppliesData["associations"]) => {
    setSuppliesData((current) => ({ ...current, associations: next }));
    notifyCalculatorSuppliesChanged(syncSource);
    onChanged?.();
  };

  const clearLegacyFixedCost = async (typeId: string) => {
    const { error } = await supabase.from("calculator_product_types").update({ fixed_cost: 0 }).eq("id", typeId);
    if (error) {
      setError(error.message);
      return;
    }
    setTypes((current) => current.map((type) => (type.id === typeId ? { ...type, fixed_cost: 0 } : type)));
    onChanged?.();
  };

  const toggleStatus = async (typeId: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from("calculator_product_types")
      .update({ is_active: !currentStatus })
      .eq("id", typeId);

    if (error) {
      setError(error.message);
    } else {
      setTypes(types.map(t => t.id === typeId ? { ...t, is_active: !currentStatus } : t));
      onChanged?.();
    }
  };

  const handleDelete = async (typeId: string) => {
    const confirmed = await confirmAction({
      title: "Eliminar tipo de producto",
      description: "¿Seguro que querés eliminar este tipo de producto?",
      confirmLabel: "Eliminar tipo",
      destructive: true,
    });
    if (!confirmed) return;
    
    setError(null);
    const { error } = await supabase
      .from("calculator_product_types")
      .delete()
      .eq("id", typeId);

    if (error) {
      if (error.code === '23503' || error.message.includes('violates foreign key')) {
        setError("No se pudo eliminar porque este tipo está en uso. Podés desactivarlo.");
      } else {
        setError(error.message);
      }
    } else {
      setTypes(types.filter(t => t.id !== typeId));
      // Borrar un tipo borra sus componentes (cascade): avisar a quien muestre el uso de los insumos.
      setSuppliesData((current) => ({ ...current, associations: current.associations.filter((item) => item.product_type_id !== typeId) }));
      notifyCalculatorSuppliesChanged(syncSource);
      onChanged?.();
    }
  };

  if (loading) return <TableSkeleton rows={5} columns={4} />;

  const openSuppliesType = types.find((type) => type.id === openSuppliesId) ?? null;

  return (
    <section className="space-y-4" aria-labelledby="product-types-title">
      {error && (
        <div role="alert" className="bg-red-500/10 text-red-400 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-500/20">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h3 id="product-types-title" className="text-lg font-semibold text-fg">Tipos de producto / markups</h3>
        <button
          type="button"
          onClick={() => {
            setFormData({
              name: "", multiplier: 2.0, fixed_cost: 0, sort_order: types.length + 1, is_active: true
            });
            setEditingId("new");
          }}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-stampa-orange px-4 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
        >
          <Plus size={16} aria-hidden="true" /> Agregar tipo
        </button>
      </div>

      {/* UX-01B: columnas según el ancho real disponible (después del sidebar o dentro de un modal), no según el viewport. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-3">
        {editingId === "new" && (
          <TypeEditor saving={saving} formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
        )}

        {types.map((t) => {
          if (editingId === t.id) {
            return <TypeEditor key={t.id} saving={saving} formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />;
          }
          const summary = suppliesSummary.get(t.id);
          return (
            <Card key={t.id} className={`flex flex-col p-4 transition-colors hover:border-stampa-orange/30 ${t.is_active ? "" : "opacity-70"}`}>
              <h4 className="truncate text-base font-bold text-fg" title={t.name}>{t.name}</h4>
              <p className="mt-1 text-sm text-gray-400">
                Markup <span className="font-semibold text-fg">×{t.multiplier}</span>
                <span className="mx-1.5 text-gray-600" aria-hidden="true">·</span>
                Insumos extra <span className="font-semibold text-fg">{formatSupplyMoney(Number(t.fixed_cost) || 0)}</span>
              </p>
              {suppliesData.available && (
                <div className="mt-3 flex flex-1 flex-col justify-end gap-2">
                  <p className="text-sm text-gray-400">
                    {summary
                      ? <>Componentes: <span className="font-semibold text-fg">{summary.count} · {formatSupplyMoney(summary.total)}</span></>
                      : <span className="text-gray-500">Sin componentes</span>}
                  </p>
                  {userId && (
                    <button
                      type="button"
                      onClick={() => setOpenSuppliesId(t.id)}
                      aria-haspopup="dialog"
                      className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-stampa-border bg-fg/[0.03] px-3 text-sm font-semibold text-gray-200 transition-colors hover:border-stampa-orange/40 hover:bg-stampa-orange/5 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
                    >
                      <Boxes size={15} aria-hidden="true" /> Componentes y embalaje
                    </button>
                  )}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-stampa-border pt-3">
                <button
                  type="button"
                  onClick={() => toggleStatus(t.id, t.is_active)}
                  aria-pressed={Boolean(t.is_active)}
                  title={t.is_active ? "Desactivar tipo" : "Activar tipo"}
                  className={`min-h-8 rounded-md border px-2.5 text-xs font-semibold transition-colors ${t.is_active ? "bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20" : "bg-fg/5 text-gray-400 border-fg/10 hover:bg-fg/10"}`}
                >
                  {t.is_active ? "Activo" : "Inactivo"}
                </button>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => { setFormData(t); setEditingId(t.id); }}
                    aria-label={`Editar ${t.name}`}
                    title="Editar"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-fg/10 hover:text-stampa-accent"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(t.id)}
                    aria-label={`Eliminar ${t.name}`}
                    title="Eliminar"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
        {types.length === 0 && editingId !== "new" && (
          <div className="col-span-full py-10 text-center bg-stampa-bg-soft rounded-xl border border-dashed border-fg/20">
            <p className="text-sm text-gray-500">Sin tipos de producto</p>
          </div>
        )}
      </div>

      {openSuppliesType && userId && (
        <ProductTypeSuppliesDialog
          open
          onClose={() => setOpenSuppliesId(null)}
          productTypeId={openSuppliesType.id}
          productTypeName={openSuppliesType.name}
          legacyFixedCost={Number(openSuppliesType.fixed_cost) || 0}
          userId={userId}
          supplies={suppliesData.supplies}
          associations={suppliesData.associations}
          onAssociationsChange={updateAssociations}
          onClearLegacyFixedCost={() => clearLegacyFixedCost(openSuppliesType.id)}
          onOpenCatalog={onOpenSupplies}
        />
      )}
    </section>
  );
}

function TypeEditor({ saving, formData, setFormData, onSave, onCancel }: any) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setFormData((prev: any) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setFormData((prev: any) => ({ ...prev, [name]: value }));
    }
  };

  const fieldId = React.useId();
  const inputClass = "h-10 w-full rounded-lg border border-stampa-border bg-stampa-surface px-2.5 text-base sm:text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-[#ff6a00] focus:ring-2 focus:ring-[#ff6a00]/20";

  return (
    <Card className="p-4 border-stampa-orange/30 shadow-md">
      <div className="space-y-3">
        <div>
          <label htmlFor={`${fieldId}-name`} className="block text-xs font-semibold text-gray-300 mb-1">Nombre</label>
          <input id={`${fieldId}-name`} type="text" name="name" value={formData.name} onChange={handleChange} className={inputClass} placeholder="Ej. Llavero, Lámpara" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${fieldId}-multiplier`} className="block text-xs font-semibold text-gray-300 mb-1">Markup (×)</label>
            <input id={`${fieldId}-multiplier`} type="number" step="0.1" name="multiplier" value={formData.multiplier} onChange={handleChange} className={inputClass} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor={`${fieldId}-fixed`} className="block text-xs font-semibold text-gray-300">Insumos extra ($)</label>
              <InfoTip label="Qué son los insumos extra" iconSize={13} className="h-5 w-5">
                Monto fijo por unidad (jarro, packaging, tira LED…). Se suma a su costo real, sin markup. Si configuraste contingencias sobre insumos, también se aplican a este valor.
              </InfoTip>
            </div>
            <input id={`${fieldId}-fixed`} type="number" min="0" step="any" name="fixed_cost" value={formData.fixed_cost} onChange={handleChange} className={inputClass} placeholder="0" />
          </div>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-gray-300">
          <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-stampa-accent focus:ring-[#ff6a00]/20" />
          Activo
        </label>
      </div>
      <div className="mt-4 flex flex-col-reverse sm:flex-row gap-2 justify-end">
        <button type="button" onClick={onCancel} className="min-h-10 w-full sm:w-auto rounded-lg px-3 text-sm font-semibold text-gray-400 transition-colors hover:bg-fg/5 hover:text-fg">Cancelar</button>
        <button type="button" onClick={onSave} disabled={saving} aria-busy={saving} className="min-h-10 w-full sm:w-auto flex justify-center items-center gap-1.5 rounded-lg bg-stampa-orange px-4 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:opacity-50"><Save size={15} aria-hidden="true" /> Guardar</button>
      </div>
    </Card>
  );
}
