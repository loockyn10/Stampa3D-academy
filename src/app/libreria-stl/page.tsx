"use client";

import React, { useState, useMemo } from "react";
import { Search, Boxes, ArrowLeft, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { EmptyState } from "@/components/ui/empty-state";
import { STL_CATEGORIES, STL_FILES } from "@/data/mock-data";

export default function LibreriaStlPage() {
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filteredFiles = useMemo(() => {
    let f = STL_FILES;
    if (selectedCatId) f = f.filter((s) => s.cat === selectedCatId);
    if (query) f = f.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
    return f;
  }, [selectedCatId, query]);

  if (!selectedCatId) {
    return (
      <div>
        <SectionTitle eyebrow="Plataforma" title="Librería STL" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {STL_CATEGORIES.map((c) => (
            <Card key={c.id} onClick={() => setSelectedCatId(c.id)} className="p-5 text-center cursor-pointer hover:-translate-y-0.5 hover:shadow-md">
              <div className="mb-2 text-4xl select-none">{c.icon}</div>
              <p className="text-sm font-bold text-gray-900">{c.name}</p>
              <p className="text-xs text-gray-400">{c.count} modelos</p>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const catInfo = STL_CATEGORIES.find((c) => c.id === selectedCatId);

  return (
    <div>
      <button
        onClick={() => {
          setSelectedCatId(null);
          setQuery("");
        }}
        className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft size={14} /> Todas las categorías
      </button>
      <SectionTitle eyebrow="Librería STL" title={catInfo ? `${catInfo.icon} ${catInfo.name}` : "Librería"} />

      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar modelos..."
          className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
        />
      </div>

      {filteredFiles.length === 0 ? (
        <EmptyState icon={Boxes} title="No encontramos modelos" hint="Probá con otra búsqueda o categoría." />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filteredFiles.map((f) => (
            <Card key={f.id} className="overflow-hidden p-0">
              <div className="relative flex h-28 items-center justify-center bg-gray-50 text-4xl select-none">
                {f.img}
                <div className="absolute right-2 top-2">
                  <Badge tone={f.badge === "Premium" ? "dark" : "green"}>{f.badge}</Badge>
                </div>
              </div>
              <div className="p-3">
                <p className="truncate text-xs font-bold text-gray-900">{f.name}</p>
                <button className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 py-2 text-xs font-semibold text-white hover:bg-gray-800 transition-colors duration-150">
                  <Download size={13} /> Descargar
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
