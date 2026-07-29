"use client";

import React, { useState, useEffect, Suspense } from "react";
import { Loader2, AlertCircle, Settings2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import { AccountManager } from "@/components/configuracion/account-manager";

function PerfilContent() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Profile data
  const [profile, setProfile] = useState<any>(null);
  const [badges, setBadges] = useState<any[]>([]);
  const [subscription, setSubscription] = useState<any>(null);

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

    setLoading(false);
  };

  const calculateMonths = (dateStr: string) => {
    if (!dateStr) return 0;
    const start = new Date(dateStr);
    const now = new Date();
    const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    return Math.max(1, months);
  };

  if (loading && !profile) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  const displayName = profile?.display_name || profile?.full_name || profile?.company_name || "Usuario";

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
            <div className="flex items-start justify-between border-b border-white/5 pb-5 mb-5">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-xl font-bold text-orange-600 select-none uppercase">
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
                  </div>
                </div>
              </div>
            </div>

            {subscription && (
              <div className="mb-6 p-4 rounded-xl border border-white/5 bg-[#0a0a0a] flex flex-col gap-1 text-sm">
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
                  <div className="flex justify-between mt-3 pt-3 border-t border-white/10">
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
                    <div className="w-12 h-12 flex items-center justify-center rounded-full bg-[#111] shadow-sm border border-white/5 text-2xl">
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
    <Suspense fallback={<div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>}>
      <PerfilContent />
    </Suspense>
  );
}
