"use client";

import React, { useState } from "react";
import { Zap, DollarSign } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  suffix?: string;
  step?: number;
}

function NumberField({ label, value, onChange, suffix, step = 1 }: NumberFieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
      <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50 px-3 focus-within:border-orange-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-orange-100">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-transparent py-2.5 text-sm text-gray-800 outline-none"
        />
        {suffix && <span className="text-xs font-medium text-gray-400">{suffix}</span>}
      </div>
    </label>
  );
}

export default function CalculadoraPage() {
  const [advanced, setAdvanced] = useState(false);
  const [weight, setWeight] = useState(85);
  const [pricePerKg, setPricePerKg] = useState(9500);
  const [hours, setHours] = useState(3.5);

  const [kwh, setKwh] = useState(0.18);
  const [energyCost, setEnergyCost] = useState(120);
  const [wear, setWear] = useState(150);
  const [labor, setLabor] = useState(1000);
  const [margin, setMargin] = useState(35);
  const [taxes, setTaxes] = useState(10);
  const [other, setOther] = useState(0);

  const materialCost = (weight / 1000) * pricePerKg;

  const basicTotal = materialCost + hours * 200;

  const energyTotal = kwh * hours * energyCost;
  const wearTotal = wear * hours;
  const subtotal = materialCost + energyTotal + wearTotal + labor + other;
  const withMargin = subtotal * (1 + margin / 100);
  const advancedTotal = withMargin * (1 + taxes / 100);

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Calculadora de costos"
        action={
          <GhostButton onClick={() => setAdvanced((a) => !a)}>
            <Zap size={14} className={advanced ? "text-orange-500 fill-orange-500" : ""} />
            {advanced ? "Modo básico" : "Modo avanzado"}
          </GhostButton>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <p className="mb-4 text-sm font-bold text-gray-900">Datos de la pieza</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumberField label="Peso de la pieza" value={weight} onChange={setWeight} suffix="g" />
            <NumberField label="Costo por kg de filamento" value={pricePerKg} onChange={setPricePerKg} suffix="$" />
            <NumberField label="Tiempo de impresión" value={hours} onChange={setHours} suffix="h" step={0.1} />
          </div>

          {advanced && (
            <>
              <div className="my-5 h-px bg-gray-100" />
              <p className="mb-4 text-sm font-bold text-gray-900">Costos avanzados</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                <NumberField label="Consumo energético" value={kwh} onChange={setKwh} suffix="kWh" step={0.01} />
                <NumberField label="Costo de electricidad" value={energyCost} onChange={setEnergyCost} suffix="$/kWh" />
                <NumberField label="Desgaste de impresora" value={wear} onChange={setWear} suffix="$/h" />
                <NumberField label="Mano de obra" value={labor} onChange={setLabor} suffix="$" />
                <NumberField label="Margen de ganancia" value={margin} onChange={setMargin} suffix="%" />
                <NumberField label="Impuestos" value={taxes} onChange={setTaxes} suffix="%" />
                <NumberField label="Otros gastos" value={other} onChange={setOther} suffix="$" />
              </div>
            </>
          )}
        </Card>

        <Card className="h-fit p-5">
          <p className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-900">
            <DollarSign size={16} className="text-orange-500" /> Resultado
          </p>

          {!advanced ? (
            <>
              <div className="flex items-center justify-between py-1.5 text-sm text-gray-500">
                <span>Costo de material</span>
                <span className="font-semibold text-gray-800">${materialCost.toFixed(0)}</span>
              </div>
              <div className="my-3 h-px bg-gray-100" />
              <div className="flex items-center justify-between text-lg font-bold text-gray-900">
                <span>Total estimado</span>
                <span className="text-orange-600">${basicTotal.toFixed(0)}</span>
              </div>
            </>
          ) : (
            <>
              {[
                ["Material", materialCost],
                ["Energía", energyTotal],
                ["Desgaste", wearTotal],
                ["Mano de obra", labor],
                ["Otros gastos", other],
              ].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between py-1.5 text-sm text-gray-500">
                  <span>{label as string}</span>
                  <span className="font-semibold text-gray-800">${(val as number).toFixed(0)}</span>
                </div>
              ))}
              <div className="my-3 h-px bg-gray-100" />
              <div className="flex items-center justify-between py-1 text-sm text-gray-500">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between py-1 text-sm text-gray-500">
                <span>+ Margen ({margin}%)</span>
                <span>${withMargin.toFixed(0)}</span>
              </div>
              <div className="my-3 h-px bg-gray-100" />
              <div className="flex items-center justify-between text-lg font-bold text-gray-900">
                <span>Total final</span>
                <span className="text-orange-600">${advancedTotal.toFixed(0)}</span>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
