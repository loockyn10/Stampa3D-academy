"use client";

import React from "react";
import { AlertTriangle, Check, Copy, Dices, Download, Loader2, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { NumberField, SegmentedControl } from "@/components/maker/MakerTextControls";
import { decodeLampDesign, encodeLampDesign } from "@/lib/maker/lamps/designCode";
import { LAMP_PRESETS, type LampPreset } from "@/lib/maker/lamps/presets";
import { LAMP_MEASUREMENTS_NEEDED, LAMP_NOTICE_CODES, LAMP_PHYSICAL_TESTS, LAMP_SAFETY_NOTICES } from "@/lib/maker/lamps/safety";
import { lampSilhouette } from "@/lib/maker/lamps/silhouette";
import { LAMP_LIMITS, type LampBaseDef, type LampBulbDef, type LampCableDef, type LampDefinition, type LampFamily, type LampHolderDef, type LampInsertDef, type LampIssue, type LampMetrics, type LampProfile, type LampShadeDef, type LampThreadDef } from "@/lib/maker/lamps/types";

const FAMILY_OPTIONS: { value: LampFamily; label: string }[] = [
  { value: "wavy", label: "Ondulada" },
  { value: "spiral", label: "Espiral" },
  { value: "organic", label: "Orgánica" },
];
const CONNECTION_OPTIONS: { value: LampThreadDef["connection"]; label: string }[] = [
  { value: "integrated", label: "Rosca en la pantalla" },
  { value: "collar", label: "Collar (modo vaso)" },
];
const PROFILE_OPTIONS: { value: LampProfile; label: string }[] = [
  { value: "straight", label: "Recto" },
  { value: "barrel", label: "Barril" },
  { value: "waist", label: "Cintura" },
  { value: "bell", label: "Campana" },
  { value: "tulip", label: "Tulipán" },
];

/** Colores de referencia del cilindro. Son una aproximación visual del filamento, no una simulación de la luz. */
export const LAMP_INSERT_SWATCHES: { value: string; label: string }[] = [
  { value: "#e5483b", label: "Rojo" },
  { value: "#f08a24", label: "Naranja" },
  { value: "#f2c230", label: "Amarillo" },
  { value: "#3fae5a", label: "Verde" },
  { value: "#25b5b0", label: "Turquesa" },
  { value: "#3b7be5", label: "Azul" },
  { value: "#8a5bd6", label: "Violeta" },
  { value: "#e86aa8", label: "Rosa" },
  { value: "#f3f1ea", label: "Natural" },
];

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => String(round1(n)).replace(".", ",");

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{children}</h3>;
}

function InfoRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={strong ? "text-right font-bold text-stampa-accent" : "text-right font-semibold text-gray-200"}>{value}</span>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-gray-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-fg/20 bg-fg/[0.06] text-stampa-accent focus:ring-2 focus:ring-stampa-orange/40 focus:ring-offset-0"
      />
      {label}
    </label>
  );
}

/** Slider con el valor visible: el control principal de la herramienta (la experiencia es visual, no numérica). */
function SliderField({ label, value, min, max, step, suffix = "", onChange, error }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs font-semibold text-gray-500">
        <span>{label}</span>
        <span className="text-gray-300">
          {fmt(value)}
          {suffix}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-stampa-orange" />
      {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
    </label>
  );
}

function Details({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-fg/10 bg-fg/[0.03]">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold text-gray-300">
        {title}
        <span aria-hidden className="text-gray-500 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3">{children}</div>
    </details>
  );
}

function PresetThumb({ preset, def, active, onApply }: { preset: LampPreset; def: LampDefinition; active: boolean; onApply: (p: LampPreset) => void }) {
  // La miniatura sale del mismo evaluador que la geometría, con las medidas actuales de la pantalla.
  const shade: LampShadeDef = { ...def.shade, ...preset.recipe, topDiameterMm: Math.round(def.shade.bottomDiameterMm * preset.recipe.topRatio) };
  const s = React.useMemo(() => lampSilhouette(shade, 64), [shade.family, shade.profile, shade.profileAmountPct, shade.topDiameterMm, shade.bottomDiameterMm, shade.heightMm, shade.collarHeightMm, shade.amplitudeMm, shade.waves, shade.twistDeg, shade.verticalFrequency, shade.patternIntensityPct, shade.organicPct, shade.seed, shade.wallMm]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button
      type="button"
      title={preset.description}
      aria-pressed={active}
      onClick={() => onApply(preset)}
      className={`flex flex-col items-center gap-1 rounded-xl border px-1.5 pb-1.5 pt-2 transition-colors ${active ? "border-stampa-orange/60 bg-stampa-orange/10" : "border-fg/10 bg-fg/[0.04] hover:border-stampa-orange/40"}`}
    >
      <svg viewBox={`0 0 ${s.width} ${s.height}`} height={56} className="max-w-full" aria-hidden>
        <path d={s.crest} className="fill-stampa-accent/25 stroke-stampa-accent" strokeWidth={1.2} strokeLinejoin="round" />
        <path d={s.valley} className="fill-none stroke-stampa-accent/50" strokeWidth={0.8} strokeLinejoin="round" />
      </svg>
      <span className="text-center text-[11px] font-semibold leading-tight text-gray-300">{preset.label}</span>
    </button>
  );
}

