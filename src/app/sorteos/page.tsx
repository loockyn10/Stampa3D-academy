"use client";

import React, { useState, useEffect, useMemo } from "react";
import { RafflesView } from "@/components/raffles/raffles-view";
import { createClient } from "@/utils/supabase/client";
import { getOrCreateReferralCode } from "@/lib/referral";
import {
  getVisibleRaffles,
  type PublicRaffle,
} from "@/lib/raffles/public-raffles";
import { resolveRaffleImageUrl } from "@/lib/raffles/images";
import { getBaseRaffleChances } from "@/lib/raffles/participants";
import { getRaffleTimeStatus, groupWinnersByRaffle, type RaffleWinnerRow } from "@/lib/raffles/status";
import { RafflesPageSkeleton } from "@/components/ui/page-skeletons";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";

export default function SorteosPage() {
  const [supabase] = useState(() => createClient());
  const [activeRaffles, setActiveRaffles] = useState<PublicRaffle[]>([]);
  const [pastWinners, setPastWinners] = useState<RaffleWinnerRow[]>([]);
  const [memberLevel, setMemberLevel] = useState<string>("member");
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [bonusEntries, setBonusEntries] = useState<number>(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let active = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
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
        setActiveRaffles(rafflesResult.data.map((raffle) => ({
          ...raffle,
          cover_image_url: resolveRaffleImageUrl(supabase, raffle.cover_image_url),
          raffle_prizes: raffle.raffle_prizes.map((prize) => ({
            ...prize,
            image_url: resolveRaffleImageUrl(supabase, prize.image_url),
          })),
        })));
      }
      setPastWinners((winnersResult.data || []) as RaffleWinnerRow[]);
      setLoading(false);
    };

    void fetchData();
    return () => { active = false; };
  }, [supabase]);

  // referralCode solo existe después de cargar en el cliente: no hay desajuste de hidratación.
  const referralLink = referralCode && typeof window !== "undefined" ? `${window.location.origin}/registro?ref=${referralCode}` : null;

  const baseChances = getBaseRaffleChances(memberLevel);
  const totalChances = baseChances + bonusEntries;
  const finishedRaffles = useMemo(() => groupWinnersByRaffle(pastWinners), [pastWinners]);

  const stampyScreenContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "raffles", route: "/sorteos", title: "Sorteos" },
    mode: helpOpen ? "rules" : "browse",
    visibleEntities: activeRaffles.slice(0, 20).map((raffle, index) => ({
      type: "active_raffle",
      id: String(raffle.id),
      name: raffle.title,
      position: index + 1,
      facts: [
        { label: "Estado visible", value: getRaffleTimeStatus(raffle.draw_date).label },
        ...(raffle.draw_date ? [{ label: "Fecha de sorteo visible", value: new Date(raffle.draw_date).toLocaleDateString("es-AR") }] : []),
        ...(raffle.raffle_prizes[0]?.name ? [{ label: "Premio principal visible", value: String(raffle.raffle_prizes[0].name) }] : []),
        { label: "Cantidad de premios visibles", value: raffle.raffle_prizes.length },
        { label: "Mis chances visibles", value: totalChances },
      ],
    })),
    pageData: {
      kind: "pageFacts",
      facts: [
        { label: "Sorteos activos visibles", value: activeRaffles.length },
        { label: "Chances base visibles", value: baseChances },
        { label: "Chances por referidos visibles", value: bonusEntries },
        { label: "Chances totales visibles", value: totalChances },
        { label: "Sorteos anteriores visibles", value: finishedRaffles.length },
        { label: "Código de referido disponible en pantalla", value: Boolean(referralCode) },
      ],
    },
    uiState: { loading, ...(helpOpen ? { activeDialog: "¿Cómo funcionan los sorteos?" } : {}) },
  }), [activeRaffles, baseChances, bonusEntries, finishedRaffles.length, helpOpen, loading, referralCode, totalChances]);

  usePublishStampyScreenContext(stampyScreenContext);

  const copyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2500);
  };

  if (loading) {
    return <RafflesPageSkeleton />;
  }

  return (
    <RafflesView
      activeRaffles={activeRaffles}
      finishedRaffles={finishedRaffles}
      baseChances={baseChances}
      bonusEntries={bonusEntries}
      referralLink={referralLink}
      copyState={copyState}
      onCopy={() => void copyLink()}
      error={error}
      helpOpen={helpOpen}
      onHelpOpenChange={setHelpOpen}
    />
  );
}
