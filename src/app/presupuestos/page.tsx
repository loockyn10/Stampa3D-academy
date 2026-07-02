"use client";

import React, { useState } from "react";
import { Plus, FileText } from "lucide-react";
import { useAppState } from "@/context/state-context";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { STATUS_STYLES } from "@/data/mock-data";

export default function PresupuestosPage() {
  const { budgets, addBudget, products } = useAppState();
  const [showForm, setShowForm] = useState(false);

  // Form states
  const [client, setClient] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [qty, setQty] = useState(1);
  const [material, setMaterial] = useState("PLA");
  const [time, setTime] = useState(2);
  const [total, setTotal] = useState(0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) return;

    const items = selectedProduct
      ? `${selectedProduct} x${qty}`
      : `Pieza custom (${material}) x${qty}`;

    addBudget({
      client,
      items,
      total: total || 1500 * qty, // Fallback calculation if cost is 0
      status: "Borrador",
    });

    // Reset form
    setClient("");
    setSelectedProduct("");
    setQty(1);
    setMaterial("PLA");
    setTime(2);
    setTotal(0);
    setShowForm(false);
  };

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Presupuestos"
        action={
          <PrimaryButton onClick={() => setShowForm((s) => !s)}>
            <Plus size={15} /> Nuevo presupuesto
          </PrimaryButton>
        }
      />

      {showForm && (
        <Card className="mb-6 p-5">
          <p className="mb-4 text-sm font-bold text-gray-900">Nuevo presupuesto</p>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Cliente</span>
              <input
                required
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
                placeholder="Nombre del cliente"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Producto propio</span>
              <select
                value={selectedProduct}
                onChange={(e) => {
                  setSelectedProduct(e.target.value);
                  const prod = products.find((p) => p.name === e.target.value);
                  if (prod) {
                    setMaterial(prod.material);
                    setTotal(prod.price * qty);
                  }
                }}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
              >
                <option value="">Seleccionar producto guardado...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name} (${p.price})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Cantidad</span>
              <input
                type="number"
                min="1"
                value={qty}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  setQty(val);
                  const prod = products.find((p) => p.name === selectedProduct);
                  if (prod) {
                    setTotal(prod.price * val);
                  }
                }}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Material</span>
              <input
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
                placeholder="PLA, PETG..."
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Tiempo de impresión</span>
              <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50 px-3 focus-within:border-orange-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-orange-100">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={time}
                  onChange={(e) => setTime(parseFloat(e.target.value) || 0)}
                  className="w-full bg-transparent py-2.5 text-sm text-gray-800 outline-none"
                />
                <span className="text-xs font-medium text-gray-400">h</span>
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Costo total ($)</span>
              <input
                type="number"
                min="0"
                value={total}
                onChange={(e) => setTotal(parseInt(e.target.value) || 0)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
                placeholder="Costo total estimado"
              />
            </label>

            <div className="sm:col-span-2 mt-2 flex flex-wrap gap-3">
              <PrimaryButton type="submit">
                <FileText size={15} /> Guardar presupuesto
              </PrimaryButton>
              <GhostButton type="button" onClick={() => setShowForm(false)}>
                Cancelar
              </GhostButton>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Detalle</th>
                <th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {budgets.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3.5 font-semibold text-gray-900">{b.client}</td>
                  <td className="px-5 py-3.5 text-gray-500">{b.items}</td>
                  <td className="px-5 py-3.5 font-semibold text-gray-800">
                    ${b.total.toLocaleString("es-AR")}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-block rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        STATUS_STYLES[b.status]
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button className="text-xs font-semibold text-orange-600 hover:underline">
                      Compartir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
