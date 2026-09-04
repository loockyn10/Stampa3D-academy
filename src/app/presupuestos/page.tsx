"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus, Pencil, FileText, Trash2, Loader2, AlertCircle, Save, X, UserPlus, ShoppingCart, Download, Briefcase, Settings, ArrowLeft, Package, Clock, Percent, DollarSign, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { SectionTitle } from "@/components/ui/section-title";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { createClient } from "@/utils/supabase/client";
import {
  findStampyNamedMatch,
  parsePositiveStampyPrefillNumber,
} from "@/lib/stampy/tool-prefill";
import { useAppFeedback } from "@/components/ui/app-feedback";
import {
  buildBudgetItemFromProduct,
  normalizeBudgetItemEconomics,
} from "@/lib/budgets/items";
import {
  BUDGET_TAX_RATES,
  buildAutomaticBudgetTitle,
  calculateBudgetDeposit,
  calculateBudgetTotals,
  getDefaultBudgetValidUntil,
  normalizeBudgetMode,
  normalizeBudgetTaxRate,
  type BudgetMode,
  type BudgetDepositType,
  type BudgetTaxRate,
} from "@/lib/budgets/calculation";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";


const STATUS_MAP: Record<string, { label: string, color: "gray" | "dark" | "green" | "orange" }> = {
  draft: { label: "Borrador", color: "gray" },
  sent: { label: "Enviado", color: "dark" },
  approved: { label: "Aprobado", color: "green" },
  rejected: { label: "Rechazado", color: "orange" },
};

interface BudgetFormData {
  title: string;
  client_id: string;
  status: string;
  notes: string;
  valid_until: string;
  discount_percent: number;
  budget_type: BudgetMode;
  tax_rate: BudgetTaxRate;
  payment_terms: string;
  delivery_time: string;
  delivery_time_option: string;
  delivery_method: string;
  commercial_conditions: string;
  client_reference: string;
  payment_method: string;
  deposit_type: BudgetDepositType;
  deposit_value: number;
  additional_charges: number;
  warranty: string;
  warranty_option: string;
  warranty_conditions: string;
}

interface BudgetClientSnapshot {
  name: string;
  cuit: string;
  fiscal_condition: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  contact_person: string;
}

const PAYMENT_METHODS = [
  ["", "Sin especificar"], ["transfer", "Transferencia"], ["cash", "Efectivo"],
  ["cash_payment", "Contado"], ["prepaid", "100% anticipado"],
  ["half_upfront", "50% anticipo / 50% contra entrega"], ["to_agree", "A convenir"],
  ["custom", "Personalizado"],
] as const;

const DELIVERY_TIMES = ["", "24/48 hs", "3 días hábiles", "5 días hábiles", "7 días hábiles", "10 días hábiles", "15 días hábiles", "custom"] as const;
const WARRANTIES = ["", "Sin garantía específica", "30 días", "60 días", "90 días", "custom"] as const;

const emptyClientSnapshot = (): BudgetClientSnapshot => ({
  name: "", cuit: "", fiscal_condition: "", email: "", phone: "", address: "",
  city: "", province: "", postal_code: "", contact_person: "",
});

const clientToSnapshot = (client: any): BudgetClientSnapshot => ({
  name: client?.name || "",
  cuit: client?.cuit || "",
  fiscal_condition: client?.fiscal_condition || "",
  email: client?.email || "",
  phone: client?.phone || "",
  address: client?.address || "",
  city: client?.city || "",
  province: client?.province || "",
  postal_code: client?.postal_code || "",
  contact_person: client?.contact_person || "",
});

const emptyBudgetForm = (budgetType: BudgetMode = "quick"): BudgetFormData => ({
  title: "",
  client_id: "",
  status: "draft",
  notes: "",
  valid_until: "",
  discount_percent: 0,
  budget_type: budgetType,
  tax_rate: 0,
  payment_terms: "",
  delivery_time: "",
  delivery_time_option: "",
  delivery_method: "",
  commercial_conditions: "",
  client_reference: "",
  payment_method: "",
  deposit_type: "none",
  deposit_value: 0,
  additional_charges: 0,
  warranty: "",
  warranty_option: "",
  warranty_conditions: "",
});

const emptyClientForm = () => ({
  id: "",
  name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  province: "",
  postal_code: "",
  contact_person: "",
  notes: "",
  fiscal_condition: "",
  cuit: "",
  is_active: true,
});

