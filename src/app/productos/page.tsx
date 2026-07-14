"use client";

import React, { useState, useEffect } from "react";
import { Plus, Pencil, Copy, Trash2, Loader2, Save, X, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, History, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";

// Pricing Status Helper
function getProductPricingStatus(product: any, allFilaments: any[], allPrinters: any[], allProductTypes: any[]) {
  const snap = product.calculation_snapshot;
  if (!snap || !snap.source) {
    return { needsRecalculation: true, reasons: ["Producto sin snapshot de costos actualizado"] };
  }

  const reasons: string[] = [];
  
  // Filament checks
  if (snap.filament_id || product.filament_id) {
    const fId = snap.filament_id || product.filament_id;
    const currentF = allFilaments.find(f => f.id === fId);
    if (!currentF) {
      reasons.push("Configuración vinculada no encontrada");
    } else {
      if (snap.filament_purchase_price && snap.filament_purchase_price !== currentF.purchase_price) {
        reasons.push("Cambió el precio del filamento");
      }
      if (snap.filament_total_grams && snap.filament_total_grams !== currentF.total_grams) {
        reasons.push("Cambió la cantidad base del filamento");
      }
    }
  }

  // Printer checks
  if (snap.printer_id || product.printer_id) {
    const pId = snap.printer_id || product.printer_id;
    const currentP = allPrinters.find(p => p.id === pId);
    if (!currentP) {
      if (!reasons.includes("Configuración vinculada no encontrada")) reasons.push("Configuración vinculada no encontrada");
    } else {
      if (snap.printer_power_watts && snap.printer_power_watts !== currentP.power_watts) {
        reasons.push("Cambió el consumo de la impresora");
      }
      if (snap.printer_maintenance_cost_per_hour !== undefined && snap.printer_maintenance_cost_per_hour !== null && snap.printer_maintenance_cost_per_hour !== currentP.maintenance_cost_per_hour) {
        reasons.push("Cambió el costo de mantenimiento de la impresora");
      }
    }
  }

  // Product Type checks
  if (snap.product_type_id || product.product_type_id) {
    const ptId = snap.product_type_id || product.product_type_id;
    const currentPT = allProductTypes.find(pt => pt.id === ptId);
    if (!currentPT) {
      if (!reasons.includes("Configuración vinculada no encontrada")) reasons.push("Configuración vinculada no encontrada");
    } else {
      if (snap.product_type_multiplier && snap.product_type_multiplier !== currentPT.multiplier) {
        reasons.push("Cambió el multiplicador del tipo de producto");
      }
      if (snap.product_type_fixed_cost !== undefined && snap.product_type_fixed_cost !== null && snap.product_type_fixed_cost !== currentPT.fixed_cost) {
        reasons.push("Cambió el costo fijo del tipo de producto");
      }
    }
  }

  return {
    needsRecalculation: reasons.length > 0,
    reasons
  };
}

export default function ProductosPage() {
  const supabase = createClient();
  const [products, setProducts] = useState<any[]>([]);
  const [filaments, setFilaments] = useState<any[]>([]);
  const [printers, setPrinters] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    image_url: "",
    filament_id: "",
    grams: 0,
    print_time_hours: 0,
    print_time_remaining_minutes: 0,
    base_cost: 0,
    sale_price: 0,
    stock_quantity: 0,
    is_active: true,
  });

  // Recalculate modal state
  const [recalcProductId, setRecalcProductId] = useState<string | null>(null);
  const [recalcData, setRecalcData] = useState<{ currentSalePrice: number; recommendedSalePrice: number; recommendedBaseCost: number; breakdown: any; newSnapshot?: any } | null>(null);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [recalcSaving, setRecalcSaving] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);

  // Price history
  const [historyProductId, setHistoryProductId] = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const [prodRes, filRes, priRes, ptRes] = await Promise.all([
      supabase.from("products").select("*, filaments(name, color)").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("filaments").select("*").eq("user_id", user.id).eq("is_active", true),
      supabase.from("printers").select("*").eq("user_id", user.id).eq("is_active", true),
      supabase.from("calculator_product_types").select("*").eq("user_id", user.id).eq("is_active", true)
    ]);

    if (prodRes.error) setError(prodRes.error.message);
    else setProducts(prodRes.data || []);
    
    if (!filRes.error) setFilaments(filRes.data || []);
    if (!priRes.error) setPrinters(priRes.data || []);
    if (!ptRes.error) setProductTypes(ptRes.data || []);

    setLoading(false);
  };

  const handleCreateNew = () => {
    setFormData({
      name: "", description: "", image_url: "", filament_id: filaments.length > 0 ? filaments[0].id : "",
      grams: 0, print_time_hours: 0, print_time_remaining_minutes: 0, base_cost: 0, sale_price: 0, stock_quantity: 0, is_active: true
    });
    setEditingId("new");
  };

  const handleEdit = (p: any) => {
    const hours = Math.floor((p.print_time_minutes || 0) / 60);
    const mins = (p.print_time_minutes || 0) % 60;
    setFormData({
      name: p.name, description: p.description || "", image_url: p.image_url || "", filament_id: p.filament_id || "",
      grams: p.grams || 0, print_time_hours: hours, print_time_remaining_minutes: mins, base_cost: p.base_cost || 0, 
      sale_price: p.sale_price || 0, stock_quantity: p.stock_quantity || 0, is_active: p.is_active
    });
    setEditingId(p.id);
    // Load price history for this product
    loadPriceHistory(p.id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Seguro que deseas eliminar este producto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) alert("Error: " + error.message);
    else setProducts(products.filter(p => p.id !== id));
  };

  const handleDuplicate = async (p: any) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const payload = {
      user_id: user.id, name: p.name + " (Copia)", description: p.description, image_url: p.image_url, 
      filament_id: p.filament_id, grams: p.grams, print_time_minutes: p.print_time_minutes, 
      base_cost: p.base_cost, sale_price: p.sale_price, stock_quantity: 0, is_active: p.is_active
    };

    const { data, error } = await supabase.from("products").insert([payload]).select("*, filaments(name, color)").single();
    if (error) alert("Error: " + error.message);
    else if (data) setProducts([data, ...products]);
  };

  const handleSave = async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const hours = Math.max(0, parseInt(String(formData.print_time_hours)) || 0);
    const mins = Math.max(0, Math.min(59, parseInt(String(formData.print_time_remaining_minutes)) || 0));
    const totalMinutes = (hours * 60) + mins;

    const payload = {
      name: formData.name,
      description: formData.description,
      image_url: formData.image_url,
      filament_id: formData.filament_id || null,
      grams: parseFloat(String(formData.grams)) || 0,
      print_time_minutes: totalMinutes,
      base_cost: parseFloat(String(formData.base_cost)) || 0,
      sale_price: parseFloat(String(formData.sale_price)) || 0,
      stock_quantity: parseInt(String(formData.stock_quantity)) || 0,
      is_active: formData.is_active,
      user_id: user.id
    };

    if (editingId === "new") {
      const { data, error } = await supabase.from("products").insert([payload]).select("*, filaments(name, color)").single();
      if (error) setError(error.message);
      else {
        setProducts([data, ...products]);
        setEditingId(null);
      }
    } else {
      const { data, error } = await supabase.from("products").update(payload).eq("id", editingId).select("*, filaments(name, color)").single();
      if (error) setError(error.message);
      else {
        setProducts(products.map(p => p.id === editingId ? data : p));
        setEditingId(null);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    let newValue: any = value;
    
    if (type === "checkbox") {
      newValue = (e.target as HTMLInputElement).checked;
    }
    
    setFormData(prev => {
      const nextData = { ...prev, [name]: newValue };
      
      // Auto-calc base cost if grams or filament changes
      if (name === "grams" || name === "filament_id") {
        const selectedFilament = filaments.find(f => f.id === nextData.filament_id);
        if (selectedFilament && selectedFilament.total_grams > 0) {
          const g = parseFloat(String(nextData.grams)) || 0;
          const estimatedCost = g * (selectedFilament.purchase_price / selectedFilament.total_grams);
          if (nextData.base_cost === 0 || name === "grams") {
             nextData.base_cost = parseFloat(estimatedCost.toFixed(2));
          }
        }
      }
      return nextData;
    });
  };

  // -------- RECALCULATE PRICE --------
  const handleRecalculate = async (product: any) => {
    setRecalcProductId(product.id);
    setRecalcData(null);
    setRecalcError(null);
    setRecalcLoading(true);

    // Try to get filament data
    const filament = filaments.find(f => f.id === product.filament_id);
    
    // Check snapshot for more context
    const snap = product.calculation_snapshot;
    const printerId = snap?.printer_id || product.printer_id || null;
    const productTypeId = snap?.product_type_id || product.product_type_id || null;
    
    const printer = printers.find(p => p.id === printerId);
    const productType = productTypes.find(pt => pt.id === productTypeId);

    // Get settings
    const { data: settingsData } = await supabase
      .from("calculator_settings")
      .select("*")
      .eq("user_id", product.user_id)
      .single();

    const errorPercent = snap?.error_percent || 5;
    const totalHours = (product.print_time_minutes || 0) / 60;
    const grams = product.grams || 0;
    const errorMultiplier = 1 + (errorPercent / 100);
    const weightWithError = grams * errorMultiplier;

    // Compute costs
    let materialCost = 0;
    if (filament && filament.total_grams > 0) {
      const costPerGram = filament.purchase_price / filament.total_grams;
      materialCost = weightWithError * costPerGram;
    }

    const kwhPrice = settingsData?.electricity_price_kwh || snap?.kwhPrice || 0;
    const powerWatts = printer?.power_watts || snap?.printer_consumption_watts || 0;
    const maintenanceCostPerHour = printer?.maintenance_cost_per_hour || snap?.maintenance_cost_per_hour || 0;
    const energyCost = totalHours * (powerWatts / 1000) * kwhPrice;
    const printerCost = totalHours * maintenanceCostPerHour;
    const fixedCost = productType?.fixed_cost || snap?.fixed_cost || 0;
    const laborCost = snap?.labor_cost || 0;
    const otherCosts = snap?.other_costs || 0;

    const baseCost = materialCost + energyCost + printerCost + fixedCost + laborCost + otherCosts;
    const multiplier = productType?.multiplier || snap?.multiplier || 1;
    const recommendedSalePrice = baseCost * multiplier;

    if (baseCost <= 0) {
      setRecalcError(
        "No hay suficiente información para recalcular. Asegurate de que el producto tenga filamento, impresora y tipo de producto configurados, o usa la calculadora."
      );
      setRecalcLoading(false);
      return;
    }

    setRecalcData({
      currentSalePrice: product.sale_price || 0,
      recommendedSalePrice: parseFloat(recommendedSalePrice.toFixed(2)),
      recommendedBaseCost: parseFloat(baseCost.toFixed(2)),
      breakdown: {
        materialCost: parseFloat(materialCost.toFixed(2)),
        energyCost: parseFloat(energyCost.toFixed(2)),
        printerCost: parseFloat(printerCost.toFixed(2)),
        fixedCost: parseFloat(fixedCost.toFixed(2)),
        laborCost: parseFloat(laborCost.toFixed(2)),
        otherCosts: parseFloat(otherCosts.toFixed(2)),
        multiplier,
      },
      newSnapshot: {
        ...(product.calculation_snapshot || {}),
        source: "calculator",
        mode: product.calculation_snapshot?.mode || "basic",
        grams: grams,
        grams_with_error: weightWithError,
        error_percent: errorPercent,
        print_time_minutes: product.print_time_minutes,
        material_cost: materialCost,
        electricity_cost: energyCost,
        maintenance_cost: printerCost,
        fixed_cost: fixedCost,
        labor_cost: laborCost,
        other_costs: otherCosts,
        base_cost: baseCost,
        multiplier: multiplier,
        sale_price: recommendedSalePrice,
        profit: recommendedSalePrice - baseCost,
        filament_id: filament?.id || null,
        filament_name: filament?.name || null,
        filament_purchase_price: filament?.purchase_price || null,
        filament_total_grams: filament?.total_grams || null,
        filament_cost_per_gram: filament && filament.total_grams > 0 ? (filament.purchase_price / filament.total_grams) : null,
        printer_id: printer?.id || null,
        printer_name: printer?.name || null,
        printer_power_watts: printer?.power_watts || null,
        printer_maintenance_cost_per_hour: printer?.maintenance_cost_per_hour || null,
        product_type_id: productType?.id || null,
        product_type_name: productType?.name || null,
        product_type_multiplier: productType?.multiplier || null,
        product_type_fixed_cost: productType?.fixed_cost || null,
      }
    });
    setRecalcLoading(false);
  };

  const handleConfirmRecalc = async () => {
    if (!recalcProductId || !recalcData || !userId) return;
    setRecalcSaving(true);

    const product = products.find(p => p.id === recalcProductId);
    if (!product) { setRecalcSaving(false); return; }

    // Try to save history (if table exists), fail silently if not
    const historyPayload = {
      product_id: recalcProductId,
      user_id: userId,
      old_base_cost: product.base_cost,
      old_sale_price: product.sale_price,
      new_base_cost: recalcData.recommendedBaseCost,
      new_sale_price: recalcData.recommendedSalePrice,
      source: "manual_recalculate",
      changed_at: new Date().toISOString(),
    };
    await supabase.from("product_price_history").insert([historyPayload]);
    // ^^ No error handling - fail silently if table doesn't exist

    // Update the product
    const { data, error } = await supabase
      .from("products")
      .update({
        base_cost: recalcData.recommendedBaseCost,
        sale_price: recalcData.recommendedSalePrice,
        calculation_snapshot: recalcData.newSnapshot,
        cost_updated_at: new Date().toISOString(),
      })
      .eq("id", recalcProductId)
      .select("*, filaments(name, color)")
      .single();

    if (error) {
      // If cost_updated_at doesn't exist, retry without it
      const { data: data2, error: error2 } = await supabase
        .from("products")
        .update({
          base_cost: recalcData.recommendedBaseCost,
          sale_price: recalcData.recommendedSalePrice,
          calculation_snapshot: recalcData.newSnapshot,
        })
        .eq("id", recalcProductId)
        .select("*, filaments(name, color)")
        .single();
      
      if (error2) {
        alert("Error al actualizar: " + error2.message);
      } else if (data2) {
        setProducts(products.map(p => p.id === recalcProductId ? data2 : p));
        setRecalcProductId(null);
        setRecalcData(null);
      }
    } else if (data) {
      setProducts(products.map(p => p.id === recalcProductId ? data : p));
      setRecalcProductId(null);
      setRecalcData(null);
    }
    setRecalcSaving(false);
  };

  // -------- PRICE HISTORY --------
  const loadPriceHistory = async (productId: string) => {
    setHistoryLoading(true);
    setHistoryProductId(productId);
    const { data } = await supabase
      .from("product_price_history")
      .select("*")
      .eq("product_id", productId)
      .order("changed_at", { ascending: false })
      .limit(10);
    setPriceHistory(data || []);
    setHistoryLoading(false);
  };

  const formatTime = (mins: number) => {
    if (!mins) return "0m";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Productos"
        action={
          <PrimaryButton onClick={handleCreateNew} disabled={editingId !== null}>
            <Plus size={15} /> Nuevo producto
          </PrimaryButton>
        }
      />
      
      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {editingId && (
        <Card className="mb-8 p-5 border-orange-300 shadow-md ring-1 ring-orange-100">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-900">{editingId === "new" ? "Nuevo Producto" : "Editar Producto"}</h3>
            <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Nombre</label>
              <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="Ej. Llavero personalizado" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Filamento</label>
              <select name="filament_id" value={formData.filament_id} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white">
                <option value="">Selecciona un filamento...</option>
                {filaments.map(f => <option key={f.id} value={f.id}>{f.name} ({f.color})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Gramos (Peso)</label>
                <input type="number" name="grams" value={formData.grams} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">Horas</label>
                  <input type="number" name="print_time_hours" min="0" value={formData.print_time_hours} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">Minutos</label>
                  <input type="number" name="print_time_remaining_minutes" min="0" max="59" value={formData.print_time_remaining_minutes} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Costo Base ($)</label>
                <input type="number" name="base_cost" value={formData.base_cost} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Precio Venta ($)</label>
                <input type="number" name="sale_price" value={formData.sale_price} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Stock Actual</label>
                <input type="number" name="stock_quantity" value={formData.stock_quantity} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-gray-700">Imagen del Producto</label>
              <div className="space-y-3 mt-1">
                <FileUploadDropzone
                  bucket="product-images"
                  pathPrefix={`${userId || "default"}/products`}
                  accept=".jpg,.jpeg,.png,.webp,.svg"
                  publicBucket={true}
                  onUploaded={(url) => setFormData(prev => ({ ...prev, image_url: url }))}
                  label="Subir Imagen"
                />
                <div className="flex items-center gap-2">
                  <hr className="flex-1 border-gray-200" />
                  <span className="text-[10px] text-gray-400 font-semibold uppercase">O URL Externa</span>
                  <hr className="flex-1 border-gray-200" />
                </div>
                <div className="flex gap-4 items-center">
                  <input type="text" name="image_url" value={formData.image_url} onChange={handleChange} className="flex-1 text-sm border-gray-300 rounded-lg px-3 py-2 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-gray-900 bg-white" placeholder="https://..." />
                  {formData.image_url && (
                    <div className="h-12 w-12 shrink-0 rounded-lg bg-gray-100 overflow-hidden border border-gray-200">
                      <img src={formData.image_url} alt="Producto" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Historial de precios */}
          {editingId !== "new" && historyProductId === editingId && (
            <div className="mb-4 border border-gray-100 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2 text-xs font-bold text-gray-600">
                <History size={14} /> Historial de precios
              </div>
              {historyLoading ? (
                <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-gray-400" /></div>
              ) : priceHistory.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-2">Sin historial de cambios de precio.</p>
              ) : (
                <div className="space-y-1">
                  {priceHistory.map((h: any) => (
                    <div key={h.id} className="flex items-center justify-between text-xs text-gray-600 py-1 border-b border-gray-50">
                      <span className="text-gray-400">{formatDate(h.changed_at)}</span>
                      <span className="text-red-400 line-through">${(h.old_sale_price || 0).toFixed(2)}</span>
                      <span className="text-green-600 font-bold">${(h.new_sale_price || 0).toFixed(2)}</span>
                      <span className="text-gray-400 capitalize">{h.source?.replace("_", " ") || "manual"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2">
              <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-orange-600 focus:ring-orange-500" />
              <label className="text-sm font-medium text-gray-700">Producto Activo</label>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
              <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors">
                <Save size={16} /> Guardar
              </button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => {
          const filament = p.filaments;
          const profit = (p.sale_price || 0) - (p.base_cost || 0);
          const marginPct = p.sale_price > 0 ? ((profit / p.sale_price) * 100) : 0;
          const pricingStatus = getProductPricingStatus(p, filaments, printers, productTypes);

          return (
            <Card key={p.id} className={`p-4 transition-all ${!p.is_active ? 'opacity-60 grayscale' : ''} ${pricingStatus.needsRecalculation ? 'border-yellow-400 bg-yellow-50/30 ring-1 ring-yellow-400/50' : ''}`}>
              
              {pricingStatus.needsRecalculation && (
                <div className="mb-3 flex items-start gap-2 bg-yellow-100/80 rounded-lg p-2.5 border border-yellow-200">
                  <AlertTriangle size={16} className="text-yellow-700 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-yellow-800 uppercase tracking-wide">Requiere Recalcular</p>
                    <p className="text-xs text-yellow-700 mt-0.5">
                      {pricingStatus.reasons.slice(0, 2).map((r, i) => (
                        <span key={i} className="block">• {r}</span>
                      ))}
                      {pricingStatus.reasons.length > 2 && (
                        <span className="block italic text-yellow-600 mt-0.5">+ {pricingStatus.reasons.length - 2} cambios más</span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="h-14 w-14 shrink-0 rounded-xl object-cover bg-gray-50 border border-gray-100" />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-2xl select-none border border-gray-100 text-gray-400">
                    📦
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-400 truncate">{p.description || "Sin descripción"}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                    {filament && (
                      <>
                        <div className="w-2.5 h-2.5 rounded-full border border-gray-300" style={{ backgroundColor: filament.color || '#ccc' }}></div>
                        <span className="truncate max-w-[80px]">{filament.name}</span> ·
                      </>
                    )}
                    <span>{p.grams || 0}g</span> · <span>{formatTime(p.print_time_minutes)}</span>
                  </div>
                </div>
              </div>

              {/* Prices + Profit */}
              <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-xl bg-gray-50 p-2.5 text-center">
                <div>
                  <p className="text-xs font-bold text-gray-900">${p.base_cost?.toFixed(2) || "0.00"}</p>
                  <p className="text-[10px] text-gray-400">Costo</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-orange-600">${p.sale_price?.toFixed(2) || "0.00"}</p>
                  <p className="text-[10px] text-gray-400">Venta</p>
                </div>
                <div>
                  <p className={`text-xs font-bold flex items-center justify-center gap-0.5 ${profit > 0 ? 'text-emerald-600' : profit < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {profit > 0 ? <TrendingUp size={10} /> : profit < 0 ? <TrendingDown size={10} /> : <Minus size={10} />}
                    ${Math.abs(profit).toFixed(2)}
                  </p>
                  <p className="text-[10px] text-gray-400">Ganancia</p>
                </div>
                <div>
                  <p className={`text-xs font-bold ${p.stock_quantity > 0 ? 'text-gray-900' : 'text-red-500'}`}>{p.stock_quantity || 0}</p>
                  <p className="text-[10px] text-gray-400">Stock</p>
                </div>
              </div>

              {/* Margin badge */}
              {p.sale_price > 0 && p.base_cost > 0 && (
                <div className="mt-2 flex items-center justify-end">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${marginPct >= 30 ? 'bg-emerald-100 text-emerald-700' : marginPct >= 15 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
                    {marginPct.toFixed(0)}% margen
                  </span>
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <GhostButton onClick={() => handleEdit(p)} className="flex-1 py-2 text-xs text-gray-700 bg-white border border-gray-200">
                  <Pencil size={13} /> Editar
                </GhostButton>
                <GhostButton 
                  onClick={() => handleRecalculate(p)} 
                  className={`flex-1 py-2 text-xs border ${pricingStatus.needsRecalculation ? 'text-white bg-yellow-600 hover:bg-yellow-700 border-yellow-700' : 'text-indigo-600 hover:bg-indigo-50 border-indigo-200 bg-white'}`}
                  title="Recalcular precio con valores actuales"
                >
                  <RefreshCw size={13} className={pricingStatus.needsRecalculation ? "animate-pulse" : ""} /> Recalcular
                </GhostButton>
                <GhostButton onClick={() => handleDuplicate(p)} className="px-2.5 py-2 text-gray-500 hover:text-gray-900 bg-white border border-gray-200">
                  <Copy size={13} />
                </GhostButton>
                <GhostButton onClick={() => handleDelete(p.id)} className="px-2.5 py-2 text-red-500 hover:bg-red-50 border border-gray-200 bg-white">
                  <Trash2 size={13} />
                </GhostButton>
              </div>
            </Card>
          );
        })}
      </div>
      
      {products.length === 0 && !editingId && (
        <div className="py-20 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
          <p className="text-sm text-gray-500 font-medium">No tienes productos en tu catálogo.</p>
          <PrimaryButton onClick={handleCreateNew} className="mt-4">Crear mi primer producto</PrimaryButton>
        </div>
      )}

      {/* MODAL: RECALCULAR PRECIO */}
      {recalcProductId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <RefreshCw size={18} className="text-indigo-500" /> Recalcular precio
              </h3>
              <button onClick={() => { setRecalcProductId(null); setRecalcData(null); setRecalcError(null); }} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              {recalcLoading ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <Loader2 className="animate-spin h-8 w-8 text-indigo-500" />
                  <p className="text-sm text-gray-500">Calculando con valores actuales...</p>
                </div>
              ) : recalcError ? (
                <div>
                  <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl mb-4 flex items-start gap-3">
                    <AlertCircle size={18} className="text-orange-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-orange-800">{recalcError}</p>
                  </div>
                  <p className="text-xs text-gray-500">
                    Para recalcular correctamente, asegurate de haber creado el producto desde la calculadora con todos los datos completos.
                  </p>
                  <div className="flex justify-end mt-4">
                    <button onClick={() => { setRecalcProductId(null); setRecalcError(null); }} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cerrar</button>
                  </div>
                </div>
              ) : recalcData ? (
                <div className="space-y-4">
                  {/* Comparison */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 p-4 rounded-xl text-center border border-gray-200">
                      <p className="text-[10px] text-gray-400 font-semibold uppercase mb-1">Precio Actual</p>
                      <p className="text-2xl font-black text-gray-700">${recalcData.currentSalePrice.toFixed(2)}</p>
                    </div>
                    <div className="bg-indigo-50 p-4 rounded-xl text-center border border-indigo-200">
                      <p className="text-[10px] text-indigo-600 font-semibold uppercase mb-1">Precio Sugerido</p>
                      <p className="text-2xl font-black text-indigo-600">${recalcData.recommendedSalePrice.toFixed(2)}</p>
                    </div>
                  </div>

                  {/* Difference pill */}
                  {(() => {
                    const diff = recalcData.recommendedSalePrice - recalcData.currentSalePrice;
                    const isUp = diff > 0;
                    return (
                      <div className={`flex items-center justify-center gap-2 py-2 px-4 rounded-full text-sm font-bold ${isUp ? 'bg-yellow-50 text-yellow-700' : diff < 0 ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                        {isUp ? <TrendingUp size={16} /> : diff < 0 ? <TrendingDown size={16} /> : <Minus size={16} />}
                        {diff === 0 ? "El precio está al día" : `${isUp ? "Subida" : "Bajada"} de $${Math.abs(diff).toFixed(2)}`}
                      </div>
                    );
                  })()}

                  {/* Breakdown */}
                  <div className="bg-gray-50 p-3 rounded-xl text-xs space-y-1.5">
                    <p className="font-bold text-gray-700 mb-2">Detalle del nuevo cálculo</p>
                    {[
                      ["Material", recalcData.breakdown.materialCost],
                      ["Electricidad", recalcData.breakdown.energyCost],
                      ["Mantenimiento", recalcData.breakdown.printerCost],
                      ["Costo Fijo", recalcData.breakdown.fixedCost],
                      recalcData.breakdown.laborCost > 0 && ["Mano de obra", recalcData.breakdown.laborCost],
                    ].filter(Boolean).map(([label, val]: any) => (
                      <div key={label} className="flex justify-between text-gray-600">
                        <span>{label}</span>
                        <span className="font-semibold">${val.toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1.5 mt-1.5">
                      <span>Costo Base</span>
                      <span>${recalcData.recommendedBaseCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>Multiplicador</span>
                      <span>×{recalcData.breakdown.multiplier}</span>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button onClick={() => { setRecalcProductId(null); setRecalcData(null); }} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
                    <button
                      onClick={handleConfirmRecalc}
                      disabled={recalcSaving}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-60"
                    >
                      {recalcSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      Aplicar nuevo precio
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
