"use client";

import React, { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Plus, Trash2, Trophy, AlertCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";

export default function EditarSorteoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Core Raffle Data
  const [formData, setFormData] = useState({
    title: "", description: "", draw_date: "", status: "draft", is_active: false
  });

  // Prizes
  const [prizes, setPrizes] = useState<any[]>([]);
  const [prizeForm, setPrizeForm] = useState({ name: "", description: "", image_url: "", sort_order: 1 });

  // Winners
  const [winners, setWinners] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [winnerForm, setWinnerForm] = useState({ user_id: "", prize_id: "" });

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    // 1. Fetch Raffle
    const { data: raffle, error: rError } = await supabase.from("raffles").select("*").eq("id", id).single();
    if (rError) {
      setError("No se pudo cargar el sorteo.");
      setLoading(false);
      return;
    }
    if (raffle) {
      setFormData({
        title: raffle.title || "",
        description: raffle.description || "",
        draw_date: raffle.draw_date ? String(raffle.draw_date).substring(0, 10) : "",
        status: raffle.status || "draft",
        is_active: raffle.is_active || false
      });
    }

    // 2. Fetch Prizes
    const { data: pData } = await supabase.from("raffle_prizes").select("*").eq("raffle_id", id).order("sort_order", { ascending: true });
    setPrizes(pData || []);

    // 3. Fetch Winners
    const { data: wData } = await supabase.from("raffle_winners").select("*").eq("raffle_id", id).order("won_at", { ascending: false });
    setWinners(wData || []);

    // 4. Fetch Profiles for Winner Selection
    const { data: profData } = await supabase.from("profiles").select("id, name, email").order("name", { ascending: true });
    setProfiles(profData || []);

    setLoading(false);
  };

  const handleSaveRaffle = async () => {
    setError(null);
    const payload = {
      title: formData.title,
      description: formData.description,
      draw_date: formData.draw_date || null,
      status: formData.status,
      is_active: formData.is_active
    };

    const { error } = await supabase.from("raffles").update(payload).eq("id", id);
    if (error) setError(error.message);
    else alert("Sorteo actualizado correctamente.");
  };

  const handleAddPrize = async () => {
    if (!prizeForm.name) return alert("El nombre del premio es obligatorio.");
    const payload = { ...prizeForm, raffle_id: id };
    
    const { data, error } = await supabase.from("raffle_prizes").insert([payload]).select().single();
    if (error) {
      alert("Error: " + error.message);
    } else if (data) {
      setPrizes([...prizes, data]);
      setPrizeForm({ name: "", description: "", image_url: "", sort_order: prizes.length + 2 });
    }
  };

  const handleDeletePrize = async (id: string) => {
    if (!confirm("¿Seguro que deseas eliminar este premio?")) return;
    const { error } = await supabase.from("raffle_prizes").delete().eq("id", id);
    if (error) alert("Error: " + error.message);
    else setPrizes(prizes.filter(p => p.id !== id));
  };

  const handleAddWinner = async () => {
    if (!winnerForm.user_id || !winnerForm.prize_id) {
      return alert("Selecciona un usuario y un premio.");
    }
    
    const selectedPrize = prizes.find(p => p.id === winnerForm.prize_id);
    const selectedUser = profiles.find(p => p.id === winnerForm.user_id);
    
    if (!selectedPrize || !selectedUser) return;

    const payload = {
      raffle_id: id,
      prize_id: selectedPrize.id,
      user_id: selectedUser.id,
      winner_name_snapshot: selectedUser.name || selectedUser.email || "Usuario sin nombre",
      prize_name_snapshot: selectedPrize.name,
      won_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from("raffle_winners").insert([payload]).select().single();
    if (error) {
      alert("Error: " + error.message);
    } else if (data) {
      setWinners([data, ...winners]);
      setWinnerForm({ user_id: "", prize_id: "" });
    }
  };

  const handleDeleteWinner = async (id: string) => {
    if (!confirm("¿Eliminar este ganador?")) return;
    const { error } = await supabase.from("raffle_winners").delete().eq("id", id);
    if (error) alert("Error: " + error.message);
    else setWinners(winners.filter(w => w.id !== id));
  };

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/admin/sorteos">
          <GhostButton className="p-2 border border-gray-200 bg-white">
            <ArrowLeft size={18} className="text-gray-600" />
          </GhostButton>
        </Link>
        <SectionTitle eyebrow="Administración" title="Editar Sorteo" />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* RAFFLE DETAILS */}
      <Card className="p-6 border-orange-200">
        <h3 className="text-lg font-bold text-gray-900 mb-4 border-b border-gray-100 pb-2">Información del Sorteo</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-700 mb-1">Título</label>
            <input type="text" name="title" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-700 mb-1">Descripción</label>
            <textarea name="description" rows={3} value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Fecha del Sorteo</label>
            <input type="date" name="draw_date" value={formData.draw_date} onChange={(e) => setFormData({...formData, draw_date: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Estado</label>
            <select name="status" value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white">
              <option value="draft">Borrador</option>
              <option value="active">Activo (Visible)</option>
              <option value="completed">Completado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <div className="md:col-span-2 flex justify-between items-center pt-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({...formData, is_active: e.target.checked})} className="rounded text-orange-500 focus:ring-orange-500" />
              <span className="text-sm font-semibold text-gray-700">Sorteo Activo en la plataforma</span>
            </label>
            <PrimaryButton onClick={handleSaveRaffle}><Save size={15} /> Guardar Cambios</PrimaryButton>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* PRIZES MANAGEMENT */}
        <Card className="p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 border-b border-gray-100 pb-2">Premios</h3>
          
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-5 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Nombre del Premio</label>
              <input type="text" value={prizeForm.name} onChange={(e) => setPrizeForm({...prizeForm, name: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 bg-white text-gray-900" placeholder="Ej. Impresora Ender 3" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Descripción corta</label>
              <input type="text" value={prizeForm.description} onChange={(e) => setPrizeForm({...prizeForm, description: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 bg-white text-gray-900" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-700 mb-1">URL de Imagen</label>
                <input type="text" value={prizeForm.image_url} onChange={(e) => setPrizeForm({...prizeForm, image_url: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 bg-white text-gray-900" />
              </div>
              <div className="w-20">
                <label className="block text-xs font-semibold text-gray-700 mb-1">Orden</label>
                <input type="number" min="1" value={prizeForm.sort_order} onChange={(e) => setPrizeForm({...prizeForm, sort_order: parseInt(e.target.value)||1})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 bg-white text-gray-900" />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <PrimaryButton onClick={handleAddPrize} className="text-xs px-4 py-1.5"><Plus size={14} /> Añadir Premio</PrimaryButton>
            </div>
          </div>

          <ul className="space-y-2">
            {prizes.length === 0 && <p className="text-sm text-gray-500 italic">No hay premios cargados.</p>}
            {prizes.map((p) => (
              <li key={p.id} className="flex justify-between items-center p-3 bg-white border border-gray-100 shadow-sm rounded-lg">
                <div className="flex items-center gap-3">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="w-10 h-10 object-cover rounded bg-gray-50 border border-gray-200" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-orange-50 text-orange-500 flex items-center justify-center border border-orange-100"><Trophy size={16} /></div>
                  )}
                  <div>
                    <p className="text-sm font-bold text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-500">Orden: {p.sort_order}</p>
                  </div>
                </div>
                <button onClick={() => handleDeletePrize(p.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        </Card>

        {/* WINNERS MANAGEMENT */}
        <Card className="p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 border-b border-gray-100 pb-2">Ganadores</h3>
          
          <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100 mb-5 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Seleccionar Ganador (Usuario)</label>
              <select value={winnerForm.user_id} onChange={(e) => setWinnerForm({...winnerForm, user_id: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 bg-white text-gray-900">
                <option value="">Buscar usuario...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name || p.email}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Seleccionar Premio Otorgado</label>
              <select value={winnerForm.prize_id} onChange={(e) => setWinnerForm({...winnerForm, prize_id: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 bg-white text-gray-900">
                <option value="">Asignar un premio...</option>
                {prizes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end pt-2">
              <PrimaryButton onClick={handleAddWinner} className="text-xs px-4 py-1.5"><Trophy size={14} /> Asignar Ganador</PrimaryButton>
            </div>
          </div>

          <ul className="space-y-2">
            {winners.length === 0 && <p className="text-sm text-gray-500 italic">No hay ganadores registrados.</p>}
            {winners.map((w) => (
              <li key={w.id} className="flex justify-between items-center p-3 bg-white border border-gray-100 shadow-sm rounded-lg">
                <div>
                  <p className="text-sm font-bold text-gray-900">{w.winner_name_snapshot}</p>
                  <p className="text-xs font-semibold text-orange-600">{w.prize_name_snapshot}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{new Date(w.won_at).toLocaleString()}</p>
                </div>
                <button onClick={() => handleDeleteWinner(w.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
