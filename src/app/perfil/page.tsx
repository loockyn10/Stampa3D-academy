"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import { Loader2, AlertCircle, Copy, Check, Users, Shield, Star, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import { AccountManager } from "@/components/configuracion/account-manager";
import { getOrCreateReferralCode } from "@/lib/referral";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://academia-stampa.com";

function PerfilContent() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Profile data
  const [profile, setProfile] = useState<any>(null);
  const [badges, setBadges] = useState<any[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [betaGrant, setBetaGrant] = useState<any>(null);
  const [founderData, setFounderData] = useState<any>(null);
  const [referralStats, setReferralStats] = useState({ pending: 0, converted: 0 });
  const [copied, setCopied] = useState(false);
  const [membershipOpen, setMembershipOpen] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Fetch profile
    const { data: pData, error: pError } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if (pError) {
      setError(pError.message);
    } else if (pData) {
      setProfile({ ...pData, email: user.email });

      // Ensure referral_code exists
      const code = await getOrCreateReferralCode(supabase, user.id, pData.referral_code, pData);
      setReferralCode(code);
    }

    // Fetch badges
    const { data: bData } = await supabase.from("user_badges").select("*, badges(*)").eq("user_id", user.id).order("awarded_at", { ascending: false });
    if (bData) {
      setBadges(bData.map(ub => ub.badges).filter(b => b && b.is_active));
    }

    // Fetch subscription
    const { data: subData } = await supabase.from("subscriptions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).single();
    if (subData) {
      setSubscription(subData);
    }

    // Fetch active beta grant
    const { data: grantData } = await supabase
      .from("user_access_grants")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active")
      .in("grant_type", ["beta_tester", "manual_free_access", "internal_tester"])
      .limit(1)
      .maybeSingle();
    if (grantData) setBetaGrant(grantData);

    // Fetch founder status
    const { data: fData } = await supabase
      .from("founder_members")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (fData) setFounderData(fData);

    // Fetch referral stats
    const { data: refData } = await supabase
      .from("referrals")
      .select("status")
      .eq("referrer_user_id", user.id);
    if (refData) {
      setReferralStats({
        pending: refData.filter(r => r.status === "pending").length,
        converted: refData.filter(r => r.status === "converted" || r.status === "rewarded").length,
      });
    }

    setLoading(false);
  };

  const calculateMonths = (dateStr: string) => {
    if (!dateStr) return 0;
    const start = new Date(dateStr);
    const now = new Date();
    const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    return Math.max(1, months);
  };

  const handleCopy = async () => {
    if (!referralCode) return;
    const link = `${APP_BASE_URL}/registro?ref=${referralCode}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const stampyScreenContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "profile", route: "/perfil", title: "Mi Perfil" },
    mode: membershipOpen ? "membership_details" : "view",
    visibleEntities: badges.slice(0, 20).map((badge, index) => ({
      type: "badge",
      id: String(badge.id),
      name: badge.name,
      position: index + 1,
    })),
    pageData: {
      kind: "pageFacts",
      facts: [
        { label: "Estado de membresía visible", value: profile?.membership_status === "active" ? "Activa" : "Inactiva" },
        { label: "Nivel de membresía visible", value: String(profile?.member_level || "member") },
        { label: "Acceso beta visible", value: Boolean(betaGrant) },
        { label: "Estado fundador visible", value: Boolean(founderData && founderData.status === "active") },
        { label: "Código de referido disponible en pantalla", value: Boolean(referralCode) },
        { label: "Referidos pendientes visibles", value: referralStats.pending },
        { label: "Referidos convertidos visibles", value: referralStats.converted },
        { label: "Insignias visibles", value: badges.length },
        ...(membershipOpen && subscription?.status
          ? [{ label: "Estado visible de la suscripción", value: String(subscription.status) }]
          : []),
      ],
    },
    uiState: {
      loading,
      ...(membershipOpen ? { activeDialog: "Detalle desplegado de membresía" } : {}),
    },
  }), [badges, betaGrant, founderData, loading, membershipOpen, profile?.member_level, profile?.membership_status, referralCode, referralStats.converted, referralStats.pending, subscription?.status]);

  usePublishStampyScreenContext(stampyScreenContext);

  if (loading && !profile) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-stampa-orange" /></div>;

  const displayName = profile?.display_name || profile?.full_name || profile?.company_name || "Usuario";
  const isBetaTester = !!betaGrant;
  const isFounder = !!founderData && founderData.status === "active";

  return (
    <div>
      <SectionTitle eyebrow="Usuario" title="Mi Perfil" />
      <p className="text-gray-500 text-sm -mt-3 mb-6">Gestioná tus datos personales y el estado de tu cuenta.</p>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600 max-w-xl">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {profile && (
        <div className="space-y-6">
          <Card className="max-w-4xl p-5 sm:p-6">
            <div className={`grid gap-5 border-b border-stampa-border pb-5 mb-5 ${referralCode ? "md:grid-cols-[minmax(0,1fr)_minmax(17rem,0.8fr)]" : ""}`}>
              <div className="flex min-w-0 items-center gap-4 sm:items-start">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-orange-100 text-lg font-bold text-stampa-orange select-none uppercase sm:h-16 sm:w-16 sm:text-xl">
                  {displayName.substring(0, 2) || "US"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-white">{displayName}</p>
                  <p className="mb-1.5 truncate text-sm text-gray-400">{profile.email}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={profile.membership_status === "active" ? "green" : "gray"} className="capitalize">
                      {profile.membership_status === "active" ? "Activo" : "Inactivo"}
                    </Badge>
                    <Badge tone="dark" className="capitalize">Nivel {profile.member_level || "member"}</Badge>
                    <Badge tone="orange">{profile.active_months || calculateMonths(profile.membership_started_at || profile.created_at)} meses activo</Badge>

                    {isBetaTester && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                        <Shield size={11} /> Beta Tester
                      </span>
                    )}

                    {isFounder && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                        <Star size={11} /> Fundador #{founderData.founder_number}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {referralCode && (
                <div className="min-w-0 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Users size={16} className="shrink-0 text-violet-400" />
                      <h3 className="truncate text-sm font-bold text-white">Tu código de referido</h3>
                    </div>
                    <span className="shrink-0 font-mono text-base font-bold tracking-wider text-violet-200 select-all">
                      {referralCode}
                    </span>
                  </div>

                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
                    <code className="min-w-0 flex-1 truncate rounded-lg border border-stampa-border bg-stampa-bg-soft px-3 py-2 text-xs text-gray-300">
                      {APP_BASE_URL}/registro?ref={referralCode}
                    </code>
                    <button
                      onClick={handleCopy}
                      className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors motion-reduce:transition-none ${
                        copied
                          ? "border-green-500/30 bg-green-500/10 text-green-400"
                          : "border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                      }`}
                    >
                      {copied ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar link</>}
                    </button>
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-gray-500">
                    Cada suscripción con tu código suma una participación extra en sorteos.
                  </p>

                  {(referralStats.pending > 0 || referralStats.converted > 0) && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-stampa-border pt-3 text-xs text-gray-500">
                      {referralStats.pending > 0 && <span><strong className="text-white">{referralStats.pending}</strong> pendientes</span>}
                      {referralStats.converted > 0 && <span><strong className="text-green-400">{referralStats.converted}</strong> convertidos</span>}
                    </div>
                  )}
                </div>
              )}
            </div>

            {subscription && (
              <div className="mb-6 overflow-hidden rounded-xl border border-stampa-border bg-stampa-bg-soft text-sm">
                <button
                  type="button"
                  onClick={() => setMembershipOpen((current) => !current)}
                  aria-expanded={membershipOpen}
                  aria-controls="profile-membership-details"
                  className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] motion-reduce:transition-none"
                >
                  <span className="font-bold text-white">Membresía</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-400">
                      {profile.membership_status === "active" ? "Activa" : "Inactiva"}
                    </span>
                    <ChevronDown
                      size={17}
                      className={`text-gray-500 transition-transform duration-200 motion-reduce:transition-none ${membershipOpen ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </span>
                </button>

                <div
                  id="profile-membership-details"
                  aria-hidden={!membershipOpen}
                  className={`grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${membershipOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <div className="overflow-hidden">
                    <div className="border-t border-stampa-border px-4 pb-4 pt-3">
                      <div className="flex justify-between gap-4">
                        <span className="text-gray-500 font-semibold">Estado de membresía</span>
                        <span className="text-right font-bold text-white">
                          {profile.membership_status === "active" && (subscription.status === "cancelled" || subscription.status === "canceled")
                            ? "Cancelada (Acceso temporal)"
                            : profile.membership_status === "active"
                              ? "Activa"
                              : "Vencida / Inactiva"}
                        </span>
                      </div>

                      <p className="mt-2 text-xs text-gray-500">
                        {profile.membership_status === "active" && (subscription.status === "cancelled" || subscription.status === "canceled") && profile.membership_expires_at
                          ? `Tu suscripción fue cancelada. Tenés acceso hasta el ${new Date(profile.membership_expires_at).toLocaleDateString("es-AR")}.`
                          : profile.membership_status === "active"
                            ? "Tu membresía está activa."
                            : "Tu membresía venció."}
                      </p>

                      {subscription.amount && (
                        <div className="flex justify-between gap-4 mt-3 pt-3 border-t border-stampa-border">
                          <span className="text-gray-500 font-semibold">Monto mensual (Suscripción {subscription.status})</span>
                          <span className="shrink-0 font-bold text-white">${subscription.amount}</span>
                        </div>
                      )}
                      {subscription.next_payment_at && profile.membership_status === "active" && subscription.status !== "cancelled" && subscription.status !== "canceled" && (
                        <div className="flex justify-between gap-4 mt-1">
                          <span className="text-gray-500 font-semibold">Próximo cobro</span>
                          <span className="shrink-0 font-bold text-white">{new Date(subscription.next_payment_at).toLocaleDateString("es-AR")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Beta Tester notice */}
            {isBetaTester && (
              <div className="mb-4 p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Shield size={14} className="text-cyan-400" />
                  <span className="font-semibold text-cyan-300">Acceso Beta Tester</span>
                </div>
                <p className="text-gray-400 text-xs">
                  Tenés acceso anticipado a Academia Stampa como beta tester.
                  {betaGrant.expires_at && ` Tu acceso vence el ${new Date(betaGrant.expires_at).toLocaleDateString("es-AR")}.`}
                  {betaGrant.notes && <span className="block mt-1 italic">{betaGrant.notes}</span>}
                </p>
              </div>
            )}
          </Card>

          <AccountManager />

          {/* BADGES SECTION */}
          <div className="max-w-xl">
            <h3 className="text-lg font-bold text-white mb-3">Tus Insignias</h3>
            {badges.length === 0 ? (
              <Card className="p-6 text-center border-dashed border-white/20">
                <p className="text-sm text-gray-500">Aún no has ganado insignias. ¡Participa en la comunidad para conseguir la primera!</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {badges.map(b => (
                  <Card key={b.id} className="p-4 flex items-center gap-3 border-orange-200 bg-orange-50/30">
                    <div className="w-12 h-12 flex items-center justify-center rounded-full bg-stampa-surface shadow-sm border border-stampa-border text-2xl">
                      {b.icon}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{b.name}</p>
                      <p className="text-[11px] text-gray-400 leading-tight mt-0.5">{b.description}</p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PerfilPage() {
  return (
    <Suspense fallback={<div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-stampa-orange" /></div>}>
      <PerfilContent />
    </Suspense>
  );
}
