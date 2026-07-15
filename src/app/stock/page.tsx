"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Plus, Minus, Loader2, Package, Box, History, X, Edit2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrimaryButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";

export default function StockPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<"productos" | "filamentos">("productos");
  
  const [products, setProducts] = useState<any[]>([]);
  const [filaments, setFilaments] = useState<any[]>([]);
  const [productComponents, setProductComponents] = useState<any[]>([]);
  const [componentFilaments, setComponentFilaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stock Adjustment States for Filaments
  const [filamentAdjustAmounts, setFilamentAdjustAmounts] = useState<Record<string, string>>({});
  const [adjustingFilament, setAdjustingFilament] = useState<string | null>(null);

  // Stock Adjustment States for Products
  const [productAdjustAmounts, setProductAdjustAmounts] = useState<Record<string, string>>({});
  const [adjustingProduct, setAdjustingProduct] = useState<string | null>(null);

  // History Modal States
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyFilamentId, setHistoryFilamentId] = useState<string | null>(null);
  const [historyMovements, setHistoryMovements] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [historyProductModalOpen, setHistoryProductModalOpen] = useState(false);
  const [historyProductId, setHistoryProductId] = useState<string | null>(null);
  const [historyProductMovements, setHistoryProductMovements] = useState<any[]>([]);
  const [historyProductLoading, setHistoryProductLoading] = useState(false);

  // Consume by Product States
  const [consumeModalOpen, setConsumeModalOpen] = useState(false);
  const [consumeCart, setConsumeCart] = useState<{type: "product"|"component", product: any, component?: any, quantity: number}[]>([]);
  const [consumeSelectedProductId, setConsumeSelectedProductId] = useState<string>("");
  const [consumeAddStock, setConsumeAddStock] = useState(true);
  const [consumeLoading, setConsumeLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [prodRes, filRes, compRes, compFilRes] = await Promise.all([
      supabase.from("products").select("*").eq("user_id", user.id).order("name", { ascending: true }),
      supabase.from("filaments").select("*").eq("user_id", user.id).eq("is_active", true).order("name", { ascending: true }),
      supabase.from("product_components").select("*").eq("user_id", user.id).eq("is_active", true),
      supabase.from("product_component_filaments").select("*").eq("user_id", user.id)
    ]);

    if (prodRes.error) setError(prodRes.error.message);
    else setProducts(prodRes.data || []);

    if (filRes.error) console.error(filRes.error.message);
    else setFilaments(filRes.data || []);

    if (!compRes.error && compRes.data) setProductComponents(compRes.data);
    if (!compFilRes.error && compFilRes.data) setComponentFilaments(compFilRes.data);

    setLoading(false);
  };

  const handleAdjustProductStock = async (id: string, type: "add" | "subtract") => {
    const amountStr = productAdjustAmounts[id] || "";
    const amount = parseInt(amountStr);
    
    if (!amount || amount <= 0 || isNaN(amount)) {
      alert("Por favor, ingresá una cantidad válida mayor a 0.");
      return;
    }

    const product = products.find(p => p.id === id);
    if (!product) return;

    if (type === "subtract" && (product.stock_quantity || 0) < amount) {
      alert("No hay suficiente stock de este producto para restar.");
      return;
    }

    setAdjustingProduct(id);
    const delta = type === "add" ? amount : -amount;
    const movementType = type === "add" ? "manual_add" : "manual_subtract";
    const reason = type === "add" ? "Suma manual desde stock" : "Resta manual desde stock";

    const { error: rpcError } = await supabase.rpc("adjust_product_stock", {
      p_product_id: id,
      p_quantity_delta: delta,
      p_movement_type: movementType,
      p_reason: reason,
      p_source_type: "manual",
      p_source_id: null
    });

    if (rpcError) {
      console.error("Error ajustando stock:", rpcError);
      alert("Hubo un error al ajustar el stock del producto: " + rpcError.message);
    } else {
      setProductAdjustAmounts(prev => ({ ...prev, [id]: "" }));
      await fetchData();
    }
    setAdjustingProduct(null);
  };

  const handleAdjustComponentStock = async (compId: string, delta: number) => {
    const comp = productComponents.find(c => c.id === compId);
    if (!comp) return;

    if (delta < 0 && (comp.stock_quantity || 0) < Math.abs(delta)) {
      alert("No hay suficiente stock de esta pieza para restar.");
      return;
    }

    const { error: rpcError } = await supabase.rpc("adjust_component_stock", {
      p_component_id: compId,
      p_quantity_delta: delta,
      p_movement_type: delta > 0 ? "manual_add" : "manual_subtract",
      p_reason: delta > 0 ? "Suma manual de pieza desde stock" : "Resta manual de pieza desde stock",
      p_source_type: "manual",
      p_source_id: null
    });

    if (rpcError) {
      alert("Error ajustando stock de pieza: " + rpcError.message);
    } else {
      await fetchData(); // refresh to update stock
    }
  };

  const handleAssembleProduct = async (product: any) => {
    const pComps = productComponents.filter(c => c.product_id === product.id && c.is_active);
    if (pComps.length <= 1 && (!pComps[0] || pComps[0].name === "Producto completo")) {
      return; // Simple product
    }

    const maxAssemble = Math.min(...pComps.map(c => Math.floor((c.stock_quantity || 0) / (c.quantity_per_product || 1)))) || 0;
    
    if (maxAssemble <= 0) {
      alert("No hay piezas suficientes para armar este producto.");
      return;
    }

    const qtyStr = prompt(`¿Cuántos ${product.name} querés armar? (Máximo: ${maxAssemble})`, "1");
    if (!qtyStr) return;
    const qty = parseInt(qtyStr);
    
    if (isNaN(qty) || qty <= 0 || qty > maxAssemble) {
      alert("Cantidad inválida o superior a las piezas disponibles.");
      return;
    }

    const { error } = await supabase.rpc("assemble_product_from_components", {
      p_product_id: product.id,
      p_quantity: qty,
      p_reason: "Armado de producto desde stock de piezas"
    });

    if (error) {
      console.error(error);
      alert("Error al armar el producto: " + error.message);
    } else {
      alert(`¡Producto armado! Se restaron las piezas y se sumaron ${qty} al stock final.`);
      await fetchData();
    }
  };

  const handleAdjustFilamentStock = async (id: string, type: "add" | "subtract") => {
    const amountStr = filamentAdjustAmounts[id] || "";
    const amount = parseInt(amountStr);
    
    if (!amount || amount <= 0 || isNaN(amount)) {
      alert("Por favor, ingresá una cantidad válida mayor a 0.");
      return;
    }

    const filament = filaments.find(f => f.id === id);
    if (!filament) return;

    if (type === "subtract" && filament.remaining_grams < amount) {
      alert("No podés restar más gramos de los que hay disponibles.");
      return;
    }

    setAdjustingFilament(id);
    const delta = type === "add" ? amount : -amount;
    const movementType = type === "add" ? "manual_add" : "manual_subtract";
    const reason = type === "add" ? "Suma manual desde stock" : "Resta manual desde stock";

    const { error: rpcError } = await supabase.rpc("adjust_filament_stock", {
      p_filament_id: id,
      p_grams_delta: delta,
      p_movement_type: movementType,
      p_reason: reason,
      p_source_type: "manual",
      p_source_id: null
    });

    if (rpcError) {
      console.error("Error ajustando stock:", rpcError);
      alert("Hubo un error al ajustar el stock: " + rpcError.message);
    } else {
      // Clear input and refresh data
      setFilamentAdjustAmounts(prev => ({ ...prev, [id]: "" }));
      await fetchData();
    }
    setAdjustingFilament(null);
  };

  const loadFilamentHistory = async (id: string) => {
    setHistoryFilamentId(id);
    setHistoryModalOpen(true);
    setHistoryLoading(true);

    const { data, error } = await supabase
      .from("filament_stock_movements")
      .select("*")
      .eq("filament_id", id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("Error loading history:", error);
    } else {
      setHistoryMovements(data || []);
    }
    setHistoryLoading(false);
  };

  const loadProductHistory = async (id: string) => {
    setHistoryProductId(id);
    setHistoryProductModalOpen(true);
    setHistoryProductLoading(true);

    const { data, error } = await supabase
      .from("product_stock_movements")
      .select("*")
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("Error loading history:", error);
    } else {
      setHistoryProductMovements(data || []);
    }
    setHistoryProductLoading(false);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleString("es-AR", { 
      day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit"
    });
  };

  // --- Consume Cart Logic ---
  const handleAddToCart = () => {
    if (!consumeSelectedProductId) return;
    const [type, id] = consumeSelectedProductId.split("|");
    
    if (type === "product") {
      const prod = products.find(p => p.id === id);
      if (!prod) return;
      const hasComponents = productComponents.some(c => c.product_id === prod.id);
      if (!hasComponents && !prod.filament_id) {
        alert("Este producto no tiene materiales configurados para descontar.");
        return;
      }
      setConsumeCart(prev => {
        const existing = prev.find(item => item.type === "product" && item.product.id === prod.id);
        if (existing) {
          return prev.map(item => item === existing ? { ...item, quantity: item.quantity + 1 } : item);
        }
        return [...prev, { type: "product", product: prod, quantity: 1 }];
      });
    } else if (type === "component") {
      const comp = productComponents.find(c => c.id === id);
      if (!comp) return;
      const prod = products.find(p => p.id === comp.product_id);
      setConsumeCart(prev => {
        const existing = prev.find(item => item.type === "component" && item.component?.id === comp.id);
        if (existing) {
          return prev.map(item => item === existing ? { ...item, quantity: item.quantity + 1 } : item);
        }
        return [...prev, { type: "component", product: prod, component: comp, quantity: 1 }];
      });
    }
    
    setConsumeSelectedProductId("");
  };

  const calculateConsumePreview = () => {
    const required: Record<string, number> = {};
    const insufficient: string[] = [];

    consumeCart.forEach(item => {
      if (item.type === "product") {
        const prodId = item.product.id;
        const comps = productComponents.filter(c => c.product_id === prodId && c.is_active);
        
        if (comps.length > 0) {
          comps.forEach(c => {
            const mats = componentFilaments.filter(f => f.component_id === c.id);
            mats.forEach(m => {
              const qty = item.quantity * c.quantity_per_product * parseFloat(m.grams || "0");
              required[m.filament_id] = (required[m.filament_id] || 0) + qty;
            });
          });
        } else if (item.product.filament_id) {
          // Fallback for legacy products
          const qty = item.quantity * parseFloat(item.product.grams || "0");
          required[item.product.filament_id] = (required[item.product.filament_id] || 0) + qty;
        }
      } else if (item.type === "component" && item.component) {
        const mats = componentFilaments.filter(f => f.component_id === item.component.id);
        mats.forEach(m => {
          const qty = item.quantity * parseFloat(m.grams || "0");
          required[m.filament_id] = (required[m.filament_id] || 0) + qty;
        });
      }
    });

    const preview = Object.keys(required).map(filId => {
      const fil = filaments.find(f => f.id === filId);
      const needed = required[filId];
      const available = fil ? fil.remaining_grams : 0;
      if (needed > available) insufficient.push(fil?.name || filId);
      return {
        filament_id: filId,
        filament: fil,
        needed,
        available,
        remainingAfter: available - needed
      };
    });

    return { preview, insufficient, isValid: insufficient.length === 0 && consumeCart.length > 0 };
  };

  const handleConfirmConsume = async () => {
    const { isValid } = calculateConsumePreview();
    if (!isValid) return;

    setConsumeLoading(true);
    let hasErrors = false;
    
    // Split into products and components
    const productItems = consumeCart.filter(item => item.type === "product");
    const compItems = consumeCart.filter(item => item.type === "component" && item.component);

    // 1. Process whole products using RPC
    if (productItems.length > 0) {
      const p_items = productItems.map(item => ({
        product_id: item.product.id,
        quantity: item.quantity
      }));
      const { error: rpcError } = await supabase.rpc("consume_filaments_for_products", {
        p_items,
        p_reason: "Producción registrada desde stock",
        p_add_to_product_stock: consumeAddStock
      });
      if (rpcError) {
        console.error("Error consumiendo productos completos:", rpcError);
        alert("Hubo un error al descontar los productos completos: " + rpcError.message);
        hasErrors = true;
      }
    }

    // 2. Process individual components sequentially
    if (compItems.length > 0) {
      for (const item of compItems) {
        const c = item.component;
        if (!c) continue;
        const mats = componentFilaments.filter(f => f.component_id === c.id);
        
        // Decrement filaments for this component
        for (const m of mats) {
          const qty = item.quantity * parseFloat(m.grams || "0");
          if (qty <= 0) continue;
          
          await supabase.rpc("adjust_filament_stock", {
            p_filament_id: m.filament_id,
            p_grams_delta: -qty,
            p_movement_type: "production",
            p_reason: `Impresión de pieza individual: ${c.name}`,
            p_source_type: "product_component",
            p_source_id: c.id
          });
        }
        
        // Optionally add to component stock
        if (consumeAddStock) {
          await supabase.rpc("adjust_component_stock", {
            p_component_id: c.id,
            p_quantity_delta: item.quantity,
            p_movement_type: "production",
            p_reason: "Fabricación de pieza individual",
            p_source_type: "manual",
            p_source_id: null
          });
        }
      }
    }

    if (!hasErrors) {
      setConsumeModalOpen(false);
      setConsumeCart([]);
    }
    await fetchData(); // refreshes everything
    setConsumeLoading(false);
  };

  const lowProductsCount = products.filter((r) => r.is_active && r.stock_quantity <= 1).length;
  const lowFilamentsCount = filaments.filter((r) => r.remaining_grams < 200).length;
  const totalLowCount = lowProductsCount + lowFilamentsCount;

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Stock"
        action={
          <Link href={tab === "productos" ? "/productos" : "/configuracion"}>
            <PrimaryButton>
              <Plus size={15} /> {tab === "productos" ? "Nuevo Producto" : "Nuevo Filamento"}
            </PrimaryButton>
          </Link>
        }
      />

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 p-4 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {totalLowCount > 0 && (
        <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
          <AlertTriangle size={16} className="text-orange-600 shrink-0" />
          <p>
            Tenés <strong>{lowProductsCount} productos</strong> y <strong>{lowFilamentsCount} filamentos</strong> con
            stock bajo.
          </p>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between border-b border-gray-200 flex-wrap gap-2 pb-2 sm:pb-0">
        <div className="flex">
          <button
            onClick={() => setTab("productos")}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              tab === "productos"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <Package size={16} /> Productos
            {lowProductsCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-[10px] text-orange-600">
                {lowProductsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("filamentos")}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              tab === "filamentos"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <Box size={16} /> Filamentos
            {lowFilamentsCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-[10px] text-orange-600">
                {lowFilamentsCount}
              </span>
            )}
          </button>
        </div>
        <button 
          onClick={() => setConsumeModalOpen(true)} 
          className="flex items-center gap-2 text-sm font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 px-4 py-2 rounded-lg transition-colors border border-orange-200 mr-2"
        >
          <Package size={15} /> Descontar por producto
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-3">Nombre</th>
                <th className="px-5 py-3">{tab === "productos" ? "Precio Venta" : "Tipo / Color"}</th>
                <th className="px-5 py-3">Cantidad</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              
              {tab === "productos" && products.map((p) => {
                const isLow = p.stock_quantity <= 1;
                const pComps = productComponents.filter(c => c.product_id === p.id && c.is_active);
                const isParts = pComps.length > 1 || (pComps.length === 1 && pComps[0].name !== "Producto completo");
                const maxAssemble = isParts ? Math.min(...pComps.map(c => Math.floor((c.stock_quantity || 0) / (c.quantity_per_product || 1)))) || 0 : 0;

                return (
                  <React.Fragment key={p.id}>
                    <tr className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-gray-900">
                        <div className="flex items-center gap-3">
                          {p.image_url ? (
                            <img src={p.image_url} alt="" className="w-8 h-8 rounded bg-gray-100 object-cover border border-gray-200" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center border border-gray-200 text-gray-400 text-xs">📦</div>
                          )}
                          <div className="flex flex-col">
                            <span>{p.name}</span>
                            {isParts && (
                              <span className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded w-max mt-0.5 uppercase font-bold">Por Partes</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-gray-600 font-medium">${p.sale_price?.toFixed(2) || "0.00"}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-lg ${isLow ? "text-red-600" : "text-gray-900"}`}>
                            {p.stock_quantity || 0}
                          </span>
                          {isLow && p.is_active && (
                            <Badge tone="gray" className="ml-1 border-red-200 bg-red-50 text-red-600">Bajo</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs px-2 py-1 rounded-md font-medium ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {p.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-end gap-1.5 items-center">
                          {isParts && (
                            <div className="flex items-center mr-2">
                              <button
                                onClick={() => handleAssembleProduct(p)}
                                disabled={maxAssemble <= 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Este ajuste modifica el stock del producto terminado restando stock de las piezas."
                              >
                                <Package size={14} /> Armar
                                <span className="bg-white px-1.5 py-0.5 rounded text-[10px] border border-indigo-100">{maxAssemble}</span>
                              </button>
                            </div>
                          )}

                          <div className="flex items-center gap-1" title="Este ajuste modifica el stock del producto terminado, no el stock de piezas.">
                            <input 
                              type="number"
                              min="1"
                              step="1"
                              placeholder="Cant."
                              value={productAdjustAmounts[p.id] || ""}
                              onChange={(e) => setProductAdjustAmounts(prev => ({...prev, [p.id]: e.target.value}))}
                              className="w-16 h-8 text-xs border border-gray-200 rounded-md px-2 focus:border-orange-500 focus:ring-orange-500 outline-none"
                              disabled={adjustingProduct === p.id}
                            />
                            <button
                              onClick={() => handleAdjustProductStock(p.id, "subtract")}
                              disabled={adjustingProduct === p.id}
                              className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50 transition-colors shadow-sm"
                              title="Restar terminado"
                            >
                              {adjustingProduct === p.id ? <Loader2 size={14} className="animate-spin" /> : <Minus size={14} />}
                            </button>
                            <button
                              onClick={() => handleAdjustProductStock(p.id, "add")}
                              disabled={adjustingProduct === p.id}
                              className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-green-600 bg-white hover:bg-green-50 disabled:opacity-50 transition-colors shadow-sm"
                              title="Sumar terminado"
                            >
                              {adjustingProduct === p.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            </button>
                          </div>

                          <div className="h-6 w-px bg-gray-200 mx-1"></div>
                          
                          <button 
                            onClick={() => loadProductHistory(p.id)}
                            className="text-gray-400 hover:text-blue-600 p-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                            title="Historial de movimientos"
                          >
                            <History size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    
                    {/* Render Parts below product if any */}
                    {isParts && pComps.map(c => (
                      <tr key={c.id} className="bg-gray-50/50 border-t border-gray-50">
                        <td className="px-5 py-2 pl-16">
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-300"></div>
                            <span className="text-sm font-medium text-gray-600">{c.name}</span>
                            <span className="text-[10px] text-gray-400">({c.quantity_per_product} por prod.)</span>
                          </div>
                        </td>
                        <td className="px-5 py-2"></td>
                        <td className="px-5 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold text-sm ${c.stock_quantity < c.quantity_per_product ? "text-red-500" : "text-gray-700"}`}>
                              {c.stock_quantity || 0}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-2"></td>
                        <td className="px-5 py-2">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => handleAdjustComponentStock(c.id, -1)}
                              className="flex h-6 w-6 items-center justify-center rounded border border-gray-200 text-gray-500 bg-white hover:bg-gray-50 hover:text-red-600 transition-colors"
                              disabled={c.stock_quantity <= 0}
                            >
                              <Minus size={12} />
                            </button>
                            <button
                              onClick={() => handleAdjustComponentStock(c.id, 1)}
                              className="flex h-6 w-6 items-center justify-center rounded border border-gray-200 text-gray-500 bg-white hover:bg-gray-50 hover:text-green-600 transition-colors"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}

              {tab === "filamentos" && filaments.map((f) => {
                const isLow = f.remaining_grams < 200;
                return (
                <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 font-semibold text-gray-900">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: f.color || '#ccc' }}></div>
                      <span>{f.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-600 font-medium">
                    {f.filament_type}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${isLow ? "text-red-600" : "text-gray-900"}`}>
                        {f.remaining_grams || 0}g <span className="text-gray-400 font-normal text-sm">/ {f.total_grams}g</span>
                      </span>
                      {isLow && (
                        <Badge tone="gray" className="ml-1 border-red-200 bg-red-50 text-red-600">Bajo</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs px-2 py-1 rounded-md font-medium bg-green-100 text-green-700">Activo</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end items-center gap-3">
                      
                      <div className="flex items-center gap-1">
                        <input 
                          type="number"
                          min="1"
                          step="1"
                          placeholder="g"
                          value={filamentAdjustAmounts[f.id] || ""}
                          onChange={(e) => setFilamentAdjustAmounts(prev => ({...prev, [f.id]: e.target.value}))}
                          className="w-16 h-8 text-xs border border-gray-200 rounded-md px-2 focus:border-orange-500 focus:ring-orange-500 outline-none"
                          disabled={adjustingFilament === f.id}
                        />
                        <button
                          onClick={() => handleAdjustFilamentStock(f.id, "subtract")}
                          disabled={adjustingFilament === f.id}
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50 transition-colors shadow-sm"
                          title="Restar"
                        >
                          {adjustingFilament === f.id ? <Loader2 size={14} className="animate-spin" /> : <Minus size={14} />}
                        </button>
                        <button
                          onClick={() => handleAdjustFilamentStock(f.id, "add")}
                          disabled={adjustingFilament === f.id}
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-green-600 bg-white hover:bg-green-50 disabled:opacity-50 transition-colors shadow-sm"
                          title="Sumar"
                        >
                          {adjustingFilament === f.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        </button>
                      </div>

                      <div className="h-6 w-px bg-gray-200 mx-1"></div>
                      
                      <button 
                        onClick={() => loadFilamentHistory(f.id)}
                        className="text-gray-400 hover:text-blue-600 p-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                        title="Historial de movimientos"
                      >
                        <History size={16} />
                      </button>

                      <Link href="/configuracion">
                        <button className="text-gray-400 hover:text-orange-600 p-1.5 rounded-lg hover:bg-orange-50 transition-colors" title="Editar filamento">
                          <Edit2 size={16} />
                        </button>
                      </Link>
                    </div>
                  </td>
                </tr>
              )})}

            </tbody>
          </table>

          {tab === "productos" && products.length === 0 && !loading && (
            <div className="py-12 text-center">
              <p className="text-gray-500 text-sm">No tienes productos. Ve a la sección de Productos para crearlos.</p>
            </div>
          )}

          {tab === "filamentos" && filaments.length === 0 && !loading && (
            <div className="py-12 text-center">
              <p className="text-gray-500 text-sm">No tienes filamentos activos. Ve a la Configuración para añadirlos.</p>
            </div>
          )}

        </div>
      </Card>

      {/* History Modal for Filaments */}
      {historyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Historial de Movimientos</h3>
                <p className="text-xs text-gray-500">Últimos 10 cambios en este filamento.</p>
              </div>
              <button onClick={() => setHistoryModalOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {historyLoading ? (
                <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-orange-500" /></div>
              ) : historyMovements.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-500">No hay movimientos registrados.</div>
              ) : (
                <div className="space-y-3">
                  {historyMovements.map(m => {
                    const isPositive = m.grams_delta > 0;
                    return (
                      <div key={m.id} className="flex flex-col gap-1 text-sm border-b border-gray-50 pb-3">
                        <div className="flex justify-between items-start">
                          <span className={`font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                            {isPositive ? '+' : ''}{m.grams_delta}g
                          </span>
                          <span className="text-xs text-gray-400">{formatDate(m.created_at)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-600">
                          <span>{m.reason}</span>
                          <span className="font-medium bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">
                            {m.previous_grams}g → {m.new_grams}g
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History Modal for Products */}
      {historyProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Historial de Movimientos</h3>
                <p className="text-xs text-gray-500">Últimos 10 cambios en este producto.</p>
              </div>
              <button onClick={() => setHistoryProductModalOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {historyProductLoading ? (
                <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-orange-500" /></div>
              ) : historyProductMovements.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-500">No hay movimientos registrados.</div>
              ) : (
                <div className="space-y-3">
                  {historyProductMovements.map(m => {
                    const isPositive = m.quantity_delta > 0;
                    return (
                      <div key={m.id} className="flex flex-col gap-1 text-sm border-b border-gray-50 pb-3">
                        <div className="flex justify-between items-start">
                          <span className={`font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                            {isPositive ? '+' : ''}{m.quantity_delta} u.
                          </span>
                          <span className="text-xs text-gray-400">{formatDate(m.created_at)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-600">
                          <span>{m.reason}</span>
                          <span className="font-medium bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">
                            {m.previous_quantity} → {m.new_quantity}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Consume by Product Modal */}
      {consumeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Package size={18} className="text-orange-500" /> Descontar por producto
              </h3>
              <button onClick={() => setConsumeModalOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Selector */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Agregar producto</label>
                <div className="flex gap-2">
                  <select 
                    value={consumeSelectedProductId} 
                    onChange={(e) => setConsumeSelectedProductId(e.target.value)} 
                    className="flex-1 text-sm border-gray-300 rounded-lg focus:border-orange-500 focus:ring-orange-500"
                  >
                    <option value="">Buscar producto o parte...</option>
                    {products.filter(p => p.is_active).map(p => {
                      const pComps = productComponents.filter(c => c.product_id === p.id && c.is_active);
                      const isParts = pComps.length > 1 || (pComps.length === 1 && pComps[0].name !== "Producto completo");
                      if (isParts) {
                        return (
                          <optgroup key={p.id} label={p.name}>
                            <option value={`product|${p.id}`}>📦 {p.name} (Completo)</option>
                            {pComps.map(c => (
                              <option key={c.id} value={`component|${c.id}`}>&nbsp;&nbsp;🧩 Pieza: {c.name}</option>
                            ))}
                          </optgroup>
                        );
                      } else {
                        return <option key={p.id} value={`product|${p.id}`}>📦 {p.name}</option>
                      }
                    })}
                  </select>
                  <PrimaryButton onClick={handleAddToCart} disabled={!consumeSelectedProductId}>
                    <Plus size={16} /> Agregar
                  </PrimaryButton>
                </div>
              </div>

              {/* Cart */}
              {consumeCart.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Productos a descontar</h4>
                  <div className="space-y-3">
                    {consumeCart.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-gray-50 border border-gray-200 p-3 rounded-lg">
                        <div className="flex items-center gap-3 overflow-hidden">
                          {item.product?.image_url ? (
                            <img src={item.product.image_url} alt="" className="w-10 h-10 rounded-md object-cover border border-gray-200 shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-md bg-gray-200 flex items-center justify-center shrink-0 text-gray-500">
                              {item.type === "component" ? "🧩" : "📦"}
                            </div>
                          )}
                          <div className="flex flex-col">
                            <span className="font-semibold text-sm text-gray-900 truncate">
                              {item.type === "component" ? item.component?.name : item.product?.name}
                            </span>
                            {item.type === "component" && (
                              <span className="text-[10px] text-gray-500 truncate">Parte de: {item.product?.name}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500 mr-2">Cant:</span>
                            <input 
                              type="number" 
                              min="1" 
                              value={item.quantity} 
                              onChange={(e) => {
                                const q = parseInt(e.target.value) || 1;
                                setConsumeCart(prev => prev.map((p, i) => i === idx ? { ...p, quantity: Math.max(1, q) } : p));
                              }}
                              className="w-16 text-sm border-gray-300 rounded focus:border-orange-500 focus:ring-orange-500 p-1"
                            />
                          </div>
                          <button onClick={() => setConsumeCart(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 p-1">
                            <X size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview */}
              {consumeCart.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Se descontará de tu stock:</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {calculateConsumePreview().preview.map(p => (
                      <div key={p.filament_id} className={`p-3 rounded-xl border ${p.needed > p.available ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-100'}`}>
                        <p className="font-bold text-sm text-gray-900 truncate mb-1">
                          {p.filament?.name || 'Material desconocido'} {p.filament?.color ? `(${p.filament.color})` : ''}
                        </p>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600">Requiere:</span>
                          <span className="font-bold text-gray-900">{p.needed.toFixed(1)} g</span>
                        </div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600">Disponible:</span>
                          <span className="font-medium text-gray-900">{p.available} g</span>
                        </div>
                        <div className="flex justify-between text-xs pt-1 border-t border-orange-200/50 mt-1">
                          <span className="text-gray-600">Quedarán:</span>
                          <span className={`font-bold ${p.remainingAfter < 0 ? 'text-red-600' : 'text-orange-700'}`}>
                            {p.remainingAfter.toFixed(1)} g
                          </span>
                        </div>
                        {p.needed > p.available && (
                          <p className="text-[10px] text-red-600 font-bold mt-2 flex items-center gap-1">
                            <AlertTriangle size={12} /> Stock insuficiente
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Settings */}
              {consumeCart.length > 0 && (
                <div className="bg-gray-50 border border-gray-200 p-4 rounded-xl flex items-start gap-3">
                  <input 
                    type="checkbox" 
                    id="consumeAddStock" 
                    checked={consumeAddStock} 
                    onChange={(e) => setConsumeAddStock(e.target.checked)} 
                    className="mt-1 rounded text-orange-600 focus:ring-orange-500" 
                  />
                  <div>
                    <label htmlFor="consumeAddStock" className="block text-sm font-bold text-gray-900 cursor-pointer">
                      Sumar al stock de productos terminados
                    </label>
                    <p className="text-xs text-gray-500 mt-1">
                      Si está activado, además de descontar el material, se sumará la cantidad ingresada al stock disponible del producto. Usalo cuando estás registrando productos que ya imprimiste.
                    </p>
                  </div>
                </div>
              )}

            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50">
              <button 
                onClick={() => setConsumeModalOpen(false)} 
                className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleConfirmConsume} 
                disabled={consumeCart.length === 0 || !calculateConsumePreview().isValid || consumeLoading}
                className="flex items-center gap-2 px-5 py-2 text-sm font-bold bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors shadow-sm"
              >
                {consumeLoading ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}
                Confirmar descuento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
