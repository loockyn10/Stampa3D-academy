"use client";

import React, { useState, useEffect } from "react";
import { Loader2, AlertCircle, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";

export function BusinessManager() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [profileId, setProfileId] = useState<string>("");
  const [companyName, setCompanyName] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [companyCity, setCompanyCity] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: pData, error: pError } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if (pError) {
      setError(pError.message);
    } else if (pData) {
      setProfileId(pData.id);
      setCompanyName(pData.company_name || "");
      setCompanyLogoUrl(pData.company_logo_url || "");
      setCompanyCity(pData.company_city || "");
      setCompanyAddress(pData.company_address || "");
      setCompanyPhone(pData.company_phone || "");
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!profileId) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("profiles").update({ 
      company_name: companyName,
      company_logo_url: companyLogoUrl,
      company_city: companyCity,
      company_address: companyAddress,
      company_phone: companyPhone
    }).eq("id", profileId);
    
    if (error) {
      setError(error.message);
    } else {
      alert("Datos del negocio actualizados correctamente.");
    }
    setSaving(false);
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <Card className="max-w-2xl p-6 space-y-6">
      <div className="flex items-center gap-3 border-b border-white/5 pb-4">
        <div className="p-2 bg-orange-100 text-orange-600 rounded-xl">
          <Building2 size={24} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Datos de tu Negocio</h3>
          <p className="text-sm text-gray-500 mt-1">
            Estos datos pueden aparecer en tus presupuestos y ayudarte a presentar mejor tu taller.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Nombre de empresa / Taller</span>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full rounded-xl border border-white/20 bg-[#111] text-white px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            placeholder="Ej. Stampa3D Academy"
          />
        </label>
        
        <div className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Logo de empresa</span>
          <div className="space-y-3">
            <FileUploadDropzone
              bucket="company-logos"
              pathPrefix={profileId || "default"}
              accept=".jpg,.jpeg,.png,.webp,.svg"
              publicBucket={true}
              onUploaded={(url) => setCompanyLogoUrl(url)}
              label="Subir logo desde tu PC"
            />
            <div className="flex items-center gap-2">
              <hr className="flex-1 border-white/10" />
              <span className="text-[10px] text-gray-400 font-semibold uppercase">O URL Externa</span>
              <hr className="flex-1 border-white/10" />
            </div>
            <div className="flex gap-4 items-center">
              <input
                placeholder="https://..."
                value={companyLogoUrl}
                onChange={(e) => setCompanyLogoUrl(e.target.value)}
                className="flex-1 rounded-xl border border-white/20 bg-[#111] text-white px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
              {companyLogoUrl && (
                <div className="h-12 w-12 shrink-0 rounded-lg bg-white/5 overflow-hidden border border-white/10">
                  <img src={companyLogoUrl} alt="Logo" className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Teléfono (empresa)</span>
          <input
            value={companyPhone}
            onChange={(e) => setCompanyPhone(e.target.value)}
            className="w-full rounded-xl border border-white/20 bg-[#111] text-white px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            placeholder="Ej. +54 9 11 1234-5678"
          />
        </label>
        
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Ciudad</span>
          <input
            value={companyCity}
            onChange={(e) => setCompanyCity(e.target.value)}
            className="w-full rounded-xl border border-white/20 bg-[#111] text-white px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            placeholder="Ej. Buenos Aires"
          />
        </label>
        
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Dirección</span>
          <input
            value={companyAddress}
            onChange={(e) => setCompanyAddress(e.target.value)}
            className="w-full rounded-xl border border-white/20 bg-[#111] text-white px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            placeholder="Ej. Calle Falsa 123"
          />
        </label>
      </div>

      <div className="border-t border-white/5 pt-5">
        <PrimaryButton onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : null} Guardar cambios
        </PrimaryButton>
      </div>
    </Card>
  );
}
