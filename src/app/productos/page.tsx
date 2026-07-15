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
  
  // Material checks
  if (snap.materials && Array.isArray(snap.materials) && snap.materials.length > 0) {
    for (const mat of snap.materials) {
      const currentF = allFilaments.find(f => f.id === mat.filament_id);
      if (!currentF) {
        if (!reasons.includes("Configuración de material no encontrada")) reasons.push("Configuración de material no encontrada");
      } else {
        if (mat.filament_purchase_price && mat.filament_purchase_price !== currentF.purchase_price) {
          reasons.push(`Cambió el precio de ${currentF.name}`);
        }
        if (mat.filament_total_grams && mat.filament_total_grams !== currentF.total_grams) {
          reasons.push(`Cambió la cantidad base de ${currentF.name}`);
        }
      }
    }
  } else if (snap.filament_id || product.filament_id) {
    const fId = snap.filament_id || product.filament_id;
    const currentF = allFilaments.find(f => f.id === fId);
    if (!currentF) {
      if (!reasons.includes("Configuración de material no encontrada")) reasons.push("Configuración de material no encontrada");
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

// Reusable Calculator Logic
export function calculateProductPrice({ components, printTimeMinutes, printer, productType, calculatorSettings, oldSnapshot }: any) {
  const errorPercent = calculatorSettings?.default_error_percent || 0;
  const errorMultiplier = 1 + (errorPercent / 100);
  
  let materialCost = 0;
  let totalGrams = 0;
  let totalGramsWithError = 0;
  
  const processedComponents: any[] = [];
  const processedMaterials: any[] = []; // for compatibility
  let mode = "simple_multifilament";
  
  if (components && Array.isArray(components)) {
    if (components.length > 1 || (components.length === 1 && components[0].name !== "Producto completo")) {
      mode = "components";
    }

    for (const comp of components) {
      const compQty = parseFloat(comp.quantity_per_product) || 1;
      const compMats: any[] = [];
      
      if (comp.materials && Array.isArray(comp.materials)) {
        for (const mat of comp.materials) {
          const gPerUnit = parseFloat(mat.grams) || 0;
          const gTotal = gPerUnit * compQty;
          const gTotalWithError = gTotal * errorMultiplier;
          
          totalGrams += gTotal;
          totalGramsWithError += gTotalWithError;

          let matCost = 0;
          let costPerGram = null;
          if (mat.filament && mat.filament.total_grams > 0) {
            costPerGram = mat.filament.purchase_price / mat.filament.total_grams;
            matCost = gTotalWithError * costPerGram;
            materialCost += matCost;
          }

          const processedMat = {
            filament_id: mat.filament?.id || mat.filament_id,
            filament_name: mat.filament?.name || null,
            grams: gPerUnit,
            grams_total: gTotal,
            grams_with_error: gTotalWithError,
            filament_purchase_price: mat.filament?.purchase_price || null,
            filament_total_grams: mat.filament?.total_grams || null,
            filament_cost_per_gram: costPerGram,
            material_cost: matCost
          };
          
          compMats.push(processedMat);
          processedMaterials.push(processedMat);
        }
      }
      
      processedComponents.push({
        component_id: comp.id || null,
        name: comp.name || "Producto completo",
        quantity_per_product: compQty,
        materials: compMats
      });
    }
  }

  const totalHours = (printTimeMinutes || 0) / 60;
  const kwhPrice = calculatorSettings?.electricity_price_kwh || oldSnapshot?.kwhPrice || 0;
  const powerWatts = printer?.power_watts || oldSnapshot?.printer_consumption_watts || 0;
  const maintenanceCostPerHour = printer?.maintenance_cost_per_hour || oldSnapshot?.maintenance_cost_per_hour || 0;
  
  const energyCost = totalHours * (powerWatts / 1000) * kwhPrice;
  const printerCost = totalHours * maintenanceCostPerHour;
  const fixedCost = productType?.fixed_cost || oldSnapshot?.fixed_cost || 0;
  const laborCost = oldSnapshot?.labor_cost || 0;
  const otherCosts = oldSnapshot?.other_costs || 0;

  const baseCost = materialCost + energyCost + printerCost + fixedCost + laborCost + otherCosts;
  const multiplier = productType?.multiplier || oldSnapshot?.multiplier || 1;
  const salePrice = baseCost * multiplier;
  const profit = salePrice - baseCost;

  const snapshot = {
    ...(oldSnapshot || {}),
    source: "product_editor",
    mode: mode,
    components: processedComponents,
    materials: processedMaterials, // Flat list for visual compatibility
    grams: totalGrams,
    grams_with_error: totalGramsWithError,
    total_grams: totalGrams,
    total_grams_with_error: totalGramsWithError,
    error_percent: errorPercent,
    print_time_minutes: printTimeMinutes,
    material_cost: materialCost,
    electricity_cost: energyCost,
    maintenance_cost: printerCost,
    fixed_cost: fixedCost,
    labor_cost: laborCost,
    other_costs: otherCosts,
    base_cost: baseCost,
    multiplier: multiplier,
    sale_price: salePrice,
    profit: profit,
    
    // Fallbacks for compatibility
    filament_id: processedMaterials.length > 0 ? processedMaterials[0].filament_id : null,
    filament_name: processedMaterials.length > 0 ? processedMaterials[0].filament_name : null,
    
    printer_id: printer?.id || null,
    printer_name: printer?.name || null,
    printer_power_watts: printer?.power_watts || null,
    printer_maintenance_cost_per_hour: printer?.maintenance_cost_per_hour || null,
    product_type_id: productType?.id || null,
    product_type_name: productType?.name || null,
    product_type_multiplier: productType?.multiplier || null,
    product_type_fixed_cost: productType?.fixed_cost || null,
  };

  return {
    gramsWithError: totalGramsWithError,
    materialCost,
    electricityCost: energyCost,
    maintenanceCost: printerCost,
    fixedCost,
    baseCost,
    salePrice,
    profit,
    snapshot,
    multiplier
  };
}

export default function ProductosPage() {
  const supabase = createClient();
  const [products, setProducts] = useState<any[]>([]);
  const [filaments, setFilaments] = useState<any[]>([]);
  const [printers, setPrinters] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [calculatorSettings, setCalculatorSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    image_url: "",
    printer_id: "",
    product_type_id: "",
    mode: "simple" as "simple" | "parts",
    components: [] as { id?: string, name: string, quantity_per_product: number, stock_quantity: number, materials: { filament_id: string, grams: number }[] }[],
    print_time_hours: 0,
    print_time_remaining_minutes: 0,
    base_cost: 0,
    sale_price: 0,
    stock_quantity: 0,
    is_active: true,
  });
  
  // Editor calculation state
  const [calcPreview, setCalcPreview] = useState<any>(null);
  const [pendingSnapshot, setPendingSnapshot] = useState<any>(null);

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

    const [prodRes, filRes, priRes, ptRes, setRes, compsRes] = await Promise.all([
      supabase.from("products").select("*, filaments(name, color)").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("filaments").select("*").eq("user_id", user.id).eq("is_active", true),
      supabase.from("printers").select("*").eq("user_id", user.id).eq("is_active", true),
      supabase.from("calculator_product_types").select("*").eq("user_id", user.id).eq("is_active", true),
      supabase.from("calculator_settings").select("*").eq("user_id", user.id).single(),
      supabase.from("product_components").select("*").eq("user_id", user.id).eq("is_active", true)
    ]);

    if (prodRes.error) setError(prodRes.error.message);
    else {
      // Attach components to products
      const allProducts = prodRes.data || [];
      const allComps = compsRes.data || [];
      
      const productsWithComps = allProducts.map(p => {
        const pComps = allComps.filter(c => c.product_id === p.id);
        return { ...p, product_components: pComps };
      });
      
      setProducts(productsWithComps);
    }
    
    if (!filRes.error) setFilaments(filRes.data || []);
    if (!priRes.error) setPrinters(priRes.data || []);
    if (!ptRes.error) setProductTypes(ptRes.data || []);
    if (!setRes.error) setCalculatorSettings(setRes.data || null);

    setLoading(false);
  };

  const handleCreateNew = () => {
    setFormData({
      name: "", description: "", image_url: "",
      printer_id: printers.length > 0 ? printers[0].id : "", product_type_id: productTypes.length > 0 ? productTypes[0].id : "",
      mode: "simple",
      components: [{ name: "Producto completo", quantity_per_product: 1, stock_quantity: 0, materials: [{ filament_id: filaments.length > 0 ? filaments[0].id : "", grams: 0 }] }],
      print_time_hours: 0, print_time_remaining_minutes: 0, base_cost: 0, sale_price: 0, stock_quantity: 0, is_active: true
    });
    setCalcPreview(null);
    setPendingSnapshot(null);
    setEditingId("new");
  };

  const handleEdit = async (p: any) => {
    const hours = Math.floor((p.print_time_minutes || 0) / 60);
    const mins = (p.print_time_minutes || 0) % 60;
    const snap = p.calculation_snapshot || {};
    
    // Fetch product components and materials
    let loadedComponents: any[] = [];
    let mode: "simple" | "parts" = "simple";

    const { data: compData } = await supabase.from("product_components").select("*").eq("product_id", p.id).eq("is_active", true).order("sort_order");
    
    if (compData && compData.length > 0) {
      if (compData.length > 1 || compData[0].name !== "Producto completo") {
        mode = "parts";
      }

      for (const comp of compData) {
        const { data: filData } = await supabase.from("product_component_filaments").select("*").eq("component_id", comp.id).order("sort_order");
        const mats = (filData || []).map(f => ({ filament_id: f.filament_id, grams: parseFloat(f.grams) }));
        
        loadedComponents.push({
          id: comp.id,
          name: comp.name,
          quantity_per_product: comp.quantity_per_product || 1,
          stock_quantity: comp.stock_quantity || 0,
          materials: mats
        });
      }
    }

    // Fallback if no components/materials found
    if (loadedComponents.length === 0) {
      let fallbackMats = [];
      if (p.filament_id) {
        fallbackMats = [{ filament_id: p.filament_id, grams: p.grams || 0 }];
      } else {
        fallbackMats = [{ filament_id: filaments.length > 0 ? filaments[0].id : "", grams: 0 }];
      }
      loadedComponents = [{
        name: "Producto completo",
        quantity_per_product: 1,
        stock_quantity: p.stock_quantity || 0,
        materials: fallbackMats
      }];
    }
    
    setFormData({
      name: p.name, description: p.description || "", image_url: p.image_url || "", 
      printer_id: p.printer_id || snap.printer_id || "",
      product_type_id: p.product_type_id || snap.product_type_id || "",
      mode,
      components: loadedComponents, 
      print_time_hours: hours, print_time_remaining_minutes: mins, base_cost: p.base_cost || 0, 
      sale_price: p.sale_price || 0, stock_quantity: p.stock_quantity || 0, is_active: p.is_active
    });
    setCalcPreview(null);
    setPendingSnapshot(snap);
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
      filament_id: p.filament_id, printer_id: p.printer_id, product_type_id: p.product_type_id,
      grams: p.grams, print_time_minutes: p.print_time_minutes, 
      base_cost: p.base_cost, sale_price: p.sale_price, stock_quantity: 0, 
      calculation_snapshot: p.calculation_snapshot, is_active: p.is_active
    };

    const { data, error } = await supabase.from("products").insert([payload]).select("*, filaments(name, color)").single();
    if (error) alert("Error: " + error.message);
    else if (data) setProducts([data, ...products]);
  };

  const handleSave = async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Validate components and materials
    let totalGrams = 0;
    let fallbackFilamentId: string | null = null;

    const compsToSave = formData.components.map(c => {
      const validMats = c.materials.filter(m => m.filament_id && m.grams > 0);
      const cGrams = validMats.reduce((acc, curr) => acc + (parseFloat(String(curr.grams)) || 0), 0);
      totalGrams += (cGrams * (parseFloat(String(c.quantity_per_product)) || 1));
      
      if (!fallbackFilamentId && validMats.length > 0) {
        fallbackFilamentId = validMats[0].filament_id;
      }
      return { ...c, validMats };
    }).filter(c => c.name.trim() !== "");

    const hours = Math.max(0, parseInt(String(formData.print_time_hours)) || 0);
    const mins = Math.max(0, Math.min(59, parseInt(String(formData.print_time_remaining_minutes)) || 0));
    const totalMinutes = (hours * 60) + mins;

    let snapshotToSave = pendingSnapshot;
    if (!snapshotToSave || Object.keys(snapshotToSave).length === 0) {
       snapshotToSave = null;
    }

    const payload: any = {
      name: formData.name,
      description: formData.description,
      image_url: formData.image_url,
      filament_id: fallbackFilamentId,
      printer_id: formData.printer_id || null,
      product_type_id: formData.product_type_id || null,
      grams: totalGrams,
      print_time_minutes: totalMinutes,
      base_cost: parseFloat(String(formData.base_cost)) || 0,
      sale_price: parseFloat(String(formData.sale_price)) || 0,
      stock_quantity: parseInt(String(formData.stock_quantity)) || 0,
      is_active: formData.is_active,
      user_id: user.id
    };

    if (snapshotToSave) {
      payload.calculation_snapshot = snapshotToSave;
      if (snapshotToSave.source === "product_editor") {
        payload.cost_updated_at = new Date().toISOString();
      }
    }

    let savedProductId = null;
    let savedProductData = null;

    if (editingId === "new") {
      const { data, error } = await supabase.from("products").insert([payload]).select("*, filaments(name, color)").single();
      if (error) { setError(error.message); return; }
      savedProductId = data.id;
      savedProductData = data;
    } else {
      const { data, error } = await supabase.from("products").update(payload).eq("id", editingId).select("*, filaments(name, color)").single();
      if (error) { setError(error.message); return; }
      savedProductId = data.id;
      savedProductData = data;
    }

    // Process components and materials if we have a valid product ID
    if (savedProductId) {
      // First, get all existing active components for this product
      const { data: existingComps } = await supabase.from("product_components").select("id").eq("product_id", savedProductId);
      
      const savedCompIds: string[] = [];
      
      for (let i = 0; i < compsToSave.length; i++) {
        const c = compsToSave[i];
        let compId = c.id;
        
        const compPayload = {
          user_id: user.id,
          product_id: savedProductId,
          name: formData.mode === "simple" ? "Producto completo" : c.name.trim(),
          quantity_per_product: formData.mode === "simple" ? 1 : (parseFloat(String(c.quantity_per_product)) || 1),
          stock_quantity: parseInt(String(c.stock_quantity)) || 0,
          sort_order: i,
          is_active: true
        };

        if (compId) {
          await supabase.from("product_components").update(compPayload).eq("id", compId);
        } else {
          const { data: newComp } = await supabase.from("product_components").insert([compPayload]).select("id").single();
          if (newComp) compId = newComp.id;
        }

        if (compId) {
          savedCompIds.push(compId);
          
          // Sync materials
          await supabase.from("product_component_filaments").delete().eq("component_id", compId);
          
          if (c.validMats.length > 0) {
            const matsToInsert = c.validMats.map((m, index) => ({
              user_id: user.id,
              component_id: compId,
              filament_id: m.filament_id,
              grams: m.grams,
              sort_order: index
            }));
            await supabase.from("product_component_filaments").insert(matsToInsert);
          }
        }
      }
      
      // Deactivate old components that were removed
      if (existingComps && existingComps.length > 0) {
        const toDeactivate = existingComps.filter(ec => !savedCompIds.includes(ec.id)).map(ec => ec.id);
        if (toDeactivate.length > 0) {
          await supabase.from("product_components").update({ is_active: false }).in("id", toDeactivate);
        }
      }
    }

    // Refresh local state
    if (editingId === "new") {
      setProducts([savedProductData, ...products]);
    } else {
      setProducts(products.map(p => p.id === editingId ? savedProductData : p));
    }
    setEditingId(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    let newValue: any = value;
    
    if (type === "checkbox") {
      newValue = (e.target as HTMLInputElement).checked;
    }
    
    setFormData(prev => ({ ...prev, [name]: newValue }));
    if (name === "printer_id" || name === "product_type_id" || name === "print_time_hours" || name === "print_time_remaining_minutes") {
      setCalcPreview(null);
    }
  };

  const handleComponentChange = (index: number, field: string, value: any) => {
    const newComps = [...formData.components];
    newComps[index] = { ...newComps[index], [field]: value };
    setFormData(prev => ({ ...prev, components: newComps }));
    setCalcPreview(null);
  };

  const addComponent = () => {
    setFormData(prev => ({
      ...prev,
      components: [...prev.components, { 
        name: "", 
        quantity_per_product: 1, 
        stock_quantity: 0, 
        materials: [{ filament_id: filaments.length > 0 ? filaments[0].id : "", grams: 0 }] 
      }]
    }));
  };

  const removeComponent = (index: number) => {
    const newComps = [...formData.components];
    newComps.splice(index, 1);
    setFormData(prev => ({ ...prev, components: newComps }));
    setCalcPreview(null);
  };

  const handleComponentMaterialChange = (compIndex: number, matIndex: number, field: string, value: any) => {
    const newComps = [...formData.components];
    const newMats = [...newComps[compIndex].materials];
    newMats[matIndex] = { ...newMats[matIndex], [field]: value };
    newComps[compIndex] = { ...newComps[compIndex], materials: newMats };
    setFormData(prev => ({ ...prev, components: newComps }));
    setCalcPreview(null);
  };

  const addComponentMaterial = (compIndex: number) => {
    const newComps = [...formData.components];
    newComps[compIndex] = {
      ...newComps[compIndex],
      materials: [...newComps[compIndex].materials, { filament_id: filaments.length > 0 ? filaments[0].id : "", grams: 0 }]
    };
    setFormData(prev => ({ ...prev, components: newComps }));
  };

  const removeComponentMaterial = (compIndex: number, matIndex: number) => {
    const newComps = [...formData.components];
    const newMats = [...newComps[compIndex].materials];
    newMats.splice(matIndex, 1);
    newComps[compIndex] = { ...newComps[compIndex], materials: newMats };
    setFormData(prev => ({ ...prev, components: newComps }));
    setCalcPreview(null);
  };

  const handleEditorCalculate = () => {
    const hours = Math.max(0, parseInt(String(formData.print_time_hours)) || 0);
    const mins = Math.max(0, Math.min(59, parseInt(String(formData.print_time_remaining_minutes)) || 0));
    const totalMinutes = (hours * 60) + mins;
    
    let hasValidComponents = false;
    let hasInvalidMaterials = false;
    
    const builtComponents = formData.components.map(c => {
      const validMats = c.materials.filter(m => m.filament_id && m.grams > 0);
      if (c.name.trim() !== "" && validMats.length > 0) hasValidComponents = true;
      
      const builtMats = validMats.map(m => {
        const fil = filaments.find(f => f.id === m.filament_id);
        if (!fil || fil.total_grams <= 0) hasInvalidMaterials = true;
        return { filament: fil, filament_id: m.filament_id, grams: m.grams };
      });
      return { ...c, materials: builtMats };
    });

    if (totalMinutes === 0 || !hasValidComponents || !formData.printer_id || !formData.product_type_id) {
      alert("Completá materiales, partes (con nombre y gramos), tiempo, impresora y tipo de producto para calcular.");
      return;
    }

    const printer = printers.find(p => p.id === formData.printer_id);
    const productType = productTypes.find(pt => pt.id === formData.product_type_id);

    if (hasInvalidMaterials) {
      alert("Un filamento seleccionado no es válido o no tiene gramos totales configurados.");
      return;
    }

    const result = calculateProductPrice({
      components: builtComponents,
      printTimeMinutes: totalMinutes,
      printer,
      productType,
      calculatorSettings,
      oldSnapshot: pendingSnapshot
    });

    setCalcPreview(result);
  };

  const applyEditorCalculation = () => {
    if (!calcPreview) return;
    setFormData(prev => ({
      ...prev,
      base_cost: parseFloat(calcPreview.baseCost.toFixed(2)),
      sale_price: parseFloat(calcPreview.salePrice.toFixed(2))
    }));
    setPendingSnapshot(calcPreview.snapshot);
    setCalcPreview(null);
  };

  const handleRecalculate = async (product: any) => {
    setRecalcProductId(product.id);
    setRecalcData(null);
    setRecalcError(null);
    setRecalcLoading(true);

    // Fetch product components and materials
    let loadedMaterials: { filament_id: string, grams: number }[] = [];
    const { data: compData } = await supabase.from("product_components").select("*").eq("product_id", product.id).eq("is_active", true).order("sort_order").limit(1);
    
    if (compData && compData.length > 0) {
      const compId = compData[0].id;
      const { data: filData } = await supabase.from("product_component_filaments").select("*").eq("component_id", compId).order("sort_order");
      if (filData && filData.length > 0) {
        loadedMaterials = filData.map(f => ({ filament_id: f.filament_id, grams: parseFloat(f.grams) }));
      }
    }

    // Fallback if no components/materials found
    if (loadedMaterials.length === 0) {
      if (product.filament_id) {
        loadedMaterials = [{ filament_id: product.filament_id, grams: product.grams || 0 }];
      }
    }

    // Resolve material instances
    const builtMaterials = loadedMaterials.map(m => {
      const fil = filaments.find(f => f.id === m.filament_id);
      return { filament: fil, filament_id: m.filament_id, grams: m.grams };
    });
    
    // Check snapshot for more context
    const snap = product.calculation_snapshot;
    const printerId = snap?.printer_id || product.printer_id || null;
    const productTypeId = snap?.product_type_id || product.product_type_id || null;
    
    const printer = printers.find(p => p.id === printerId);
    const productType = productTypes.find(pt => pt.id === productTypeId);

    // Fetch fresh settings just in case
    const { data: currentSettings } = await supabase
      .from("calculator_settings")
      .select("*")
      .eq("user_id", product.user_id)
      .single();

    const result = calculateProductPrice({
      materials: builtMaterials,
      printTimeMinutes: product.print_time_minutes || 0,
      printer,
      productType,
      calculatorSettings: currentSettings || calculatorSettings,
      oldSnapshot: snap,
    });

    if (result.baseCost <= 0) {
      setRecalcError("No hay suficiente información para recalcular. Asegurate de que el producto tenga filamento, impresora y tipo de producto configurados.");
      setRecalcLoading(false);
      return;
    }

    setRecalcData({
      currentSalePrice: product.sale_price || 0,
      recommendedSalePrice: parseFloat(result.salePrice.toFixed(2)),
      recommendedBaseCost: parseFloat(result.baseCost.toFixed(2)),
      breakdown: {
        materialCost: parseFloat(result.materialCost.toFixed(2)),
        energyCost: parseFloat(result.electricityCost.toFixed(2)),
        printerCost: parseFloat(result.maintenanceCost.toFixed(2)),
        fixedCost: parseFloat(result.fixedCost.toFixed(2)),
        laborCost: parseFloat(result.snapshot.labor_cost?.toFixed(2) || 0),
        otherCosts: parseFloat(result.snapshot.other_costs?.toFixed(2) || 0),
        multiplier: result.multiplier,
      },
      newSnapshot: result.snapshot
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
                <label className="block text-xs font-semibold text-gray-700 mb-1">Tiempo de Impresión</label>
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
            </div>

            {/* Mode selector */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-700 mb-2">Modo de composición</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="mode" 
                    value="simple" 
                    checked={formData.mode === "simple"} 
                    onChange={handleChange}
                    className="text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700">Producto simple</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="mode" 
                    value="parts" 
                    checked={formData.mode === "parts"} 
                    onChange={handleChange}
                    className="text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700">Producto por partes</span>
                </label>
              </div>
            </div>

            {/* Materiales y Partes del Producto */}
            <div className="mb-4 bg-gray-50/50 p-4 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-gray-900">
                  {formData.mode === "simple" ? "Materiales del producto" : "Partes del producto"}
                </h4>
                {formData.mode === "parts" && (
                  <button type="button" onClick={addComponent} className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1">
                    <Plus size={14} /> Agregar parte
                  </button>
                )}
              </div>
              
              <div className="space-y-4">
                {formData.components.map((comp, compIndex) => (
                  <div key={compIndex} className={`p-3 rounded-lg border ${formData.mode === "parts" ? 'bg-white border-gray-200' : 'border-transparent'}`}>
                    
                    {formData.mode === "parts" && (
                      <div className="flex items-start gap-2 mb-3">
                        <div className="flex-1 space-y-2">
                          <input 
                            type="text" 
                            value={comp.name} 
                            onChange={(e) => handleComponentChange(compIndex, "name", e.target.value)}
                            placeholder="Nombre de la parte (ej. Cuerpo)"
                            className="w-full text-sm font-medium border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500"
                          />
                          <div className="flex gap-2">
                            <label className="flex items-center gap-2 text-xs text-gray-600">
                              Cant. por producto:
                              <input 
                                type="number" min="1" 
                                value={comp.quantity_per_product} 
                                onChange={(e) => handleComponentChange(compIndex, "quantity_per_product", Math.max(1, parseInt(e.target.value) || 1))}
                                className="w-16 text-xs border-gray-300 rounded-md p-1"
                              />
                            </label>
                            <label className="flex items-center gap-2 text-xs text-gray-600">
                              Stock actual:
                              <input 
                                type="number" min="0" 
                                value={comp.stock_quantity} 
                                onChange={(e) => handleComponentChange(compIndex, "stock_quantity", Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-16 text-xs border-gray-300 rounded-md p-1"
                              />
                            </label>
                          </div>
                        </div>
                        {formData.components.length > 1 && (
                          <button type="button" onClick={() => removeComponent(compIndex)} className="text-red-400 hover:text-red-600 p-1 mt-1">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    )}

                    <div className="space-y-2">
                      {comp.materials.map((mat, matIndex) => (
                        <div key={matIndex} className="flex items-center gap-2">
                          <div className="flex-1">
                            <select 
                              value={mat.filament_id} 
                              onChange={(e) => handleComponentMaterialChange(compIndex, matIndex, "filament_id", e.target.value)} 
                              className="w-full text-xs border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white"
                            >
                              <option value="">Seleccionar filamento...</option>
                              {filaments.map(f => <option key={f.id} value={f.id}>{f.name} {f.color ? `(${f.color})` : ""}</option>)}
                            </select>
                          </div>
                          <div className="w-24 flex items-center gap-1">
                            <input 
                              type="number" 
                              min="0" step="0.1"
                              value={mat.grams} 
                              onChange={(e) => handleComponentMaterialChange(compIndex, matIndex, "grams", parseFloat(e.target.value) || 0)} 
                              className="w-full text-xs border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                              placeholder="Gramos"
                            />
                            <span className="text-xs text-gray-500">g</span>
                          </div>
                          <button type="button" onClick={() => removeComponentMaterial(compIndex, matIndex)} className="text-red-400 hover:text-red-600 p-1">
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                      
                      <button type="button" onClick={() => addComponentMaterial(compIndex)} className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1 mt-1">
                        <Plus size={12} /> Agregar material {formData.mode === "parts" && "a esta parte"}
                      </button>
                      
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Embedded Calculator */}
            <div className="mb-4 bg-gray-50/50 p-4 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <RefreshCw size={16} className="text-orange-500" />
                <h4 className="text-sm font-bold text-gray-900">Cálculo Rápido</h4>
                <p className="text-xs text-gray-500 ml-2 font-medium hidden sm:block">Calculá automáticamente usando tus costos.</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">Impresora</label>
                  <select name="printer_id" value={formData.printer_id} onChange={handleChange} className="w-full text-xs border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white">
                    <option value="">Seleccionar impresora...</option>
                    {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">Tipo de producto</label>
                  <select name="product_type_id" value={formData.product_type_id} onChange={handleChange} className="w-full text-xs border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white">
                    <option value="">Seleccionar tipo...</option>
                    {productTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button 
                  type="button" 
                  onClick={handleEditorCalculate}
                  className="bg-white border border-orange-200 text-orange-600 px-4 py-2 rounded-lg text-xs font-bold hover:bg-orange-50 transition-colors"
                >
                  Calcular precio
                </button>
                {calcPreview && (
                  <p className="text-[11px] text-gray-500 italic">Hay cambios sin aplicar.</p>
                )}
              </div>

              {calcPreview && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div className="bg-white p-2 rounded border border-gray-100 text-center">
                      <p className="text-[10px] text-gray-400">Material</p>
                      <p className="text-xs font-bold text-gray-700">${calcPreview.materialCost.toFixed(2)}</p>
                    </div>
                    <div className="bg-white p-2 rounded border border-gray-100 text-center">
                      <p className="text-[10px] text-gray-400">Electricidad</p>
                      <p className="text-xs font-bold text-gray-700">${calcPreview.electricityCost.toFixed(2)}</p>
                    </div>
                    <div className="bg-white p-2 rounded border border-gray-100 text-center">
                      <p className="text-[10px] text-gray-400">Mant+Fijo</p>
                      <p className="text-xs font-bold text-gray-700">${(calcPreview.maintenanceCost + calcPreview.fixedCost).toFixed(2)}</p>
                    </div>
                    <div className="bg-orange-50 p-2 rounded border border-orange-100 text-center">
                      <p className="text-[10px] text-orange-600 font-bold">Venta Sugerida (x{calcPreview.multiplier})</p>
                      <p className="text-sm font-black text-orange-700">${calcPreview.salePrice.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button 
                      type="button" 
                      onClick={applyEditorCalculation}
                      className="bg-orange-500 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-orange-600 transition-colors"
                    >
                      Usar precio sugerido
                    </button>
                  </div>
                </div>
              )}
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
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-gray-900">{p.name}</p>
                    {p.product_components?.length > 1 && (
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[9px] font-bold uppercase rounded-md">Por partes</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{p.description || "Sin descripción"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    {(() => {
                      const snapMats = p.calculation_snapshot?.materials;
                      if (snapMats && Array.isArray(snapMats) && snapMats.length > 0) {
                        if (snapMats.length === 1) {
                          const f = filaments.find(f => f.id === snapMats[0].filament_id);
                          return (
                            <>
                              {f && <div className="w-2.5 h-2.5 rounded-full border border-gray-300" style={{ backgroundColor: f.color || '#ccc' }}></div>}
                              <span className="truncate max-w-[80px]">{snapMats[0].filament_name || f?.name || "Filamento"}</span> ·
                            </>
                          );
                        } else {
                          return (
                            <>
                              <span className="truncate max-w-[120px] font-medium">{snapMats.length} materiales</span> ·
                            </>
                          );
                        }
                      } else if (filament) {
                        return (
                          <>
                            <div className="w-2.5 h-2.5 rounded-full border border-gray-300" style={{ backgroundColor: filament.color || '#ccc' }}></div>
                            <span className="truncate max-w-[80px]">{filament.name}</span> ·
                          </>
                        );
                      }
                      return null;
                    })()}
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
                  <p className="text-[10px] text-gray-400">Terminados</p>
                </div>
              </div>

              {/* Parts Details */}
              {p.product_components?.length > 1 && (
                <div className="mt-2 bg-blue-50/50 rounded-xl p-3 border border-blue-100">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-blue-900">Piezas requeridas</p>
                    <p className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                      Armables: {Math.min(...p.product_components.map((c: any) => Math.floor((c.stock_quantity || 0) / (c.quantity_per_product || 1)))) || 0}
                    </p>
                  </div>
                  <div className="space-y-1">
                    {p.product_components.map((c: any) => {
                      const needed = c.quantity_per_product || 1;
                      const hasStock = c.stock_quantity >= needed;
                      return (
                        <div key={c.id} className="flex justify-between items-center text-xs">
                          <span className="text-gray-600 truncate mr-2">{c.name}</span>
                          <span className={`font-medium ${hasStock ? 'text-gray-900' : 'text-red-500'}`}>
                            {c.stock_quantity || 0} / {needed}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
