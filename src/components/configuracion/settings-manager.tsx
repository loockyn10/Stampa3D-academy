"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Save, Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

export function SettingsManager() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settingId, setSettingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    electricity_price_kwh: 0,
    mercado_libre_extra_amount: 0,
    platform_commission_percent: 0,
    default_error_percent: 5,
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
      setFormData({
        electricity_price_kwh: data.electricity_price_kwh || 0,
        mercado_libre_extra_amount: data.mercado_libre_extra_amount || 0,
        platform_commission_percent: data.platform_commission_percent || 0,
        default_error_percent: data.default_error_percent || 0,
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
        setFormData(payload as any);
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

    const payload = {
      electricity_price_kwh: parseFloat(String(formData.electricity_price_kwh)) || 0,
      mercado_libre_extra_amount: parseFloat(String(formData.mercado_libre_extra_amount)) || 0,
      platform_commission_percent: parseFloat(String(formData.platform_commission_percent)) || 0,
      default_error_percent: parseFloat(String(formData.default_error_percent)) || 0,
    };

    const { error } = await supabase.from("calculator_settings").update(payload).eq("id", settingId);
    if (error) setError(error.message);
    else setSuccess("Ajustes guardados correctamente.");
    
    setSaving(false);
  };

  if (loading) return <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-orange-500" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}
      
      {success && (
        <div className="bg-green-50 text-green-700 p-4 rounded-lg text-sm border border-green-100">
          {success}
        </div>
      )}

      <h3 className="text-lg font-semibold text-gray-900 mb-4">Ajustes Globales de Calculadora</h3>

      <Card className="p-6 border-gray-200 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Precio kWh de Electricidad ($)</label>
            <input type="number" step="0.01" name="electricity_price_kwh" value={formData.electricity_price_kwh} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900" />
            <p className="text-xs text-gray-500 mt-1">Precio por Kilowatt hora en tu región.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Margen de Error / Merma (%)</label>
            <input type="number" name="default_error_percent" value={formData.default_error_percent} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900" />
            <p className="text-xs text-gray-500 mt-1">Porcentaje extra de material para compensar fallos.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Extra Mercado Libre ($ Fijo)</label>
            <input type="number" name="mercado_libre_extra_amount" value={formData.mercado_libre_extra_amount} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900" />
            <p className="text-xs text-gray-500 mt-1">Monto fijo extra que se suma al precio en ML.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Comisión ML (%)</label>
            <input type="number" name="platform_commission_percent" value={formData.platform_commission_percent} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900" />
            <p className="text-xs text-gray-500 mt-1">Porcentaje de retención de la plataforma.</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end pt-4 border-t border-gray-100">
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-colors disabled:opacity-50">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Guardar Ajustes
          </button>
        </div>
      </Card>
    </div>
  );
}
