"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Save, Loader2, AlertCircle } from "lucide-react";
import { FormSkeleton } from "@/components/ui/page-skeletons";
import { Card } from "@/components/ui/card";

export interface CalculatorSettingsValues {
  electricity_price_kwh: number;
  mercado_libre_extra_amount: number;
  platform_commission_percent: number;
  default_error_percent: number;
  /**
   * Contingencias opcionales sobre insumos (D058), 0–100. Ausente si la columna todavía no existe
   * (migración sin aplicar): en ese caso no se envía al guardar.
   */
  supplies_contingency_percent?: number;
}

interface SettingsManagerProps {
  /** Se llama después de guardar con éxito (p. ej. para refrescar la Calculadora sin recargar). */
  onSaved?: (values: CalculatorSettingsValues) => void;
  /** Dentro de un modal: sin título propio ni ancho máximo. */
  embedded?: boolean;
}

/** Validación de rangos antes de guardar (la comisión se aplica sobre el precio final: debe ser < 100 %). */
export function validateCalculatorSettings(values: CalculatorSettingsValues): string | null {
  if (values.platform_commission_percent < 0 || values.platform_commission_percent >= 100) {
    return "La comisión de Mercado Libre tiene que estar entre 0 % y menos de 100 %.";
  }
  if (values.default_error_percent < 0 || values.default_error_percent >= 100) {
    return "El margen de error tiene que estar entre 0 % y menos de 100 %.";
  }
  if (
    values.supplies_contingency_percent !== undefined
    && (!Number.isFinite(values.supplies_contingency_percent) || values.supplies_contingency_percent < 0 || values.supplies_contingency_percent > 100)
  ) {
    return "Las contingencias sobre insumos tienen que estar entre 0 % y 100 %.";
  }
  if (values.electricity_price_kwh < 0 || values.mercado_libre_extra_amount < 0) {
    return "Los montos no pueden ser negativos.";
  }
  return null;
}

export function SettingsManager({ onSaved, embedded = false }: SettingsManagerProps = {}) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settingId, setSettingId] = useState<string | null>(null);
  // La columna de contingencias llega con la migración 20261118120000; sin ella el campo no se muestra ni se guarda.
  const [contingencyAvailable, setContingencyAvailable] = useState(false);

  const [formData, setFormData] = useState({
    electricity_price_kwh: 0,
    mercado_libre_extra_amount: 0,
    platform_commission_percent: 0,
    default_error_percent: 5,
    supplies_contingency_percent: 0,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("calculator_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      setError(error.message);
    } else if (data) {
      setSettingId(data.id);
      setContingencyAvailable("supplies_contingency_percent" in data);
      setFormData({
        electricity_price_kwh: data.electricity_price_kwh || 0,
        mercado_libre_extra_amount: data.mercado_libre_extra_amount || 0,
        platform_commission_percent: data.platform_commission_percent || 0,
        default_error_percent: data.default_error_percent || 0,
        supplies_contingency_percent: Number(data.supplies_contingency_percent) || 0,
      });
    } else {
      // Create defaults
      const payload = {
        user_id: user.id,
        electricity_price_kwh: 120,
        mercado_libre_extra_amount: 0,
        platform_commission_percent: 15,
        default_error_percent: 5,
      };
      const { data: newSetting, error: insertError } = await supabase.from("calculator_settings").insert([payload]).select().single();
      if (!insertError && newSetting) {
        setSettingId(newSetting.id);
        setContingencyAvailable("supplies_contingency_percent" in newSetting);
        setFormData({ ...payload, supplies_contingency_percent: Number(newSetting.supplies_contingency_percent) || 0 });
      }
    }
    setLoading(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload: CalculatorSettingsValues = {
      electricity_price_kwh: parseFloat(String(formData.electricity_price_kwh)) || 0,
      mercado_libre_extra_amount: parseFloat(String(formData.mercado_libre_extra_amount)) || 0,
      platform_commission_percent: parseFloat(String(formData.platform_commission_percent)) || 0,
      default_error_percent: parseFloat(String(formData.default_error_percent)) || 0,
      ...(contingencyAvailable
        ? { supplies_contingency_percent: parseFloat(String(formData.supplies_contingency_percent)) || 0 }
        : {}),
    };

    const validationError = validateCalculatorSettings(payload);
    if (validationError) {
      setError(validationError);
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("calculator_settings").update(payload).eq("id", settingId);
    if (error) setError(error.message);
    else {
      setSuccess("Ajustes guardados correctamente.");
      onSaved?.(payload);
    }

    setSaving(false);
  };

  if (loading) return <FormSkeleton fields={6} />;

  return (
    <div className={`space-y-4 ${embedded ? "" : "max-w-2xl"}`}>
      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-500/20">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}
      
      {success && (
        <div className="bg-green-50 text-green-400 p-4 rounded-lg text-sm border border-green-100">
          {success}
        </div>
      )}

      {!embedded && <h3 className="text-lg font-semibold text-fg mb-4">Ajustes Globales de Calculadora</h3>}

      <Card className={`${embedded ? "p-4" : "p-6"} border-stampa-border shadow-lg shadow-shade/20 space-y-4`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-1">Precio kWh de Electricidad ($)</label>
            <input type="number" step="0.01" name="electricity_price_kwh" value={formData.electricity_price_kwh} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            <p className="text-xs text-gray-500 mt-1">Precio por Kilowatt hora en tu región.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-1">Margen de Error / Merma (%)</label>
            <input type="number" name="default_error_percent" value={formData.default_error_percent} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            <p className="text-xs text-gray-500 mt-1">Porcentaje extra de material para compensar fallos.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-1">Extra Mercado Libre ($ Fijo)</label>
            <input type="number" name="mercado_libre_extra_amount" value={formData.mercado_libre_extra_amount} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            <p className="text-xs text-gray-500 mt-1">Cargo fijo por venta que querés recuperar en el precio de ML.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-1">Comisión ML (%)</label>
            <input type="number" name="platform_commission_percent" value={formData.platform_commission_percent} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            <p className="text-xs text-gray-500 mt-1">Porcentaje que la plataforma retiene sobre el precio final (0 a 99).</p>
          </div>
          {contingencyAvailable && (
            <div>
              <label htmlFor="supplies_contingency_percent" className="block text-sm font-semibold text-gray-300 mb-1">Contingencias sobre insumos (%)</label>
              <input id="supplies_contingency_percent" type="number" min="0" max="100" step="any" name="supplies_contingency_percent" value={formData.supplies_contingency_percent} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
              <p className="text-xs text-gray-500 mt-1">Opcional (0 % por defecto). Se suma solo sobre insumos extra, componentes y embalaje para cubrir roturas o faltantes. Ej.: 5.</p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-stampa-border flex flex-col sm:flex-row sm:justify-end">
          <button onClick={handleSave} disabled={saving} className="w-full sm:w-auto flex justify-center items-center gap-1.5 px-4 py-2 text-sm font-bold bg-stampa-orange/100 hover:bg-stampa-orange text-white rounded-md transition-colors disabled:opacity-50">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Guardar Ajustes
          </button>
        </div>
      </Card>
    </div>
  );
}
