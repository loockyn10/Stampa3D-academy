"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { PrimaryButton } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";

export function AccountManager() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states
  const [fullName, setFullName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [experience, setExperience] = useState("");
  const [goal, setGoal] = useState("");

  useEffect(() => {
    async function fetchProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, display_name, phone, main_printer_brand, main_printer_model, experience_level, main_goal")
        .eq("id", user.id)
        .single();

      if (profile) {
        setFullName(profile.full_name || "");
        setDisplayName(profile.display_name || "");
        setPhone(profile.phone || "");
        setBrand(profile.main_printer_brand || "");
        setModel(profile.main_printer_model || "");
        setExperience(profile.experience_level || "");
        setGoal(profile.main_goal || "");
      }
      setLoading(false);
    }
    fetchProfile();
  }, [supabase]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user found");

      const payload = {
        full_name: fullName,
        display_name: displayName,
        phone,
        main_printer_brand: brand,
        main_printer_model: brand === "none_yet" ? "" : model,
        experience_level: experience,
        main_goal: goal,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", user.id);

      if (error) throw error;
      
      setSuccessMsg("Preferencias actualizadas con éxito.");
    } catch (err: any) {
      setErrorMsg("No pudimos actualizar tus datos. Probá de nuevo.");
    } finally {
      setSaving(false);
      setTimeout(() => setSuccessMsg(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="animate-spin text-[#ff6a00] h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="p-4 bg-white/5 border border-white/10 rounded-xl mb-6">
        <p className="text-sm text-gray-400">
          <strong className="text-white">Preferencias Iniciales.</strong> Estos datos los cargaste al ingresar por primera vez. Nos sirven para recomendarte contenido, pero podés actualizarlos cuando quieras.
        </p>
      </div>

      <form onSubmit={handleSave} className="bg-neutral-950 border border-white/10 rounded-2xl p-6 md:p-8 space-y-8">
        
        {errorMsg && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-4 bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl text-sm">
            {successMsg}
          </div>
        )}

        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white border-b border-white/5 pb-2">Datos personales</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Nombre completo</label>
              <input 
                type="text" 
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-[#ff6a00] transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Nombre para mostrar</label>
              <input 
                type="text" 
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-[#ff6a00] transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Teléfono</label>
            <input 
              type="tel" 
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-[#ff6a00] transition-colors"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white border-b border-white/5 pb-2">Tu impresora principal</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Marca</label>
              <select 
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#ff6a00] transition-colors appearance-none"
              >
                <option value="" disabled>Seleccioná una marca...</option>
                <option value="bambu_lab">Bambu Lab</option>
                <option value="creality">Creality</option>
                <option value="flashforge">Flashforge</option>
                <option value="elegoo">Elegoo</option>
                <option value="prusa">Prusa</option>
                <option value="anycubic">Anycubic</option>
                <option value="other">Otra</option>
                <option value="none_yet">Todavía no tengo impresora</option>
              </select>
            </div>
            
            {brand !== "none_yet" && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Modelo</label>
                <input 
                  type="text" 
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Ej: A1 Mini, K1..."
                  className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-[#ff6a00] transition-colors"
                />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white border-b border-white/5 pb-2">Experiencia y Objetivos</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Nivel de experiencia</label>
              <select 
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#ff6a00] transition-colors appearance-none"
              >
                <option value="" disabled>Seleccioná tu nivel...</option>
                <option value="beginner">Estoy empezando</option>
                <option value="basic">Ya hice algunas impresiones</option>
                <option value="intermediate">Ya imprimo seguido</option>
                <option value="advanced">Ya vendo o quiero optimizar mi taller</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Objetivo principal</label>
              <select 
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#ff6a00] transition-colors appearance-none"
              >
                <option value="" disabled>Seleccioná un objetivo...</option>
                <option value="first_print">Hacer mi primera impresión</option>
                <option value="learn_slicer">Aprender a filetear (Slicer)</option>
                <option value="improve_quality">Mejorar calidad de impresión</option>
                <option value="sell_products">Vender productos impresos</option>
                <option value="manage_business">Organizar mi taller y números</option>
                <option value="all">Un poco de todo</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-white/5">
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save size={16} className="mr-2" />}
            {saving ? "Guardando..." : "Guardar cambios"}
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}
