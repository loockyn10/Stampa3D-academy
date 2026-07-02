"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Save } from "lucide-react";

export function CourseForm({ courseId }: { courseId?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const isEditing = !!courseId;

  const [loadingData, setLoadingData] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [categories, setCategories] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    title: "",
    slug: "",
    description: "",
    thumbnail_url: "",
    level: "beginner",
    status: "draft",
    sort_order: 0,
    category_id: "",
    instructor_id: "",
  });

  useEffect(() => {
    const fetchData = async () => {
      // Fetch categories and instructors
      const [catsRes, instRes] = await Promise.all([
        supabase.from("course_categories").select("id, name"),
        supabase.from("instructors").select("id, name"),
      ]);

      if (catsRes.data) setCategories(catsRes.data);
      if (instRes.data) setInstructors(instRes.data);

      if (isEditing) {
        const { data: courseData, error: courseError } = await supabase
          .from("courses")
          .select("*")
          .eq("id", courseId)
          .single();

        if (courseError) {
          setError("Error cargando el curso.");
        } else if (courseData) {
          setFormData({
            title: courseData.title || "",
            slug: courseData.slug || "",
            description: courseData.description || "",
            thumbnail_url: courseData.thumbnail_url || "",
            level: courseData.level || "beginner",
            status: courseData.status || "draft",
            sort_order: courseData.sort_order || 0,
            category_id: courseData.category_id || "",
            instructor_id: courseData.instructor_id || "",
          });
        }
        setLoadingData(false);
      }
    };
    fetchData();
  }, [courseId, isEditing, supabase]);

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
      ...formData,
      category_id: formData.category_id || null,
      instructor_id: formData.instructor_id || null,
    };

    let opError = null;
    let newId = null;

    if (isEditing) {
      const { error: updateError } = await supabase
        .from("courses")
        .update(payload)
        .eq("id", courseId);
      opError = updateError;
    } else {
      const { data, error: insertError } = await supabase
        .from("courses")
        .insert([payload])
        .select()
        .single();
      opError = insertError;
      newId = data?.id;
    }

    if (opError) {
      setError(opError.message);
      setSaving(false);
    } else {
      setSuccess("Curso guardado correctamente.");
      setSaving(false);
      if (!isEditing && newId) {
        router.push(`/admin/cursos/${newId}`);
      }
    }
  };

  if (loadingData) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-blue-600 h-8 w-8" />
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
        <div className="bg-green-50 text-green-700 p-4 rounded-lg flex items-center gap-2 text-sm border border-green-100">
          <Save className="h-4 w-4" />
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Título del Curso</label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            required
            className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
          />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Slug (URL)</label>
          <input
            type="text"
            name="slug"
            value={formData.slug}
            onChange={handleChange}
            required
            className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium text-gray-700">Descripción</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={3}
            className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium text-gray-700">URL de la Imagen (Thumbnail)</label>
          <input
            type="text"
            name="thumbnail_url"
            value={formData.thumbnail_url}
            onChange={handleChange}
            placeholder="https://..."
            className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Categoría</label>
          <select
            name="category_id"
            value={formData.category_id}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
          >
            <option value="">Selecciona una categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Instructor</label>
          <select
            name="instructor_id"
            value={formData.instructor_id}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
          >
            <option value="">Selecciona un instructor</option>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Nivel</label>
          <select
            name="level"
            value={formData.level}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
          >
            <option value="beginner">Principiante</option>
            <option value="intermediate">Intermedio</option>
            <option value="advanced">Avanzado</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Orden</label>
          <input
            type="number"
            name="sort_order"
            value={formData.sort_order}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Estado</label>
          <select
            name="status"
            value={formData.status}
            onChange={handleChange}
            className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
          >
            <option value="draft">Borrador</option>
            <option value="published">Publicado</option>
            <option value="archived">Archivado</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t border-gray-100">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin h-4 w-4" /> : <Save className="h-4 w-4" />}
          {isEditing ? "Guardar Cambios" : "Crear Curso"}
        </button>
      </div>
    </form>
  );
}
