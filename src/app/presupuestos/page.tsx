"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Pencil, FileText, Trash2, Loader2, AlertCircle, Save, X, UserPlus, ShoppingCart } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { SectionTitle } from "@/components/ui/section-title";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/utils/supabase/client";

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

    const [bRes, cRes, pRes, filRes] = await Promise.all([
      supabase.from("budgets").select("*, clients(name)").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("clients").select("*").eq("user_id", user.id).order("name", { ascending: true }),
      supabase.from("products").select("*").eq("user_id", user.id).eq("is_active", true).order("name", { ascending: true }),
      supabase.from("filaments").select("*").eq("user_id", user.id).eq("is_active", true).order("name", { ascending: true })
    ]);

    if (bRes.error) setError(bRes.error.message);
    else setBudgets(bRes.data || []);

    if (cRes.error) console.error(cRes.error);
    else setClients(cRes.data || []);

    if (pRes.error) console.error(pRes.error);
    else setProducts(pRes.data || []);

    if (filRes.error) console.error(filRes.error);
    else setFilaments(filRes.data || []);

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
    setBudgetItems([...budgetItems, {
      id: "temp-" + Date.now(),
      product_id: p.id,
      item_name: p.name,
      quantity: 1,
      unit_price: p.sale_price || 0,
      subtotal: p.sale_price || 0
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
        newItems[index] = { 
          ...newItems[index], 
          product_id: p.id, 
          item_name: p.name, 
          unit_price: p.sale_price || 0,
          subtotal: (p.sale_price || 0) * newItems[index].quantity
        };
      }
    } else if (field === "quantity") {
      const qty = parseInt(value) || 1;
      newItems[index].quantity = qty;
      newItems[index].subtotal = qty * newItems[index].unit_price;
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
      subtotal: item.subtotal
    }));

    const { error: itemsError } = await supabase.from("budget_items").insert(itemsPayload);
    if (itemsError) return setError(itemsError.message);

    // Refresh data
    await fetchData();
    setEditingId(null);
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

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Presupuestos"
        action={
          <PrimaryButton onClick={handleCreateNew} disabled={editingId !== null}>
            <Plus size={15} /> Nuevo presupuesto
          </PrimaryButton>
        }
      />

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {editingId && (
        <Card className="mb-8 border-orange-300 shadow-md ring-1 ring-orange-100 overflow-hidden">
          <div className="bg-gray-50 p-4 flex justify-between items-center border-b border-gray-200">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <FileText size={18} className="text-orange-500" />
              {editingId === "new" ? "Nuevo Presupuesto" : "Editar Presupuesto"}
            </h3>
            <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
          </div>

          <div className="p-5 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Título / Referencia</label>
                <input type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="Ej. Presupuesto Macetas" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Estado</label>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  <button type="button" onClick={() => setFormData({...formData, status: "draft"})} className={`flex-1 text-xs py-1.5 px-2 rounded-md font-medium transition-colors ${formData.status === "draft" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>Borrador</button>
                  <button type="button" onClick={() => setFormData({...formData, status: "sent"})} className={`flex-1 text-xs py-1.5 px-2 rounded-md font-medium transition-colors ${formData.status === "sent" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>Enviado</button>
                  <button type="button" onClick={() => setFormData({...formData, status: "approved"})} className={`flex-1 text-xs py-1.5 px-2 rounded-md font-medium transition-colors ${formData.status === "approved" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>Aprobado</button>
                  <button type="button" onClick={() => setFormData({...formData, status: "rejected"})} className={`flex-1 text-xs py-1.5 px-2 rounded-md font-medium transition-colors ${formData.status === "rejected" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>Rechazado</button>
                </div>
              </div>
            </div>

            <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100 space-y-4">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-semibold text-gray-800">Cliente asociado</label>
                {!showClientForm && (
                  <div className="flex items-center gap-3">
                    {formData.client_id && (
                      <button onClick={() => handleEditClient(formData.client_id)} className="text-xs font-bold text-gray-600 hover:text-gray-900 flex items-center gap-1">
                        <Pencil size={12} /> Editar cliente
                      </button>
                    )}
                    <button onClick={() => { setClientData({ id: "", name: "", phone: "", email: "", notes: "", fiscal_condition: "", cuit: "", is_active: true }); setShowClientForm(true); }} className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1">
                      <UserPlus size={14} /> Crear rápido
                    </button>
                  </div>
                )}
              </div>
              
              {!showClientForm ? (
                <Combobox 
                  options={clients.map(c => ({ id: c.id, label: c.name }))}
                  value={formData.client_id}
                  onChange={(val) => setFormData({...formData, client_id: val.toString()})}
                  placeholder="Selecciona o busca un cliente..."
                  emptyText="No se encontraron clientes."
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white p-4 rounded-lg border border-orange-200 shadow-sm">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nombre completo *</label>
                    <input type="text" placeholder="Ej. Juan Pérez" value={clientData.name} onChange={e => setClientData({...clientData, name: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Teléfono</label>
                    <input type="text" placeholder="Ej. +54 9 11..." value={clientData.phone} onChange={e => setClientData({...clientData, phone: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Email</label>
                    <input type="email" placeholder="Ej. juan@mail.com" value={clientData.email} onChange={e => setClientData({...clientData, email: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">CUIT</label>
                    <input type="text" placeholder="Ej. 20-12345678-9" value={clientData.cuit} onChange={e => setClientData({...clientData, cuit: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Condición Fiscal</label>
                    <select value={clientData.fiscal_condition} onChange={e => setClientData({...clientData, fiscal_condition: e.target.value})} className="w-full text-sm border-gray-300 rounded-md text-gray-900 bg-white">
                      <option value="">Consumidor Final</option>
                      <option value="Responsable Inscripto">Responsable Inscripto</option>
                      <option value="Monotributo">Monotributo</option>
                      <option value="Exento">Exento</option>
                    </select>
                  </div>
                  <div className="flex items-center mt-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={clientData.is_active} onChange={e => setClientData({...clientData, is_active: e.target.checked})} className="rounded text-orange-500 focus:ring-orange-500" />
                      <span className="text-sm text-gray-700 font-medium">Cliente Activo</span>
                    </label>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Notas del cliente</label>
                    <input type="text" placeholder="Ej. Entregar de 10 a 14hs" value={clientData.notes} onChange={e => setClientData({...clientData, notes: e.target.value})} className="w-full text-sm border-gray-300 rounded-md" />
                  </div>
                  <div className="md:col-span-2 flex justify-end gap-2 mt-2">
                    <button onClick={handleCancelClientForm} className="text-sm font-bold text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancelar</button>
                    <button onClick={handleSaveClient} className="text-sm font-bold bg-orange-100 text-orange-700 px-4 py-1.5 rounded-md hover:bg-orange-200">Guardar Cliente</button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-end border-b border-gray-200 pb-2">
                <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2"><ShoppingCart size={16} /> Productos a Cotizar</h4>
                <div className="flex gap-2">
                  <button type="button" onClick={() => {
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
                    setShowProductModal(true);
                  }} className="text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-2 py-1 rounded border border-orange-200">Nuevo Producto</button>
                  <button type="button" onClick={handleAddItem} className="text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-2 py-1 rounded border border-orange-200">+ Agregar Producto</button>
                </div>
              </div>

              {products.length === 0 ? (
                <div className="text-center py-4 bg-gray-50 rounded-lg text-sm text-gray-500 flex flex-col items-center gap-2">
                  <span>No tenés productos cargados.</span>
                  <button type="button" onClick={() => {
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
                    setShowProductModal(true);
                  }} className="text-xs font-bold bg-orange-100 text-orange-700 px-3 py-1.5 rounded hover:bg-orange-200">Crear nuevo producto</button>
                </div>
              ) : (
                <div className="space-y-2">
                  {budgetItems.length === 0 && <p className="text-xs text-gray-400 italic">No hay productos en esta cotización.</p>}
                  
                  {budgetItems.map((item, idx) => (
                    <div key={item.id} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-100">
                      <Combobox
                        options={products.map(p => ({ id: p.id, label: `${p.name} ($${p.sale_price})` }))}
                        value={item.product_id}
                        onChange={(val) => handleItemChange(idx, "product_id", val)}
                        className="flex-1 w-full sm:w-auto"
                      />
                      <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                        <span className="text-xs text-gray-500 font-semibold">Cant:</span>
                        <input type="number" min="1" value={item.quantity} onChange={(e) => handleItemChange(idx, "quantity", e.target.value)} className="w-16 text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
                        <span className="text-xs text-gray-500 font-semibold ml-2">Sub:</span>
                        <span className="w-20 font-bold text-gray-900">${item.subtotal.toFixed(2)}</span>
                        <button onClick={() => handleRemoveItem(idx)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Notas del presupuesto</label>
                  <textarea rows={3} value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" placeholder="Detalles de entrega, condiciones..."></textarea>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Fecha de Validez (Opcional)</label>
                  <input type="date" value={formData.valid_until ? formData.valid_until.substring(0,10) : ""} onChange={e => setFormData({...formData, valid_until: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col justify-end space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500 font-medium">Subtotal</span>
                  <span className="text-gray-900 font-bold">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500 font-medium">Descuento (%)</span>
                  <input 
                    type="number" 
                    min="0" 
                    max="100" 
                    step="any"
                    placeholder="Ej: 15"
                    value={formData.discount_percent || ""} 
                    onChange={e => {
                      let val = parseFloat(e.target.value);
                      if (isNaN(val)) val = 0;
                      if (val < 0) val = 0;
                      if (val > 100) val = 100;
                      setFormData({...formData, discount_percent: val});
                    }}
                    className="w-24 text-right text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                  />
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500 font-medium">Descuento</span>
                  <span className="text-gray-900 font-semibold">
                    {discountPercent}% {discountPercent > 0 ? `(-$${discountAmount.toFixed(2)})` : ""}
                  </span>
                </div>
                <div className="border-t border-gray-200 pt-2 flex justify-between items-center">
                  <span className="text-lg font-bold text-gray-900">TOTAL</span>
                  <span className="text-2xl font-black text-orange-600">${total.toFixed(2)}</span>
                </div>
              </div>
            </div>

          </div>
          
          <div className="bg-gray-50 p-4 border-t border-gray-200 flex justify-end gap-2">
            <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
            <button onClick={handleSaveBudget} className="flex items-center gap-2 px-6 py-2 text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors">
              <Save size={16} /> Guardar Presupuesto
            </button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {budgets.map((b) => (
          <Card key={b.id} className="p-5 flex flex-col justify-between hover:border-orange-200 transition-colors">
            <div>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="font-bold text-gray-900 text-sm truncate">{b.title || "Sin título"}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">{b.clients?.name || "Cliente eliminado"}</p>
                </div>
                <Badge tone={STATUS_MAP[b.status as keyof typeof STATUS_MAP]?.color || "gray"} className="text-[10px]">
                  {STATUS_MAP[b.status as keyof typeof STATUS_MAP]?.label || b.status}
                </Badge>
              </div>
              <p className="text-xs text-gray-400 mb-4">{new Date(b.created_at).toLocaleDateString()}</p>
            </div>
            
            <div className="border-t border-gray-100 pt-3">
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-semibold text-gray-500">Total</span>
                <span className="text-lg font-black text-gray-900">${parseFloat(b.total_amount || 0).toFixed(2)}</span>
              </div>
              <div className="flex gap-2">
                <GhostButton onClick={() => handleEdit(b)} className="flex-1 py-2 text-xs text-gray-700 bg-white border border-gray-200">
                  <Pencil size={13} /> Editar
                </GhostButton>
                <GhostButton onClick={() => handleDelete(b.id)} className="px-2.5 py-2 text-red-500 hover:bg-red-50 border border-gray-200 bg-white">
                  <Trash2 size={13} />
                </GhostButton>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {budgets.length === 0 && !editingId && (
        <div className="py-20 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300 mt-6">
          <p className="text-sm text-gray-500 font-medium">No tienes presupuestos creados.</p>
          <PrimaryButton onClick={handleCreateNew} className="mt-4">Crear mi primer presupuesto</PrimaryButton>
        </div>
      )}

      {/* Product Creation Modal */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-gray-200 my-8">
            <div className="bg-gray-50 px-5 py-4 flex justify-between items-center border-b border-gray-200">
              <h3 className="text-base font-bold text-gray-900">Nuevo Producto Rápido</h3>
              <button type="button" onClick={() => setShowProductModal(false)} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre *</label>
                <input 
                  type="text" 
                  placeholder="Ej. Maceta Hexagonal" 
                  value={productData.name} 
                  onChange={e => setProductData({...productData, name: e.target.value})} 
                  className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descripción</label>
                <textarea 
                  rows={2}
                  placeholder="Descripción opcional" 
                  value={productData.description} 
                  onChange={e => setProductData({...productData, description: e.target.value})} 
                  className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Precio de venta *</label>
                  <input 
                    type="number" 
                    min="0"
                    step="any"
                    placeholder="Ej. 1500" 
                    value={productData.sale_price || ""} 
                    onChange={e => setProductData({...productData, sale_price: parseFloat(e.target.value) || 0})} 
                    className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Costo base</label>
                  <input 
                    type="number" 
                    min="0"
                    step="any"
                    placeholder="Opcional" 
                    value={productData.base_cost || ""} 
                    onChange={e => setProductData({...productData, base_cost: parseFloat(e.target.value) || 0})} 
                    className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Gramos</label>
                  <input 
                    type="number" 
                    min="0"
                    step="any"
                    placeholder="Opcional" 
                    value={productData.grams || ""} 
                    onChange={e => setProductData({...productData, grams: parseFloat(e.target.value) || 0})} 
                    className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Stock Inicial</label>
                  <input 
                    type="number" 
                    min="0"
                    placeholder="Opcional" 
                    value={productData.stock_quantity || ""} 
                    onChange={e => setProductData({...productData, stock_quantity: parseInt(e.target.value) || 0})} 
                    className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tiempo (Horas)</label>
                  <input 
                    type="number" 
                    min="0"
                    placeholder="Horas" 
                    value={productData.print_time_hours || ""} 
                    onChange={e => setProductData({...productData, print_time_hours: parseInt(e.target.value) || 0})} 
                    className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tiempo (Minutos)</label>
                  <input 
                    type="number" 
                    min="0"
                    max="59"
                    placeholder="Minutos" 
                    value={productData.print_time_minutes || ""} 
                    onChange={e => setProductData({...productData, print_time_minutes: parseInt(e.target.value) || 0})} 
                    className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Filamento</label>
                <select 
                  value={productData.filament_id} 
                  onChange={e => setProductData({...productData, filament_id: e.target.value})} 
                  className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white"
                >
                  <option value="">Ninguno</option>
                  {filaments.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">URL de Imagen</label>
                <input 
                  type="text" 
                  placeholder="Ej. https://..." 
                  value={productData.image_url} 
                  onChange={e => setProductData({...productData, image_url: e.target.value})} 
                  className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" 
                />
              </div>
            </div>

            <div className="bg-gray-50 px-5 py-4 flex justify-end gap-2 border-t border-gray-200">
              <button 
                type="button" 
                onClick={() => setShowProductModal(false)} 
                className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                type="button" 
                onClick={handleSaveProduct} 
                className="px-6 py-2 text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
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
