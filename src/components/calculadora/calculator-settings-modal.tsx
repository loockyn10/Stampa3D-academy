"use client";

import React, { useState } from "react";
import { Loader2, Save, Settings, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { CalculatorSelect } from "@/components/ui/calculator-select";
import { SettingsManager, type CalculatorSettingsValues } from "@/components/configuracion/settings-manager";
import { ProductTypesManager } from "@/components/configuracion/product-types-manager";
import { createClient } from "@/utils/supabase/client";
import { FeatureLink } from "@/components/features/feature-link";

export type CalculatorSettingsTab = "costs" | "printer" | "types";

export interface CalculatorPrinterCosts {
  id: string;
  name?: string | null;
  display_name?: string | null;
  power_watts?: number | null;
  maintenance_cost_per_hour?: number | null;
}

interface CalculatorSettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: CalculatorSettingsTab;
  printers: CalculatorPrinterCosts[];
  selectedPrinterId: string;
  onSettingsSaved: (values: CalculatorSettingsValues) => void;
  onPrinterSaved: (printerId: string, values: { power_watts: number; maintenance_cost_per_hour: number }) => void;
  onProductTypesChanged: () => void;
}

const TABS: { id: CalculatorSettingsTab; label: string; hint: string }[] = [
  { id: "costs", label: "Costos y ML", hint: "Electricidad, desperdicio, comisión y cargo fijo de Mercado Libre." },
  { id: "printer", label: "Impresora", hint: "Consumo y mantenimiento por hora de la impresora que usás para calcular." },
  { id: "types", label: "Tipos de producto", hint: "Multiplicador e insumos extra de cada tipo de producto." },
];

/**
 * Configuración de la Calculadora sin salir de la página (usuarios con acceso a la plataforma).
 * Reutiliza los mismos managers y tablas que /configuracion?tab=calculadora y Mi Taller → Impresoras:
 * no hay una segunda configuración. El cálculo en curso vive en la página y no se toca.
 */
