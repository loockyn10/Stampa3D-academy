"use client";

import React, { useState, useEffect, Suspense } from "react";
import { Loader2, AlertCircle, Settings2, Copy, Check, Users, Shield, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import { AccountManager } from "@/components/configuracion/account-manager";
import { getOrCreateReferralCode } from "@/lib/referral";

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
          <Card className="max-w-xl p-6">
            <div className="flex items-start justify-between border-b border-stampa-border pb-5 mb-5">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-xl font-bold text-stampa-orange select-none uppercase">
                  {displayName.substring(0, 2) || "US"}
                </div>
                <div className="flex-1">
                  <p className="text-base font-bold text-white">{displayName}</p>
                  <p className="text-sm text-gray-400 mb-1.5">{profile.email}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={profile.membership_status === "active" ? "green" : "gray"} className="capitalize">
                      {profile.membership_status === "active" ? "Activo" : "Inactivo"}
                    </Badge>
                    <Badge tone="dark" className="capitalize">Nivel {profile.member_level || "member"}</Badge>
                    <Badge tone="orange">{profile.active_months || calculateMonths(profile.membership_started_at || profile.created_at)} meses activo</Badge>

                    {/* Beta Tester badge */}
                    {isBetaTester && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                        <Shield size={11} /> Beta Tester
                      </span>
                    )}

                    {/* Founder badge */}
                    {isFounder && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                        <Star size={11} /> Fundador #{founderData.founder_number}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {subscription && (
              <div className="mb-6 p-4 rounded-xl border border-stampa-border bg-stampa-bg-soft flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 font-semibold">Estado de membresía</span>
                  <span className="font-bold text-white">
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
                  <div className="flex justify-between mt-3 pt-3 border-t border-stampa-border">
                    <span className="text-gray-500 font-semibold">Monto mensual (Suscripción {subscription.status})</span>
                    <span className="font-bold text-white">${subscription.amount}</span>
                  </div>
                )}
                {subscription.next_payment_at && profile.membership_status === "active" && subscription.status !== "cancelled" && subscription.status !== "canceled" && (
                  <div className="flex justify-between mt-1">
                    <span className="text-gray-500 font-semibold">Próximo cobro</span>
                    <span className="font-bold text-white">{new Date(subscription.next_payment_at).toLocaleDateString("es-AR")}</span>
                  </div>
                )}
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

          {/* Referral Code Section */}
          {referralCode && (
            <Card className="max-w-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users size={16} className="text-violet-400" />
                <h3 className="font-bold text-white text-base">Tu código de referido</h3>
              </div>

              <div className="bg-stampa-bg-soft border border-stampa-border rounded-xl p-4 mb-4">
                <p className="text-2xl font-mono font-bold text-white tracking-widest text-center select-all">
                  {referralCode}
                </p>
              </div>

              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2">Link de invitación</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs text-gray-300 bg-stampa-bg-soft border border-stampa-border rounded-lg px-3 py-2 truncate">
                    {APP_BASE_URL}/registro?ref={referralCode}
                  </code>
                  <button
                    onClick={handleCopy}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                      copied
                        ? "bg-green-500/10 text-green-400 border border-green-500/30"
                        : "bg-violet-500/10 text-violet-300 border border-violet-500/30 hover:bg-violet-500/20"
                    }`}
                  >
                    {copied ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar link</>}
                  </button>
                </div>
              </div>

              <p className="text-xs text-gray-500">
                Cuando alguien se suscriba usando tu código, ganás una participación extra en sorteos.
              </p>

              {(referralStats.pending > 0 || referralStats.converted > 0) && (
                <div className="mt-4 pt-4 border-t border-stampa-border flex gap-4">
                  {referralStats.pending > 0 && (
                    <div className="text-center">
                      <p className="text-xl font-bold text-white">{referralStats.pending}</p>
                      <p className="text-xs text-gray-500">Referidos pendientes</p>
                    </div>
                  )}
                  {referralStats.converted > 0 && (
                    <div className="text-center">
                      <p className="text-xl font-bold text-green-400">{referralStats.converted}</p>
                      <p className="text-xs text-gray-500">Referidos convertidos</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

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
