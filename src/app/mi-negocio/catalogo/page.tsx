"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Boxes, Factory, Loader2, Plus, ShoppingBag, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import {
  resolveBusinessCatalogStock,
  type BusinessCatalogItem,
  type WorkshopProductSummary,
} from "@/lib/business/catalog";
import {
  createResaleCatalogItemAction,
  linkManufacturedProductAction,
  loadBusinessWorkspaceAction,
} from "../actions";

const inputClass = "w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-stampa-orange/60";

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
  const searchParams = useSearchParams();
  const { toast } = useAppFeedback();
  const [items, setItems] = useState<BusinessCatalogItem[]>([]);
  const [products, setProducts] = useState<WorkshopProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resaleOpen, setResaleOpen] = useState(false);
  const [manufacturedOpen, setManufacturedOpen] = useState(false);
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

  const loadWorkspace = useCallback(async () => {
    const result = await loadBusinessWorkspaceAction();
    if (!result.success) {
      setError(result.error);
      setItems([]);
      setProducts([]);
    } else {
      setError(null);
      setItems(result.items);
      setProducts(result.products);
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
    }
    setLoading(false);
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    void loadBusinessWorkspaceAction().then((result) => {
      if (!active) return;
      if (!result.success) {
        setError(result.error);
        setItems([]);
        setProducts([]);
      } else {
        setError(null);
        setItems(result.items);
        setProducts(result.products);
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
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [searchParams]);

  const linkedProductIds = useMemo(
    () => new Set(items.flatMap((item) => item.source_product_id ? [item.source_product_id] : [])),
    [items],
  );
  const availableProducts = useMemo(
    () => products.filter((product) => product.is_active && !linkedProductIds.has(product.id)),
    [linkedProductIds, products],
  );

  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/catalogo", title: "Catálogo de Mi Negocio" },
    mode: resaleOpen ? "create_resale" : manufacturedOpen ? "link_manufactured" : "catalog",
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
      ],
    },
    uiState: { loading, ...(resaleOpen || manufacturedOpen ? { activeDialog: resaleOpen ? "Nuevo producto de reventa" : "Agregar producto fabricado" } : {}) },
  }), [items, loading, manufacturedOpen, products, resaleOpen]);
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
    toast.success("Producto de reventa agregado al catálogo.");
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
    toast.success("Producto del taller agregado a Mi Negocio.");
    closeManufactured();
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
              <Card key={item.id} className={`overflow-hidden p-4 ${item.is_active ? "" : "opacity-60"}`}>
                <div className="flex gap-3">
                  {image ? (
                    <Image unoptimized src={image} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-xl border border-stampa-border object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-stampa-border bg-white/5 text-gray-500"><Boxes size={23} /></span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="truncate text-sm font-bold text-white">{item.name}</h2>
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
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-gray-500">
                  <span>{item.is_active ? "Activo" : "Inactivo"}</span>
                  <span>Publicación: futura</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

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
