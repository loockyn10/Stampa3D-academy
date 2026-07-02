"use client";

import React from "react";
import { Plus, Pencil, Copy, Trash2 } from "lucide-react";
import { useAppState } from "@/context/state-context";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { SpoolDot } from "@/components/common/spool-dot";

export default function ProductosPage() {
  const { products } = useAppState();

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Productos"
        action={
          <PrimaryButton>
            <Plus size={15} /> Nuevo producto
          </PrimaryButton>
        }
      />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-2xl select-none">
                {p.img}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-400">{p.cat}</p>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                  <SpoolDot i={0} /> {p.material} · {p.time}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-2.5 text-center">
              <div>
                <p className="text-xs font-bold text-gray-900">${p.cost}</p>
                <p className="text-[10px] text-gray-400">Costo</p>
              </div>
              <div>
                <p className="text-xs font-bold text-orange-600">${p.price}</p>
                <p className="text-[10px] text-gray-400">Venta</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-900">{p.stock}</p>
                <p className="text-[10px] text-gray-400">Stock</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <GhostButton className="flex-1 py-2 text-xs">
                <Pencil size={13} /> Editar
              </GhostButton>
              <GhostButton className="px-2.5 py-2">
                <Copy size={13} />
              </GhostButton>
              <GhostButton className="px-2.5 py-2 text-red-500 hover:bg-red-50 hover:text-red-600">
                <Trash2 size={13} />
              </GhostButton>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
