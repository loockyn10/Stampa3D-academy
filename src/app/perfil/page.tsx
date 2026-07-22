"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrimaryButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";

function PerfilContent() {
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [tab, setTab] = useState<"perfil" | "configuracion">("perfil");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Profile data
  const [profile, setProfile] = useState<any>(null);
  const [badges, setBadges] = useState<any[]>([]);
  const [subscription, setSubscription] = useState<any>(null);

  // Form State
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [companyCity, setCompanyCity] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");

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
      setDisplayName(pData.display_name || pData.full_name || "");
      setCompanyName(pData.company_name || "");
      setCompanyLogoUrl(pData.company_logo_url || "");
      setCompanyCity(pData.company_city || "");
      setCompanyAddress(pData.company_address || "");
      setCompanyPhone(pData.company_phone || "");
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

  const handleSave = async () => {
    if (!profile) return;
    setLoading(true);
    const { error } = await supabase.from("profiles").update({ 
      display_name: displayName,
      company_name: companyName,
      company_logo_url: companyLogoUrl,
      company_city: companyCity,
      company_address: companyAddress,
      company_phone: companyPhone
    }).eq("id", profile.id);
    if (error) alert("Error: " + error.message);
    else alert("Perfil actualizado correctamente.");
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
                {displayName.substring(0, 2) || "US"}
              </div>
              <div className="flex-1">
                <p className="text-base font-bold text-gray-900">{displayName || "Usuario"}</p>
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

            {subscription && (
              <div className="mb-6 p-4 rounded-xl border border-gray-100 bg-gray-50 flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 font-semibold">Estado de membresía</span>
                  <span className="font-bold text-gray-900">
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
                  <div className="flex justify-between mt-3 pt-3 border-t border-gray-200">
                    <span className="text-gray-500 font-semibold">Monto mensual (Suscripción {subscription.status})</span>
                    <span className="font-bold text-gray-900">${subscription.amount}</span>
                  </div>
                )}
                {subscription.next_payment_at && profile.membership_status === "active" && subscription.status !== "cancelled" && subscription.status !== "canceled" && (
                  <div className="flex justify-between mt-1">
                    <span className="text-gray-500 font-semibold">Próximo cobro</span>
                    <span className="font-bold text-gray-900">{new Date(subscription.next_payment_at).toLocaleDateString("es-AR")}</span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Nombre</span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
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

            <div className="border-t border-gray-100 mt-6 pt-6">
              <h4 className="text-sm font-bold text-gray-900 mb-4">Datos de empresa para presupuestos</h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-gray-500">Nombre de empresa</span>
                  <input
                    placeholder="Ej. Stampa3D Academy"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white text-gray-900 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 placeholder-gray-400"
                  />
                </label>
                <div className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-gray-500">Logo de empresa URL</span>
                  <div className="space-y-3">
                    <FileUploadDropzone
                      bucket="company-logos"
                      pathPrefix={profile?.id || "default"}
                      accept=".jpg,.jpeg,.png,.webp,.svg"
                      publicBucket={true}
                      onUploaded={(url) => setCompanyLogoUrl(url)}
                      label="Subir logo"
                    />
                    <div className="flex items-center gap-2">
                      <hr className="flex-1 border-gray-200" />
                      <span className="text-[10px] text-gray-400 font-semibold uppercase">O URL Externa</span>
                      <hr className="flex-1 border-gray-200" />
                    </div>
                    <div className="flex gap-4 items-center">
                      <input
                        placeholder="https://..."
                        value={companyLogoUrl}
                        onChange={(e) => setCompanyLogoUrl(e.target.value)}
                        className="flex-1 rounded-xl border border-gray-300 bg-white text-gray-900 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 placeholder-gray-400"
                      />
                      {companyLogoUrl && (
                        <div className="h-12 w-12 shrink-0 rounded-lg bg-gray-100 overflow-hidden border border-gray-200">
                          <img src={companyLogoUrl} alt="Logo" className="w-full h-full object-cover" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-500">Nombre a mostrar (vendedor)</span>
                  <input
                    placeholder="Tu nombre en el PDF"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white text-gray-900 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 placeholder-gray-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-500">Teléfono (empresa)</span>
                  <input
                    placeholder="Ej. +54 9 11 1234-5678"
                    value={companyPhone}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white text-gray-900 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 placeholder-gray-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-500">Ciudad</span>
                  <input
                    placeholder="Ej. Buenos Aires, Argentina"
                    value={companyCity}
                    onChange={(e) => setCompanyCity(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white text-gray-900 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 placeholder-gray-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-500">Dirección</span>
                  <input
                    placeholder="Ej. Calle Falsa 123"
                    value={companyAddress}
                    onChange={(e) => setCompanyAddress(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white text-gray-900 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 placeholder-gray-400"
                  />
                </label>
              </div>
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
