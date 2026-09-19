"use client";

import React from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { NumberField, SegmentedControl } from "@/components/maker/MakerTextControls";
import { MAX_BACK_CUTOUTS, createDefaultBackCutout } from "@/lib/maker/geometry/backCutouts";
import type { BackCutout } from "@/lib/maker/types";

const TYPE_OPTIONS: { value: BackCutout["type"]; label: string }[] = [
  { value: "circle", label: "Circular" },
  { value: "capsule", label: "Cápsula" },
  { value: "keyhole", label: "Colgador" },
];

let idCounter = 0;
function newCutoutId(): string {
  idCounter += 1;
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `cutout-${Date.now()}-${idCounter}`;
}

interface Props {
  cutouts: BackCutout[];
  onChange: (cutouts: BackCutout[]) => void;
  /** Mensajes de error (parámetros o geometría) con prefijo "Recorte N: ..." para mostrarlos junto a cada tarjeta. */
  errors: string[];
}

/** MONTAJE Y CONEXIONES: lista de recortes traseros (cada uno una forma paramétrica; sin lógica por "uso"). */
export function MakerBackCutoutsSection({ cutouts, onChange, errors }: Props) {
  const update = (index: number, patch: Partial<BackCutout>) =>
    onChange(cutouts.map((c, i) => (i === index ? ({ ...c, ...patch } as BackCutout) : c)));

  const changeType = (index: number, type: BackCutout["type"]) => {
    const current = cutouts[index];
    if (current.type === type) return;
    const next = createDefaultBackCutout(type, current.id, current.x, current.y);
    onChange(cutouts.map((c, i) => (i === index ? next : c)));
  };

  return (
    <div className="flex flex-col gap-3 ">
      <div>
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Montaje y conexiones</span>
        <p className="mt-1 text-xs text-gray-500">
          Aberturas pasantes en la base trasera (cable, conector, tornillo, colgador). X/Y se miden desde el centro del diseño, visto de frente.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-300">Recortes traseros</span>
        <button
          type="button"
          onClick={() => onChange([...cutouts, createDefaultBackCutout("circle", newCutoutId())])}
          disabled={cutouts.length >= MAX_BACK_CUTOUTS}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} /> Agregar
        </button>
      </div>

      {errors.filter((e) => !/^Recorte [0-9]+:/.test(e)).map((message) => (
        <span key={message} className="text-xs text-red-400">
          {message}
        </span>
      ))}

      {cutouts.length === 0 && <p className="text-xs text-gray-500">Sin recortes.</p>}

      {cutouts.map((c, i) => {
        const cardErrors = errors.filter((e) => e.startsWith(`Recorte ${i + 1}:`));
        return (
          <div key={c.id} className={`flex flex-col gap-3 rounded-xl border bg-white/[0.03] p-3 ${cardErrors.length ? "border-red-500/40" : "border-white/10"}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Recorte {i + 1}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  title="Duplicar recorte"
                  aria-label={`Duplicar recorte ${i + 1}`}
                  disabled={cutouts.length >= MAX_BACK_CUTOUTS}
                  onClick={() => onChange([...cutouts.slice(0, i + 1), { ...c, id: newCutoutId(), x: c.x + 5 }, ...cutouts.slice(i + 1)])}
                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  title="Eliminar recorte"
                  aria-label={`Eliminar recorte ${i + 1}`}
                  onClick={() => onChange(cutouts.filter((_, k) => k !== i))}
                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-red-300"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div>
              <span className="mb-1 block text-xs font-semibold text-gray-500">Tipo</span>
              <SegmentedControl compact options={TYPE_OPTIONS} value={c.type} onChange={(t) => changeType(i, t)} />
            </div>

            {c.type === "circle" && (
              <NumberField label="Diámetro" value={c.diameterMm} suffix="mm" onChange={(v) => update(i, { diameterMm: v })} />
            )}
            {c.type === "capsule" && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Ancho" value={c.widthMm} suffix="mm" onChange={(v) => update(i, { widthMm: v })} />
                <NumberField label="Alto" value={c.heightMm} suffix="mm" onChange={(v) => update(i, { heightMm: v })} />
              </div>
            )}
            {c.type === "keyhole" && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Diámetro cabeza" value={c.headDiameterMm} suffix="mm" onChange={(v) => update(i, { headDiameterMm: v })} />
                <NumberField label="Ancho del cuello" value={c.neckWidthMm} suffix="mm" onChange={(v) => update(i, { neckWidthMm: v })} />
                <NumberField label="Largo del cuello" value={c.neckLengthMm} suffix="mm" onChange={(v) => update(i, { neckLengthMm: v })} />
                <NumberField label="Diámetro extremo" value={c.tailDiameterMm} suffix="mm" onChange={(v) => update(i, { tailDiameterMm: v })} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Posición X" value={c.x} suffix="mm" onChange={(v) => update(i, { x: v })} />
              <NumberField label="Posición Y" value={c.y} suffix="mm" onChange={(v) => update(i, { y: v })} />
            </div>

            {c.type !== "circle" && (
              <NumberField label="Rotación" value={c.rotationDeg} suffix="°" onChange={(v) => update(i, { rotationDeg: v })} />
            )}

            {cardErrors.map((message) => (
              <span key={message} className="text-xs text-red-400">
                {message.replace(/^Recorte \d+: /, "")}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