function isPresetActive(def: LampDefinition, preset: LampPreset): boolean {
  const { topRatio, ...r } = preset.recipe;
  return (Object.keys(r) as (keyof typeof r)[]).every((k) => def.shade[k] === r[k]) && def.shade.topDiameterMm === Math.round(def.shade.bottomDiameterMm * topRatio);
}

export interface MakerLampControlsProps {
  def: LampDefinition;
  onChange: (next: LampDefinition) => void;
  onApplyPreset: (preset: LampPreset) => void;
  onGenerateVariation: () => void;
  /** Cargar un diseño completo desde su código. */
  onLoadDesign: (def: LampDefinition) => void;
  onError: (message: string) => void;
  errors: LampIssue[];
  warnings: LampIssue[];
  metrics: LampMetrics | null;
  exportButtons: React.ReactNode;
}

/** Panel izquierdo de /stampa-maker/lamparas. Solo presentación: edita la LampDefinition y muestra métricas/avisos. */
export function MakerLampControls({ def, onChange, onApplyPreset, onGenerateVariation, onLoadDesign, onError, errors, warnings, metrics, exportButtons }: MakerLampControlsProps) {
  const err = (field: string) => errors.find((e) => e.field === field)?.message;
  const setShade = (patch: Partial<LampShadeDef>) => onChange({ ...def, shade: { ...def.shade, ...patch } });
  const setInsert = (patch: Partial<LampInsertDef>) => onChange({ ...def, insert: { ...def.insert, ...patch } });
  const setThread = (patch: Partial<LampThreadDef>) => onChange({ ...def, thread: { ...def.thread, ...patch } });
  const setBase = (patch: Partial<LampBaseDef>) => onChange({ ...def, base: { ...def.base, ...patch } });
  const setHolder = (patch: Partial<LampHolderDef>) => onChange({ ...def, holder: { ...def.holder, ...patch } });
  const setBulb = (patch: Partial<LampBulbDef>) => onChange({ ...def, bulb: { ...def.bulb, ...patch } });
  const setCable = (patch: Partial<LampCableDef>) => onChange({ ...def, cable: { ...def.cable, ...patch } });
  const issuesFor = (match: (i: LampIssue) => boolean) => [...errors, ...warnings].filter(match);
  const L = LAMP_LIMITS;
  const fit = metrics?.fit ?? null;
  const [copied, setCopied] = React.useState(false);
  const [pasted, setPasted] = React.useState("");
  const code = React.useMemo(() => encodeLampDesign(def), [def]);
  const notices = new Set<string>(LAMP_NOTICE_CODES);
  const shownWarnings = warnings.filter((w) => !notices.has(w.code));
  const holderNotValidated = warnings.some((w) => w.code === "HOLDER_NOT_VALIDATED");

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onError("No se pudo copiar. Seleccioná el código y copialo a mano.");
    }
  };
  const loadCode = () => {
    const decoded = decodeLampDesign(pasted);
    if ("error" in decoded) onError(decoded.error);
    else {
      onLoadDesign(decoded.def);
      setPasted("");
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-5">
      {/* ------------------------------------------------------------------ DISEÑO */}
      <section className="flex flex-col gap-3">
        <SectionLabel>1 · Diseño</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {LAMP_PRESETS.map((preset) => (
            <PresetThumb key={preset.id} preset={preset} def={def} active={isPresetActive(def, preset)} onApply={onApplyPreset} />
          ))}
        </div>
        <button
          type="button"
          onClick={onGenerateVariation}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-stampa-orange/40 bg-stampa-orange/10 px-3 text-sm font-semibold text-stampa-accent transition-colors hover:bg-stampa-orange/20"
        >
          <Dices size={16} />
          Generar variación
        </button>
        <p className="text-xs text-gray-500">
          Semilla <span className="font-semibold text-gray-300">{def.shade.seed}</span>: la misma semilla y los mismos datos vuelven a dar exactamente este diseño. El diseño solo controla la apariencia: no cambia la rosca, la base ni el cilindro.
        </p>
        <span className="text-xs font-semibold text-gray-500">Familia de patrón</span>
        <SegmentedControl options={FAMILY_OPTIONS} value={def.shade.family} onChange={(family) => setShade({ family })} compact />
        <SliderField label="Altura de la pantalla (parte decorativa)" value={def.shade.heightMm} min={80} max={320} step={5} suffix=" mm" onChange={(v) => setShade({ heightMm: v })} error={err("shade.heightMm")} />
        <SliderField label="Diámetro inferior" value={def.shade.bottomDiameterMm} min={100} max={260} step={5} suffix=" mm" onChange={(v) => setShade({ bottomDiameterMm: v })} error={err("shade.bottomDiameterMm")} />
        <SliderField label="Diámetro superior" value={def.shade.topDiameterMm} min={80} max={280} step={5} suffix=" mm" onChange={(v) => setShade({ topDiameterMm: v })} error={err("shade.topDiameterMm")} />
        <span className="text-xs font-semibold text-gray-500">Perfil</span>
        <SegmentedControl options={PROFILE_OPTIONS} value={def.shade.profile} onChange={(profile) => setShade({ profile })} compact />
        <SliderField label="Cantidad de ondas" value={def.shade.waves} min={L["shade.waves"].min} max={L["shade.waves"].max} step={1} onChange={(v) => setShade({ waves: Math.round(v) })} error={err("shade.waves")} />
        <SliderField label="Amplitud" value={def.shade.amplitudeMm} min={0} max={20} step={0.5} suffix=" mm" onChange={(v) => setShade({ amplitudeMm: v })} error={err("shade.amplitudeMm")} />
        <SliderField label="Torsión" value={def.shade.twistDeg} min={-720} max={720} step={5} suffix="°" onChange={(v) => setShade({ twistDeg: v })} error={err("shade.twistDeg")} />
        <Details title="Variaciones y opciones del diseño">
          <SliderField label="Variación vertical (ciclos)" value={def.shade.verticalFrequency} min={0} max={6} step={0.5} onChange={(v) => setShade({ verticalFrequency: v })} error={err("shade.verticalFrequency")} />
          <SliderField label="Intensidad del patrón" value={def.shade.patternIntensityPct} min={0} max={100} step={5} suffix="%" onChange={(v) => setShade({ patternIntensityPct: v })} error={err("shade.patternIntensityPct")} />
          {def.shade.family === "organic" && <SliderField label="Variación orgánica" value={def.shade.organicPct} min={0} max={100} step={5} suffix="%" onChange={(v) => setShade({ organicPct: v })} error={err("shade.organicPct")} />}
          {def.shade.profile !== "straight" && <SliderField label="Intensidad del perfil" value={def.shade.profileAmountPct} min={0} max={100} step={5} suffix="%" onChange={(v) => setShade({ profileAmountPct: v })} error={err("shade.profileAmountPct")} />}
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Espesor de pared" value={def.shade.wallMm} onChange={(v) => setShade({ wallMm: v })} suffix="mm" error={err("shade.wallMm")} />
            <NumberField label="Tramo recto inferior" value={def.shade.collarHeightMm} onChange={(v) => setShade({ collarHeightMm: v })} suffix="mm" error={err("shade.collarHeightMm")} />
          </div>
          <NumberField label="Semilla" value={def.shade.seed} onChange={(v) => setShade({ seed: Math.max(0, Math.round(v)) })} error={err("shade.seed")} />
        </Details>
        {issuesFor((i) => !!i.field?.startsWith("shade.") || i.code.startsWith("SHADE_")).map((i, k) => (
          <p key={`${i.code}-${k}`} className={`text-xs ${errors.includes(i) ? "text-red-400" : "text-amber-300"}`}>{i.message}</p>
        ))}
      </section>

      {/* ------------------------------------------------------------------ ILUMINACIÓN */}
      <section className="flex flex-col gap-3">
        <SectionLabel>2 · Iluminación</SectionLabel>
        <Toggle label="Usar cilindro de color" checked={def.insert.enabled} onChange={(enabled) => setInsert({ enabled })} />
        <p className="text-xs text-gray-500">Un cilindro independiente de filamento translúcido que rodea la bombilla LED blanca y apoya en una ranura de la base. Imprimí varios y cambiá el color sin desmontar el portalámparas.</p>
        {def.insert.enabled && (
          <>
            <div role="radiogroup" aria-label="Color del cilindro" className="flex flex-wrap gap-2">
              {LAMP_INSERT_SWATCHES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={def.insert.previewColor === c.value}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setInsert({ previewColor: c.value })}
                  style={{ backgroundColor: c.value }}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${def.insert.previewColor === c.value ? "scale-110 border-stampa-accent" : "border-fg/20 hover:scale-105"}`}
                />
              ))}
              <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border-2 border-dashed border-fg/30" title="Otro color">
                <span className="sr-only">Otro color</span>
                <input type="color" value={def.insert.previewColor} onChange={(e) => setInsert({ previewColor: e.target.value })} className="absolute -inset-2 h-12 w-12 cursor-pointer opacity-0" />
                <span aria-hidden className="flex h-full w-full items-center justify-center text-sm text-gray-400">+</span>
              </label>
            </div>
            <p className="text-xs text-gray-500">El color del visor es una aproximación visual, no una simulación fotométrica. La luz real depende del filamento, su espesor y la bombilla.</p>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Ø exterior del cilindro" value={def.insert.diameterMm ?? fit?.insertOuterDiameterMm ?? 65} onChange={(v) => setInsert({ diameterMm: v })} suffix="mm" error={err("insert.diameterMm")} />
              <NumberField label="Espesor" value={def.insert.thicknessMm} onChange={(v) => setInsert({ thicknessMm: v })} suffix="mm" error={err("insert.thicknessMm")} />
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
              <InfoRow label={fit?.insertAuto ? "Diámetro exterior (el más angosto)" : "Diámetro exterior"} value={fit?.insertOuterDiameterMm != null ? `Ø ${fmt(fit.insertOuterDiameterMm)} mm` : "—"} strong />
              <InfoRow label="Diámetro interior" value={fit?.insertInnerDiameterMm != null ? `Ø ${fmt(fit.insertInnerDiameterMm)} mm` : "—"} />
              <InfoRow label="Separación radial a la bombilla" value={fit?.insertBulbGapMm != null ? `${fmt(fit.insertBulbGapMm)} mm` : "—"} />
              <InfoRow label="Separación radial a los anillos" value={fit?.tower.ringsToInsertGapMm != null ? `${fmt(fit.tower.ringsToInsertGapMm)} mm` : "—"} />
              <InfoRow label="Se saca por arriba" value={fit?.insertRemovableFromTop == null ? "—" : fit.insertRemovableFromTop ? "Sí, sin desmontar nada" : "No: hay que desenroscar la pantalla"} />
            </div>
            <Details title="Dimensiones del cilindro">
              <SliderField label="Holgura en la ranura (por lado)" value={def.insert.clearanceMm} min={L["insert.clearanceMm"].min} max={L["insert.clearanceMm"].max} step={0.05} suffix=" mm" onChange={(v) => setInsert({ clearanceMm: v })} error={err("insert.clearanceMm")} />
              <SliderField label="Altura del cilindro" value={def.insert.heightPct} min={L["insert.heightPct"].min} max={L["insert.heightPct"].max} step={1} suffix="%" onChange={(v) => setInsert({ heightPct: v })} error={err("insert.heightPct")} />
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Profundidad de la ranura" value={def.insert.seatDepthMm} onChange={(v) => setInsert({ seatDepthMm: v })} suffix="mm" error={err("insert.seatDepthMm")} />
                <NumberField label="Separación mínima a la bombilla" value={def.insert.minBulbGapMm} onChange={(v) => setInsert({ minBulbGapMm: v })} suffix="mm" error={err("insert.minBulbGapMm")} />
              </div>
              <Toggle label="Diámetro automático (el más angosto posible)" checked={def.insert.diameterMm === null} onChange={(auto) => setInsert({ diameterMm: auto ? null : (fit?.insertOuterDiameterMm ?? 65) })} />
              <Toggle label="Lengüetas para extraerlo (impresión convencional)" checked={def.insert.tabs} onChange={(tabs) => setInsert({ tabs })} />
              <p className="text-xs text-gray-500">La separación mínima solo evita el contacto previsto con las medidas cargadas: no es una distancia térmicamente segura.</p>
            </Details>
            {issuesFor((i) => !!i.field?.startsWith("insert.") || i.code.startsWith("INSERT_") || i.code.startsWith("TOWER_")).map((i, k) => (
              <p key={`${i.code}-${k}`} className={`text-xs ${errors.includes(i) ? "text-red-400" : "text-amber-300"}`}>{i.message}</p>
            ))}
          </>
        )}
      </section>

      {/* ------------------------------------------------------------------ FABRICACIÓN */}
      <section className="flex flex-col gap-3">
        <SectionLabel>3 · Fabricación</SectionLabel>

        <span className="text-xs font-semibold text-gray-500">Perfil de base E27</span>
        <div className="rounded-xl border border-fg/10 bg-fg/[0.03] p-3 text-xs text-gray-300">
          <span className="font-semibold text-stampa-accent">Doble anillo · referencia «bottom.stl»</span> — portalámparas E27 de cuerpo roscado con dos anillos de sujeción, que entra por un agujero central y se fija con sus propios anillos en un rebaje. Es el único perfil disponible; no es una base universal.
        </div>
        {holderNotValidated ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">Base PRELIMINAR - NO VALIDADA. Las medidas salen de los datos de referencia (Ø42, Ø58) y del STL, no de tu portalámparas: medilo, cargalo e imprimí la pieza de prueba antes de fabricar la base.</p>
        ) : (
          <p className="rounded-lg border border-fg/10 bg-fg/[0.03] p-2.5 text-xs text-gray-400">Medidas verificadas por vos. El conjunto sigue pendiente de validación física.</p>
        )}
        <Toggle label="Estas medidas son de mi portalámparas real" checked={def.holder.measured} onChange={(measured) => setHolder({ measured })} />
        <Details title="Portalámparas, bombilla y cable" defaultOpen>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Ø agujero central" value={def.holder.boreDiameterMm} onChange={(v) => setHolder({ boreDiameterMm: v })} suffix="mm" error={err("holder.boreDiameterMm")} />
            <NumberField label="Ø anillos (máx.)" value={def.holder.ringsDiameterMm} onChange={(v) => setHolder({ ringsDiameterMm: v })} suffix="mm" error={err("holder.ringsDiameterMm")} />
            <NumberField label="Holgura del rebaje" value={def.holder.ringsClearanceMm} onChange={(v) => setHolder({ ringsClearanceMm: v })} suffix="mm" error={err("holder.ringsClearanceMm")} />
            <NumberField label="Prof. del rebaje" value={def.holder.ringsRecessDepthMm} onChange={(v) => setHolder({ ringsRecessDepthMm: v })} suffix="mm" error={err("holder.ringsRecessDepthMm")} />
            <NumberField label="Altura del apoyo" value={def.holder.seatHeightMm} onChange={(v) => setHolder({ seatHeightMm: v })} suffix="mm" error={err("holder.seatHeightMm")} />
            <NumberField label="Ø cuerpo s/ base" value={def.holder.bodyDiameterMm} onChange={(v) => setHolder({ bodyDiameterMm: v })} suffix="mm" error={err("holder.bodyDiameterMm")} />
            <NumberField label="Alto portalámparas" value={def.holder.heightMm} onChange={(v) => setHolder({ heightMm: v })} suffix="mm" error={err("holder.heightMm")} />
            <NumberField label="Ø bombilla" value={def.bulb.diameterMm} onChange={(v) => setBulb({ diameterMm: v })} suffix="mm" error={err("bulb.diameterMm")} />
            <NumberField label="Alto bombilla s/ portalámp." value={def.bulb.heightAboveHolderMm} onChange={(v) => setBulb({ heightAboveHolderMm: v })} suffix="mm" error={err("bulb.heightAboveHolderMm")} />
            <NumberField label="Ø cable" value={def.cable.diameterMm} onChange={(v) => setCable({ diameterMm: v })} suffix="mm" error={err("cable.diameterMm")} />
          </div>
          <Toggle label="Ranuras para precinto (alivio de tensión del cable)" checked={def.cable.tieAnchor} onChange={(tieAnchor) => setCable({ tieAnchor })} />
          <p className="text-xs text-gray-500">El cable baja por el agujero central y sale por un canal inferior. Para sujetarlo usá un precinto plástico comercial (o un prensacable); no se imprime ningún componente eléctrico.</p>
          <Toggle label="Diámetro de la base automático" checked={def.base.diameterMm === null} onChange={(auto) => setBase({ diameterMm: auto ? null : (fit?.baseDiameterMm ?? 120) })} />
          {def.base.diameterMm !== null && <NumberField label="Diámetro de la base" value={def.base.diameterMm} onChange={(v) => setBase({ diameterMm: v })} suffix="mm" error={err("base.diameterMm")} />}
        </Details>
        <div className="flex flex-col gap-1.5 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
          <InfoRow label="Agujero central" value={fit ? `Ø ${fmt(fit.tower.boreDiameterMm)} mm` : "—"} strong />
          <InfoRow label="Rebaje de los anillos" value={fit ? `Ø ${fmt(fit.tower.ringsRecessDiameterMm)} × ${fmt(fit.tower.ringsRecessDepthMm)} mm` : "—"} />
          <InfoRow label="Material bajo el apoyo de los anillos" value={fit ? `${fmt(fit.tower.seatMaterialMm)} mm` : "—"} />
          <InfoRow label="Torre / ranura del cilindro" value={fit && def.insert.enabled ? `Ø ${fmt(fit.tower.towerDiameterMm)} / Ø ${fmt(fit.tower.slotInnerDiameterMm)}–${fmt(fit.tower.slotOuterDiameterMm)}` : "—"} />
          <InfoRow label="Pared entre rebaje y ranura" value={fit && def.insert.enabled ? `${fmt(fit.tower.innerWallMm)} mm` : "—"} />
          <InfoRow label="Altura / diámetro de la base" value={fit ? `${fmt(fit.baseHeightMm)} mm / Ø ${fmt(fit.baseDiameterMm)} mm` : "—"} />
        </div>
        {issuesFor((i) => (!!i.field?.startsWith("holder.") && i.code !== "HOLDER_NOT_VALIDATED") || !!i.field?.startsWith("cable.") || !!i.field?.startsWith("base.") || i.code.startsWith("HOLDER_") || i.code.startsWith("RINGS_") || i.code === "TOWER_ABOVE_BASE" || i.code === "TOWER_TOO_WIDE_FOR_THREAD" || i.code === "TIE_ANCHOR_NO_ROOM" || i.code === "BASE_STABILITY").map((i, k) => (
          <p key={`${i.code}-${k}`} className={`text-xs ${errors.includes(i) ? "text-red-400" : "text-amber-300"}`}>{i.message}</p>
        ))}

        <span className="mt-1 text-xs font-semibold text-gray-500">Rosca de unión pantalla–base</span>
        <SegmentedControl options={CONNECTION_OPTIONS} value={def.thread.connection} onChange={(connection) => setThread({ connection })} compact />
        <p className="text-xs text-gray-500">
          {def.thread.connection === "integrated"
            ? "La pantalla lleva un cuello roscado macho que se enrosca en la base hasta un tope plano. Se imprime de forma convencional."
            : "La pantalla queda lisa (candidata a modo vaso) y un collar roscado aparte la une a la base: el borde de la pantalla entra a presión en el pozo del collar."}{" "}
          La rosca es propia de StampaMaker (no la eléctrica E27), no depende del portalámparas y es la misma para cualquier pantalla: cambiar el diseño no la modifica.
        </p>
        <div className="flex flex-col gap-1.5 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
          <InfoRow label="Rosca" value={fit ? `Ø ${fmt(fit.thread.majorDiameterMm)} · paso ${fmt(fit.thread.pitchMm)} · ${fit.thread.starts} entrada${fit.thread.starts === 1 ? "" : "s"}` : "—"} strong />
          <InfoRow label="Vueltas hasta el tope" value={fit ? fmt(fit.thread.turnsToSeat) : "—"} />
          <InfoRow label="Holgura radial / normal al flanco" value={fit ? `${fmt(fit.thread.radialClearanceMm)} / ${String(fit.thread.normalClearanceMm).replace(".", ",")} mm` : "—"} />
          <InfoRow label="Juego axial" value={fit ? `${fmt(fit.thread.axialPlayMm)} mm` : "—"} />
          <InfoRow label="Transición a la pantalla (45°)" value={fit ? `${fmt(fit.thread.flareHeightMm)} mm de alto` : "—"} />
        </div>
        <Details title="Parámetros de la rosca y holguras">
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Ø rosca" value={def.thread.majorDiameterMm} onChange={(v) => setThread({ majorDiameterMm: v })} suffix="mm" error={err("thread.majorDiameterMm")} />
            <NumberField label="Paso" value={def.thread.pitchMm} onChange={(v) => setThread({ pitchMm: v })} suffix="mm" error={err("thread.pitchMm")} />
            <NumberField label="Entradas" value={def.thread.starts} onChange={(v) => setThread({ starts: Math.round(v) })} error={err("thread.starts")} />
            <NumberField label="Longitud roscada" value={def.thread.engagementMm} onChange={(v) => setThread({ engagementMm: v })} suffix="mm" error={err("thread.engagementMm")} />
            <NumberField label="Holgura radial" value={def.thread.clearanceMm} onChange={(v) => setThread({ clearanceMm: v })} suffix="mm" error={err("thread.clearanceMm")} />
            <NumberField label="Espesor del cuello" value={def.thread.coreWallMm} onChange={(v) => setThread({ coreWallMm: v })} suffix="mm" error={err("thread.coreWallMm")} />
          </div>
          <p className="text-xs text-gray-500">Más entradas = menos vueltas para cerrar. La holgura depende de tu impresora, material y perfil: ajustala con las piezas de prueba, no a ojo.</p>
        </Details>
        {issuesFor((i) => !!i.field?.startsWith("thread.") || i.code.startsWith("THREAD_") || i.code === "SHADE_NARROWER_THAN_THREAD" || i.code === "FLARE_TALL" || i.code === "COLLAR_UNVERIFIED").map((i, k) => (
          <p key={`${i.code}-${k}`} className={`text-xs ${errors.includes(i) ? "text-red-400" : "text-amber-300"}`}>{i.message}</p>
        ))}

        <span className="mt-1 text-xs font-semibold text-gray-500">Modo de impresión</span>
        <div className="flex flex-col gap-1.5 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
          <InfoRow label="Pantalla" value={metrics ? (def.thread.connection === "integrated" ? "Impresión convencional (rosca integrada)" : metrics.shade.vase.ready ? "Apta para modo vaso*" : `No apta para modo vaso (${fmt(metrics.shade.vase.maxOverhangDeg)}°)`) : "—"} strong={metrics?.shade.vase.ready && def.thread.connection === "collar"} />
          {def.thread.connection === "collar" && <InfoRow label="Collar roscado" value={metrics?.collar ? "Impresión convencional" : "—"} />}
          <InfoRow label="Cilindro" value={metrics?.insert ? (metrics.insert.vaseCapable ? "Modo vaso posible" : "Impresión convencional") : "—"} />
          <InfoRow label="Base" value={metrics ? "Impresión convencional" : "—"} />
        </div>
        <p className="text-xs text-gray-500">* Cumple los prerrequisitos geométricos del modo vaso (contorno continuo por capa, pendiente máxima y conexión por collar). Confirmalo en tu laminador: no es una garantía de laminado.</p>
      </section>

      {/* ------------------------------------------------------------------ INFORMACIÓN */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Información</SectionLabel>
        <InfoRow label="Altura total ensamblada" value={metrics ? `${fmt(metrics.totalHeightMm)} mm` : "—"} />
        <InfoRow label="Diámetro máximo" value={metrics ? `Ø ${fmt(metrics.maxDiameterMm)} mm` : "—"} />
        <InfoRow label="Triángulos (todas las piezas)" value={metrics ? String(metrics.totalTriangles) : "—"} />
        {fit && (
          <div className="mt-1 flex flex-col gap-1 rounded-xl border border-fg/10 bg-fg/[0.03] p-3" aria-label="Holguras del ensamblaje">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Holguras del ensamblaje (geométricas)</span>
            {fit.clearances.map((c) => (
              <div key={c.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-gray-500">{c.label}</span>
                <span className={c.status === "fail" ? "font-bold text-red-400" : c.status === "warn" ? "font-semibold text-amber-300" : "font-semibold text-gray-200"}>
                  {fmt(c.valueMm)} mm{c.minMm !== null ? ` (mín. ${fmt(c.minMm)})` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        <Details title="Código del diseño">
          <p className="text-xs text-gray-500">Guarda todo el diseño (incluida la semilla) en un texto. Pegalo acá para reconstruirlo exactamente.</p>
          <div className="flex items-start gap-2">
            <textarea readOnly value={code} rows={2} onFocus={(e) => e.currentTarget.select()} className="min-h-12 w-full resize-none rounded-lg border border-fg/10 bg-fg/[0.04] p-2 font-mono text-[11px] text-gray-300" aria-label="Código del diseño" />
            <button type="button" onClick={copyCode} aria-label="Copiar código" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-fg/10 text-gray-300 hover:text-fg">
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Pegá un código SL1:…" aria-label="Pegar un código de diseño" className="h-9 w-full rounded-lg border border-fg/10 bg-fg/[0.04] px-2 text-xs text-white placeholder:text-neutral-500" />
            <button type="button" onClick={loadCode} disabled={!pasted.trim()} className="h-9 shrink-0 rounded-lg border border-fg/10 px-3 text-xs font-semibold text-gray-200 hover:text-fg disabled:opacity-40">Cargar</button>
          </div>
        </Details>
      </section>

      {errors.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <span className="font-semibold">Diseño no listo para exportar</span>
          {errors.map((e, i) => (
            <span key={`${e.code}-${i}`}>{e.message}</span>
          ))}
        </div>
      )}
      {shownWarnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          {shownWarnings.map((w, i) => (
            <div key={`${w.code}-${i}`} className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3" aria-label="Seguridad y validación física">
        <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
          <ShieldAlert size={16} />
          Pendiente de validación física
        </div>
        <p className="text-xs text-amber-200/90">
          Estas piezas se usan cerca de una bombilla conectada a la red. Los controles de la herramienta son geométricos: no reemplazan probar el montaje, la temperatura y la estabilidad reales.
          {holderNotValidated && " La base es PRELIMINAR - NO VALIDADA hasta que cargues las medidas de tu portalámparas."}
        </p>
        <Details title="Seguridad">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-gray-300">{LAMP_SAFETY_NOTICES.map((t) => <li key={t}>{t}</li>)}</ul>
        </Details>
        <Details title="Medidas que tenés que verificar">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-gray-300">{LAMP_MEASUREMENTS_NEEDED.map((t) => <li key={t}>{t}</li>)}</ul>
        </Details>
        <Details title="Pruebas físicas antes de usarla">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-gray-300">{LAMP_PHYSICAL_TESTS.map((t) => <li key={t}>{t}</li>)}</ul>
        </Details>
      </section>

      <section className="flex flex-col gap-3 lg:hidden">
        <SectionLabel>Descargar</SectionLabel>
        {exportButtons}
      </section>
    </Card>
  );
}

/** Botones de descarga (pieza por pieza y ZIP): los comparten el panel móvil y la tarjeta flotante de escritorio. */
export function LampExportButtons({
  hasInsert,
  hasCollar,
  canDownload,
  canDownloadTests,
  busy,
  onDownloadPart,
  onDownloadZip,
  onDownloadTests,
  holderMeasured,
}: {
  hasInsert: boolean;
  hasCollar: boolean;
  canDownload: boolean;
  canDownloadTests: boolean;
  busy: string | null;
  onDownloadPart: (kind: "lampShade" | "lampInsert" | "lampCollar" | "body") => void;
  onDownloadZip: () => void;
  onDownloadTests: () => void;
  holderMeasured: boolean;
}) {
  const button = "inline-flex h-8 w-full items-center justify-start gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const icon = (id: string) => (busy === id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />);
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" disabled={!canDownload || busy !== null} onClick={() => onDownloadPart("lampShade")} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`}>
        {icon("lampShade")} Pantalla (STL)
      </button>
      {hasCollar && (
        <button type="button" disabled={!canDownload || busy !== null} onClick={() => onDownloadPart("lampCollar")} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`}>
          {icon("lampCollar")} Collar roscado (STL)
        </button>
      )}
      {hasInsert && (
        <button type="button" disabled={!canDownload || busy !== null} onClick={() => onDownloadPart("lampInsert")} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`}>
          {icon("lampInsert")} Cilindro (STL)
        </button>
      )}
      <button type="button" disabled={!canDownload || busy !== null} onClick={() => onDownloadPart("body")} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`}>
        {icon("body")} {holderMeasured ? "Base (STL)" : "Base preliminar (STL)"}
      </button>
      <button type="button" disabled={!canDownload || busy !== null} onClick={onDownloadZip} className={`${button} border-transparent bg-stampa-orange text-neutral-950 hover:bg-stampa-orange-hover`}>
        {icon("zip")} Todo en un ZIP
      </button>
      <button type="button" disabled={!canDownloadTests || busy !== null} onClick={onDownloadTests} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`} title="Rosca macho y hembra + disco de ajuste del portalámparas: para validar el encastre sin imprimir la lámpara entera">
        {icon("tests")} Piezas de prueba (ZIP)
      </button>
    </div>
  );
}
