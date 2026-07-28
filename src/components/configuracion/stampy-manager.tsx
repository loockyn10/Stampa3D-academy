"use client";

import React, { useState, useEffect } from "react";
import { Loader2, Bot, CheckCircle2, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GhostButton, PrimaryButton } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";

export function StampyManager({ setTab }: { setTab: (tab: any) => void }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  
  const [hasPrinters, setHasPrinters] = useState(false);
  const [hasFilaments, setHasFilaments] = useState(false);
  const [hasBusinessData, setHasBusinessData] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [pRes, fRes, profRes] = await Promise.all([
      supabase.from("printers").select("id", { count: 'exact', head: true }).eq("user_id", user.id),
      supabase.from("filaments").select("id", { count: 'exact', head: true }).eq("user_id", user.id),
      supabase.from("profiles").select("company_name, company_city").eq("id", user.id).single()
    ]);

    setHasPrinters((pRes.count || 0) > 0);
    setHasFilaments((fRes.count || 0) > 0);
    
    if (profRes.data) {
      setHasBusinessData(!!(profRes.data.company_name || profRes.data.company_city));
    }
    
    setLoading(false);
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <Card className="max-w-2xl p-6 space-y-6">
      <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
        <div className="p-2 bg-purple-100 text-purple-600 rounded-xl">
          <Bot size={24} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">Configuración de Stampy</h3>
          <p className="text-sm text-gray-500 mt-1">
            Más adelante, Stampy va a poder usar datos de tu taller para darte respuestas más precisas.
          </p>
        </div>
      </div>

      <div className="bg-purple-50/50 border border-purple-100 rounded-xl p-5">
        <p className="text-sm text-purple-900 font-medium mb-4">
          Para que Stampy te ayude mejor, te recomendamos completar estos pasos en tu cuenta:
        </p>

        <div className="space-y-3">
          
          <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-100">
            <div className="flex items-center gap-3">
              {hasPrinters ? <CheckCircle2 className="text-green-500" size={20} /> : <Circle className="text-gray-300" size={20} />}
              <span className={`text-sm ${hasPrinters ? "text-gray-900 font-medium" : "text-gray-500"}`}>Cargar impresoras</span>
            </div>
            {!hasPrinters && (
              <GhostButton onClick={() => setTab("taller")} className="text-xs">
                Ir a Taller
              </GhostButton>
            )}
          </div>

          <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-100">
            <div className="flex items-center gap-3">
              {hasFilaments ? <CheckCircle2 className="text-green-500" size={20} /> : <Circle className="text-gray-300" size={20} />}
              <span className={`text-sm ${hasFilaments ? "text-gray-900 font-medium" : "text-gray-500"}`}>Cargar filamentos</span>
            </div>
            {!hasFilaments && (
              <GhostButton onClick={() => setTab("taller")} className="text-xs">
                Ir a Taller
              </GhostButton>
            )}
          </div>

          <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-100">
            <div className="flex items-center gap-3">
              {hasBusinessData ? <CheckCircle2 className="text-green-500" size={20} /> : <Circle className="text-gray-300" size={20} />}
              <span className={`text-sm ${hasBusinessData ? "text-gray-900 font-medium" : "text-gray-500"}`}>Completar datos del negocio</span>
            </div>
            {!hasBusinessData && (
              <GhostButton onClick={() => setTab("negocio")} className="text-xs">
                Ir a Negocio
              </GhostButton>
            )}
          </div>

        </div>
      </div>
      
      <p className="text-xs text-gray-400 text-center">
        Actualmente Stampy no almacena un historial a largo plazo, pero pronto podrá recordar tu equipamiento.
      </p>
    </Card>
  );
}
