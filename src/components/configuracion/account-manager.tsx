"use client";

import React, { useState, useEffect } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/utils/supabase/client";

export function AccountManager() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [profileId, setProfileId] = useState<string>("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [membershipStatus, setMembershipStatus] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    setEmail(user.email || "");

    const { data: pData, error: pError } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if (pError) {
      setError(pError.message);
    } else if (pData) {
      setProfileId(pData.id);
      setFullName(pData.full_name || "");
      setDisplayName(pData.display_name || "");
      setPhone(pData.phone || "");
      setMembershipStatus(pData.membership_status || "");
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!profileId) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("profiles").update({ 
      full_name: fullName,
      display_name: displayName,
      phone: phone
    }).eq("id", profileId);
    
    if (error) {
      setError(error.message);
    } else {
      alert("Datos de cuenta actualizados correctamente.");
    }
    setSaving(false);
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <Card className="max-w-2xl p-6 space-y-6">
      <div>
        <h3 className="text-lg font-bold text-gray-900">Datos Personales</h3>
        <p className="text-sm text-gray-500 mt-1">
          Estos datos identifican tu cuenta dentro de Academia Stampa.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Nombre completo</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white text-gray-900 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            placeholder="Juan Pérez"
          />
        </label>
        
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Nombre visible (Apodo)</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white text-gray-900 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            placeholder="Juancito"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Teléfono personal</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white text-gray-900 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            placeholder="+54 9 11 ..."
          />
        </label>
        
        <label className="block sm:col-span-2 mt-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Email</span>
          <input
            disabled
            value={email}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 text-gray-500 px-3 py-2.5 text-sm cursor-not-allowed"
          />
        </label>
      </div>
      
      <div className="flex items-center gap-3 pt-2">
        <span className="text-xs font-semibold text-gray-500">Estado de la cuenta:</span>
        <Badge tone={membershipStatus === "active" ? "green" : "gray"} className="capitalize">
          {membershipStatus === "active" ? "Membresía Activa" : "Inactivo"}
        </Badge>
      </div>

      <div className="border-t border-gray-100 pt-5">
        <PrimaryButton onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : null} Guardar cambios
        </PrimaryButton>
      </div>
    </Card>
  );
}
