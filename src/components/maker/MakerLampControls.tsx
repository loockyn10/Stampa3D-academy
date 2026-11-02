"use client";

import React from "react";
import { AlertTriangle, Check, Copy, Dices, Download, Loader2, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { NumberField, SegmentedControl } from "@/components/maker/MakerTextControls";
import { applyInsertStyle, INSERT_STYLE_LABELS } from "@/lib/maker/lamps/defaults";
import { decodeLampDesign, encodeLampDesign } from "@/lib/maker/lamps/designCode";
import { insertSilhouette, referenceInsertSurface } from "@/lib/maker/lamps/insert/silhouette";
import { OPENWORK_PRESETS, applyOpenworkPreset, applyShadeType, applySilhouette, openworkPresetMatches, type OpenworkPreset } from "@/lib/maker/lamps/openwork/presets";
import { SILHOUETTE_LABELS, type SilhouetteKind } from "@/lib/maker/lamps/openwork/silhouette";
import { renderOpenworkThumbnail } from "@/lib/maker/lamps/openwork/thumbnail";
import { LAMP_PRESETS, type LampPreset } from "@/lib/maker/lamps/presets";
import { LAMP_MEASUREMENTS_NEEDED, LAMP_NOTICE_CODES, LAMP_PHYSICAL_TESTS, LAMP_SAFETY_NOTICES } from "@/lib/maker/lamps/safety";
import { lampSilhouette } from "@/lib/maker/lamps/silhouette";
import { LAMP_LIMITS, type LampAdhesionDef, type LampOpenworkDef, type LampShadeType, type LampBaseDef, type LampBulbDef, type LampCableDef, type LampDefinition, type LampFamily, type LampHolderDef, type LampInsertDef, type LampInsertStyle, type LampIssue, type LampMetrics, type LampProfile, type LampShadeDef, type LampThreadDef } from "@/lib/maker/lamps/types";

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
  const applied = React.useMemo(() => applyOpenworkPreset(def, preset), [def.shade.heightMm, def.shade.bottomDiameterMm, def.openwork, preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const thumb = React.useMemo(() => {
    try {
      return renderOpenworkThumbnail(applied.shade, applied.openwork, 112);
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

/** Controles de la pantalla CALADA (sección Diseño / Calado). Edita `def.openwork`; las dimensiones compartidas viven en `def.shade`. */
function OpenworkSection({ def, onChange, err, issues, errors, metrics }: { def: LampDefinition; onChange: (next: LampDefinition) => void; err: (field: string) => string | undefined; issues: LampIssue[]; errors: LampIssue[]; metrics: LampMetrics | null }) {
  const ow = def.openwork;
  const set = (patch: Partial<LampOpenworkDef>) => onChange({ ...def, openwork: { ...ow, ...patch } });
  const setShade = (patch: Partial<LampShadeDef>) => onChange({ ...def, shade: { ...def.shade, ...patch } });
  const L = LAMP_LIMITS;
  const rep = metrics?.openwork ?? null;
  const diamond = ow.pattern === "diamond";
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {OPENWORK_PRESETS.map((preset) => (
          <OpenworkThumb key={preset.id} preset={preset} def={def} active={openworkPresetMatches(def, preset)} onApply={(p) => onChange(applyOpenworkPreset(def, p))} />
        ))}
      </div>
      <p className="text-xs text-gray-500">Cada diseño es una combinación real de parámetros del mismo motor: elegilo y ajustá cualquier valor. Las aberturas son huecos reales en la malla (no una textura), así que el visor y el STL son la misma geometría.</p>
      <span className="text-xs font-semibold text-gray-500">Patrón</span>
      <SegmentedControl options={PATTERN_OPTIONS} value={ow.pattern} onChange={(pattern) => set({ pattern })} compact />

      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Diseño · silueta</span>
      <SegmentedControl options={SILHOUETTE_OPTIONS} value={"" as SilhouetteKind} onChange={(kind) => onChange(applySilhouette(def, kind))} compact />
      <SliderField label="Altura de la pantalla" value={def.shade.heightMm} min={80} max={320} step={5} suffix=" mm" onChange={(v) => setShade({ heightMm: v })} error={err("shade.heightMm")} />
      <SliderField label="Diámetro inferior" value={def.shade.bottomDiameterMm} min={100} max={260} step={5} suffix=" mm" onChange={(v) => setShade({ bottomDiameterMm: v })} error={err("shade.bottomDiameterMm")} />
      <SliderField label="Diámetro superior" value={def.shade.topDiameterMm} min={80} max={280} step={5} suffix=" mm" onChange={(v) => setShade({ topDiameterMm: v })} error={err("shade.topDiameterMm")} />
      <SliderField label="Diámetro máximo (abombado)" value={ow.maxDiameterMm} min={80} max={300} step={5} suffix=" mm" onChange={(v) => set({ maxDiameterMm: v })} error={err("openwork.maxDiameterMm")} />
      <SliderField label="Intensidad de cintura" value={ow.waistPct} min={0} max={100} step={5} suffix="%" onChange={(v) => set({ waistPct: v })} error={err("openwork.waistPct")} />
      <SliderField label="Torsión" value={ow.twistDeg} min={-720} max={720} step={5} suffix="°" onChange={(v) => set({ twistDeg: v })} error={err("openwork.twistDeg")} />

      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Calado</span>
      {diamond ? (
        <>
          <SliderField label="Densidad (rombos alrededor)" value={ow.divisions} min={L["openwork.divisions"].min} max={L["openwork.divisions"].max} step={1} onChange={(v) => set({ divisions: Math.round(v) })} error={err("openwork.divisions")} />
          <SliderField label="Inclinación de las diagonales" value={ow.inclinationDeg} min={L["openwork.inclinationDeg"].min} max={L["openwork.inclinationDeg"].max} step={1} suffix="°" onChange={(v) => set({ inclinationDeg: v })} error={err("openwork.inclinationDeg")} />
        </>
      ) : (
        <>
          <SliderField label="Cantidad de bandas" value={ow.bands} min={L["openwork.bands"].min} max={L["openwork.bands"].max} step={1} onChange={(v) => set({ bands: Math.round(v) })} error={err("openwork.bands")} />
          <SliderField label="Vueltas" value={ow.turns} min={L["openwork.turns"].min} max={L["openwork.turns"].max} step={0.05} onChange={(v) => set({ turns: v })} error={err("openwork.turns")} />
        </>
      )}
      <SliderField label="Grosor (ancho de las tiras)" value={ow.stripWidthMm} min={1} max={14} step={0.2} suffix=" mm" onChange={(v) => set({ stripWidthMm: v })} error={err("openwork.stripWidthMm")} />
      <SliderField label="Profundidad de las tiras" value={ow.depthMm} min={1} max={6} step={0.1} suffix=" mm" onChange={(v) => set({ depthMm: v })} error={err("openwork.depthMm")} />
      {!diamond && rep?.bandGapMm != null && <p className="text-xs text-gray-500">Separación libre entre bandas: <span className="font-semibold text-gray-300">{fmt(rep.bandGapMm)} mm</span> (sale de bandas, vueltas y grosor).</p>}

      <Details title="Opciones avanzadas del calado">
        <SliderField label="Posición del ensanchamiento / cintura" value={ow.bulgePositionPct} min={10} max={90} step={5} suffix="%" onChange={(v) => set({ bulgePositionPct: v })} error={err("openwork.bulgePositionPct")} />
        <SliderField label="Curvatura" value={ow.curvaturePct} min={0} max={100} step={5} suffix="%" onChange={(v) => set({ curvaturePct: v })} error={err("openwork.curvaturePct")} />
        <SliderField label="Variación orgánica" value={ow.organicPct} min={0} max={100} step={5} suffix="%" onChange={(v) => set({ organicPct: v })} error={err("openwork.organicPct")} />
        {diamond && <SliderField label="Desplazamiento de fase" value={ow.phaseDeg} min={0} max={360} step={5} suffix="°" onChange={(v) => set({ phaseDeg: v })} error={err("openwork.phaseDeg")} />}
        <SliderField label={diamond ? "Variación vertical de la inclinación" : "Variación de inclinación"} value={ow.variationPct} min={0} max={70} step={5} suffix="%" onChange={(v) => set({ variationPct: v })} error={err("openwork.variationPct")} />
        <SliderField label="Ciclos de la variación" value={ow.variationCycles} min={0} max={6} step={0.5} onChange={(v) => set({ variationCycles: v })} error={err("openwork.variationCycles")} />
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
        <SectionLabel>1 · Pantalla exterior</SectionLabel>
        <span className="text-xs font-semibold text-gray-500">Tipo de pantalla</span>
        <SegmentedControl options={SHADE_TYPE_OPTIONS} value={def.shadeType} onChange={(type) => onChange(applyShadeType(def, type))} compact />
        {def.shadeType === "openwork" ? (
          <OpenworkSection def={def} onChange={onChange} err={err} issues={issuesFor((i) => !!i.field?.startsWith("openwork.") || i.code.startsWith("OPENWORK_"))} errors={errors} metrics={metrics} />
        ) : (
        <>
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
          Semilla <span className="font-semibold text-gray-300">{def.shade.seed}</span>: la misma semilla y los mismos datos vuelven a dar exactamente este diseño. El diseño solo controla la apariencia de la pantalla: no cambia la rosca, la base ni el inserto.
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
        </>
        )}
        {def.shadeType === "openwork" && issuesFor((i) => i.code.startsWith("SHADE_")).map((i, k) => (
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
            {def.shadeType === "openwork" && (
              <div className="flex flex-col gap-2 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
                <span className="text-xs font-semibold text-gray-500">Diámetro del difusor (pantalla calada)</span>
                <SegmentedControl
                  options={[{ value: "rings" as const, label: "Según los anillos" }, { value: "manual" as const, label: "Manual" }]}
                  value={def.openwork.diffuserFit}
                  onChange={(diffuserFit) => onChange({ ...def, openwork: { ...def.openwork, diffuserFit } })}
                  compact
                />
                {def.openwork.diffuserFit === "rings" && (
                  <SliderField label="Holgura diametral" value={def.openwork.diffuserClearanceMm} min={L["openwork.diffuserClearanceMm"].min} max={L["openwork.diffuserClearanceMm"].max} step={0.1} suffix=" mm" onChange={(v) => onChange({ ...def, openwork: { ...def.openwork, diffuserClearanceMm: v } })} error={err("openwork.diffuserClearanceMm")} />
                )}
                {fit?.diffuser && (
                  <div className="flex flex-col gap-1">
                    <InfoRow label="Ø libre anillo inferior / superior" value={`${fmt(fit.diffuser.ringBottomFreeDiameterMm)} / ${fmt(fit.diffuser.ringTopFreeDiameterMm)} mm`} />
                    <InfoRow label="Ø máximo que admite la base" value={`${fmt(fit.diffuser.baseLimitDiameterMm)} mm`} />
                    <InfoRow label="Ø exterior del difusor" value={`${fmt(fit.diffuser.diffuserDiameterMm)} mm`} strong />
                    <InfoRow label="Holgura radial inferior / superior" value={`${fmt(fit.diffuser.radialClearanceBottomMm)} / ${fmt(fit.diffuser.radialClearanceTopMm)} mm`} />
                    <InfoRow label="Lo limita" value={{ bottomRing: "el anillo inferior", topRing: "el anillo superior", base: "la base y la rosca", manual: "el valor manual" }[fit.diffuser.limitedBy]} />
                  </div>
                )}
                <p className="text-xs text-gray-500">El difusor es un cilindro: no sigue la silueta abombada. Su diámetro sale del interior LIBRE de los anillos (la cara interior, no la exterior) menos la holgura diametral, que es un valor inicial pendiente de validación física. Las lengüetas de extracción no se usan con este ajuste.</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {(def.shadeType !== "openwork" || def.openwork.diffuserFit === "manual") && (
                <NumberField label="Ø exterior (montaje)" value={def.insert.diameterMm ?? fit?.insertOuterDiameterMm ?? 65} onChange={(v) => setInsert({ diameterMm: v })} suffix="mm" error={err("insert.diameterMm")} />
              )}
              <NumberField label="Espesor de pared" value={def.insert.thicknessMm} onChange={(v) => setInsert({ thicknessMm: v })} suffix="mm" error={err("insert.thicknessMm")} />
            </div>
            <Toggle label="Altura automática" checked={def.insert.heightMm === null} onChange={(auto) => setInsert({ heightMm: auto ? null : (fit?.insertHeightMm ?? 180) })} />
            {def.insert.heightMm === null ? (
              <p className="text-xs text-gray-500">
                {def.insert.style === "drop"
                  ? "Automática: la mínima que deja el arranque del cierre por encima de la bombilla más la separación de diseño."
                  : def.insert.style === "flat"
                    ? "Automática: el porcentaje de lo disponible, y nunca menos de lo necesario para que la tapa quede sobre la bombilla."
                    : "Automática: el porcentaje de lo disponible bajo el borde de la pantalla."}
              </p>
            ) : (
              <NumberField label="Altura total del inserto" value={def.insert.heightMm} onChange={(v) => setInsert({ heightMm: v })} suffix="mm" error={err("insert.heightMm")} />
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
              <InfoRow label={fit?.insertAuto ? "Ø exterior de montaje (el más angosto)" : "Ø exterior de montaje"} value={fit?.insertOuterDiameterMm != null ? `Ø ${fmt(fit.insertOuterDiameterMm)} mm` : "—"} strong />
              <InfoRow label="Ø interior (montaje)" value={fit?.insertInnerDiameterMm != null ? `Ø ${fmt(fit.insertInnerDiameterMm)} mm` : "—"} />
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
              <SliderField label="Altura automática (% de lo disponible)" value={def.insert.heightPct} min={L["insert.heightPct"].min} max={L["insert.heightPct"].max} step={1} suffix="%" onChange={(v) => setInsert({ heightPct: v })} error={err("insert.heightPct")} />
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Profundidad de la ranura" value={def.insert.seatDepthMm} onChange={(v) => setInsert({ seatDepthMm: v })} suffix="mm" error={err("insert.seatDepthMm")} />
                <NumberField label="Separación mínima a la bombilla" value={def.insert.minBulbGapMm} onChange={(v) => setInsert({ minBulbGapMm: v })} suffix="mm" error={err("insert.minBulbGapMm")} />
              </div>
              <Toggle label="Diámetro automático (el más angosto posible)" checked={def.insert.diameterMm === null} onChange={(auto) => setInsert({ diameterMm: auto ? null : (fit?.insertOuterDiameterMm ?? 65) })} />
              <p className="text-xs text-gray-500">La separación mínima solo evita el contacto previsto con las medidas cargadas (la bombilla se modela como un cilindro): no es una distancia térmicamente segura. La zona de montaje inferior es idéntica en los tres estilos.</p>
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

        <span className="mt-1 text-xs font-semibold text-gray-500">Perfil de base E27</span>
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
          <InfoRow label="Pantalla" value={metrics ? (def.shadeType === "openwork" ? "Impresión convencional (calada)" : def.thread.connection === "integrated" ? "Impresión convencional (rosca integrada)" : metrics.shade.vase.ready ? "Apta para modo vaso*" : `No apta para modo vaso (${fmt(metrics.shade.vase.maxOverhangDeg)}°)`) : "—"} strong={metrics?.shade.vase.ready && def.thread.connection === "collar"} />
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
