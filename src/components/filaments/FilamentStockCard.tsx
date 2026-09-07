"use client";

import { Edit2, History, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { normalizeFilamentColor } from "@/lib/colors/filament-colors";

interface FilamentStockCardProps {
  filament: {
    id: string;
    name?: string | null;
    filament_type?: string | null;
    brand?: string | null;
    color?: string | null;
    color_hex?: string | null;
    remaining_grams?: number | null;
    total_grams?: number | null;
    purchase_price?: number | null;
    filament_templates?: { brand?: string | null } | null;
  };
  adjustAmount: string;
  adjusting: boolean;
  onAdjustAmountChange: (value: string) => void;
  onAdjust: (type: "add" | "subtract") => void;
  onHistory: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function resolveColorHex(color: string | null | undefined, colorHex: string | null | undefined) {
  if (colorHex && /^#[0-9a-f]{6}$/i.test(colorHex)) return colorHex;
  return normalizeFilamentColor(color || "")?.hex || "#737373";
}

export function FilamentStockCard({
  filament,
  adjustAmount,
  adjusting,
  onAdjustAmountChange,
  onAdjust,
  onHistory,
  onEdit,
  onRemove,
}: FilamentStockCardProps) {
  const remaining = Math.max(0, Number(filament.remaining_grams) || 0);
  const total = Math.max(0, Number(filament.total_grams) || 0);
  const percentage = total > 0 ? Math.min(100, Math.round((remaining / total) * 100)) : 0;
  const isLow = percentage <= 20;
  const brand = filament.brand || filament.filament_templates?.brand || "Sin marca";
  const colorHex = resolveColorHex(filament.color, filament.color_hex);
  const costPerKg = total > 0 ? (Number(filament.purchase_price) || 0) / total * 1000 : 0;

  return (
    <article className="overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface p-4 shadow-lg shadow-black/15">
      <div className="flex min-w-0 gap-4">
        <div className="relative flex h-24 w-24 shrink-0 items-center justify-center" aria-hidden="true">
          <div className="absolute h-[5.15rem] w-[5.15rem] rounded-full border-[7px] border-neutral-700 bg-neutral-900 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_8px_18px_rgba(0,0,0,0.3)]" />
          <div className="absolute h-[3.75rem] w-[3.75rem] rounded-full border-[9px] shadow-[inset_0_0_12px_rgba(0,0,0,0.4)]" style={{ borderColor: colorHex }} />
          <div className="absolute h-6 w-6 rounded-full border-4 border-neutral-600 bg-stampa-bg" />
          <span className="absolute bottom-0 rounded-full border border-white/10 bg-stampa-bg/95 px-2 py-0.5 text-[9px] font-black text-gray-300">{percentage}%</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-bold uppercase tracking-wider text-gray-500">{brand}</p>
              <h3 className="mt-0.5 truncate text-base font-black text-white">{filament.filament_type || "Material"}</h3>
              <p className="mt-0.5 truncate text-xs text-gray-400">{filament.name || "Sin subtipo"}</p>
            </div>
            {isLow && <span className="shrink-0 rounded-full border border-red-500/25 bg-red-500/10 px-2 py-1 text-[9px] font-black uppercase text-red-300">Bajo</span>}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            <span className="h-3 w-3 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: colorHex }} />
            <span className="truncate">{filament.color || "Sin color"}</span>
          </div>
          <p className="mt-2 text-xs text-gray-500">Costo/kg <strong className="text-gray-300">${costPerKg.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</strong></p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-end justify-between gap-2">
          <p className="text-xs font-semibold text-gray-500">Disponible</p>
          <p className={`text-sm font-black ${isLow ? "text-red-300" : "text-white"}`}>{remaining.toLocaleString("es-AR")}g <span className="font-medium text-gray-500">/ {total.toLocaleString("es-AR")}g</span></p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
          <div className={`h-full rounded-full transition-[width] ${isLow ? "bg-red-400" : "bg-stampa-orange"}`} style={{ width: `${percentage}%` }} />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-stampa-border pt-4 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between">
        <div className="flex min-w-0 items-center gap-1">
          <input
            type="number"
            min="1"
            step="1"
            placeholder="gramos"
            value={adjustAmount}
            onChange={(event) => onAdjustAmountChange(event.target.value)}
            disabled={adjusting}
            aria-label={`Gramos para ajustar ${filament.name || filament.filament_type}`}
            className="h-10 min-w-0 flex-1 rounded-lg border border-stampa-border bg-stampa-bg-soft px-3 text-xs text-white outline-none focus:border-stampa-orange min-[390px]:w-24 min-[390px]:flex-none"
          />
          <button onClick={() => onAdjust("subtract")} disabled={adjusting} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 disabled:opacity-50" aria-label="Restar gramos">
            {adjusting ? <Loader2 size={15} className="animate-spin" /> : <Minus size={15} />}
          </button>
          <button onClick={() => onAdjust("add")} disabled={adjusting} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 disabled:opacity-50" aria-label="Sumar gramos">
            {adjusting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          </button>
        </div>

        <div className="flex items-center justify-end gap-1">
          <button onClick={onHistory} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-white/5 hover:text-white" aria-label="Ver historial"><History size={16} /></button>
          <button onClick={onEdit} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-stampa-orange/10 hover:text-stampa-orange" aria-label="Editar filamento"><Edit2 size={16} /></button>
          <button onClick={onRemove} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-red-500/10 hover:text-red-300" aria-label="Quitar filamento"><Trash2 size={16} /></button>
        </div>
      </div>
    </article>
  );
}
