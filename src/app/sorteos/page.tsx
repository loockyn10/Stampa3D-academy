"use client";

import React, { useState, useEffect } from "react";
import { CalendarDays, Gift, Trophy, Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";

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

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <div className="space-y-8">
      <SectionTitle eyebrow="Comunidad" title="Sorteos" />

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {activeRaffle ? (
        <Card className="overflow-hidden border-orange-200 shadow-md">
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <div className="flex flex-col items-center justify-center bg-orange-50 p-10 text-center border-b sm:border-b-0 sm:border-r border-orange-100">
              <span className="text-7xl select-none mb-4">🎁</span>
              <p className="text-sm font-bold text-orange-800 bg-orange-200/50 px-4 py-2 rounded-lg">
                Tu nivel actual ({memberLevel}) te da {getChances()} participación/es en este sorteo.
              </p>
            </div>
            <div className="p-6">
              <div className="mb-2">
                <Badge tone="dark">Sorteo activo</Badge>
              </div>
              <h3 className="text-2xl font-black text-gray-900">{activeRaffle.title}</h3>
              <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-orange-600">
                <CalendarDays size={16} /> Se sortea el {new Date(activeRaffle.draw_date).toLocaleDateString()}
              </p>
              <p className="mt-4 text-sm text-gray-600 whitespace-pre-wrap">
                {activeRaffle.description}
              </p>
              
              {activePrizes.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Premios</h4>
                  <ul className="space-y-3">
                    {activePrizes.map((prize, idx) => (
                      <li key={prize.id} className="flex gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                        {prize.image_url ? (
                          <img src={prize.image_url} alt="" className="w-12 h-12 object-cover rounded bg-white" />
                        ) : (
                          <div className="w-12 h-12 bg-white rounded flex items-center justify-center text-xl shadow-sm border border-gray-100">🏆</div>
                        )}
                        <div>
                          <p className="text-sm font-bold text-gray-900">{idx + 1}º Premio: {prize.name}</p>
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
        <Card className="p-10 text-center bg-gray-50 border-dashed border-gray-300">
          <Gift size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-bold text-gray-900">No hay sorteos activos</h3>
          <p className="text-sm text-gray-500 mt-1">Mantente atento a las próximas novedades en la comunidad.</p>
        </Card>
      )}

      <div>
        <SectionTitle eyebrow="Ediciones pasadas" title="Historial de ganadores" />
        
        {pastWinners.length === 0 ? (
          <p className="text-sm text-gray-500">Aún no hay historial de ganadores.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {pastWinners.map((w) => (
              <Card key={w.id} className="p-4 flex flex-col justify-between hover:border-orange-200 transition-colors">
                <div>
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-orange-500">
                    <Trophy size={18} />
                  </div>
                  <p className="text-sm font-bold text-gray-900">{w.winner_name_snapshot}</p>
                  <p className="text-xs font-semibold text-orange-600 mt-0.5">{w.prize_name_snapshot}</p>
                </div>
                <p className="mt-4 text-[11px] font-medium text-gray-400">
                  {w.raffles?.title || "Sorteo"} · {new Date(w.won_at).toLocaleDateString()}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
