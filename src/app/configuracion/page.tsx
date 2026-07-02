"use client";

import React, { useState } from "react";
import { Settings, Printer, Shapes, Settings2, Box } from "lucide-react";
import { SectionTitle } from "@/components/ui/section-title";
import { FilamentsManager } from "@/components/configuracion/filaments-manager";
import { PrintersManager } from "@/components/configuracion/printers-manager";
import { ProductTypesManager } from "@/components/configuracion/product-types-manager";
import { SettingsManager } from "@/components/configuracion/settings-manager";

type Tab = "filaments" | "printers" | "products" | "settings";

export default function ConfiguracionPage() {
  const [activeTab, setActiveTab] = useState<Tab>("filaments");

  return (
    <div className="pb-12">
      <SectionTitle eyebrow="Mi Cuenta" title="Configuración" />

      <div className="mb-8 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
          <button
            onClick={() => setActiveTab("filaments")}
            className={`whitespace-nowrap flex items-center gap-2 border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
              activeTab === "filaments"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <Box size={18} />
            Filamentos
          </button>

          <button
            onClick={() => setActiveTab("printers")}
            className={`whitespace-nowrap flex items-center gap-2 border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
              activeTab === "printers"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <Printer size={18} />
            Impresoras
          </button>

          <button
            onClick={() => setActiveTab("products")}
            className={`whitespace-nowrap flex items-center gap-2 border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
              activeTab === "products"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <Shapes size={18} />
            Multiplicadores
          </button>

          <button
            onClick={() => setActiveTab("settings")}
            className={`whitespace-nowrap flex items-center gap-2 border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
              activeTab === "settings"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <Settings2 size={18} />
            Ajustes Globales
          </button>
        </nav>
      </div>

      <div className="mt-6">
        {activeTab === "filaments" && <FilamentsManager />}
        {activeTab === "printers" && <PrintersManager />}
        {activeTab === "products" && <ProductTypesManager />}
        {activeTab === "settings" && <SettingsManager />}
      </div>
    </div>
  );
}
