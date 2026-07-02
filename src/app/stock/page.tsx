"use client";

import React, { useState } from "react";
import { AlertTriangle, Plus, Minus } from "lucide-react";
import { useAppState } from "@/context/state-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrimaryButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { SpoolDot } from "@/components/common/spool-dot";
import { StockItem } from "@/types";

interface StockTableProps {
  rows: StockItem[];
  onAdjust: (index: number, delta: number) => void;
}

function StockTable({ rows, onAdjust }: StockTableProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-5 py-3">Nombre</th>
              <th className="px-5 py-3">Categoría</th>
              <th className="px-5 py-3">Cantidad</th>
              <th className="px-5 py-3">Ubicación</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={r.name} className="hover:bg-gray-50">
                <td className="px-5 py-3.5 font-semibold text-gray-900">
                  <span className="flex items-center gap-2">
                    {r.chip !== undefined && <SpoolDot i={r.chip} />}
                    {r.name}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-gray-500">{r.cat}</td>
                <td className="px-5 py-3.5">
                  <span className={`font-semibold ${r.low ? "text-red-600" : "text-gray-800"}`}>
                    {r.qty} {r.unit}
                  </span>
                  {r.low && (
                    <Badge tone="gray" className="ml-2">
                      <AlertTriangle size={11} className="text-red-500 fill-red-100" /> Bajo
                    </Badge>
                  )}
                </td>
                <td className="px-5 py-3.5 text-gray-500">{r.loc}</td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => onAdjust(i, -1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <Minus size={13} />
                    </button>
                    <button
                      onClick={() => onAdjust(i, 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function StockPage() {
  const { stockProducts, stockFilaments, adjustStockProduct, adjustStockFilament } = useAppState();
  const [tab, setTab] = useState<"productos" | "filamentos">("productos");

  const lowProductsCount = stockProducts.filter((r) => r.low).length;
  const lowFilamentsCount = stockFilaments.filter((r) => r.low).length;
  const totalLowCount = lowProductsCount + lowFilamentsCount;

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Stock"
        action={
          <PrimaryButton>
            <Plus size={15} /> Agregar item
          </PrimaryButton>
        }
      />

      {totalLowCount > 0 && (
        <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
          <AlertTriangle size={16} className="text-orange-600 shrink-0" />
          <span>
            Tenés {totalLowCount} {totalLowCount === 1 ? "ítem" : "ítems"} con stock bajo.
          </span>
        </div>
      )}

      <div className="mb-5 inline-flex rounded-xl bg-gray-100 p-1">
        {[
          ["productos", "Productos terminados"],
          ["filamentos", "Filamentos"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id as "productos" | "filamentos")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "productos" ? (
        <StockTable rows={stockProducts} onAdjust={adjustStockProduct} />
      ) : (
        <StockTable rows={stockFilaments} onAdjust={adjustStockFilament} />
      )}
    </div>
  );
}
