"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrimaryButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";

function PerfilContent() {
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [tab, setTab] = useState<"perfil" | "configuracion">("perfil");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Profile data
  const [profile, setProfile] = useState<any>(null);
  const [badges, setBadges] = useState<any[]>([]);

  // Form State
  const [name, setName] = useState("");

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "configuracion") {
      setTab("configuracion");
    } else {
      setTab("perfil");
    }
  }, [searchParams]);

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
      setName(pData.name || "");
    }

    // Fetch badges
    const { data: bData } = await supabase.from("user_badges").select("*, badges(*)").eq("user_id", user.id).order("awarded_at", { ascending: false });
    if (bData) {
      setBadges(bData.map(ub => ub.badges).filter(b => b && b.is_active));
    }

    setLoading(false);
  };

  const handleSave = async () => {
    if (!profile) return;
    setLoading(true);
    const { error } = await supabase.from("profiles").update({ name }).eq("id", profile.id);
    if (error) alert("Error: " + error.message);
    else alert("Perfil actualizado.");
    setLoading(false);
  };

  const calculateMonths = (dateStr: string) => {
    if (!dateStr) return 0;
    const start = new Date(dateStr);
    const now = new Date();
    const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    return Math.max(1, months); // At least 1 month if newly created
  };

  const configRows = [
    "Notificaciones por email",
    "Notificaciones de sorteos",
    "Modo oscuro (próximamente)",
    "Recordatorios de cursos",
  ];

  if (loading && !profile) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <div>
      <SectionTitle eyebrow="Usuario" title={tab === "perfil" ? "Mi perfil" : "Configuración"} />

      {/* Tabs selectors */}
      <div className="mb-5 inline-flex rounded-xl bg-gray-100 p-1">
        <button
          onClick={() => setTab("perfil")}
          className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
            tab === "perfil" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Detalles de Perfil
        </button>
        <button
          onClick={() => setTab("configuracion")}
          className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
            tab === "configuracion" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Configuración de cuenta
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600 max-w-xl">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {tab === "perfil" && profile ? (
        <div className="space-y-6">
          <Card className="max-w-xl p-6">
            <div className="flex items-center gap-4 border-b border-gray-100 pb-5 mb-5">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-xl font-bold text-orange-600 select-none uppercase">
                {name.substring(0, 2) || "US"}
              </div>
              <div className="flex-1">
                <p className="text-base font-bold text-gray-900">{name || "Usuario"}</p>
                <p className="text-sm text-gray-400 mb-1.5">{profile.email}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="dark" className="capitalize">Nivel {profile.member_level || "member"}</Badge>
                  <Badge tone="orange">{calculateMonths(profile.created_at)} meses activo</Badge>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Nombre</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white text-gray-900 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 placeholder-gray-500"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Email</span>
                <input
                  disabled
                  value={profile.email || ""}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 text-gray-500 px-3 py-2.5 text-sm cursor-not-allowed"
                />
              </label>
            </div>
            <PrimaryButton className="mt-5" onClick={handleSave} disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null} Guardar cambios
            </PrimaryButton>
          </Card>

          {/* BADGES SECTION */}
          <div className="max-w-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-3">Tus Insignias</h3>
            {badges.length === 0 ? (
              <Card className="p-6 text-center border-dashed border-gray-300">
                <p className="text-sm text-gray-500">Aún no has ganado insignias. ¡Participa en la comunidad para conseguir la primera!</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {badges.map(b => (
                  <Card key={b.id} className="p-4 flex items-center gap-3 border-orange-200 bg-orange-50/30">
                    <div className="w-12 h-12 flex items-center justify-center rounded-full bg-white shadow-sm border border-gray-100 text-2xl">
                      {b.icon}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{b.name}</p>
                      <p className="text-[11px] text-gray-600 leading-tight mt-0.5">{b.description}</p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : tab === "configuracion" ? (
        <Card className="max-w-xl divide-y divide-gray-100 p-2">
          {configRows.map((r) => (
            <div key={r} className="flex items-center justify-between px-4 py-3.5">
              <span className="text-sm text-gray-700">{r}</span>
              <button className="h-5 w-9 rounded-full bg-gray-200 p-0.5 relative cursor-pointer focus:outline-none">
                <div className="h-4 w-4 rounded-full bg-white shadow transition-all duration-150" />
              </button>
            </div>
          ))}
        </Card>
      ) : null}
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