export function CalculatorSettingsModal({
  open,
  onClose,
  initialTab = "costs",
  printers,
  selectedPrinterId,
  onSettingsSaved,
  onPrinterSaved,
  onProductTypesChanged,
}: CalculatorSettingsModalProps) {
  // El modal se monta al abrirse, así que la pestaña inicial se toma de las props.
  const [tab, setTab] = useState<CalculatorSettingsTab>(initialTab);

  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="calculator-settings-title"
      panelClassName="max-w-2xl rounded-2xl border border-stampa-border bg-stampa-surface"
    >
      <div className="sticky top-0 z-10 border-b border-stampa-border bg-stampa-surface px-4 pt-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="calculator-settings-title" className="flex items-center gap-2 text-base font-bold text-white">
              <Settings size={17} className="text-stampa-orange" aria-hidden="true" /> Configurar valores
            </h2>
            <p className="mt-0.5 text-xs text-gray-400">Los cambios se guardan en tu cuenta y tu cálculo actual se conserva.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar configuración"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
          >
            <X size={18} />
          </button>
        </div>
        <div role="tablist" aria-label="Secciones de configuración" className="-mb-px mt-3 flex gap-1 overflow-x-auto hide-scrollbar">
          {TABS.map((item) => {
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`calc-settings-tab-${item.id}`}
                aria-selected={active}
                aria-controls="calc-settings-panel"
                onClick={() => setTab(item.id)}
                className={`min-h-10 whitespace-nowrap border-b-2 px-2 text-xs font-semibold sm:px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange ${
                  active ? "border-stampa-orange text-stampa-orange" : "border-transparent text-gray-400 hover:text-gray-300"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div id="calc-settings-panel" role="tabpanel" aria-labelledby={`calc-settings-tab-${tab}`} className="space-y-3 px-4 py-4 sm:px-5">
        <p className="text-xs text-gray-400">{activeTab.hint}</p>
        {tab === "costs" && <SettingsManager embedded onSaved={onSettingsSaved} />}
        {tab === "printer" && (
          <PrinterCostsForm printers={printers} initialPrinterId={selectedPrinterId} onSaved={onPrinterSaved} />
        )}
        {tab === "types" && <ProductTypesManager onChanged={onProductTypesChanged} />}
      </div>
    </Dialog>
  );
}

function toNonNegative(value: string): number | null {
  const parsed = parseFloat(value.replace(",", "."));
  if (value.trim() === "") return 0;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function PrinterCostsForm({
  printers,
  initialPrinterId,
  onSaved,
}: {
  printers: CalculatorPrinterCosts[];
  initialPrinterId: string;
  onSaved: CalculatorSettingsModalProps["onPrinterSaved"];
}) {
  const [supabase] = useState(() => createClient());
  const initialPrinter = printers.find((item) => item.id === initialPrinterId) ?? printers[0] ?? null;
  const [printerId, setPrinterId] = useState(initialPrinter?.id ?? "");
  const [power, setPower] = useState(String(initialPrinter?.power_watts ?? ""));
  const [maintenance, setMaintenance] = useState(String(initialPrinter?.maintenance_cost_per_hour ?? ""));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Al cambiar de impresora se cargan sus valores guardados (no se pisa lo escrito en la misma impresora).
  const selectPrinter = (nextId: string) => {
    const next = printers.find((item) => item.id === nextId) ?? null;
    setPrinterId(nextId);
    setPower(String(next?.power_watts ?? ""));
    setMaintenance(String(next?.maintenance_cost_per_hour ?? ""));
    setMessage(null);
  };

  if (printers.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stampa-border p-4 text-sm text-gray-400">
        Todavía no tenés impresoras. <FeatureLink href="/mi-taller/impresoras" className="font-semibold text-stampa-orange hover:underline">Agregá una en Mi Taller.</FeatureLink>
      </div>
    );
  }

  const save = async () => {
    const powerValue = toNonNegative(power);
    const maintenanceValue = toNonNegative(maintenance);
    if (powerValue === null || maintenanceValue === null) {
      setMessage({ tone: "error", text: "Ingresá números iguales o mayores a 0." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const payload = { power_watts: powerValue, maintenance_cost_per_hour: maintenanceValue };
    const { error } = await supabase.from("printers").update(payload).eq("id", printerId);
    setSaving(false);
    if (error) {
      setMessage({ tone: "error", text: "No pudimos guardar la impresora. Probá de nuevo." });
      return;
    }
    setMessage({ tone: "ok", text: "Impresora actualizada." });
    onSaved(printerId, payload);
  };

  const inputClass =
    "h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none transition focus:border-[#ff6a00]/60 focus:ring-2 focus:ring-[#ff6a00]/10";

  return (
    <div className="space-y-4 rounded-xl border border-stampa-border p-4">
      <div>
        <span className="mb-1 block text-xs font-semibold text-gray-400">Impresora</span>
        <CalculatorSelect
          options={printers.map((item) => ({ value: item.id, label: item.display_name || item.name || "Impresora" }))}
          value={printerId}
          onChange={selectPrinter}
          searchable={printers.length > 6}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-400">Consumo (W)</span>
          <input type="text" inputMode="decimal" value={power} onChange={(event) => setPower(event.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-400">Mantenimiento por hora ($)</span>
          <input type="text" inputMode="decimal" value={maintenance} onChange={(event) => setMaintenance(event.target.value)} className={inputClass} />
        </label>
      </div>
      {message && (
        <p role="status" className={`text-xs ${message.tone === "ok" ? "text-emerald-400" : "text-red-400"}`}>{message.text}</p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <FeatureLink href="/mi-taller/impresoras" className="inline-flex min-h-9 items-center text-xs font-semibold text-gray-400 hover:text-white" fallback={<span aria-hidden="true" />}>
          Agregar o quitar impresoras en Mi Taller →
        </FeatureLink>
        <button
          type="button"
          onClick={save}
          disabled={saving || !printerId}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-stampa-orange px-4 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar impresora
        </button>
      </div>
    </div>
  );
}
