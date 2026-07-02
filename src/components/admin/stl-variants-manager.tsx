"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Plus, Edit2, Save, X } from "lucide-react";

export function StlVariantsManager({ modelId }: { modelId: string }) {
  const supabase = createClient();
  const [variants, setVariants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingVarId, setEditingVarId] = useState<string | null>(null);
  const [varForm, setVarForm] = useState({
    name: "",
    description: "",
    thumbnail_url: "",
    file_url: "",
    material_recommended: "",
    estimated_print_time_minutes: 0,
    estimated_weight_grams: 0,
    difficulty: "easy",
    is_active: true,
    sort_order: 0,
  });

  useEffect(() => {
    if (modelId && modelId !== "undefined") {
      fetchVariants();
    } else {
      setLoading(false);
    }
  }, [modelId]);

  const fetchVariants = async () => {
    if (!modelId || modelId === "undefined") {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("stl_variants")
      .select("*")
      .eq("model_id", modelId)
      .order("sort_order", { ascending: true });

    if (error) setError(error.message);
    else setVariants(data || []);
    setLoading(false);
  };

  const handleSaveVariant = async () => {
    if (!modelId || modelId === "undefined") {
      setError("No se puede guardar una variante sin un ID de modelo válido.");
      return;
    }
    setError(null);
    const payload = {
      name: varForm.name,
      description: varForm.description,
      thumbnail_url: varForm.thumbnail_url,
      file_url: varForm.file_url,
      material_recommended: varForm.material_recommended,
      estimated_print_time_minutes: parseInt(String(varForm.estimated_print_time_minutes)) || 0,
      estimated_weight_grams: parseInt(String(varForm.estimated_weight_grams)) || 0,
      difficulty: varForm.difficulty || "easy",
      is_active: varForm.is_active,
      sort_order: parseInt(String(varForm.sort_order)) || 0,
      model_id: modelId,
    };

    if (editingVarId === "new") {
      const { data, error: err } = await supabase.from("stl_variants").insert([payload]).select().single();
      if (err) setError(err.message);
      else setVariants([...variants, data]);
    } else {
      const { error: err } = await supabase.from("stl_variants").update(payload).eq("id", editingVarId);
      if (err) setError(err.message);
      else setVariants(variants.map(v => v.id === editingVarId ? { ...v, ...payload } : v));
    }
    setEditingVarId(null);
  };

  if (loading) return <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-emerald-600" /></div>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Archivos y Variantes</h3>
        <button
          onClick={() => {
            setVarForm({
              name: "", description: "", thumbnail_url: "", file_url: "", material_recommended: "",
              estimated_print_time_minutes: 0, estimated_weight_grams: 0, difficulty: "easy",
              is_active: true, sort_order: variants.length + 1
            });
            setEditingVarId("new");
          }}
          className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Agregar Variante
        </button>
      </div>

      <div className="space-y-3">
        {editingVarId === "new" && (
          <VariantFormEditor varForm={varForm} setVarForm={setVarForm} onSave={handleSaveVariant} onCancel={() => setEditingVarId(null)} />
        )}

        {variants.map((v) => (
          <div key={v.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden shadow-sm">
            {editingVarId === v.id ? (
              <VariantFormEditor varForm={varForm} setVarForm={setVarForm} onSave={handleSaveVariant} onCancel={() => setEditingVarId(null)} />
            ) : (
              <div className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="text-emerald-600 bg-emerald-50 p-3 rounded-lg">
                    <Save size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-gray-900">{v.name}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Dificultad: {v.difficulty} • Material: {v.material_recommended || "N/A"} • Peso: {v.estimated_weight_grams}g • Tiempo: {v.estimated_print_time_minutes}m
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {!v.is_active && <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Inactivo</span>}
                  <button
                    onClick={() => { setVarForm(v); setEditingVarId(v.id); }}
                    className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                  >
                    <Edit2 size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {variants.length === 0 && editingVarId !== "new" && (
          <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
            <p className="text-sm text-gray-500">No hay variantes cargadas para este modelo.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function VariantFormEditor({ varForm, setVarForm, onSave, onCancel }: any) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setVarForm((prev: any) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setVarForm((prev: any) => ({ ...prev, [name]: value }));
    }
  };

  return (
    <div className="p-4 bg-gray-50 border-b border-gray-200">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Nombre Variante</label>
          <input type="text" name="name" value={varForm.name} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="Ej. Archivo Original" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Enlace de Descarga (file_url)</label>
          <input type="text" name="file_url" value={varForm.file_url} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="URL Drive o Supabase" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-semibold text-gray-700">Descripción Corta</label>
          <textarea name="description" value={varForm.description} onChange={handleChange} rows={2} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Dificultad</label>
          <select name="difficulty" value={varForm.difficulty} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white">
            <option value="easy">Fácil</option>
            <option value="medium">Medio</option>
            <option value="hard">Difícil</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Material Recomendado</label>
          <input type="text" name="material_recommended" value={varForm.material_recommended} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="Ej. PLA, PETG" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Tiempo Impresión (mins)</label>
          <input type="number" name="estimated_print_time_minutes" value={varForm.estimated_print_time_minutes} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Peso Estimado (g)</label>
          <input type="number" name="estimated_weight_grams" value={varForm.estimated_weight_grams} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Orden</label>
          <input type="number" name="sort_order" value={varForm.sort_order} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
        </div>
        <div className="space-y-1 flex items-end pb-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
            <input type="checkbox" name="is_active" checked={varForm.is_active} onChange={handleChange} className="rounded text-orange-600 focus:ring-orange-500" />
            Activa
          </label>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-md transition-colors">Cancelar</button>
        <button onClick={onSave} className="px-3 py-1.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-md transition-colors">Guardar Variante</button>
      </div>
    </div>
  );
}
