"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Plus, Pencil, Copy, Trash2, Loader2, Save, X, AlertCircle, RefreshCw, DollarSign, ChevronDown, ChevronUp, History, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";
import { ColorSwatchLabel } from "@/components/ui/color-swatch-label";
import { ProductsPageSkeleton } from "@/components/ui/page-skeletons";
import {
  deleteProductAction,
  recalculateAllProductPricesAction,
  recalculateProductPriceAction,
} from "./actions";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { calculateProductPrice } from "@/lib/products/pricing";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";

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

function RecalculatePriceIcon({ loading = false, size = 18 }: { loading?: boolean; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden="true">
      <RefreshCw size={size} className={loading ? "animate-spin" : ""} />
      {!loading && <DollarSign size={Math.max(9, Math.round(size * 0.55))} strokeWidth={3} className="absolute" />}
    </span>
  );
}

function ProductosPageContent() {
  const { toast, confirmAction } = useAppFeedback();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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

  const [recalculatingProductId, setRecalculatingProductId] = useState<string | null>(null);
  const [recalculatingAll, setRecalculatingAll] = useState(false);

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
      supabase.from("products").select("*, filaments(name, color)").eq("user_id", user.id).eq("is_active", true).order("created_at", { ascending: false }),
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



  // Stampy Prefill Effect
  useEffect(() => {
    if (loading) return;
    const action = searchParams.get("action");
    if (action === "new") {
      handleCreateNew();
      router.replace("/productos");
    }
  }, [searchParams, loading, router]);

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

  const handleDelete = async () => {
    if (!deleteTarget || deleteLoading) return;
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const result = await deleteProductAction(deleteTarget.id);
      if (!result.success) {
        setDeleteError(result.error);
        return;
      }

      setProducts((current) => current.filter((product) => product.id !== deleteTarget.id));
      if (detailProduct?.id === deleteTarget.id) setDetailProduct(null);
      if (editingId === deleteTarget.id) setEditingId(null);
      setSuccessMessage("Producto eliminado.");
      setDeleteTarget(null);
      window.setTimeout(() => setSuccessMessage(null), 3_000);
    } catch {
      setDeleteError("No se pudo eliminar el producto. Probá nuevamente.");
    } finally {
      setDeleteLoading(false);
    }
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
    if (error) toast.error("Error: " + error.message);
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
      toast.error("Completá materiales, partes (con nombre y gramos), tiempo, impresora y tipo de producto para calcular.");
      return;
    }

    const printer = printers.find(p => p.id === formData.printer_id);
    const productType = productTypes.find(pt => pt.id === formData.product_type_id);

    if (hasInvalidMaterials) {
      toast.error("Un filamento seleccionado no es válido o no tiene gramos totales configurados.");
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

  const applyRecalculatedProducts = (updates: any[]) => {
    const byId = new Map(updates.map((product) => [product.id, product]));
    setProducts((current) => current.map((product) => (
      byId.has(product.id) ? { ...product, ...byId.get(product.id) } : product
    )));
    setDetailProduct((current: any) => (
      current && byId.has(current.id) ? { ...current, ...byId.get(current.id) } : current
    ));
  };

  const handleRecalculateProduct = async (productId: string) => {
    if (recalculatingProductId || recalculatingAll) return;
    setRecalculatingProductId(productId);
    try {
      const result = await recalculateProductPriceAction(productId);
      if (!result.success || !("product" in result)) {
        toast.error(result.error || "No se pudo recalcular el producto.");
        return;
      }
      applyRecalculatedProducts([result.product]);
      toast.success("Precio recalculado correctamente.");
    } catch {
      toast.error("No se pudo recalcular el producto. Probá nuevamente.");
    } finally {
      setRecalculatingProductId(null);
    }
  };

  const handleRecalculateAll = async () => {
    if (recalculatingAll || recalculatingProductId) return;
    const confirmed = await confirmAction({
      title: "¿Recalcular todos los productos?",
      description: "Se actualizarán los precios usando los costos y configuraciones actuales.",
      confirmLabel: "Recalcular todos",
    });
    if (!confirmed) return;

    setRecalculatingAll(true);
    try {
      const result = await recalculateAllProductPricesAction();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      applyRecalculatedProducts(result.updatedProducts);
      if (result.total === 0) {
        toast.info("No hay productos para recalcular.");
      } else if (result.failed === 0) {
        toast.success(`${result.succeeded} productos recalculados correctamente.`);
      } else {
        toast.error(`No se pudieron recalcular ${result.failed} de ${result.total} productos.`);
      }
    } catch {
      toast.error("No se pudieron recalcular los productos. Probá nuevamente.");
    } finally {
      setRecalculatingAll(false);
    }
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

  const stampyScreenContext = useMemo<StampyScreenContext>(() => {
    const editingProduct = editingId && editingId !== "new"
      ? products.find((product) => product.id === editingId)
      : null;
    const historyProduct = historyProductId
      ? products.find((product) => product.id === historyProductId)
      : null;
    const selectedProduct = detailProduct ?? editingProduct ?? historyProduct
      ?? (deleteTarget ? products.find((product) => product.id === deleteTarget.id) : null);
    const detailPricingStatus = detailProduct
      ? getProductPricingStatus(detailProduct, filaments, printers, productTypes)
      : null;
    const detailProfit = detailProduct
      ? Number(detailProduct.sale_price || 0) - Number(detailProduct.base_cost || 0)
      : 0;
    const mode = editingId === "new"
      ? "create"
      : editingId
        ? "edit"
        : detailProduct
          ? "detail"
          : historyProductId
            ? "price_history"
            : deleteTarget
              ? "delete_confirmation"
              : "browse";

    return {
      page: { section: "products", route: "/productos", title: "Productos" },
      mode,
      selectedEntity: selectedProduct ? {
        type: "product",
        id: String(selectedProduct.id),
        name: selectedProduct.name,
        facts: detailProduct ? [
          { label: "Stock visible", value: Number(detailProduct.stock_quantity || 0) },
          { label: "Costo base visible", value: Number(detailProduct.base_cost || 0) },
          { label: "Precio de venta visible", value: Number(detailProduct.sale_price || 0) },
          { label: "Ganancia visible", value: detailProfit },
          { label: "Margen visible en porcentaje", value: detailProduct.sale_price > 0 ? (detailProfit / detailProduct.sale_price) * 100 : 0 },
          { label: "Composición", value: detailProduct.product_components?.length > 1 ? "Por partes" : "Simple" },
          { label: "Cantidad de componentes visibles", value: detailProduct.product_components?.length || 0 },
          { label: "Estado de precio", value: detailPricingStatus?.needsRecalculation ? "Requiere recálculo" : "Actualizado" },
        ] : editingProduct ? [
          { label: "Estado visible", value: "En edición" },
        ] : [],
      } : null,
      visibleEntities: products.slice(0, 20).map((product, index) => {
        const pricingStatus = getProductPricingStatus(product, filaments, printers, productTypes);
        return {
          type: "product",
          id: String(product.id),
          name: product.name,
          position: index + 1,
          facts: [
            { label: "Stock visible", value: Number(product.stock_quantity || 0) },
            { label: "Precio de venta visible", value: Number(product.sale_price || 0) },
            { label: "Estado de precio", value: pricingStatus.needsRecalculation ? "Requiere recálculo" : "Actualizado" },
          ],
        };
      }),
      formState: editingId ? {
        kind: "formDraft",
        formType: editingId === "new" ? "Nuevo producto" : "Edición de producto",
        fields: [
          { label: "Nombre ingresado", value: formData.name },
          { label: "Composición elegida", value: formData.mode === "parts" ? "Por partes" : "Simple" },
          { label: "Impresora elegida", value: printers.find((printer) => printer.id === formData.printer_id)?.name ?? "Sin seleccionar" },
          { label: "Tipo de producto elegido", value: productTypes.find((type) => type.id === formData.product_type_id)?.name ?? "Sin seleccionar" },
          { label: "Horas ingresadas", value: Number(formData.print_time_hours || 0) },
          { label: "Minutos ingresados", value: Number(formData.print_time_remaining_minutes || 0) },
          { label: "Costo base visible", value: Number(formData.base_cost || 0) },
          { label: "Precio de venta ingresado", value: Number(formData.sale_price || 0) },
          { label: "Stock ingresado", value: Number(formData.stock_quantity || 0) },
        ],
        items: formData.components.slice(0, 20).map((component, index) => ({
          type: "product_component_draft",
          id: component.id ?? `draft-component-${index + 1}`,
          name: component.name || `Parte ${index + 1}`,
          position: index + 1,
          facts: [
            { label: "Cantidad por producto", value: Number(component.quantity_per_product || 0) },
            { label: "Materiales cargados", value: component.materials.length },
          ],
        })),
      } : null,
      pageData: {
        kind: "pageFacts",
        facts: [
          { label: "Productos visibles", value: products.length },
          {
            label: "Productos que muestran recálculo pendiente",
            value: products.filter((product) => getProductPricingStatus(product, filaments, printers, productTypes).needsRecalculation).length,
          },
        ],
      },
      uiState: {
        loading,
        ...(editingId ? { activeDialog: editingId === "new" ? "Nuevo producto" : "Editar producto" } : {}),
        ...(detailProduct ? { activeDialog: "Detalle de producto" } : {}),
        ...(historyProductId ? { activeDialog: "Historial de precios" } : {}),
        ...(deleteTarget ? { activeDialog: "Confirmar eliminación" } : {}),
      },
    };
  }, [deleteTarget, detailProduct, editingId, filaments, formData, historyProductId, loading, printers, productTypes, products]);

  usePublishStampyScreenContext(stampyScreenContext);

  if (loading) return <ProductsPageSkeleton />;

  return (
    <div className="pb-24">
      <SectionTitle
        eyebrow="Mi taller"
        title="Productos"
        action={
          <div className="flex w-full flex-col gap-2 min-[390px]:flex-row sm:w-auto sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => void handleRecalculateAll()}
              disabled={recalculatingAll || recalculatingProductId !== null || products.length === 0}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 text-sm font-bold text-emerald-300 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
            >
              <RecalculatePriceIcon loading={recalculatingAll} size={17} />
              {recalculatingAll ? "Recalculando…" : "Recalcular Todos"}
            </button>
            <PrimaryButton className="min-h-11 flex-1 sm:flex-none" onClick={handleCreateNew} disabled={editingId !== null || recalculatingAll}>
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

      {successMessage && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          <CheckCircle2 size={16} /> {successMessage}
        </div>
      )}

      {editingId && (
        <Card className="mb-8 p-5 bg-stampa-surface border border-stampa-orange/30 shadow-md ring-1 ring-stampa-orange/20">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-white">{editingId === "new" ? "Nuevo Producto" : "Editar Producto"}</h3>
            <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-300"><X size={20} /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Nombre</label>
              <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="Ej. Llavero personalizado" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Tiempo de Impresión</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">Horas</label>
                  <input type="number" name="print_time_hours" min="0" value={formData.print_time_hours} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">Minutos</label>
                  <input type="number" name="print_time_remaining_minutes" min="0" max="59" value={formData.print_time_remaining_minutes} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
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
                  className="text-stampa-orange focus:ring-[#ff6a00]/20"
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
                  className="text-stampa-orange focus:ring-[#ff6a00]/20"
                />
                <span className="text-sm text-gray-300">Producto por partes</span>
              </label>
            </div>
          </div>

          {/* Materiales y Partes del Producto */}
          <div className="mb-4 bg-stampa-bg-soft/50 p-4 rounded-xl border border-stampa-border shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-white">
                {formData.mode === "simple" ? "Materiales del producto" : "Partes del producto"}
              </h4>
              {formData.mode === "parts" && (
                <button type="button" onClick={addComponent} className="text-xs font-bold text-stampa-orange hover:text-orange-700 flex items-center gap-1">
                  <Plus size={14} /> Agregar parte
                </button>
              )}
            </div>

            <div className="space-y-4">
              {formData.components.map((comp, compIndex) => (
                <div key={compIndex} className={`p-3 rounded-lg border ${formData.mode === "parts" ? 'bg-stampa-surface border-stampa-border' : 'border-transparent'}`}>

                  {formData.mode === "parts" && (
                    <div className="flex items-start gap-2 mb-3">
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={comp.name}
                          onChange={(e) => handleComponentChange(compIndex, "name", e.target.value)}
                          placeholder="Nombre de la parte (ej. Cuerpo)"
                          className="w-full text-sm font-medium border-white/20 rounded-md focus:border-stampa-orange focus:ring-stampa-orange"
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
                            className="w-full text-xs border-white/20 rounded-md focus:border-stampa-orange focus:ring-stampa-orange text-white bg-stampa-surface"
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
                            className="w-full text-xs border-white/20 rounded-md focus:border-stampa-orange focus:ring-stampa-orange text-white bg-stampa-surface"
                            placeholder="Gramos"
                          />
                          <span className="text-xs text-gray-500">g</span>
                        </div>
                        <button type="button" onClick={() => removeComponentMaterial(compIndex, matIndex)} className="text-red-400 hover:text-red-600 p-1">
                          <X size={16} />
                        </button>
                      </div>
                    ))}

                    <button type="button" onClick={() => addComponentMaterial(compIndex)} className="text-xs font-bold text-stampa-orange hover:text-orange-700 flex items-center gap-1 mt-1">
                      <Plus size={12} /> Agregar material {formData.mode === "parts" && "a esta parte"}
                    </button>

                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Embedded Calculator */}
          <div className="mb-4 bg-stampa-bg-soft/50 p-4 rounded-xl border border-stampa-border shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw size={16} className="text-stampa-orange" />
              <h4 className="text-sm font-bold text-white">Cálculo Rápido</h4>
              <p className="text-xs text-gray-500 ml-2 font-medium hidden sm:block">Calculá automáticamente usando tus costos.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-300 mb-1">Impresora</label>
                <select name="printer_id" value={formData.printer_id} onChange={handleChange} className="w-full text-xs border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500">
                  <option value="">Seleccionar impresora...</option>
                  {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-300 mb-1">Tipo de producto</label>
                <select name="product_type_id" value={formData.product_type_id} onChange={handleChange} className="w-full text-xs border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500">
                  <option value="">Seleccionar tipo...</option>
                  {productTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleEditorCalculate}
                className="bg-stampa-surface border border-orange-200 text-stampa-orange px-4 py-2 rounded-lg text-xs font-bold hover:bg-orange-50 transition-colors"
              >
                Calcular precio
              </button>
              {calcPreview && (
                <p className="text-[11px] text-gray-500 italic">Hay cambios sin aplicar.</p>
              )}
            </div>

            {calcPreview && (
              <div className="mt-4 pt-4 border-t border-stampa-border">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <div className="bg-stampa-surface p-2 rounded border border-stampa-border text-center">
                    <p className="text-[10px] text-gray-400">Material</p>
                    <p className="text-xs font-bold text-gray-300">${calcPreview.materialCost.toFixed(2)}</p>
                  </div>
                  <div className="bg-stampa-surface p-2 rounded border border-stampa-border text-center">
                    <p className="text-[10px] text-gray-400">Electricidad</p>
                    <p className="text-xs font-bold text-gray-300">${calcPreview.electricityCost.toFixed(2)}</p>
                  </div>
                  <div className="bg-stampa-surface p-2 rounded border border-stampa-border text-center">
                    <p className="text-[10px] text-gray-400">Mant+Fijo</p>
                    <p className="text-xs font-bold text-gray-300">${(calcPreview.maintenanceCost + calcPreview.fixedCost).toFixed(2)}</p>
                  </div>
                  <div className="bg-orange-50 p-2 rounded border border-orange-100 text-center">
                    <p className="text-[10px] text-stampa-orange font-bold">Venta Sugerida (x{calcPreview.multiplier})</p>
                    <p className="text-sm font-black text-orange-700">${calcPreview.salePrice.toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={applyEditorCalculation}
                    className="bg-stampa-orange text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-stampa-orange transition-colors"
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
              <input type="number" name="base_cost" value={formData.base_cost} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Precio Venta ($)</label>
              <input type="number" name="sale_price" value={formData.sale_price} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Stock Actual</label>
              <input type="number" name="stock_quantity" value={formData.stock_quantity} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-gray-300">Imagen del Producto</label>
            <div className="space-y-3 mt-1">
              <FileUploadDropzone
                bucket="product-images"
                pathPrefix={`${userId || "default"}/products`}
                accept=".jpg,.jpeg,.png,.webp"
                publicBucket={true}
                imageEditor={{
                  aspectRatio: 1,
                  outputWidth: 1000,
                  outputHeight: 1000,
                  quality: 0.9,
                  outputType: "preserve",
                }}
                onUploaded={(url) => setFormData(prev => ({ ...prev, image_url: url }))}
                label="Subir Imagen"
              />
              <div className="flex items-center gap-2">
                <hr className="flex-1 border-stampa-border" />
                <span className="text-[10px] text-gray-400 font-semibold uppercase">O URL Externa</span>
                <hr className="flex-1 border-stampa-border" />
              </div>
              <div className="flex gap-4 items-center">
                <input type="text" name="image_url" value={formData.image_url} onChange={handleChange} className="flex-1 text-sm border-stampa-border rounded-lg px-3 py-2 text-neutral-100 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="https://..." />
                {formData.image_url && (
                  <div className="h-12 w-12 shrink-0 rounded-lg bg-white/5 overflow-hidden border border-stampa-border">
                    <img src={formData.image_url} alt="Producto" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Historial de precios */}
          {editingId !== "new" && historyProductId === editingId && (
            <div className="mb-4 border border-stampa-border rounded-xl p-3">
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

          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-stampa-border pt-4 gap-4">
            <div className="flex items-center gap-2">
              <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-stampa-orange focus:ring-[#ff6a00]/20" />
              <label className="text-sm font-medium text-gray-300">Producto Activo</label>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
              <button onClick={() => setEditingId(null)} className="w-full sm:w-auto px-4 py-2 text-sm font-bold text-gray-400 hover:bg-white/5 rounded-lg transition-colors text-center">Cancelar</button>
              <button onClick={handleSave} className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 text-sm font-bold bg-stampa-orange hover:bg-stampa-orange text-white rounded-lg transition-colors">
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
            <Card key={p.id} className={`p-4 transition-all bg-stampa-surface border border-stampa-border hover:border-stampa-orange/30 hover:shadow-[0_0_15px_rgba(255,106,0,0.05)] flex flex-col h-full ${!p.is_active ? 'opacity-60 grayscale' : ''} ${pricingStatus.needsRecalculation ? 'border-yellow-500/50 bg-yellow-500/5 ring-1 ring-yellow-500/20' : ''}`}>

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
                  <img src={p.image_url} alt={p.name} className="h-16 w-16 shrink-0 rounded-xl object-cover bg-stampa-bg-soft border border-stampa-border" />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-stampa-bg-soft text-2xl select-none border border-stampa-border text-gray-400">
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
                      <p className="text-sm font-black text-stampa-orange">${p.sale_price?.toFixed(2) || "0.00"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-semibold">Stock</p>
                      <p className={`text-sm font-bold ${p.stock_quantity > 0 ? 'text-white' : 'text-red-500'}`}>{p.stock_quantity || 0}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-auto flex gap-2 pt-4">
                <button onClick={() => setDetailProduct(p)} className="min-h-11 flex-1 rounded-lg border border-stampa-border bg-white/5 px-2 py-2 text-xs font-bold text-gray-300 transition-colors hover:bg-white/10 hover:text-white">
                  Ver detalle
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleEdit(p); }} className="min-h-11 flex-1 rounded-lg border border-stampa-orange bg-stampa-orange px-2 py-2 text-xs font-bold text-white transition-colors hover:bg-stampa-orange flex items-center justify-center gap-1.5">
                  <Pencil size={13} /> Editar
                </button>
                <button
                  type="button"
                  onClick={() => void handleRecalculateProduct(p.id)}
                  disabled={recalculatingAll || recalculatingProductId !== null}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-emerald-300 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`Recalcular precio de ${p.name}`}
                  title="Recalcular precio"
                >
                  <RecalculatePriceIcon loading={recalculatingProductId === p.id} size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget({ id: p.id, name: p.name });
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-red-500/25 bg-red-500/10 text-red-300 transition-colors hover:border-red-500/40 hover:bg-red-500/20"
                  aria-label={`Eliminar ${p.name}`}
                  title="Eliminar producto"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {products.length === 0 && !editingId && (
        <div className="py-20 flex flex-col items-center justify-center bg-stampa-surface rounded-2xl border border-stampa-border shadow-xl">
          <div className="w-16 h-16 bg-stampa-bg-soft rounded-2xl flex items-center justify-center mb-4 border border-stampa-border shadow-inner">
            <span className="text-3xl grayscale opacity-50">📦</span>
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Todavía no cargaste productos</h3>
          <p className="text-sm text-gray-400 font-medium mb-6 max-w-md text-center">
            Guardá las piezas que vendés seguido para reutilizarlas en presupuestos y controlar mejor tus costos.
          </p>
          <div className="flex gap-3">
            <PrimaryButton onClick={handleCreateNew} className="bg-stampa-orange hover:bg-stampa-orange text-white">
              Crear producto
            </PrimaryButton>
            <Link href="/calculadora" className="px-4 py-2 bg-stampa-bg-soft border border-stampa-border text-white text-sm font-bold rounded-lg hover:bg-white/5 transition-colors">
              Calcular precio primero
            </Link>
          </div>
        </div>
      )}

      {/* MODAL: ELIMINAR PRODUCTO */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stampa-bg/70 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-product-title"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-red-500/20 bg-stampa-surface shadow-2xl"
          >
            <div className="flex items-start gap-3 border-b border-stampa-border p-5 sm:p-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-300">
                <Trash2 size={19} />
              </div>
              <div className="min-w-0">
                <h2 id="delete-product-title" className="text-lg font-bold text-white">¿Eliminar producto?</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Esta acción eliminará <span className="font-semibold text-gray-200">{deleteTarget.name}</span> y su receta asociada. No se puede deshacer desde la plataforma.
                </p>
              </div>
            </div>

            <div className="p-5 sm:p-6">
              {deleteError && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteError(null);
                  }}
                  disabled={deleteLoading}
                  className="min-h-11 rounded-xl border border-stampa-border px-4 py-2.5 text-sm font-bold text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50 sm:min-w-28"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteLoading}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-40"
                >
                  {deleteLoading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  {deleteLoading ? "Eliminando..." : "Eliminar producto"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DETALLE DEL PRODUCTO */}
      {detailProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stampa-bg/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-stampa-bg-soft w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-stampa-border my-8 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stampa-border shrink-0 bg-stampa-surface">
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
                  <img src={detailProduct.image_url} alt={detailProduct.name} className="h-32 w-32 shrink-0 rounded-xl object-cover bg-stampa-surface border border-stampa-border shadow-lg" />
                ) : (
                  <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-xl bg-stampa-surface text-5xl select-none border border-stampa-border text-gray-500 shadow-lg">
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
                    <div className="bg-stampa-surface px-4 py-2 rounded-xl border border-stampa-border">
                      <p className="text-[10px] text-gray-500 uppercase font-semibold mb-0.5">Stock Disponible</p>
                      <p className={`text-lg font-black ${detailProduct.stock_quantity > 0 ? 'text-white' : 'text-red-500'}`}>{detailProduct.stock_quantity || 0} u.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {/* Sección Precios */}
                <div className="bg-stampa-surface border border-stampa-border rounded-xl p-4">
                  <h4 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">💰 Valores</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Costo Base</span>
                      <span className="text-sm font-bold text-white">${detailProduct.base_cost?.toFixed(2) || "0.00"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Venta Sugerida/Actual</span>
                      <span className="text-sm font-black text-stampa-orange">${detailProduct.sale_price?.toFixed(2) || "0.00"}</span>
                    </div>
                    <hr className="border-stampa-border" />
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
                <div className="bg-stampa-surface border border-stampa-border rounded-xl p-4">
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
                    <hr className="border-stampa-border" />
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">Materiales (Snapshot)</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(() => {
                          const snapMats = detailProduct.calculation_snapshot?.materials;
                          if (snapMats && Array.isArray(snapMats) && snapMats.length > 0) {
                            return snapMats.map((m: any, i: number) => (
                              <span key={i} className="text-[10px] bg-white/5 border border-stampa-border px-2 py-1 rounded text-gray-300 truncate max-w-full">
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
                <div className="bg-stampa-surface border border-stampa-border rounded-xl p-4 mb-6">
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
                        <div key={c.id} className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-stampa-bg-soft p-3 rounded-lg border border-stampa-border gap-2">
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

            <div className="px-6 py-4 border-t border-stampa-border shrink-0 bg-stampa-surface flex justify-end gap-3">
              <button onClick={() => setDetailProduct(null)} className="px-4 py-2 text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                Cerrar
              </button>
              <button 
                onClick={() => {
                  handleEdit(detailProduct);
                  setDetailProduct(null);
                }} 
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-stampa-orange hover:bg-stampa-orange text-white rounded-lg transition-colors border border-stampa-orange"
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

export default function ProductosPage() {
  return (
    <React.Suspense fallback={<ProductsPageSkeleton />}>
      <ProductosPageContent />
    </React.Suspense>
  );
}
