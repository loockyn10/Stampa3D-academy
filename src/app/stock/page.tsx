"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Plus, Minus, Loader2, Package, Box } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [prodRes, filRes] = await Promise.all([
      supabase.from("products").select("*").eq("user_id", user.id).order("name", { ascending: true }),
      supabase.from("filaments").select("*").eq("user_id", user.id).eq("is_active", true).order("name", { ascending: true })
    ]);

    if (prodRes.error) setError(prodRes.error.message);
    else setProducts(prodRes.data || []);

    if (filRes.error) console.error(filRes.error.message);
    else setFilaments(filRes.data || []);

    setLoading(false);
  };

  const handleAdjustProductStock = async (id: string, delta: number) => {
    const product = products.find(p => p.id === id);
    if (!product) return;

    const newStock = Math.max(0, (product.stock_quantity || 0) + delta);
    
    // Optimistic UI update
    setProducts(products.map(p => p.id === id ? { ...p, stock_quantity: newStock } : p));

    const { error } = await supabase.from("products").update({ stock_quantity: newStock }).eq("id", id);
    if (error) {
      alert("Error al actualizar el stock: " + error.message);
      // Revert on error
      setProducts(products.map(p => p.id === id ? { ...p, stock_quantity: product.stock_quantity } : p));
    }
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

      <div className="mb-6 flex border-b border-gray-200">
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
                return (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 font-semibold text-gray-900">
                    <div className="flex items-center gap-3">
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="w-8 h-8 rounded bg-gray-100 object-cover border border-gray-200" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center border border-gray-200 text-gray-400 text-xs">📦</div>
                      )}
                      <span>{p.name}</span>
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
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => handleAdjustProductStock(p.id, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 hover:text-red-600 transition-colors shadow-sm"
                        disabled={p.stock_quantity <= 0}
                      >
                        <Minus size={14} />
                      </button>
                      <button
                        onClick={() => handleAdjustProductStock(p.id, 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 hover:text-green-600 transition-colors shadow-sm"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )})}

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
                    <div className="flex justify-end gap-1.5">
                      <Link href="/configuracion">
                        <button className="text-xs font-semibold text-gray-500 hover:text-orange-600 border border-gray-200 bg-white px-3 py-1.5 rounded-lg transition-colors">
                          Gestionar
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
    </div>
  );
}
