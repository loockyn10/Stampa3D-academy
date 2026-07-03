"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Pencil, FileText, Trash2, Loader2, AlertCircle, Save, X, UserPlus, ShoppingCart } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
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
    discount_amount: 0,
  });
  const [budgetItems, setBudgetItems] = useState<any[]>([]);
  
  // Client Form State
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientData, setClientData] = useState({ name: "", phone: "", email: "", notes: "" });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [bRes, cRes, pRes] = await Promise.all([
      supabase.from("budgets").select("*, clients(name)").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("clients").select("*").eq("user_id", user.id).order("name", { ascending: true }),
      supabase.from("products").select("*").eq("user_id", user.id).eq("is_active", true).order("name", { ascending: true })
    ]);

    if (bRes.error) setError(bRes.error.message);
    else setBudgets(bRes.data || []);

    if (cRes.error) console.error(cRes.error);
    else setClients(cRes.data || []);

    if (pRes.error) console.error(pRes.error);
    else setProducts(pRes.data || []);

    setLoading(false);
  };

  const handleCreateNew = () => {
    setFormData({
      title: "Presupuesto", client_id: "", status: "draft", notes: "", valid_until: "", discount_amount: 0
    });
    setBudgetItems([]);
    setEditingId("new");
    setShowClientForm(false);
  };

  const handleEdit = async (b: any) => {
    setFormData({
      title: b.title || "Presupuesto", client_id: b.client_id || "", status: b.status || "draft", 
      notes: b.notes || "", valid_until: b.valid_until || "", discount_amount: b.discount_amount || 0
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
  const total = Math.max(0, subtotal - (parseFloat(String(formData.discount_amount)) || 0));

  const handleSaveBudget = async () => {
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
      discount_amount: parseFloat(String(formData.discount_amount)) || 0,
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

    const payload = {
      user_id: user.id,
      name: clientData.name,
      phone: clientData.phone,
      email: clientData.email,
      notes: clientData.notes,
      is_active: true
    };

    const { data, error } = await supabase.from("clients").insert([payload]).select().single();
    if (error) {
      alert("Error creando cliente: " + error.message);
    } else {
      setClients([...clients, data]);
      setFormData(prev => ({ ...prev, client_id: data.id }));
      setShowClientForm(false);
      setClientData({ name: "", phone: "", email: "", notes: "" });
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
                <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white">
                  <option value="draft">Borrador</option>
                  <option value="sent">Enviado</option>
                  <option value="approved">Aprobado</option>
                  <option value="rejected">Rechazado</option>
                </select>
              </div>
            </div>

            <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100 space-y-4">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-semibold text-gray-800">Cliente asociado</label>
                {!showClientForm && (
                  <button onClick={() => setShowClientForm(true)} className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1">
                    <UserPlus size={14} /> Crear cliente rápido
                  </button>
                )}
              </div>
              
              {!showClientForm ? (
                <select value={formData.client_id} onChange={e => setFormData({...formData, client_id: e.target.value})} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white">
                  <option value="">Selecciona un cliente...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white p-3 rounded-lg border border-orange-200">
                  <input type="text" placeholder="Nombre completo *" value={clientData.name} onChange={e => setClientData({...clientData, name: e.target.value})} className="text-sm border-gray-300 rounded-md" />
                  <input type="text" placeholder="Teléfono" value={clientData.phone} onChange={e => setClientData({...clientData, phone: e.target.value})} className="text-sm border-gray-300 rounded-md" />
                  <input type="email" placeholder="Email" value={clientData.email} onChange={e => setClientData({...clientData, email: e.target.value})} className="text-sm border-gray-300 rounded-md" />
                  <input type="text" placeholder="Notas del cliente" value={clientData.notes} onChange={e => setClientData({...clientData, notes: e.target.value})} className="text-sm border-gray-300 rounded-md" />
                  <div className="md:col-span-2 flex justify-end gap-2 mt-1">
                    <button onClick={() => setShowClientForm(false)} className="text-xs font-bold text-gray-500 hover:text-gray-700">Cancelar</button>
                    <button onClick={handleSaveClient} className="text-xs font-bold bg-orange-100 text-orange-700 px-3 py-1.5 rounded hover:bg-orange-200">Guardar Cliente</button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-end border-b border-gray-200 pb-2">
                <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2"><ShoppingCart size={16} /> Productos a Cotizar</h4>
                <button onClick={handleAddItem} className="text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-2 py-1 rounded border border-orange-200">+ Agregar Producto</button>
              </div>

              {products.length === 0 ? (
                <div className="text-center py-4 bg-gray-50 rounded-lg text-sm text-gray-500">
                  No tienes productos creados. <Link href="/productos" className="text-orange-500 font-bold hover:underline">Ve a crear uno</Link>.
                </div>
              ) : (
                <div className="space-y-2">
                  {budgetItems.length === 0 && <p className="text-xs text-gray-400 italic">No hay productos en esta cotización.</p>}
                  
                  {budgetItems.map((item, idx) => (
                    <div key={item.id} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-100">
                      <select value={item.product_id} onChange={(e) => handleItemChange(idx, "product_id", e.target.value)} className="flex-1 text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white">
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} (${p.sale_price})</option>)}
                      </select>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
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
                  <span className="text-gray-500 font-medium">Descuento ($ Fijo)</span>
                  <input type="number" min="0" value={formData.discount_amount} onChange={e => setFormData({...formData, discount_amount: parseFloat(e.target.value)||0})} className="w-24 text-right text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900 bg-white" />
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
    </div>
  );
}
