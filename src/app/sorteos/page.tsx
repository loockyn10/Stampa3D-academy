"use client";

import React, { useState, useEffect } from "react";
import { CalendarDays, Gift, Trophy, Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import { getOrCreateReferralCode } from "@/lib/referral";
import {
  getVisibleRaffles,
  type PublicRaffle,
} from "@/lib/raffles/public-raffles";

export default function SorteosPage() {
  const supabase = createClient();
  const [activeRaffles, setActiveRaffles] = useState<PublicRaffle[]>([]);
  const [pastWinners, setPastWinners] = useState<any[]>([]);
  const [memberLevel, setMemberLevel] = useState<string>("member");
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [bonusEntries, setBonusEntries] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Fetch user profile for member_level and referral
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if (profile) {
      setMemberLevel(profile.member_level || "member");
      
      let refCode = profile.referral_code;
      if (!refCode) {
        refCode = await getOrCreateReferralCode(supabase, user.id, null, profile);
      }
      setReferralCode(refCode);
    }

    // Fetch bonus entries
    try {
      const { data: bonusData, error: bonusError } = await supabase
        .from("user_raffle_bonus_entries")
        .select("entries_count")
        .eq("user_id", user.id)
        .eq("is_active", true);
      
      if (bonusData && !bonusError) {
        setBonusEntries(bonusData.reduce((acc, curr) => acc + (curr.entries_count || 0), 0));
      }
    } catch (e) {
      // ignore table not found
    }

    // Fetch every raffle that is explicitly public and active.
    const { data: activeData, error: activeError } = await getVisibleRaffles(supabase);

    if (activeError) {
      console.error(activeError);
      setError("Error cargando los sorteos activos.");
    } else {
      setActiveRaffles(activeData);
    }

    // Fetch past winners
    const { data: winnersData } = await supabase
      .from("raffle_winners")
      .select("*, raffles(title, draw_date)")
      .order("won_at", { ascending: false });

    setPastWinners(winnersData || []);
    setLoading(false);
  };

  const getChances = () => {
    if (memberLevel === "gold" || memberLevel === "elite") return 2;
    return 1;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-stampa-orange" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* 1. Header Premium */}
      <div className="bg-stampa-surface border border-stampa-border rounded-2xl p-6 sm:p-8 flex flex-col relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-stampa-orange/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center gap-2 mb-4 justify-between">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-stampa-orange/10 border border-stampa-orange/20 text-orange-400 text-[10px] font-bold uppercase tracking-wider rounded-full">
              <span className="text-[10px]">⭐</span> Beneficio para miembros
            </div>

          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-2">
            Sorteos
          </h1>
          <p className="text-sm text-gray-400">
            Participá de sorteos exclusivos para miembros de Academia Stampa. Cada participación suma una chance. Podés ganar participaciones extra invitando amigos con tu código.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* 2. Sorteos activos */}
      {activeRaffles.length > 0 ? (
        <div className="space-y-6">
          {activeRaffles.map((activeRaffle) => {
            const activePrizes = activeRaffle.raffle_prizes;
            return (
        <Card key={activeRaffle.id} className="overflow-hidden bg-stampa-surface border-stampa-border shadow-lg shadow-black/50 border border-stampa-orange/30 ring-1 ring-stampa-orange/20 rounded-2xl">
          <div className="grid grid-cols-1 md:grid-cols-5">
            <div className="md:col-span-2 flex flex-col items-center justify-center bg-stampa-bg-soft p-10 text-center border-b md:border-b-0 md:border-r border-stampa-border relative overflow-hidden">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-stampa-orange/10 blur-3xl rounded-full"></div>
              <span className="text-8xl select-none mb-6 relative z-10 drop-shadow-2xl">🎁</span>
              
              {/* Estado de Participación */}
              <div className="relative z-10 bg-green-500/10 border border-green-500/20 px-5 py-3 rounded-xl w-full">
                <p className="text-xs font-bold text-green-400 mb-1 flex items-center justify-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  Participación Activa
                </p>
                <p className="text-[11px] text-green-500/70 font-medium">
                  Tenés <b>{getChances() + bonusEntries} participacion{getChances() + bonusEntries !== 1 ? 'es' : ''}</b> en este sorteo.
                </p>
              </div>
            </div>
            
            <div className="md:col-span-3 p-8 flex flex-col">
              <div className="mb-4">
                <Badge tone="dark" className="bg-stampa-orange/10 text-orange-400 border border-stampa-orange/20">Sorteo activo</Badge>
              </div>
              <h3 className="text-3xl font-black text-white mb-2">{activeRaffle.title}</h3>
              <p className="flex items-center gap-2 text-sm font-bold text-stampa-orange mb-6 bg-stampa-orange/5 inline-flex self-start px-3 py-1.5 rounded-lg border border-stampa-orange/10">
                <CalendarDays size={16} /> {activeRaffle.draw_date
                  ? `Se sortea el ${new Date(activeRaffle.draw_date).toLocaleDateString()}`
                  : "Fecha a confirmar"}
              </p>
              
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap mb-8 flex-1">
                {activeRaffle.description}
              </div>
              
              {activePrizes.length > 0 && (
                <div className="mt-auto">
                  <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Premios en juego</h4>
                  <ul className="space-y-2">
                    {activePrizes.map((prize, idx) => (
                      <li key={prize.id} className="flex gap-3 bg-stampa-bg-soft p-3 rounded-xl border border-stampa-border items-center">
                        {prize.image_url ? (
                          <img src={prize.image_url} alt="" className="w-10 h-10 object-cover rounded-lg border border-stampa-border" />
                        ) : (
                          <div className="w-10 h-10 bg-stampa-surface rounded-lg flex items-center justify-center text-lg border border-stampa-border shadow-inner">🏆</div>
                        )}
                        <div className="flex-1">
                          <p className="text-sm font-bold text-white leading-none mb-1">
                            <span className="text-stampa-orange">{idx + 1}º</span> {prize.name}
                          </p>
                          <p className="text-xs text-gray-500 line-clamp-1">{prize.description}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </Card>
            );
          })}
        </div>
      ) : (
        <div className="py-20 flex flex-col items-center justify-center bg-stampa-surface rounded-2xl border border-stampa-border shadow-xl">
          <div className="w-16 h-16 bg-stampa-bg-soft rounded-2xl flex items-center justify-center mb-4 border border-stampa-border shadow-inner">
            <span className="text-3xl grayscale opacity-50">🎟️</span>
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Todavía no hay sorteos activos.</h3>
          <p className="text-sm text-gray-400 font-medium mb-6 max-w-sm text-center">
            Cuando haya un sorteo disponible para miembros, lo vas a ver acá listo para participar.
          </p>
          <a href="/canales" className="px-6 py-2.5 bg-stampa-bg-soft hover:bg-white/5 text-white text-sm font-bold rounded-xl border border-stampa-border transition-colors shadow-sm">
            Ir a la Comunidad
          </a>
        </div>
      )}

      {/* 3. Mis participaciones */}
      <div>
        <h3 className="text-lg font-bold text-white mb-4">Mis participaciones</h3>
        <Card className="bg-stampa-surface border-stampa-border p-6 md:p-8 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
            <div className="flex flex-col justify-center border-b md:border-b-0 md:border-r border-stampa-border pb-8 md:pb-0 md:pr-8">
              <p className="text-sm text-gray-400 font-medium mb-2 uppercase tracking-wider">Total Acumuladas</p>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-violet-400 to-orange-400">
                  {getChances() + bonusEntries}
                </span>
                <span className="text-lg font-bold text-gray-500">chances</span>
              </div>
              <p className="text-xs text-gray-500">
                {getChances()} base + {bonusEntries} extra por referidos
              </p>
            </div>

            <div className="flex flex-col justify-center">
              <div className="mb-4">
                <p className="text-sm font-bold text-white mb-1">Invitá amigos y sumá chances</p>
                <p className="text-xs text-gray-400">Cuando alguien se suscriba usando tu código, sumás 1 participación extra.</p>
              </div>
              
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1 bg-stampa-bg-soft border border-stampa-border rounded-xl px-4 py-3 flex items-center shadow-inner overflow-hidden">
                  {referralCode ? (
                    <span className="font-mono text-sm font-bold text-violet-400 tracking-wider truncate">
                      {typeof window !== 'undefined' ? `${window.location.origin}/registro?ref=${referralCode}` : referralCode}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500 italic truncate">Tu código se está preparando...</span>
                  )}
                </div>
                <button 
                  onClick={() => {
                    if (referralCode) {
                      const link = typeof window !== 'undefined' ? `${window.location.origin}/registro?ref=${referralCode}` : referralCode;
                      navigator.clipboard.writeText(link);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }
                  }}
                  disabled={!referralCode}
                  className="shrink-0 px-4 py-3 bg-white/5 hover:bg-white/10 border border-stampa-border text-white rounded-xl text-sm font-bold transition-colors flex items-center justify-center min-w-[120px] disabled:opacity-50"
                >
                  {copied ? "¡Copiado!" : "Copiar link"}
                </button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* 4. Historial de Sorteos */}
      <div>
        <h3 className="text-lg font-bold text-white mb-4">Historial de sorteos</h3>
        
        {pastWinners.length === 0 ? (
          <div className="py-12 text-center bg-stampa-surface rounded-xl border border-stampa-border">
            <p className="text-sm text-gray-500 font-medium">Todavía no hay sorteos finalizados.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pastWinners.map((w) => (
              <Card key={w.id} className="bg-stampa-surface p-5 flex flex-col justify-between border border-stampa-border hover:border-stampa-orange/30 transition-colors rounded-xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-stampa-orange/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:bg-stampa-orange/10 transition-colors"></div>
                <div className="relative z-10">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-stampa-bg-soft text-stampa-orange border border-stampa-border shadow-inner">
                    <Trophy size={20} />
                  </div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Ganador</p>
                  <p className="text-base font-black text-white leading-tight mb-2">{w.winner_name_snapshot}</p>
                  
                  <div className="bg-stampa-bg-soft rounded-lg p-2.5 border border-stampa-border mt-3">
                    <p className="text-[10px] text-gray-500 font-medium mb-0.5">Premio</p>
                    <p className="text-xs font-bold text-orange-400 line-clamp-2 leading-snug">{w.prize_name_snapshot}</p>
                  </div>
                </div>
                <div className="mt-5 pt-4 border-t border-stampa-border flex items-center justify-between">
                  <p className="text-[10px] font-bold text-gray-400 truncate max-w-[120px]" title={w.raffles?.title || "Sorteo"}>
                    {w.raffles?.title || "Sorteo"}
                  </p>
                  <p className="text-[10px] text-gray-500 font-medium bg-white/5 px-2 py-1 rounded-md">
                    {new Date(w.won_at).toLocaleDateString()}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 5. CTA Stampy */}
      <div className="mt-4 bg-gradient-to-r from-cyan-500/5 to-violet-500/5 border border-cyan-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-stampa-bg-soft rounded-xl flex items-center justify-center border border-cyan-500/10 shrink-0 shadow-inner">
            <span className="text-2xl">🤖</span>
          </div>
          <div>
            <h4 className="font-bold text-white mb-1">¿Tenés dudas sobre los beneficios?</h4>
            <p className="text-sm text-gray-400">
              Preguntale a Stampy y te guía dentro de la plataforma.
            </p>
          </div>
        </div>
        <a 
          href="/stampy"
          className="shrink-0 px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-violet-600 hover:brightness-110 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-cyan-500/10"
        >
          Preguntar a Stampy
        </a>
      </div>

    </div>
  );
}
