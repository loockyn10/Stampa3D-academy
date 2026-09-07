"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, Factory, Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import {
  resolveBusinessCatalogStock,
  type BusinessCatalogItem,
  type WorkshopProductSummary,
} from "@/lib/business/catalog";
import { loadBusinessWorkspaceAction } from "../actions";

export default function InventarioPage() {
  const [items, setItems] = useState<BusinessCatalogItem[]>([]);
  const [products, setProducts] = useState<WorkshopProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInventory = useCallback(async () => {
    const result = await loadBusinessWorkspaceAction();
    if (!result.success) {
      setError(result.error);
      setItems([]);
      setProducts([]);
    } else {
      setError(null);
      setItems(result.items);
      setProducts(result.products);
    }
    setLoading(false);
  }, []);

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
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const activeItems = useMemo(() => items.filter((item) => item.is_active), [items]);
  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/inventario", title: "Inventario comercial" },
    mode: "inventory",
    visibleEntities: activeItems.slice(0, 20).map((item, index) => ({
      type: "business_inventory_item",
      id: item.id,
      name: item.name,
      position: index + 1,
      facts: [
        { label: "Origen", value: item.source_type === "manufactured" ? "Fabricado" : "Reventa" },
        { label: "Unidades disponibles", value: resolveBusinessCatalogStock(item, products) ?? "Fuente productiva no disponible" },
      ],
    })),
    pageData: { kind: "pageFacts", facts: [{ label: "Ítems activos", value: activeItems.length }] },
    uiState: { loading },
  }), [activeItems, loading, products]);
  usePublishStampyScreenContext(stampyContext);

  return (
    <div className="pb-24">
      <Link href="/mi-negocio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white">
        <ArrowLeft size={14} /> Mi Negocio
      </Link>
      <SectionTitle
        eyebrow="Mi Negocio"
        title="Inventario comercial"
        action={(
          <button onClick={() => { setLoading(true); void loadInventory(); }} disabled={loading} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-stampa-border bg-white/5 px-4 text-xs font-bold text-gray-300 hover:bg-white/10 sm:w-auto">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        )}
      />
      <p className="mb-6 max-w-3xl text-sm leading-6 text-gray-400">
        Vista de consulta. Los fabricados toman las unidades terminadas de Stock; los de reventa usan su inventario comercial propio.
      </p>

      {error && <Card className="mb-5 border-red-500/25 p-4 text-sm text-red-300">No se pudo cargar el inventario: {error}</Card>}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div>
      ) : activeItems.length === 0 && !error ? (
        <Card className="p-10 text-center">
          <Boxes size={30} className="mx-auto text-stampa-orange" />
          <h2 className="mt-4 text-lg font-bold text-white">No hay productos activos en el catálogo</h2>
          <Link href="/mi-negocio/catalogo" className="mt-4 inline-block text-sm font-bold text-stampa-orange">Ir al catálogo →</Link>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface">
          <div className="hidden grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] gap-4 border-b border-stampa-border bg-white/[0.025] px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 sm:grid">
            <span>Producto</span><span>Origen</span><span>Stock</span><span>Fuente</span>
          </div>
          <div className="divide-y divide-stampa-border">
            {activeItems.map((item) => {
              const stock = resolveBusinessCatalogStock(item, products);
              const sourceMissing = item.source_type === "manufactured" && stock === null;
              return (
                <div key={item.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] sm:items-center sm:px-5">
                  <div className="min-w-0"><p className="truncate text-sm font-bold text-white">{item.name}</p><p className="mt-1 truncate text-xs text-gray-500">{item.sku || "Sin SKU"}</p></div>
                  <div className="flex items-center gap-2 text-xs text-gray-300">
                    {item.source_type === "manufactured" ? <Factory size={15} className="text-cyan-300" /> : <ShoppingBag size={15} className="text-violet-300" />}
                    {item.source_type === "manufactured" ? "Fabricado" : "Reventa"}
                  </div>
                  <p className={`text-lg font-black ${sourceMissing || stock === 0 ? "text-red-300" : "text-white"}`}>{sourceMissing ? "—" : `${stock} u.`}</p>
                  <p className="text-xs leading-5 text-gray-500">{item.source_type === "manufactured" ? "Productos / Stock terminado" : "Inventario de reventa"}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Card className="mt-5 border-dashed p-4 text-xs leading-5 text-gray-500">
        Los movimientos de venta y la transferencia de rollos comerciales al taller quedan preparados como próximos sprints; esta vista no modifica stock.
      </Card>
    </div>
  );
}
