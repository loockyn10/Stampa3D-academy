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
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Multiplicadores (Tipos de Producto)</h3>
        <button
          onClick={() => {
            setFormData({
              name: "", multiplier: 2.0, sort_order: types.length + 1, is_active: true
            });
            setEditingId("new");
          }}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
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
            <Card key={t.id} className="p-4 flex flex-col hover:border-orange-200 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-bold text-gray-900">{t.name}</h4>
                <button onClick={() => { setFormData(t); setEditingId(t.id); }} className="text-gray-400 hover:text-orange-500 transition-colors">
                  <Edit2 size={16} />
                </button>
              </div>
              <div className="text-sm text-gray-500 space-y-1 mb-4 flex-1">
                <p>Multiplicador: <span className="font-medium text-gray-700">x{t.multiplier}</span></p>
                <p>Orden: <span className="font-medium text-gray-700">{t.sort_order}</span></p>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {t.is_active ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            </Card>
          )
        ))}
        {types.length === 0 && editingId !== "new" && (
          <div className="col-span-full py-12 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
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
    <Card className="p-4 border-orange-200 shadow-md">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Nombre (Tipo de Pieza)</label>
          <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900" placeholder="Ej. Llavero, Adorno, etc." />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Multiplicador</label>
            <input type="number" step="0.1" name="multiplier" value={formData.multiplier} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Orden de lista</label>
            <input type="number" name="sort_order" value={formData.sort_order} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900" />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-orange-600 focus:ring-orange-500" />
          <label className="text-sm font-medium text-gray-700">Tipo Activo</label>
        </div>
      </div>
      <div className="mt-4 flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-md transition-colors">Cancelar</button>
        <button onClick={onSave} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-colors"><Save size={14} /> Guardar</button>
      </div>
    </Card>
  );
}
