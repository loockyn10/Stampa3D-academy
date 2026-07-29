"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Plus, Edit2, Save, Trash2, Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

export function FilamentsManager() {
  const supabase = createClient();
  const [filaments, setFilaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    filament_type: "PLA",
    color: "#000000",
    total_grams: 1000,
    remaining_grams: 1000,
    purchase_price: 0,
    is_active: true,
  });

  useEffect(() => {
    fetchFilaments();
  }, []);

  const fetchFilaments = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("filaments")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) setError(error.message);
    else setFilaments(data || []);
    setLoading(false);
  };

  const handleSave = async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      ...formData,
      user_id: user.id,
      total_grams: parseFloat(String(formData.total_grams)) || 0,
      remaining_grams: parseFloat(String(formData.remaining_grams)) || 0,
      purchase_price: parseFloat(String(formData.purchase_price)) || 0,
    };

    if (editingId === "new") {
      const { data, error } = await supabase.from("filaments").insert([payload]).select().single();
      if (error) setError(error.message);
      else setFilaments([data, ...filaments]);
    } else {
      const { error } = await supabase.from("filaments").update(payload).eq("id", editingId);
      if (error) setError(error.message);
      else setFilaments(filaments.map(f => f.id === editingId ? { ...f, ...payload } : f));
    }
    
    if (!error) setEditingId(null);
  };

  const handleDelete = async (filament: any) => {
    if (!window.confirm(`¿Seguro que querés eliminar este filamento? No aparecerá más para nuevos cálculos, pero los movimientos y productos anteriores se conservarán.`)) {
      return;
    }

    const { error } = await supabase.from("filaments").update({ is_active: false }).eq("id", filament.id);
    if (error) {
      setError(error.message);
    } else {
      setFilaments(filaments.map(f => f.id === filament.id ? { ...f, is_active: false } : f));
    }
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
        <h3 className="text-lg font-semibold text-white">Mis Filamentos</h3>
        <button
          onClick={() => {
            setFormData({
              name: "", filament_type: "PLA", color: "#000000", total_grams: 1000, remaining_grams: 1000, purchase_price: 0, is_active: true
            });
            setEditingId("new");
          }}
          className="flex items-center gap-1.5 bg-orange-500/100 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Añadir Filamento
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {editingId === "new" && (
          <FilamentEditor formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
        )}

        {filaments.map((f) => (
          editingId === f.id ? (
            <FilamentEditor key={f.id} formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
          ) : (
            <Card key={f.id} className="p-4 flex flex-col hover:border-orange-500/30 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: f.color }} />
                  <h4 className="font-bold text-white">{f.name}</h4>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setFormData(f); setEditingId(f.id); }} className="text-gray-400 hover:text-orange-500 transition-colors">
                    <Edit2 size={16} />
                  </button>
                  <button onClick={() => handleDelete(f)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-1 rounded transition-colors" title="Eliminar filamento">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-500 space-y-1 mb-4 flex-1">
                <p>Tipo: <span className="font-medium text-gray-300">{f.filament_type}</span></p>
                <p>Precio: <span className="font-medium text-gray-300">${f.purchase_price}</span></p>
                <p>Restante: <span className="font-medium text-gray-300">{f.remaining_grams}g / {f.total_grams}g</span></p>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${f.is_active ? 'bg-green-500/20 text-green-400' : 'bg-[#111]/5 text-gray-400'}`}>
                  {f.is_active ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            </Card>
          )
        ))}
        {filaments.length === 0 && editingId !== "new" && (
          <div className="col-span-full py-12 text-center bg-[#0a0a0a] rounded-xl border border-dashed border-white/20">
            <p className="text-sm text-gray-500">No tienes filamentos registrados.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilamentEditor({ formData, setFormData, onSave, onCancel }: any) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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
          <label className="block text-xs font-semibold text-gray-300 mb-1">Nombre</label>
          <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="Ej. Grilon3 PLA Negro" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Tipo</label>
            <input type="text" name="filament_type" value={formData.filament_type} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="PLA, PETG" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Color</label>
            <div className="flex h-9">
              <input type="color" name="color" value={formData.color} onChange={handleChange} className="h-full w-12 rounded-l-md border-y border-l border-white/10 cursor-pointer p-0.5 bg-neutral-900 border text-neutral-100 focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
              <input type="text" name="color" value={formData.color} onChange={handleChange} className="w-full text-sm border-white/10 rounded-r-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Gramos Total</label>
            <input type="number" name="total_grams" value={formData.total_grams} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Gramos Restantes</label>
            <input type="number" name="remaining_grams" value={formData.remaining_grams} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Precio Compra ($)</label>
          <input type="number" name="purchase_price" value={formData.purchase_price} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-[#ff6a00] focus:ring-[#ff6a00]/20" />
          <label className="text-sm font-medium text-gray-300">Filamento Activo</label>
        </div>
      </div>
      <div className="mt-4 flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-bold text-gray-400 hover:bg-[#111]/5 rounded-md transition-colors">Cancelar</button>
        <button onClick={onSave} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-orange-500/100 hover:bg-orange-600 text-white rounded-md transition-colors"><Save size={14} /> Guardar</button>
      </div>
    </Card>
  );
}
