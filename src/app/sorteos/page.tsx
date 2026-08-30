"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { AlertCircle, CalendarDays, Gift, Ticket, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { createClient } from "@/utils/supabase/client";
import { getOrCreateReferralCode } from "@/lib/referral";
import {
  getVisibleRaffles,
  type PublicRaffle,
} from "@/lib/raffles/public-raffles";
import { RafflesPageSkeleton } from "@/components/ui/page-skeletons";

export default function SorteosPage() {
  const [supabase] = useState(() => createClient());
  const [activeRaffles, setActiveRaffles] = useState<PublicRaffle[]>([]);
  const [pastWinners, setPastWinners] = useState<any[]>([]);
  const [memberLevel, setMemberLevel] = useState<string>("member");
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [bonusEntries, setBonusEntries] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const fetchData = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (active) setLoading(false);
        return;
      }

      const [profileResult, bonusResult, rafflesResult, winnersResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("member_level, referral_code, display_name, full_name, email")
          .eq("id", user.id)
          .single(),
        supabase
          .from("user_raffle_bonus_entries")
          .select("entries_count")
          .eq("user_id", user.id)
          .eq("is_active", true),
        getVisibleRaffles(supabase),
        supabase
          .from("raffle_winners")
          .select("id, winner_name_snapshot, prize_name_snapshot, won_at, raffles(title, draw_date)")
          .order("won_at", { ascending: false }),
      ]);

      if (!active) return;
      const profile = profileResult.data;
      if (profile) {
        setMemberLevel(profile.member_level || "member");
        let refCode = profile.referral_code;
        if (!refCode) refCode = await getOrCreateReferralCode(supabase, user.id, null, profile);
        if (active) setReferralCode(refCode);
      }

      if (bonusResult.data && !bonusResult.error) {
        setBonusEntries(bonusResult.data.reduce((sum, row) => sum + (row.entries_count || 0), 0));
      }
      if (rafflesResult.error) {
        console.error(rafflesResult.error);
        setError("Error cargando los sorteos activos.");
      } else {
        setActiveRaffles(rafflesResult.data);
      }
      setPastWinners(winnersResult.data || []);
      setLoading(false);
    };

    void fetchData();
    return () => { active = false; };
  }, [supabase]);

  const getChances = () => {
    if (memberLevel === "gold" || memberLevel === "elite") return 2;
    return 1;
  };

  if (loading) {
    return <RafflesPageSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6 pb-8 sm:gap-8 sm:pb-12">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">Sorteos</h1>
        <p className="mt-2 text-sm text-gray-400">
          Participá de los sorteos de Stampa y sumá chances invitando amigos.
        </p>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* 2. Sorteos activos */}
      {activeRaffles.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-6">
          {activeRaffles.map((activeRaffle) => {
            const activePrizes = activeRaffle.raffle_prizes;
            const mainPrize = activePrizes[0];
            const totalChances = getChances() + bonusEntries;
            return (
              <Card key={activeRaffle.id} className="overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface shadow-lg shadow-black/30">
                {mainPrize?.image_url ? (
                  <div className="h-36 overflow-hidden border-b border-stampa-border bg-stampa-bg-soft sm:h-40">
                    <img
                      src={mainPrize.image_url}
                      alt={mainPrize.name}
                      className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.02]"
                    />
                  </div>
                ) : (
                  <div className="flex h-24 items-center justify-center border-b border-stampa-border bg-stampa-bg-soft text-gray-500">
                    <Gift size={28} aria-hidden="true" />
                  </div>
                )}

                <div className="flex flex-col p-4 sm:p-5">
                  <h2 className="text-xl font-black leading-tight text-white sm:text-2xl">{activeRaffle.title}</h2>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-stampa-orange/15 bg-stampa-orange/5 px-2.5 py-1.5 text-stampa-orange">
                      <CalendarDays size={14} aria-hidden="true" />
                      {activeRaffle.draw_date
                        ? new Date(activeRaffle.draw_date).toLocaleDateString("es-AR", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "Fecha a confirmar"}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/20 bg-violet-500/10 px-2.5 py-1.5 text-violet-300">
                      <Ticket size={14} aria-hidden="true" />
                      {totalChances} {totalChances === 1 ? "chance" : "chances"}
                    </span>
                  </div>

                  {activePrizes.length > 0 && (
                    <div className="mt-5">
                      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Premios</h3>
                      <ul className="space-y-2">
                        {activePrizes.map((prize, idx) => (
                          <li key={prize.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-stampa-border bg-stampa-bg-soft p-2.5">
                            {prize.image_url ? (
                              <img src={prize.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-stampa-border object-cover" />
                            ) : (
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stampa-border bg-stampa-surface text-gray-500">
                                <Gift size={16} aria-hidden="true" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold leading-snug text-white">
                                <span className="mr-1 text-stampa-orange">{idx + 1}º</span>
                                {prize.name}
                              </p>
                              {prize.description && (
                                <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{prize.description}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-stampa-border bg-stampa-surface px-5 py-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-stampa-border bg-stampa-bg-soft text-gray-500">
            <Ticket size={22} />
          </div>
          <h2 className="text-lg font-bold text-white">Todavía no hay sorteos activos.</h2>
          <Link href="/canales" className="mt-4 rounded-xl border border-stampa-border bg-stampa-bg-soft px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-white/5">
            Ir a la Comunidad
          </Link>
        </div>
      )}

      {/* 3. Mis chances */}
      <div>
        <h2 className="mb-3 text-lg font-bold text-white">Mis chances</h2>
        <Card className="relative overflow-hidden rounded-2xl border-stampa-border bg-stampa-surface p-4 sm:p-5 md:p-6">
          <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 -translate-y-1/2 translate-x-1/2 rounded-full bg-violet-500/10 blur-3xl" />

          <div className="relative z-10 grid grid-cols-1 gap-5 md:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)] md:gap-6">
            <div className="flex flex-col justify-center border-b border-stampa-border pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-violet-400 to-orange-400">
                  {getChances() + bonusEntries}
                </span>
                <span className="text-sm font-bold text-gray-400">chances totales</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {getChances()} base · {bonusEntries} por referidos
              </p>
            </div>

            <div className="flex flex-col justify-center">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-white">Invitá amigos y sumá chances</h3>
                <p className="mt-1 text-xs text-gray-400">Cada referido suma +1 chance.</p>
              </div>

              <div className="flex min-w-0 items-stretch gap-2">
                <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 shadow-inner">
                  {referralCode ? (
                    <span className="truncate font-mono text-xs font-bold tracking-wide text-violet-400 sm:text-sm">
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
                  className="flex shrink-0 items-center justify-center rounded-xl border border-stampa-border bg-white/5 px-3 py-2.5 text-xs font-bold text-white transition-colors hover:bg-white/10 disabled:opacity-50 sm:px-4 sm:text-sm"
                >
                  {copied ? "¡Copiado!" : "Copiar"}
                </button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* 4. Historial de Sorteos */}
      {pastWinners.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-bold text-white">Historial de sorteos</h2>
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
        </section>
      )}
    </div>
  );
}
