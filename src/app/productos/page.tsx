"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Pencil, Copy, Trash2, Loader2, Save, X, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, History, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";
import { ColorSwatchLabel } from "@/components/ui/color-swatch-label";

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
        reasons.push("Cambió el markup del tipo de producto");
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
  const [detailProduct, setDetailProduct] = useState<any>(null);
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

  useEffect(() => {
    if (!loading && products.length > 0) {
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const editId = params.get("edit");
        if (editId && editingId !== editId) {
          const productToEdit = products.find(p => p.id === editId);
          if (productToEdit) {
            handleEdit(productToEdit);
            // Remove query param to prevent re-triggering
            window.history.replaceState({}, '', '/productos');
          }
        }
      }
    }
  }, [loading, products]);

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
          <div className="flex items-center gap-3">

            <PrimaryButton onClick={handleCreateNew} disabled={editingId !== null}>
              <Plus size={15} /> Nuevo producto
            </PrimaryButton>
          </div>
        }
      />

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {editingId && (
        <Card className="mb-8 p-5 bg-[#111] border border-orange-500/30 shadow-md ring-1 ring-orange-500/20">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-white">{editingId === "new" ? "Nuevo Producto" : "Editar Producto"}</h3>
            <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-300"><X size={20} /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Nombre</label>
              <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="Ej. Llavero personalizado" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Tiempo de Impresión</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">Horas</label>
                  <input type="number" name="print_time_hours" min="0" value={formData.print_time_hours} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">Minutos</label>
                  <input type="number" name="print_time_remaining_minutes" min="0" max="59" value={formData.print_time_remaining_minutes} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Mode selector */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-300 mb-2">Modo de composición</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="simple"
                  checked={formData.mode === "simple"}
                  onChange={handleChange}
                  className="text-[#ff6a00] focus:ring-[#ff6a00]/20"
                />
                <span className="text-sm text-gray-300">Producto simple</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="parts"
                  checked={formData.mode === "parts"}
                  onChange={handleChange}
                  className="text-[#ff6a00] focus:ring-[#ff6a00]/20"
                />
                <span className="text-sm text-gray-300">Producto por partes</span>
              </label>
            </div>
          </div>

          {/* Materiales y Partes del Producto */}
          <div className="mb-4 bg-[#0a0a0a]/50 p-4 rounded-xl border border-white/10 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-white">
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
                <div key={compIndex} className={`p-3 rounded-lg border ${formData.mode === "parts" ? 'bg-[#111] border-white/10' : 'border-transparent'}`}>

                  {formData.mode === "parts" && (
                    <div className="flex items-start gap-2 mb-3">
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={comp.name}
                          onChange={(e) => handleComponentChange(compIndex, "name", e.target.value)}
                          placeholder="Nombre de la parte (ej. Cuerpo)"
                          className="w-full text-sm font-medium border-white/20 rounded-md focus:border-orange-500 focus:ring-orange-500"
                        />
                        <div className="flex gap-2">
                          <label className="flex items-center gap-2 text-xs text-gray-400">
                            Cant. por producto:
                            <input
                              type="number" min="1"
                              value={comp.quantity_per_product}
                              onChange={(e) => handleComponentChange(compIndex, "quantity_per_product", Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-16 text-xs border-white/20 rounded-md p-1"
                            />
                          </label>
                          <label className="flex items-center gap-2 text-xs text-gray-400">
                            Stock actual:
                            <input
                              type="number" min="0"
                              value={comp.stock_quantity}
                              onChange={(e) => handleComponentChange(compIndex, "stock_quantity", Math.max(0, parseInt(e.target.value) || 0))}
                              className="w-16 text-xs border-white/20 rounded-md p-1"
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
                        <div className="flex-1 flex items-center gap-2">
                          {(() => {
                            const sel = filaments.find(f => f.id === mat.filament_id);
                            return sel ? (
                              <div className="shrink-0" title={sel.color || "Personalizado"}>
                                <ColorSwatchLabel color={sel.color} colorHex={sel.color_hex} size="sm" fallbackLabel="" />
                              </div>
                            ) : null;
                          })()}
                          <select
                            value={mat.filament_id}
                            onChange={(e) => handleComponentMaterialChange(compIndex, matIndex, "filament_id", e.target.value)}
                            className="w-full text-xs border-white/20 rounded-md focus:border-orange-500 focus:ring-orange-500 text-white bg-[#111]"
                          >
                            <option value="">Seleccionar filamento...</option>
                            {filaments.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                        </div>
                        <div className="w-24 flex items-center gap-1">
                          <input
                            type="number"
                            min="0" step="0.1"
                            value={mat.grams}
                            onChange={(e) => handleComponentMaterialChange(compIndex, matIndex, "grams", parseFloat(e.target.value) || 0)}
                            className="w-full text-xs border-white/20 rounded-md focus:border-orange-500 focus:ring-orange-500 text-white bg-[#111]"
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
          <div className="mb-4 bg-[#0a0a0a]/50 p-4 rounded-xl border border-white/10 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw size={16} className="text-orange-500" />
              <h4 className="text-sm font-bold text-white">Cálculo Rápido</h4>
              <p className="text-xs text-gray-500 ml-2 font-medium hidden sm:block">Calculá automáticamente usando tus costos.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-300 mb-1">Impresora</label>
                <select name="printer_id" value={formData.printer_id} onChange={handleChange} className="w-full text-xs border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500">
                  <option value="">Seleccionar impresora...</option>
                  {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-300 mb-1">Tipo de producto</label>
                <select name="product_type_id" value={formData.product_type_id} onChange={handleChange} className="w-full text-xs border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500">
                  <option value="">Seleccionar tipo...</option>
                  {productTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleEditorCalculate}
                className="bg-[#111] border border-orange-200 text-orange-600 px-4 py-2 rounded-lg text-xs font-bold hover:bg-orange-50 transition-colors"
              >
                Calcular precio
              </button>
              {calcPreview && (
                <p className="text-[11px] text-gray-500 italic">Hay cambios sin aplicar.</p>
              )}
            </div>

            {calcPreview && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <div className="bg-[#111] p-2 rounded border border-white/5 text-center">
                    <p className="text-[10px] text-gray-400">Material</p>
                    <p className="text-xs font-bold text-gray-300">${calcPreview.materialCost.toFixed(2)}</p>
                  </div>
                  <div className="bg-[#111] p-2 rounded border border-white/5 text-center">
                    <p className="text-[10px] text-gray-400">Electricidad</p>
                    <p className="text-xs font-bold text-gray-300">${calcPreview.electricityCost.toFixed(2)}</p>
                  </div>
                  <div className="bg-[#111] p-2 rounded border border-white/5 text-center">
                    <p className="text-[10px] text-gray-400">Mant+Fijo</p>
                    <p className="text-xs font-bold text-gray-300">${(calcPreview.maintenanceCost + calcPreview.fixedCost).toFixed(2)}</p>
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Costo Base ($)</label>
              <input type="number" name="base_cost" value={formData.base_cost} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Precio Venta ($)</label>
              <input type="number" name="sale_price" value={formData.sale_price} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Stock Actual</label>
              <input type="number" name="stock_quantity" value={formData.stock_quantity} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-gray-300">Imagen del Producto</label>
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
                <hr className="flex-1 border-white/10" />
                <span className="text-[10px] text-gray-400 font-semibold uppercase">O URL Externa</span>
                <hr className="flex-1 border-white/10" />
              </div>
              <div className="flex gap-4 items-center">
                <input type="text" name="image_url" value={formData.image_url} onChange={handleChange} className="flex-1 text-sm border-white/10 rounded-lg px-3 py-2 text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="https://..." />
                {formData.image_url && (
                  <div className="h-12 w-12 shrink-0 rounded-lg bg-white/5 overflow-hidden border border-white/10">
                    <img src={formData.image_url} alt="Producto" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Historial de precios */}
          {editingId !== "new" && historyProductId === editingId && (
            <div className="mb-4 border border-white/5 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2 text-xs font-bold text-gray-400">
                <History size={14} /> Historial de precios
              </div>
              {historyLoading ? (
                <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-gray-400" /></div>
              ) : priceHistory.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-2">Sin historial de cambios de precio.</p>
              ) : (
                <div className="space-y-1">
                  {priceHistory.map((h: any) => (
                    <div key={h.id} className="flex items-center justify-between text-xs text-gray-400 py-1 border-b border-gray-50">
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

          <div className="flex items-center justify-between border-t border-white/5 pt-4">
            <div className="flex items-center gap-2">
              <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-[#ff6a00] focus:ring-[#ff6a00]/20" />
              <label className="text-sm font-medium text-gray-300">Producto Activo</label>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm font-bold text-gray-400 hover:bg-white/5 rounded-lg transition-colors">Cancelar</button>
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
            <Card key={p.id} className={`p-4 transition-all bg-[#111] border border-white/10 hover:border-orange-500/30 hover:shadow-[0_0_15px_rgba(255,106,0,0.05)] flex flex-col h-full ${!p.is_active ? 'opacity-60 grayscale' : ''} ${pricingStatus.needsRecalculation ? 'border-yellow-500/50 bg-yellow-500/5 ring-1 ring-yellow-500/20' : ''}`}>

              {pricingStatus.needsRecalculation && (
                <div className="mb-3 flex items-start gap-2 bg-yellow-500/10 rounded-lg p-2.5 border border-yellow-500/20">
                  <AlertTriangle size={16} className="text-yellow-500 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-yellow-400 uppercase tracking-wide">Requiere Recalcular</p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="h-16 w-16 shrink-0 rounded-xl object-cover bg-[#0a0a0a] border border-white/5" />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[#0a0a0a] text-2xl select-none border border-white/5 text-gray-400">
                    📦
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="truncate text-base font-bold text-white leading-tight">{p.name}</p>
                    {p.product_components?.length > 1 ? (
                      <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase rounded-md border border-blue-500/20 shrink-0">Armable</span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-gray-800 text-gray-400 text-[10px] font-bold uppercase rounded-md border border-gray-700 shrink-0">Simple</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate mb-2">{p.description || "Sin descripción"}</p>
                  
                  <div className="flex items-end gap-4 mt-2">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-semibold">Venta</p>
                      <p className="text-sm font-black text-orange-500">${p.sale_price?.toFixed(2) || "0.00"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-semibold">Stock</p>
                      <p className={`text-sm font-bold ${p.stock_quantity > 0 ? 'text-white' : 'text-red-500'}`}>{p.stock_quantity || 0}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-4 flex gap-2">
                <button onClick={() => setDetailProduct(p)} className="flex-1 py-2 text-xs font-bold text-gray-300 bg-white/5 hover:bg-white/10 hover:text-white rounded-lg transition-colors border border-white/10">
                  Ver detalle
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleEdit(p); }} className="flex-1 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-500 rounded-lg transition-colors border border-orange-500 flex items-center justify-center gap-1.5">
                  <Pencil size={13} /> Editar
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {products.length === 0 && !editingId && (
        <div className="py-20 flex flex-col items-center justify-center bg-[#111] rounded-2xl border border-white/5 shadow-xl">
          <div className="w-16 h-16 bg-[#0a0a0a] rounded-2xl flex items-center justify-center mb-4 border border-white/10 shadow-inner">
            <span className="text-3xl grayscale opacity-50">📦</span>
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Todavía no cargaste productos</h3>
          <p className="text-sm text-gray-400 font-medium mb-6 max-w-md text-center">
            Guardá las piezas que vendés seguido para reutilizarlas en presupuestos y controlar mejor tus costos.
          </p>
          <div className="flex gap-3">
            <PrimaryButton onClick={handleCreateNew} className="bg-orange-500 hover:bg-orange-600 text-white">
              Crear producto
            </PrimaryButton>
            <Link href="/calculadora" className="px-4 py-2 bg-[#0a0a0a] border border-white/10 text-white text-sm font-bold rounded-lg hover:bg-white/5 transition-colors">
              Calcular precio primero
            </Link>
          </div>
        </div>
      )}

      {/* MODAL: RECALCULAR PRECIO */}
      {recalcProductId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-[#111] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <h3 className="font-bold text-white flex items-center gap-2">
                <RefreshCw size={18} className="text-indigo-500" /> Recalcular precio
              </h3>
              <button onClick={() => { setRecalcProductId(null); setRecalcData(null); setRecalcError(null); }} className="text-gray-400 hover:text-gray-300">
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
                    <button onClick={() => { setRecalcProductId(null); setRecalcError(null); }} className="px-4 py-2 text-sm font-bold text-gray-400 hover:bg-white/5 rounded-lg">Cerrar</button>
                  </div>
                </div>
              ) : recalcData ? (
                <div className="space-y-4">
                  {/* Comparison */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-[#0a0a0a] p-4 rounded-xl text-center border border-white/10">
                      <p className="text-[10px] text-gray-400 font-semibold uppercase mb-1">Precio Actual</p>
                      <p className="text-2xl font-black text-gray-300">${recalcData.currentSalePrice.toFixed(2)}</p>
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
                      <div className={`flex items-center justify-center gap-2 py-2 px-4 rounded-full text-sm font-bold ${isUp ? 'bg-yellow-50 text-yellow-500/90' : diff < 0 ? 'bg-green-50 text-green-700' : 'bg-[#0a0a0a] text-gray-500'}`}>
                        {isUp ? <TrendingUp size={16} /> : diff < 0 ? <TrendingDown size={16} /> : <Minus size={16} />}
                        {diff === 0 ? "El precio está al día" : `${isUp ? "Subida" : "Bajada"} de $${Math.abs(diff).toFixed(2)}`}
                      </div>
                    );
                  })()}

                  {/* Breakdown */}
                  <div className="bg-[#0a0a0a] p-3 rounded-xl text-xs space-y-1.5">
                    <p className="font-bold text-gray-300 mb-2">Detalle del nuevo cálculo</p>
                    {[
                      ["Material", recalcData.breakdown.materialCost],
                      ["Electricidad", recalcData.breakdown.energyCost],
                      ["Mantenimiento", recalcData.breakdown.printerCost],
                      ["Costo Fijo", recalcData.breakdown.fixedCost],
                      recalcData.breakdown.laborCost > 0 && ["Mano de obra", recalcData.breakdown.laborCost],
                    ].filter(Boolean).map(([label, val]: any) => (
                      <div key={label} className="flex justify-between text-gray-400">
                        <span>{label}</span>
                        <span className="font-semibold">${val.toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold text-white border-t border-white/10 pt-1.5 mt-1.5">
                      <span>Costo Base</span>
                      <span>${recalcData.recommendedBaseCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>Markup</span>
                      <span>×{recalcData.breakdown.multiplier}</span>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button onClick={() => { setRecalcProductId(null); setRecalcData(null); }} className="px-4 py-2 text-sm font-bold text-gray-400 hover:bg-white/5 rounded-lg">Cancelar</button>
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
      {/* MODAL: DETALLE DEL PRODUCTO */}
      {detailProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-[#0a0a0a] w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-white/10 my-8 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0 bg-[#111]">
              <h3 className="font-bold text-white text-lg flex items-center gap-2">
                Detalle del Producto
              </h3>
              <button onClick={() => setDetailProduct(null)} className="text-gray-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex flex-col sm:flex-row gap-6 mb-6">
                {detailProduct.image_url ? (
                  <img src={detailProduct.image_url} alt={detailProduct.name} className="h-32 w-32 shrink-0 rounded-xl object-cover bg-[#111] border border-white/10 shadow-lg" />
                ) : (
                  <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-xl bg-[#111] text-5xl select-none border border-white/10 text-gray-500 shadow-lg">
                    📦
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <h2 className="text-2xl font-black text-white leading-tight">{detailProduct.name}</h2>
                    {detailProduct.product_components?.length > 1 ? (
                      <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs font-bold uppercase rounded-md border border-blue-500/20 shrink-0">Armable</span>
                    ) : (
                      <span className="px-2 py-1 bg-gray-800 text-gray-400 text-xs font-bold uppercase rounded-md border border-gray-700 shrink-0">Simple</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mb-4">{detailProduct.description || "Sin descripción proporcionada."}</p>
                  
                  <div className="flex flex-wrap gap-4">
                    <div className="bg-[#111] px-4 py-2 rounded-xl border border-white/5">
                      <p className="text-[10px] text-gray-500 uppercase font-semibold mb-0.5">Stock Disponible</p>
                      <p className={`text-lg font-black ${detailProduct.stock_quantity > 0 ? 'text-white' : 'text-red-500'}`}>{detailProduct.stock_quantity || 0} u.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {/* Sección Precios */}
                <div className="bg-[#111] border border-white/5 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">💰 Valores</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Costo Base</span>
                      <span className="text-sm font-bold text-white">${detailProduct.base_cost?.toFixed(2) || "0.00"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Venta Sugerida/Actual</span>
                      <span className="text-sm font-black text-orange-500">${detailProduct.sale_price?.toFixed(2) || "0.00"}</span>
                    </div>
                    <hr className="border-white/5" />
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Ganancia</span>
                      {(() => {
                        const pProfit = (detailProduct.sale_price || 0) - (detailProduct.base_cost || 0);
                        return (
                          <span className={`text-sm font-bold ${pProfit > 0 ? 'text-emerald-500' : pProfit < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                            {pProfit > 0 ? '+' : ''}${pProfit.toFixed(2)}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Margen</span>
                      {(() => {
                        const pProfit = (detailProduct.sale_price || 0) - (detailProduct.base_cost || 0);
                        const margin = detailProduct.sale_price > 0 ? ((pProfit / detailProduct.sale_price) * 100) : 0;
                        return (
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${margin >= 30 ? 'bg-emerald-500/10 text-emerald-400' : margin >= 15 ? 'bg-yellow-500/10 text-yellow-500' : 'bg-red-500/10 text-red-400'}`}>
                            {margin.toFixed(0)}%
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* Sección Producción */}
                <div className="bg-[#111] border border-white/5 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">⚙️ Producción</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Material total</span>
                      <span className="text-sm font-bold text-white">{detailProduct.grams || 0}g</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Tiempo de impresión</span>
                      <span className="text-sm font-bold text-white">{formatTime(detailProduct.print_time_minutes)}</span>
                    </div>
                    <hr className="border-white/5" />
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">Materiales (Snapshot)</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(() => {
                          const snapMats = detailProduct.calculation_snapshot?.materials;
                          if (snapMats && Array.isArray(snapMats) && snapMats.length > 0) {
                            return snapMats.map((m: any, i: number) => (
                              <span key={i} className="text-[10px] bg-white/5 border border-white/10 px-2 py-1 rounded text-gray-300 truncate max-w-full">
                                {m.filament_name} ({m.grams}g)
                              </span>
                            ));
                          }
                          return <span className="text-[10px] text-gray-600">No especificado</span>;
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sección Partes/Componentes */}
              {detailProduct.product_components?.length > 1 && (
                <div className="bg-[#111] border border-white/5 rounded-xl p-4 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-bold text-gray-300 flex items-center gap-2">🧩 Componentes Requeridos</h4>
                    <p className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/20">
                      Capacidad: {Math.min(...detailProduct.product_components.map((c: any) => Math.floor((c.stock_quantity || 0) / (c.quantity_per_product || 1)))) || 0} sets
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    {detailProduct.product_components.map((c: any) => {
                      const needed = c.quantity_per_product || 1;
                      const hasStock = c.stock_quantity >= needed;
                      return (
                        <div key={c.id} className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-[#0a0a0a] p-3 rounded-lg border border-white/5 gap-2">
                          <div>
                            <p className="text-xs font-bold text-gray-200">{c.name}</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">{c.grams || 0}g · {formatTime(c.print_time_minutes)}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="text-[10px] text-gray-500 uppercase">Req.</p>
                              <p className="text-sm font-bold text-white">x{needed}</p>
                            </div>
                            <div className="h-6 w-px bg-white/10 mx-1"></div>
                            <div className="text-right">
                              <p className="text-[10px] text-gray-500 uppercase">Stock</p>
                              <p className={`text-sm font-bold ${hasStock ? 'text-emerald-500' : 'text-red-500'}`}>{c.stock_quantity || 0}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-white/10 shrink-0 bg-[#111] flex justify-end gap-3">
              <button onClick={() => setDetailProduct(null)} className="px-4 py-2 text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                Cerrar
              </button>
              <button 
                onClick={() => {
                  handleEdit(detailProduct);
                  setDetailProduct(null);
                }} 
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-colors border border-orange-500"
              >
                <Pencil size={15} /> Editar Producto
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
