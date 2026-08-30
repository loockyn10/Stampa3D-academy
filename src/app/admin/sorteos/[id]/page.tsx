"use client";

import React, { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Plus, Trash2, Trophy, AlertCircle, Loader2, ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";
import { RaffleImage } from "@/components/raffles/raffle-image";
import {
  RAFFLE_IMAGES_BUCKET,
  resolveRaffleImageUrl,
} from "@/lib/raffles/images";
import { PLATFORM_GRANT_TYPES } from "@/lib/auth/access-policy";
import { getRaffleParticipantChances } from "@/lib/raffles/participants";
import { assignRaffleWinner } from "./actions";

export default function EditarSorteoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Core Raffle Data
  const [formData, setFormData] = useState({
    title: "", description: "", cover_image_url: "", draw_date: "", status: "draft", is_active: false
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

    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user?.id || null);

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
        cover_image_url: resolveRaffleImageUrl(supabase, raffle.cover_image_url) || "",
        draw_date: raffle.draw_date ? String(raffle.draw_date).substring(0, 10) : "",
        status: raffle.status || "draft",
        is_active: raffle.is_active || false
      });
    }

    // 2. Fetch Prizes
    const { data: pData } = await supabase.from("raffle_prizes").select("*").eq("raffle_id", id).order("sort_order", { ascending: true });
    setPrizes((pData || []).map((prize) => ({
      ...prize,
      image_url: resolveRaffleImageUrl(supabase, prize.image_url),
    })));

    // 3. Fetch Winners
    const { data: wData } = await supabase.from("raffle_winners").select("*").eq("raffle_id", id).order("won_at", { ascending: false });
    setWinners(wData || []);

    // 4. Derive eligible participants from the same access facts used by the app.
    const { data: profData, error: profilesError } = await supabase
      .from("profiles")
      .select("id, email, full_name, display_name, role, membership_status, membership_expires_at, onboarding_completed, member_level")
      .order("created_at", { ascending: false });

    if (profilesError) {
      setError(`No se pudieron cargar los participantes: ${profilesError.message}`);
      setProfiles([]);
    } else {
      const profileIds = (profData || []).map((profile) => profile.id);
      let grants: any[] = [];
      let bonusRows: any[] = [];
      let participantFactsAvailable = true;

      if (profileIds.length > 0) {
        const [grantsResult, bonusResult] = await Promise.all([
          supabase
            .from("user_access_grants")
            .select("user_id, grant_type, status, expires_at")
            .in("user_id", profileIds)
            .eq("status", "active")
            .in("grant_type", [...PLATFORM_GRANT_TYPES]),
          supabase
            .from("user_raffle_bonus_entries")
            .select("user_id, entries_count")
            .in("user_id", profileIds)
            .eq("is_active", true),
        ]);

        if (grantsResult.error || bonusResult.error) {
          setError(`No se pudieron calcular las chances: ${grantsResult.error?.message || bonusResult.error?.message}`);
          participantFactsAvailable = false;
        } else {
          grants = grantsResult.data || [];
          bonusRows = bonusResult.data || [];
        }
      }

      const participants = participantFactsAvailable ? (profData || []).flatMap((profile) => {
        const profileGrants = grants
          .filter((grant) => grant.user_id === profile.id)
          .map((grant) => ({
            grantType: grant.grant_type,
            status: grant.status,
            expiresAt: grant.expires_at,
          }));
        const bonusEntries = bonusRows
          .filter((row) => row.user_id === profile.id)
          .reduce((total, row) => total + Number(row.entries_count || 0), 0);
        const chances = getRaffleParticipantChances({
          profile,
          grants: profileGrants,
          bonusEntries,
        });

        if (chances === null) return [];
        return [{
          id: profile.id,
          email: profile.email || "",
          name: profile.display_name || profile.full_name || profile.email || "Usuario sin nombre",
          chances,
        }];
      }).sort((left, right) => left.name.localeCompare(right.name, "es")) : [];

      setProfiles(participants);
    }

    setLoading(false);
  };

  const handleSaveRaffle = async () => {
    setError(null);
    const payload = {
      title: formData.title,
      description: formData.description,
      cover_image_url: formData.cover_image_url || null,
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
    const payload = {
      raffle_id: id,
      name: prizeForm.name,
      description: prizeForm.description || null,
      image_url: prizeForm.image_url || null,
      sort_order: prizeForm.sort_order,
    };
    
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
    
    const result = await assignRaffleWinner({
      raffleId: id,
      prizeId: winnerForm.prize_id,
      userId: winnerForm.user_id,
    });
    if (!result.success) {
      alert("Error: " + result.error);
    } else if (result.winner) {
      setWinners([result.winner, ...winners]);
      setWinnerForm({ user_id: "", prize_id: "" });
    }
  };

  const handleDeleteWinner = async (id: string) => {
    if (!confirm("¿Eliminar este ganador?")) return;
    const { error } = await supabase.from("raffle_winners").delete().eq("id", id);
    if (error) alert("Error: " + error.message);
    else setWinners(winners.filter(w => w.id !== id));
  };

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-stampa-orange" /></div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/admin/sorteos">
          <GhostButton className="p-2 border border-stampa-border bg-stampa-surface">
            <ArrowLeft size={18} className="text-gray-400" />
          </GhostButton>
        </Link>
        <SectionTitle eyebrow="Administración" title="Editar Sorteo" />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* RAFFLE DETAILS */}
      <Card className="p-6 border-stampa-orange/30">
        <h3 className="text-lg font-bold text-white mb-4 border-b border-stampa-border pb-2">Información del Sorteo</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2">
            <label className="mb-2 block text-xs font-semibold text-gray-300">Imagen de portada</label>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
              <div className="aspect-video overflow-hidden rounded-xl border border-stampa-border bg-stampa-bg-soft">
                <RaffleImage
                  src={formData.cover_image_url}
                  alt={`Portada de ${formData.title || "sorteo"}`}
                  className="h-full w-full object-cover"
                  fallback={(
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500">
                      <ImageIcon size={28} aria-hidden="true" />
                      <span className="text-xs font-medium">Sin portada</span>
                    </div>
                  )}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                {userId ? (
                  <FileUploadDropzone
                    bucket={RAFFLE_IMAGES_BUCKET}
                    pathPrefix={`${userId}/raffles/${id}/cover`}
                    accept=".jpg,.jpeg,.png,.webp"
                    maxSizeMb={5}
                    publicBucket
                    label="Subir o cambiar portada"
                    helperText="Elegí una imagen horizontal"
                    onUploaded={(url) => setFormData((current) => ({ ...current, cover_image_url: url }))}
                  />
                ) : (
                  <p className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">No se pudo identificar la sesión para subir la portada.</p>
                )}
                {formData.cover_image_url && (
                  <button
                    type="button"
                    onClick={() => setFormData((current) => ({ ...current, cover_image_url: "" }))}
                    className="self-start rounded-lg px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    Quitar imagen
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-300 mb-1">Título</label>
            <input type="text" name="title" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange focus:ring-stampa-orange text-white bg-stampa-surface" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-300 mb-1">Descripción</label>
            <textarea name="description" rows={3} value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange focus:ring-stampa-orange text-white bg-stampa-surface" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Fecha del Sorteo</label>
            <input type="date" name="draw_date" value={formData.draw_date} onChange={(e) => setFormData({...formData, draw_date: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange focus:ring-stampa-orange text-white bg-stampa-surface" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Estado</label>
            <select name="status" value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange focus:ring-stampa-orange text-white bg-stampa-surface">
              <option value="draft">Borrador</option>
              <option value="active">Activo (Visible)</option>
              <option value="completed">Completado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <div className="md:col-span-2 flex justify-between items-center pt-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({...formData, is_active: e.target.checked})} className="rounded text-stampa-orange focus:ring-stampa-orange" />
              <span className="text-sm font-semibold text-gray-300">Sorteo Activo en la plataforma</span>
            </label>
            <PrimaryButton onClick={handleSaveRaffle}><Save size={15} /> Guardar Cambios</PrimaryButton>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* PRIZES MANAGEMENT */}
        <Card className="p-6">
          <h3 className="text-lg font-bold text-white mb-4 border-b border-stampa-border pb-2">Premios</h3>
          
          <div className="bg-stampa-bg-soft p-4 rounded-xl border border-stampa-border mb-5 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Nombre del Premio</label>
              <input type="text" value={prizeForm.name} onChange={(e) => setPrizeForm({...prizeForm, name: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white" placeholder="Ej. Impresora Ender 3" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Descripción corta</label>
              <input type="text" value={prizeForm.description} onChange={(e) => setPrizeForm({...prizeForm, description: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_5rem]">
              {userId ? (
                <FileUploadDropzone
                  bucket={RAFFLE_IMAGES_BUCKET}
                  pathPrefix={`${userId}/raffles/${id}/prizes`}
                  accept=".jpg,.jpeg,.png,.webp"
                  maxSizeMb={5}
                  publicBucket
                  label="Imagen del premio"
                  helperText="Subí una foto del producto"
                  onUploaded={(url) => setPrizeForm((current) => ({ ...current, image_url: url }))}
                />
              ) : (
                <p className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">No se pudo identificar la sesión para subir la imagen.</p>
              )}
              <div className="w-20">
                <label className="block text-xs font-semibold text-gray-300 mb-1">Orden</label>
                <input type="number" min="1" value={prizeForm.sort_order} onChange={(e) => setPrizeForm({...prizeForm, sort_order: parseInt(e.target.value)||1})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white" />
              </div>
            </div>
            {prizeForm.image_url && (
              <div className="flex items-center gap-3 rounded-lg border border-stampa-border bg-stampa-surface p-2">
                <RaffleImage
                  src={prizeForm.image_url}
                  alt="Vista previa del premio"
                  className="h-12 w-12 rounded-md bg-white/[0.03] object-contain"
                  fallback={<div className="h-12 w-12 rounded-md bg-stampa-bg-soft" />}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-gray-400">Imagen lista para guardar</span>
                <button type="button" onClick={() => setPrizeForm((current) => ({ ...current, image_url: "" }))} className="rounded-md px-2 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/10">
                  Quitar
                </button>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <PrimaryButton onClick={handleAddPrize} className="text-xs px-4 py-1.5"><Plus size={14} /> Añadir Premio</PrimaryButton>
            </div>
          </div>

          <ul className="space-y-2">
            {prizes.length === 0 && <p className="text-sm text-gray-500 italic">No hay premios cargados.</p>}
            {prizes.map((p) => (
              <li key={p.id} className="flex justify-between items-center p-3 bg-stampa-surface border border-stampa-border shadow-sm rounded-lg">
                <div className="flex items-center gap-3">
                  <RaffleImage
                    src={p.image_url}
                    alt=""
                    className="h-10 w-10 rounded border border-stampa-border bg-white/[0.03] object-contain"
                    fallback={<div className="w-10 h-10 rounded bg-stampa-orange/10 text-stampa-orange flex items-center justify-center border border-orange-100"><Trophy size={16} /></div>}
                  />
                  <div>
                    <p className="text-sm font-bold text-white">{p.name}</p>
                    <p className="text-xs text-gray-500">Orden: {p.sort_order}</p>
                  </div>
                </div>
                <button onClick={() => handleDeletePrize(p.id)} className="p-2 text-red-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        </Card>

        {/* WINNERS MANAGEMENT */}
        <Card className="p-6">
          <h3 className="text-lg font-bold text-white mb-4 border-b border-stampa-border pb-2">Ganadores</h3>
          
          <div className="bg-stampa-orange/10/50 p-4 rounded-xl border border-orange-100 mb-5 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Seleccionar Ganador (Usuario)</label>
              <select value={winnerForm.user_id} onChange={(e) => setWinnerForm({...winnerForm, user_id: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white">
                <option value="">Seleccionar participante...</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.email && p.email !== p.name ? ` · ${p.email}` : ""} · {p.chances} {p.chances === 1 ? "chance" : "chances"}
                  </option>
                ))}
              </select>
              {profiles.length === 0 && (
                <p className="mt-1.5 text-xs text-gray-500">No hay usuarios con acceso vigente para este sorteo.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Seleccionar Premio Otorgado</label>
              <select value={winnerForm.prize_id} onChange={(e) => setWinnerForm({...winnerForm, prize_id: e.target.value})} className="w-full text-sm border-white/20 rounded-md focus:border-stampa-orange bg-stampa-surface text-white">
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
              <li key={w.id} className="flex justify-between items-center p-3 bg-stampa-surface border border-stampa-border shadow-sm rounded-lg">
                <div>
                  <p className="text-sm font-bold text-white">{w.winner_name_snapshot}</p>
                  <p className="text-xs font-semibold text-stampa-orange">{w.prize_name_snapshot}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{new Date(w.won_at).toLocaleString()}</p>
                </div>
                <button onClick={() => handleDeleteWinner(w.id)} className="p-2 text-red-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
