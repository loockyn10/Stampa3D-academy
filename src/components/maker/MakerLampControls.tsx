"use client";

import React from "react";
import { AlertTriangle, Check, Copy, Dices, Download, Loader2, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { NumberField, SegmentedControl } from "@/components/maker/MakerTextControls";
import { applyInsertStyle, INSERT_STYLE_LABELS } from "@/lib/maker/lamps/defaults";
import { applyHolderMount } from "@/lib/maker/lamps/holder/applyMount";
import { MOUNT_LABELS } from "@/lib/maker/lamps/holder/mounts";
import { decodeLampDesign, encodeLampDesign } from "@/lib/maker/lamps/designCode";
import { insertSilhouette, referenceInsertSurface } from "@/lib/maker/lamps/insert/silhouette";
import { OPENWORK_PRESETS, applyOpenworkPreset, applyShadeType, applySilhouette, openworkPresetMatches, type OpenworkPreset } from "@/lib/maker/lamps/openwork/presets";
import { availableDoubleInnerShapes, availableDoubleOuterShapes, availableLampPresets, availableOpenworkPresets, silhouetteAvailability } from "@/lib/maker/lamps/availability";
import { nearestInRange, specFor, type ControlRange } from "@/lib/maker/lamps/constraints";
import { resolveLampDef } from "@/lib/maker/lamps/resolve";
import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";
import { setRingFreeDiameter, suggestThreadMajorForDiffuser } from "@/lib/maker/lamps/diffuserFit";
import { applyDoubleInnerShape, applyDoubleOuterShape, DOUBLE_INNER_LABELS, DOUBLE_OUTER_LABELS, type DoubleInnerKind, type DoubleOuterKind } from "@/lib/maker/lamps/doublewall/shapes";
import { SILHOUETTE_LABELS, type SilhouetteKind } from "@/lib/maker/lamps/openwork/silhouette";
import { renderOpenworkThumbnail } from "@/lib/maker/lamps/openwork/thumbnail";
import { type LampPreset } from "@/lib/maker/lamps/presets";
import { LAMP_MEASUREMENTS_NEEDED, LAMP_NOTICE_CODES, LAMP_PHYSICAL_TESTS, LAMP_SAFETY_NOTICES } from "@/lib/maker/lamps/safety";
import { lampSilhouette } from "@/lib/maker/lamps/silhouette";
import { LAMP_LIMITS, type LampDoubleWallDef, type LampAdhesionDef, type LampOpenworkDef, type LampShadeType, type LampBaseDef, type LampBulbDef, type LampCableDef, type LampDefinition, type LampFamily, type LampHolderDef, type LampHolderMount, type LampInsertDef, type LampInsertStyle, type LampIssue, type LampMetrics, type LampProfile, type LampShadeDef, type LampThreadDef } from "@/lib/maker/lamps/types";

/** Sistemas de fijación del portalámparas: las cotas de cada uno salen de su STL de referencia (references/lamp-e27), probado por el usuario con sus portalámparas. */
const MOUNT_CARDS: { value: LampHolderMount; badge: string; reference: string; text: string }[] = [
  { value: "rings", badge: "Con piso", reference: "bottom.stl", text: "Dos anillos de sujeción del portalámparas en un rebaje superior de la torre; el cuerpo pasa por un agujero central." },
  { value: "press", badge: "Solo bases con piso", reference: "BASE v2.stl", text: "El portalámparas entra a presión en un agujero liso Ø40,00 y apoya sobre el piso; el cable sale por el orificio de Ø7 y el canal inferior." },
  { value: "threadBase2", badge: "Con piso", reference: "BASE2.stl", text: "Rosca hembra Ø40,621 (cresta Ø39,118, paso 3,34 mm, 2 vueltas) en la torre: el portalámparas se enrosca desde arriba y apoya su brida en la cara de la torre." },
  { value: "threadV6", badge: "Sin piso · 3 patas", reference: "patas V6.stl", text: "Rosca hembra Ø40,5 (cresta Ø39,0, paso 3,0 mm, 2 vueltas) en un plato Ø78,8 sostenido por tres patas: no hay piso macizo, el cable sale por abajo." },
];

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
/** Dos decimales (medidas de montaje: 80, 81, 0,5). */
const fmt2 = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
/** Con los decimales que pide la grilla del control (0,05 → dos; 0,5 → uno). */
const fmtStep = (n: number, step: number) => String(step < 0.1 ? Math.round(n * 100) / 100 : step < 1 ? Math.round(n * 10) / 10 : Math.round(n)).replace(".", ",");

/** Rangos dinámicos de los controles (calculados por `constraints.ts` a partir de la validación real); sin contexto, cada control usa su envolvente fija. */
interface RangeContextValue {
  def: LampDefinition;
  ranges: Record<string, ControlRange>;
  /** Controles cuyo rango todavía corresponde a valores anteriores (se está recalculando). */
  stale: ReadonlySet<string>;
}
const RangeContext = React.createContext<RangeContextValue | null>(null);

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

/**
 * Slider cuyo rango es el VÁLIDO para el estado actual (restricciones dinámicas). Nunca modifica el valor por su cuenta: si el valor actual quedó fuera
 * del rango (p. ej. porque otro control cambió), se marca en rojo con la razón y se ofrece llevarlo al valor válido más cercano.
 */
function RangeSlider({ path, label, value, onChange, suffix = "", error, step, min, max }: { path: string; label: string; value: number; onChange: (v: number) => void; suffix?: string; error?: string; step?: number; min?: number; max?: number }) {
  const ctx = React.useContext(RangeContext);
  const spec = ctx ? specFor(ctx.def, path) : undefined;
  const range = ctx?.ranges[path];
  const stale = !!ctx?.stale.has(path);
  const st = step ?? spec?.step ?? 1;
  const lo = range && !range.conflict ? range.min : (spec?.min ?? min ?? 0);
  const hi = range && !range.conflict ? range.max : (spec?.max ?? max ?? 100);
  const outside = Number.isFinite(value) && (value < lo - 1e-9 || value > hi + 1e-9);
  const limited = !!range && !range.conflict && (range.limitedMin || range.limitedMax);
  return (
    <div className={stale ? "opacity-75" : undefined}>
      <label className="block">
        <span className="mb-1 flex justify-between text-xs font-semibold text-gray-500">
          <span>{label}</span>
          <span className={outside ? "font-bold text-red-400" : "text-gray-300"}>
            {fmtStep(value, st)}
            {suffix}
          </span>
        </span>
        <input type="range" min={lo} max={hi} step={st} value={Math.min(hi, Math.max(lo, value))} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-stampa-orange" />
      </label>
      {stale && !range && <span className="mt-0.5 block text-[11px] text-gray-500">Calculando el rango válido…</span>}
      {limited && range && (
        <span className="mt-0.5 block text-[11px] text-gray-500">
          Válido: {fmtStep(range.min, st)}–{fmtStep(range.max, st)}
          {suffix}
          {range.limitedMax && range.maxReason ? " · máx.: " + range.maxReason : ""}
          {range.limitedMin && range.minReason ? " · mín.: " + range.minReason : ""}
        </span>
      )}
      {outside && range && !range.conflict && (
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-red-400">
          Fuera del rango válido para el resto de los valores actuales.
          <button type="button" onClick={() => onChange(nearestInRange(range, value))} className="rounded-md border border-red-400/40 px-2 py-0.5 font-semibold hover:bg-red-400/10">
            Llevar a {fmtStep(nearestInRange(range, value), st)}
            {suffix}
          </button>
        </span>
      )}
      {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
    </div>
  );
}

function Details({ title, children, defaultOpen = false, onToggle }: { title: string; children: React.ReactNode; defaultOpen?: boolean; onToggle?: (open: boolean) => void }) {
  return (
    <details open={defaultOpen} onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined} className="group rounded-xl border border-fg/10 bg-fg/[0.03]">
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

const INSERT_STYLE_INFO: Record<LampInsertStyle, string> = {
  flat: "Cilindro cerrado con tapa plana a 90°. Se imprime invertido: la tapa sobre la cama y el extremo abierto hacia arriba.",
  drop: "Cilindro que se cierra de forma progresiva en una punta redondeada. Se imprime parado, con la abertura inferior sobre la cama.",
  wavy: "Cilindro con ondas en la superficie lateral (suaves o pronunciadas), abierto o con tapa. La zona de montaje inferior es la misma.",
};

/** Tarjeta de estilo: la miniatura sale de la MISMA superficie que se malla y se exporta (con los parámetros actuales si es el estilo elegido, o los iniciales si no). */
function InsertStyleCard({ style, def, active, onSelect }: { style: LampInsertStyle; def: LampDefinition; active: boolean; onSelect: (s: LampInsertStyle) => void }) {
  const i = def.insert;
  const sil = React.useMemo(
    () => insertSilhouette(referenceInsertSurface(style, i, active), 64),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [style, active, i.thicknessMm, i.capThicknessMm, i.dropClosureMm, i.dropCurvaturePct, i.dropTipRadiusMm, i.waves, i.amplitudeMm, i.twistDeg, i.verticalFrequency, i.wavyTop],
  );
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={INSERT_STYLE_INFO[style]}
      onClick={() => onSelect(style)}
      className={`flex flex-col items-center gap-1 rounded-xl border px-1.5 pb-1.5 pt-2 transition-colors ${active ? "border-stampa-orange/60 bg-stampa-orange/10" : "border-fg/10 bg-fg/[0.04] hover:border-stampa-orange/40"}`}
    >
      <svg viewBox={`0 0 ${sil.width} ${sil.height}`} height={64} className="max-w-full" aria-hidden>
        <path d={sil.outer} className="fill-stampa-accent/25 stroke-stampa-accent" strokeWidth={1.2} strokeLinejoin="round" />
        {style === "wavy" && <path d={sil.valley} className="fill-none stroke-stampa-accent/50" strokeWidth={0.8} strokeLinejoin="round" />}
        <path d={sil.cavity} className="fill-none stroke-stampa-accent/40" strokeWidth={0.7} strokeDasharray="2 2" strokeLinejoin="round" />
      </svg>
      <span className="text-center text-[11px] font-semibold leading-tight text-gray-300">{INSERT_STYLE_LABELS[style]}</span>
    </button>
  );
}

/** Miniatura calada: máscara leída del mismo campo de aberturas que la malla (ver `renderOpenworkThumbnail`), pintada con el color de acento. */
function OpenworkThumb({ preset, def, active, onApply }: { preset: OpenworkPreset; def: LampDefinition; active: boolean; onApply: (p: OpenworkPreset) => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const applied = React.useMemo(() => applyOpenworkPreset(def, preset), [def.shade.heightMm, def.shade.bottomDiameterMm, def.openwork, def.thread, preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const thumb = React.useMemo(() => {
    try {
      // con el difusor como dato, los extremos de la pantalla son los resueltos por el motor (la miniatura dibuja lo mismo que la malla)
      const resolved = resolveLampDef(applied);
      return renderOpenworkThumbnail(resolved.shade, resolved.openwork, 112);
    } catch {
      return null;
    }
  }, [applied]);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumb) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = thumb.width;
    canvas.height = thumb.height;
    ctx.putImageData(new ImageData(thumb.pixels as unknown as Uint8ClampedArray<ArrayBuffer>, thumb.width, thumb.height), 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = getComputedStyle(canvas).color;
    ctx.fillRect(0, 0, thumb.width, thumb.height);
  }, [thumb]);
  return (
    <button
      type="button"
      title={preset.description}
      aria-pressed={active}
      onClick={() => onApply(preset)}
      className={`flex flex-col items-center gap-1 rounded-xl border px-1.5 pb-1.5 pt-2 transition-colors ${active ? "border-stampa-orange/60 bg-stampa-orange/10" : "border-fg/10 bg-fg/[0.04] hover:border-stampa-orange/40"}`}
    >
      <canvas ref={canvasRef} aria-hidden className="h-14 max-w-full text-stampa-accent" />
      <span className="text-center text-[11px] font-semibold leading-tight text-gray-300">{preset.label}</span>
    </button>
  );
}

const SHADE_TYPE_OPTIONS: { value: LampShadeType; label: string }[] = [
  { value: "solid", label: "Sólida" },
  { value: "openwork", label: "Calada" },
  { value: "double", label: "Doble pared" },
];
const DOUBLE_OUTER_OPTIONS: { value: DoubleOuterKind; label: string }[] = (Object.keys(DOUBLE_OUTER_LABELS) as DoubleOuterKind[]).map((value) => ({ value, label: DOUBLE_OUTER_LABELS[value] }));
const DOUBLE_INNER_OPTIONS: { value: DoubleInnerKind; label: string }[] = (Object.keys(DOUBLE_INNER_LABELS) as DoubleInnerKind[]).map((value) => ({ value, label: DOUBLE_INNER_LABELS[value] }));
const CHAMBER_OPTIONS: { value: LampDoubleWallDef["chamber"]; label: string }[] = [
  { value: "closed", label: "Cerrada" },
  { value: "open", label: "Abierta arriba" },
];
const PATTERN_OPTIONS: { value: LampOpenworkDef["pattern"]; label: string }[] = [
  { value: "diamond", label: "Diamante" },
  { value: "spiral", label: "Espiral" },
];
const TOP_OPTIONS: { value: LampOpenworkDef["topFinish"]; label: string }[] = [
  { value: "ring", label: "Con anillo" },
  { value: "open", label: "Abierta" },
];
const SILHOUETTE_OPTIONS: { value: SilhouetteKind; label: string }[] = (Object.keys(SILHOUETTE_LABELS) as SilhouetteKind[]).map((value) => ({ value, label: SILHOUETTE_LABELS[value] }));

function isPresetActive(def: LampDefinition, preset: LampPreset): boolean {
  const { topRatio, ...r } = preset.recipe;
  return (Object.keys(r) as (keyof typeof r)[]).every((k) => def.shade[k] === r[k]) && def.shade.topDiameterMm === Math.round(def.shade.bottomDiameterMm * topRatio);
}

/** Nombre legible de qué limita al difusor. */
const LIMITED_BY_LABEL = { bottomRing: "el anillo inferior", topRing: "el anillo superior", opening: "la abertura central", base: "el orificio del cuello roscado", manual: "el valor manual", diameter: "el diámetro pedido" } as const;

/** Rango válido de un campo numérico escrito (NumberField): «Válido: a–b mm». Sale de las restricciones dinámicas, no de la envolvente fija. */
function RangeHint({ path }: { path: string }) {
  const ctx = React.useContext(RangeContext);
  const range = ctx?.ranges[path];
  if (!range) return null;
  const stale = ctx?.stale.has(path);
  return (
    <span className={`-mt-1 block text-[11px] text-gray-500 ${stale ? "opacity-60" : ""}`}>
      Válido: {fmtStep(range.min, range.step)}–{fmtStep(range.max, range.step)}
      {range.limitedMax && range.maxReason ? ` · máx.: ${range.maxReason}` : ""}
      {range.limitedMin && range.minReason ? ` · mín.: ${range.minReason}` : ""}
    </span>
  );
}

/**
 * Montaje del difusor + ayuda para subir la rosca. Compartido por «Calada» y «Doble pared». En la calada el difusor es el DATO (modo «Por su diámetro»):
 * la abertura libre de los anillos se deriva como Ø difusor + holgura diametral.
 */
function DiffuserPanel({ def, onChange, err, fit, errors, onError }: { def: LampDefinition; onChange: (next: LampDefinition) => void; err: (field: string) => string | undefined; fit: LampMetrics["fit"] | null; errors: LampIssue[]; onError: (message: string) => void }) {
  const double = def.shadeType === "double";
  const cfg = double ? def.doubleWall : def.openwork;
  const diameterMode = !double && def.openwork.diffuserFit === "diameter";
  const L = LAMP_LIMITS;
  const setCfg = (patch: Partial<LampOpenworkDef>) => onChange(double ? { ...def, doubleWall: { ...def.doubleWall, ...(patch as Partial<LampDoubleWallDef>) } } : { ...def, openwork: { ...def.openwork, ...patch } });
  const clearanceKey = double ? "doubleWall.diffuserClearanceMm" : "openwork.diffuserClearanceMm";
  const dif = fit?.diffuser ?? null;
  const exceedsBase = errors.some((e) => e.code === "DIFFUSER_EXCEEDS_BASE");
  const raiseThread = () => {
    const major = suggestThreadMajorForDiffuser(def);
    if (major === null) onError("No hay un diámetro de rosca de hasta Ø200 mm con el que la base aloje este difusor.");
    else onChange({ ...def, thread: { ...def.thread, majorDiameterMm: major } });
  };
  const fitOptions = double
    ? [{ value: "rings" as const, label: "Según la abertura" }, { value: "manual" as const, label: "Manual" }]
    : [{ value: "diameter" as const, label: "Por su diámetro" }, { value: "rings" as const, label: "Según los anillos" }, { value: "manual" as const, label: "Manual" }];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
      <span className="text-xs font-semibold text-gray-500">{double ? "Diámetro del difusor (doble pared)" : "Difusor de la pantalla calada"}</span>
      <SegmentedControl options={fitOptions} value={cfg.diffuserFit as "diameter" | "rings" | "manual"} onChange={(diffuserFit) => setCfg({ diffuserFit })} compact />
      {diameterMode ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Ø exterior del difusor" value={def.openwork.diffuserDiameterMm} onChange={(v) => setCfg({ diffuserDiameterMm: v })} suffix="mm" error={err("openwork.diffuserDiameterMm")} />
            <NumberField label="Holgura diametral" value={def.openwork.diffuserClearanceMm} onChange={(v) => setCfg({ diffuserClearanceMm: v })} suffix="mm" error={err(clearanceKey)} />
          </div>
          <RangeHint path="openwork.diffuserDiameterMm" />
          <RangeHint path="openwork.diffuserClearanceMm" />
          {def.insert.heightMm === null && (
            <RangeSlider path="openwork.diffuserTopGapMm" label="Holgura vertical bajo el borde de la pantalla (altura automática)" value={def.openwork.diffuserTopGapMm} onChange={(v) => setCfg({ diffuserTopGapMm: v })} suffix=" mm" error={err("openwork.diffuserTopGapMm")} />
          )}
          <InfoRow label="Abertura interior libre de los anillos" value={`Ø ${fmt2(def.openwork.diffuserDiameterMm + def.openwork.diffuserClearanceMm)} mm = ${fmt2(def.openwork.diffuserDiameterMm)} + ${fmt2(def.openwork.diffuserClearanceMm)}`} strong />
          {exceedsBase && (
            <button type="button" onClick={raiseThread} className="inline-flex h-9 items-center justify-center rounded-xl border border-stampa-orange/40 bg-stampa-orange/10 px-3 text-xs font-semibold text-stampa-accent transition-colors hover:bg-stampa-orange/20">
              Subir la rosca de montaje hasta que el difusor pase por el cuello
            </button>
          )}
        </>
      ) : cfg.diffuserFit === "rings" ? (
        <SliderField label="Holgura diametral" value={cfg.diffuserClearanceMm} min={L[clearanceKey].min} max={L[clearanceKey].max} step={0.1} suffix=" mm" onChange={(v) => setCfg({ diffuserClearanceMm: v })} error={err(clearanceKey)} />
      ) : (
        <NumberField label="Ø exterior del cuerpo" value={def.insert.diameterMm ?? fit?.insertOuterDiameterMm ?? 65.135} onChange={(v) => onChange({ ...def, insert: { ...def.insert, diameterMm: v } })} suffix="mm" error={err("insert.diameterMm")} />
      )}
      {fit?.insertFit && (
        <InfoRow label="Encastre inferior estándar (diffuser.stl)" value={`Ø ${fmt2(fit.insertFit.outerDiameterMm)} / Ø ${fmt2(fit.insertFit.innerDiameterMm)} × ${fmt(fit.insertFit.heightMm)} mm${fit.insertFit.flareHeightMm > 0 ? ` + transición de ${fmt(fit.insertFit.flareHeightMm)} mm` : ""}`} />
      )}
      {dif && (
        <div className="flex flex-col gap-1">
          {double ? (
            <InfoRow label="Ø libre de la abertura central (mín. / abajo / arriba)" value={`${fmt(dif.structureMinFreeDiameterMm)} / ${fmt(dif.ringBottomFreeDiameterMm)} / ${fmt(dif.ringTopFreeDiameterMm)} mm`} />
          ) : (
            <InfoRow label="Ø libre anillo inferior / superior" value={`${fmt2(dif.ringBottomFreeDiameterMm)} / ${fmt2(dif.ringTopFreeDiameterMm)} mm`} />
          )}
          <InfoRow label="Ø máximo que pasa por el cuello roscado" value={`${fmt(dif.baseLimitDiameterMm)} mm`} />
          <InfoRow label="Ø exterior del difusor" value={`${fmt2(dif.diffuserDiameterMm)} mm`} strong />
          <InfoRow label="Holgura radial inferior / superior" value={`${fmt2(dif.radialClearanceBottomMm)} / ${fmt2(dif.radialClearanceTopMm)} mm`} />
          {!double && <InfoRow label="Recorrido de inserción" value={dif.insertable ? `libre Ø ${fmt2(dif.pathMinFreeDiameterMm)} mm (holgura ${fmt2(dif.pathClearanceMm)} mm)` : `BLOQUEADO (libre Ø ${fmt2(dif.pathMinFreeDiameterMm)} mm)`} strong={!dif.insertable} />}
          {!double && <InfoRow label="Holgura vertical bajo el borde" value={`${fmt(dif.topGapMm)} mm`} />}
          <InfoRow label="Lo limita" value={LIMITED_BY_LABEL[dif.limitedBy]} />
        </div>
      )}
      {!diameterMode && dif?.limitedBy === "base" && cfg.diffuserFit === "rings" && (
        <button type="button" onClick={raiseThread} className="inline-flex h-9 items-center justify-center rounded-xl border border-stampa-orange/40 bg-stampa-orange/10 px-3 text-xs font-semibold text-stampa-accent transition-colors hover:bg-stampa-orange/20">
          Subir la rosca hasta que el difusor use {double ? "la abertura" : "los anillos"}
        </button>
      )}
      <p className="text-xs text-gray-500">
        {diameterMode
          ? "El difusor es un cilindro y es el dato: el interior libre de AMBOS anillos (los dos puntos de montaje) es su Ø exterior más la holgura diametral, y los diámetros de los extremos de la pantalla se calculan para cumplirlo. La silueta decorativa solo puede expandirse hacia afuera de ese volumen y no lo invade. La holgura es un valor inicial pendiente de validación física."
          : `El difusor es un cilindro: no sigue la silueta decorativa. Su diámetro sale del interior LIBRE de ${double ? "la abertura central (su punto más angosto)" : "los anillos (la cara interior, no la exterior)"} menos la holgura diametral, que es un valor inicial pendiente de validación física. Su zona inferior es SIEMPRE el encastre estándar de diffuser.stl (Ø65,135, que entra en la misma ranura de la torre) y se ensancha en una transición de 45° hasta ese diámetro: la base no cambia con el difusor. Cambiar solo la forma decorativa no lo modifica.`}{" "}
        Las lengüetas de extracción no se usan con este ajuste. Esto no es una validación térmica: el conjunto con tu LED E27 real sigue pendiente.
      </p>
    </div>
  );
}

/** Controles de la pantalla CALADA (sección Diseño / Calado). Edita `def.openwork`; las dimensiones compartidas viven en `def.shade`. */
function OpenworkSection({ def, onChange, err, issues, errors, metrics, onAdvancedToggle }: { def: LampDefinition; onChange: (next: LampDefinition) => void; err: (field: string) => string | undefined; issues: LampIssue[]; errors: LampIssue[]; metrics: LampMetrics | null; onAdvancedToggle?: (open: boolean) => void }) {
  const ow = def.openwork;
  const set = (patch: Partial<LampOpenworkDef>) => onChange({ ...def, openwork: { ...ow, ...patch } });
  const L = LAMP_LIMITS;
  const rep = metrics?.openwork ?? null;
  const fitInfo = metrics?.fit.diffuser ?? null;
  const diamond = ow.pattern === "diamond";
  const driven = ow.diffuserFit === "diameter";
  // Los diseños y siluetas que con las medidas actuales no dan una geometría válida no se ofrecen (se evalúan fuera del camino del slider).
  const deferred = React.useDeferredValue(def);
  const { available, hidden } = React.useMemo(() => availableOpenworkPresets(deferred, OPENWORK_PRESETS), [deferred]);
  const silhouettes = React.useMemo(() => {
    const base = new Set(validateLamp(deferred).errors.map((e) => e.code));
    return SILHOUETTE_OPTIONS.filter((o) => silhouetteAvailability(deferred, o.value, base).ok);
  }, [deferred]);
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {available.map((preset) => (
          <OpenworkThumb key={preset.id} preset={preset} def={def} active={openworkPresetMatches(def, preset)} onApply={(p) => onChange(applyOpenworkPreset(def, p))} />
        ))}
      </div>
      {hidden.length > 0 && (
        <p className="text-xs text-gray-500" title={hidden.map((h) => `${h.preset.label}: ${h.reason}`).join("\n")}>
          {hidden.length === 1 ? "1 diseño no se ofrece" : `${hidden.length} diseños no se ofrecen`} con estas medidas ({hidden.map((h) => `${h.preset.label}: ${h.reason}`).join("; ")}).
        </p>
      )}

      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Controles principales</span>
      <RangeSlider path="shade.heightMm" label="Altura de la pantalla" value={def.shade.heightMm} onChange={(v) => onChange({ ...def, shade: { ...def.shade, heightMm: v } })} suffix=" mm" error={err("shade.heightMm")} />
      <RangeSlider path="openwork.maxDiameterMm" label="Diámetro máximo decorativo" value={ow.maxDiameterMm} onChange={(v) => set({ maxDiameterMm: v })} suffix=" mm" error={err("openwork.maxDiameterMm")} />
      <span className="text-xs font-semibold text-gray-500">Forma</span>
      <SegmentedControl options={silhouettes} value={"" as SilhouetteKind} onChange={(kind) => onChange(applySilhouette(def, kind))} compact />
      {diamond ? (
        <RangeSlider path="openwork.divisions" label="Intensidad del patrón (densidad: rombos alrededor)" value={ow.divisions} onChange={(v) => set({ divisions: Math.round(v) })} error={err("openwork.divisions")} />
      ) : (
        <RangeSlider path="openwork.bands" label="Intensidad del patrón (cantidad de bandas)" value={ow.bands} onChange={(v) => set({ bands: Math.round(v) })} error={err("openwork.bands")} />
      )}
      {driven && fitInfo && (
        <p className="text-xs text-gray-500">
          Montaje: difusor <span className="font-semibold text-gray-300">Ø {fmt2(ow.diffuserDiameterMm)} mm</span> en una abertura libre de <span className="font-semibold text-gray-300">Ø {fmt2(ow.diffuserDiameterMm + ow.diffuserClearanceMm)} mm</span> (se configura en «2 · Inserto de color»). El Ø máximo decorativo no lo cambia.
        </p>
      )}

      <Details title="Personalización avanzada" onToggle={onAdvancedToggle}>
        <span className="text-xs font-semibold text-gray-500">Patrón</span>
        <SegmentedControl options={PATTERN_OPTIONS} value={ow.pattern} onChange={(pattern) => set({ pattern })} compact />
        {!driven && (
          <>
            <RangeSlider path="shade.bottomDiameterMm" label="Diámetro inferior (exterior del anillo)" value={def.shade.bottomDiameterMm} onChange={(v) => onChange({ ...def, shade: { ...def.shade, bottomDiameterMm: v } })} suffix=" mm" error={err("shade.bottomDiameterMm")} />
            <RangeSlider path="shade.topDiameterMm" label="Diámetro superior (exterior del anillo)" value={def.shade.topDiameterMm} onChange={(v) => onChange({ ...def, shade: { ...def.shade, topDiameterMm: v } })} suffix=" mm" error={err("shade.topDiameterMm")} />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Ø interior libre anillo inferior" value={rep && fitInfo ? fitInfo.ringBottomFreeDiameterMm : 0} onChange={(v) => onChange(setRingFreeDiameter(def, "bottom", v))} suffix="mm" error={err("shade.bottomDiameterMm")} />
              <NumberField label="Ø interior libre anillo superior" value={rep && fitInfo ? fitInfo.ringTopFreeDiameterMm : 0} onChange={(v) => onChange(setRingFreeDiameter(def, "top", v))} suffix="mm" error={err("shade.topDiameterMm")} />
            </div>
          </>
        )}
        {driven && fitInfo && (
          <div className="flex flex-col gap-1 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
            <InfoRow label="Extremos de la pantalla (exterior, derivado)" value={`Ø ${fmt2(fitInfo.ringBottomFreeDiameterMm + 2 * ow.depthMm)} mm aprox.`} />
            <InfoRow label="Ø interior libre de los anillos" value={`${fmt2(fitInfo.ringBottomFreeDiameterMm)} / ${fmt2(fitInfo.ringTopFreeDiameterMm)} mm`} />
          </div>
        )}
        <RangeSlider path="thread.majorDiameterMm" label="Diámetro de montaje (rosca)" value={def.thread.majorDiameterMm} onChange={(v) => onChange({ ...def, thread: { ...def.thread, majorDiameterMm: v } })} suffix=" mm" error={err("thread.majorDiameterMm")} />
        <RangeSlider path="openwork.waistPct" label="Intensidad de cintura" value={ow.waistPct} onChange={(v) => set({ waistPct: v })} suffix="%" error={err("openwork.waistPct")} />
        <RangeSlider path="openwork.twistDeg" label="Torsión" value={ow.twistDeg} onChange={(v) => set({ twistDeg: v })} suffix="°" error={err("openwork.twistDeg")} />
        {diamond ? (
          <RangeSlider path="openwork.inclinationDeg" label="Inclinación de las diagonales" value={ow.inclinationDeg} onChange={(v) => set({ inclinationDeg: v })} suffix="°" error={err("openwork.inclinationDeg")} />
        ) : (
          <RangeSlider path="openwork.turns" label="Vueltas" value={ow.turns} onChange={(v) => set({ turns: v })} error={err("openwork.turns")} />
        )}
        <RangeSlider path="openwork.stripWidthMm" label="Grosor (ancho de las tiras)" value={ow.stripWidthMm} onChange={(v) => set({ stripWidthMm: v })} suffix=" mm" error={err("openwork.stripWidthMm")} />
        <RangeSlider path="openwork.depthMm" label="Profundidad de las tiras" value={ow.depthMm} onChange={(v) => set({ depthMm: v })} suffix=" mm" error={err("openwork.depthMm")} />
        {!diamond && rep?.bandGapMm != null && <p className="text-xs text-gray-500">Separación libre entre bandas: <span className="font-semibold text-gray-300">{fmt(rep.bandGapMm)} mm</span> (sale de bandas, vueltas y grosor).</p>}
        <RangeSlider path="openwork.bulgePositionPct" label="Posición del ensanchamiento / cintura" value={ow.bulgePositionPct} onChange={(v) => set({ bulgePositionPct: v })} suffix="%" error={err("openwork.bulgePositionPct")} />
        <RangeSlider path="openwork.curvaturePct" label="Curvatura" value={ow.curvaturePct} onChange={(v) => set({ curvaturePct: v })} suffix="%" error={err("openwork.curvaturePct")} />
        <RangeSlider path="openwork.organicPct" label="Variación orgánica" value={ow.organicPct} onChange={(v) => set({ organicPct: v })} suffix="%" error={err("openwork.organicPct")} />
        {diamond && <SliderField label="Desplazamiento de fase" value={ow.phaseDeg} min={L["openwork.phaseDeg"].min} max={L["openwork.phaseDeg"].max} step={5} suffix="°" onChange={(v) => set({ phaseDeg: v })} error={err("openwork.phaseDeg")} />}
        <RangeSlider path="openwork.variationPct" label={diamond ? "Variación vertical de la inclinación" : "Variación de inclinación"} value={ow.variationPct} onChange={(v) => set({ variationPct: v })} suffix="%" error={err("openwork.variationPct")} />
        <RangeSlider path="openwork.variationCycles" label="Ciclos de la variación" value={ow.variationCycles} onChange={(v) => set({ variationCycles: v })} error={err("openwork.variationCycles")} />
        {!diamond && (
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Anillos de unión" value={ow.connectors} onChange={(v) => set({ connectors: Math.max(0, Math.round(v)) })} error={err("openwork.connectors")} />
            <NumberField label="Ancho de los anillos" value={ow.connectorWidthMm} onChange={(v) => set({ connectorWidthMm: v })} suffix="mm" error={err("openwork.connectorWidthMm")} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Anillo inferior" value={ow.bottomRingMm} onChange={(v) => set({ bottomRingMm: v })} suffix="mm" error={err("openwork.bottomRingMm")} />
          <NumberField label="Anillo superior" value={ow.topRingMm} onChange={(v) => set({ topRingMm: v })} suffix="mm" error={err("openwork.topRingMm")} />
        </div>
        <span className="text-xs font-semibold text-gray-500">Terminación superior</span>
        <SegmentedControl options={TOP_OPTIONS} value={ow.topFinish} onChange={(topFinish) => set({ topFinish })} compact />
        <NumberField label="Semilla (silueta orgánica)" value={ow.seed} onChange={(v) => set({ seed: Math.max(0, Math.round(v)) })} error={err("openwork.seed")} />
      </Details>

      {rep && (
        <div className="flex flex-col gap-1 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
          <InfoRow label="Aberturas" value={`${fmt(rep.aperturePct)} % de la zona calada`} />
          <InfoRow label="Abertura mínima" value={`${fmt(rep.minOpeningMm)} mm`} />
          <InfoRow label="Inclinación máx. de una tira" value={`${fmt(rep.maxStripLeanDeg)}° de la vertical`} />
          {rep.diamondsAround !== null && <InfoRow label="Rombos" value={`${rep.diamondsAround} alrededor · ${rep.diamondRows ?? 0} filas`} />}
          <InfoRow label="Pieza" value={rep.components === 1 ? "Una sola pieza conectada" : `${rep.components} piezas sueltas`} strong={rep.components !== 1} />
          <InfoRow label="Triángulos de la pantalla" value={metrics ? metrics.shade.triangleCount.toLocaleString("es-AR") : "—"} />
        </div>
      )}
      {issues.map((i, k) => (
        <p key={`${i.code}-${k}`} className={`text-xs ${errors.includes(i) ? "text-red-400" : "text-amber-300"}`}>{i.message}</p>
      ))}
    </>
  );
}

/** Controles de la pantalla de DOBLE PARED (sección Diseño). Edita `def.doubleWall`; altura y diámetros de la pared exterior viven en `def.shade`. */
function DoubleWallSection({ def, onChange, err, issues, errors, metrics, onAdvancedToggle }: { def: LampDefinition; onChange: (next: LampDefinition) => void; err: (field: string) => string | undefined; issues: LampIssue[]; errors: LampIssue[]; metrics: LampMetrics | null; onAdvancedToggle?: (open: boolean) => void }) {
  const d = def.doubleWall;
  const set = (patch: Partial<LampDoubleWallDef>) => onChange({ ...def, doubleWall: { ...d, ...patch } });
  const setShade = (patch: Partial<LampShadeDef>) => onChange({ ...def, shade: { ...def.shade, ...patch } });
  const rep = metrics?.doubleWall ?? null;
  // Las formas que con las medidas actuales rompen la separación entre paredes no se ofrecen (se evalúan fuera del camino del slider).
  const deferred = React.useDeferredValue(def);
  const shapes = React.useMemo(() => {
    const outer = availableDoubleOuterShapes(deferred, DOUBLE_OUTER_OPTIONS.map((o) => o.value));
    const inner = availableDoubleInnerShapes(deferred, DOUBLE_INNER_OPTIONS.map((o) => o.value));
    return {
      outer: DOUBLE_OUTER_OPTIONS.filter((o) => outer.available.includes(o.value)),
      inner: DOUBLE_INNER_OPTIONS.filter((o) => inner.available.includes(o.value)),
      hidden: [...outer.hidden.map((h) => "Pared exterior " + DOUBLE_OUTER_LABELS[h.kind].toLowerCase() + ": " + h.reason), ...inner.hidden.map((h) => "Pared interior " + DOUBLE_INNER_LABELS[h.kind].toLowerCase() + ": " + h.reason)],
    };
  }, [deferred]);
  return (
    <>
      <p className="text-xs text-gray-500">
        Dos paredes concéntricas con siluetas distintas y una cámara de aire entre ellas, unidas abajo por un piso macizo y arriba por un techo inclinado. La abertura central (bombilla, portalámparas y difusor) queda libre. Al elegir este tipo, los diámetros de los extremos de la pared exterior se llevan al mínimo que respeta la separación pedida.
      </p>
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Controles principales</span>
      <RangeSlider path="shade.heightMm" label="Altura" value={def.shade.heightMm} onChange={(v) => setShade({ heightMm: v })} suffix=" mm" error={err("shade.heightMm")} />
      <RangeSlider path="doubleWall.maxDiameterMm" label="Diámetro máximo (abombado)" value={d.maxDiameterMm} onChange={(v) => set({ maxDiameterMm: v })} suffix=" mm" error={err("doubleWall.maxDiameterMm")} />
      <span className="text-xs font-semibold text-gray-500">Forma de la pared exterior</span>
      <SegmentedControl options={shapes.outer} value={"" as DoubleOuterKind} onChange={(kind) => onChange(applyDoubleOuterShape(def, kind))} compact />
      {shapes.hidden.length > 0 && <p className="text-xs text-gray-500" title={shapes.hidden.join(String.fromCharCode(10))}>{shapes.hidden.length === 1 ? "1 forma no se ofrece" : shapes.hidden.length + " formas no se ofrecen"} con estas medidas ({shapes.hidden.join("; ")}).</p>}
      <RangeSlider path="doubleWall.fluteAmplitudeMm" label="Intensidad del patrón (profundidad de las estrías)" value={d.fluteAmplitudeMm} onChange={(v) => set({ fluteAmplitudeMm: v })} suffix=" mm" error={err("doubleWall.fluteAmplitudeMm")} />

      <Details title="Personalización avanzada" onToggle={onAdvancedToggle}>
        <span className="text-xs font-semibold text-gray-500">Fabricación</span>
        <SegmentedControl options={[{ value: "conventional" as const, label: "Convencional" }]} value={d.fabrication} onChange={() => set({ fabrication: "conventional" })} compact />
        <p className="text-xs text-gray-500">Modo jarrón: experimental y todavía no disponible (no se verificó con un laminador que una trayectoria espiral recorra ambas paredes; ver docs/STAMPA_MAKER_DOUBLE_WALL.md).</p>
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pared exterior</span>
        <RangeSlider path="shade.bottomDiameterMm" label="Diámetro inferior (pared exterior)" value={def.shade.bottomDiameterMm} onChange={(v) => setShade({ bottomDiameterMm: v })} suffix=" mm" error={err("shade.bottomDiameterMm")} />
        <RangeSlider path="shade.topDiameterMm" label="Diámetro superior (pared exterior)" value={def.shade.topDiameterMm} onChange={(v) => setShade({ topDiameterMm: v })} suffix=" mm" error={err("shade.topDiameterMm")} />
        <RangeSlider path="doubleWall.flutes" label="Estrías / ondulaciones (cantidad)" value={d.flutes} onChange={(v) => set({ flutes: Math.round(v) })} error={err("doubleWall.flutes")} />
        <RangeSlider path="doubleWall.twistDeg" label="Torsión" value={d.twistDeg} onChange={(v) => set({ twistDeg: v })} suffix="°" error={err("doubleWall.twistDeg")} />
        <RangeSlider path="doubleWall.bulgePositionPct" label="Posición del ensanchamiento" value={d.bulgePositionPct} onChange={(v) => set({ bulgePositionPct: v })} suffix="%" error={err("doubleWall.bulgePositionPct")} />
        <RangeSlider path="doubleWall.curvaturePct" label="Curvatura de la pared exterior" value={d.curvaturePct} onChange={(v) => set({ curvaturePct: v })} suffix="%" error={err("doubleWall.curvaturePct")} />

        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pared interior</span>
        <SegmentedControl options={shapes.inner} value={"" as DoubleInnerKind} onChange={(kind) => onChange(applyDoubleInnerShape(def, kind))} compact />
        <RangeSlider path="doubleWall.innerBottomDiameterMm" label="Diámetro inferior (pared interior)" value={d.innerBottomDiameterMm} onChange={(v) => set({ innerBottomDiameterMm: v })} suffix=" mm" error={err("doubleWall.innerBottomDiameterMm")} />
        <RangeSlider path="doubleWall.innerTopDiameterMm" label="Diámetro superior (pared interior)" value={d.innerTopDiameterMm} onChange={(v) => set({ innerTopDiameterMm: v })} suffix=" mm" error={err("doubleWall.innerTopDiameterMm")} />
        <RangeSlider path="doubleWall.innerWaistPct" label="Intensidad de cintura" value={d.innerWaistPct} onChange={(v) => set({ innerWaistPct: v })} suffix="%" error={err("doubleWall.innerWaistPct")} />
        <RangeSlider path="doubleWall.minGapMm" label="Separación mínima entre paredes" value={d.minGapMm} onChange={(v) => set({ minGapMm: v })} suffix=" mm" error={err("doubleWall.minGapMm")} />
        {rep && (
          <p className="text-xs text-gray-500">
            Separación medida sobre las superficies reales (estrías incluidas): <span className="font-semibold text-gray-300">{fmt(rep.minGapMm)} mm</span> a {fmt(rep.minGapAtZ)} mm de altura (exigida {fmt(rep.requiredGapMm)} mm).
          </p>
        )}
        <RangeSlider path="doubleWall.innerWaistPositionPct" label="Posición de la cintura interior" value={d.innerWaistPositionPct} onChange={(v) => set({ innerWaistPositionPct: v })} suffix="%" error={err("doubleWall.innerWaistPositionPct")} />
        <RangeSlider path="doubleWall.innerCurvaturePct" label="Curvatura de la pared interior" value={d.innerCurvaturePct} onChange={(v) => set({ innerCurvaturePct: v })} suffix="%" error={err("doubleWall.innerCurvaturePct")} />
        <RangeSlider path="doubleWall.innerOrganicPct" label="Variación orgánica interior" value={d.innerOrganicPct} onChange={(v) => set({ innerOrganicPct: v })} suffix="%" error={err("doubleWall.innerOrganicPct")} />
        <span className="text-xs font-semibold text-gray-500">Cámara entre las paredes</span>
        <SegmentedControl options={CHAMBER_OPTIONS} value={d.chamber} onChange={(chamber) => set({ chamber })} compact />
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Espesor de las paredes" value={d.wallMm} onChange={(v) => set({ wallMm: v })} suffix="mm" error={err("doubleWall.wallMm")} />
          <NumberField label="Piso (unión inferior)" value={d.floorMm} onChange={(v) => set({ floorMm: v })} suffix="mm" error={err("doubleWall.floorMm")} />
          <NumberField label="Altura del techo inclinado" value={d.roofHeightMm} onChange={(v) => set({ roofHeightMm: v })} suffix="mm" error={err("doubleWall.roofHeightMm")} />
          <NumberField label="Rim superior" value={d.roofCapMm} onChange={(v) => set({ roofCapMm: v })} suffix="mm" error={err("doubleWall.roofCapMm")} />
          <NumberField label="Ancho final de la cámara" value={d.topGapMm} onChange={(v) => set({ topGapMm: v })} suffix="mm" error={err("doubleWall.topGapMm")} />
        </div>
      </Details>

      {rep && (
        <div className="flex flex-col gap-1 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
          <InfoRow label="Abertura central (mín. / abajo / arriba)" value={`${fmt(rep.openingMinDiameterMm)} / ${fmt(rep.openingBottomDiameterMm)} / ${fmt(rep.openingTopDiameterMm)} mm`} />
          <InfoRow label="Unión inferior (piso)" value={`${fmt(rep.floorTopMm)} mm macizos`} />
          <InfoRow label="Unión superior" value={rep.chamberClosed ? `techo inclinado + cielorraso (${fmt(d.roofCapMm)} mm)` : "techo inclinado, ranura abierta"} />
          <InfoRow label="Inclinación máx. de una cara" value={`${fmt(rep.maxLeanDeg)}° de la vertical`} />
          <InfoRow label="Cuerpos / cavidades cerradas" value={`${rep.solidBodies} / ${rep.cavities}`} strong={rep.solidBodies !== 1} />
          <InfoRow label="Triángulos de la pantalla" value={metrics ? metrics.shade.triangleCount.toLocaleString("es-AR") : "—"} />
        </div>
      )}
      {issues.map((i, k) => (
        <p key={`${i.code}-${k}`} className={`text-xs ${errors.includes(i) ? "text-red-400" : "text-amber-300"}`}>{i.message}</p>
      ))}
    </>
  );
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
  /** Rangos válidos de cada control para el estado actual (restricciones dinámicas) y cuáles todavía se están recalculando. */
  ranges?: Record<string, ControlRange>;
  stale?: ReadonlySet<string>;
  /** true = los valores actuales no se pueden aplicar y el visor muestra la última lámpara válida: el panel lo avisa. */
  outdated?: boolean;
  /** «Personalización avanzada» abierta/cerrada (los rangos de los controles avanzados se calculan cuando se abre). */
  onAdvancedToggle?: (open: boolean) => void;
}

/** Panel izquierdo de /stampa-maker/lamparas. Solo presentación: edita la LampDefinition y muestra métricas/avisos. */
const NO_RANGES: Record<string, ControlRange> = {};
const NO_STALE: ReadonlySet<string> = new Set();

export function MakerLampControls({ def, onChange, onApplyPreset, onGenerateVariation, onLoadDesign, onError, errors, warnings, metrics, exportButtons, ranges = NO_RANGES, stale = NO_STALE, outdated = false, onAdvancedToggle }: MakerLampControlsProps) {
  const rangeCtx = React.useMemo(() => ({ def, ranges, stale }), [def, ranges, stale]);
  const err = (field: string) => errors.find((e) => e.field === field)?.message;
  const setShade = (patch: Partial<LampShadeDef>) => onChange({ ...def, shade: { ...def.shade, ...patch } });
  const setInsert = (patch: Partial<LampInsertDef>) => onChange({ ...def, insert: { ...def.insert, ...patch } });
  const setAdhesion = (patch: Partial<LampAdhesionDef>) => onChange({ ...def, adhesion: { ...def.adhesion, ...patch } });
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
  const [mountNotice, setMountNotice] = React.useState<string | null>(null);
  const chooseMount = (mount: LampHolderMount) => {
    const applied = applyHolderMount(def, mount);
    setMountNotice(applied.notice);
    onChange(applied.def);
  };
  const code = React.useMemo(() => encodeLampDesign(def), [def]);
  const deferredDef = React.useDeferredValue(def);
  const solidPresets = React.useMemo(() => (deferredDef.shadeType === "solid" ? availableLampPresets(deferredDef) : { available: [] as LampPreset[], hidden: [] as { preset: LampPreset; reason: string }[] }), [deferredDef]);
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
    <RangeContext.Provider value={rangeCtx}>
    <Card className="flex flex-col gap-5 p-5">
      {outdated && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
          <span className="font-semibold">Los valores actuales no se pueden aplicar.</span> El visor muestra la última lámpara válida, que NO corresponde a lo que ves en estos controles, y no se puede descargar nada hasta resolver los errores. Los datos de las tarjetas de información son de esa última lámpara válida.
        </div>
      )}
      {/* ------------------------------------------------------------------ DISEÑO */}
      <section className="flex flex-col gap-3">
        <SectionLabel>1 · Pantalla exterior</SectionLabel>
        <span className="text-xs font-semibold text-gray-500">Tipo de pantalla</span>
        <SegmentedControl options={SHADE_TYPE_OPTIONS} value={def.shadeType} onChange={(type) => onChange(applyShadeType(def, type))} compact />
        {def.shadeType === "double" ? (
          <DoubleWallSection def={def} onChange={onChange} err={err} issues={issuesFor((i) => !!i.field?.startsWith("doubleWall.") || i.code.startsWith("DW_") || i.code.startsWith("DOUBLE_WALL_"))} errors={errors} metrics={metrics} onAdvancedToggle={onAdvancedToggle} />
        ) : def.shadeType === "openwork" ? (
          <OpenworkSection def={def} onChange={onChange} err={err} issues={issuesFor((i) => !!i.field?.startsWith("openwork.") || i.code.startsWith("OPENWORK_") || i.code === "FLARE_INWARD")} errors={errors} metrics={metrics} onAdvancedToggle={onAdvancedToggle} />
        ) : (
        <>
        <div className="grid grid-cols-3 gap-2">
          {solidPresets.available.map((preset) => (
            <PresetThumb key={preset.id} preset={preset} def={def} active={isPresetActive(def, preset)} onApply={onApplyPreset} />
          ))}
        </div>
        {solidPresets.hidden.length > 0 && (
          <p className="text-xs text-gray-500" title={solidPresets.hidden.map((h) => h.preset.label + ": " + h.reason).join("\n")}>
            {solidPresets.hidden.length === 1 ? "1 diseño no se ofrece" : solidPresets.hidden.length + " diseños no se ofrecen"} con estas medidas ({solidPresets.hidden.map((h) => h.preset.label + ": " + h.reason).join("; ")}).
          </p>
        )}
        <button
          type="button"
          onClick={onGenerateVariation}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-stampa-orange/40 bg-stampa-orange/10 px-3 text-sm font-semibold text-stampa-accent transition-colors hover:bg-stampa-orange/20"
        >
          <Dices size={16} />
          Generar variación
        </button>
        <p className="text-xs text-gray-500">
          Semilla <span className="font-semibold text-gray-300">{def.shade.seed}</span>: la misma semilla y los mismos datos vuelven a dar exactamente este diseño. El diseño solo controla la apariencia de la pantalla: no cambia la rosca, la base ni el inserto.
        </p>
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Controles principales</span>
        <RangeSlider path="shade.heightMm" label="Altura de la pantalla (parte decorativa)" value={def.shade.heightMm} onChange={(v) => setShade({ heightMm: v })} suffix=" mm" error={err("shade.heightMm")} />
        <RangeSlider path="shade.bottomDiameterMm" label="Diámetro (inferior)" value={def.shade.bottomDiameterMm} onChange={(v) => setShade({ bottomDiameterMm: v })} suffix=" mm" error={err("shade.bottomDiameterMm")} />
        <span className="text-xs font-semibold text-gray-500">Forma (perfil)</span>
        <SegmentedControl options={PROFILE_OPTIONS} value={def.shade.profile} onChange={(profile) => setShade({ profile })} compact />
        <RangeSlider path="shade.amplitudeMm" label="Intensidad del patrón (amplitud de las ondas)" value={def.shade.amplitudeMm} onChange={(v) => setShade({ amplitudeMm: v })} suffix=" mm" error={err("shade.amplitudeMm")} />
        <Details title="Personalización avanzada" onToggle={onAdvancedToggle}>
          <span className="text-xs font-semibold text-gray-500">Familia de patrón</span>
          <SegmentedControl options={FAMILY_OPTIONS} value={def.shade.family} onChange={(family) => setShade({ family })} compact />
          <RangeSlider path="shade.topDiameterMm" label="Diámetro superior" value={def.shade.topDiameterMm} onChange={(v) => setShade({ topDiameterMm: v })} suffix=" mm" error={err("shade.topDiameterMm")} />
          <RangeSlider path="shade.waves" label="Cantidad de ondas" value={def.shade.waves} onChange={(v) => setShade({ waves: Math.round(v) })} error={err("shade.waves")} />
          <RangeSlider path="shade.twistDeg" label="Torsión" value={def.shade.twistDeg} onChange={(v) => setShade({ twistDeg: v })} suffix="°" error={err("shade.twistDeg")} />
          <RangeSlider path="shade.verticalFrequency" label="Variación vertical (ciclos)" value={def.shade.verticalFrequency} onChange={(v) => setShade({ verticalFrequency: v })} error={err("shade.verticalFrequency")} />
          <RangeSlider path="shade.patternIntensityPct" label="Intensidad de la variación vertical" value={def.shade.patternIntensityPct} onChange={(v) => setShade({ patternIntensityPct: v })} suffix="%" error={err("shade.patternIntensityPct")} />
          {def.shade.family === "organic" && <RangeSlider path="shade.organicPct" label="Variación orgánica" value={def.shade.organicPct} onChange={(v) => setShade({ organicPct: v })} suffix="%" error={err("shade.organicPct")} />}
          {def.shade.profile !== "straight" && <RangeSlider path="shade.profileAmountPct" label="Intensidad del perfil" value={def.shade.profileAmountPct} onChange={(v) => setShade({ profileAmountPct: v })} suffix="%" error={err("shade.profileAmountPct")} />}
          <RangeSlider path="thread.majorDiameterMm" label="Diámetro de montaje (rosca)" value={def.thread.majorDiameterMm} onChange={(v) => setThread({ majorDiameterMm: v })} suffix=" mm" error={err("thread.majorDiameterMm")} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Espesor de pared" value={def.shade.wallMm} onChange={(v) => setShade({ wallMm: v })} suffix="mm" error={err("shade.wallMm")} />
            <NumberField label="Tramo recto inferior" value={def.shade.collarHeightMm} onChange={(v) => setShade({ collarHeightMm: v })} suffix="mm" error={err("shade.collarHeightMm")} />
          </div>
          <NumberField label="Semilla" value={def.shade.seed} onChange={(v) => setShade({ seed: Math.max(0, Math.round(v)) })} error={err("shade.seed")} />
        </Details>
        {issuesFor((i) => !!i.field?.startsWith("shade.") || i.code.startsWith("SHADE_")).map((i, k) => (
          <p key={`${i.code}-${k}`} className={`text-xs ${errors.includes(i) ? "text-red-400" : "text-amber-300"}`}>{i.message}</p>
        ))}
        </>
        )}
        {def.shadeType !== "solid" && issuesFor((i) => i.code.startsWith("SHADE_")).map((i, k) => (
          <p key={`${i.code}-${k}`} className={`text-xs ${errors.includes(i) ? "text-red-400" : "text-amber-300"}`}>{i.message}</p>
        ))}
      </section>

      {/* ------------------------------------------------------------------ ILUMINACIÓN */}
      <section className="flex flex-col gap-3">
        <SectionLabel>2 · Inserto de color</SectionLabel>
        <Toggle label="Usar inserto de color" checked={def.insert.enabled} onChange={(enabled) => setInsert({ enabled })} />
        <p className="text-xs text-gray-500">Una pieza independiente de filamento translúcido que rodea la bombilla LED blanca y apoya en una ranura de la base. Imprimí varios y cambiá el color sin desmontar el portalámparas. Cambiar el inserto no modifica la pantalla exterior.</p>
        {def.insert.enabled && (
          <>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Estilo del inserto</span>
            <div role="radiogroup" aria-label="Estilo del inserto" className="grid grid-cols-3 gap-2">
              {(["flat", "drop", "wavy"] as const).map((style) => (
                <InsertStyleCard key={style} style={style} def={def} active={def.insert.style === style} onSelect={(next) => def.insert.style !== next && onChange(applyInsertStyle(def, next))} />
              ))}
            </div>
            <p className="text-xs text-gray-500">{INSERT_STYLE_INFO[def.insert.style]} Al elegir un estilo se cargan sus parámetros iniciales; el color, el diámetro, el espesor y la altura se conservan.</p>
            <div role="radiogroup" aria-label="Color del inserto" className="flex flex-wrap gap-2">
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
            <p className="text-xs text-gray-500">El color del visor es una aproximación visual, no una simulación fotométrica ni de la distribución de la luz. La luz real depende del filamento, su espesor y la bombilla.</p>
            {def.shadeType !== "solid" && <DiffuserPanel def={def} onChange={onChange} err={err} fit={fit} errors={errors} onError={onError} />}
            <div className="grid grid-cols-2 gap-3">
              {def.shadeType === "solid" && (
                <NumberField label="Ø exterior del cuerpo" value={def.insert.diameterMm ?? fit?.insertOuterDiameterMm ?? 65.135} onChange={(v) => setInsert({ diameterMm: v })} suffix="mm" error={err("insert.diameterMm")} />
              )}
              <NumberField label="Espesor de pared" value={def.insert.thicknessMm} onChange={(v) => setInsert({ thicknessMm: v })} suffix="mm" error={err("insert.thicknessMm")} />
            </div>
            <Toggle label="Altura automática" checked={def.insert.heightMm === null} onChange={(auto) => setInsert({ heightMm: auto ? null : (fit?.insertHeightMm ?? 180) })} />
            {def.insert.heightMm === null ? (
              <p className="text-xs text-gray-500">
                {def.shadeType === "openwork" && def.openwork.diffuserFit === "diameter" && def.insert.style !== "drop"
                  ? "Automática: acompaña la altura útil de la pantalla calada y deja solo la holgura vertical de ensamblaje bajo su borde superior (si cambia la altura de la pantalla, el difusor la sigue)."
                  : def.insert.style === "drop"
                  ? "Automática: la mínima que deja el arranque del cierre por encima de la bombilla más la separación de diseño."
                  : def.insert.style === "flat"
                    ? "Automática: el porcentaje de lo disponible, y nunca menos de lo necesario para que la tapa quede sobre la bombilla."
                    : "Automática: el porcentaje de lo disponible bajo el borde de la pantalla."}
              </p>
            ) : (
              <>
                <NumberField label="Altura total del inserto" value={def.insert.heightMm} onChange={(v) => setInsert({ heightMm: v })} suffix="mm" error={err("insert.heightMm")} />
                <RangeHint path="insert.heightMm" />
              </>
            )}
            {def.insert.style === "flat" && <NumberField label="Espesor de la tapa" value={def.insert.capThicknessMm} onChange={(v) => setInsert({ capThicknessMm: v })} suffix="mm" error={err("insert.capThicknessMm")} />}
            {def.insert.style === "drop" && (
              <>
                <SliderField label="Altura del cierre" value={def.insert.dropClosureMm} min={L["insert.dropClosureMm"].min} max={120} step={1} suffix=" mm" onChange={(v) => setInsert({ dropClosureMm: v })} error={err("insert.dropClosureMm")} />
                <SliderField label="Curvatura (0 = cono recto, 100 = ojiva)" value={def.insert.dropCurvaturePct} min={0} max={100} step={1} suffix="%" onChange={(v) => setInsert({ dropCurvaturePct: v })} error={err("insert.dropCurvaturePct")} />
                <SliderField label="Redondeo de la punta (radio)" value={def.insert.dropTipRadiusMm} min={L["insert.dropTipRadiusMm"].min} max={L["insert.dropTipRadiusMm"].max} step={0.5} suffix=" mm" onChange={(v) => setInsert({ dropTipRadiusMm: v })} error={err("insert.dropTipRadiusMm")} />
                <p className="text-xs text-gray-500">Altura de la sección cilíndrica: {fit?.insertHeightMm != null ? `${fmt(fit.insertHeightMm - def.insert.dropClosureMm)} mm` : "—"} (altura total − cierre).</p>
              </>
            )}
            {def.insert.style === "wavy" && (
              <>
                <SliderField label="Número de ondas" value={def.insert.waves} min={L["insert.waves"].min} max={L["insert.waves"].max} step={1} onChange={(v) => setInsert({ waves: Math.round(v) })} error={err("insert.waves")} />
                <SliderField label="Amplitud (suma hacia afuera)" value={def.insert.amplitudeMm} min={0} max={L["insert.amplitudeMm"].max} step={0.5} suffix=" mm" onChange={(v) => setInsert({ amplitudeMm: v })} error={err("insert.amplitudeMm")} />
                <SliderField label="Torsión" value={def.insert.twistDeg} min={L["insert.twistDeg"].min} max={L["insert.twistDeg"].max} step={5} suffix="°" onChange={(v) => setInsert({ twistDeg: v })} error={err("insert.twistDeg")} />
                <SliderField label="Frecuencia vertical (ciclos)" value={def.insert.verticalFrequency} min={0} max={L["insert.verticalFrequency"].max} step={0.5} onChange={(v) => setInsert({ verticalFrequency: v })} error={err("insert.verticalFrequency")} />
                <span className="text-xs font-semibold text-gray-500">Terminación superior</span>
                <SegmentedControl options={[{ value: "open" as const, label: "Abierta" }, { value: "flat" as const, label: "Tapa plana" }]} value={def.insert.wavyTop} onChange={(wavyTop) => setInsert({ wavyTop, tabs: wavyTop === "open" ? def.insert.tabs : false })} compact />
                {def.insert.wavyTop === "flat" && <NumberField label="Espesor de la tapa" value={def.insert.capThicknessMm} onChange={(v) => setInsert({ capThicknessMm: v })} suffix="mm" error={err("insert.capThicknessMm")} />}
                {def.insert.wavyTop === "open" && <Toggle label="Lengüetas para extraerlo (impresión convencional)" checked={def.insert.tabs} onChange={(tabs) => setInsert({ tabs })} />}
              </>
            )}
            <div className="flex flex-col gap-1.5 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
              <InfoRow label={fit?.insertAuto ? "Ø exterior del cuerpo (el más angosto)" : "Ø exterior del cuerpo"} value={fit?.insertOuterDiameterMm != null ? `Ø ${fmt2(fit.insertOuterDiameterMm)} mm` : "—"} strong />
              <InfoRow label="Encastre inferior estándar (diffuser.stl)" value={fit?.insertFit ? `Ø ${fmt2(fit.insertFit.outerDiameterMm)} exterior / Ø ${fmt2(fit.insertFit.innerDiameterMm)} interior × ${fmt(fit.insertFit.heightMm)} mm` : "—"} />
              {fit?.insertFit && fit.insertFit.flareHeightMm > 0 && <InfoRow label="Transición a 45° hasta el cuerpo" value={`${fmt(fit.insertFit.flareHeightMm)} mm`} />}
              {def.insert.style === "wavy" && <InfoRow label="Ø máximo con ondas (sin lengüetas)" value={fit?.insertMaxDiameterMm != null ? `Ø ${fmt(fit.insertMaxDiameterMm)} mm` : "—"} />}
              <InfoRow label="Altura total" value={fit?.insertHeightMm != null ? `${fmt(fit.insertHeightMm)} mm` : "—"} />
              <InfoRow label="Extremo superior" value={fit ? (fit.insertClosed ? "Cerrado (pendiente de validación térmica)" : "Abierto") : "—"} />
              <InfoRow label="Separación mínima a la bombilla (geométrica)" value={fit?.insertEnvelopeGapMm != null ? `${fmt(fit.insertEnvelopeGapMm)} mm` : "—"} />
              <InfoRow label="Separación radial a los anillos" value={fit?.tower.ringsToInsertGapMm != null ? `${fmt(fit.tower.ringsToInsertGapMm)} mm` : "—"} />
              <InfoRow label="Se saca por arriba" value={fit?.insertRemovableFromTop == null ? "—" : fit.insertRemovableFromTop ? "Sí, sin desmontar nada" : "No: hay que desenroscar la pantalla"} />
              <InfoRow label="Orientación de impresión" value={def.insert.style === "drop" ? "Parado, abertura sobre la cama" : "Invertido (extremo superior sobre la cama)"} />
            </div>
            <Details title="Montaje y separaciones">
              <SliderField label="Holgura en la ranura (por lado)" value={def.insert.clearanceMm} min={L["insert.clearanceMm"].min} max={L["insert.clearanceMm"].max} step={0.05} suffix=" mm" onChange={(v) => setInsert({ clearanceMm: v })} error={err("insert.clearanceMm")} />
              {!(def.shadeType === "openwork" && def.openwork.diffuserFit === "diameter") && (
                <SliderField label="Altura automática (% de lo disponible)" value={def.insert.heightPct} min={L["insert.heightPct"].min} max={L["insert.heightPct"].max} step={1} suffix="%" onChange={(v) => setInsert({ heightPct: v })} error={err("insert.heightPct")} />
              )}
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Profundidad de la ranura" value={def.insert.seatDepthMm} onChange={(v) => setInsert({ seatDepthMm: v })} suffix="mm" error={err("insert.seatDepthMm")} />
                <NumberField label="Separación mínima a la bombilla" value={def.insert.minBulbGapMm} onChange={(v) => setInsert({ minBulbGapMm: v })} suffix="mm" error={err("insert.minBulbGapMm")} />
              </div>
              <Toggle label="Diámetro automático (el más angosto posible)" checked={def.insert.diameterMm === null} onChange={(auto) => setInsert({ diameterMm: auto ? null : (fit?.insertOuterDiameterMm ?? 65.135) })} />
              <p className="text-xs text-gray-500">La separación mínima solo evita el contacto previsto con las medidas cargadas (la bombilla se modela como un cilindro): no es una distancia térmica segura. La zona de montaje inferior es idéntica en los tres estilos y es el encastre estándar de diffuser.stl (Ø65,135 × 0,8 mm); si el cuerpo es más ancho se ensancha con una transición de 45°.</p>
            </Details>
            {issuesFor((i) => !!i.field?.startsWith("insert.") || i.code.startsWith("INSERT_") || i.code.startsWith("TOWER_") || i.code.startsWith("DIFFUSER_")).map((i, k) => (
              <p key={`${i.code}-${k}`} className={`text-xs ${errors.includes(i) ? "text-red-400" : "text-amber-300"}`}>{i.message}</p>
            ))}
          </>
        )}
      </section>

      {/* ------------------------------------------------------------------ FABRICACIÓN */}
      <section className="flex flex-col gap-3">
        <SectionLabel>3 · Fabricación</SectionLabel>

        <span className="text-xs font-semibold text-gray-500">Adhesión interna</span>
        <SegmentedControl options={[{ value: "on" as const, label: "Activada" }, { value: "off" as const, label: "Desactivada" }]} value={def.adhesion.enabled ? "on" : "off"} onChange={(v) => setAdhesion({ enabled: v === "on" })} compact />
        <p className="text-xs text-gray-500">
          Un reborde anular plano hacia el interior del extremo inferior de la pieza roscada ({def.thread.connection === "collar" ? "el collar" : "la pantalla"}): más superficie contra la cama sin balsa y sin cambiar el exterior. Permanece en la pieza.
          {def.thread.connection === "collar" ? " En modo collar la pantalla lisa no lleva reborde." : ""} No garantiza imprimir sin brim con cualquier geometría o material: probalo con la pieza de prueba.
        </p>
        {def.adhesion.enabled && (
          <>
            <NumberField label="Ancho del reborde" value={def.adhesion.widthMm} onChange={(v) => setAdhesion({ widthMm: v })} suffix="mm" error={err("adhesion.widthMm")} />
            <div className="flex flex-col gap-1.5 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
              <InfoRow label="Ancho máximo sin interferencia" value={fit ? `${fmt(fit.adhesion.availableWidthMm)} mm (${fit.adhesion.limitedBy === "insert" ? "inserto" : "torre central"})` : "—"} />
              <InfoRow label="Holgura al borde interior" value={fit ? `${fmt(fit.adhesion.clearanceMm)} mm` : "—"} />
              <InfoRow label="Superficie de apoyo en la cama" value={fit ? `${fmt(fit.adhesion.contactAreaMm2 / 100)} cm² (sin reborde ${fmt(fit.adhesion.contactAreaWithoutMm2 / 100)} cm²)` : "—"} />
            </div>
            <Details title="Avanzado">
              <NumberField label="Altura del reborde" value={def.adhesion.heightMm} onChange={(v) => setAdhesion({ heightMm: v })} suffix="mm" error={err("adhesion.heightMm")} />
            </Details>
          </>
        )}
        {issuesFor((i) => !!i.field?.startsWith("adhesion.") || i.code.startsWith("ADHESION_")).map((i, k) => (
          <p key={`${i.code}-${k}`} className={`text-xs ${errors.includes(i) ? "text-red-400" : "text-amber-300"}`}>{i.message}</p>
        ))}

        <span className="mt-1 text-xs font-semibold text-gray-500">Fijación del portalámparas E27</span>
        <div role="radiogroup" aria-label="Sistema de fijación del portalámparas" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MOUNT_CARDS.map((card) => {
            const selected = def.holder.mount === card.value;
            return (
              <button
                key={card.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-mount={card.value}
                onClick={() => chooseMount(card.value)}
                className={`flex min-h-[4.5rem] flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition-colors ${selected ? "border-stampa-orange bg-stampa-orange/10" : "border-fg/10 bg-fg/[0.03] hover:bg-fg/[0.06]"}`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-fg">{MOUNT_LABELS[card.value]}</span>
                  {selected && <Check size={14} className="text-stampa-accent" aria-hidden="true" />}
                </span>
                <span className="text-[11px] text-stampa-accent">{card.badge} · {card.reference}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-400">{MOUNT_CARDS.find((c) => c.value === def.holder.mount)?.text} Las cotas salen del STL de referencia y no se redondean; el resto de la base sigue pendiente de validación física.</p>
        {mountNotice && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">{mountNotice}</p>}
        {holderNotValidated ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">Base PRELIMINAR - NO VALIDADA. Las medidas salen de los datos de referencia (Ø42, Ø58) y del STL, no de tu portalámparas: medilo, cargalo e imprimí la pieza de prueba antes de fabricar la base.</p>
        ) : (
          <p className="rounded-lg border border-fg/10 bg-fg/[0.03] p-2.5 text-xs text-gray-400">Medidas verificadas por vos. El conjunto sigue pendiente de validación física.</p>
        )}
        <Toggle label="Estas medidas son de mi portalámparas real" checked={def.holder.measured} onChange={(measured) => setHolder({ measured })} />
        <Details title="Portalámparas, bombilla y cable" defaultOpen>
          <div className="grid grid-cols-2 gap-3">
            {(def.holder.mount === "rings" || def.holder.mount === "threadBase2") && (
              <NumberField label="Ø agujero central" value={def.holder.boreDiameterMm} onChange={(v) => setHolder({ boreDiameterMm: v })} suffix="mm" error={err("holder.boreDiameterMm")} />
            )}
            <NumberField label={def.holder.mount === "rings" ? "Ø anillos (máx.)" : "Ø brida del portalámparas (máx.)"} value={def.holder.ringsDiameterMm} onChange={(v) => setHolder({ ringsDiameterMm: v })} suffix="mm" error={err("holder.ringsDiameterMm")} />
            {def.holder.mount === "rings" && (
              <>
                <NumberField label="Holgura del rebaje" value={def.holder.ringsClearanceMm} onChange={(v) => setHolder({ ringsClearanceMm: v })} suffix="mm" error={err("holder.ringsClearanceMm")} />
                <NumberField label="Prof. del rebaje" value={def.holder.ringsRecessDepthMm} onChange={(v) => setHolder({ ringsRecessDepthMm: v })} suffix="mm" error={err("holder.ringsRecessDepthMm")} />
                <NumberField label="Altura del apoyo" value={def.holder.seatHeightMm} onChange={(v) => setHolder({ seatHeightMm: v })} suffix="mm" error={err("holder.seatHeightMm")} />
              </>
            )}
            {def.holder.mount === "press" && (
              <NumberField label="Prof. del agujero a presión" value={def.holder.pressDepthMm} onChange={(v) => setHolder({ pressDepthMm: v })} suffix="mm" error={err("holder.pressDepthMm")} />
            )}
            {(def.holder.mount === "threadBase2" || def.holder.mount === "threadV6") && (
              <NumberField label="Altura de la cara de la torre" value={Math.round((def.holder.seatHeightMm + def.holder.ringsRecessDepthMm) * 100) / 100} onChange={(v) => setHolder({ seatHeightMm: Math.round((v - def.holder.ringsRecessDepthMm) * 100) / 100 })} suffix="mm" error={err("holder.seatHeightMm")} />
            )}
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
          <InfoRow label="Sistema de fijación" value={fit ? `${MOUNT_LABELS[fit.tower.mount]} · ${fit.tower.hasFloor ? "base con piso" : "base SIN piso (3 patas)"}` : "—"} strong />
          {fit?.tower.holderPress && (
            <>
              <InfoRow label="Agujero a presión (BASE v2.stl)" value={`Ø ${fmt2(fit.tower.holderPress.boreDiameterMm)} × ${fmt(fit.tower.holderPress.depthMm)} mm, apoyo a ${fmt(fit.tower.holderSeatZ)} mm`} />
              <InfoRow label="Orificio del cable en el piso" value={`Ø ${fmt2(fit.tower.holderPress.cableHoleDiameterMm)} mm`} />
            </>
          )}
          {fit?.tower.holderThread && (
            <>
              <InfoRow label={`Rosca hembra (${def.holder.mount === "threadV6" ? "patas V6.stl" : "BASE2.stl"})`} value={`raíz Ø ${fmt2(fit.tower.holderThread.rootDiameterMm)} · cresta Ø ${fmt2(fit.tower.holderThread.crestDiameterMm)}`} />
              <InfoRow label="Paso / vueltas / sentido" value={`${fmt2(fit.tower.holderThread.pitchMm)} mm · ${fit.tower.holderThread.turns} vueltas · a derechas`} />
              <InfoRow label="Cara de apoyo del portalámparas" value={`${fmt(fit.tower.holderSeatZ)} mm sobre la mesa`} />
            </>
          )}
          {fit?.tower.mount === "rings" && (
            <>
              <InfoRow label="Agujero central" value={`Ø ${fmt(fit.tower.boreDiameterMm)} mm`} />
              <InfoRow label="Rebaje de los anillos" value={`Ø ${fmt(fit.tower.ringsRecessDiameterMm)} × ${fmt(fit.tower.ringsRecessDepthMm)} mm`} />
              <InfoRow label="Material bajo el apoyo de los anillos" value={`${fmt(fit.tower.seatMaterialMm)} mm`} />
            </>
          )}
          <InfoRow label="Torre / ranura del difusor" value={fit && def.insert.enabled ? `Ø ${fmt(fit.tower.towerDiameterMm)} / Ø ${fmt2(fit.tower.slotInnerDiameterMm)}–${fmt2(fit.tower.slotOuterDiameterMm)}` : "—"} />
          <InfoRow label={fit?.tower.mount === "rings" ? "Pared entre rebaje y ranura" : "Pared entre el agujero y la ranura"} value={fit && def.insert.enabled ? `${fmt(fit.tower.innerWallMm)} mm` : "—"} />
          <InfoRow label="Altura / diámetro de la base" value={fit ? `${fmt(fit.baseHeightMm)} mm / Ø ${fmt(fit.baseDiameterMm)} mm` : "—"} />
        </div>
        {issuesFor((i) => (!!i.field?.startsWith("holder.") && i.code !== "HOLDER_NOT_VALIDATED") || !!i.field?.startsWith("cable.") || !!i.field?.startsWith("base.") || i.code.startsWith("HOLDER_") || i.code.startsWith("RINGS_") || i.code.startsWith("PRESS_") || i.code === "TOWER_ABOVE_BASE" || i.code === "TOWER_TOO_WIDE_FOR_THREAD" || i.code === "TIE_ANCHOR_NO_ROOM" || i.code === "BASE_STABILITY").map((i, k) => (
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
          <InfoRow label="Pantalla" value={metrics ? (def.shadeType === "double" ? "Impresión convencional (doble pared)" : def.shadeType === "openwork" ? "Impresión convencional (calada)" : def.thread.connection === "integrated" ? "Impresión convencional (rosca integrada)" : metrics.shade.vase.ready ? "Apta para modo vaso*" : `No apta para modo vaso (${fmt(metrics.shade.vase.maxOverhangDeg)}°)`) : "—"} strong={metrics?.shade.vase.ready && def.thread.connection === "collar"} />
          {def.thread.connection === "collar" && <InfoRow label="Collar roscado" value={metrics?.collar ? "Impresión convencional" : "—"} />}
          <InfoRow label={`Inserto ${INSERT_STYLE_LABELS[def.insert.style].toLowerCase()}`} value={metrics?.insert ? (metrics.insert.vaseCapable ? "Modo vaso posible" : def.insert.style === "drop" ? "Convencional, parado (brim si hace falta)" : "Convencional, invertido") : "—"} />
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
    </RangeContext.Provider>
  );
}

/** Botones de descarga (pieza por pieza y ZIP): los comparten el panel móvil y la tarjeta flotante de escritorio. */
export function LampExportButtons({
  hasInsert,
  insertStyle,
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
  insertStyle: LampInsertStyle;
  hasCollar: boolean;
  canDownload: boolean;
  canDownloadTests: boolean;
  busy: string | null;
  onDownloadPart: (kind: "lampShade" | "lampInsert" | "lampInsertDrop" | "lampCollar" | "body") => void;
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
        <button type="button" disabled={!canDownload || busy !== null} onClick={() => onDownloadPart(insertStyle === "drop" ? "lampInsertDrop" : "lampInsert")} className={`${button} border-fg/10 bg-fg/[0.05] text-gray-200 hover:text-fg`}>
          {icon(insertStyle === "drop" ? "lampInsertDrop" : "lampInsert")} Inserto {INSERT_STYLE_LABELS[insertStyle].toLowerCase()} (STL)
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
