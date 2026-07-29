"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Save, CheckCircle2 } from "lucide-react";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";

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
    difficulty: "beginner",
    estimated_print_time: "",
    material_type: "",
    thumbnail_url: "",
    is_active: true,
    category_id: "",
    file_url: "",
  });

  const [variantId, setVariantId] = useState<string | null>(null);

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
            difficulty: modelData.difficulty || "beginner",
            estimated_print_time: modelData.estimated_print_time || "",
            material_type: modelData.material_type || "",
            thumbnail_url: modelData.thumbnail_url || "",
            is_active: modelData.is_active ?? true,
            category_id: modelData.category_id || "",
            file_url: "",
          });

          // Buscar la primera variante activa con archivo
          const { data: varData } = await supabase
            .from("stl_variants")
            .select("id, file_url")
            .eq("model_id", modelId)
            .eq("is_active", true)
            .not("file_url", "is", null)
            .order("created_at")
            .limit(1)
            .single();

          if (varData) {
            setVariantId(varData.id);
            setFormData(prev => ({ ...prev, file_url: varData.file_url }));
          }
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
      difficulty: formData.difficulty || null,
      estimated_print_time: formData.estimated_print_time || null,
      material_type: formData.material_type || null,
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
      const finalModelId = isEditing ? modelId : newId;

      if (finalModelId && formData.file_url) {
        const variantPayload = {
          model_id: finalModelId,
          title: formData.title,
          description: formData.description || null,
          file_url: formData.file_url,
          thumbnail_url: formData.thumbnail_url || null,
          material_type: formData.material_type || null,
          is_active: true,
          sort_order: 0,
        };

        if (variantId) {
          await supabase.from("stl_variants").update(variantPayload).eq("id", variantId);
        } else {
          const { data: newVar } = await supabase.from("stl_variants").insert([variantPayload]).select().single();
          if (newVar) setVariantId(newVar.id);
        }
      }

      setSuccess(isEditing ? "Archivo STL actualizado correctamente." : "Archivo STL creado correctamente.");
      if (!isEditing && finalModelId && finalModelId !== "undefined") {
        router.push(`/admin/stl/modelos/${finalModelId}`);
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

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-700">Dificultad (Opcional)</label>
          <select
            name="difficulty"
            value={formData.difficulty}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white"
          >
            <option value="beginner">Principiante</option>
            <option value="intermediate">Intermedio</option>
            <option value="advanced">Avanzado</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-700">Material Sugerido (Opcional)</label>
          <input
            type="text"
            name="material_type"
            value={formData.material_type}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white"
            placeholder="Ej. PLA, PETG"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-700">Tiempo Estimado (Opcional)</label>
          <input
            type="text"
            name="estimated_print_time"
            value={formData.estimated_print_time}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white"
            placeholder="Ej. 2h 30m"
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

        <div className="space-y-2 md:col-span-2 p-4 bg-gray-50 border border-gray-200 rounded-xl">
          <label className="text-sm font-semibold text-gray-700 block mb-2">Archivo descargable</label>
          
          {formData.file_url ? (
            <div className="mb-4 bg-green-50 text-green-700 p-3 rounded-lg flex items-center justify-between text-sm border border-green-100">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Archivo cargado</span>
              </div>
              <span className="text-xs text-green-600 truncate max-w-[200px] ml-4">{formData.file_url.split('/').pop() || formData.file_url}</span>
            </div>
          ) : (
            <div className="mb-4 bg-orange-50 text-orange-700 p-3 rounded-lg flex items-center gap-2 text-sm border border-orange-100">
              <AlertCircle className="h-5 w-5" />
              <span className="font-medium">Todavía no hay archivo cargado</span>
            </div>
          )}

          <FileUploadDropzone
            bucket="stl-files"
            pathPrefix={`stl/${modelId || 'new'}`}
            accept=".stl,.3mf,.zip"
            maxSizeMb={100}
            helperText="Subí el archivo que el usuario va a descargar. Formatos permitidos: STL, 3MF o ZIP. Máximo 100 MB."
            onUploaded={(url) => setFormData((prev) => ({ ...prev, file_url: url }))}
            label={formData.file_url ? "Reemplazar archivo" : "Subir archivo"}
          />
        </div>

        <div className="space-y-2 flex items-center pt-8 md:col-span-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-gray-700">
            <input
              type="checkbox"
              name="is_active"
              checked={formData.is_active}
              onChange={handleChange}
              className="rounded text-orange-600 focus:ring-orange-500"
            />
            Archivo Activo (Visible)
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
