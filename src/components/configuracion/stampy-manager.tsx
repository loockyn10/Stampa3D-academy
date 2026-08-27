"use client";

import React, { useState, useEffect } from "react";
import { Loader2, Bot, CheckCircle2, Circle, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";
import {
  loadStampyActionSettingsAction,
  saveStampyActionSettingsAction,
} from "@/lib/stampy/action-settings-actions";
import {
  DEFAULT_STAMPY_ACTION_SETTINGS,
  type StampyActionSettings,
} from "@/lib/stampy/action-settings";

function SettingToggle({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-lg border border-stampa-border bg-stampa-surface p-3 ${disabled ? "opacity-50" : ""}`}>
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${
          checked ? "bg-stampa-orange" : "bg-white/15"
        }`}
      >
        <span
          className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export function StampyManager({ setTab }: { setTab: (tab: any) => void }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  
  const [hasPrinters, setHasPrinters] = useState(false);
  const [hasFilaments, setHasFilaments] = useState(false);
  const [hasBusinessData, setHasBusinessData] = useState(false);
  const [actionSettings, setActionSettings] = useState<StampyActionSettings>({
    ...DEFAULT_STAMPY_ACTION_SETTINGS,
  });
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [pRes, fRes, profRes, actionSettingsResult] = await Promise.all([
      supabase.from("printers").select("id", { count: 'exact', head: true }).eq("user_id", user.id),
      supabase.from("filaments").select("id", { count: 'exact', head: true }).eq("user_id", user.id),
      supabase.from("profiles").select("company_name, company_city").eq("id", user.id).single(),
      loadStampyActionSettingsAction(),
    ]);

    setHasPrinters((pRes.count || 0) > 0);
    setHasFilaments((fRes.count || 0) > 0);
    
    if (profRes.data) {
      setHasBusinessData(!!(profRes.data.company_name || profRes.data.company_city));
    }
    setActionSettings(actionSettingsResult.settings);
    setSettingsError(actionSettingsResult.error);
    
    setLoading(false);
  };

  const updateActionSettings = async (
    key: keyof StampyActionSettings,
    value: boolean
  ) => {
    const previous = actionSettings;
    const next = { ...actionSettings, [key]: value };
    setActionSettings(next);
    setSavingSettings(true);
    setSettingsError(null);

    const result = await saveStampyActionSettingsAction(next);
    if (result.success) {
      setActionSettings(result.settings);
    } else {
      setActionSettings(previous);
      setSettingsError(result.error ?? "No se pudo guardar la configuración.");
    }
    setSavingSettings(false);
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-stampa-orange" /></div>;

  return (
    <Card className="max-w-2xl p-6 bg-stampa-surface border-stampa-border space-y-6 animate-slide-up">
      <div className="flex items-center gap-4 border-b border-stampa-border pb-5">
        <div className="p-3 bg-stampa-orange/10 text-stampa-orange rounded-xl border border-stampa-orange/20 shadow-inner animate-soft-pulse">
          <Bot size={24} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Configuración de Stampy</h3>
          <p className="text-sm text-gray-500 mt-1">
            Más adelante, Stampy va a poder usar datos de tu taller para darte respuestas más precisas.
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-stampa-border bg-black/20 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-stampa-orange" size={20} />
          <div>
            <h4 className="font-semibold text-white">Automatización de Stampy</h4>
            <p className="mt-1 text-sm text-gray-400">
              Permití que Stampy ejecute algunas acciones simples sin pedir confirmación cuando los datos sean claros y no haya ambigüedad.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <SettingToggle
            label="Activar automatización de bajo riesgo"
            description="Habilitación general. Por defecto está apagada."
            checked={actionSettings.autoExecuteLowRisk}
            disabled={savingSettings}
            onChange={(checked) =>
              updateActionSettings("autoExecuteLowRisk", checked)
            }
          />
          <SettingToggle
            label="Movimientos de filamento"
            description="Sumar o descontar gramos sólo con un filamento identificado de forma única."
            checked={actionSettings.autoExecuteFilamentMovements}
            disabled={!actionSettings.autoExecuteLowRisk || savingSettings}
            onChange={(checked) =>
              updateActionSettings("autoExecuteFilamentMovements", checked)
            }
          />
          <SettingToggle
            label="Crear filamentos"
            description="Crear un filamento nuevo sólo cuando no existe un duplicado activo."
            checked={actionSettings.autoExecuteCreateFilament}
            disabled={!actionSettings.autoExecuteLowRisk || savingSettings}
            onChange={(checked) =>
              updateActionSettings("autoExecuteCreateFilament", checked)
            }
          />
          <SettingToggle
            label="Crear impresoras"
            description="Crear una impresora sólo cuando el nombre es claro y no hay duplicados."
            checked={actionSettings.autoExecuteCreatePrinter}
            disabled={!actionSettings.autoExecuteLowRisk || savingSettings}
            onChange={(checked) =>
              updateActionSettings("autoExecuteCreatePrinter", checked)
            }
          />
        </div>

        {settingsError && (
          <p className="text-xs text-red-400">
            No pudimos cargar o guardar esta configuración. La automatización queda desactivada hasta resolverlo.
          </p>
        )}
        <p className="text-xs text-amber-300/90">
          Stampy nunca ejecutará acciones ambiguas, eliminaciones, presupuestos ni cambios de precios automáticamente.
        </p>
      </div>

      <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-5">
        <p className="text-sm text-indigo-200 font-medium mb-4">
          Para que Stampy te ayude mejor, te recomendamos completar estos pasos en tu cuenta:
        </p>

        <div className="space-y-3">
          
          <div className="flex items-center justify-between p-3 bg-stampa-surface rounded-lg border border-stampa-border">
            <div className="flex items-center gap-3">
              {hasPrinters ? <CheckCircle2 className="text-green-500" size={20} /> : <Circle className="text-gray-600" size={20} />}
              <span className={`text-sm ${hasPrinters ? "text-white font-medium" : "text-gray-500"}`}>Cargar impresoras</span>
            </div>
            {!hasPrinters && (
              <GhostButton onClick={() => setTab("taller")} className="text-xs">
                Ir a Taller
              </GhostButton>
            )}
          </div>

          <div className="flex items-center justify-between p-3 bg-stampa-surface rounded-lg border border-stampa-border">
            <div className="flex items-center gap-3">
              {hasFilaments ? <CheckCircle2 className="text-green-500" size={20} /> : <Circle className="text-gray-600" size={20} />}
              <span className={`text-sm ${hasFilaments ? "text-white font-medium" : "text-gray-500"}`}>Cargar filamentos</span>
            </div>
            {!hasFilaments && (
              <GhostButton onClick={() => setTab("taller")} className="text-xs">
                Ir a Taller
              </GhostButton>
            )}
          </div>

          <div className="flex items-center justify-between p-3 bg-stampa-surface rounded-lg border border-stampa-border">
            <div className="flex items-center gap-3">
              {hasBusinessData ? <CheckCircle2 className="text-green-500" size={20} /> : <Circle className="text-gray-600" size={20} />}
              <span className={`text-sm ${hasBusinessData ? "text-white font-medium" : "text-gray-500"}`}>Completar datos del negocio</span>
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
        Las automatizaciones se validan nuevamente en servidor antes de ejecutar cualquier cambio.
      </p>
    </Card>
  );
}
