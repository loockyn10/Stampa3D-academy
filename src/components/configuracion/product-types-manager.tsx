"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Plus, Edit2, Save, Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

export function ProductTypesManager() {
  const supabase = createClient();
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

  if (loading) return <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-orange-500" /></div>;

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
          className="flex items-center gap-1.5 bg-orange-500/100 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
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
            <Card key={t.id} className="p-4 flex flex-col hover:border-orange-500/30 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-bold text-white">{t.name}</h4>
                <button onClick={() => { setFormData(t); setEditingId(t.id); }} className="text-gray-400 hover:text-orange-500 transition-colors">
                  <Edit2 size={16} />
                </button>
              </div>
              <div className="text-sm text-gray-500 space-y-1 mb-4 flex-1">
                <p>Markup: <span className="font-medium text-gray-300">x{t.multiplier}</span></p>
                <p>Costo fijo: <span className="font-medium text-gray-300">${t.fixed_cost ?? 0}</span></p>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${t.is_active ? 'bg-green-500/20 text-green-400' : 'bg-[#111]/5 text-gray-400'}`}>
                  {t.is_active ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            </Card>
          )
        ))}
        {types.length === 0 && editingId !== "new" && (
          <div className="col-span-full py-12 text-center bg-[#0a0a0a] rounded-xl border border-dashed border-white/20">
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
    <Card className="p-4 border-orange-500/30 shadow-md">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Nombre (Tipo de Pieza)</label>
          <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="Ej. Llavero, Adorno, etc." />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Markup</label>
            <input type="number" step="0.1" name="multiplier" value={formData.multiplier} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Costo fijo</label>
            <input type="number" min="0" step="any" name="fixed_cost" value={formData.fixed_cost} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="Ej: costo del jarro, packaging, tira LED..." />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-[#ff6a00] focus:ring-[#ff6a00]/20" />
          <label className="text-sm font-medium text-gray-300">Tipo Activo</label>
        </div>
      </div>
      <div className="mt-4 flex flex-col-reverse sm:flex-row gap-2 justify-end">
        <button onClick={onCancel} className="w-full sm:w-auto px-3 py-1.5 text-xs font-bold text-gray-400 hover:bg-[#111]/5 rounded-md transition-colors text-center">Cancelar</button>
        <button onClick={onSave} className="w-full sm:w-auto flex justify-center items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-orange-500/100 hover:bg-orange-600 text-white rounded-md transition-colors"><Save size={14} /> Guardar</button>
      </div>
    </Card>
  );
}
