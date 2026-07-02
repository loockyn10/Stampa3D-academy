"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Plus, Edit2, Trash2, Save, X, ChevronDown, ChevronUp, Video } from "lucide-react";
import { LessonResourcesManager } from "./lesson-resources-manager";

export function ModulesManager({ courseId }: { courseId: string }) {
  const supabase = createClient();
  const [modules, setModules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Module state
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [moduleFormData, setModuleFormData] = useState({ title: "", description: "", sort_order: 0, is_active: true });

  // Lesson state
  const [lessons, setLessons] = useState<Record<string, any[]>>({}); // module_id -> lessons[]
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [activeModuleForLesson, setActiveModuleForLesson] = useState<string | null>(null);
  const [lessonFormData, setLessonFormData] = useState({ title: "", description: "", video_url: "", duration_minutes: 0, sort_order: 0, is_active: true });

  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchModulesAndLessons();
  }, [courseId]);

  const fetchModulesAndLessons = async () => {
    setLoading(true);
    const { data: mods, error: errMods } = await supabase
      .from("course_modules")
      .select("*")
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true });

    if (errMods) {
      setError(errMods.message);
      setLoading(false);
      return;
    }

    setModules(mods || []);

    const { data: less, error: errLess } = await supabase
      .from("lessons")
      .select("*")
      .in("module_id", (mods || []).map(m => m.id))
      .order("sort_order", { ascending: true });

    if (!errLess && less) {
      const grouped: Record<string, any[]> = {};
      less.forEach(l => {
        if (!grouped[l.module_id]) grouped[l.module_id] = [];
        grouped[l.module_id].push(l);
      });
      setLessons(grouped);
      
      // Auto expand modules
      const expanded: Record<string, boolean> = {};
      mods.forEach(m => expanded[m.id] = true);
      setExpandedModules(expanded);
    }
    
    setLoading(false);
  };

  const toggleModule = (id: string) => {
    setExpandedModules(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // --- MODULE ACTIONS ---
  const handleSaveModule = async () => {
    setError(null);
    if (editingModuleId === "new") {
      const { data, error: err } = await supabase
        .from("course_modules")
        .insert([{ ...moduleFormData, course_id: courseId }])
        .select()
        .single();
      if (err) setError(err.message);
      else {
        setModules([...modules, data]);
        setExpandedModules(prev => ({ ...prev, [data.id]: true }));
      }
    } else {
      const { error: err } = await supabase
        .from("course_modules")
        .update(moduleFormData)
        .eq("id", editingModuleId);
      if (err) setError(err.message);
      else {
        setModules(modules.map(m => m.id === editingModuleId ? { ...m, ...moduleFormData } : m));
      }
    }
    setEditingModuleId(null);
  };

  const handleDeleteModule = async (id: string) => {
    if (!confirm("¿Eliminar módulo y todas sus clases?")) return;
    const { error: err } = await supabase.from("course_modules").delete().eq("id", id);
    if (err) setError(err.message);
    else setModules(modules.filter(m => m.id !== id));
  };

  // --- LESSON ACTIONS ---
  const handleSaveLesson = async (moduleId: string) => {
    setError(null);
    if (editingLessonId === "new") {
      const { data, error: err } = await supabase
        .from("lessons")
        .insert([{ ...lessonFormData, module_id: moduleId }])
        .select()
        .single();
      if (err) setError(err.message);
      else {
        const current = lessons[moduleId] || [];
        setLessons({ ...lessons, [moduleId]: [...current, data] });
      }
    } else {
      const { error: err } = await supabase
        .from("lessons")
        .update(lessonFormData)
        .eq("id", editingLessonId);
      if (err) setError(err.message);
      else {
        const current = lessons[moduleId] || [];
        setLessons({ ...lessons, [moduleId]: current.map(l => l.id === editingLessonId ? { ...l, ...lessonFormData } : l) });
      }
    }
    setEditingLessonId(null);
    setActiveModuleForLesson(null);
  };

  const handleDeleteLesson = async (moduleId: string, id: string) => {
    if (!confirm("¿Eliminar clase?")) return;
    const { error: err } = await supabase.from("lessons").delete().eq("id", id);
    if (err) setError(err.message);
    else {
      const current = lessons[moduleId] || [];
      setLessons({ ...lessons, [moduleId]: current.filter(l => l.id !== id) });
    }
  };

  if (loading) {
    return <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-6 mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Módulos y Clases</h2>
        <button
          onClick={() => {
            setModuleFormData({ title: "", description: "", sort_order: modules.length + 1, is_active: true });
            setEditingModuleId("new");
          }}
          className="inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Agregar Módulo
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* NEW MODULE FORM */}
      {editingModuleId === "new" && (
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
          <h3 className="font-semibold text-gray-900">Nuevo Módulo</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="Título" value={moduleFormData.title} onChange={e => setModuleFormData({ ...moduleFormData, title: e.target.value })} className="w-full text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500" />
            <input type="number" placeholder="Orden" value={moduleFormData.sort_order} onChange={e => setModuleFormData({ ...moduleFormData, sort_order: parseInt(e.target.value) || 0 })} className="w-full text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500" />
            <div className="md:col-span-2">
              <textarea placeholder="Descripción (opcional)" value={moduleFormData.description} onChange={e => setModuleFormData({ ...moduleFormData, description: e.target.value })} className="w-full text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500" rows={2} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="mod_act_new" checked={moduleFormData.is_active} onChange={e => setModuleFormData({ ...moduleFormData, is_active: e.target.checked })} className="text-blue-600 rounded border-gray-300 focus:ring-orange-500" />
              <label htmlFor="mod_act_new" className="text-sm text-gray-700">Activo</label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditingModuleId(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
            <button onClick={handleSaveModule} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Guardar</button>
          </div>
        </div>
      )}

      {/* MODULES LIST */}
      <div className="space-y-4">
        {modules.map((mod) => (
          <div key={mod.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            {/* MODULE HEADER */}
            {editingModuleId === mod.id ? (
              <div className="p-4 bg-gray-50 border-b border-gray-200 space-y-4">
                <h3 className="font-semibold text-gray-900">Editar Módulo</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input type="text" placeholder="Título" value={moduleFormData.title} onChange={e => setModuleFormData({ ...moduleFormData, title: e.target.value })} className="w-full text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500" />
                  <input type="number" placeholder="Orden" value={moduleFormData.sort_order} onChange={e => setModuleFormData({ ...moduleFormData, sort_order: parseInt(e.target.value) || 0 })} className="w-full text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500" />
                  <div className="md:col-span-2">
                    <textarea placeholder="Descripción" value={moduleFormData.description} onChange={e => setModuleFormData({ ...moduleFormData, description: e.target.value })} className="w-full text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500" rows={2} />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id={`mod_act_${mod.id}`} checked={moduleFormData.is_active} onChange={e => setModuleFormData({ ...moduleFormData, is_active: e.target.checked })} className="text-blue-600 rounded border-gray-300 focus:ring-orange-500" />
                    <label htmlFor={`mod_act_${mod.id}`} className="text-sm text-gray-700">Activo</label>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditingModuleId(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
                  <button onClick={handleSaveModule} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Guardar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-4 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => toggleModule(mod.id)}>
                  {expandedModules[mod.id] ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
                  <div>
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                      Módulo {mod.sort_order}: {mod.title}
                      {!mod.is_active && <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium">Inactivo</span>}
                    </h3>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setModuleFormData({ title: mod.title, description: mod.description || "", sort_order: mod.sort_order, is_active: mod.is_active }); setEditingModuleId(mod.id); }} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg"><Edit2 size={16} /></button>
                  <button onClick={() => handleDeleteModule(mod.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg"><Trash2 size={16} /></button>
                </div>
              </div>
            )}

            {/* LESSONS LIST */}
            {expandedModules[mod.id] && (
              <div className="p-4 space-y-3">
                {(lessons[mod.id] || []).map((lesson) => (
                  <div key={lesson.id} className="border border-gray-100 rounded-lg p-3 flex flex-col gap-2 hover:bg-gray-50 transition-colors">
                    {editingLessonId === lesson.id ? (
                       <div className="w-full space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input type="text" placeholder="Título" value={lessonFormData.title} onChange={e => setLessonFormData({ ...lessonFormData, title: e.target.value })} className="text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md w-full focus:ring-orange-500 focus:border-orange-500" />
                          <input type="number" placeholder="Duración (min)" value={lessonFormData.duration_minutes} onChange={e => setLessonFormData({ ...lessonFormData, duration_minutes: parseInt(e.target.value) || 0 })} className="text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md w-full focus:ring-orange-500 focus:border-orange-500" />
                          <div className="md:col-span-2">
                            <input type="text" placeholder="URL del video" value={lessonFormData.video_url} onChange={e => setLessonFormData({ ...lessonFormData, video_url: e.target.value })} className="text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md w-full focus:ring-orange-500 focus:border-orange-500" />
                          </div>
                          <div className="md:col-span-2">
                            <textarea placeholder="Descripción (opcional)" value={lessonFormData.description} onChange={e => setLessonFormData({ ...lessonFormData, description: e.target.value })} className="text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md w-full focus:ring-orange-500 focus:border-orange-500" rows={2} />
                          </div>
                          <div className="flex items-center gap-4">
                            <input type="number" placeholder="Orden" value={lessonFormData.sort_order} onChange={e => setLessonFormData({ ...lessonFormData, sort_order: parseInt(e.target.value) || 0 })} className="text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md w-24 focus:ring-orange-500 focus:border-orange-500" />
                            <div className="flex items-center gap-2">
                              <input type="checkbox" id={`les_act_${lesson.id}`} checked={lessonFormData.is_active} onChange={e => setLessonFormData({ ...lessonFormData, is_active: e.target.checked })} className="text-blue-600 rounded border-gray-300 focus:ring-orange-500" />
                              <label htmlFor={`les_act_${lesson.id}`} className="text-sm text-gray-700">Activo</label>
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingLessonId(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
                          <button onClick={() => handleSaveLesson(mod.id)} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">Guardar Clase</button>
                        </div>
                      </div>
                    ) : (
                      <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-50 text-blue-600 rounded-md">
                            <Video size={16} />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                              {lesson.sort_order}. {lesson.title}
                              {!lesson.is_active && <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium">Inactivo</span>}
                            </p>
                            <p className="text-xs text-gray-500">{lesson.duration_minutes} min</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => {
                            setLessonFormData({ title: lesson.title, description: lesson.description || "", video_url: lesson.video_url || "", duration_minutes: lesson.duration_minutes || 0, sort_order: lesson.sort_order, is_active: lesson.is_active });
                            setEditingLessonId(lesson.id);
                            setActiveModuleForLesson(mod.id);
                          }} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg"><Edit2 size={14} /></button>
                          <button onClick={() => handleDeleteLesson(mod.id, lesson.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg"><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <LessonResourcesManager lessonId={lesson.id} />
                    </>
                    )}
                  </div>
                ))}

                {/* NEW LESSON FORM IN THIS MODULE */}
                {editingLessonId === "new" && activeModuleForLesson === mod.id ? (
                  <div className="border border-blue-100 bg-blue-50/30 rounded-lg p-3 space-y-3">
                    <h4 className="text-xs font-semibold text-gray-700 uppercase">Nueva Clase</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input type="text" placeholder="Título" value={lessonFormData.title} onChange={e => setLessonFormData({ ...lessonFormData, title: e.target.value })} className="text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md w-full focus:ring-orange-500 focus:border-orange-500" />
                      <input type="number" placeholder="Duración (min)" value={lessonFormData.duration_minutes} onChange={e => setLessonFormData({ ...lessonFormData, duration_minutes: parseInt(e.target.value) || 0 })} className="text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md w-full focus:ring-orange-500 focus:border-orange-500" />
                      <div className="md:col-span-2">
                        <input type="text" placeholder="URL del video" value={lessonFormData.video_url} onChange={e => setLessonFormData({ ...lessonFormData, video_url: e.target.value })} className="text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md w-full focus:ring-orange-500 focus:border-orange-500" />
                      </div>
                      <div className="md:col-span-2">
                        <textarea placeholder="Descripción (opcional)" value={lessonFormData.description} onChange={e => setLessonFormData({ ...lessonFormData, description: e.target.value })} className="text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md w-full focus:ring-orange-500 focus:border-orange-500" rows={2} />
                      </div>
                      <div className="flex items-center gap-4">
                        <input type="number" placeholder="Orden" value={lessonFormData.sort_order} onChange={e => setLessonFormData({ ...lessonFormData, sort_order: parseInt(e.target.value) || 0 })} className="text-sm bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded-md w-24 focus:ring-orange-500 focus:border-orange-500" />
                        <div className="flex items-center gap-2">
                          <input type="checkbox" id="les_act_new" checked={lessonFormData.is_active} onChange={e => setLessonFormData({ ...lessonFormData, is_active: e.target.checked })} className="text-blue-600 rounded border-gray-300 focus:ring-orange-500" />
                          <label htmlFor="les_act_new" className="text-sm text-gray-700">Activo</label>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setEditingLessonId(null); setActiveModuleForLesson(null); }} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
                      <button onClick={() => handleSaveLesson(mod.id)} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">Guardar Clase</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setLessonFormData({ title: "", description: "", video_url: "", duration_minutes: 0, sort_order: (lessons[mod.id] || []).length + 1, is_active: true });
                      setEditingLessonId("new");
                      setActiveModuleForLesson(mod.id);
                    }}
                    className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 font-medium hover:border-gray-300 hover:text-gray-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus size={16} /> Agregar Clase
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
