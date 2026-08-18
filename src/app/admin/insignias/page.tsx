"use client";

import React, { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Award, Save, X, Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/utils/supabase/client";

export default function AdminInsigniasPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Badges
  const [badges, setBadges] = useState<any[]>([]);
  const [editingBadgeId, setEditingBadgeId] = useState<string | null>(null);
  const [badgeForm, setBadgeForm] = useState({ name: "", description: "", icon: "", is_active: true, sort_order: 1 });

  // User Badges
  const [profiles, setProfiles] = useState<any[]>([]);
  const [userBadges, setUserBadges] = useState<any[]>([]);
  const [assignForm, setAssignForm] = useState({ user_id: "", badge_id: "" });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    const [bRes, pRes, ubRes] = await Promise.all([
      supabase.from("badges").select("*").order("sort_order", { ascending: true }),
      supabase.from("profiles").select("id, name, email").order("name", { ascending: true }),
      supabase.from("user_badges").select("*, profiles(name, email), badges(name, icon)").order("awarded_at", { ascending: false })
    ]);

    if (bRes.error) setError(bRes.error.message);
    else setBadges(bRes.data || []);

    if (pRes.error) console.error(pRes.error);
    else setProfiles(pRes.data || []);

    if (ubRes.error) console.error(ubRes.error);
    else setUserBadges(ubRes.data || []);

    setLoading(false);
  };

  const handleEditBadge = (b: any) => {
    setBadgeForm({
      name: b.name, description: b.description || "", icon: b.icon || "🏆", 
      is_active: b.is_active, sort_order: b.sort_order || 1
    });
    setEditingBadgeId(b.id);
  };

  const handleSaveBadge = async () => {
    if (!badgeForm.name) return alert("El nombre es obligatorio.");
    setError(null);
    
    const payload = { ...badgeForm };

    if (editingBadgeId === "new") {
      const { data, error } = await supabase.from("badges").insert([payload]).select().single();
      if (error) setError(error.message);
      else {
        setBadges([...badges, data]);
        setEditingBadgeId(null);
      }
    } else {
      const { data, error } = await supabase.from("badges").update(payload).eq("id", editingBadgeId).select().single();
      if (error) setError(error.message);
      else {
        setBadges(badges.map(b => b.id === editingBadgeId ? data : b));
        setEditingBadgeId(null);
      }
    }
  };

  const handleAssignBadge = async () => {
    if (!assignForm.user_id || !assignForm.badge_id) return alert("Selecciona usuario e insignia.");
    setError(null);

    const payload = {
      user_id: assignForm.user_id,
      badge_id: assignForm.badge_id,
      awarded_at: new Date().toISOString()
    };

    const { error } = await supabase.from("user_badges").insert([payload]);
    if (error) {
      if (error.code === '23505') alert("Este usuario ya tiene esa insignia.");
      else alert("Error: " + error.message);
    } else {
      await fetchData(); // Recargar para traer las relaciones
      setAssignForm({ user_id: "", badge_id: "" });
    }
  };

  const handleRemoveUserBadge = async (id: string) => {
    if (!confirm("¿Quitar esta insignia al usuario?")) return;
    const { error } = await supabase.from("user_badges").delete().eq("id", id);
    if (error) alert("Error: " + error.message);
    else setUserBadges(userBadges.filter(ub => ub.id !== id));
  };

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-stampa-orange" /></div>;

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-white">Gestión de Insignias</h1>
          <p className="text-sm text-gray-500 mt-1">Crea logros y asígnalos a los estudiantes.</p>
        </div>
        <PrimaryButton onClick={() => { setBadgeForm({name:"", description:"", icon:"🏆", is_active:true, sort_order:badges.length+1}); setEditingBadgeId("new"); }}>
          <Plus size={15} /> Nueva Insignia
        </PrimaryButton>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {editingBadgeId && (
        <Card className="p-6 border-orange-300 shadow-md ring-1 ring-orange-100">
          <div className="flex justify-between items-center mb-4 border-b border-stampa-border pb-2">
            <h3 className="text-lg font-bold text-white">{editingBadgeId === "new" ? "Crear Insignia" : "Editar Insignia"}</h3>
            <button onClick={() => setEditingBadgeId(null)} className="text-gray-400 hover:text-gray-300"><X size={20} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex gap-4">
              <div className="w-16">
                <label className="block text-xs font-semibold text-gray-300 mb-1">Icono</label>
                <input type="text" value={badgeForm.icon} onChange={e => setBadgeForm({...badgeForm, icon: e.target.value})} className="w-full text-center text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white" placeholder="🏆" />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-300 mb-1">Nombre</label>
                <input type="text" value={badgeForm.name} onChange={e => setBadgeForm({...badgeForm, name: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Descripción</label>
              <input type="text" value={badgeForm.description} onChange={e => setBadgeForm({...badgeForm, description: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white" />
            </div>
            <div className="flex items-center gap-6">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Orden</label>
                <input type="number" min="1" value={badgeForm.sort_order} onChange={e => setBadgeForm({...badgeForm, sort_order: parseInt(e.target.value)||1})} className="w-20 text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white" />
              </div>
              <label className="flex items-center gap-2 mt-4">
                <input type="checkbox" checked={badgeForm.is_active} onChange={e => setBadgeForm({...badgeForm, is_active: e.target.checked})} className="rounded text-stampa-orange focus:ring-stampa-orange" />
                <span className="text-sm font-semibold text-gray-300">Activa</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end pt-4 mt-4 border-t border-stampa-border">
            <PrimaryButton onClick={handleSaveBadge}><Save size={15} /> Guardar</PrimaryButton>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* BADGES LIST */}
        <Card className="p-0 overflow-hidden">
          <div className="bg-stampa-bg-soft px-5 py-3 border-b border-stampa-border">
            <h3 className="font-bold text-gray-300 text-sm">Catálogo de Insignias</h3>
          </div>
          <ul className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
            {badges.length === 0 && <li className="p-5 text-sm text-gray-500 text-center">No hay insignias.</li>}
            {badges.map(b => (
              <li key={b.id} className={`flex justify-between items-center p-4 hover:bg-stampa-bg-soft transition-colors ${!b.is_active ? 'opacity-60 grayscale' : ''}`}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 flex items-center justify-center bg-stampa-surface border border-stampa-border rounded-full text-2xl shadow-sm">
                    {b.icon || "🏆"}
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">{b.name}</h4>
                    <p className="text-xs text-gray-500">{b.description || "Sin descripción"}</p>
                  </div>
                </div>
                <GhostButton onClick={() => handleEditBadge(b)} className="px-3 py-1.5 text-xs text-gray-300 bg-stampa-surface border border-stampa-border">
                  <Pencil size={13} /> Editar
                </GhostButton>
              </li>
            ))}
          </ul>
        </Card>

        {/* ASSIGN BADGES */}
        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-stampa-border pb-2">Otorgar Insignia</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Seleccionar Usuario</label>
                <select value={assignForm.user_id} onChange={e => setAssignForm({...assignForm, user_id: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white">
                  <option value="">Buscar usuario...</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.name || p.email}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Seleccionar Insignia</label>
                <select value={assignForm.badge_id} onChange={e => setAssignForm({...assignForm, badge_id: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white">
                  <option value="">Asignar insignia...</option>
                  {badges.filter(b => b.is_active).map(b => <option key={b.id} value={b.id}>{b.icon} {b.name}</option>)}
                </select>
              </div>
              <div className="flex justify-end pt-2">
                <PrimaryButton onClick={handleAssignBadge} className="text-xs px-4 py-2"><Award size={14} /> Otorgar a Usuario</PrimaryButton>
              </div>
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="bg-stampa-bg-soft px-5 py-3 border-b border-stampa-border">
              <h3 className="font-bold text-gray-300 text-sm">Últimas Asignaciones</h3>
            </div>
            <ul className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
              {userBadges.length === 0 && <li className="p-5 text-sm text-gray-500 text-center">Nadie ha recibido insignias aún.</li>}
              {userBadges.map(ub => (
                <li key={ub.id} className="flex justify-between items-center p-3 bg-stampa-surface">
                  <div>
                    <p className="text-sm font-bold text-white">{ub.profiles?.name || ub.profiles?.email}</p>
                    <p className="text-xs font-semibold text-stampa-orange flex items-center gap-1 mt-0.5">
                      <span>{ub.badges?.icon}</span> {ub.badges?.name}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-1">{new Date(ub.awarded_at).toLocaleDateString()}</p>
                  </div>
                  <button onClick={() => handleRemoveUserBadge(ub.id)} className="p-2 text-red-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg" title="Quitar insignia">
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
