"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Zap, DollarSign, Loader2, AlertCircle, Settings, Save, X, PackagePlus, CheckCircle2 } from "lucide-react";
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

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Calculadora de costos"
        action={
          <div className="flex items-center gap-2">
            <Link href="/configuracion?tab=calculadora" className="hidden sm:flex text-xs font-semibold text-gray-400 hover:text-white border border-white/10 bg-[#111] px-3 py-1.5 rounded-lg transition-colors gap-1.5 items-center">
              <Settings size={14} /> Configurar Valores
            </Link>
            <GhostButton onClick={() => setAdvanced((a) => !a)}>
              <Zap size={14} className={advanced ? "text-[#ff6a00] fill-[#ff6a00]" : ""} />
              {advanced ? "Modo básico" : "Modo avanzado"}
            </GhostButton>
          </div>
        }
      />

      {missingData && (
        <div className="mb-6 space-y-3">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2 space-y-6">
          
          {/* SECCIÓN MATERIAL */}
          <div>
            <p className="mb-4 text-sm font-bold text-white border-b border-white/10 pb-2">Datos de Material</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Filamento a usar</span>
                <select 
                  value={selectedFilamentId} 
                  onChange={(e) => setSelectedFilamentId(e.target.value)} 
                  className="w-full text-sm rounded-xl border border-white/10 bg-[#111] py-2.5 px-3 text-white outline-none focus:border-[#ff6a00] focus:bg-[#1a1a1a] focus:ring-2 focus:ring-[#ff6a00]/20"
                >
                  {filaments.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}{f.color ? ` (${f.color})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField label="Gramos de la pieza" value={weight} onChange={setWeight} suffix="g" />
            </div>
          </div>

          {/* SECCIÓN ELECTRICIDAD Y TIEMPO */}
          <div>
            <p className="mb-4 text-sm font-bold text-white border-b border-white/10 pb-2">Tiempo e Impresión</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Impresora</span>
                <select 
                  value={selectedPrinterId} 
                  onChange={(e) => setSelectedPrinterId(e.target.value)} 
                  className="w-full text-sm rounded-xl border border-white/10 bg-[#111] py-2.5 px-3 text-white outline-none focus:border-[#ff6a00] focus:bg-[#1a1a1a] focus:ring-2 focus:ring-[#ff6a00]/20"
                >
                  {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <NumberField label="Horas" value={hours} onChange={setHours} suffix="h" step={1} />
              <NumberField label="Minutos" value={minutes} onChange={setMinutes} suffix="m" step={1} />
            </div>
          </div>

          {/* SECCIÓN MARGEN */}
          <div>
            <p className="mb-4 text-sm font-bold text-white border-b border-white/10 pb-2">Márgenes y Plataforma</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Tipo de producto</span>
                <select 
                  value={selectedMultiplierId} 
                  onChange={(e) => setSelectedMultiplierId(e.target.value)} 
                  className="w-full text-sm rounded-xl border border-white/10 bg-[#111] py-2.5 px-3 text-white outline-none focus:border-[#ff6a00] focus:bg-[#1a1a1a] focus:ring-2 focus:ring-[#ff6a00]/20"
                >
                  {multipliers.map(m => <option key={m.id} value={m.id}>{m.name} (x{m.multiplier})</option>)}
                </select>
              </label>
            </div>
          </div>

          {/* OPCIONES AVANZADAS AGRUPADAS */}
          {advanced && (
            <div className="p-5 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 space-y-5 animate-in fade-in-50 duration-200 shadow-md">
              <div className="flex items-center gap-2 pb-2 border-b border-indigo-500/20">
                <span className="text-sm font-bold text-indigo-400">Opciones Avanzadas</span>
                <span className="rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold px-2.5 py-0.5 uppercase tracking-wider border border-indigo-500/30">Avanzado</span>
              </div>
              <p className="text-xs text-indigo-300/80">
                Ajustá valores de desperdicio, costos por kg personalizados, consumos específicos de tu impresora, mano de obra, comisiones de venta y envío.
              </p>
              
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-4">
                  <p className="text-xs font-bold text-indigo-300 uppercase tracking-wider">Materiales y Taller</p>
                  <div className="grid grid-cols-1 gap-3">
                    <NumberField label="Margen de error (desperdicio)" value={manualErrorPercent} onChange={setManualErrorPercent} suffix="%" />
                    <NumberField label="Costo por kg manual (sobreescribe)" value={manualPricePerKg} onChange={setManualPricePerKg} suffix="$" />
                    <NumberField label="Consumo de impresora" value={manualPrinterConsumption} onChange={setManualPrinterConsumption} suffix="W" />
                    <NumberField label="Costo del kWh eléctrico" value={manualKwhPrice} onChange={setManualKwhPrice} suffix="$" />
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-xs font-bold text-indigo-300 uppercase tracking-wider">Costos Extras y Márgenes</p>
                  <div className="grid grid-cols-1 gap-3">
                    <NumberField label="Mantenimiento de máquina por hora" value={manualPrinterMaintenance} onChange={setManualPrinterMaintenance} suffix="$" />
                    <NumberField label="Costo de mano de obra (total)" value={laborCost} onChange={setLaborCost} suffix="$" />
                    <NumberField label="Otros costos adicionales" value={otherCost} onChange={setOtherCost} suffix="$" />
                    <NumberField label="Multiplicador manual (sobreescribe)" value={manualMultiplier} onChange={setManualMultiplier} suffix="x" step={0.1} />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-indigo-500/20">
                <p className="text-xs font-bold text-indigo-300 uppercase tracking-wider mb-3">Plataforma de Venta (ML, etc.)</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <NumberField label="Comisión plataforma" value={manualPlatformCommission} onChange={setManualPlatformCommission} suffix="%" />
                  <NumberField label="Fijo extra plataforma" value={manualPlatformExtra} onChange={setManualPlatformExtra} suffix="$" />
                  <NumberField label="Costo Envío" value={shippingCost} onChange={setShippingCost} suffix="$" />
                </div>
              </div>
            </div>
          )}

          {/* GUARDAR COMO PRODUCTO */}
          {hasValidCalc && (
            <div className="border-t border-white/10 pt-4">
              <button
                onClick={openSaveModal}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#ff6a00] hover:bg-[#ff7a1a] text-white text-sm font-bold transition-colors shadow-md shadow-[#ff6a00]/10"
              >
                <PackagePlus size={16} /> Guardar como producto
              </button>
            </div>
          )}

        </Card>

        <Card className="h-fit p-5 border-[#ff6a00]/20 shadow-md bg-[#0a0a0a]">
          <p className="mb-4 flex items-center gap-2 text-sm font-bold text-white border-b border-white/10 pb-2">
            <DollarSign size={16} className="text-[#ff6a00]" /> Resultado Final
          </p>
          <div className="space-y-4">
            
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Costo Material</p>
              <p className="text-sm font-semibold text-white">${calc.materialCost.toFixed(2)}</p>
            </div>
            
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Costo Eléctrico</p>
              <p className="text-sm font-semibold text-white">${calc.energyCost.toFixed(2)}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Costo Mantenimiento</p>
              <p className="text-sm font-semibold text-white">${calc.printerCost.toFixed(2)}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Costo Fijo</p>
              <p className="text-sm font-semibold text-white">${calc.fixedCost.toFixed(2)}</p>
            </div>
            
            {advanced && (laborCost > 0 || otherCost > 0) && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Mano obra y otros</p>
                <p className="text-sm font-semibold text-white">${(laborCost + otherCost).toFixed(2)}</p>
              </div>
            )}

            <div className="my-2 h-px bg-white/10" />

            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-400">COSTO BASE</p>
              <p className="text-lg font-bold text-white">${calc.baseCost.toFixed(2)}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-emerald-400">PRECIO NORMAL</p>
              <p className="text-xl font-black text-emerald-400">${calc.normalPrice.toFixed(2)}</p>
            </div>

            <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg">
              <p className="text-xs font-bold text-emerald-400">Ganancia Estimada</p>
              <p className="text-sm font-bold text-emerald-400">${calc.profit.toFixed(2)}</p>
            </div>

            {advanced && (
              <div className="mt-4 rounded-xl bg-indigo-500/10 p-4 border border-indigo-500/30">
                <p className="text-xs font-bold text-indigo-400 opacity-80 mb-1">PRECIO MERCADO LIBRE</p>
                <p className="text-2xl font-black text-indigo-400">${calc.mlPrice.toFixed(2)}</p>
                <p className="text-[10px] text-indigo-400/80 mt-1">Incluye comisiones, extras y envíos.</p>
              </div>
            )}

          </div>
        </Card>
      </div>

      {/* MODAL: GUARDAR COMO PRODUCTO */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-[#111] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <h3 className="font-bold text-white flex items-center gap-2">
                <PackagePlus size={18} className="text-orange-500" /> Guardar como producto
              </h3>
              <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-300">
                <X size={20} />
              </button>
            </div>

            {saveSuccess ? (
              <div className="p-8 text-center">
                <CheckCircle2 size={48} className="text-green-500 mx-auto mb-3" />
                <p className="font-bold text-white text-lg mb-1">¡Producto guardado!</p>
                <p className="text-sm text-gray-500 mb-6">El producto fue agregado a tu catálogo.</p>
                <div className="flex gap-3 justify-center">
                  <Link href="/productos" className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-bold hover:bg-orange-600">
                    Ver productos
                  </Link>
                  <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 border border-white/10 text-gray-400 rounded-lg text-sm font-bold hover:bg-[#0a0a0a]">
                    Seguir calculando
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                {/* Resumen del cálculo */}
                <div className="bg-[#0a0a0a] p-3 rounded-xl border border-white/5 grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="font-bold text-white">${calc.baseCost.toFixed(2)}</p>
                    <p className="text-gray-400">Costo Base</p>
                  </div>
                  <div>
                    <p className="font-bold text-orange-600">${calc.normalPrice.toFixed(2)}</p>
                    <p className="text-gray-400">Precio Venta</p>
                  </div>
                  <div>
                    <p className="font-bold text-emerald-600">${calc.profit.toFixed(2)}</p>
                    <p className="text-gray-400">Ganancia</p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Nombre del producto *</label>
                  <input
                    type="text"
                    value={productForm.name}
                    onChange={(e) => setProductForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full text-sm border-white/20 rounded-lg px-3 py-2 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-white bg-[#111]"
                    placeholder="Ej. Maceta geométrica 15cm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Descripción (Opcional)</label>
                  <textarea
                    value={productForm.description}
                    onChange={(e) => setProductForm(prev => ({ ...prev, description: e.target.value }))}
                    rows={2}
                    className="w-full text-sm border-white/20 rounded-lg px-3 py-2 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-white bg-[#111]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Stock inicial</label>
                  <input
                    type="number"
                    min="0"
                    value={productForm.stock_quantity}
                    onChange={(e) => setProductForm(prev => ({ ...prev, stock_quantity: parseInt(e.target.value) || 0 }))}
                    className="w-full text-sm border-white/20 rounded-lg px-3 py-2 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-white bg-[#111]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Imagen del producto (Opcional)</label>
                  <FileUploadDropzone
                    bucket="product-images"
                    pathPrefix={`${userId}/products`}
                    accept=".jpg,.jpeg,.png,.webp"
                    publicBucket={true}
                    onUploaded={(url) => setProductForm(prev => ({ ...prev, image_url: url }))}
                    label="Subir imagen"
                  />
                  {productForm.image_url && (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={productForm.image_url} alt="Preview" className="h-12 w-12 rounded-lg object-cover border border-white/10" />
                      <span className="text-xs text-gray-500 truncate">{productForm.image_url}</span>
                    </div>
                  )}
                </div>

                {saveError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs border border-red-100 flex items-center gap-2">
                    <AlertCircle size={14} /> {saveError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 text-sm font-bold text-gray-400 hover:bg-white/5 rounded-lg">
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveAsProduct}
                    disabled={savingProduct}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-lg disabled:opacity-60"
                  >
                    {savingProduct ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Guardar Producto
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
