"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Zap, DollarSign, Loader2, AlertCircle, Settings } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  suffix?: string;
  step?: number;
  disabled?: boolean;
}

function NumberField({ label, value, onChange, suffix, step = 1, disabled = false }: NumberFieldProps) {
  return (
    <label className={`block ${disabled ? "opacity-60" : ""}`}>
      <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
      <div className={`flex items-center rounded-xl border border-gray-200 bg-gray-50 px-3 ${!disabled && "focus-within:border-orange-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-orange-100"}`}>
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-transparent py-2.5 text-sm text-gray-900 outline-none"
          disabled={disabled}
        />
        {suffix && <span className="text-xs font-medium text-gray-400">{suffix}</span>}
      </div>
    </label>
  );
}

export default function CalculadoraPage() {
  const supabase = createClient();
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);

  // User Data
  const [filaments, setFilaments] = useState<any[]>([]);
  const [printers, setPrinters] = useState<any[]>([]);
  const [multipliers, setMultipliers] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);

  // Form State
  const [selectedFilamentId, setSelectedFilamentId] = useState("");
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const [selectedMultiplierId, setSelectedMultiplierId] = useState("");

  const [weight, setWeight] = useState(0);
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);

  // Advanced Overrides
  const [manualPricePerKg, setManualPricePerKg] = useState(0);
  const [manualErrorPercent, setManualErrorPercent] = useState(0);
  const [manualKwhPrice, setManualKwhPrice] = useState(0);
  const [manualPrinterConsumption, setManualPrinterConsumption] = useState(0);
  const [manualPrinterMaintenance, setManualPrinterMaintenance] = useState(0);
  const [laborCost, setLaborCost] = useState(0);
  const [otherCost, setOtherCost] = useState(0);
  const [fixedCost, setFixedCost] = useState(0);
  
  const [manualMultiplier, setManualMultiplier] = useState(0);
  const [manualPlatformCommission, setManualPlatformCommission] = useState(0);
  const [manualPlatformExtra, setManualPlatformExtra] = useState(0);
  const [shippingCost, setShippingCost] = useState(0);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const [fRes, pRes, mRes, sRes] = await Promise.all([
      supabase.from("filaments").select("*").eq("user_id", user.id).eq("is_active", true),
      supabase.from("printers").select("*").eq("user_id", user.id).eq("is_active", true),
      supabase.from("calculator_product_types").select("*").eq("user_id", user.id).eq("is_active", true).order("sort_order"),
      supabase.from("calculator_settings").select("*").eq("user_id", user.id).single()
    ]);

    let userSettings = sRes.data;
    if (!userSettings) {
      const payload = {
        user_id: user.id,
        electricity_price_kwh: 120,
        mercado_libre_extra_amount: 0,
        platform_commission_percent: 15,
        default_error_percent: 5,
      };
      const { data: newSet } = await supabase.from("calculator_settings").insert([payload]).select().single();
      userSettings = newSet;
    }

    setFilaments(fRes.data || []);
    setPrinters(pRes.data || []);
    setMultipliers(mRes.data || []);
    setSettings(userSettings);

    // Set defaults
    if (fRes.data && fRes.data.length > 0) setSelectedFilamentId(fRes.data[0].id);
    if (pRes.data && pRes.data.length > 0) setSelectedPrinterId(pRes.data[0].id);
    if (mRes.data && mRes.data.length > 0) setSelectedMultiplierId(mRes.data[0].id);

    setManualErrorPercent(userSettings?.default_error_percent || 0);
    setManualKwhPrice(userSettings?.electricity_price_kwh || 0);
    setManualPlatformCommission(userSettings?.platform_commission_percent || 0);
    setManualPlatformExtra(userSettings?.mercado_libre_extra_amount || 0);

    setLoading(false);
  };

  useEffect(() => {
    // When selected items change, update manual overrides to defaults
    const fil = filaments.find(f => f.id === selectedFilamentId);
    if (fil) setManualPricePerKg(fil.purchase_price / (fil.total_grams / 1000) || 0);

    const pri = printers.find(p => p.id === selectedPrinterId);
    if (pri) {
      setManualPrinterConsumption(pri.power_watts || 0);
      setManualPrinterMaintenance(pri.maintenance_cost_per_hour || 0);
    }

    const mul = multipliers.find(m => m.id === selectedMultiplierId);
    if (mul) {
      setManualMultiplier(mul.multiplier || 1);
      setFixedCost(mul.fixed_cost || 0);
    }

  }, [selectedFilamentId, selectedPrinterId, selectedMultiplierId, filaments, printers, multipliers]);

  const calc = useMemo(() => {
    const errorMultiplier = 1 + (manualErrorPercent / 100);
    const weightWithError = weight * errorMultiplier;
    
    // Costo Material
    const costPerGram = manualPricePerKg / 1000;
    const materialCost = weightWithError * costPerGram;

    // Tiempo total en horas
    const totalHours = hours + (minutes / 60);

    // Costo Eléctrico
    const energyCost = totalHours * (manualPrinterConsumption / 1000) * manualKwhPrice;

    // Costo Mantenimiento/Amortización
    const printerCost = totalHours * manualPrinterMaintenance;

    // Costo Base
    const baseCost = materialCost + energyCost + printerCost + laborCost + otherCost + fixedCost;

    // Precio Normal
    const normalPrice = baseCost * manualMultiplier;

    // Precio Mercado Libre
    const mlPrice = normalPrice + manualPlatformExtra + (normalPrice * manualPlatformCommission / 100) + shippingCost;

    // Ganancia
    const profit = normalPrice - baseCost;

    return {
      materialCost, energyCost, printerCost, fixedCost, baseCost, normalPrice, mlPrice, profit
    };
  }, [
    weight, manualErrorPercent, manualPricePerKg,
    hours, minutes, manualPrinterConsumption, manualKwhPrice, manualPrinterMaintenance,
    laborCost, otherCost, fixedCost, manualMultiplier, manualPlatformExtra, manualPlatformCommission, shippingCost
  ]);

  if (loading) {
    return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;
  }

  const missingData = filaments.length === 0 || printers.length === 0 || multipliers.length === 0;

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Calculadora de costos"
        action={
          <div className="flex items-center gap-2">
            <Link href="/configuracion" className="hidden sm:flex text-xs font-semibold text-gray-500 hover:text-gray-900 border border-gray-200 bg-white px-3 py-1.5 rounded-lg transition-colors gap-1.5 items-center">
              <Settings size={14} /> Configurar Valores
            </Link>
            <GhostButton onClick={() => setAdvanced((a) => !a)}>
              <Zap size={14} className={advanced ? "text-orange-500 fill-orange-500" : ""} />
              {advanced ? "Modo básico" : "Modo avanzado"}
            </GhostButton>
          </div>
        }
      />

      {missingData && (
        <div className="mb-6 bg-orange-50 border border-orange-200 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="text-orange-600 mt-0.5" size={20} />
          <div>
            <h4 className="text-sm font-bold text-orange-900">Faltan datos de configuración</h4>
            <p className="text-xs text-orange-800 mt-1">
              Para usar la calculadora necesitas tener al menos un filamento, una impresora y un multiplicador configurados.
            </p>
            <Link href="/configuracion" className="inline-block mt-3 bg-orange-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-orange-700 transition-colors">
              Ir a Configuración
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2 space-y-6">
          
          {/* SECCIÓN MATERIAL */}
          <div>
            <p className="mb-4 text-sm font-bold text-gray-900 border-b border-gray-100 pb-2">Datos de Material</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Filamento a usar</span>
                <select 
                  value={selectedFilamentId} 
                  onChange={(e) => setSelectedFilamentId(e.target.value)} 
                  className="w-full text-sm rounded-xl border border-gray-200 bg-gray-50 py-2.5 px-3 text-gray-900 outline-none focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-100"
                >
                  {filaments.map(f => <option key={f.id} value={f.id}>{f.name} ({f.color})</option>)}
                </select>
              </label>
              <NumberField label="Gramos de la pieza" value={weight} onChange={setWeight} suffix="g" />
              {advanced && <NumberField label="Margen de error" value={manualErrorPercent} onChange={setManualErrorPercent} suffix="%" />}
            </div>
            {advanced && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <NumberField label="Costo por kg manual" value={manualPricePerKg} onChange={setManualPricePerKg} suffix="$" />
              </div>
            )}
          </div>

          {/* SECCIÓN ELECTRICIDAD Y TIEMPO */}
          <div>
            <p className="mb-4 text-sm font-bold text-gray-900 border-b border-gray-100 pb-2">Tiempo e Impresión</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Impresora</span>
                <select 
                  value={selectedPrinterId} 
                  onChange={(e) => setSelectedPrinterId(e.target.value)} 
                  className="w-full text-sm rounded-xl border border-gray-200 bg-gray-50 py-2.5 px-3 text-gray-900 outline-none focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-100"
                >
                  {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <NumberField label="Horas" value={hours} onChange={setHours} suffix="h" step={1} />
              <NumberField label="Minutos" value={minutes} onChange={setMinutes} suffix="m" step={1} />
            </div>
            {advanced && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <NumberField label="Consumo impresora" value={manualPrinterConsumption} onChange={setManualPrinterConsumption} suffix="W" />
                <NumberField label="Costo kWh" value={manualKwhPrice} onChange={setManualKwhPrice} suffix="$" />
                <NumberField label="Mantenimiento/h" value={manualPrinterMaintenance} onChange={setManualPrinterMaintenance} suffix="$" />
                <NumberField label="Mano de obra (Total)" value={laborCost} onChange={setLaborCost} suffix="$" />
                <NumberField label="Otros Costos (Total)" value={otherCost} onChange={setOtherCost} suffix="$" />
              </div>
            )}
          </div>

          {/* SECCIÓN MARGEN */}
          <div>
            <p className="mb-4 text-sm font-bold text-gray-900 border-b border-gray-100 pb-2">Márgenes y Plataforma</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Tipo de producto</span>
                <select 
                  value={selectedMultiplierId} 
                  onChange={(e) => setSelectedMultiplierId(e.target.value)} 
                  className="w-full text-sm rounded-xl border border-gray-200 bg-gray-50 py-2.5 px-3 text-gray-900 outline-none focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-100"
                >
                  {multipliers.map(m => <option key={m.id} value={m.id}>{m.name} (x{m.multiplier})</option>)}
                </select>
              </label>
              {advanced && (
                <>
                  <NumberField label="Multiplicador manual" value={manualMultiplier} onChange={setManualMultiplier} suffix="x" step={0.1} />
                  <NumberField label="Comisión plataforma" value={manualPlatformCommission} onChange={setManualPlatformCommission} suffix="%" />
                </>
              )}
            </div>
            {advanced && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <NumberField label="Fijo extra plataforma" value={manualPlatformExtra} onChange={setManualPlatformExtra} suffix="$" />
                <NumberField label="Costo Envío" value={shippingCost} onChange={setShippingCost} suffix="$" />
              </div>
            )}
          </div>

        </Card>

        <Card className="h-fit p-5 border-orange-200 shadow-md bg-gradient-to-b from-white to-orange-50/30">
          <p className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-900 border-b border-gray-100 pb-2">
            <DollarSign size={16} className="text-orange-500" /> Resultado Final
          </p>
          <div className="space-y-4">
            
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Costo Material</p>
              <p className="text-sm font-semibold text-gray-900">${calc.materialCost.toFixed(2)}</p>
            </div>
            
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Costo Eléctrico</p>
              <p className="text-sm font-semibold text-gray-900">${calc.energyCost.toFixed(2)}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Costo Mantenimiento</p>
              <p className="text-sm font-semibold text-gray-900">${calc.printerCost.toFixed(2)}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Costo Fijo</p>
              <p className="text-sm font-semibold text-gray-900">${calc.fixedCost.toFixed(2)}</p>
            </div>
            
            {advanced && (laborCost > 0 || otherCost > 0) && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Mano obra y otros</p>
                <p className="text-sm font-semibold text-gray-900">${(laborCost + otherCost).toFixed(2)}</p>
              </div>
            )}

            <div className="my-2 h-px bg-gray-100" />

            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-700">COSTO BASE</p>
              <p className="text-lg font-bold text-gray-900">${calc.baseCost.toFixed(2)}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-emerald-700">PRECIO NORMAL</p>
              <p className="text-xl font-black text-emerald-600">${calc.normalPrice.toFixed(2)}</p>
            </div>

            {advanced && (
              <div className="flex items-center justify-between bg-emerald-50 px-3 py-2 rounded-lg">
                <p className="text-xs font-bold text-emerald-700">Ganancia Estimada</p>
                <p className="text-sm font-bold text-emerald-700">${calc.profit.toFixed(2)}</p>
              </div>
            )}

            <div className="mt-4 rounded-xl bg-orange-100 p-4 border border-orange-200">
              <p className="text-xs font-bold text-orange-900 opacity-80 mb-1">PRECIO MERCADO LIBRE</p>
              <p className="text-2xl font-black text-orange-600">${calc.mlPrice.toFixed(2)}</p>
              {advanced && <p className="text-[10px] text-orange-800 mt-1">Incluye comisiones, extras y envíos.</p>}
            </div>

          </div>
        </Card>
      </div>
    </div>
  );
}
