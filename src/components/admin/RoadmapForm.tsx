"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import { Loader2, Save, X, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { 
  PRINTER_BRAND_OPTIONS, 
  EXPERIENCE_LEVEL_OPTIONS, 
  MAIN_GOAL_OPTIONS,
  COMMERCIAL_STAGE_OPTIONS
} from "@/lib/profile-options";

export function RoadmapForm({ initialData = null }: { initialData?: any }) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    name: initialData?.name || "",
    description: initialData?.description || "",
    printer_brand: initialData?.printer_brand || "",
    experience_level: initialData?.experience_level || "",
    main_goal: initialData?.main_goal || "",
    commercial_stage: initialData?.commercial_stage || "",
    is_default: initialData?.is_default || false,
    is_active: initialData?.is_active ?? true,
    sort_order: initialData?.sort_order || 0,
  });

  const [pathCourses, setPathCourses] = useState<any[]>(
    initialData?.learning_path_courses?.map((lpc: any) => ({
      course_id: lpc.course_id,
      reason: lpc.reason || "",
      sort_order: lpc.sort_order || 0
    })) || []
  );

  useEffect(() => {
    const fetchCourses = async () => {
      const { data } = await supabase.from("courses").select("id, title").eq("status", "published").order("created_at", { ascending: false });
      if (data) setCourses(data);
    };
    fetchCourses();
  }, [supabase]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let finalValue: any = value;
    
    if (type === "checkbox") {
      finalValue = (e.target as HTMLInputElement).checked;
    } else if (value === "null" || value === "") {
      finalValue = null;
    }

    setFormData((prev) => ({ ...prev, [name]: finalValue }));
  };

  const handleAddCourse = () => {
    if (courses.length === 0) return;
    setPathCourses((prev) => [
      ...prev,
      { course_id: courses[0].id, reason: "", sort_order: prev.length }
    ]);
  };

  const handleRemoveCourse = (index: number) => {
    setPathCourses((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCourseChange = (index: number, field: string, value: string | number) => {
    setPathCourses((prev) => {
      const newCourses = [...prev];
      newCourses[index] = { ...newCourses[index], [field]: value };
      return newCourses;
    });
  };

  const moveCourse = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index > 0) {
      setPathCourses(prev => {
        const newCourses = [...prev];
        const temp = newCourses[index];
        newCourses[index] = newCourses[index - 1];
        newCourses[index - 1] = temp;
        // update sort_orders
        newCourses[index].sort_order = index;
        newCourses[index - 1].sort_order = index - 1;
        return newCourses;
      });
    } else if (direction === 'down' && index < pathCourses.length - 1) {
      setPathCourses(prev => {
        const newCourses = [...prev];
        const temp = newCourses[index];
        newCourses[index] = newCourses[index + 1];
        newCourses[index + 1] = temp;
        // update sort_orders
        newCourses[index].sort_order = index;
        newCourses[index + 1].sort_order = index + 1;
        return newCourses;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      let pathId = initialData?.id;

      if (pathId) {
        // Update existing
        await supabase.from("learning_paths").update(formData).eq("id", pathId);
      } else {
        // Create new
        const { data, error } = await supabase.from("learning_paths").insert(formData).select().single();
        if (error) throw error;
        pathId = data.id;
      }

      // Update courses
      if (pathId) {
        // Delete old
        await supabase.from("learning_path_courses").delete().eq("learning_path_id", pathId);
        
        // Insert new
        if (pathCourses.length > 0) {
          const coursesToInsert = pathCourses.map((pc, i) => ({
            learning_path_id: pathId,
            course_id: pc.course_id,
            reason: pc.reason,
            sort_order: i
          }));
          await supabase.from("learning_path_courses").insert(coursesToInsert);
        }
      }

      router.push("/admin/roadmaps");
      router.refresh();
    } catch (error) {
      console.error("Error saving roadmap:", error);
      alert("Hubo un error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="bg-stampa-surface p-6 rounded-2xl border border-stampa-border shadow-lg space-y-6">
        <h2 className="text-xl font-bold text-white mb-4">Detalles del Roadmap</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Nombre</label>
            <input
              type="text"
              name="name"
              required
              value={formData.name}
              onChange={handleChange}
              className="w-full bg-[#1a1a1a] border border-stampa-border rounded-xl px-4 py-2.5 text-white focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none transition-all"
              placeholder="Ej: Principiante Bambu"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Orden (Sort Order)</label>
            <input
              type="number"
              name="sort_order"
              value={formData.sort_order}
              onChange={handleChange}
              className="w-full bg-[#1a1a1a] border border-stampa-border rounded-xl px-4 py-2.5 text-white focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-gray-300">Descripción</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={2}
              className="w-full bg-[#1a1a1a] border border-stampa-border rounded-xl px-4 py-2.5 text-white focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none transition-all resize-none"
            />
          </div>
        </div>
      </div>

      <div className="bg-stampa-surface p-6 rounded-2xl border border-stampa-border shadow-lg space-y-6">
        <h2 className="text-xl font-bold text-white mb-4">Criterios de Matching (Filtros)</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Marca de Impresora</label>
            <select
              name="printer_brand"
              value={formData.printer_brand || ""}
              onChange={handleChange}
              className="w-full bg-[#1a1a1a] border border-stampa-border rounded-xl px-4 py-2.5 text-white focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none transition-all"
            >
              <option value="">Cualquier marca</option>
              {PRINTER_BRAND_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Nivel de Experiencia</label>
            <select
              name="experience_level"
              value={formData.experience_level || ""}
              onChange={handleChange}
              className="w-full bg-[#1a1a1a] border border-stampa-border rounded-xl px-4 py-2.5 text-white focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none transition-all"
            >
              <option value="">Cualquier nivel</option>
              {EXPERIENCE_LEVEL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Objetivo Principal</label>
            <select
              name="main_goal"
              value={formData.main_goal || ""}
              onChange={handleChange}
              className="w-full bg-[#1a1a1a] border border-stampa-border rounded-xl px-4 py-2.5 text-white focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none transition-all"
            >
              <option value="">Cualquier objetivo</option>
              {MAIN_GOAL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Etapa Comercial</label>
            <select
              name="commercial_stage"
              value={formData.commercial_stage || ""}
              onChange={handleChange}
              className="w-full bg-[#1a1a1a] border border-stampa-border rounded-xl px-4 py-2.5 text-white focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none transition-all"
            >
              <option value="">Cualquier etapa</option>
              {COMMERCIAL_STAGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-6 mt-4">
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              name="is_default"
              checked={formData.is_default}
              onChange={handleChange}
              className="w-4 h-4 rounded bg-[#1a1a1a] border-white/20 text-pink-500 focus:ring-pink-500 focus:ring-offset-0"
            />
            Roadmap por defecto (Fallback)
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              name="is_active"
              checked={formData.is_active}
              onChange={handleChange}
              className="w-4 h-4 rounded bg-[#1a1a1a] border-white/20 text-pink-500 focus:ring-pink-500 focus:ring-offset-0"
            />
            Activo
          </label>
        </div>
      </div>

      <div className="bg-stampa-surface p-6 rounded-2xl border border-stampa-border shadow-lg space-y-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Cursos del Roadmap</h2>
          <button
            type="button"
            onClick={handleAddCourse}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border border-stampa-border"
          >
            <Plus size={16} /> Añadir Curso
          </button>
        </div>

        <div className="space-y-4">
          {pathCourses.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No hay cursos en este roadmap.</p>
          ) : (
            pathCourses.map((pc, idx) => (
              <div key={idx} className="flex gap-4 items-start bg-[#1a1a1a] p-4 rounded-xl border border-stampa-border">
                <div className="flex flex-col gap-1">
                  <button type="button" onClick={() => moveCourse(idx, 'up')} disabled={idx === 0} className="text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
                    <ArrowUp size={16} />
                  </button>
                  <button type="button" onClick={() => moveCourse(idx, 'down')} disabled={idx === pathCourses.length - 1} className="text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
                    <ArrowDown size={16} />
                  </button>
                </div>
                
                <div className="flex-1 space-y-3">
                  <select
                    value={pc.course_id}
                    onChange={(e) => handleCourseChange(idx, "course_id", e.target.value)}
                    className="w-full bg-stampa-surface border border-stampa-border rounded-lg px-3 py-2 text-white focus:border-pink-500 outline-none"
                  >
                    {courses.map(c => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                  
                  <input
                    type="text"
                    value={pc.reason}
                    onChange={(e) => handleCourseChange(idx, "reason", e.target.value)}
                    placeholder="Motivo sugerido (Ej: 'Base necesaria antes de avanzar')"
                    className="w-full bg-stampa-surface border border-stampa-border rounded-lg px-3 py-2 text-white focus:border-pink-500 outline-none text-sm"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveCourse(idx)}
                  className="text-gray-500 hover:text-red-500 mt-2 transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button
          type="button"
          onClick={() => router.push("/admin/roadmaps")}
          className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white px-6 py-2.5 rounded-xl font-medium transition-colors"
        >
          <X size={18} /> Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 bg-pink-600 hover:bg-pink-700 text-white px-6 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          Guardar Roadmap
        </button>
      </div>
    </form>
  );
}
