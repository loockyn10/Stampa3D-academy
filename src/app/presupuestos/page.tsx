"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Pencil, FileText, Trash2, Loader2, AlertCircle, Save, X, UserPlus, ShoppingCart, Download, Briefcase, Settings, ArrowLeft, Package, Clock, Percent, DollarSign } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { SectionTitle } from "@/components/ui/section-title";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/utils/supabase/client";
import { pdf } from "@react-pdf/renderer";
import BudgetPDFDocument from "@/components/presupuestos/budget-pdf-document";


const STATUS_MAP: Record<string, { label: string, color: "gray" | "dark" | "green" | "orange" }> = {
  draft: { label: "Borrador", color: "gray" },
  sent: { label: "Enviado", color: "dark" },
  approved: { label: "Aprobado", color: "green" },
  rejected: { label: "Rechazado", color: "orange" },
};

export default function PresupuestosPage() {
  const supabase = createClient();
  const [budgets, setBudgets] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [filaments, setFilaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Profile
  const [profile, setProfile] = useState<any>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    client_id: "",
    status: "draft",
    notes: "",
    valid_until: "",
    discount_percent: 0,
  });
  const [budgetItems, setBudgetItems] = useState<any[]>([]);

  // Client Form State
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientData, setClientData] = useState({ id: "", name: "", phone: "", email: "", notes: "", fiscal_condition: "", cuit: "", is_active: true });

  // Product Modal State
  const [showProductModal, setShowProductModal] = useState(false);
  const [productData, setProductData] = useState({
    name: "",
    description: "",
    image_url: "",
    filament_id: "",
    grams: 0,
    print_time_hours: 0,
    print_time_minutes: 0,
    base_cost: 0,
    sale_price: 0,
    stock_quantity: 0
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [bRes, cRes, pRes, filRes, profRes] = await Promise.all([
      supabase.from("budgets").select("*, clients(name)").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("clients").select("*").eq("user_id", user.id).order("name", { ascending: true }),
      supabase.from("products").select("*").eq("user_id", user.id).eq("is_active", true).order("name", { ascending: true }),
      supabase.from("filaments").select("*").eq("user_id", user.id).eq("is_active", true).order("name", { ascending: true }),
      supabase.from("profiles").select("*").eq("id", user.id).single()
    ]);

    if (bRes.error) setError(bRes.error.message);
    else setBudgets(bRes.data || []);

    if (cRes.error) console.error(cRes.error);
    else setClients(cRes.data || []);

    if (pRes.error) console.error(pRes.error);
    else setProducts(pRes.data || []);

    if (filRes.error) console.error(filRes.error);
    else setFilaments(filRes.data || []);

    if (profRes.data) setProfile(profRes.data);

    setLoading(false);
  };

  const handleCreateNew = () => {
    setFormData({
      title: "", client_id: "", status: "draft", notes: "", valid_until: "", discount_percent: 0
    });
    setBudgetItems([]);
    setEditingId("new");
    setShowClientForm(false);
  };

  const handleEdit = async (b: any) => {
    setFormData({
      title: b.title || "", client_id: b.client_id || "", status: b.status || "draft",
      notes: b.notes || "", valid_until: b.valid_until || "", discount_percent: b.discount_percent || 0
    });

    // Fetch items for this budget
    const { data, error } = await supabase.from("budget_items").select("*").eq("budget_id", b.id);
    if (!error && data) {
      setBudgetItems(data);
    } else {
      setBudgetItems([]);
    }

    setEditingId(b.id);
    setShowClientForm(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Seguro que deseas eliminar este presupuesto?")) return;
    const { error: itemsError } = await supabase.from("budget_items").delete().eq("budget_id", id);
    if (!itemsError) {
      const { error } = await supabase.from("budgets").delete().eq("id", id);
      if (error) alert("Error: " + error.message);
      else setBudgets(budgets.filter(b => b.id !== id));
    }
  };

  const handleAddItem = () => {
    if (products.length === 0) return alert("No tienes productos activos para agregar.");
    const p = products[0];
    const unitBaseCost = p.base_cost || 0;
    const unitProfit = (p.sale_price || 0) - unitBaseCost;
    setBudgetItems([...budgetItems, {
      id: "temp-" + Date.now(),
      product_id: p.id,
      item_name: p.name,
      quantity: 1,
      unit_price: p.sale_price || 0,
      subtotal: p.sale_price || 0,
      unit_base_cost: unitBaseCost,
      unit_profit: unitProfit,
      total_profit: unitProfit,
    }]);
  };

  const handleRemoveItem = (index: number) => {
    setBudgetItems(budgetItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...budgetItems];
    if (field === "product_id") {
      const p = products.find(prod => prod.id === value);
      if (p) {
        const unitBaseCost = p.base_cost || 0;
        const unitProfit = (p.sale_price || 0) - unitBaseCost;
        const qty = newItems[index].quantity || 1;
        newItems[index] = {
          ...newItems[index],
          product_id: p.id,
          item_name: p.name,
          unit_price: p.sale_price || 0,
          subtotal: (p.sale_price || 0) * qty,
          unit_base_cost: unitBaseCost,
          unit_profit: unitProfit,
          total_profit: unitProfit * qty,
        };
      }
    } else if (field === "quantity") {
      const qty = parseInt(value) || 1;
      newItems[index].quantity = qty;
      newItems[index].subtotal = qty * newItems[index].unit_price;
      const unitProfit = newItems[index].unit_profit || 0;
      newItems[index].total_profit = unitProfit * qty;
    } else if (field === "unit_price") {
      const price = parseFloat(value) || 0;
      newItems[index].unit_price = price;
      newItems[index].subtotal = newItems[index].quantity * price;
    } else {
      newItems[index][field] = value;
    }
    setBudgetItems(newItems);
  };

  const subtotal = budgetItems.reduce((acc, item) => acc + (item.subtotal || 0), 0);
  const estimatedProfit = budgetItems.reduce((acc, item) => acc + (item.total_profit || 0), 0);
  const discountPercent = parseFloat(String(formData.discount_percent)) || 0;
  const discountAmount = subtotal * (discountPercent / 100);
  const total = Math.max(0, subtotal - discountAmount);

  const handleSaveBudget = async () => {
    if (!formData.title.trim()) return alert("Agregá un título para el presupuesto.");
    if (!formData.client_id) return alert("Por favor selecciona un cliente.");
    if (budgetItems.length === 0) return alert("Agrega al menos un producto al presupuesto.");

    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      user_id: user.id,
      client_id: formData.client_id,
      title: formData.title,
      status: formData.status,
      notes: formData.notes,
      valid_until: formData.valid_until || null,
      discount_percent: discountPercent,
      discount_amount: discountAmount,
      subtotal: subtotal,
      total_amount: total
    };

    let budgetId = editingId;

    if (editingId === "new") {
      const { data, error } = await supabase.from("budgets").insert([payload]).select().single();
      if (error) return setError(error.message);
      budgetId = data.id;
    } else {
      const { error } = await supabase.from("budgets").update(payload).eq("id", editingId);
      if (error) return setError(error.message);
    }

    // Process items (simplest way: delete all existing for this budget, then insert)
    if (editingId !== "new") {
      await supabase.from("budget_items").delete().eq("budget_id", budgetId);
    }

    const itemsPayload = budgetItems.map(item => ({
      budget_id: budgetId,
      product_id: item.product_id,
      item_name: item.item_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      unit_base_cost: item.unit_base_cost ?? null,
      unit_profit: item.unit_profit ?? null,
      total_profit: item.total_profit ?? null,
    }));

    const { error: itemsError } = await supabase.from("budget_items").insert(itemsPayload);
    if (itemsError) return setError(itemsError.message);

    // Refresh data
    await fetchData();
    setEditingId(null);
  };

  const handleDownloadPdf = async () => {
    if (editingId === "new") {
      alert("Debes guardar el presupuesto antes de descargarlo.");
      return;
    }

    // Find client
    const currentClient = clients.find(c => c.id === formData.client_id);

    // Prepare budget object with full details
    const budgetData = {
      id: editingId,
      ...formData,
      subtotal,
      total_amount: total
    };

    setIsGeneratingPdf(true);
    try {
      const blob = await pdf(
        <BudgetPDFDocument
          budget={budgetData}
          items={budgetItems}
          client={currentClient}
          profile={profile}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      // Sanitized filename
      const titleClean = formData.title ? formData.title.replace(/[^a-z0-9]/gi, '-').toLowerCase() : "sin-titulo";
      link.download = `presupuesto-${titleClean}.pdf`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      alert("Hubo un error al generar el PDF: " + err.message);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDownloadPdfById = async (b: any) => {
    setGeneratingPdfId(b.id);
    try {
      const currentClient = clients.find(c => c.id === b.client_id);

      const { data: itemsData, error: itemsError } = await supabase
        .from("budget_items")
        .select("*")
        .eq("budget_id", b.id);

      if (itemsError) throw itemsError;

      const budgetData = {
        id: b.id,
        title: b.title,
        status: b.status,
        notes: b.notes,
        valid_until: b.valid_until,
        discount_percent: b.discount_percent || 0,
        subtotal: b.subtotal || 0,
        total_amount: b.total_amount || 0
      };

      const blob = await pdf(
        <BudgetPDFDocument
          budget={budgetData}
          items={itemsData || []}
          client={currentClient}
          profile={profile}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      const titleClean = b.title ? b.title.replace(/[^a-z0-9]/gi, '-').toLowerCase() : "sin-titulo";
      link.download = `presupuesto-${titleClean}.pdf`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      alert("Hubo un error al generar el PDF: " + err.message);
    } finally {
      setGeneratingPdfId(null);
    }
  };

  const handleSaveClient = async () => {
    if (!clientData.name) return alert("El nombre del cliente es obligatorio.");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload: any = {
      user_id: user.id,
      name: clientData.name,
      phone: clientData.phone,
      email: clientData.email,
      notes: clientData.notes,
      fiscal_condition: clientData.fiscal_condition,
      cuit: clientData.cuit,
      is_active: clientData.is_active
    };

    if (clientData.id) {
      // Editar
      const { data, error } = await supabase.from("clients").update(payload).eq("id", clientData.id).select().single();
      if (error) {
        alert("Error actualizando cliente: " + error.message);
      } else {
        setClients(clients.map(c => c.id === data.id ? data : c));
        setFormData(prev => ({ ...prev, client_id: data.id }));
        setShowClientForm(false);
      }
    } else {
      // Crear
      const { data, error } = await supabase.from("clients").insert([payload]).select().single();
      if (error) {
        alert("Error creando cliente: " + error.message);
      } else {
        setClients([...clients, data].sort((a, b) => a.name.localeCompare(b.name)));
        setFormData(prev => ({ ...prev, client_id: data.id }));
        setShowClientForm(false);
      }
    }
  };

  const handleEditClient = (clientId: string) => {
    const c = clients.find(cl => cl.id === clientId);
    if (c) {
      setClientData({
        id: c.id,
        name: c.name || "",
        phone: c.phone || "",
        email: c.email || "",
        notes: c.notes || "",
        fiscal_condition: c.fiscal_condition || "",
        cuit: c.cuit || "",
        is_active: c.is_active !== false
      });
      setShowClientForm(true);
    }
  };

  const handleCancelClientForm = () => {
    setShowClientForm(false);
    setClientData({ id: "", name: "", phone: "", email: "", notes: "", fiscal_condition: "", cuit: "", is_active: true });
  };

  const handleSaveProduct = async () => {
    if (!productData.name.trim()) return alert("El nombre del producto es obligatorio.");
    if (parseFloat(String(productData.sale_price)) < 0) return alert("El precio de venta debe ser mayor o igual a 0.");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const hours = Math.max(0, parseInt(String(productData.print_time_hours)) || 0);
    const mins = Math.max(0, Math.min(59, parseInt(String(productData.print_time_minutes)) || 0));
    const totalMinutes = (hours * 60) + mins;

    const payload = {
      user_id: user.id,
      name: productData.name,
      description: productData.description || "",
      image_url: productData.image_url || "",
      filament_id: productData.filament_id || null,
      grams: parseFloat(String(productData.grams)) || 0,
      print_time_minutes: totalMinutes,
      base_cost: parseFloat(String(productData.base_cost)) || 0,
      sale_price: parseFloat(String(productData.sale_price)) || 0,
      stock_quantity: parseInt(String(productData.stock_quantity)) || 0,
      is_active: true
    };

    const { data, error } = await supabase.from("products").insert([payload]).select().single();
    if (error) {
      alert("Error creando producto: " + error.message);
    } else if (data) {
      const updatedProducts = [...products, data].sort((a, b) => a.name.localeCompare(b.name));
      setProducts(updatedProducts);

      setBudgetItems([...budgetItems, {
        id: "temp-" + Date.now(),
        product_id: data.id,
        item_name: data.name,
        quantity: 1,
        unit_price: data.sale_price || 0,
        subtotal: data.sale_price || 0
      }]);

      setProductData({
        name: "",
        description: "",
        image_url: "",
        filament_id: filaments.length > 0 ? filaments[0].id : "",
        grams: 0,
        print_time_hours: 0,
        print_time_minutes: 0,
        base_cost: 0,
        sale_price: 0,
        stock_quantity: 0
      });
      setShowProductModal(false);
    }
  };

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-stampa-orange" /></div>;

  return (
    <div className="space-y-8 pb-10">
      {/* 1. Header Premium */}
      {!editingId ? (
        <div className="relative overflow-hidden rounded-3xl bg-stampa-surface border border-stampa-border p-8 sm:p-10 shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-[#ff6a00]/20 to-transparent pointer-events-none" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 mb-3 justify-between">
                <span className="rounded-full bg-stampa-orange/10 text-stampa-orange text-xs font-bold px-3 py-1 uppercase tracking-wider border border-[#ff6a00]/20">
                  Herramienta de venta
                </span>

              </div>
              <h1 className="text-3xl font-bold text-white sm:text-4xl flex items-center gap-3">
                <Briefcase size={32} className="text-stampa-orange" /> Presupuestos
              </h1>
              <p className="mt-3 text-base text-gray-400">
                Armá presupuestos profesionales para clientes, agregá productos y descargá el PDF.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
              <Link href="/productos" className="inline-flex justify-center items-center gap-2 px-5 py-3 text-sm font-semibold bg-stampa-surface border border-stampa-border text-white rounded-xl hover:bg-white/5 transition-colors">
                <Package size={16} /> Ver productos
              </Link>
              <button onClick={handleCreateNew} className="inline-flex justify-center items-center gap-2 px-6 py-3 text-sm font-bold bg-stampa-orange text-white rounded-xl hover:bg-stampa-orange-hover transition-all shadow-lg shadow-[#ff6a00]/20">
                <Plus size={18} /> Nuevo presupuesto
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-stampa-border pb-4 gap-4">
          <div className="flex items-center gap-4">
            <button onClick={() => setEditingId(null)} className="p-2 bg-stampa-surface border border-stampa-border rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors shrink-0">
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <FileText size={24} className="text-stampa-orange shrink-0" />
              {editingId === "new" ? "Nuevo Presupuesto" : "Editar Presupuesto"}
            </h2>
          </div>
          {editingId !== "new" && (
            <button
              onClick={handleDownloadPdf}
              disabled={isGeneratingPdf}
              className="w-full sm:w-auto flex justify-center items-center gap-2 text-sm font-bold text-stampa-orange hover:text-[#ff7a1a] bg-stampa-orange/10 border border-[#ff6a00]/20 px-4 py-2 rounded-lg shadow-sm transition-colors disabled:opacity-50"
            >
              {isGeneratingPdf ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Descargar PDF
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-sm text-red-400">
          <AlertCircle size={20} className="shrink-0" /> {error}
        </div>
      )}

      {/* VISTA DE EDICIÓN / CREACIÓN */}
      {editingId && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start animate-in fade-in-50 duration-300">
          {/* COLUMNA FORMULARIO */}
          <div className="lg:col-span-2 space-y-6">

            {/* 1. Datos del Cliente */}
            <Card className="p-6 sm:p-8 bg-stampa-surface border-stampa-border shadow-lg">
              <div className="flex justify-between items-end mb-6 border-b border-stampa-border pb-3">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">Cliente</h3>
                  <p className="text-sm text-gray-400 mt-1">Elegí un cliente existente o cargá uno nuevo.</p>
                </div>
                {!showClientForm && (
                  <div className="flex items-center gap-2">
                    {formData.client_id && (
                      <button onClick={() => handleEditClient(formData.client_id)} className="text-xs font-bold text-gray-400 hover:text-white flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
                        <Pencil size={14} /> Editar
                      </button>
                    )}
                    <button onClick={() => { setClientData({ id: "", name: "", phone: "", email: "", notes: "", fiscal_condition: "", cuit: "", is_active: true }); setShowClientForm(true); }} className="text-xs font-bold text-stampa-orange hover:text-[#ff7a1a] flex items-center gap-1.5 px-3 py-1.5 bg-stampa-orange/10 border border-[#ff6a00]/20 rounded-lg transition-colors">
                      <UserPlus size={14} /> Nuevo
                    </button>
                  </div>
                )}
              </div>

              {!showClientForm ? (
                <div className="max-w-md">
                  <Combobox
                    options={clients.map(c => ({ id: c.id, label: c.name }))}
                    value={formData.client_id}
                    onChange={(val) => setFormData({ ...formData, client_id: val.toString() })}
                    placeholder="Seleccioná o buscá un cliente..."
                    emptyText="No se encontraron clientes."
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-stampa-bg-soft p-5 rounded-xl border border-stampa-border shadow-inner">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Nombre completo *</label>
                    <input type="text" placeholder="Ej. Juan Pérez" value={clientData.name} onChange={e => setClientData({ ...clientData, name: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Teléfono</label>
                    <input type="text" placeholder="Ej. +54 9 11..." value={clientData.phone} onChange={e => setClientData({ ...clientData, phone: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Email</label>
                    <input type="email" placeholder="Ej. juan@mail.com" value={clientData.email} onChange={e => setClientData({ ...clientData, email: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">CUIT</label>
                    <input type="text" placeholder="Ej. 20-12345678-9" value={clientData.cuit} onChange={e => setClientData({ ...clientData, cuit: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Condición Fiscal</label>
                    <select value={clientData.fiscal_condition} onChange={e => setClientData({ ...clientData, fiscal_condition: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]">
                      <option value="">Consumidor Final</option>
                      <option value="Responsable Inscripto">Responsable Inscripto</option>
                      <option value="Monotributo">Monotributo</option>
                      <option value="Exento">Exento</option>
                    </select>
                  </div>
                  <div className="flex items-center mt-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={clientData.is_active} onChange={e => setClientData({ ...clientData, is_active: e.target.checked })} className="rounded bg-stampa-surface border-white/20 text-stampa-orange focus:ring-[#ff6a00]" />
                      <span className="text-sm text-gray-300 font-medium">Cliente Activo</span>
                    </label>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Notas del cliente</label>
                    <input type="text" placeholder="Ej. Entregar de 10 a 14hs" value={clientData.notes} onChange={e => setClientData({ ...clientData, notes: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                  </div>
                  <div className="md:col-span-2 flex justify-end gap-3 mt-4 pt-4 border-t border-stampa-border">
                    <button onClick={handleCancelClientForm} className="text-sm font-bold text-gray-400 hover:text-white px-4 py-2 transition-colors">Cancelar</button>
                    <button onClick={handleSaveClient} className="text-sm font-bold bg-stampa-orange hover:bg-stampa-orange-hover text-white px-5 py-2 rounded-xl transition-colors shadow-lg shadow-[#ff6a00]/10">Guardar Cliente</button>
                  </div>
                </div>
              )}
            </Card>

            {/* 2. Productos e Items */}
            <Card className="p-6 sm:p-8 bg-stampa-surface border-stampa-border shadow-lg">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 border-b border-stampa-border pb-3 gap-3">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">Productos e items</h3>
                  <p className="text-sm text-gray-400 mt-1">Agregá los productos para este presupuesto.</p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button type="button" onClick={() => {
                    setProductData({
                      name: "", description: "", image_url: "", filament_id: filaments.length > 0 ? filaments[0].id : "",
                      grams: 0, print_time_hours: 0, print_time_minutes: 0, base_cost: 0, sale_price: 0, stock_quantity: 0
                    });
                    setShowProductModal(true);
                  }} className="flex-1 sm:flex-none text-xs font-bold text-gray-300 hover:text-white bg-stampa-bg-soft border border-stampa-border px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5">
                    <Plus size={14} /> Nuevo en catálogo
                  </button>
                  <button type="button" onClick={handleAddItem} className="flex-1 sm:flex-none text-xs font-bold text-stampa-orange hover:text-[#ff7a1a] bg-stampa-orange/10 border border-[#ff6a00]/20 px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5">
                    <ShoppingCart size={14} /> Agregar Item
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {budgetItems.length === 0 ? (
                  <div className="text-center py-8 bg-stampa-bg-soft rounded-xl border border-dashed border-stampa-border flex flex-col items-center gap-3">
                    <Package size={32} className="text-gray-600" />
                    <div>
                      <p className="text-sm text-gray-400 font-medium">No hay productos en esta cotización.</p>
                      <p className="text-xs text-gray-500 mt-1">Agregá un item para empezar a calcular el total.</p>
                    </div>
                  </div>
                ) : (
                  budgetItems.map((item, idx) => (
                    <div key={item.id} className="flex flex-col lg:flex-row items-start lg:items-center gap-3 bg-stampa-bg-soft p-3 rounded-xl border border-stampa-border relative group">
                      <div className="w-full lg:flex-1">
                        <Combobox
                          options={products.map(p => ({ id: p.id, label: `${p.name} ($${p.sale_price})` }))}
                          value={item.product_id}
                          onChange={(val) => handleItemChange(idx, "product_id", val)}
                        />
                      </div>
                      <div className="flex items-center justify-between lg:justify-end gap-4 w-full lg:w-auto mt-1 lg:mt-0">
                        <div className="flex items-center gap-2 bg-stampa-surface px-2 py-1.5 rounded-lg border border-stampa-border">
                          <span className="text-[10px] text-gray-500 font-bold uppercase">Cant</span>
                          <input type="number" min="1" value={item.quantity} onChange={(e) => handleItemChange(idx, "quantity", e.target.value)} className="w-16 text-sm font-bold border-none bg-transparent focus:ring-0 text-white p-0 text-center" />
                        </div>
                        <div className="flex items-center gap-3 bg-stampa-surface px-3 py-1.5 rounded-lg border border-stampa-border min-w-[120px] justify-between">
                          <span className="text-[10px] text-gray-500 font-bold uppercase">Sub</span>
                          <span className="font-bold text-white text-sm">${item.subtotal.toFixed(2)}</span>
                        </div>
                        <button onClick={() => handleRemoveItem(idx)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors" title="Eliminar item">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* 3. Notas y Validez */}
            <Card className="p-6 sm:p-8 bg-stampa-surface border-stampa-border shadow-lg">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-bold text-white mb-4 border-b border-stampa-border pb-2">Información adicional</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5">Título / Referencia *</label>
                      <input type="text" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" placeholder="Ej. Presupuesto Macetas" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5">Notas (visibles en PDF)</label>
                      <textarea rows={3} value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" placeholder="Detalles de entrega, condiciones..."></textarea>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white mb-4 border-b border-stampa-border pb-2">Control</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5"><Clock size={14} /> Fecha de Validez</label>
                      <input type="date" value={formData.valid_until ? formData.valid_until.substring(0, 10) : ""} onChange={e => setFormData({ ...formData, valid_until: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00] [color-scheme:dark]" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5">Estado</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-stampa-bg-soft p-1.5 rounded-xl border border-stampa-border">
                        <button type="button" onClick={() => setFormData({ ...formData, status: "draft" })} className={`text-[11px] py-2 px-1 rounded-lg font-bold transition-all uppercase tracking-wider ${formData.status === "draft" ? "bg-[#222] text-white shadow-sm border border-stampa-border" : "text-gray-500 hover:text-gray-300"}`}>Borrador</button>
                        <button type="button" onClick={() => setFormData({ ...formData, status: "sent" })} className={`text-[11px] py-2 px-1 rounded-lg font-bold transition-all uppercase tracking-wider ${formData.status === "sent" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : "text-gray-500 hover:text-gray-300"}`}>Enviado</button>
                        <button type="button" onClick={() => setFormData({ ...formData, status: "approved" })} className={`text-[11px] py-2 px-1 rounded-lg font-bold transition-all uppercase tracking-wider ${formData.status === "approved" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "text-gray-500 hover:text-gray-300"}`}>Aprobado</button>
                        <button type="button" onClick={() => setFormData({ ...formData, status: "rejected" })} className={`text-[11px] py-2 px-1 rounded-lg font-bold transition-all uppercase tracking-wider ${formData.status === "rejected" ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "text-gray-500 hover:text-gray-300"}`}>Rechazado</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

          </div>

          {/* COLUMNA TOTALES Y ACCIONES (Sticky) */}
          <div className="lg:col-span-1 lg:sticky lg:top-6 space-y-4">
            <Card className="p-6 bg-stampa-bg-soft border-[#ff6a00]/30 shadow-xl overflow-hidden relative">
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#ff6a00] to-transparent opacity-50" />

              <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-stampa-border pb-3 mb-5">
                <DollarSign size={18} className="text-stampa-orange" /> Resumen
              </h3>

              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-400">Subtotal</span>
                  <span className="text-sm font-bold text-white">${subtotal.toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-center group">
                  <span className="text-sm font-medium text-gray-400 flex items-center gap-1.5"><Percent size={14} /> Descuento</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0" max="100" step="any"
                      placeholder="0"
                      value={formData.discount_percent || ""}
                      onChange={e => {
                        let val = parseFloat(e.target.value);
                        if (isNaN(val)) val = 0;
                        if (val < 0) val = 0;
                        if (val > 100) val = 100;
                        setFormData({ ...formData, discount_percent: val });
                      }}
                      className="w-16 text-right text-sm rounded-lg border border-stampa-border bg-stampa-surface px-2 py-1.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00] transition-colors"
                    />
                    <span className="text-sm font-bold text-gray-500">%</span>
                  </div>
                </div>

                {discountPercent > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-500 pl-5">Monto dto.</span>
                    <span className="text-xs font-semibold text-rose-400">-${discountAmount.toFixed(2)}</span>
                  </div>
                )}

                <div className="my-2 h-px bg-white/10" />

                <div className="flex justify-between items-end">
                  <span className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-1">TOTAL</span>
                  <span className="text-3xl font-black text-stampa-orange">${total.toFixed(2)}</span>
                </div>

                {estimatedProfit > 0 && (
                  <div className="mt-4 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 rounded-xl flex justify-between items-center">
                    <span className="text-xs font-bold text-emerald-500/80 uppercase tracking-wider">Ganancia est.</span>
                    <span className="text-sm font-black text-emerald-400">${estimatedProfit.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </Card>

            <div className="space-y-3">
              <button onClick={handleSaveBudget} className="w-full flex justify-center items-center gap-2 px-4 py-3.5 text-sm font-bold bg-stampa-orange hover:bg-stampa-orange-hover text-white rounded-xl transition-all shadow-lg shadow-[#ff6a00]/10">
                <Save size={18} /> Guardar Presupuesto
              </button>
              {editingId !== "new" && (
                <button onClick={handleDownloadPdf} disabled={isGeneratingPdf} className="w-full flex justify-center items-center gap-2 px-4 py-3 text-sm font-bold text-gray-300 hover:text-white bg-stampa-surface hover:bg-white/5 border border-stampa-border rounded-xl transition-colors disabled:opacity-50">
                  {isGeneratingPdf ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  Descargar PDF
                </button>
              )}
              <button onClick={() => setEditingId(null)} className="w-full py-3 text-sm font-bold text-gray-500 hover:text-gray-300 transition-colors">
                Cancelar y Volver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LISTADO DE PRESUPUESTOS */}
      {!editingId && budgets.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((b) => {
            const statusConf = STATUS_MAP[b.status as keyof typeof STATUS_MAP] || { label: b.status, color: "gray" };
            const statusClasses = {
              "gray": "bg-[#222] text-gray-300 border-stampa-border",
              "dark": "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
              "green": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
              "orange": "bg-rose-500/10 text-rose-400 border-rose-500/20",
            }[statusConf.color];

            return (
              <Card key={b.id} className="p-0 flex flex-col justify-between bg-stampa-surface border-stampa-border hover:border-white/20 transition-all overflow-hidden group">
                <div className="p-5 flex-1">
                  <div className="flex justify-between items-start mb-4">
                    <div className="pr-2">
                      <h4 className="font-bold text-white text-base truncate mb-1 group-hover:text-stampa-orange transition-colors">{b.title || "Sin título"}</h4>
                      <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5"><UserPlus size={12} /> {b.clients?.name || "Cliente eliminado"}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${statusClasses}`}>
                      {statusConf.label}
                    </span>
                  </div>

                  <div className="flex justify-between items-end mt-6">
                    <div>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Total</p>
                      <p className="text-xl font-black text-white">${parseFloat(b.total_amount || 0).toFixed(2)}</p>
                    </div>
                    <p className="text-xs text-gray-500 font-medium bg-stampa-bg-soft px-2 py-1 rounded border border-stampa-border">
                      {new Date(b.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 border-t border-stampa-border bg-stampa-bg-soft divide-x divide-white/5">
                  <button onClick={() => handleEdit(b)} className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
                    <Pencil size={14} /> Editar
                  </button>
                  <button
                    onClick={() => handleDownloadPdfById(b)}
                    disabled={generatingPdfId === b.id}
                    className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-stampa-orange hover:text-[#ff7a1a] hover:bg-stampa-orange/5 transition-colors disabled:opacity-50"
                  >
                    {generatingPdfId === b.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    PDF
                  </button>
                  <button onClick={() => handleDelete(b.id)} className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-gray-500 hover:text-rose-400 hover:bg-rose-500/5 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* EMPTY STATE */}
      {!editingId && budgets.length === 0 && (
        <div className="max-w-2xl mx-auto mt-12">
          <div className="bg-stampa-surface rounded-3xl p-10 text-center border border-stampa-border shadow-xl">
            <div className="w-20 h-20 bg-stampa-orange/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-[#ff6a00]/20">
              <Briefcase size={40} className="text-stampa-orange" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">Todavía no creaste presupuestos</h2>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Cuando un cliente te pida precio, creá un presupuesto detallado y descargalo en PDF para enviarlo de forma profesional.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button onClick={handleCreateNew} className="w-full sm:w-auto px-8 py-3.5 font-bold text-sm text-white bg-stampa-orange hover:bg-stampa-orange-hover rounded-xl transition-all shadow-lg shadow-[#ff6a00]/20">
                Crear mi primer presupuesto
              </button>
              <Link href="/calculadora" className="w-full sm:w-auto px-8 py-3.5 font-bold text-sm text-gray-300 hover:text-white bg-[#1a1a1a] border border-stampa-border hover:bg-white/5 rounded-xl transition-all">
                Ir a la Calculadora
              </Link>
            </div>
            <p className="mt-6 text-xs text-gray-500">¿No sabés cuánto cobrar? Calculalo primero en la Calculadora.</p>
          </div>
        </div>
      )}

      {/* Product Creation Modal */}
      {showProductModal && (
        <div className="fixed inset-0 bg-stampa-bg/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-stampa-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-stampa-border my-8 animate-in zoom-in-95 duration-200">
            <div className="bg-stampa-bg-soft px-6 py-4 flex justify-between items-center border-b border-stampa-border">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Package size={18} className="text-stampa-orange" /> Nuevo Producto Rápido
              </h3>
              <button type="button" onClick={() => setShowProductModal(false)} className="text-gray-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Nombre *</label>
                <input
                  type="text"
                  placeholder="Ej. Maceta Hexagonal"
                  value={productData.name}
                  onChange={e => setProductData({ ...productData, name: e.target.value })}
                  className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Descripción</label>
                <textarea
                  rows={2}
                  placeholder="Descripción opcional"
                  value={productData.description}
                  onChange={e => setProductData({ ...productData, description: e.target.value })}
                  className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Precio de venta *</label>
                  <input
                    type="number"
                    min="0" step="any" placeholder="Ej. 1500"
                    value={productData.sale_price || ""}
                    onChange={e => setProductData({ ...productData, sale_price: parseFloat(e.target.value) || 0 })}
                    className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Costo base</label>
                  <input
                    type="number"
                    min="0" step="any" placeholder="Opcional"
                    value={productData.base_cost || ""}
                    onChange={e => setProductData({ ...productData, base_cost: parseFloat(e.target.value) || 0 })}
                    className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Gramos</label>
                  <input
                    type="number"
                    min="0" step="any" placeholder="Opcional"
                    value={productData.grams || ""}
                    onChange={e => setProductData({ ...productData, grams: parseFloat(e.target.value) || 0 })}
                    className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Stock Inicial</label>
                  <input
                    type="number"
                    min="0" placeholder="Opcional"
                    value={productData.stock_quantity || ""}
                    onChange={e => setProductData({ ...productData, stock_quantity: parseInt(e.target.value) || 0 })}
                    className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Tiempo (Horas)</label>
                  <input
                    type="number"
                    min="0" placeholder="Horas"
                    value={productData.print_time_hours || ""}
                    onChange={e => setProductData({ ...productData, print_time_hours: parseInt(e.target.value) || 0 })}
                    className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Tiempo (Minutos)</label>
                  <input
                    type="number"
                    min="0" max="59" placeholder="Minutos"
                    value={productData.print_time_minutes || ""}
                    onChange={e => setProductData({ ...productData, print_time_minutes: parseInt(e.target.value) || 0 })}
                    className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Filamento</label>
                <select
                  value={productData.filament_id}
                  onChange={e => setProductData({ ...productData, filament_id: e.target.value })}
                  className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                >
                  <option value="">Ninguno</option>
                  {filaments.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">URL de Imagen</label>
                <input
                  type="text"
                  placeholder="Ej. https://..."
                  value={productData.image_url}
                  onChange={e => setProductData({ ...productData, image_url: e.target.value })}
                  className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                />
              </div>
            </div>

            <div className="bg-stampa-bg-soft px-6 py-4 flex justify-end gap-3 border-t border-stampa-border">
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="px-5 py-2.5 text-sm font-bold text-gray-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveProduct}
                className="px-6 py-2.5 text-sm font-bold bg-stampa-orange hover:bg-stampa-orange-hover text-white rounded-xl transition-colors shadow-lg shadow-[#ff6a00]/20"
              >
                Guardar Producto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
