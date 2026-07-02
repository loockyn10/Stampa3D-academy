"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Edit2, Plus, Save, Trash2, Check, X } from "lucide-react";

export function ConfigManager() {
  const supabase = createClient();
  const [categories, setCategories] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // States for Categories
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catForm, setCatForm] = useState({ name: "", slug: "", description: "", sort_order: 0, is_active: true });

  // States for Instructors
  const [editingInstId, setEditingInstId] = useState<string | null>(null);
  const [instForm, setInstForm] = useState({ name: "", bio: "", avatar_url: "", is_active: true });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [catRes, instRes] = await Promise.all([
      supabase.from("course_categories").select("*").order("sort_order", { ascending: true }),
      supabase.from("instructors").select("*").order("name", { ascending: true })
    ]);

    if (catRes.error) setError(catRes.error.message);
    else setCategories(catRes.data || []);

    if (instRes.error) setError(instRes.error.message);
    else setInstructors(instRes.data || []);

    setLoading(false);
  };

  // --- CATEGORIES ---
  const handleSaveCat = async () => {
    setError(null);
    if (editingCatId === "new") {
      const { data, error: err } = await supabase.from("course_categories").insert([catForm]).select().single();
      if (err) setError(err.message);
      else setCategories([...categories, data]);
    } else {
      const { error: err } = await supabase.from("course_categories").update(catForm).eq("id", editingCatId);
      if (err) setError(err.message);
      else setCategories(categories.map(c => c.id === editingCatId ? { ...c, ...catForm } : c));
    }
    setEditingCatId(null);
  };

  // --- INSTRUCTORS ---
  const handleSaveInst = async () => {
    setError(null);
    if (editingInstId === "new") {
      const { data, error: err } = await supabase.from("instructors").insert([instForm]).select().single();
      if (err) setError(err.message);
      else setInstructors([...instructors, data]);
    } else {
      const { error: err } = await supabase.from("instructors").update(instForm).eq("id", editingInstId);
      if (err) setError(err.message);
      else setInstructors(instructors.map(i => i.id === editingInstId ? { ...i, ...instForm } : i));
    }
    setEditingInstId(null);
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {error && (
        <div className="col-span-full bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* CATEGORIES SECTION */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Categorías</h2>
          <button 
            onClick={() => { setCatForm({ name: "", slug: "", description: "", sort_order: categories.length + 1, is_active: true }); setEditingCatId("new"); }}
            className="text-sm flex items-center gap-1 text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-md"
          >
            <Plus size={16} /> Nueva
          </button>
        </div>

        <div className="space-y-3">
          {editingCatId === "new" && (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <input type="text" placeholder="Nombre" value={catForm.name} onChange={e => setCatForm({...catForm, name: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
              <input type="text" placeholder="Slug" value={catForm.slug} onChange={e => setCatForm({...catForm, slug: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
              <input type="number" placeholder="Orden" value={catForm.sort_order} onChange={e => setCatForm({...catForm, sort_order: parseInt(e.target.value) || 0})} className="w-full text-sm border-gray-300 rounded-md" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingCatId(null)} className="p-1 text-gray-500 hover:text-gray-700"><X size={18} /></button>
                <button onClick={handleSaveCat} className="p-1 text-blue-600 hover:text-blue-800"><Check size={18} /></button>
              </div>
            </div>
          )}

          {categories.map((cat) => (
            <div key={cat.id}>
              {editingCatId === cat.id ? (
                <div className="p-3 bg-gray-50 rounded-lg border border-blue-200 space-y-3">
                  <input type="text" value={catForm.name} onChange={e => setCatForm({...catForm, name: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
                  <input type="text" value={catForm.slug} onChange={e => setCatForm({...catForm, slug: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
                  <input type="number" value={catForm.sort_order} onChange={e => setCatForm({...catForm, sort_order: parseInt(e.target.value) || 0})} className="w-full text-sm border-gray-300 rounded-md" />
                  <div className="flex items-center gap-2">
                     <input type="checkbox" checked={catForm.is_active} onChange={e => setCatForm({...catForm, is_active: e.target.checked})} />
                     <label className="text-sm">Activa</label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingCatId(null)} className="p-1 text-gray-500 hover:text-gray-700"><X size={18} /></button>
                    <button onClick={handleSaveCat} className="p-1 text-blue-600 hover:text-blue-800"><Check size={18} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{cat.name}</p>
                    <p className="text-xs text-gray-500">/{cat.slug} - Orden: {cat.sort_order}</p>
                  </div>
                  <button onClick={() => { setCatForm({ name: cat.name, slug: cat.slug, description: cat.description || "", sort_order: cat.sort_order, is_active: cat.is_active }); setEditingCatId(cat.id); }} className="p-1 text-gray-400 hover:text-blue-600"><Edit2 size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* INSTRUCTORS SECTION */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Instructores</h2>
          <button 
            onClick={() => { setInstForm({ name: "", bio: "", avatar_url: "", is_active: true }); setEditingInstId("new"); }}
            className="text-sm flex items-center gap-1 text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-md"
          >
            <Plus size={16} /> Nuevo
          </button>
        </div>

        <div className="space-y-3">
          {editingInstId === "new" && (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <input type="text" placeholder="Nombre" value={instForm.name} onChange={e => setInstForm({...instForm, name: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
              <input type="text" placeholder="Avatar URL" value={instForm.avatar_url} onChange={e => setInstForm({...instForm, avatar_url: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
              <textarea placeholder="Bio" value={instForm.bio} onChange={e => setInstForm({...instForm, bio: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" rows={2} />
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingInstId(null)} className="p-1 text-gray-500 hover:text-gray-700"><X size={18} /></button>
                <button onClick={handleSaveInst} className="p-1 text-blue-600 hover:text-blue-800"><Check size={18} /></button>
              </div>
            </div>
          )}

          {instructors.map((inst) => (
            <div key={inst.id}>
              {editingInstId === inst.id ? (
                <div className="p-3 bg-gray-50 rounded-lg border border-blue-200 space-y-3">
                  <input type="text" value={instForm.name} onChange={e => setInstForm({...instForm, name: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
                  <input type="text" placeholder="Avatar URL" value={instForm.avatar_url} onChange={e => setInstForm({...instForm, avatar_url: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
                  <textarea value={instForm.bio} onChange={e => setInstForm({...instForm, bio: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" rows={2} />
                  <div className="flex items-center gap-2">
                     <input type="checkbox" checked={instForm.is_active} onChange={e => setInstForm({...instForm, is_active: e.target.checked})} />
                     <label className="text-sm">Activo</label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingInstId(null)} className="p-1 text-gray-500 hover:text-gray-700"><X size={18} /></button>
                    <button onClick={handleSaveInst} className="p-1 text-blue-600 hover:text-blue-800"><Check size={18} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    {inst.avatar_url ? (
                      <img src={inst.avatar_url} alt={inst.name} className="w-8 h-8 rounded-full object-cover bg-gray-200" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-200" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900">{inst.name}</p>
                      <p className="text-xs text-gray-500 truncate max-w-[200px]">{inst.bio || "Sin bio"}</p>
                    </div>
                  </div>
                  <button onClick={() => { setInstForm({ name: inst.name, bio: inst.bio || "", avatar_url: inst.avatar_url || "", is_active: inst.is_active }); setEditingInstId(inst.id); }} className="p-1 text-gray-400 hover:text-blue-600"><Edit2 size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
