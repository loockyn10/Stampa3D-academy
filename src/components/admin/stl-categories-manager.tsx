"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Edit2, Plus, Save, X } from "lucide-react";

export function StlCategoriesManager() {
  const supabase = createClient();
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catForm, setCatForm] = useState({ name: "", slug: "", description: "", thumbnail_url: "", sort_order: 0, is_active: true });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("stl_categories").select("*").order("sort_order", { ascending: true });
    if (error) setError(error.message);
    else setCategories(data || []);
    setLoading(false);
  };

  const handleSaveCat = async () => {
    setError(null);
    if (editingCatId === "new") {
      const { data, error: err } = await supabase.from("stl_categories").insert([catForm]).select().single();
      if (err) setError(err.message);
      else setCategories([...categories, data]);
    } else {
      const { error: err } = await supabase.from("stl_categories").update(catForm).eq("id", editingCatId);
      if (err) setError(err.message);
      else setCategories(categories.map(c => c.id === editingCatId ? { ...c, ...catForm } : c));
    }
    setEditingCatId(null);
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>;

  return (
    <div className="max-w-3xl">
      {error && (
        <div className="mb-6 bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Listado de Categorías</h2>
          <button 
            onClick={() => { setCatForm({ name: "", slug: "", description: "", thumbnail_url: "", sort_order: categories.length + 1, is_active: true }); setEditingCatId("new"); }}
            className="text-sm flex items-center gap-1 text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-md transition-colors"
          >
            <Plus size={16} /> Nueva
          </button>
        </div>

        <div className="space-y-3">
          {editingCatId === "new" && (
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <input type="text" placeholder="Nombre (ej. Funcionales)" value={catForm.name} onChange={e => setCatForm({...catForm, name: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
              <input type="text" placeholder="Slug (ej. funcionales)" value={catForm.slug} onChange={e => setCatForm({...catForm, slug: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
              <textarea placeholder="Descripción (opcional)" value={catForm.description || ""} onChange={e => setCatForm({...catForm, description: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
              <input type="text" placeholder="URL de imagen (opcional)" value={catForm.thumbnail_url || ""} onChange={e => setCatForm({...catForm, thumbnail_url: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
              <div className="flex gap-4">
                <input type="number" placeholder="Orden" value={catForm.sort_order} onChange={e => setCatForm({...catForm, sort_order: parseInt(e.target.value) || 0})} className="w-32 text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={catForm.is_active} onChange={e => setCatForm({...catForm, is_active: e.target.checked})} className="rounded text-orange-600 focus:ring-orange-500" />
                  Activa
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditingCatId(null)} className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-md"><X size={16} /></button>
                <button onClick={handleSaveCat} className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-md"><Save size={16} /></button>
              </div>
            </div>
          )}

          {categories.map(cat => (
            <div key={cat.id} className="p-3 border border-gray-100 rounded-lg flex items-center justify-between hover:bg-gray-50 transition-colors">
              {editingCatId === cat.id ? (
                <div className="w-full space-y-3">
                  <input type="text" value={catForm.name} onChange={e => setCatForm({...catForm, name: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
                  <input type="text" value={catForm.slug} onChange={e => setCatForm({...catForm, slug: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
                  <textarea value={catForm.description || ""} onChange={e => setCatForm({...catForm, description: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
                  <input type="text" placeholder="URL de imagen" value={catForm.thumbnail_url || ""} onChange={e => setCatForm({...catForm, thumbnail_url: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
                  <div className="flex gap-4">
                    <input type="number" value={catForm.sort_order} onChange={e => setCatForm({...catForm, sort_order: parseInt(e.target.value) || 0})} className="w-32 text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={catForm.is_active} onChange={e => setCatForm({...catForm, is_active: e.target.checked})} className="rounded text-orange-600 focus:ring-orange-500" />
                      Activa
                    </label>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button onClick={() => setEditingCatId(null)} className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-md"><X size={16} /></button>
                    <button onClick={handleSaveCat} className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-md"><Save size={16} /></button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    {cat.thumbnail_url ? (
                      <img src={cat.thumbnail_url} alt={cat.name} className="w-10 h-10 rounded object-cover" />
                    ) : (
                      <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center text-gray-400">?</div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{cat.name}</p>
                      <p className="text-xs text-gray-500">Orden: {cat.sort_order} • /{cat.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!cat.is_active && <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Inactiva</span>}
                    <button onClick={() => { setCatForm({ name: cat.name, slug: cat.slug, description: cat.description, thumbnail_url: cat.thumbnail_url, sort_order: cat.sort_order, is_active: cat.is_active }); setEditingCatId(cat.id); }} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md">
                      <Edit2 size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {categories.length === 0 && editingCatId !== "new" && (
            <p className="text-sm text-gray-500 text-center py-4">No hay categorías. Creá la primera.</p>
          )}
        </div>
      </div>
    </div>
  );
}
