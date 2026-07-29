"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Zap, DollarSign, Loader2, AlertCircle, Settings, Save, X, PackagePlus, CheckCircle2, Calculator, Info, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";

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
      <div className={`flex items-center rounded-xl border border-white/10 bg-[#111] px-3 ${!disabled && "focus-within:border-[#ff6a00] focus-within:bg-[#1a1a1a] focus-within:ring-2 focus-within:ring-[#ff6a00]/20"}`}>
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-transparent py-2.5 text-sm text-white outline-none"
          disabled={disabled}
        />
        {suffix && <span className="text-xs font-medium text-gray-500">{suffix}</span>}
      </div>
    </label>
  );
}

export default function CalculadoraPage() {
  const supabase = createClient();
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

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

  // Save as product modal
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [productForm, setProductForm] = useState({
    name: "",
    description: "",
    stock_quantity: 0,
    image_url: "",
  });

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
    setUserId(user.id);

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
    if (fil) {
      const totalGrams = fil.total_grams || 0;
      if (totalGrams > 0) {
        setManualPricePerKg((fil.purchase_price / totalGrams) * 1000);
      }
    }

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
      materialCost, energyCost, printerCost, fixedCost, baseCost, normalPrice, mlPrice, profit,
      weightWithError, totalHours
    };
  }, [
    weight, manualErrorPercent, manualPricePerKg,
    hours, minutes, manualPrinterConsumption, manualKwhPrice, manualPrinterMaintenance,
    laborCost, otherCost, fixedCost, manualMultiplier, manualPlatformExtra, manualPlatformCommission, shippingCost
  ]);

  const handleSaveAsProduct = async () => {
    if (!productForm.name.trim()) {
      setSaveError("El nombre del producto es obligatorio.");
      return;
    }
    if (!userId) {
      setSaveError("Debes estar logueado para guardar productos.");
      return;
    }

    setSavingProduct(true);
    setSaveError(null);

    const selectedFilament = filaments.find(f => f.id === selectedFilamentId);
    const selectedPrinter = printers.find(p => p.id === selectedPrinterId);
    const selectedMultiplier = multipliers.find(m => m.id === selectedMultiplierId);

    const snapshot = {
      source: "calculator",
      mode: advanced ? "advanced" : "basic",
      grams: weight,
      grams_with_error: calc.weightWithError,
      error_percent: manualErrorPercent,
      print_time_minutes: (hours * 60) + minutes,
      material_cost: calc.materialCost,
      electricity_cost: calc.energyCost,
      maintenance_cost: calc.printerCost,
      fixed_cost: calc.fixedCost,
      labor_cost: laborCost,
      other_costs: otherCost,
      base_cost: calc.baseCost,
      multiplier: manualMultiplier,
      sale_price: calc.normalPrice,
      profit: calc.profit,
      // Filament details
      filament_id: selectedFilamentId || null,
      filament_name: selectedFilament?.name || null,
      filament_purchase_price: selectedFilament?.purchase_price || null,
      filament_total_grams: selectedFilament?.total_grams || null,
      filament_cost_per_gram: selectedFilament && selectedFilament.total_grams > 0 ? (selectedFilament.purchase_price / selectedFilament.total_grams) : null,
      // Printer details
      printer_id: selectedPrinterId || null,
      printer_name: selectedPrinter?.name || null,
      printer_power_watts: selectedPrinter?.power_watts || null,
      printer_maintenance_cost_per_hour: selectedPrinter?.maintenance_cost_per_hour || null,
      // Product Type details
      product_type_id: selectedMultiplierId || null,
      product_type_name: selectedMultiplier?.name || null,
      product_type_multiplier: selectedMultiplier?.multiplier || null,
      product_type_fixed_cost: selectedMultiplier?.fixed_cost || null,
    };

    const payload = {
      user_id: userId,
      name: productForm.name.trim(),
      description: productForm.description || null,
      image_url: productForm.image_url || null,
      filament_id: selectedFilamentId || null,
      product_type_id: selectedMultiplierId || null,
      printer_id: selectedPrinterId || null,
      grams: weight,
      print_time_minutes: (hours * 60) + minutes,
      base_cost: calc.baseCost,
      sale_price: calc.normalPrice,
      stock_quantity: productForm.stock_quantity || 0,
      calculation_snapshot: snapshot,
      cost_updated_at: new Date().toISOString(),
      is_active: true,
    };

    const { error } = await supabase.from("products").insert([payload]);
    if (error) {
      console.error("Error guardando producto:", error);
      setSaveError(error.message);
    } else {
      setSaveSuccess(true);
    }
    setSavingProduct(false);
  };

  const openSaveModal = () => {
    setProductForm({ name: "", description: "", stock_quantity: 0, image_url: "" });
    setSaveError(null);
    setSaveSuccess(false);
    setShowSaveModal(true);
  };

  if (loading) {
    return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-[#ff6a00]" /></div>;
  }

  const missingData = filaments.length === 0 || printers.length === 0 || multipliers.length === 0;
  const hasValidCalc = calc.baseCost > 0 && calc.normalPrice > 0;

  return <div className="space-y-8 pb-10">
      {/* 1. Header Premium */}
      <div className="relative overflow-hidden rounded-3xl bg-[#111] border border-white/10 p-8 sm:p-10 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-[#ff6a00]/10 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="rounded-full bg-[#ff6a00]/10 text-[#ff6a00] text-xs font-bold px-3 py-1 uppercase tracking-wider border border-[#ff6a00]/20">
              Herramienta de taller
            </span>
          </div>
          <h1 className="text-3xl font-bold text-white sm:text-4xl flex items-center gap-3">
            <Calculator size={32} className="text-[#ff6a00]" /> Calculadora de precios
          </h1>
          <p className="mt-3 text-base text-gray-400">
            Calculá cuánto cobrar una impresión usando material, tiempo, margen y costos extra.
          </p>
          <div className="mt-8">
            <Link href="/configuracion?tab=calculadora" className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-white/5 border border-white/10 text-white rounded-xl hover:bg-white/10 transition-colors">
              <Settings size={18} /> Configurar valores
            </Link>
          </div>
        </div>
      </div>

      {missingData && (
        <div className="space-y-3">
          {printers.length === 0 && (
            <div className="bg-[#ff6a00]/10 border border-[#ff6a00]/20 p-4 rounded-xl flex items-start gap-3">
              <AlertCircle className="text-[#ff6a00] mt-0.5" size={20} />
              <div>
                <h4 className="text-sm font-bold text-[#ff6a00]">No tenés impresoras cargadas</h4>
                <p className="text-xs text-[#ff6a00]/80 mt-1">
                  Importá una impresora del catálogo Stampa o cargá una manualmente.
                </p>
                <div className="flex gap-2 mt-3">
                  <Link href="/configuracion?tab=taller" className="inline-block bg-[#ff6a00] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#ff7a1a] transition-colors shadow-sm shadow-[#ff6a00]/20">
                    Importar impresora
                  </Link>
                  <Link href="/configuracion?tab=taller" className="inline-block bg-[#111] text-[#ff6a00] border border-[#ff6a00]/30 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#ff6a00]/10 transition-colors">
                    Agregar manualmente
                  </Link>
                </div>
              </div>
            </div>
          )}
          {(filaments.length === 0 || multipliers.length === 0) && (
            <div className="bg-[#ff6a00]/10 border border-[#ff6a00]/20 p-4 rounded-xl flex items-start gap-3">
              <AlertCircle className="text-[#ff6a00] mt-0.5" size={20} />
              <div>
                <h4 className="text-sm font-bold text-[#ff6a00]">Faltan datos de configuración</h4>
                <p className="text-xs text-[#ff6a00]/80 mt-1">
                  Para usar la calculadora necesitas tener al menos un filamento y un tipo de producto configurados.
                </p>
                <Link href="/configuracion?tab=taller" className="inline-block mt-3 bg-[#ff6a00] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#ff7a1a] transition-colors shadow-sm shadow-[#ff6a00]/20">
                  Ir a Configuración
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Selector de Modo */}
      <div className="flex p-1 bg-[#111] border border-white/10 rounded-xl w-full sm:w-fit mx-auto sm:mx-0">
        <button
          onClick={() => setAdvanced(false)}
          className={`flex-1 sm:w-64 px-4 py-2.5 rounded-lg text-sm font-bold transition-all flex flex-col items-center justify-center gap-0.5 ${!advanced ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <span>Modo Básico</span>
          <span className={`text-[10px] font-normal ${!advanced ? 'text-gray-300' : 'text-gray-600'}`}>Para estimaciones rápidas</span>
        </button>
        <button
          onClick={() => setAdvanced(true)}
          className={`flex-1 sm:w-64 px-4 py-2.5 rounded-lg text-sm font-bold transition-all flex flex-col items-center justify-center gap-0.5 ${advanced ? 'bg-indigo-500/20 text-indigo-400 shadow-sm border border-indigo-500/20' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <span>Modo Avanzado</span>
          <span className={`text-[10px] font-normal ${advanced ? 'text-indigo-400/80' : 'text-gray-600'}`}>Para precios más reales</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Columna Formularios */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Bloque Básico */}
          <Card className="p-6 sm:p-8 bg-[#111] border-white/10 shadow-lg">
            <div className="mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">Datos principales</h2>
              <p className="text-sm text-gray-400 mt-1">Estos datos alcanzan para una estimación rápida.</p>
            </div>
            
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-500">Filamento a usar</span>
                  <select 
                    value={selectedFilamentId} 
                    onChange={(e) => setSelectedFilamentId(e.target.value)} 
                    className="w-full text-sm rounded-xl border border-white/10 bg-[#0a0a0a] py-2.5 px-3 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                  >
                    {filaments.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.name}{f.color ? ` (${f.color})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <NumberField label="Gramos de la pieza" value={weight} onChange={setWeight} suffix="g" />
                  <p className="text-[10px] text-gray-500 mt-1 ml-1 flex items-center gap-1"><Info size={10} /> Extraelo del slicer</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label className="block sm:col-span-1">
                  <span className="mb-1 block text-xs font-semibold text-gray-500">Impresora</span>
                  <select 
                    value={selectedPrinterId} 
                    onChange={(e) => setSelectedPrinterId(e.target.value)} 
                    className="w-full text-sm rounded-xl border border-white/10 bg-[#0a0a0a] py-2.5 px-3 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                  >
                    {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <div className="sm:col-span-2 grid grid-cols-2 gap-4">
                  <NumberField label="Horas" value={hours} onChange={setHours} suffix="h" step={1} />
                  <NumberField label="Minutos" value={minutes} onChange={setMinutes} suffix="m" step={1} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-500">Tipo de producto (Margen)</span>
                  <select 
                    value={selectedMultiplierId} 
                    onChange={(e) => setSelectedMultiplierId(e.target.value)} 
                    className="w-full text-sm rounded-xl border border-white/10 bg-[#0a0a0a] py-2.5 px-3 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                  >
                    {multipliers.map(m => <option key={m.id} value={m.id}>{m.name} (x{m.multiplier})</option>)}
                  </select>
                </label>
              </div>
            </div>
          </Card>

          {/* Bloque Avanzado */}
          {advanced && (
            <Card className="p-6 sm:p-8 bg-[#111] border-indigo-500/30 shadow-lg relative overflow-hidden animate-in fade-in-50 duration-300">
              <div className="absolute top-0 right-0 bg-indigo-500/20 text-indigo-400 text-[10px] font-bold px-3 py-1 rounded-bl-xl border-b border-l border-indigo-500/30">
                MODO AVANZADO
              </div>
              <div className="mb-6 pr-24">
                <h2 className="text-lg font-bold text-white">Costos Avanzados</h2>
                <p className="text-sm text-gray-400 mt-1">Sumá costos extra para calcular un precio más real.</p>
              </div>
              
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                {/* Grupo 1 */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2 border-b border-indigo-500/20 pb-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span> Material y Taller
                  </h3>
                  <div className="space-y-3">
                    <NumberField label="Margen de error (desperdicio)" value={manualErrorPercent} onChange={setManualErrorPercent} suffix="%" />
                    <NumberField label="Costo por kg manual (sobreescribe)" value={manualPricePerKg} onChange={setManualPricePerKg} suffix="$" />
                    <NumberField label="Consumo de impresora" value={manualPrinterConsumption} onChange={setManualPrinterConsumption} suffix="W" />
                    <NumberField label="Costo del kWh eléctrico" value={manualKwhPrice} onChange={setManualKwhPrice} suffix="$" />
                  </div>
                </div>

                {/* Grupo 2 */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2 border-b border-indigo-500/20 pb-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span> Costos Extras y Márgenes
                  </h3>
                  <div className="space-y-3">
                    <NumberField label="Mantenimiento de máquina por hora" value={manualPrinterMaintenance} onChange={setManualPrinterMaintenance} suffix="$" />
                    <NumberField label="Costo de mano de obra (total)" value={laborCost} onChange={setLaborCost} suffix="$" />
                    <NumberField label="Otros costos adicionales" value={otherCost} onChange={setOtherCost} suffix="$" />
                    <NumberField label="Multiplicador manual (sobreescribe)" value={manualMultiplier} onChange={setManualMultiplier} suffix="x" step={0.1} />
                  </div>
                </div>
              </div>

              {/* Grupo 3 */}
              <div className="mt-8 pt-6 border-t border-white/5">
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2 mb-4">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span> Plataforma de Venta (ML, etc.)
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <NumberField label="Comisión plataforma" value={manualPlatformCommission} onChange={setManualPlatformCommission} suffix="%" />
                  <NumberField label="Fijo extra plataforma" value={manualPlatformExtra} onChange={setManualPlatformExtra} suffix="$" />
                  <NumberField label="Costo Envío" value={shippingCost} onChange={setShippingCost} suffix="$" />
                </div>
              </div>
            </Card>
          )}

        </div>

        {/* Columna Resultado (Sticky) */}
        <div className="lg:col-span-1 lg:sticky lg:top-6 space-y-4">
          <Card className="p-6 bg-[#0a0a0a] border-[#ff6a00]/30 shadow-xl overflow-hidden relative">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#ff6a00] to-transparent opacity-50" />
            
            <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3 mb-4">
              <DollarSign size={18} className="text-[#ff6a00]" /> Resumen del cálculo
            </h3>
            
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Material</p>
                <p className="text-sm font-medium text-gray-300">${calc.materialCost.toFixed(2)}</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Electricidad</p>
                <p className="text-sm font-medium text-gray-300">${calc.energyCost.toFixed(2)}</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Mantenimiento</p>
                <p className="text-sm font-medium text-gray-300">${calc.printerCost.toFixed(2)}</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Costo Fijo</p>
                <p className="text-sm font-medium text-gray-300">${calc.fixedCost.toFixed(2)}</p>
              </div>
              {advanced && (laborCost > 0 || otherCost > 0) && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">Mano obra y otros</p>
                  <p className="text-sm font-medium text-gray-300">${(laborCost + otherCost).toFixed(2)}</p>
                </div>
              )}
            </div>

            <div className="bg-[#111] border border-white/5 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Costo Base</p>
                <p className="text-base font-bold text-white">${calc.baseCost.toFixed(2)}</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-emerald-500/80 uppercase tracking-wider">Precio Sugerido</p>
                <p className="text-2xl font-black text-emerald-400">${calc.normalPrice.toFixed(2)}</p>
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Ganancia estimada</p>
                <p className="text-xs font-bold text-emerald-500">${calc.profit.toFixed(2)}</p>
              </div>
            </div>

            {advanced && (
              <div className="mt-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4">
                <p className="text-[10px] font-bold text-indigo-400/80 uppercase tracking-wider mb-1">Precio p/ Mercado Libre</p>
                <p className="text-xl font-black text-indigo-400">${calc.mlPrice.toFixed(2)}</p>
                <p className="text-[10px] text-indigo-400/60 mt-1 leading-tight">Incluye comisiones, extras y envíos.</p>
              </div>
            )}
          </Card>

          {/* Acciones */}
          <div className="space-y-3">
            <button
              onClick={openSaveModal}
              disabled={!hasValidCalc}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#ff6a00] hover:bg-[#ff7a1a] text-white text-sm font-bold transition-all shadow-lg shadow-[#ff6a00]/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PackagePlus size={18} /> Guardar como producto
            </button>
            <Link
              href="/presupuestos"
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#111] hover:bg-white/5 border border-white/10 text-white text-sm font-bold transition-all"
            >
              <FileText size={18} /> Crear presupuesto
            </Link>
            <p className="text-[11px] text-center text-gray-500 leading-tight px-4">
              Después de calcular, podés guardar la pieza para reutilizarla en presupuestos.
            </p>
          </div>
        </div>
      </div>

      {/* MODAL: GUARDAR COMO PRODUCTO */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#111] w-full max-w-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0a0a0a]">
              <h3 className="font-bold text-white flex items-center gap-2">
                <PackagePlus size={18} className="text-[#ff6a00]" /> Guardar como producto
              </h3>
              <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            {saveSuccess ? (
              <div className="p-8 text-center bg-[#111]">
                <div className="mx-auto w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4 border border-emerald-500/20">
                  <CheckCircle2 size={32} className="text-emerald-400" />
                </div>
                <p className="font-bold text-white text-lg mb-1">¡Producto guardado!</p>
                <p className="text-sm text-gray-400 mb-8">El producto fue agregado a tu catálogo.</p>
                <div className="flex gap-3 justify-center">
                  <Link href="/productos" className="px-5 py-2.5 bg-[#ff6a00] text-white rounded-xl text-sm font-bold hover:bg-[#ff7a1a] transition-colors shadow-lg shadow-[#ff6a00]/20">
                    Ver catálogo
                  </Link>
                  <button onClick={() => setShowSaveModal(false)} className="px-5 py-2.5 bg-[#1a1a1a] border border-white/10 text-white rounded-xl text-sm font-bold hover:bg-white/5 transition-colors">
                    Seguir calculando
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-5 bg-[#111]">
                {/* Resumen del cálculo */}
                <div className="bg-[#0a0a0a] p-3 rounded-xl border border-white/5 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="font-bold text-white text-sm">${calc.baseCost.toFixed(2)}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Costo Base</p>
                  </div>
                  <div className="border-x border-white/5">
                    <p className="font-bold text-[#ff6a00] text-sm">${calc.normalPrice.toFixed(2)}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Precio</p>
                  </div>
                  <div>
                    <p className="font-bold text-emerald-400 text-sm">${calc.profit.toFixed(2)}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Ganancia</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-400 mb-1.5">Nombre del producto *</span>
                    <input
                      type="text"
                      value={productForm.name}
                      onChange={(e) => setProductForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full text-sm rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                      placeholder="Ej. Maceta geométrica 15cm"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-400 mb-1.5">Descripción (Opcional)</span>
                    <textarea
                      value={productForm.description}
                      onChange={(e) => setProductForm(prev => ({ ...prev, description: e.target.value }))}
                      rows={2}
                      className="w-full text-sm rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-400 mb-1.5">Stock inicial</span>
                    <input
                      type="number"
                      min="0"
                      value={productForm.stock_quantity}
                      onChange={(e) => setProductForm(prev => ({ ...prev, stock_quantity: parseInt(e.target.value) || 0 }))}
                      className="w-full text-sm rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                    />
                  </label>

                  <div className="block">
                    <span className="block text-xs font-semibold text-gray-400 mb-1.5">Imagen del producto (Opcional)</span>
                    <div className="bg-[#0a0a0a] rounded-xl border border-white/10 p-1">
                      <FileUploadDropzone
                        bucket="product-images"
                        pathPrefix={`${userId}/products`}
                        accept=".jpg,.jpeg,.png,.webp"
                        publicBucket={true}
                        onUploaded={(url) => setProductForm(prev => ({ ...prev, image_url: url }))}
                        label="Subir imagen"
                      />
                    </div>
                    {productForm.image_url && (
                      <div className="mt-2 flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-white/10">
                        <img src={productForm.image_url} alt="Preview" className="h-10 w-10 rounded object-cover" />
                        <span className="text-xs text-gray-400 truncate pr-2">{productForm.image_url}</span>
                      </div>
                    )}
                  </div>
                </div>

                {saveError && (
                  <div className="bg-red-500/10 text-red-400 p-3 rounded-xl text-xs border border-red-500/20 flex items-center gap-2">
                    <AlertCircle size={14} className="shrink-0" /> {saveError}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-white/5 mt-2">
                  <button onClick={() => setShowSaveModal(false)} className="px-5 py-2.5 text-sm font-bold text-gray-400 hover:text-white transition-colors">
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveAsProduct}
                    disabled={savingProduct}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-[#ff6a00] hover:bg-[#ff7a1a] text-white rounded-xl disabled:opacity-50 transition-colors shadow-lg shadow-[#ff6a00]/20"
                  >
                    {savingProduct ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Guardar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>;
}
