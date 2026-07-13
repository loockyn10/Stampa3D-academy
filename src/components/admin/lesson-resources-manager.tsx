"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, Plus, Edit2, Trash2, File, Link as LinkIcon, Settings } from "lucide-react";

interface LessonResourcesManagerProps {
  lessonId: string;
}

export function LessonResourcesManager({ lessonId }: LessonResourcesManagerProps) {
  const supabase = createClient();
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    resource_type: "pdf",
    url: "",
    sort_order: 1,
    is_active: true
  });

  useEffect(() => {
    fetchResources();
  }, [lessonId]);

  const fetchResources = async () => {
    setLoading(true);
    const { data, error: fetchErr } = await supabase
      .from("lesson_resources")
      .select("*")
      .eq("lesson_id", lessonId)
      .order("sort_order", { ascending: true });

    if (fetchErr) setError(fetchErr.message);
    else setResources(data || []);
    setLoading(false);
  };

  const handleSave = async () => {
    setError(null);
    if (!formData.title || !formData.resource_type || !formData.url) {
      setError("Título, tipo y URL son obligatorios");
      return;
    }
    
    if (!formData.url.startsWith("http://") && !formData.url.startsWith("https://")) {
      setError("La URL debe empezar con http:// o https://");
      return;
    }

    if (editingId === "new") {
      const { data, error: err } = await supabase
        .from("lesson_resources")
        .insert([{ ...formData, lesson_id: lessonId }])
        .select()
        .single();
      if (err) setError(err.message);
      else {
        setResources([...resources, data]);
        setEditingId(null);
      }
    } else {
      const { error: err } = await supabase
        .from("lesson_resources")
        .update(formData)
        .eq("id", editingId);
      if (err) setError(err.message);
      else {
        setResources(resources.map(r => r.id === editingId ? { ...r, ...formData } : r));
        setEditingId(null);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este recurso?")) return;
    const { error: err } = await supabase.from("lesson_resources").delete().eq("id", id);
    if (err) setError(err.message);
    else setResources(resources.filter(r => r.id !== id));
  };

  if (loading) return <div className="text-center p-2"><Loader2 className="animate-spin h-4 w-4 mx-auto text-gray-400" /></div>;

  return (
    <div className="mt-3 pl-10 border-l-2 border-gray-100 ml-4 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold text-gray-500 uppercase flex items-center gap-1">
          <Settings size={12} /> Recursos Descargables ({resources.length})
        </h5>
        <button
          onClick={() => {
            setFormData({ title: "", resource_type: "pdf", url: "", sort_order: resources.length + 1, is_active: true });
            setEditingId("new");
          }}
          className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded flex items-center gap-1 font-medium"
        >
          <Plus size={10} /> Añadir Recurso
        </button>
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      <div className="space-y-2">
        {resources.map((res) => (
          <div key={res.id} className="flex items-center justify-between bg-white border border-gray-100 p-2 rounded text-sm shadow-sm">
            {editingId === res.id ? (
              <div className="w-full space-y-3 bg-blue-50/30 p-3 rounded-lg border border-blue-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">Título</label>
                    <input type="text" placeholder="Ej. Guía PDF" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} className="w-full text-xs bg-white text-gray-900 placeholder-gray-400 border-gray-300 rounded focus:ring-orange-500 focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">Tipo de recurso</label>
                    <select value={formData.resource_type} onChange={e => setFormData({ ...formData, resource_type: e.target.value })} className="w-full text-xs bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded focus:ring-orange-500 focus:border-orange-500">
                      <option value="pdf" className="text-gray-900 bg-white">PDF</option>
                      <option value="stl" className="text-gray-900 bg-white">STL</option>
                      <option value="zip" className="text-gray-900 bg-white">ZIP</option>
                      <option value="link" className="text-gray-900 bg-white">Link</option>
                      <option value="other" className="text-gray-900 bg-white">Otro</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">URL del recurso</label>
                    <input type="text" placeholder="https://..." value={formData.url} onChange={e => setFormData({ ...formData, url: e.target.value })} className="w-full text-xs bg-white text-gray-900 placeholder-gray-400 border-gray-300 rounded focus:ring-orange-500 focus:border-orange-500" />
                    <p className="mt-1 text-[10px] text-gray-500">Pegá acá el link al PDF, STL, ZIP o recurso externo. Más adelante se podrá subir archivos directamente.</p>
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-4 border-t border-blue-100 pt-3 mt-1">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-semibold text-gray-600 uppercase">Orden:</label>
                      <input type="number" placeholder="1" value={formData.sort_order} onChange={e => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })} className="w-16 text-xs bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded focus:ring-orange-500 focus:border-orange-500 py-1" />
                    </div>
                    <label className="text-xs flex items-center gap-1.5 text-gray-700 font-medium bg-white px-2 py-1 rounded border border-gray-200">
                      <input type="checkbox" checked={formData.is_active} onChange={e => setFormData({ ...formData, is_active: e.target.checked })} className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5 focus:ring-orange-500" />
                      Activo
                    </label>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setEditingId(null)} className="text-[10px] font-semibold px-3 py-1.5 text-gray-600 hover:bg-gray-200 bg-gray-100 rounded transition-colors">Cancelar</button>
                  <button onClick={handleSave} className="text-[10px] font-semibold px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">Guardar</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 overflow-hidden">
                  {res.resource_type === 'link' ? <LinkIcon size={12} className="text-blue-500 shrink-0" /> : <File size={12} className="text-orange-500 shrink-0" />}
                  <span className="font-medium text-gray-700 text-xs truncate">{res.title}</span>
                  {!res.is_active && <span className="text-[9px] bg-red-50 text-red-700 px-1.5 rounded-full font-medium">Inactivo</span>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => { setFormData({ title: res.title, resource_type: res.resource_type, url: res.url, sort_order: res.sort_order, is_active: res.is_active }); setEditingId(res.id); }} className="p-1 text-gray-400 hover:text-blue-600 rounded"><Edit2 size={12} /></button>
                  <button onClick={() => handleDelete(res.id)} className="p-1 text-gray-400 hover:text-red-600 rounded"><Trash2 size={12} /></button>
                </div>
              </>
            )}
          </div>
        ))}

        {editingId === "new" && (
          <div className="w-full space-y-3 bg-blue-50/50 p-3 rounded-lg border border-blue-200 mt-3 shadow-sm">
            <h6 className="text-[10px] font-bold text-blue-800 uppercase flex items-center gap-1.5"><Plus size={12}/> Nuevo Recurso</h6>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">Título</label>
                <input type="text" placeholder="Ej. Guía PDF" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} className="w-full text-xs bg-white text-gray-900 placeholder-gray-400 border-gray-300 rounded focus:ring-orange-500 focus:border-orange-500" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">Tipo de recurso</label>
                <select value={formData.resource_type} onChange={e => setFormData({ ...formData, resource_type: e.target.value })} className="w-full text-xs bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded focus:ring-orange-500 focus:border-orange-500">
                  <option value="pdf" className="text-gray-900 bg-white">PDF</option>
                  <option value="stl" className="text-gray-900 bg-white">STL</option>
                  <option value="zip" className="text-gray-900 bg-white">ZIP</option>
                  <option value="link" className="text-gray-900 bg-white">Link</option>
                  <option value="other" className="text-gray-900 bg-white">Otro</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">URL del recurso</label>
                <input type="text" placeholder="https://..." value={formData.url} onChange={e => setFormData({ ...formData, url: e.target.value })} className="w-full text-xs bg-white text-gray-900 placeholder-gray-400 border-gray-300 rounded focus:ring-orange-500 focus:border-orange-500" />
                <p className="mt-1 text-[10px] text-gray-500">Pegá acá el link al PDF, STL, ZIP o recurso externo. Más adelante se podrá subir archivos directamente.</p>
              </div>
              <div className="sm:col-span-2 flex items-center gap-4 border-t border-blue-100 pt-3 mt-1">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-semibold text-gray-600 uppercase">Orden:</label>
                  <input type="number" placeholder="1" value={formData.sort_order} onChange={e => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })} className="w-16 text-xs bg-white text-gray-900 placeholder-gray-500 border-gray-300 rounded focus:ring-orange-500 focus:border-orange-500 py-1" />
                </div>
                <label className="text-xs flex items-center gap-1.5 text-gray-700 font-medium bg-white px-2 py-1 rounded border border-gray-200">
                  <input type="checkbox" checked={formData.is_active} onChange={e => setFormData({ ...formData, is_active: e.target.checked })} className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5 focus:ring-orange-500" />
                  Activo
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditingId(null)} className="text-[10px] font-semibold px-3 py-1.5 text-gray-600 hover:bg-gray-200 bg-gray-100 rounded transition-colors">Cancelar</button>
              <button onClick={handleSave} className="text-[10px] font-semibold px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">Guardar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
