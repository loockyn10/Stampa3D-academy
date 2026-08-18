"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Save, Upload, Image as ImageIcon, X } from "lucide-react";
import Image from "next/image";

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

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
    course_kind: "course",
  });

  useEffect(() => {
    const fetchData = async () => {
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
            course_kind: courseData.course_kind || "course",
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setError("El archivo debe ser JPG, PNG o WEBP.");
      return;
    }
    
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setError("El archivo debe pesar menos de 5MB.");
      return;
    }

    setError(null);
    setThumbnailFile(file);
    setThumbnailPreview(URL.createObjectURL(file));
    // Clear manual URL if file selected
    setFormData(prev => ({ ...prev, thumbnail_url: "" }));
  };

  const clearThumbnail = () => {
    setThumbnailFile(null);
    setThumbnailPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
    let finalId = courseId;

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
      finalId = data?.id;
    }

    if (opError) {
      setError(opError.message);
      setSaving(false);
      return;
    }

    if (thumbnailFile && finalId) {
      const ext = thumbnailFile.name.split(".").pop();
      const uuid = crypto.randomUUID();
      const path = `courses/${finalId}/${uuid}-cover.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("course-thumbnails")
        .upload(path, thumbnailFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: thumbnailFile.type,
        });

      if (uploadError) {
        setError(`Curso guardado, pero falló la subida de imagen: ${uploadError.message}`);
        setSaving(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("course-thumbnails")
        .getPublicUrl(path);

      await supabase
        .from("courses")
        .update({ thumbnail_url: publicUrlData.publicUrl })
        .eq("id", finalId);
    }

    setSuccess("Curso guardado correctamente.");
    setSaving(false);
    if (!isEditing && finalId) {
      router.push(`/admin/cursos/${finalId}`);
    } else if (isEditing && thumbnailFile) {
      // Reload page to get new thumbnail URL in formData or just keep going
      // For now, clear the file state since it's uploaded
      clearThumbnail();
      // Optionally reload data but the next reload will fetch it
    }
  };

  if (loadingData) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-blue-600 h-8 w-8" />
      </div>
    );
  }

  const showPreview = thumbnailPreview || formData.thumbnail_url;
  const isWorkshop = formData.course_kind === "workshop";

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-stampa-surface p-6 rounded-xl border border-stampa-border shadow-sm">
      {error && (
        <div className="bg-red-50/10 text-red-400 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-500/20">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      
      {success && (
        <div className="bg-green-50/10 text-green-400 p-4 rounded-lg flex items-center gap-2 text-sm border border-green-500/20">
          <Save className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Título y Slug */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">Título del Curso</label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            required
            className="w-full text-sm bg-stampa-surface text-neutral-100 border-stampa-border rounded-md shadow-sm border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">Slug (URL)</label>
          <input
            type="text"
            name="slug"
            value={formData.slug}
            onChange={handleChange}
            required
            className="w-full text-sm bg-stampa-surface text-neutral-100 border-stampa-border rounded-md shadow-sm border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          />
        </div>

        {/* Descripción */}
        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium text-gray-300">Descripción</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={3}
            className="w-full text-sm bg-stampa-surface text-neutral-100 border-stampa-border rounded-md shadow-sm border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          />
        </div>

        {/* Portada / Thumbnail Upload */}
        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium text-gray-300">
            {isWorkshop ? "Portada del taller" : "Portada del curso"}
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Usá una imagen horizontal, idealmente 16:9. Recomendado: 1280x720px en JPG o WEBP (máx 5MB).
          </p>
          
          <div className="mt-1 flex flex-col gap-4">
            {showPreview ? (
              <div className="relative aspect-video w-full max-w-sm rounded-lg overflow-hidden border border-stampa-border group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={thumbnailPreview || formData.thumbnail_url} 
                  alt="Preview" 
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-stampa-bg/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-colors"
                    title="Cambiar imagen"
                  >
                    <Upload size={18} />
                  </button>
                  {thumbnailFile && (
                    <button
                      type="button"
                      onClick={clearThumbnail}
                      className="p-2 bg-red-500/80 hover:bg-red-500 text-white rounded-full backdrop-blur-md transition-colors"
                      title="Quitar archivo"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full max-w-sm aspect-video border-2 border-dashed border-stampa-border hover:border-stampa-orange/40 bg-white/5 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors text-neutral-400 hover:text-neutral-200"
              >
                <ImageIcon className="mb-2 h-8 w-8 opacity-50" />
                <span className="text-sm font-medium">Subir imagen</span>
                <span className="text-xs opacity-60">JPG, PNG, WEBP</span>
              </div>
            )}
            
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
            />
            
            <div className="flex items-center gap-2 max-w-sm">
              <span className="text-xs text-neutral-500 shrink-0">O usar URL:</span>
              <input
                type="text"
                name="thumbnail_url"
                value={formData.thumbnail_url}
                onChange={handleChange}
                placeholder="https://..."
                className="w-full text-xs bg-stampa-surface text-neutral-100 border-stampa-border rounded-md shadow-sm border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-600 disabled:bg-neutral-800 disabled:text-neutral-500"
              />
            </div>
          </div>
        </div>

        {/* Categoría e Instructor */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">Categoría</label>
          <select
            name="category_id"
            value={formData.category_id}
            onChange={handleChange}
            className="w-full text-sm bg-stampa-surface text-neutral-100 border-stampa-border rounded-md shadow-sm border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            <option value="" className="text-white bg-stampa-surface">Selecciona una categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id} className="text-white bg-stampa-surface">{c.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">Instructor</label>
          <select
            name="instructor_id"
            value={formData.instructor_id}
            onChange={handleChange}
            className="w-full text-sm bg-stampa-surface text-neutral-100 border-stampa-border rounded-md shadow-sm border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            <option value="" className="text-white bg-stampa-surface">Selecciona un instructor</option>
            {instructors.map((i) => (
              <option key={i.id} value={i.id} className="text-white bg-stampa-surface">{i.name}</option>
            ))}
          </select>
        </div>

        {/* Nivel y Tipo */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">Nivel</label>
          <select
            name="level"
            value={formData.level}
            onChange={handleChange}
            className="w-full text-sm bg-stampa-surface text-neutral-100 border-stampa-border rounded-md shadow-sm border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            <option value="beginner" className="text-white bg-stampa-surface">Principiante</option>
            <option value="intermediate" className="text-white bg-stampa-surface">Intermedio</option>
            <option value="advanced" className="text-white bg-stampa-surface">Avanzado</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300 flex items-center justify-between">
            Tipo de contenido
          </label>
          <select
            name="course_kind"
            value={formData.course_kind}
            onChange={handleChange}
            className="w-full text-sm bg-stampa-surface text-neutral-100 border-stampa-border rounded-md shadow-sm border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            <option value="course" className="text-white bg-stampa-surface">Curso</option>
            <option value="workshop" className="text-white bg-stampa-surface">Taller</option>
          </select>
          <p className="text-xs text-gray-500">Usá Curso para rutas estructuradas y Taller para proyectos prácticos.</p>
        </div>

        {/* Orden y Estado */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">Orden</label>
          <input
            type="number"
            name="sort_order"
            value={formData.sort_order}
            onChange={handleChange}
            className="w-full text-sm bg-stampa-surface text-neutral-100 border-stampa-border rounded-md shadow-sm border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">Estado</label>
          <select
            name="status"
            value={formData.status}
            onChange={handleChange}
            className="w-full text-sm bg-stampa-surface text-neutral-100 border-stampa-border rounded-md shadow-sm border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            <option value="draft" className="text-white bg-stampa-surface">Borrador</option>
            <option value="published" className="text-white bg-stampa-surface">Publicado</option>
            <option value="archived" className="text-white bg-stampa-surface">Archivado</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t border-stampa-border">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="animate-spin h-4 w-4" />
              <span>Subiendo...</span>
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              <span>{isEditing ? "Guardar Cambios" : "Crear Curso"}</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
