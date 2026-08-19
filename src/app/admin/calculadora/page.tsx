"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Plus, Edit2, Save, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useRouter } from "next/navigation";

export default function AdminCalculadoraPage() {
  const supabase = createClient();
  const router = useRouter();
  const [templates, setTemplates] = useState<any[]>([]);
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
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    
    // As it is an admin page, we assume user is admin via middleware
    const { data, error } = await supabase
      .from("calculator_product_type_templates")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) setError(error.message);
    else setTemplates(data || []);
    setLoading(false);
  };

  const handleSave = async () => {
    setError(null);
    
    if (!formData.name.trim()) {
      setError("El nombre es requerido.");
      return;
    }

    const payload = {
      name: formData.name.trim(),
      multiplier: Math.max(0, parseFloat(String(formData.multiplier)) || 0),
      fixed_cost: Math.max(0, parseFloat(String(formData.fixed_cost)) || 0),
      sort_order: parseInt(String(formData.sort_order)) || 0,
      is_active: formData.is_active,
    };

    if (editingId === "new") {
      const { data, error } = await supabase
        .from("calculator_product_type_templates")
        .insert([payload])
        .select()
        .single();
        
      if (error) setError(error.message);
      else setTemplates([...templates, data]);
    } else {
      const { error } = await supabase
        .from("calculator_product_type_templates")
        .update(payload)
        .eq("id", editingId);
        
      if (error) setError(error.message);
      else setTemplates(templates.map(t => t.id === editingId ? { ...t, ...payload } : t));
    }
    
    if (!error) setEditingId(null);
  };

  const toggleStatus = async (template: any) => {
    const { error } = await supabase
      .from("calculator_product_type_templates")
      .update({ is_active: !template.is_active })
      .eq("id", template.id);
      
    if (error) {
      setError(error.message);
    } else {
      setTemplates(templates.map(t => 
        t.id === template.id ? { ...t, is_active: !template.is_active } : t
      ));
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Estás seguro de eliminar este template por defecto?")) return;

    const { error } = await supabase
      .from("calculator_product_type_templates")
      .delete()
      .eq("id", id);
      
    if (error) {
      setError(error.message);
    } else {
      setTemplates(templates.filter(t => t.id !== id));
    }
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-stampa-orange" /></div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Tipos de producto por defecto</h1>
          <p className="text-gray-400 text-sm mt-1">
            Estas plantillas se copiarán automáticamente a los usuarios nuevos que usen la calculadora.
          </p>
        </div>
        <button
          onClick={() => {
            setFormData({
              name: "", multiplier: 2.0, fixed_cost: 0, sort_order: (templates.length + 1) * 10, is_active: true
            });
            setEditingId("new");
          }}
          className="flex items-center gap-2 bg-stampa-orange hover:bg-stampa-orange/90 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors shrink-0 shadow-sm"
        >
          <Plus size={18} /> Añadir Template
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-xl flex items-center gap-3 text-sm border border-red-500/20">
          <AlertCircle className="h-5 w-5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {editingId === "new" && (
          <TypeEditor formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
        )}

        {templates.map((t) => (
          editingId === t.id ? (
            <TypeEditor key={t.id} formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
          ) : (
            <Card key={t.id} className="p-5 flex flex-col bg-stampa-surface border-stampa-border hover:border-stampa-orange/30 transition-colors rounded-2xl group">
              <div className="flex justify-between items-start mb-3">
                <h4 className="font-bold text-white text-lg leading-tight">{t.name}</h4>
                <div className="flex gap-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setFormData(t); setEditingId(t.id); }} className="p-1.5 text-gray-400 bg-white/5 rounded-md hover:text-white hover:bg-white/10 transition-colors">
                    <Edit2 size={15} />
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="p-1.5 text-red-400/70 bg-red-500/5 rounded-md hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-400 space-y-1.5 mb-5 flex-1">
                <div className="flex justify-between">
                  <span>Markup</span>
                  <span className="font-semibold text-gray-200">x{t.multiplier}</span>
                </div>
                <div className="flex justify-between">
                  <span>Costo fijo</span>
                  <span className="font-semibold text-gray-200">${t.fixed_cost ?? 0}</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-stampa-border">
                <button
                  onClick={() => toggleStatus(t)}
                  className={`text-xs px-2.5 py-1 rounded-md font-semibold transition-colors border ${
                    t.is_active 
                      ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' 
                      : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {t.is_active ? 'Activo' : 'Inactivo'}
                </button>
                <span className="text-xs text-gray-500 font-mono">Orden: {t.sort_order}</span>
              </div>
            </Card>
          )
        ))}
        {templates.length === 0 && editingId !== "new" && (
          <div className="col-span-full py-16 flex flex-col items-center justify-center text-center bg-stampa-surface/50 rounded-2xl border border-dashed border-white/10">
            <div className="bg-white/5 p-4 rounded-full mb-3">
              <Plus size={24} className="text-gray-500" />
            </div>
            <h3 className="text-white font-medium mb-1">Sin templates</h3>
            <p className="text-sm text-gray-400 max-w-sm">Añade tu primer tipo de producto por defecto para que los nuevos usuarios tengan una base al iniciar.</p>
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
    <Card className="p-5 border-stampa-orange/50 shadow-lg bg-stampa-surface/80 backdrop-blur-sm rounded-2xl">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Nombre</label>
          <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" placeholder="Ej. Llavero, Adorno..." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Markup</label>
            <input type="number" step="0.1" min="0" name="multiplier" value={formData.multiplier} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Costo fijo</label>
            <input type="number" min="0" step="any" name="fixed_cost" value={formData.fixed_cost} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Orden</label>
            <input type="number" name="sort_order" value={formData.sort_order} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" />
          </div>
          <div className="flex flex-col justify-end pb-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_active" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-stampa-orange focus:ring-stampa-orange/30 w-4 h-4 bg-stampa-bg border-stampa-border" />
              <label htmlFor="is_active" className="text-sm font-medium text-gray-300 cursor-pointer">Activo</label>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5 flex gap-2 justify-end">
        <button onClick={onCancel} className="px-4 py-2 text-sm font-semibold text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors">Cancelar</button>
        <button onClick={onSave} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-stampa-orange hover:bg-stampa-orange/90 text-white rounded-xl transition-colors shadow-sm">
          <Save size={16} /> Guardar
        </button>
      </div>
    </Card>
  );
}
