"use client";

import React, { useState, useEffect } from "react";
import { CalendarDays, Gift, Trophy, Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import { ToolTutorial } from "@/components/tutorials/ToolTutorial";

export default function SorteosPage() {
  const supabase = createClient();
  const [activeRaffle, setActiveRaffle] = useState<any>(null);
  const [activePrizes, setActivePrizes] = useState<any[]>([]);
  const [pastWinners, setPastWinners] = useState<any[]>([]);
  const [memberLevel, setMemberLevel] = useState<string>("member");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Fetch user profile for member_level
    const { data: profile } = await supabase.from("profiles").select("member_level").eq("id", user.id).single();
    if (profile) {
      setMemberLevel(profile.member_level || "member");
    }

    // Fetch active raffle
    const { data: activeData, error: activeError } = await supabase
      .from("raffles")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (activeError && activeError.code !== 'PGRST116') {
      console.error(activeError);
      setError("Error cargando el sorteo activo.");
    } else if (activeData) {
      setActiveRaffle(activeData);
      const { data: prizes } = await supabase.from("raffle_prizes").select("*").eq("raffle_id", activeData.id).order("prize_order", { ascending: true });
      setActivePrizes(prizes || []);
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
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* 1. Header Premium */}
      <div className="bg-[#111] border border-white/10 rounded-2xl p-6 sm:p-8 flex flex-col relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center gap-2 mb-4 justify-between">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-bold uppercase tracking-wider rounded-full">
              <span className="text-[10px]">⭐</span> Beneficio para miembros
            </div>
            <ToolTutorial toolKey="raffles" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-2">
            Sorteos
          </h1>
          <p className="text-sm text-gray-400">
            Participá en sorteos exclusivos para miembros de Academia Stampa. Mientras tu membresía esté activa, podés participar en los sorteos disponibles.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* 2. Sorteo Activo Destacado */}
      {activeRaffle ? (
        <Card className="overflow-hidden bg-[#111] border-white/10 shadow-lg shadow-black/50 border border-orange-500/30 ring-1 ring-orange-500/20 rounded-2xl">
          <div className="grid grid-cols-1 md:grid-cols-5">
            <div className="md:col-span-2 flex flex-col items-center justify-center bg-[#0a0a0a] p-10 text-center border-b md:border-b-0 md:border-r border-white/5 relative overflow-hidden">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-orange-500/10 blur-3xl rounded-full"></div>
              <span className="text-8xl select-none mb-6 relative z-10 drop-shadow-2xl">🎁</span>
              
              {/* Estado de Participación */}
              <div className="relative z-10 bg-green-500/10 border border-green-500/20 px-5 py-3 rounded-xl w-full">
                <p className="text-xs font-bold text-green-400 mb-1 flex items-center justify-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  Participación Activa
                </p>
                <p className="text-[11px] text-green-500/70 font-medium">
                  Tu nivel <b>{memberLevel}</b> te da <b>{getChances()} chance{getChances() > 1 ? 's' : ''}</b> en este sorteo.
                </p>
              </div>
            </div>
            
            <div className="md:col-span-3 p-8 flex flex-col">
              <div className="mb-4">
                <Badge tone="dark" className="bg-orange-500/10 text-orange-400 border border-orange-500/20">Sorteo activo</Badge>
              </div>
              <h3 className="text-3xl font-black text-white mb-2">{activeRaffle.title}</h3>
              <p className="flex items-center gap-2 text-sm font-bold text-orange-500 mb-6 bg-orange-500/5 inline-flex self-start px-3 py-1.5 rounded-lg border border-orange-500/10">
                <CalendarDays size={16} /> Se sortea el {new Date(activeRaffle.draw_date).toLocaleDateString()}
              </p>
              
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap mb-8 flex-1">
                {activeRaffle.description}
              </div>
              
              {activePrizes.length > 0 && (
                <div className="mt-auto">
                  <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Premios en juego</h4>
                  <ul className="space-y-2">
                    {activePrizes.map((prize, idx) => (
                      <li key={prize.id} className="flex gap-3 bg-[#0a0a0a] p-3 rounded-xl border border-white/5 items-center">
                        {prize.image_url ? (
                          <img src={prize.image_url} alt="" className="w-10 h-10 object-cover rounded-lg border border-white/10" />
                        ) : (
                          <div className="w-10 h-10 bg-[#111] rounded-lg flex items-center justify-center text-lg border border-white/10 shadow-inner">🏆</div>
                        )}
                        <div className="flex-1">
                          <p className="text-sm font-bold text-white leading-none mb-1">
                            <span className="text-orange-500">{idx + 1}º</span> {prize.name}
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
      ) : (
        <div className="py-20 flex flex-col items-center justify-center bg-[#111] rounded-2xl border border-white/5 shadow-xl">
          <div className="w-16 h-16 bg-[#0a0a0a] rounded-2xl flex items-center justify-center mb-4 border border-white/10 shadow-inner">
            <span className="text-3xl grayscale opacity-50">🎟️</span>
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No hay sorteo activo en este momento</h3>
          <p className="text-sm text-gray-400 font-medium mb-6 max-w-sm text-center">
            Cuando haya un sorteo disponible para miembros, lo vas a ver acá listo para participar.
          </p>
          <a href="/canales" className="px-6 py-2.5 bg-[#0a0a0a] hover:bg-white/5 text-white text-sm font-bold rounded-xl border border-white/10 transition-colors shadow-sm">
            Ir a la Comunidad
          </a>
        </div>
      )}

      {/* 3. Cómo funcionan los sorteos */}
      <div>
        <h3 className="text-lg font-bold text-white mb-4">Cómo funcionan los sorteos</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-[#111] border-white/10 p-5 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 text-orange-500 flex items-center justify-center font-black mb-3 border border-orange-500/20">1</div>
            <h4 className="font-bold text-white text-sm mb-1">Mantené tu membresía activa</h4>
            <p className="text-xs text-gray-400">Tu participación es automática siempre que tengas acceso a la plataforma.</p>
          </Card>
          <Card className="bg-[#111] border-white/10 p-5 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 text-orange-500 flex items-center justify-center font-black mb-3 border border-orange-500/20">2</div>
            <h4 className="font-bold text-white text-sm mb-1">Revisá la fecha del sorteo</h4>
            <p className="text-xs text-gray-400">Verificá los premios en juego y agendá cuándo se anuncian los ganadores.</p>
          </Card>
          <Card className="bg-[#111] border-white/10 p-5 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 text-orange-500 flex items-center justify-center font-black mb-3 border border-orange-500/20">3</div>
            <h4 className="font-bold text-white text-sm mb-1">Ganadores en el historial</h4>
            <p className="text-xs text-gray-400">Los resultados quedan registrados abajo. ¡Mucha suerte!</p>
          </Card>
        </div>
      </div>

      {/* 4. Historial de Sorteos */}
      <div>
        <h3 className="text-lg font-bold text-white mb-4">Historial de sorteos</h3>
        
        {pastWinners.length === 0 ? (
          <div className="py-12 text-center bg-[#111] rounded-xl border border-white/5">
            <p className="text-sm text-gray-500 font-medium">Todavía no hay sorteos finalizados.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pastWinners.map((w) => (
              <Card key={w.id} className="bg-[#111] p-5 flex flex-col justify-between border border-white/10 hover:border-orange-500/30 transition-colors rounded-xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:bg-orange-500/10 transition-colors"></div>
                <div className="relative z-10">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#0a0a0a] text-orange-500 border border-white/5 shadow-inner">
                    <Trophy size={20} />
                  </div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Ganador</p>
                  <p className="text-base font-black text-white leading-tight mb-2">{w.winner_name_snapshot}</p>
                  
                  <div className="bg-[#0a0a0a] rounded-lg p-2.5 border border-white/5 mt-3">
                    <p className="text-[10px] text-gray-500 font-medium mb-0.5">Premio</p>
                    <p className="text-xs font-bold text-orange-400 line-clamp-2 leading-snug">{w.prize_name_snapshot}</p>
                  </div>
                </div>
                <div className="mt-5 pt-4 border-t border-white/5 flex items-center justify-between">
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
      <div className="mt-4 bg-gradient-to-r from-[#111] to-[#151515] border border-white/10 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0a0a0a] rounded-xl flex items-center justify-center border border-white/5 shrink-0 shadow-inner">
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
          className="shrink-0 px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-orange-500/20"
        >
          Preguntar a Stampy
        </a>
      </div>

    </div>
  );
}
