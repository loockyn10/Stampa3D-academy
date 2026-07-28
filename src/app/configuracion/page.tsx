"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { User, Building2, Wrench, Calculator, Bot, Loader2 } from "lucide-react";
import { SectionTitle } from "@/components/ui/section-title";

import { AccountManager } from "@/components/configuracion/account-manager";
import { BusinessManager } from "@/components/configuracion/business-manager";
import { PrintersManager } from "@/components/configuracion/printers-manager";
import { FilamentsManager } from "@/components/configuracion/filaments-manager";
import { SettingsManager } from "@/components/configuracion/settings-manager";
import { ProductTypesManager } from "@/components/configuracion/product-types-manager";
import { StampyManager } from "@/components/configuracion/stampy-manager";

type Tab = "cuenta" | "negocio" | "taller" | "calculadora" | "stampy";

function ConfiguracionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("cuenta");

  useEffect(() => {
    const t = searchParams.get("tab") as Tab;
    if (t && ["cuenta", "negocio", "taller", "calculadora", "stampy"].includes(t)) {
      setActiveTab(t);
    }
  }, [searchParams]);

  const handleTabChange = (t: Tab) => {
    setActiveTab(t);
    router.replace(`/configuracion?tab=${t}`);
  };

  return (
    <div className="pb-12">
      <SectionTitle eyebrow="Sistema" title="Configuración" />
      <p className="text-gray-500 text-sm -mt-3 mb-6">Configurá tu cuenta, tu negocio y los valores que usa tu taller.</p>

      <div className="mb-8 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
          <button
            onClick={() => handleTabChange("cuenta")}
            className={`whitespace-nowrap flex items-center gap-2 border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
              activeTab === "cuenta"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <User size={18} />
            Cuenta
          </button>

          <button
            onClick={() => handleTabChange("negocio")}
            className={`whitespace-nowrap flex items-center gap-2 border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
              activeTab === "negocio"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <Building2 size={18} />
            Negocio
          </button>

          <button
            onClick={() => handleTabChange("taller")}
            className={`whitespace-nowrap flex items-center gap-2 border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
              activeTab === "taller"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <Wrench size={18} />
            Taller
          </button>

          <button
            onClick={() => handleTabChange("calculadora")}
            className={`whitespace-nowrap flex items-center gap-2 border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
              activeTab === "calculadora"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <Calculator size={18} />
            Calculadora
          </button>

          <button
            onClick={() => handleTabChange("stampy")}
            className={`whitespace-nowrap flex items-center gap-2 border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
              activeTab === "stampy"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <Bot size={18} />
            Stampy
          </button>
        </nav>
      </div>

      <div className="mt-6 space-y-8">
        {activeTab === "cuenta" && <AccountManager />}
        
        {activeTab === "negocio" && <BusinessManager />}
        
        {activeTab === "taller" && (
          <div className="space-y-8 max-w-4xl">
            <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl mb-6">
              <p className="text-sm text-orange-800">
                <strong>Equipamiento y materiales.</strong> Las impresoras y filamentos que cargues acá se usan para calcular costos de impresión y gestionar tu stock.
              </p>
            </div>
            <PrintersManager />
            <FilamentsManager />
          </div>
        )}
        
        {activeTab === "calculadora" && (
          <div className="space-y-8 max-w-4xl">
            <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl mb-6">
              <p className="text-sm text-orange-800">
                <strong>Ajustes de cotización.</strong> Estos valores se usan centralmente en la calculadora para establecer precios más realistas.
              </p>
            </div>
            <SettingsManager />
            <ProductTypesManager />
          </div>
        )}

        {activeTab === "stampy" && <StampyManager setTab={handleTabChange} />}
      </div>
    </div>
  );
}

export default function ConfiguracionPage() {
  return (
    <Suspense fallback={<div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>}>
      <ConfiguracionContent />
    </Suspense>
  );
}
