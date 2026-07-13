"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Save } from "lucide-react";

export function StlModelForm({ modelId }: { modelId?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const isEditing = !!modelId && modelId !== "undefined";

  const [loadingData, setLoadingData] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [categories, setCategories] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    thumbnail_url: "",
    is_active: true,
    category_id: "",
  });

  useEffect(() => {
    const fetchData = async () => {
      const { data: catsData } = await supabase.from("stl_categories").select("id, name").order("sort_order");
      if (catsData) setCategories(catsData);

      if (isEditing) {
        const { data: modelData, error: modelError } = await supabase
          .from("stl_models")
          .select("*")
          .eq("id", modelId)
          .single();

        if (modelError) {
          setError("Error cargando el modelo STL.");
        } else if (modelData) {
          setFormData({
            title: modelData.title || "",
            description: modelData.description || "",
            thumbnail_url: modelData.thumbnail_url || "",
            is_active: modelData.is_active ?? true,
            category_id: modelData.category_id || "",
          });
        }
        setLoadingData(false);
      }
    };
    fetchData();
  }, [modelId, isEditing, supabase]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload = {
      title: formData.title,
      description: formData.description || null,
      thumbnail_url: formData.thumbnail_url || null,
      is_active: formData.is_active,
      category_id: formData.category_id && formData.category_id !== "undefined" && formData.category_id !== "" ? formData.category_id : null,
    };

    let opError = null;
    let newId = null;

    if (isEditing) {
      const { error: updateError } = await supabase
        .from("stl_models")
        .update(payload)
        .eq("id", modelId);
      opError = updateError;
    } else {
      const { data: insertedData, error: insertError } = await supabase
        .from("stl_models")
        .insert([payload])
        .select()
        .single();
      opError = insertError;
      if (insertedData) newId = insertedData.id;
    }

    setSaving(false);

    if (opError) {
      setError(opError.message);
    } else {
      setSuccess(isEditing ? "Modelo actualizado correctamente." : "Modelo creado correctamente.");
      if (!isEditing && newId && newId !== "undefined") {
        router.push(`/admin/stl/modelos/${newId}`);
      }
    }
  };

  if (loadingData) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
      
      {success && (
        <div className="bg-green-50 text-green-700 p-4 rounded-lg text-sm border border-green-100">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-semibold text-gray-700">Título del Modelo *</label>
          <input
            required
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white"
            placeholder="Ej. Maceta Geométrica"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-700">Categoría</label>
          <select
            name="category_id"
            value={formData.category_id}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white"
          >
            <option value="">-- Sin categoría --</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-semibold text-gray-700">Descripción (Opcional)</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={4}
            className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-semibold text-gray-700">Miniatura (Opcional)</label>
          <input
            type="text"
            name="thumbnail_url"
            value={formData.thumbnail_url}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white"
            placeholder="https://ejemplo.com/imagen.jpg o usa un Dropzone en otra sección"
          />
        </div>

        <div className="space-y-2 flex items-center pt-8">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-gray-700">
            <input
              type="checkbox"
              name="is_active"
              checked={formData.is_active}
              onChange={handleChange}
              className="rounded text-orange-600 focus:ring-orange-500"
            />
            Modelo Activo (Visible)
          </label>
        </div>
      </div>

      <div className="pt-4 border-t border-gray-100 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          {isEditing ? "Guardar Cambios" : "Crear Modelo"}
        </button>
      </div>
    </form>
  );
}
