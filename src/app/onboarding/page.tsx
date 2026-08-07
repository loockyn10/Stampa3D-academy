"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Loader2, ArrowRight } from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);

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
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, onboarding_completed")
        .eq("id", user.id)
        .single();

      if (profile?.onboarding_completed) {
        router.replace("/");
        return;
      }

      if (profile?.full_name) {
        setFullName(profile.full_name);
      }
      setLoading(false);
    }
    fetchProfile();
  }, [supabase, router]);

  const handleSave = async (isSkip = false) => {
    setSaving(true);
    setErrorMsg(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user found");

      let payload = {};
      if (isSkip) {
        payload = {
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } else {
        payload = {
          full_name: fullName,
          display_name: displayName,
          phone,
          main_printer_brand: brand,
          main_printer_model: brand === "none_yet" ? "" : model,
          experience_level: experience,
          main_goal: goal,
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }

      const { error } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", user.id);

      if (error) throw error;
      
      // Start fallback timer in case navigation hangs
      setTimeout(() => setShowFallback(true), 3000);

      router.replace("/");
      router.refresh();
    } catch (err: any) {
      setErrorMsg("No pudimos guardar tu onboarding. Probá de nuevo.");
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSave(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <Loader2 className="animate-spin text-[#ff6a00] h-8 w-8" />
      </div>
    );
  }

  if (saving) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505]">
        <Loader2 className="animate-spin text-[#ff6a00] h-12 w-12 mb-4" />
        <p className="text-white font-medium">Preparando tu experiencia...</p>
        
        {showFallback && (
          <div className="mt-8 flex flex-col items-center animate-in fade-in">
            <p className="text-gray-400 text-sm mb-3">Si no redirige automáticamente...</p>
            <button
              onClick={() => {
                router.replace("/");
                router.refresh();
              }}
              className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-colors"
            >
              Entrar al inicio
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#ededed] font-sans flex flex-col items-center justify-center p-4 py-12">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-3">
            Configuremos tu experiencia
          </h1>
          <p className="text-gray-400 max-w-lg mx-auto">
            Estos datos nos ayudan a recomendarte cursos y herramientas según tu impresora y tu objetivo.
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm text-center">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8 bg-neutral-950 p-6 md:p-8 rounded-2xl border border-white/10 shadow-2xl">
          
          {/* SECCIÓN 1: Datos básicos */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white border-b border-white/5 pb-2">1. Datos básicos</h2>
            
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
                <label className="block text-sm font-medium text-gray-400 mb-1">Nombre para mostrar (Opcional)</label>
                <input 
                  type="text" 
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-[#ff6a00] transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Teléfono (Opcional)</label>
              <input 
                type="tel" 
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-[#ff6a00] transition-colors"
              />
            </div>
          </div>

          {/* SECCIÓN 2: Impresora principal */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white border-b border-white/5 pb-2">2. Tu impresora principal</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Marca</label>
                <select 
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#ff6a00] transition-colors appearance-none"
                  required
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
                    placeholder="Ej: A1 Mini, K1, Ender 3..."
                    className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-[#ff6a00] transition-colors"
                    required
                  />
                </div>
              )}
            </div>
            {brand === "none_yet" && (
              <p className="text-sm text-gray-400 italic">
                No pasa nada. Te vamos a recomendar una ruta para empezar desde cero.
              </p>
            )}
          </div>

          {/* SECCIÓN 3: Nivel de experiencia */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white border-b border-white/5 pb-2">3. Nivel de experiencia</h2>
            
            <div>
              <select 
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#ff6a00] transition-colors appearance-none"
                required
              >
                <option value="" disabled>¿Cómo te describirías?</option>
                <option value="beginner">Estoy empezando</option>
                <option value="basic">Ya hice algunas impresiones</option>
                <option value="intermediate">Ya imprimo seguido</option>
                <option value="advanced">Ya vendo o quiero optimizar mi taller</option>
              </select>
            </div>
          </div>

          {/* SECCIÓN 4: Objetivo principal */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white border-b border-white/5 pb-2">4. Objetivo principal</h2>
            
            <div>
              <select 
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#ff6a00] transition-colors appearance-none"
                required
              >
                <option value="" disabled>¿Qué buscás lograr?</option>
                <option value="first_print">Hacer mi primera impresión</option>
                <option value="learn_slicer">Aprender a filetear (Slicer)</option>
                <option value="improve_quality">Mejorar calidad de impresión</option>
                <option value="sell_products">Vender productos impresos</option>
                <option value="manage_business">Organizar mi taller y números</option>
                <option value="all">Un poco de todo</option>
              </select>
            </div>
          </div>

          <div className="pt-6 border-t border-white/5 flex flex-col md:flex-row items-center gap-4">
            <button
              type="submit"
              className="w-full md:w-auto flex-1 flex justify-center items-center gap-2 bg-[#ff6a00] hover:bg-[#ff7a1a] text-white font-bold py-3 px-6 rounded-xl transition-colors"
            >
              Guardar y entrar
              <ArrowRight size={18} />
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              className="text-sm font-medium text-gray-500 hover:text-gray-300 transition-colors"
            >
              Saltar por ahora
            </button>
          </div>
          <p className="text-center text-xs text-gray-600 mt-4">
            Podés completar estos datos más adelante desde Configuración.
          </p>
        </form>
      </div>
    </div>
  );
}
