"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Plus, Edit2, Save, X } from "lucide-react";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";

export function StlVariantsManager({ modelId }: { modelId: string }) {
  const supabase = createClient();
  const [variants, setVariants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingVarId, setEditingVarId] = useState<string | null>(null);
  const [varForm, setVarForm] = useState({
    title: "",
    description: "",
    thumbnail_url: "",
    file_url: "",
    material_type: "",
    color: "",
    print_settings: "",
    is_active: true,
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
      .order("created_at", { ascending: true });

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
      title: varForm.title,
      description: varForm.description || null,
      thumbnail_url: varForm.thumbnail_url || null,
      file_url: varForm.file_url,
      material_type: varForm.material_type || null,
      color: varForm.color || null,
      print_settings: varForm.print_settings || null,
      is_active: varForm.is_active,
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
              title: "", description: "", thumbnail_url: "", file_url: "", material_type: "",
              color: "", print_settings: "",
              is_active: true
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
          <VariantFormEditor varForm={varForm} setVarForm={setVarForm} onSave={handleSaveVariant} onCancel={() => setEditingVarId(null)} modelId={modelId} />
        )}

        {variants.map((v) => (
          <div key={v.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden shadow-sm">
            {editingVarId === v.id ? (
              <VariantFormEditor varForm={varForm} setVarForm={setVarForm} onSave={handleSaveVariant} onCancel={() => setEditingVarId(null)} modelId={modelId} />
            ) : (
              <div className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="text-emerald-600 bg-emerald-50 p-3 rounded-lg">
                    <Save size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-gray-900">{v.title}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Material: {v.material_type || "N/A"} • Color: {v.color || "N/A"}
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

function VariantFormEditor({ varForm, setVarForm, onSave, onCancel, modelId }: any) {
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
          <input type="text" name="title" value={varForm.title} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="Ej. Archivo Original" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Enlace de Descarga (file_url) - Privado</label>
          <div className="space-y-3">
            <FileUploadDropzone
              bucket="stl-files"
              pathPrefix={`stl/${modelId}`}
              accept=".stl,.3mf,.zip,.obj,.step"
              onUploaded={(url) => setVarForm((prev: any) => ({ ...prev, file_url: url }))}
              label="Archivo descargable"
            />
            <div className="flex items-center gap-2">
              <hr className="flex-1 border-gray-200" />
              <span className="text-[10px] text-gray-400 font-semibold uppercase">O URL</span>
              <hr className="flex-1 border-gray-200" />
            </div>
            <input type="text" name="file_url" value={varForm.file_url} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="URL Externa o storage://..." />
          </div>
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-semibold text-gray-700">Miniatura (thumbnail_url) - Público</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FileUploadDropzone
              bucket="stl-thumbnails"
              pathPrefix={`stl-thumbnails/${modelId}`}
              accept=".jpg,.jpeg,.png,.webp,.svg"
              publicBucket={true}
              onUploaded={(url) => setVarForm((prev: any) => ({ ...prev, thumbnail_url: url }))}
              label="Subir Imagen"
            />
            <div className="flex flex-col justify-end space-y-2">
              <input type="text" name="thumbnail_url" value={varForm.thumbnail_url} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="URL Pública (https://...)" />
              {varForm.thumbnail_url && (
                <div className="h-24 w-24 rounded-lg bg-gray-100 overflow-hidden border border-gray-200">
                  <img src={varForm.thumbnail_url} alt="Miniatura" className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-semibold text-gray-700">Descripción Corta</label>
          <textarea name="description" value={varForm.description} onChange={handleChange} rows={2} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Material Sugerido</label>
          <input type="text" name="material_type" value={varForm.material_type} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="Ej. PLA" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Color Sugerido</label>
          <input type="text" name="color" value={varForm.color} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="Ej. Blanco" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-semibold text-gray-700">Configuración de Impresión</label>
          <textarea name="print_settings" value={varForm.print_settings} onChange={handleChange} rows={2} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="Ej. Relleno 20%, Sin soportes" />
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