function PresupuestosPageContent() {
  const { toast, confirmAction } = useAppFeedback();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [supabase] = useState(() => createClient());
  const prefillAppliedRef = useRef(false);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [filaments, setFilaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  const [showModePicker, setShowModePicker] = useState(false);
  const [isTitleAutomatic, setIsTitleAutomatic] = useState(true);

  // Profile
  const [profile, setProfile] = useState<any>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<BudgetFormData>(() => emptyBudgetForm());
  const [budgetItems, setBudgetItems] = useState<any[]>([]);
  const [clientSnapshot, setClientSnapshot] = useState<BudgetClientSnapshot>(() => emptyClientSnapshot());

  // Client Form State
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientData, setClientData] = useState(() => emptyClientForm());

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
    if (!user) {
      setLoading(false);
      return;
    }

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

  const handleCreateNew = () => setShowModePicker(true);

  const startNewBudget = (budgetType: BudgetMode) => {
    setPrefillNotice(null);
    setFormData({
      ...emptyBudgetForm(budgetType),
      valid_until: getDefaultBudgetValidUntil(),
    });
    setIsTitleAutomatic(true);
    setClientSnapshot(emptyClientSnapshot());
    setBudgetItems([]);
    setEditingId("new");
    setShowClientForm(false);
    setShowModePicker(false);
  };

  // Stampy Prefill Effect
  useEffect(() => {
    const action = searchParams.get("action");
    if (action !== "new") {
      prefillAppliedRef.current = false;
      return;
    }
    if (loading || prefillAppliedRef.current) return;

    prefillAppliedRef.current = true;
    const clientName = searchParams.get("client")?.trim() || null;
    const productName = searchParams.get("product")?.trim() || null;
    const requestedTitle = searchParams.get("title")?.trim() || null;
    const requestedNotes = searchParams.get("notes")?.trim() || "";
    const quantityParam = searchParams.get("quantity");
    const quantity = Number(parsePositiveStampyPrefillNumber(quantityParam) || 1);
    const notices: string[] = [];

    const matchedClient = findStampyNamedMatch(clients, clientName);
    const matchedProduct = findStampyNamedMatch(products, productName);

    if (process.env.NODE_ENV !== "production") {
      console.log("[Quotes Prefill]", {
        action,
        client: clientName,
        product: productName,
        quantity,
        clientsLoaded: clients.length,
        productsLoaded: products.length,
        matchedClient: matchedClient?.name || null,
        matchedProduct: matchedProduct?.name || null,
      });
    }

    if (clientName && !matchedClient) {
      setClientData({
        ...emptyClientForm(),
        name: clientName,
      });
      notices.push("No encontré este cliente cargado. Podés crearlo o seleccionarlo manualmente.");
    }

    setFormData({
      ...emptyBudgetForm("quick"),
      title: requestedTitle || buildAutomaticBudgetTitle(clientName),
      client_id: matchedClient?.id || "",
      notes: requestedNotes,
      valid_until: getDefaultBudgetValidUntil(),
    });
    setIsTitleAutomatic(!requestedTitle);
    setClientSnapshot(clientToSnapshot(matchedClient));

    const initialItems: any[] = [];
    if (matchedProduct) {
      const builtItem = buildBudgetItemFromProduct(matchedProduct, quantity);
      if (builtItem.success) initialItems.push(builtItem.item);
      else notices.push(builtItem.error);
    } else if (productName) {
      notices.push("No encontré este producto cargado. Seleccionalo manualmente o crealo antes de confirmar.");
    }

    setBudgetItems(initialItems);
    setEditingId("new");
    setShowClientForm(Boolean(clientName && !matchedClient));
    setPrefillNotice(notices.length > 0 ? notices.join(" ") : null);

    const cleanedParams = new URLSearchParams(searchParams.toString());
    for (const param of ["action", "client", "product", "quantity", "title", "notes"]) {
      cleanedParams.delete(param);
    }
    const cleanedQuery = cleanedParams.toString();
    window.history.replaceState(null, "", cleanedQuery ? `${pathname}?${cleanedQuery}` : pathname);
  }, [searchParams, loading, pathname, clients, products]);

  const handleEdit = async (b: any) => {
    setIsTitleAutomatic(false);
    setFormData({
      title: b.title || "", client_id: b.client_id || "", status: b.status || "draft",
      notes: b.notes || "", valid_until: b.valid_until || "", discount_percent: b.discount_percent || 0,
      budget_type: normalizeBudgetMode(b.budget_type),
      tax_rate: normalizeBudgetTaxRate(b.tax_rate),
      payment_terms: b.payment_terms || "",
      delivery_time: b.delivery_time || "",
      delivery_time_option: DELIVERY_TIMES.includes(b.delivery_time) ? b.delivery_time : (b.delivery_time ? "custom" : ""),
      delivery_method: b.delivery_method || "",
      commercial_conditions: b.commercial_conditions || "",
      client_reference: b.client_reference || "",
      payment_method: b.payment_method || (b.payment_terms ? "custom" : ""),
      deposit_type: ["percent", "fixed"].includes(b.deposit_type) ? b.deposit_type : "none",
      deposit_value: Number(b.deposit_value) || 0,
      additional_charges: Number(b.additional_charges) || 0,
      warranty: b.warranty || "",
      warranty_option: WARRANTIES.includes(b.warranty) ? b.warranty : (b.warranty ? "custom" : ""),
      warranty_conditions: b.warranty_conditions || "",
    });
    const masterClient = clients.find((client) => client.id === b.client_id);
    setClientSnapshot(b.client_snapshot && typeof b.client_snapshot === "object"
      ? { ...emptyClientSnapshot(), ...b.client_snapshot }
      : clientToSnapshot(masterClient));

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

  useEffect(() => {
    if (editingId !== "new" || !isTitleAutomatic) return;
    const automaticTitle = formData.client_id ? buildAutomaticBudgetTitle(clientSnapshot.name) : "";
    setFormData((current) => current.title === automaticTitle
      ? current
      : { ...current, title: automaticTitle });
  }, [clientSnapshot.name, editingId, formData.client_id, isTitleAutomatic]);

  const handleTitleChange = (value: string) => {
    setIsTitleAutomatic(value.trim().length === 0);
    setFormData((current) => ({ ...current, title: value }));
  };

  const handleClientSelection = (clientId: string) => {
    const selectedClient = clients.find((client) => client.id === clientId);
    setFormData((current) => ({ ...current, client_id: clientId }));
    setClientSnapshot(clientToSnapshot(selectedClient));
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirmAction({
      title: "Eliminar presupuesto",
      description: "¿Seguro que querés eliminar este presupuesto? Esta acción no se puede deshacer.",
      confirmLabel: "Eliminar presupuesto",
      destructive: true,
    });
    if (!confirmed) return;
    const { error: itemsError } = await supabase.from("budget_items").delete().eq("budget_id", id);
    if (!itemsError) {
      const { error } = await supabase.from("budgets").delete().eq("id", id);
      if (error) toast.error("Error: " + error.message);
      else setBudgets(budgets.filter(b => b.id !== id));
    }
  };

  const handleAddItem = () => {
    if (products.length === 0) return toast.info("No tenés productos activos para agregar.");
    const builtItem = buildBudgetItemFromProduct(products[0]);
    if (!builtItem.success) return toast.error(builtItem.error);
    setBudgetItems((current) => [...current, builtItem.item]);
  };

  const handleRemoveItem = (index: number) => {
    setBudgetItems(budgetItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...budgetItems];
    if (field === "product_id") {
      const p = products.find(prod => prod.id === value);
      if (p) {
        const qty = newItems[index].quantity || 1;
        const builtItem = buildBudgetItemFromProduct(p, qty, newItems[index].id);
        if (!builtItem.success) return toast.error(builtItem.error);
        newItems[index] = builtItem.item;
      }
    } else if (field === "quantity") {
      const qty = parseInt(value) || 1;
      const normalizedItem = normalizeBudgetItemEconomics({ ...newItems[index], quantity: qty });
      if (!normalizedItem.success) return toast.error(normalizedItem.error);
      newItems[index] = normalizedItem.item;
    } else if (field === "unit_price") {
      const price = parseFloat(value) || 0;
      const normalizedItem = normalizeBudgetItemEconomics({ ...newItems[index], unit_price: price });
      if (!normalizedItem.success) return toast.error(normalizedItem.error);
      newItems[index] = normalizedItem.item;
    } else {
      newItems[index][field] = value;
    }
    setBudgetItems(newItems);
  };

  const subtotal = budgetItems.reduce((acc, item) => acc + (item.subtotal || 0), 0);
  const estimatedProfit = budgetItems.reduce((acc, item) => acc + (item.total_profit || 0), 0);
  const discountPercent = parseFloat(String(formData.discount_percent)) || 0;
  const totals = calculateBudgetTotals({
    subtotal,
    discountPercent,
    taxRate: formData.tax_rate,
    additionalCharges: formData.budget_type === "professional" ? formData.additional_charges : 0,
  });
  const { discountAmount, netAmount, taxAmount, additionalCharges, total } = totals;
  const deposit = calculateBudgetDeposit(total, formData.deposit_type, formData.deposit_value);

  const screenContext = useMemo<StampyScreenContext>(() => {
    const currentClient = clients.find((client) => client.id === formData.client_id);
    const editingBudget = editingId && editingId !== "new"
      ? budgets.find((budget) => budget.id === editingId)
      : null;
    const mode = editingId === "new"
      ? "create"
      : editingId
        ? "edit"
        : showModePicker
          ? "select_type"
          : "list";

    return {
      page: {
        section: "budgets",
        route: pathname || "/presupuestos",
        title: "Presupuestos",
      },
      mode,
      selectedEntity: editingBudget ? {
        type: "budget",
        id: String(editingBudget.id),
        name: String(editingBudget.title || `Presupuesto ${editingBudget.budget_number || ""}`).trim(),
      } : null,
      visibleEntities: !editingId ? budgets.slice(0, 20).map((budget, index) => ({
        type: "budget",
        id: String(budget.id),
        name: String(budget.title || `Presupuesto ${budget.budget_number || ""}`).trim(),
        position: index + 1,
      })) : [],
      formState: editingId ? {
        kind: "budgetDraft",
        budgetType: formData.budget_type,
        client: formData.client_id || clientSnapshot.name ? {
          ...(formData.client_id ? { id: formData.client_id } : {}),
          name: formData.budget_type === "professional"
            ? clientSnapshot.name
            : currentClient?.name,
        } : null,
        items: budgetItems.slice(0, 15).map((item) => ({
          productId: item.product_id || undefined,
          name: String(item.item_name || "Producto"),
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unit_price) || 0,
        })),
        discountPercent,
        taxRate: formData.tax_rate,
        additionalCharges,
        summary: {
          subtotal,
          discount: discountAmount,
          tax: taxAmount,
          total,
        },
        paymentMethod: formData.payment_method || formData.payment_terms || undefined,
        deliveryTime: formData.delivery_time || undefined,
      } : null,
      pageData: {
        kind: "budgets",
        visibleBudgetCount: budgets.length,
      },
      uiState: {
        loading,
        modePickerOpen: showModePicker,
      },
    };
  }, [
    additionalCharges,
    budgetItems,
    budgets,
    clientSnapshot.name,
    clients,
    discountAmount,
    discountPercent,
    editingId,
    formData,
    loading,
    pathname,
    showModePicker,
    subtotal,
    taxAmount,
    total,
  ]);
  usePublishStampyScreenContext(screenContext);

  const handleSaveBudget = async () => {
    if (!formData.client_id) return toast.error("Por favor seleccioná un cliente.");
    if (!formData.title.trim() && !(editingId === "new" && isTitleAutomatic)) {
      return toast.error("Agregá un título para el presupuesto.");
    }
    if (budgetItems.length === 0) return toast.error("Agregá al menos un producto al presupuesto.");

    const normalizedItems = [];
    for (const item of budgetItems) {
      const normalizedItem = normalizeBudgetItemEconomics(item);
      if (!normalizedItem.success) {
        setError(normalizedItem.error);
        return toast.error(normalizedItem.error);
      }
      normalizedItems.push(normalizedItem.item);
    }

    const normalizedSubtotal = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
    const normalizedTotals = calculateBudgetTotals({
      subtotal: normalizedSubtotal,
      discountPercent,
      taxRate: formData.tax_rate,
      additionalCharges: formData.budget_type === "professional" ? formData.additional_charges : 0,
    });

    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      user_id: user.id,
      client_id: formData.client_id,
      title: editingId === "new" && isTitleAutomatic ? "" : formData.title.trim(),
      status: formData.status,
      notes: formData.notes,
      valid_until: formData.valid_until || null,
      discount_percent: normalizedTotals.discountPercent,
      discount_amount: normalizedTotals.discountAmount,
      subtotal: normalizedTotals.subtotal,
      tax_rate: normalizedTotals.taxRate,
      tax_amount: normalizedTotals.taxAmount,
      total_amount: normalizedTotals.total,
      budget_type: formData.budget_type,
      payment_terms: formData.payment_terms || null,
      delivery_time: formData.delivery_time || null,
      delivery_method: formData.delivery_method || null,
      commercial_conditions: formData.commercial_conditions || null,
      client_snapshot: formData.budget_type === "professional" ? clientSnapshot : null,
      client_reference: formData.client_reference || null,
      payment_method: formData.payment_method || null,
      deposit_type: formData.budget_type === "professional" ? formData.deposit_type : "none",
      deposit_value: formData.budget_type === "professional"
        ? Math.min(formData.deposit_type === "percent" ? 100 : Number.POSITIVE_INFINITY, Math.max(0, Number(formData.deposit_value) || 0))
        : 0,
      additional_charges: normalizedTotals.additionalCharges,
      warranty: formData.warranty || null,
      warranty_conditions: formData.warranty_conditions || null,
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
      const { error: deleteItemsError } = await supabase.from("budget_items").delete().eq("budget_id", budgetId);
      if (deleteItemsError) {
        toast.error("No se pudieron actualizar los productos del presupuesto.");
        return setError(deleteItemsError.message);
      }
    }

    const itemsPayload = normalizedItems.map(item => ({
      budget_id: budgetId,
      product_id: item.product_id,
      item_name: item.item_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      unit_base_cost: item.unit_base_cost,
      unit_profit: item.unit_profit,
      total_profit: item.total_profit,
      commercial_description: item.commercial_description || null,
      material: item.material || null,
      color: item.color || null,
      finish: item.finish || null,
      technology: item.technology || null,
      commercial_notes: item.commercial_notes || null,
    }));

    const { error: itemsError } = await supabase.from("budget_items").insert(itemsPayload);
    if (itemsError) {
      if (editingId === "new" && budgetId) {
        await supabase.from("budgets").delete().eq("id", budgetId);
      }
      toast.error("No se pudieron guardar los productos del presupuesto.");
      return setError(itemsError.message);
    }

    // Refresh data
    await fetchData();
    setEditingId(null);
  };

  const handleDownloadPdf = async () => {
    if (editingId === "new") {
      toast.info("Debés guardar el presupuesto antes de descargarlo.");
      return;
    }

    // Find client
    const currentClient = formData.budget_type === "professional"
      ? clientSnapshot
      : clients.find(c => c.id === formData.client_id);

    // Prepare budget object with full details
    const persistedBudget = budgets.find((budget) => budget.id === editingId);
    const budgetData = {
      id: editingId,
      ...formData,
      budget_number: persistedBudget?.budget_number,
      created_at: persistedBudget?.created_at,
      subtotal,
      discount_amount: discountAmount,
      net_amount: netAmount,
      tax_amount: taxAmount,
      additional_charges: additionalCharges,
      total_amount: total
    };

    setIsGeneratingPdf(true);
    try {
      const [{ pdf }, { default: BudgetPDFDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/presupuestos/budget-pdf-document"),
      ]);
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
      toast.error("Hubo un error al generar el PDF: " + err.message);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDownloadPdfById = async (b: any) => {
    setGeneratingPdfId(b.id);
    try {
      const [{ pdf }, { default: BudgetPDFDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/presupuestos/budget-pdf-document"),
      ]);
      const currentClient = normalizeBudgetMode(b.budget_type) === "professional" && b.client_snapshot
        ? b.client_snapshot
        : clients.find(c => c.id === b.client_id);

      const { data: itemsData, error: itemsError } = await supabase
        .from("budget_items")
        .select("*")
        .eq("budget_id", b.id);

      if (itemsError) throw itemsError;

      const budgetData = {
        id: b.id,
        budget_number: b.budget_number,
        title: b.title,
        status: b.status,
        notes: b.notes,
        created_at: b.created_at,
        valid_until: b.valid_until,
        discount_percent: b.discount_percent || 0,
        discount_amount: b.discount_amount || 0,
        subtotal: b.subtotal || 0,
        net_amount: Math.max(0, Number(b.subtotal || 0) - Number(b.discount_amount || 0)),
        tax_rate: normalizeBudgetTaxRate(b.tax_rate),
        tax_amount: b.tax_amount || 0,
        budget_type: normalizeBudgetMode(b.budget_type),
        payment_terms: b.payment_terms || "",
        delivery_time: b.delivery_time || "",
        delivery_method: b.delivery_method || "",
        commercial_conditions: b.commercial_conditions || "",
        client_reference: b.client_reference || "",
        payment_method: b.payment_method || "",
        deposit_type: b.deposit_type || "none",
        deposit_value: Number(b.deposit_value) || 0,
        additional_charges: Number(b.additional_charges) || 0,
        warranty: b.warranty || "",
        warranty_conditions: b.warranty_conditions || "",
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
      toast.error("Hubo un error al generar el PDF: " + err.message);
    } finally {
      setGeneratingPdfId(null);
    }
  };

  const handleSaveClient = async () => {
    if (!clientData.name) return toast.error("El nombre del cliente es obligatorio.");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload: any = {
      user_id: user.id,
      name: clientData.name,
      phone: clientData.phone,
      email: clientData.email,
      address: clientData.address || null,
      city: clientData.city || null,
      province: clientData.province || null,
      postal_code: clientData.postal_code || null,
      contact_person: clientData.contact_person || null,
      notes: clientData.notes,
      fiscal_condition: clientData.fiscal_condition,
      cuit: clientData.cuit,
      is_active: clientData.is_active
    };

    if (clientData.id) {
      // Editar
      const { data, error } = await supabase.from("clients").update(payload).eq("id", clientData.id).select().single();
      if (error) {
        toast.error("Error actualizando cliente: " + error.message);
      } else {
        setClients(clients.map(c => c.id === data.id ? data : c));
        setFormData(prev => ({ ...prev, client_id: data.id }));
        setClientSnapshot(clientToSnapshot(data));
        setShowClientForm(false);
      }
    } else {
      // Crear
      const { data, error } = await supabase.from("clients").insert([payload]).select().single();
      if (error) {
        toast.error("Error creando cliente: " + error.message);
      } else {
        setClients([...clients, data].sort((a, b) => a.name.localeCompare(b.name)));
        setFormData(prev => ({ ...prev, client_id: data.id }));
        setClientSnapshot(clientToSnapshot(data));
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
        address: c.address || "",
        city: c.city || "",
        province: c.province || "",
        postal_code: c.postal_code || "",
        contact_person: c.contact_person || "",
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
    setClientData(emptyClientForm());
  };

  const handleSaveProduct = async () => {
    if (!productData.name.trim()) return toast.error("El nombre del producto es obligatorio.");
    if (parseFloat(String(productData.sale_price)) < 0) return toast.error("El precio de venta debe ser mayor o igual a 0.");

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
      toast.error("Error creando producto: " + error.message);
    } else if (data) {
      const builtItem = buildBudgetItemFromProduct(data);
      if (!builtItem.success) {
        toast.error(builtItem.error);
        return;
      }

      setProducts((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      setBudgetItems((current) => [...current, builtItem.item]);

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
            <span className="hidden sm:inline-flex rounded-full border border-stampa-border bg-stampa-bg-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              {formData.budget_type === "professional" ? "Profesional" : "Rápido"}
            </span>
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

      <Dialog
        open={showModePicker && !editingId}
        onClose={() => setShowModePicker(false)}
        labelledBy="new-budget-dialog-title"
        panelClassName="relative max-w-3xl rounded-3xl border border-stampa-border bg-stampa-surface p-5 sm:p-8"
      >
        <button
          type="button"
          onClick={() => setShowModePicker(false)}
          className="absolute right-4 top-4 rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Cerrar selector"
        >
          <X size={20} />
        </button>
        <div className="mb-6 pr-10">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-stampa-orange">Nuevo presupuesto</p>
          <h2 id="new-budget-dialog-title" className="text-2xl font-black text-white sm:text-3xl">¿Qué tipo querés crear?</h2>
          <p className="mt-2 text-sm text-gray-400">Ambos usan tus mismos clientes, productos y precios.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => startNewBudget("quick")}
            className="group rounded-2xl border border-stampa-border bg-stampa-bg-soft p-5 text-left transition-all hover:border-[#ff6a00]/60 hover:bg-stampa-orange/5 sm:p-6"
          >
            <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-stampa-orange/10 text-stampa-orange">
              <Zap size={23} />
            </span>
            <span className="block text-lg font-black text-white">Presupuesto Rápido</span>
            <span className="mt-2 block text-sm leading-6 text-gray-400">Cotización simple con cliente, productos, IVA y total. Lista en pocos segundos.</span>
          </button>
          <button
            type="button"
            onClick={() => startNewBudget("professional")}
            className="group rounded-2xl border border-stampa-border bg-stampa-bg-soft p-5 text-left transition-all hover:border-[#ff6a00]/60 hover:bg-stampa-orange/5 sm:p-6"
          >
            <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-stampa-orange/10 text-stampa-orange">
              <FileText size={23} />
            </span>
            <span className="block text-lg font-black text-white">Presupuesto Profesional</span>
            <span className="mt-2 block text-sm leading-6 text-gray-400">Presentación comercial con datos fiscales, entrega, pago y condiciones opcionales.</span>
          </button>
        </div>
      </Dialog>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-sm text-red-400">
          <AlertCircle size={20} className="shrink-0" /> {error}
        </div>
      )}

      {prefillNotice && (
        <div className="bg-cyan-500/10 border border-cyan-500/20 p-4 rounded-xl flex items-start gap-3 text-sm text-cyan-200">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <span>{prefillNotice}</span>
        </div>
      )}

      {/* VISTA DE EDICIÓN / CREACIÓN */}
      {editingId && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start animate-in fade-in-50 duration-300">
          {/* COLUMNA FORMULARIO */}
          <div className="lg:col-span-2 space-y-6">

            {/* 1. Datos del Cliente */}
            <Card className={`${formData.budget_type === "quick" ? "p-5 sm:p-6" : "p-6 sm:p-8"} bg-stampa-surface border-stampa-border shadow-lg`}>
              <div className="flex justify-between items-end mb-6 border-b border-stampa-border pb-3">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">1. Cliente</h3>
                  <p className="text-sm text-gray-400 mt-1">Elegí un cliente existente o cargá uno nuevo.</p>
                </div>
                {!showClientForm && (
                  <div className="flex items-center gap-2">
                    {formData.client_id && (
                      <button onClick={() => handleEditClient(formData.client_id)} className="text-xs font-bold text-gray-400 hover:text-white flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
                        <Pencil size={14} /> Editar
                      </button>
                    )}
                    <button onClick={() => { setClientData(emptyClientForm()); setShowClientForm(true); }} className="text-xs font-bold text-stampa-orange hover:text-[#ff7a1a] flex items-center gap-1.5 px-3 py-1.5 bg-stampa-orange/10 border border-[#ff6a00]/20 rounded-lg transition-colors">
                      <UserPlus size={14} /> Nuevo
                    </button>
                  </div>
                )}
              </div>

              {!showClientForm ? (
                <div className="space-y-5">
                  <div className="max-w-md">
                    <Combobox
                      options={clients.map(c => ({ id: c.id, label: c.name }))}
                      value={formData.client_id}
                      onChange={(val) => handleClientSelection(val.toString())}
                      placeholder="Seleccioná o buscá un cliente..."
                      emptyText="No se encontraron clientes."
                    />
                  </div>
                  {formData.budget_type === "professional" && formData.client_id && (
                    <div className="rounded-xl border border-stampa-border bg-stampa-bg-soft p-4 sm:p-5">
                      <div className="mb-4">
                        <p className="text-sm font-bold text-white">Datos para este presupuesto</p>
                        <p className="mt-1 text-xs text-gray-500">Podés ajustarlos sin modificar el cliente guardado en tu agenda.</p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {([
                          ["name", "Nombre / Razón social"], ["cuit", "CUIT / DNI"],
                          ["fiscal_condition", "Condición frente al IVA"], ["contact_person", "Persona de contacto"],
                          ["email", "Email"], ["phone", "Teléfono"], ["address", "Domicilio"],
                          ["city", "Localidad"], ["province", "Provincia"], ["postal_code", "Código postal"],
                        ] as const).map(([field, label]) => (
                          <label key={field} className={field === "address" ? "sm:col-span-2" : ""}>
                            <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
                            <input value={clientSnapshot[field]} onChange={(event) => setClientSnapshot((current) => ({ ...current, [field]: event.target.value }))} className="w-full rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
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
                  {formData.budget_type === "professional" && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">CUIT / DNI</label>
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
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Dirección</label>
                        <input type="text" placeholder="Calle, número, localidad" value={clientData.address} onChange={e => setClientData({ ...clientData, address: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Localidad</label>
                        <input type="text" value={clientData.city} onChange={e => setClientData({ ...clientData, city: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Provincia</label>
                        <input type="text" value={clientData.province} onChange={e => setClientData({ ...clientData, province: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Código postal</label>
                        <input type="text" value={clientData.postal_code} onChange={e => setClientData({ ...clientData, postal_code: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Persona de contacto</label>
                        <input type="text" value={clientData.contact_person} onChange={e => setClientData({ ...clientData, contact_person: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Notas del cliente</label>
                        <input type="text" placeholder="Información interna del cliente" value={clientData.notes} onChange={e => setClientData({ ...clientData, notes: e.target.value })} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                      </div>
                    </>
                  )}
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
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">2. Productos y servicios</h3>
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
                    <div key={item.id} className="space-y-3 rounded-xl border border-stampa-border bg-stampa-bg-soft p-3">
                      <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-center">
                        <div className="w-full lg:flex-1">
                          <Combobox
                            options={products.map(p => ({ id: p.id, label: `${p.name} ($${p.sale_price})` }))}
                            value={item.product_id}
                            onChange={(val) => handleItemChange(idx, "product_id", val)}
                          />
                        </div>
                        <div className="mt-1 flex w-full items-center justify-between gap-2 lg:mt-0 lg:w-auto lg:justify-end">
                          <div className="flex items-center gap-2 rounded-lg border border-stampa-border bg-stampa-surface px-2 py-1.5">
                            <span className="text-[10px] font-bold uppercase text-gray-500">Cant</span>
                            <input type="number" min="1" value={item.quantity} onChange={(e) => handleItemChange(idx, "quantity", e.target.value)} className="w-12 border-none bg-transparent p-0 text-center text-sm font-bold text-white focus:ring-0 sm:w-16" />
                          </div>
                          <div className="flex min-w-[105px] items-center justify-between gap-2 rounded-lg border border-stampa-border bg-stampa-surface px-3 py-1.5 sm:min-w-[120px]">
                            <span className="text-[10px] font-bold uppercase text-gray-500">Sub</span>
                            <span className="text-sm font-bold text-white">${item.subtotal.toFixed(2)}</span>
                          </div>
                          <button onClick={() => handleRemoveItem(idx)} className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-400/10 hover:text-red-400" title="Eliminar item">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      {formData.budget_type === "professional" && (
                        <div className="grid grid-cols-1 gap-3 border-t border-stampa-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
                          <label className="sm:col-span-2 lg:col-span-3">
                            <span className="mb-1 block text-[11px] font-semibold text-gray-500">Descripción comercial</span>
                            <textarea rows={2} value={item.commercial_description || ""} onChange={(event) => handleItemChange(idx, "commercial_description", event.target.value)} placeholder="Descripción visible para el cliente" className="w-full rounded-lg border border-stampa-border bg-stampa-surface px-3 py-2 text-sm text-white outline-none focus:border-[#ff6a00]" />
                          </label>
                          {([[
                            "material", "Material"], ["color", "Color"], ["finish", "Terminación"],
                            ["technology", "Tecnología"], ["commercial_notes", "Observación del producto"],
                          ] as const).map(([field, label]) => (
                            <label key={field} className={field === "commercial_notes" ? "sm:col-span-2" : ""}>
                              <span className="mb-1 block text-[11px] font-semibold text-gray-500">{label}</span>
                              <input value={item[field] || ""} onChange={(event) => handleItemChange(idx, field, event.target.value)} className="w-full rounded-lg border border-stampa-border bg-stampa-surface px-3 py-2 text-sm text-white outline-none focus:border-[#ff6a00]" />
                            </label>
                          ))}
                        </div>
                      )}
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
                      <input type="text" value={formData.title} onChange={e => handleTitleChange(e.target.value)} className="w-full text-sm rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" placeholder="Se completa al elegir un cliente" />
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

            {formData.budget_type === "professional" && (
              <Card className="p-6 sm:p-8 bg-stampa-surface border-stampa-border shadow-lg">
                <div className="mb-6 border-b border-stampa-border pb-3">
                  <h3 className="text-lg font-bold text-white">4. Condiciones comerciales</h3>
                  <p className="mt-1 text-sm text-gray-400">Pago, entrega y garantía. Todo es opcional.</p>
                </div>
                <div className="space-y-6">
                  <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-xs font-semibold text-gray-500">Referencia / Orden de compra</label>
                      <input type="text" value={formData.client_reference} onChange={(event) => setFormData({ ...formData, client_reference: event.target.value })} placeholder="Ej. OC-1234 / Proyecto Laboratorio 2026" className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-500">Forma de pago</label>
                      <select value={formData.payment_method} onChange={(event) => setFormData({ ...formData, payment_method: event.target.value })} className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]">
                        {PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    {formData.payment_method === "custom" && (
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-gray-500">Forma de pago personalizada</label>
                        <input type="text" value={formData.payment_terms} onChange={(event) => setFormData({ ...formData, payment_terms: event.target.value })} className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]" />
                      </div>
                    )}
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-500">Anticipo requerido</label>
                      <select value={formData.deposit_type} onChange={(event) => setFormData({ ...formData, deposit_type: event.target.value as BudgetDepositType })} className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]">
                        <option value="none">Sin anticipo</option><option value="percent">Porcentaje</option><option value="fixed">Monto fijo</option>
                      </select>
                    </div>
                    {formData.deposit_type !== "none" && (
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-gray-500">{formData.deposit_type === "percent" ? "Porcentaje" : "Monto"}</label>
                        <input type="number" min="0" max={formData.deposit_type === "percent" ? 100 : undefined} value={formData.deposit_value || ""} onChange={(event) => setFormData({ ...formData, deposit_value: Math.max(0, Number(event.target.value) || 0) })} className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]" />
                        <p className="mt-1.5 text-xs text-gray-500">Anticipo: ${deposit.requiredAmount.toFixed(2)} · Saldo: ${deposit.remainingAmount.toFixed(2)}</p>
                      </div>
                    )}
                  </section>

                  <section className="grid grid-cols-1 gap-4 border-t border-stampa-border pt-5 md:grid-cols-2">
                    <h4 className="text-sm font-bold text-white md:col-span-2">5. Entrega</h4>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-500">Plazo estimado</label>
                      <select value={formData.delivery_time_option} onChange={(event) => { const option = event.target.value; setFormData({ ...formData, delivery_time_option: option, delivery_time: option === "custom" ? "" : option }); }} className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]">
                        {DELIVERY_TIMES.map((value) => <option key={value} value={value}>{value === "" ? "Sin especificar" : value === "custom" ? "Personalizado" : value}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-500">Modalidad</label>
                      <select value={formData.delivery_method} onChange={(event) => setFormData({ ...formData, delivery_method: event.target.value })} className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]">
                        <option value="">Sin especificar</option><option value="Retiro">Retiro</option><option value="Envío">Envío</option><option value="A coordinar">A coordinar</option>
                      </select>
                    </div>
                    {formData.delivery_time_option === "custom" && (
                      <div className="md:col-span-2">
                        <label className="mb-1.5 block text-xs font-semibold text-gray-500">Plazo personalizado</label>
                        <input type="text" value={formData.delivery_time} onChange={(event) => setFormData({ ...formData, delivery_time: event.target.value })} className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]" />
                      </div>
                    )}
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-xs font-semibold text-gray-500">Envío / Otros cargos</label>
                      <input type="number" min="0" value={formData.additional_charges || ""} onChange={(event) => setFormData({ ...formData, additional_charges: Math.max(0, Number(event.target.value) || 0) })} placeholder="0" className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]" />
                      <p className="mt-1.5 text-xs text-gray-500">Se suma al total después del IVA.</p>
                    </div>
                  </section>

                  <section className="grid grid-cols-1 gap-4 border-t border-stampa-border pt-5 md:grid-cols-2">
                    <h4 className="text-sm font-bold text-white md:col-span-2">6. Garantía</h4>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-500">Garantía</label>
                      <select value={formData.warranty_option} onChange={(event) => { const option = event.target.value; setFormData({ ...formData, warranty_option: option, warranty: option === "custom" ? "" : option }); }} className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]">
                        {WARRANTIES.map((value) => <option key={value} value={value}>{value === "" ? "Sin especificar" : value === "custom" ? "Personalizada" : value}</option>)}
                      </select>
                    </div>
                    {formData.warranty_option === "custom" && (
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-gray-500">Garantía personalizada</label>
                        <input type="text" value={formData.warranty} onChange={(event) => setFormData({ ...formData, warranty: event.target.value })} className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]" />
                      </div>
                    )}
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-xs font-semibold text-gray-500">Condiciones de garantía</label>
                      <textarea rows={2} value={formData.warranty_conditions} onChange={(event) => setFormData({ ...formData, warranty_conditions: event.target.value })} className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00]" />
                    </div>
                  </section>

                  <section className="border-t border-stampa-border pt-5">
                    <h4 className="mb-3 text-sm font-bold text-white">7. Observaciones</h4>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-500">Condiciones adicionales</label>
                    <textarea rows={3} value={formData.commercial_conditions} onChange={(event) => setFormData({ ...formData, commercial_conditions: event.target.value })} placeholder="Condiciones comerciales adicionales" className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]" />
                  </section>
                </div>
              </Card>
            )}

          </div>

          {/* COLUMNA TOTALES Y ACCIONES (Sticky) */}
          <div className="lg:col-span-1 lg:sticky lg:top-6 space-y-4">
            <Card className="p-6 bg-stampa-bg-soft border-[#ff6a00]/30 shadow-xl overflow-hidden relative">
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#ff6a00] to-transparent opacity-50" />

              <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-stampa-border pb-3 mb-5">
                <DollarSign size={18} className="text-stampa-orange" /> {formData.budget_type === "professional" ? "3. Impuestos y resumen" : "Resumen"}
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

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-400">Neto</span>
                  <span className="text-sm font-bold text-white">${netAmount.toFixed(2)}</span>
                </div>

                {formData.budget_type === "professional" && additionalCharges > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-400">Envío / adicionales</span>
                    <span className="text-sm font-bold text-white">${additionalCharges.toFixed(2)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="budget-tax-rate" className="text-sm font-medium text-gray-400">IVA</label>
                  <select
                    id="budget-tax-rate"
                    value={formData.tax_rate}
                    onChange={(event) => setFormData({ ...formData, tax_rate: normalizeBudgetTaxRate(event.target.value) })}
                    className="rounded-lg border border-stampa-border bg-stampa-surface px-2.5 py-1.5 text-right text-sm font-bold text-white outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                  >
                    {BUDGET_TAX_RATES.map((rate) => (
                      <option key={rate} value={rate}>IVA {String(rate).replace(".", ",")}%</option>
                    ))}
                  </select>
                </div>

                {formData.tax_rate > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="pl-5 text-xs font-medium text-gray-500">Monto IVA</span>
                    <span className="text-xs font-semibold text-gray-300">${taxAmount.toFixed(2)}</span>
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
                      <span className="mt-2 inline-flex items-center gap-1 rounded-md border border-stampa-border bg-stampa-bg-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        {normalizeBudgetMode(b.budget_type) === "professional" ? <FileText size={10} /> : <Zap size={10} />}
                        {normalizeBudgetMode(b.budget_type) === "professional" ? "Profesional" : "Rápido"}
                      </span>
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

export default function PresupuestosPage() {
  return (
    <React.Suspense fallback={<div className="p-8 text-center"><Loader2 className="animate-spin inline-block h-8 w-8 text-stampa-orange" /></div>}>
      <PresupuestosPageContent />
    </React.Suspense>
  );
}
