"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Plus, Edit2, Save, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { TableSkeleton } from "@/components/ui/page-skeletons";
import { Card } from "@/components/ui/card";
import { useAppFeedback } from "@/components/ui/app-feedback";

export function ProductTypesManager() {
  const supabase = createClient();
  const { confirmAction } = useAppFeedback();
  const [types, setTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    multiplier: 2.0,
    fixed_cost: 0,
    sort_order: 0,
    is_active: true,
  });

  useEffect(() => {
    fetchTypes();
  }, []);

  const fetchTypes = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Ensure defaults exist before fetching
    await supabase.rpc("ensure_default_calculator_product_types");

    const { data, error } = await supabase
      .from("calculator_product_types")
      .select("*")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true });

    if (error) setError(error.message);
    else setTypes(data || []);
    setLoading(false);
  };

  const handleSave = async () => {
    setError(null);
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
      if (error) setError(error.message);
      else setTypes([...types, data]);
    } else {
      const { error } = await supabase.from("calculator_product_types").update(payload).eq("id", editingId);
      if (error) setError(error.message);
      else setTypes(types.map(t => t.id === editingId ? { ...t, ...payload } : t));
    }
    
    if (!error) setEditingId(null);
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
    }
  };

  if (loading) return <TableSkeleton rows={5} columns={4} />;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-500/20">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">Tipos de producto / markupes</h3>
        <button
          onClick={() => {
            setFormData({
              name: "", multiplier: 2.0, fixed_cost: 0, sort_order: types.length + 1, is_active: true
            });
            setEditingId("new");
          }}
          className="flex items-center gap-1.5 bg-stampa-orange/100 hover:bg-stampa-orange text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Añadir Tipo
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {editingId === "new" && (
          <TypeEditor formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
        )}

        {types.map((t) => (
          editingId === t.id ? (
            <TypeEditor key={t.id} formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
          ) : (
            <Card key={t.id} className="p-4 flex flex-col hover:border-stampa-orange/30 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-bold text-white">{t.name}</h4>
                <button onClick={() => { setFormData(t); setEditingId(t.id); }} className="text-gray-400 hover:text-stampa-orange transition-colors">
                  <Edit2 size={16} />
                </button>
              </div>
              <div className="text-sm text-gray-500 space-y-1 mb-4 flex-1">
                <p>Markup: <span className="font-medium text-gray-300">x{t.multiplier}</span></p>
                <p>Insumos extra: <span className="font-medium text-gray-300">${t.fixed_cost ?? 0}</span></p>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-stampa-border">
                <button 
                  onClick={() => toggleStatus(t.id, t.is_active)}
                  className={`text-xs px-2.5 py-1 rounded-md font-semibold transition-colors border ${t.is_active ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}
                >
                  {t.is_active ? 'Activo' : 'Inactivo'}
                </button>
                <div className="flex gap-2">
                  <button onClick={() => handleDelete(t.id)} className="text-gray-400 hover:text-red-400 transition-colors p-1" title="Eliminar">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </Card>
          )
        ))}
        {types.length === 0 && editingId !== "new" && (
          <div className="col-span-full py-12 text-center bg-stampa-bg-soft rounded-xl border border-dashed border-white/20">
            <p className="text-sm text-gray-500">No tienes tipos de producto registrados.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TypeEditor({ formData, setFormData, onSave, onCancel }: any) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setFormData((prev: any) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setFormData((prev: any) => ({ ...prev, [name]: value }));
    }
  };

  return (
    <Card className="p-4 border-stampa-orange/30 shadow-md">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Nombre (Tipo de Pieza)</label>
          <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="Ej. Llavero, Adorno, etc." />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Markup</label>
            <input type="number" step="0.1" name="multiplier" value={formData.multiplier} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Insumos extra</label>
            <input type="number" min="0" step="any" name="fixed_cost" value={formData.fixed_cost} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="Ej: costo del jarro, packaging, tira LED..." />
            <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Al calcular, se suma un 30% para cubrir envío, desperdicio o unidades falladas. El markup no se aplica a este valor.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-stampa-orange focus:ring-[#ff6a00]/20" />
          <label className="text-sm font-medium text-gray-300">Tipo Activo</label>
        </div>
      </div>
      <div className="mt-4 flex flex-col-reverse sm:flex-row gap-2 justify-end">
        <button onClick={onCancel} className="w-full sm:w-auto px-3 py-1.5 text-xs font-bold text-gray-400 hover:bg-stampa-surface/5 rounded-md transition-colors text-center">Cancelar</button>
        <button onClick={onSave} className="w-full sm:w-auto flex justify-center items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-stampa-orange/100 hover:bg-stampa-orange text-white rounded-md transition-colors"><Save size={14} /> Guardar</button>
      </div>
    </Card>
  );
}
