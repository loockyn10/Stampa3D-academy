"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Boxes, Eye, EyeOff, Factory, History, Loader2, Minus, Pencil, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useBarcodeScanHandler } from "@/components/barcode/BarcodeScannerProvider";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";
import { Dialog } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { normalizeBarcode } from "@/lib/barcode/hid-scanner";
import {
  getBusinessProductDisplayName,
  resolveBusinessCatalogStock,
  type BusinessCatalogItem,
  type BusinessInventoryMovement,
  type WorkshopProductSummary,
} from "@/lib/business/catalog";
import {
  adjustBusinessInventoryAction,
  archiveBusinessCatalogItemAction,
  createResaleCatalogItemAction,
  linkManufacturedProductAction,
  loadBusinessOperationsAction,
  setBusinessCatalogPublicationAction,
  updateBusinessCatalogItemAction,
} from "../actions";

const inputClass = "w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-stampa-orange/60";
const movementDate = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

const emptyResaleForm = {
  name: "",
  category: "",
  brand: "",
  description: "",
  purchaseCost: "",
  salePrice: "",
  initialStock: "0",
  sku: "",
  barcode: "",
  supplier: "",
  isActive: true,
};

function CatalogoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useAppFeedback();
  const [items, setItems] = useState<BusinessCatalogItem[]>([]);
  const [products, setProducts] = useState<WorkshopProductSummary[]>([]);
  const [movements, setMovements] = useState<BusinessInventoryMovement[]>([]);
  const [locationsEnabled, setLocationsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [deleteItem, setDeleteItem] = useState<BusinessCatalogItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editItem, setEditItem] = useState<BusinessCatalogItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", category: "", brand: "", description: "", purchaseCost: "",
    salePrice: "", sku: "", barcode: "", supplier: "", imageUrl: "",
  });
  const [resaleOpen, setResaleOpen] = useState(false);
  const [manufacturedOpen, setManufacturedOpen] = useState(false);
  const [adjustmentItem, setAdjustmentItem] = useState<BusinessCatalogItem | null>(null);
  const [adjustmentDirection, setAdjustmentDirection] = useState<"add" | "subtract">("add");
  const [adjustmentQuantity, setAdjustmentQuantity] = useState("1");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [scannedCatalogItemId, setScannedCatalogItemId] = useState<string | null>(null);
  const adjustmentAttemptRef = useRef<string | null>(null);
  const handledBarcodePrefillRef = useRef<string | null>(null);
  const [resaleForm, setResaleForm] = useState(emptyResaleForm);
  const [manufacturedForm, setManufacturedForm] = useState({
    sourceProductId: "",
    category: "Fabricados",
    description: "",
    salePrice: "",
    sku: "",
    barcode: "",
    isActive: true,
  });

  const applyWorkspaceResult = useCallback((
    result: Awaited<ReturnType<typeof loadBusinessOperationsAction>>,
  ) => {
    if (!result.success) {
      setError(result.error);
      setItems([]);
      setProducts([]);
      setMovements([]);
      setLocationsEnabled(false);
    } else {
      setError(null);
      setItems(result.items);
      setProducts(result.products);
      setMovements(result.movements);
      setLocationsEnabled(result.locationsEnabled);
      const requestedProductId = searchParams.get("producto");
      const alreadyLinked = result.items.some((item) => item.source_product_id === requestedProductId);
      const requestedProduct = result.products.find((product) => product.id === requestedProductId);
      if (requestedProduct && !alreadyLinked) {
        setManufacturedForm((current) => ({
          ...current,
          sourceProductId: requestedProduct.id,
          description: requestedProduct.description || "",
          salePrice: String(requestedProduct.sale_price || 0),
        }));
        setManufacturedOpen(true);
      }
      const requestedBarcode = normalizeBarcode(searchParams.get("barcode") ?? "");
      if (
        searchParams.get("crear") === "reventa"
        && requestedBarcode
        && handledBarcodePrefillRef.current !== requestedBarcode
      ) {
        handledBarcodePrefillRef.current = requestedBarcode;
        setResaleForm((current) => ({ ...current, barcode: requestedBarcode }));
        setResaleOpen(true);
        router.replace("/mi-negocio/catalogo", { scroll: false });
      }
    }
    setLoading(false);
  }, [router, searchParams]);

  const loadWorkspace = useCallback(async () => {
    const result = await loadBusinessOperationsAction();
    applyWorkspaceResult(result);
  }, [applyWorkspaceResult]);

  useEffect(() => {
    let active = true;
    void loadBusinessOperationsAction().then((result) => {
      if (active) applyWorkspaceResult(result);
    });
    return () => { active = false; };
  }, [applyWorkspaceResult]);

  const linkedProductIds = useMemo(
    () => new Set(items.flatMap((item) => item.source_product_id ? [item.source_product_id] : [])),
    [items],
  );
  const availableProducts = useMemo(
    () => products.filter((product) => product.is_active && !linkedProductIds.has(product.id)),
    [linkedProductIds, products],
  );
  const scannedCatalogItem = items.find((item) => item.id === scannedCatalogItemId) ?? null;

  const handleCatalogBarcode = useCallback((rawBarcode: string) => {
    const barcode = normalizeBarcode(rawBarcode);
    const found = items.find((item) => normalizeBarcode(item.barcode ?? "").toLowerCase() === barcode.toLowerCase());
    if (found) {
      setScannedCatalogItemId(found.id);
      toast.info(`${getBusinessProductDisplayName(found)} encontrado en el catálogo.`);
      return;
    }

    setScannedCatalogItemId(null);
    setResaleForm({ ...emptyResaleForm, barcode });
    setResaleOpen(true);
    toast.info("Código nuevo: completá los datos para agregarlo al catálogo.");
  }, [items, toast]);

  useBarcodeScanHandler({
    id: "business-catalog",
    route: "/mi-negocio/catalogo",
    priority: 100,
    enabled: !loading,
    onScan: (scan) => handleCatalogBarcode(scan.value),
  });

  useEffect(() => {
    if (!scannedCatalogItemId) return;
    const frame = window.requestAnimationFrame(() => {
      const card = document.getElementById(`catalog-item-${scannedCatalogItemId}`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.focus({ preventScroll: true });
    });
    const timeout = window.setTimeout(() => setScannedCatalogItemId(null), 2_500);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [scannedCatalogItemId]);

  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/catalogo", title: "Catálogo de Mi Negocio" },
    mode: adjustmentItem ? "adjust_resale_inventory" : resaleOpen ? "create_resale" : manufacturedOpen ? "link_manufactured" : "catalog",
    selectedEntity: adjustmentItem ? {
      type: "business_catalog_item",
      id: adjustmentItem.id,
      name: adjustmentItem.name,
      facts: [
        { label: "Origen", value: "Reventa" },
        { label: "Stock visible", value: resolveBusinessCatalogStock(adjustmentItem, products) ?? 0 },
      ],
    } : scannedCatalogItem ? {
      type: "business_catalog_item",
      id: scannedCatalogItem.id,
      name: scannedCatalogItem.name,
      facts: [
        { label: "Origen", value: scannedCatalogItem.source_type === "manufactured" ? "Fabricado" : "Reventa" },
        { label: "Stock visible", value: resolveBusinessCatalogStock(scannedCatalogItem, products) ?? "No disponible" },
      ],
    } : null,
    visibleEntities: items.slice(0, 20).map((item, index) => ({
      type: "business_catalog_item",
      id: item.id,
      name: item.name,
      position: index + 1,
      facts: [
        { label: "Origen", value: item.source_type === "manufactured" ? "Fabricado" : "Reventa" },
        { label: "Categoría", value: item.category },
        { label: "Precio de venta", value: Number(item.sale_price || 0) },
        { label: "Stock visible", value: resolveBusinessCatalogStock(item, products) ?? "Fuente productiva no disponible" },
      ],
    })),
    pageData: {
      kind: "pageFacts",
      facts: [
        { label: "Productos comerciales", value: items.length },
        { label: "Fabricados vinculados", value: items.filter((item) => item.source_type === "manufactured").length },
        { label: "Productos de reventa", value: items.filter((item) => item.source_type === "resale").length },
        { label: "Publicados en tienda", value: items.filter((item) => item.is_published).length },
      ],
    },
    uiState: {
      loading,
      ...(adjustmentItem || resaleOpen || manufacturedOpen ? {
        activeDialog: adjustmentItem ? "Ajustar stock de reventa" : resaleOpen ? "Nuevo producto de reventa" : "Agregar producto fabricado",
      } : {}),
    },
  }), [adjustmentItem, items, loading, manufacturedOpen, products, resaleOpen, scannedCatalogItem]);
  usePublishStampyScreenContext(stampyContext);

  const closeManufactured = () => {
    setManufacturedOpen(false);
    setManufacturedForm({ sourceProductId: "", category: "Fabricados", description: "", salePrice: "", sku: "", barcode: "", isActive: true });
  };

  const selectManufacturedProduct = (productId: string) => {
    const product = products.find((candidate) => candidate.id === productId);
    setManufacturedForm((current) => ({
      ...current,
      sourceProductId: productId,
      description: product?.description || "",
      salePrice: product ? String(product.sale_price || 0) : "",
    }));
  };

  const saveResale = async () => {
    setSaving(true);
    const result = await createResaleCatalogItemAction({
      ...resaleForm,
      purchaseCost: Number(resaleForm.purchaseCost),
      salePrice: Number(resaleForm.salePrice),
      initialStock: Number(resaleForm.initialStock),
    });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success(result.restored ? "Producto de reventa restaurado en el catálogo." : "Producto de reventa agregado al catálogo.");
    setResaleOpen(false);
    setResaleForm(emptyResaleForm);
    setLoading(true);
    await loadWorkspace();
  };

  const saveManufactured = async () => {
    setSaving(true);
    const result = await linkManufacturedProductAction({
      ...manufacturedForm,
      salePrice: Number(manufacturedForm.salePrice),
    });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success(result.restored ? "Producto restaurado en Mi Negocio." : "Producto del taller agregado a Mi Negocio.");
    closeManufactured();
    setLoading(true);
    await loadWorkspace();
  };

  const togglePublication = async (item: BusinessCatalogItem) => {
    setPublishingId(item.id);
    const result = await setBusinessCatalogPublicationAction({ catalogItemId: item.id, published: !item.is_published });
    setPublishingId(null);
    if (!result.success) return toast.error(result.error);
    setItems((current) => current.map((candidate) => candidate.id === item.id
      ? { ...candidate, is_published: !item.is_published, public_slug: result.publicSlug }
      : candidate));
    toast.success(item.is_published ? "Producto ocultado de la tienda." : "Producto publicado en la tienda.");
  };

  const archiveCatalogItem = async () => {
    if (!deleteItem || deleting) return;
    setDeleting(true);
    const result = await archiveBusinessCatalogItemAction({ catalogItemId: deleteItem.id });
    setDeleting(false);
    if (!result.success) return toast.error(result.error);
    setItems((current) => current.filter((item) => item.id !== deleteItem.id));
    setDeleteItem(null);
    toast.success("Producto eliminado de Mi Negocio.");
  };

  const openEdit = (item: BusinessCatalogItem) => {
    setEditItem(item);
    setEditForm({
      name: item.name,
      category: item.category,
      brand: item.brand || "",
      description: item.description || "",
      purchaseCost: item.purchase_cost === null ? "" : String(item.purchase_cost),
      salePrice: String(item.sale_price),
      sku: item.sku || "",
      barcode: item.barcode || "",
      supplier: item.supplier || "",
      imageUrl: item.image_urls?.[0] || "",
    });
  };

  const saveEdit = async () => {
    if (!editItem || editing) return;
    setEditing(true);
    const result = await updateBusinessCatalogItemAction({
      catalogItemId: editItem.id,
      name: editForm.name,
      category: editForm.category,
      brand: editForm.brand,
      description: editForm.description,
      purchaseCost: editItem.source_type === "resale" ? Number(editForm.purchaseCost) : null,
      salePrice: Number(editForm.salePrice),
      sku: editForm.sku,
      barcode: editForm.barcode,
      supplier: editForm.supplier,
      imageUrls: editForm.imageUrl ? [editForm.imageUrl] : [],
    });
    setEditing(false);
    if (!result.success) return toast.error(result.error);
    setItems((current) => current.map((item) => item.id === result.item.id ? result.item : item));
    setEditItem(null);
    toast.success("Producto comercial actualizado.");
  };

  const openAdjustment = (item: BusinessCatalogItem) => {
    setAdjustmentItem(item);
    setAdjustmentDirection("add");
    setAdjustmentQuantity("1");
    setAdjustmentReason("");
    adjustmentAttemptRef.current = null;
  };

  const closeAdjustment = () => {
    if (!adjusting) setAdjustmentItem(null);
  };

  const saveAdjustment = async () => {
    if (!adjustmentItem || adjusting) return;
    const amount = Number(adjustmentQuantity);
    const currentStock = resolveBusinessCatalogStock(adjustmentItem, products);
    if (!Number.isInteger(amount) || amount <= 0) return toast.error("Ingresá una cantidad entera mayor a cero.");
    if (!adjustmentReason.trim()) return toast.error("Indicá el motivo para dejar trazabilidad.");
    if (adjustmentDirection === "subtract" && currentStock !== null && amount > currentStock) {
      return toast.error("No hay stock suficiente para ese ajuste.");
    }

    adjustmentAttemptRef.current ??= crypto.randomUUID();
    setAdjusting(true);
    let result: Awaited<ReturnType<typeof adjustBusinessInventoryAction>>;
    try {
      result = await adjustBusinessInventoryAction({
        idempotencyKey: adjustmentAttemptRef.current,
        catalogItemId: adjustmentItem.id,
        quantityDelta: adjustmentDirection === "add" ? amount : -amount,
        reason: adjustmentReason,
      });
    } catch {
      setAdjusting(false);
      toast.error("No recibimos la respuesta. Reintentá: el mismo ajuste no se aplicará dos veces.");
      return;
    }
    setAdjusting(false);
    if (!result.success) return toast.error(result.error);

    toast.success(`Stock actualizado: ${result.newQuantity} unidades${result.replayed ? " (ajuste ya aplicado)" : ""}.`);
    adjustmentAttemptRef.current = null;
    setAdjustmentItem(null);
    setLoading(true);
    await loadWorkspace();
  };

  return (
    <div className="pb-24">
      <Link href="/mi-negocio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white">
        <ArrowLeft size={14} /> Mi Negocio
      </Link>
      <SectionTitle
        eyebrow="Mi Negocio"
        title="Catálogo comercial"
        action={(
          <div className="grid w-full grid-cols-1 gap-2 min-[390px]:grid-cols-2 sm:flex sm:w-auto">
            <button onClick={() => setManufacturedOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stampa-border bg-white/5 px-4 text-xs font-bold text-white hover:bg-white/10">
              <Factory size={16} /> Del taller
            </button>
            <button onClick={() => setResaleOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-4 text-xs font-bold text-white hover:bg-orange-500">
              <Plus size={16} /> De reventa
            </button>
          </div>
        )}
      />
      <p className="mb-6 max-w-3xl text-sm leading-6 text-gray-400">
        Los fabricados conservan receta, costo y stock en Productos. Los artículos de reventa viven sólo en esta capa comercial.
      </p>

      {error && (
        <Card className="mb-5 border-red-500/25 p-4 text-sm text-red-300">
          No se pudo cargar el catálogo: {error}
        </Card>
      )}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div>
      ) : items.length === 0 && !error ? (
        <Card className="flex flex-col items-center p-10 text-center">
          <ShoppingBag size={30} className="text-stampa-orange" />
          <h2 className="mt-4 text-lg font-bold text-white">Tu catálogo comercial está vacío</h2>
          <p className="mt-2 max-w-md text-sm text-gray-400">Agregá un producto que ya fabricás o cargá uno de reventa.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const stock = resolveBusinessCatalogStock(item, products);
            const image = item.image_urls?.[0];
            return (
              <div
                key={item.id}
                id={`catalog-item-${item.id}`}
                tabIndex={-1}
                className="rounded-2xl outline-none"
              >
              <Card className={`overflow-hidden p-4 transition-all ${item.is_active ? "" : "opacity-60"} ${scannedCatalogItemId === item.id ? "border-stampa-orange ring-2 ring-stampa-orange/25" : ""}`}>
                <div className="flex gap-3">
                  {image ? (
                    <Image unoptimized src={image} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-xl border border-stampa-border object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-stampa-border bg-white/5 text-gray-500"><Boxes size={23} /></span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="truncate text-sm font-bold text-white">{getBusinessProductDisplayName(item)}</h2>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${item.source_type === "manufactured" ? "bg-cyan-500/10 text-cyan-300" : "bg-violet-500/10 text-violet-300"}`}>
                        {item.source_type === "manufactured" ? "Fabricado" : "Reventa"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500">{item.category}{item.brand ? ` · ${item.brand}` : ""}</p>
                    <p className="mt-2 text-base font-black text-stampa-orange">${Number(item.sale_price || 0).toLocaleString("es-AR")}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/5 bg-black/10 p-3 text-xs">
                  <div><p className="text-gray-500">Stock</p><p className="mt-0.5 font-bold text-white">{stock === null ? "Sin fuente" : `${stock} u.`}</p></div>
                  <div><p className="text-gray-500">SKU</p><p className="mt-0.5 truncate font-semibold text-gray-300">{item.sku || "Sin SKU"}</p></div>
                  <div className="col-span-2"><p className="text-gray-500">Código de barras</p><p className="mt-0.5 truncate font-semibold text-gray-300">{item.barcode || "Sin código"}</p></div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[10px] text-gray-500">{item.is_active ? "Activo" : "Inactivo"}</span>
                  <button type="button" disabled={!item.is_active || publishingId === item.id} onClick={() => void togglePublication(item)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-bold disabled:opacity-40 ${item.is_published ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-stampa-border text-gray-400 hover:bg-white/5"}`}>
                    {publishingId === item.id ? <Loader2 size={13} className="animate-spin" /> : item.is_published ? <Eye size={13} /> : <EyeOff size={13} />}
                    {item.is_published ? "Publicado" : "No publicado"}
                  </button>
                </div>
                <div className="mt-3 border-t border-stampa-border pt-3">
                  {item.source_type === "manufactured" ? (
                    <Link href="/mi-taller/inventario" className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 text-xs font-bold text-cyan-200 hover:bg-cyan-500/15">
                      <Factory size={14} /> Gestionar stock en Mi Taller
                    </Link>
                  ) : (
                    <button type="button" onClick={() => openAdjustment(item)} disabled={!item.is_active} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-stampa-border bg-white/5 px-3 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-40">
                      <Boxes size={14} /> Ajustar stock de reventa
                    </button>
                  )}
                  {locationsEnabled && <Link href="/mi-negocio/reposicion" className="mt-2 inline-flex min-h-9 w-full items-center justify-center rounded-lg text-[11px] font-bold text-gray-500 hover:bg-white/5 hover:text-gray-300">Configurar showroom y mínimo</Link>}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => openEdit(item)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-stampa-border bg-white/5 px-3 text-xs font-bold text-white hover:bg-white/10"><Pencil size={14} /> Editar</button>
                    <button type="button" onClick={() => setDeleteItem(item)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 text-xs font-bold text-red-300 hover:bg-red-500/10"><Trash2 size={14} /> Eliminar</button>
                  </div>
                </div>
              </Card>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={adjustmentItem !== null} onClose={closeAdjustment} labelledBy="catalog-adjustment-title" panelClassName="max-w-lg rounded-2xl border border-stampa-border bg-stampa-surface">
        {adjustmentItem && <>
          <div className="flex items-start justify-between border-b border-stampa-border p-5">
            <div>
              <h2 id="catalog-adjustment-title" className="text-lg font-bold text-white">Ajustar {getBusinessProductDisplayName(adjustmentItem)}</h2>
              <p className="mt-1 text-sm text-gray-500">Stock actual: {resolveBusinessCatalogStock(adjustmentItem, products) ?? "no disponible"} unidades</p>
            </div>
            <button type="button" onClick={closeAdjustment} className="rounded-lg p-2 text-gray-500 hover:text-white"><X size={18} /></button>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setAdjustmentDirection("add"); adjustmentAttemptRef.current = null; }} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold ${adjustmentDirection === "add" ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-stampa-border text-gray-400"}`}><Plus size={16} /> Sumar</button>
              <button type="button" onClick={() => { setAdjustmentDirection("subtract"); adjustmentAttemptRef.current = null; }} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold ${adjustmentDirection === "subtract" ? "border-red-400/50 bg-red-400/10 text-red-200" : "border-stampa-border text-gray-400"}`}><Minus size={16} /> Restar</button>
            </div>
            <label className="block text-xs font-semibold text-gray-300">Cantidad<input type="number" inputMode="numeric" min="1" step="1" value={adjustmentQuantity} onChange={(event) => { setAdjustmentQuantity(event.target.value); adjustmentAttemptRef.current = null; }} className="mt-1.5 min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 text-sm text-white" /></label>
            <label className="block text-xs font-semibold text-gray-300">Motivo<textarea value={adjustmentReason} onChange={(event) => { setAdjustmentReason(event.target.value); adjustmentAttemptRef.current = null; }} maxLength={300} rows={3} placeholder="Ej.: reposición, conteo físico, unidad dañada" className="mt-1.5 w-full resize-none rounded-xl border border-stampa-border bg-stampa-bg-soft p-3 text-sm text-white" /></label>
            <button type="button" disabled={adjusting} onClick={() => void saveAdjustment()} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-stampa-orange text-sm font-black text-white disabled:opacity-50">{adjusting && <Loader2 size={16} className="animate-spin" />} Confirmar ajuste</button>
          </div>
          <div className="border-t border-stampa-border p-5">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-400"><History size={15} /> Últimos movimientos</h3>
            {movements.filter((movement) => movement.catalog_item_id === adjustmentItem.id).slice(0, 12).length === 0 ? (
              <p className="mt-3 text-xs text-gray-500">Sin movimientos comerciales registrados.</p>
            ) : (
              <div className="mt-3 max-h-44 space-y-2 overflow-y-auto">
                {movements.filter((movement) => movement.catalog_item_id === adjustmentItem.id).slice(0, 12).map((movement) => (
                  <div key={movement.id} className="flex items-start justify-between gap-3 rounded-xl bg-white/[0.03] p-3">
                    <div><p className="text-xs font-semibold text-gray-300">{movement.reason || "Movimiento de inventario"}</p><p className="mt-1 text-[11px] text-gray-500">{movementDate.format(new Date(movement.created_at))}</p></div>
                    <p className={`text-sm font-black ${movement.quantity_delta > 0 ? "text-emerald-300" : "text-red-300"}`}>{movement.quantity_delta > 0 ? "+" : ""}{movement.quantity_delta}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>}
      </Dialog>

      <Dialog open={deleteItem !== null} onClose={() => { if (!deleting) setDeleteItem(null); }} labelledBy="catalog-delete-title" panelClassName="max-w-md rounded-2xl border border-stampa-border bg-stampa-surface">
        {deleteItem && <>
          <div className="flex items-start justify-between gap-4 border-b border-stampa-border p-5">
            <div>
              <h2 id="catalog-delete-title" className="text-lg font-bold text-white">¿Eliminar “{getBusinessProductDisplayName(deleteItem)}”?</h2>
              <p className="mt-1 text-sm leading-6 text-gray-400">Esta acción lo quitará de Mi Negocio.</p>
              {deleteItem.source_type === "manufactured" && <p className="mt-2 text-xs leading-5 text-cyan-200">El producto seguirá existiendo en Mi Taller con su receta, costos y stock.</p>}
            </div>
            <button type="button" disabled={deleting} onClick={() => setDeleteItem(null)} aria-label="Cerrar" className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white disabled:opacity-40"><X size={18} /></button>
          </div>
          <div className="flex flex-col-reverse gap-2 p-5 min-[390px]:flex-row min-[390px]:justify-end">
            <button type="button" disabled={deleting} onClick={() => setDeleteItem(null)} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-gray-400 hover:bg-white/5 disabled:opacity-40">Cancelar</button>
            <button type="button" disabled={deleting} onClick={() => void archiveCatalogItem()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-black text-white hover:bg-red-400 disabled:opacity-50">{deleting && <Loader2 size={16} className="animate-spin" />} Eliminar</button>
          </div>
        </>}
      </Dialog>

      <Dialog open={editItem !== null} onClose={() => { if (!editing) setEditItem(null); }} labelledBy="catalog-edit-title" panelClassName="max-w-2xl rounded-2xl border border-stampa-border bg-stampa-surface">
        {editItem && <>
          <div className="flex items-start justify-between gap-4 border-b border-stampa-border p-5">
            <div>
              <h2 id="catalog-edit-title" className="text-lg font-bold text-white">Editar producto comercial</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">Estos cambios no modifican el stock ni sus movimientos.</p>
              {editItem.source_type === "manufactured" && <p className="mt-1 text-xs leading-5 text-cyan-200">Receta, componentes y costos productivos se administran desde Mi Taller.</p>}
            </div>
            <button type="button" disabled={editing} onClick={() => setEditItem(null)} aria-label="Cerrar" className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white disabled:opacity-40"><X size={18} /></button>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <label className="text-xs font-semibold text-gray-300">Nombre comercial<input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className={`${inputClass} mt-1.5`} /></label>
            <label className="text-xs font-semibold text-gray-300">Marca<input value={editForm.brand} onChange={(event) => setEditForm({ ...editForm, brand: event.target.value })} className={`${inputClass} mt-1.5`} /></label>
            <label className="text-xs font-semibold text-gray-300">Categoría<input value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })} className={`${inputClass} mt-1.5`} /></label>
            <label className="text-xs font-semibold text-gray-300">Precio de venta<input type="number" min="0" step="0.01" value={editForm.salePrice} onChange={(event) => setEditForm({ ...editForm, salePrice: event.target.value })} className={`${inputClass} mt-1.5`} /></label>
            {editItem.source_type === "resale" && <label className="text-xs font-semibold text-gray-300">Costo de compra<input type="number" min="0" step="0.01" value={editForm.purchaseCost} onChange={(event) => setEditForm({ ...editForm, purchaseCost: event.target.value })} className={`${inputClass} mt-1.5`} /></label>}
            {editItem.source_type === "resale" && <label className="text-xs font-semibold text-gray-300">Proveedor<input value={editForm.supplier} onChange={(event) => setEditForm({ ...editForm, supplier: event.target.value })} className={`${inputClass} mt-1.5`} /></label>}
            <label className="text-xs font-semibold text-gray-300">SKU<input value={editForm.sku} onChange={(event) => setEditForm({ ...editForm, sku: event.target.value })} className={`${inputClass} mt-1.5`} /></label>
            <label className="text-xs font-semibold text-gray-300">Código de barras<input value={editForm.barcode} onChange={(event) => setEditForm({ ...editForm, barcode: event.target.value })} className={`${inputClass} mt-1.5`} /></label>
            <label className="text-xs font-semibold text-gray-300 sm:col-span-2">Descripción comercial<textarea value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} rows={3} className={`${inputClass} mt-1.5 resize-none`} /></label>
            <div className="sm:col-span-2">
              <p className="mb-2 text-xs font-semibold text-gray-300">Imagen comercial</p>
              <FileUploadDropzone bucket="business-storefront-assets" pathPrefix={`${editItem.user_id}/catalog/${editItem.id}`} accept=".jpg,.jpeg,.png,.webp" maxSizeMb={5} publicBucket imageEditor={{ aspectRatio: 1, outputWidth: 1000, outputHeight: 1000, quality: 0.88, outputType: "preserve" }} onUploaded={(imageUrl) => setEditForm((current) => ({ ...current, imageUrl }))} label="Subir imagen" />
              {editForm.imageUrl && <div className="mt-3 flex items-center gap-3"><Image unoptimized src={editForm.imageUrl} width={72} height={72} alt="Vista previa del producto" className="h-18 w-18 rounded-xl border border-stampa-border object-cover" /><button type="button" onClick={() => setEditForm({ ...editForm, imageUrl: "" })} className="text-xs font-bold text-red-300">Quitar imagen</button></div>}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-stampa-border p-5 min-[390px]:flex-row min-[390px]:justify-end">
            <button type="button" disabled={editing} onClick={() => setEditItem(null)} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-gray-400 hover:bg-white/5 disabled:opacity-40">Cancelar</button>
            <button type="button" disabled={editing} onClick={() => void saveEdit()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-5 text-sm font-black text-white disabled:opacity-50">{editing && <Loader2 size={16} className="animate-spin" />} Guardar cambios</button>
          </div>
        </>}
      </Dialog>

      <Dialog open={manufacturedOpen} onClose={closeManufactured} labelledBy="manufactured-dialog-title" panelClassName="max-w-xl rounded-2xl border border-stampa-border bg-stampa-surface">
        <div className="flex items-center justify-between border-b border-stampa-border p-5">
          <div><h2 id="manufactured-dialog-title" className="font-bold text-white">Agregar producto fabricado</h2><p className="mt-1 text-xs text-gray-500">Se crea un vínculo; no se copian receta ni stock.</p></div>
          <button onClick={closeManufactured} className="p-2 text-gray-500 hover:text-white"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-5">
          <label className="block text-xs font-semibold text-gray-300">Producto del taller
            <select value={manufacturedForm.sourceProductId} onChange={(event) => selectManufacturedProduct(event.target.value)} className={`${inputClass} mt-1.5`}>
              <option value="">Seleccionar producto</option>
              {availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          {availableProducts.length === 0 && <p className="rounded-xl bg-white/5 p-3 text-xs text-gray-400">Todos tus productos activos ya están vinculados o todavía no cargaste ninguno.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-gray-300">Categoría<input value={manufacturedForm.category} onChange={(e) => setManufacturedForm({ ...manufacturedForm, category: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
            <label className="text-xs font-semibold text-gray-300">Precio comercial<input type="number" min="0" value={manufacturedForm.salePrice} onChange={(e) => setManufacturedForm({ ...manufacturedForm, salePrice: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
            <label className="text-xs font-semibold text-gray-300">SKU opcional<input value={manufacturedForm.sku} onChange={(e) => setManufacturedForm({ ...manufacturedForm, sku: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
            <label className="text-xs font-semibold text-gray-300">Código de barras opcional<input value={manufacturedForm.barcode} onChange={(e) => setManufacturedForm({ ...manufacturedForm, barcode: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
          </div>
          <label className="block text-xs font-semibold text-gray-300">Descripción comercial<textarea value={manufacturedForm.description} onChange={(e) => setManufacturedForm({ ...manufacturedForm, description: e.target.value })} rows={3} className={`${inputClass} mt-1.5 resize-none`} /></label>
          <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={manufacturedForm.isActive} onChange={(e) => setManufacturedForm({ ...manufacturedForm, isActive: e.target.checked })} /> Activo en el catálogo</label>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-stampa-border p-5 sm:flex-row sm:justify-end">
          <button onClick={closeManufactured} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-gray-400 hover:bg-white/5">Cancelar</button>
          <button disabled={saving || !manufacturedForm.sourceProductId} onClick={() => void saveManufactured()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-5 text-sm font-bold text-white disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />} Agregar</button>
        </div>
      </Dialog>

      <Dialog open={resaleOpen} onClose={() => setResaleOpen(false)} labelledBy="resale-dialog-title" panelClassName="max-w-2xl rounded-2xl border border-stampa-border bg-stampa-surface">
        <div className="flex items-center justify-between border-b border-stampa-border p-5">
          <div><h2 id="resale-dialog-title" className="font-bold text-white">Nuevo producto de reventa</h2><p className="mt-1 text-xs text-gray-500">Producto comercial sin receta de fabricación.</p></div>
          <button onClick={() => setResaleOpen(false)} className="p-2 text-gray-500 hover:text-white"><X size={18} /></button>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="text-xs font-semibold text-gray-300">Nombre<input value={resaleForm.name} onChange={(e) => setResaleForm({ ...resaleForm, name: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-300">Categoría<input value={resaleForm.category} onChange={(e) => setResaleForm({ ...resaleForm, category: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-300">Marca opcional<input value={resaleForm.brand} onChange={(e) => setResaleForm({ ...resaleForm, brand: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-300">Proveedor opcional<input value={resaleForm.supplier} onChange={(e) => setResaleForm({ ...resaleForm, supplier: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-300">Costo de compra<input type="number" min="0" value={resaleForm.purchaseCost} onChange={(e) => setResaleForm({ ...resaleForm, purchaseCost: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-300">Precio de venta<input type="number" min="0" value={resaleForm.salePrice} onChange={(e) => setResaleForm({ ...resaleForm, salePrice: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-300">Stock inicial<input type="number" min="0" step="1" value={resaleForm.initialStock} onChange={(e) => setResaleForm({ ...resaleForm, initialStock: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-300">SKU opcional<input value={resaleForm.sku} onChange={(e) => setResaleForm({ ...resaleForm, sku: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-300">Código de barras opcional<input value={resaleForm.barcode} onChange={(e) => setResaleForm({ ...resaleForm, barcode: e.target.value })} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-300 sm:col-span-2">Descripción comercial<textarea value={resaleForm.description} onChange={(e) => setResaleForm({ ...resaleForm, description: e.target.value })} rows={3} className={`${inputClass} mt-1.5 resize-none`} /></label>
          <label className="flex items-center gap-2 text-sm text-gray-300 sm:col-span-2"><input type="checkbox" checked={resaleForm.isActive} onChange={(e) => setResaleForm({ ...resaleForm, isActive: e.target.checked })} /> Activo en el catálogo</label>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-stampa-border p-5 sm:flex-row sm:justify-end">
          <button onClick={() => setResaleOpen(false)} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-gray-400 hover:bg-white/5">Cancelar</button>
          <button disabled={saving} onClick={() => void saveResale()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-5 text-sm font-bold text-white disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />} Guardar producto</button>
        </div>
      </Dialog>
    </div>
  );
}

export default function CatalogoPage() {
  return <Suspense fallback={<div className="min-h-48" />}><CatalogoContent /></Suspense>;
}
