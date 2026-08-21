"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Plus, Edit2, Save, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useRouter } from "next/navigation";

export default function AdminFilamentosPage() {
  const supabase = createClient();
  const router = useRouter();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    brand: "",
    name: "",
    filament_type: "PLA",
    color: "",
    color_hex: "",
    default_total_grams: 1000,
    default_purchase_price: 0,
    is_active: true,
    sort_order: 0,
    notes: "",
  });

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("filament_templates")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) setError(error.message);
    else setTemplates(data || []);
    setLoading(false);
  };

  const handleSave = async () => {
    setError(null);
    
    // name is now optional (Subtipo)
    if (!formData.filament_type.trim()) {
      setError("El material es requerido.");
      return;
    }

    let resolvedHex = formData.color_hex.trim() ? formData.color_hex.trim().toUpperCase() : null;
    if (resolvedHex && !/^#[0-9A-F]{6}$/i.test(resolvedHex)) {
      setError("El color visual debe tener formato #RRGGBB o estar vacío.");
      return;
    }

    const payload = {
      brand: formData.brand.trim() || null,
      name: formData.name.trim() || null,
      filament_type: formData.filament_type.trim(),
      color: formData.color.trim() || null,
      color_hex: resolvedHex,
      default_total_grams: Math.max(1, parseFloat(String(formData.default_total_grams)) || 1000),
      default_purchase_price: Math.max(0, parseFloat(String(formData.default_purchase_price)) || 0),
      sort_order: parseInt(String(formData.sort_order)) || 0,
      is_active: formData.is_active,
      notes: formData.notes.trim() || null,
    };

    if (editingId === "new") {
      const { data, error } = await supabase
        .from("filament_templates")
        .insert([payload])
        .select()
        .single();
        
      if (error) setError(error.message);
      else setTemplates([...templates, data]);
    } else {
      const { error } = await supabase
        .from("filament_templates")
        .update(payload)
        .eq("id", editingId);
        
      if (error) setError(error.message);
      else setTemplates(templates.map(t => t.id === editingId ? { ...t, ...payload } : t));
    }
    
    if (!error) setEditingId(null);
  };

  const toggleStatus = async (template: any) => {
    const { error } = await supabase
      .from("filament_templates")
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
    if (!window.confirm("¿Estás seguro de eliminar este filamento del catálogo global?")) return;

    const { error } = await supabase
      .from("filament_templates")
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
    <div className="max-w-6xl mx-auto space-y-6 p-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Catálogo de filamentos</h1>
          <p className="text-gray-400 text-sm mt-1">
            Administra los filamentos globales que los usuarios podrán seleccionar en la calculadora.
          </p>
        </div>
        <button
          onClick={() => {
            setFormData({
              brand: "", name: "", filament_type: "PLA", color: "", color_hex: "",
              default_total_grams: 1000, default_purchase_price: 0, sort_order: (templates.length + 1) * 10, is_active: true, notes: ""
            });
            setEditingId("new");
          }}
          className="flex items-center gap-2 bg-stampa-orange hover:bg-stampa-orange/90 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors shrink-0 shadow-sm"
        >
          <Plus size={18} /> Añadir Filamento
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-xl flex items-center gap-3 text-sm border border-red-500/20">
          <AlertCircle className="h-5 w-5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {editingId === "new" && (
          <FilamentEditor formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
        )}

        {templates.map((t) => (
          editingId === t.id ? (
            <FilamentEditor key={t.id} formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
          ) : (
            <Card key={t.id} className="p-5 flex flex-col bg-stampa-surface border-stampa-border hover:border-stampa-orange/30 transition-colors rounded-2xl group">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="font-bold text-white text-lg leading-tight flex items-center gap-2">
                    {t.color_hex && (
                      <span className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: t.color_hex }} title={t.color_hex} />
                    )}
                    {t.name || "-"}
                  </h4>
                  <p className="text-xs text-stampa-orange font-medium mt-0.5">{t.brand || "Sin marca"} • {t.filament_type}</p>
                </div>
                <div className="flex gap-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setFormData({ ...t, color_hex: t.color_hex || "", brand: t.brand || "", color: t.color || "", notes: t.notes || "", name: t.name || "" }); setEditingId(t.id); }} className="p-1.5 text-gray-400 bg-white/5 rounded-md hover:text-white hover:bg-white/10 transition-colors">
                    <Edit2 size={15} />
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="p-1.5 text-red-400/70 bg-red-500/5 rounded-md hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-400 space-y-1.5 mb-5 flex-1">
                <div className="flex justify-between">
                  <span>Color</span>
                  <span className="font-semibold text-gray-200">{t.color || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cantidad</span>
                  <span className="font-semibold text-gray-200">{t.default_total_grams}g</span>
                </div>
                <div className="flex justify-between">
                  <span>Precio sugerido</span>
                  <span className="font-semibold text-gray-200">${t.default_purchase_price}</span>
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
            <h3 className="text-white font-medium mb-1">Sin filamentos</h3>
            <p className="text-sm text-gray-400 max-w-sm">Añade tu primer filamento al catálogo para que los usuarios puedan seleccionarlo en la calculadora.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilamentEditor({ formData, setFormData, onSave, onCancel }: any) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setFormData((prev: any) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setFormData((prev: any) => ({ ...prev, [name]: value }));
    }
  };

  return (
    <Card className="p-5 border-stampa-orange/50 shadow-lg bg-stampa-surface/80 backdrop-blur-sm rounded-2xl md:col-span-2 lg:col-span-3 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Marca</label>
          <input type="text" name="brand" value={formData.brand} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" placeholder="Ej. Hellbot" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Subtipo</label>
          <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" placeholder="Ej: Ecofila, Pro, Silk, Mate" />
        </div>
        
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Material *</label>
          <input type="text" name="filament_type" value={formData.filament_type} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" placeholder="PLA, PETG, ABS..." />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Color</label>
          <input type="text" name="color" value={formData.color} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" placeholder="Negro, Blanco, etc." />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider flex justify-between">
            <span>Color visual (Hex)</span>
            {formData.color_hex && /^#[0-9A-Fa-f]{6}$/.test(formData.color_hex) && (
              <span className="w-4 h-4 rounded-full border border-white/20 inline-block" style={{ backgroundColor: formData.color_hex }} />
            )}
          </label>
          <input type="text" name="color_hex" value={formData.color_hex} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" placeholder="#000000" />
        </div>
        
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Gramos p/ defecto</label>
          <input type="number" min="1" step="any" name="default_total_grams" value={formData.default_total_grams} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Precio sugerido ($)</label>
          <input type="number" min="0" step="any" name="default_purchase_price" value={formData.default_purchase_price} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" />
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

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Notas (Opcional)</label>
          <textarea name="notes" value={formData.notes} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-xl text-neutral-100 bg-stampa-bg border focus:border-stampa-orange focus:ring-stampa-orange/20 focus:ring-4 transition-all px-3 py-2" rows={2} placeholder="Detalles extra..." />
        </div>
      </div>
      <div className="mt-5 flex gap-2 justify-end pt-4 border-t border-stampa-border">
        <button onClick={onCancel} className="px-4 py-2 text-sm font-semibold text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors">Cancelar</button>
        <button onClick={onSave} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-stampa-orange hover:bg-stampa-orange/90 text-white rounded-xl transition-colors shadow-sm">
          <Save size={16} /> Guardar
        </button>
      </div>
    </Card>
  );
}
