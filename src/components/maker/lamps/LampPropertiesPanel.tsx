"use client";

import React from "react";
import { Lock, ShieldAlert } from "lucide-react";
import { LampStatus } from "@/components/maker/LampStatus";
import { Details, HiddenNote, InfoRow, MAIN_LABEL, NO_RANGES, NO_STALE, RangeContext, RangeSlider, SectionLabel, SliderField, Toggle, accentButton, fmt, fmt2 } from "@/components/maker/lamps/controls";
import { DIFFUSER_KIND_INFO, DiffuserKindCard } from "@/components/maker/lamps/thumbs";
import { NumberField, SegmentedControl } from "@/components/maker/MakerTextControls";
import { applyDiffuserKind, familyCaps, diffuserKind, DIFFUSER_KIND_LABELS } from "@/lib/maker/lamps/capabilities";
import { availableDoubleInnerShapes, availableDoubleOuterShapes, silhouetteAvailability } from "@/lib/maker/lamps/availability";
import type { ControlRange } from "@/lib/maker/lamps/constraints";
import { applyEditorFix, availableDiffuserKinds, DIFFUSER_CONTROLS, EDITOR_COMPONENT_LABELS, editorIssueSummary, resetShade, type EditorComponent } from "@/lib/maker/lamps/editor";
import { applyDoubleInnerShape, applyDoubleOuterShape, DOUBLE_INNER_LABELS, DOUBLE_OUTER_LABELS, type DoubleInnerKind, type DoubleOuterKind } from "@/lib/maker/lamps/doublewall/shapes";
import { allowedProfileTops, effectiveProfileTop, isProfileStyle, PROFILE_TOP_LABELS } from "@/lib/maker/lamps/insert/profile";
import { fieldMessage, type IssueFix } from "@/lib/maker/lamps/issuesSummary";
import { applySilhouette } from "@/lib/maker/lamps/openwork/presets";
import { SILHOUETTE_LABELS, type SilhouetteKind } from "@/lib/maker/lamps/openwork/silhouette";
import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";
import { LAMP_MEASUREMENTS_NEEDED, LAMP_PHYSICAL_TESTS, LAMP_SAFETY_NOTICES } from "@/lib/maker/lamps/safety";
import { describeDeviations, mechanicalDeviations } from "@/lib/maker/lamps/standard";
import type { LampDefinition, LampDoubleWallDef, LampFamily, LampInsertDef, LampIssue, LampMetrics, LampOpenworkDef, LampProfile, LampShadeDef } from "@/lib/maker/lamps/types";

export const INSERT_SWATCHES: { value: string; label: string }[] = [
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

const FAMILY_OPTIONS: { value: LampFamily; label: string }[] = [
  { value: "wavy", label: "Ondulada" },
  { value: "spiral", label: "Espiral" },
  { value: "organic", label: "Orgánica" },
];
const PROFILE_OPTIONS: { value: LampProfile; label: string }[] = [
  { value: "straight", label: "Recto" },
  { value: "barrel", label: "Barril" },
  { value: "waist", label: "Cintura" },
  { value: "bell", label: "Campana" },
  { value: "tulip", label: "Tulipán" },
];
const PATTERN_OPTIONS: { value: LampOpenworkDef["pattern"]; label: string }[] = [
  { value: "diamond", label: "Diamante" },
  { value: "spiral", label: "Espiral" },
];
const TOP_OPTIONS: { value: LampOpenworkDef["topFinish"]; label: string }[] = [
  { value: "ring", label: "Con anillo" },
  { value: "open", label: "Abierta" },
];
const CHAMBER_OPTIONS: { value: LampDoubleWallDef["chamber"]; label: string }[] = [
  { value: "closed", label: "Cerrada" },
  { value: "open", label: "Abierta arriba" },
];
const DOUBLE_OUTER_OPTIONS: { value: DoubleOuterKind; label: string }[] = (Object.keys(DOUBLE_OUTER_LABELS) as DoubleOuterKind[]).map((value) => ({ value, label: DOUBLE_OUTER_LABELS[value] }));
const DOUBLE_INNER_OPTIONS: { value: DoubleInnerKind; label: string }[] = (Object.keys(DOUBLE_INNER_LABELS) as DoubleInnerKind[]).map((value) => ({ value, label: DOUBLE_INNER_LABELS[value] }));
const SILHOUETTE_OPTIONS: { value: SilhouetteKind; label: string }[] = (Object.keys(SILHOUETTE_LABELS) as SilhouetteKind[]).map((value) => ({ value, label: SILHOUETTE_LABELS[value] }));

const SUB_LABEL = "text-xs font-semibold text-gray-500";

interface SectionProps {
  def: LampDefinition;
  onChange: (next: LampDefinition) => void;
  err: (field: string) => string | undefined;
  /** Estado del diseño (problema que bloquea, recomendaciones, seguridad): va justo debajo de los controles principales. */
  status: React.ReactNode;
  metrics: LampMetrics | null;
  onMoreToggle: (open: boolean) => void;
}

// ================================================================================================ PANTALLA

/** SÓLIDA: tres controles principales (altura, diámetro, intensidad del diseño). El estilo se elige en la biblioteca. Los parámetros geométricos de la forma están en «Más ajustes». */
function SolidShade({ def, onChange, err, status, onMoreToggle }: SectionProps) {
  const setShade = (patch: Partial<LampShadeDef>) => onChange({ ...def, shade: { ...def.shade, ...patch } });
  return (
    <>
      <span className={MAIN_LABEL}>Ajustes principales</span>
      <RangeSlider path="shade.heightMm" label="Altura" value={def.shade.heightMm} onChange={(v) => setShade({ heightMm: v })} suffix=" mm" error={err("shade.heightMm")} />
      <RangeSlider path="shade.bottomDiameterMm" label="Diámetro" value={def.shade.bottomDiameterMm} onChange={(v) => setShade({ bottomDiameterMm: v })} suffix=" mm" error={err("shade.bottomDiameterMm")} />
      <RangeSlider path="shade.amplitudeMm" label="Intensidad del diseño" value={def.shade.amplitudeMm} onChange={(v) => setShade({ amplitudeMm: v })} suffix=" mm" error={err("shade.amplitudeMm")} />
      {status}
      <Details title="Más ajustes" id="shade-more" onToggle={onMoreToggle}>
        <span className={SUB_LABEL}>Familia de patrón</span>
        <SegmentedControl options={FAMILY_OPTIONS} value={def.shade.family} onChange={(family) => setShade({ family })} compact />
        <span className={SUB_LABEL}>Perfil</span>
        <SegmentedControl options={PROFILE_OPTIONS} value={def.shade.profile} onChange={(profile) => setShade({ profile })} compact />
        {def.shade.profile !== "straight" && <RangeSlider path="shade.profileAmountPct" label="Intensidad del perfil" value={def.shade.profileAmountPct} onChange={(v) => setShade({ profileAmountPct: v })} suffix="%" error={err("shade.profileAmountPct")} />}
        <RangeSlider path="shade.topDiameterMm" label="Diámetro superior" value={def.shade.topDiameterMm} onChange={(v) => setShade({ topDiameterMm: v })} suffix=" mm" error={err("shade.topDiameterMm")} />
        <RangeSlider path="shade.waves" label="Cantidad de ondas" value={def.shade.waves} onChange={(v) => setShade({ waves: Math.round(v) })} error={err("shade.waves")} />
        <RangeSlider path="shade.twistDeg" label="Torsión" value={def.shade.twistDeg} onChange={(v) => setShade({ twistDeg: v })} suffix="°" error={err("shade.twistDeg")} />
        <RangeSlider path="shade.verticalFrequency" label="Variación vertical (ciclos)" value={def.shade.verticalFrequency} onChange={(v) => setShade({ verticalFrequency: v })} error={err("shade.verticalFrequency")} />
        <RangeSlider path="shade.patternIntensityPct" label="Intensidad de la variación vertical" value={def.shade.patternIntensityPct} onChange={(v) => setShade({ patternIntensityPct: v })} suffix="%" error={err("shade.patternIntensityPct")} />
        {def.shade.family === "organic" && <RangeSlider path="shade.organicPct" label="Variación orgánica" value={def.shade.organicPct} onChange={(v) => setShade({ organicPct: v })} suffix="%" error={err("shade.organicPct")} />}
        <NumberField label="Espesor de pared" value={def.shade.wallMm} onChange={(v) => setShade({ wallMm: v })} suffix="mm" error={err("shade.wallMm")} />
        <NumberField label="Semilla" value={def.shade.seed} onChange={(v) => setShade({ seed: Math.max(0, Math.round(v)) })} error={err("shade.seed")} />
      </Details>
    </>
  );
}

/** CALADA: tres controles principales (altura, forma exterior, densidad del patrón). El difusor cilíndrico se ajusta solo al interior de los anillos. */
function OpenworkShade({ def, onChange, err, status, metrics, onMoreToggle }: SectionProps) {
  const ow = def.openwork;
  const set = (patch: Partial<LampOpenworkDef>) => onChange({ ...def, openwork: { ...ow, ...patch } });
  const rep = metrics?.openwork ?? null;
  const diamond = ow.pattern === "diamond";
  const driven = ow.diffuserFit === "diameter";
  // Las siluetas que con las medidas actuales no dan una geometría válida no se ofrecen (se evalúan fuera del camino del slider).
  const deferred = React.useDeferredValue(def);
  const silhouettes = React.useMemo(() => {
    const base = new Set(validateLamp(deferred).errors.map((e) => e.code));
    return SILHOUETTE_OPTIONS.filter((o) => silhouetteAvailability(deferred, o.value, base).ok);
  }, [deferred]);
  return (
    <>
      <span className={MAIN_LABEL}>Ajustes principales</span>
      <RangeSlider path="shade.heightMm" label="Altura" value={def.shade.heightMm} onChange={(v) => onChange({ ...def, shade: { ...def.shade, heightMm: v } })} suffix=" mm" error={err("shade.heightMm")} />
      <span className={SUB_LABEL}>Forma exterior</span>
      <SegmentedControl options={silhouettes} value={"" as SilhouetteKind} onChange={(kind) => onChange(applySilhouette(def, kind))} compact />
      {diamond ? (
        <RangeSlider path="openwork.divisions" label="Densidad del patrón (rombos alrededor)" value={ow.divisions} onChange={(v) => set({ divisions: Math.round(v) })} error={err("openwork.divisions")} />
      ) : (
        <RangeSlider path="openwork.bands" label="Densidad del patrón (bandas)" value={ow.bands} onChange={(v) => set({ bands: Math.round(v) })} error={err("openwork.bands")} />
      )}
      {status}
      <Details title="Más ajustes" id="shade-more" onToggle={onMoreToggle}>
        <span className={SUB_LABEL}>Patrón</span>
        <SegmentedControl options={PATTERN_OPTIONS} value={ow.pattern} onChange={(pattern) => set({ pattern })} compact />
        <RangeSlider path="openwork.maxDiameterMm" label="Diámetro máximo decorativo" value={ow.maxDiameterMm} onChange={(v) => set({ maxDiameterMm: v })} suffix=" mm" error={err("openwork.maxDiameterMm")} />
        {!driven && (
          <>
            <RangeSlider path="shade.bottomDiameterMm" label="Diámetro inferior (exterior del anillo)" value={def.shade.bottomDiameterMm} onChange={(v) => onChange({ ...def, shade: { ...def.shade, bottomDiameterMm: v } })} suffix=" mm" error={err("shade.bottomDiameterMm")} />
            <RangeSlider path="shade.topDiameterMm" label="Diámetro superior (exterior del anillo)" value={def.shade.topDiameterMm} onChange={(v) => onChange({ ...def, shade: { ...def.shade, topDiameterMm: v } })} suffix=" mm" error={err("shade.topDiameterMm")} />
          </>
        )}
        <RangeSlider path="openwork.waistPct" label="Intensidad de cintura" value={ow.waistPct} onChange={(v) => set({ waistPct: v })} suffix="%" error={err("openwork.waistPct")} />
        <RangeSlider path="openwork.twistDeg" label="Torsión" value={ow.twistDeg} onChange={(v) => set({ twistDeg: v })} suffix="°" error={err("openwork.twistDeg")} />
        {diamond ? (
          <RangeSlider path="openwork.inclinationDeg" label="Inclinación de las diagonales" value={ow.inclinationDeg} onChange={(v) => set({ inclinationDeg: v })} suffix="°" error={err("openwork.inclinationDeg")} />
        ) : (
          <RangeSlider path="openwork.turns" label="Vueltas" value={ow.turns} onChange={(v) => set({ turns: v })} error={err("openwork.turns")} />
        )}
        <RangeSlider path="openwork.stripWidthMm" label="Grosor de la estructura (ancho de las tiras)" value={ow.stripWidthMm} onChange={(v) => set({ stripWidthMm: v })} suffix=" mm" error={err("openwork.stripWidthMm")} />
        <RangeSlider path="openwork.depthMm" label="Profundidad de las tiras" value={ow.depthMm} onChange={(v) => set({ depthMm: v })} suffix=" mm" error={err("openwork.depthMm")} />
        {!diamond && rep?.bandGapMm != null && <p className="text-xs text-gray-500">Separación libre entre bandas: <span className="font-semibold text-gray-300">{fmt(rep.bandGapMm)} mm</span>.</p>}
        <RangeSlider path="openwork.bulgePositionPct" label="Posición del ensanchamiento / cintura" value={ow.bulgePositionPct} onChange={(v) => set({ bulgePositionPct: v })} suffix="%" error={err("openwork.bulgePositionPct")} />
        <RangeSlider path="openwork.curvaturePct" label="Curvatura" value={ow.curvaturePct} onChange={(v) => set({ curvaturePct: v })} suffix="%" error={err("openwork.curvaturePct")} />
        <RangeSlider path="openwork.organicPct" label="Variación orgánica" value={ow.organicPct} onChange={(v) => set({ organicPct: v })} suffix="%" error={err("openwork.organicPct")} />
        {diamond && <SliderField label="Desplazamiento de fase" value={ow.phaseDeg} min={-180} max={180} step={5} suffix="°" onChange={(v) => set({ phaseDeg: v })} error={err("openwork.phaseDeg")} />}
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
        <span className={SUB_LABEL}>Terminación superior</span>
        <SegmentedControl options={TOP_OPTIONS} value={ow.topFinish} onChange={(topFinish) => set({ topFinish })} compact />
        <NumberField label="Semilla (silueta orgánica)" value={ow.seed} onChange={(v) => set({ seed: Math.max(0, Math.round(v)) })} error={err("openwork.seed")} />
      </Details>
    </>
  );
}

/** DOBLE PARED: tres controles principales (forma exterior, forma interior, separación). La pared interior cumple la función del difusor: no hay difusor tradicional. */
function DoubleShade({ def, onChange, err, status, onMoreToggle }: SectionProps) {
  const d = def.doubleWall;
  const set = (patch: Partial<LampDoubleWallDef>) => onChange({ ...def, doubleWall: { ...d, ...patch } });
  const setShade = (patch: Partial<LampShadeDef>) => onChange({ ...def, shade: { ...def.shade, ...patch } });
  // Las formas que con las medidas actuales rompen la separación entre paredes no se ofrecen (se evalúan fuera del camino del slider).
  const deferred = React.useDeferredValue(def);
  const shapes = React.useMemo(() => {
    const outer = availableDoubleOuterShapes(deferred, DOUBLE_OUTER_OPTIONS.map((o) => o.value));
    const inner = availableDoubleInnerShapes(deferred, DOUBLE_INNER_OPTIONS.map((o) => o.value));
    return {
      outer: DOUBLE_OUTER_OPTIONS.filter((o) => outer.available.includes(o.value)),
      inner: DOUBLE_INNER_OPTIONS.filter((o) => inner.available.includes(o.value)),
      hidden: [...outer.hidden.map((h) => ({ label: "Exterior " + DOUBLE_OUTER_LABELS[h.kind].toLowerCase(), reason: h.reason })), ...inner.hidden.map((h) => ({ label: "Interior " + DOUBLE_INNER_LABELS[h.kind].toLowerCase(), reason: h.reason }))],
    };
  }, [deferred]);
  return (
    <>
      <span className={MAIN_LABEL}>Ajustes principales</span>
      <span className={SUB_LABEL}>Forma exterior</span>
      <SegmentedControl options={shapes.outer} value={"" as DoubleOuterKind} onChange={(kind) => onChange(applyDoubleOuterShape(def, kind))} compact />
      <span className={SUB_LABEL}>Forma interior</span>
      <SegmentedControl options={shapes.inner} value={"" as DoubleInnerKind} onChange={(kind) => onChange(applyDoubleInnerShape(def, kind))} compact />
      <HiddenNote items={shapes.hidden} noun="forma" />
      <RangeSlider path="doubleWall.minGapMm" label="Separación entre paredes" value={d.minGapMm} onChange={(v) => set({ minGapMm: v })} suffix=" mm" error={err("doubleWall.minGapMm")} />
      {status}
      <Details title="Más ajustes" id="shade-more" onToggle={onMoreToggle}>
        <span className={MAIN_LABEL}>Dimensiones</span>
        <RangeSlider path="shade.heightMm" label="Altura" value={def.shade.heightMm} onChange={(v) => setShade({ heightMm: v })} suffix=" mm" error={err("shade.heightMm")} />
        <RangeSlider path="doubleWall.maxDiameterMm" label="Diámetro máximo" value={d.maxDiameterMm} onChange={(v) => set({ maxDiameterMm: v })} suffix=" mm" error={err("doubleWall.maxDiameterMm")} />
        <span className={MAIN_LABEL}>Pared exterior</span>
        <RangeSlider path="shade.bottomDiameterMm" label="Diámetro inferior (pared exterior)" value={def.shade.bottomDiameterMm} onChange={(v) => setShade({ bottomDiameterMm: v })} suffix=" mm" error={err("shade.bottomDiameterMm")} />
        <RangeSlider path="shade.topDiameterMm" label="Diámetro superior (pared exterior)" value={def.shade.topDiameterMm} onChange={(v) => setShade({ topDiameterMm: v })} suffix=" mm" error={err("shade.topDiameterMm")} />
        <RangeSlider path="doubleWall.fluteAmplitudeMm" label="Profundidad de las ondulaciones" value={d.fluteAmplitudeMm} onChange={(v) => set({ fluteAmplitudeMm: v })} suffix=" mm" error={err("doubleWall.fluteAmplitudeMm")} />
        <RangeSlider path="doubleWall.flutes" label="Cantidad de ondulaciones" value={d.flutes} onChange={(v) => set({ flutes: Math.round(v) })} error={err("doubleWall.flutes")} />
        <RangeSlider path="doubleWall.twistDeg" label="Torsión" value={d.twistDeg} onChange={(v) => set({ twistDeg: v })} suffix="°" error={err("doubleWall.twistDeg")} />
        <RangeSlider path="doubleWall.bulgePositionPct" label="Posición del ensanchamiento" value={d.bulgePositionPct} onChange={(v) => set({ bulgePositionPct: v })} suffix="%" error={err("doubleWall.bulgePositionPct")} />
        <RangeSlider path="doubleWall.curvaturePct" label="Curvatura de la pared exterior" value={d.curvaturePct} onChange={(v) => set({ curvaturePct: v })} suffix="%" error={err("doubleWall.curvaturePct")} />
        <span className={MAIN_LABEL}>Pared interior</span>
        <RangeSlider path="doubleWall.innerBottomDiameterMm" label="Diámetro inferior (pared interior)" value={d.innerBottomDiameterMm} onChange={(v) => set({ innerBottomDiameterMm: v })} suffix=" mm" error={err("doubleWall.innerBottomDiameterMm")} />
        <RangeSlider path="doubleWall.innerTopDiameterMm" label="Diámetro superior (pared interior)" value={d.innerTopDiameterMm} onChange={(v) => set({ innerTopDiameterMm: v })} suffix=" mm" error={err("doubleWall.innerTopDiameterMm")} />
        <RangeSlider path="doubleWall.innerWaistPct" label="Intensidad de cintura" value={d.innerWaistPct} onChange={(v) => set({ innerWaistPct: v })} suffix="%" error={err("doubleWall.innerWaistPct")} />
        <RangeSlider path="doubleWall.innerWaistPositionPct" label="Posición de la cintura interior" value={d.innerWaistPositionPct} onChange={(v) => set({ innerWaistPositionPct: v })} suffix="%" error={err("doubleWall.innerWaistPositionPct")} />
        <RangeSlider path="doubleWall.innerCurvaturePct" label="Curvatura de la pared interior" value={d.innerCurvaturePct} onChange={(v) => set({ innerCurvaturePct: v })} suffix="%" error={err("doubleWall.innerCurvaturePct")} />
        <RangeSlider path="doubleWall.innerOrganicPct" label="Variación orgánica interior" value={d.innerOrganicPct} onChange={(v) => set({ innerOrganicPct: v })} suffix="%" error={err("doubleWall.innerOrganicPct")} />
        <span className={MAIN_LABEL}>Cámara de aire</span>
        <SegmentedControl options={CHAMBER_OPTIONS} value={d.chamber} onChange={(chamber) => set({ chamber })} compact />
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Espesor de las paredes" value={d.wallMm} onChange={(v) => set({ wallMm: v })} suffix="mm" error={err("doubleWall.wallMm")} />
          <NumberField label="Piso (unión inferior)" value={d.floorMm} onChange={(v) => set({ floorMm: v })} suffix="mm" error={err("doubleWall.floorMm")} />
          <NumberField label="Altura del techo inclinado" value={d.roofHeightMm} onChange={(v) => set({ roofHeightMm: v })} suffix="mm" error={err("doubleWall.roofHeightMm")} />
          <NumberField label="Rim superior" value={d.roofCapMm} onChange={(v) => set({ roofCapMm: v })} suffix="mm" error={err("doubleWall.roofCapMm")} />
          <NumberField label="Ancho final de la cámara" value={d.topGapMm} onChange={(v) => set({ topGapMm: v })} suffix="mm" error={err("doubleWall.topGapMm")} />
        </div>
      </Details>
    </>
  );
}

// ================================================================================================ DIFUSOR

type MetricsFit = LampMetrics["fit"] | null;

/** Un control del difusor por su ruta. Los rangos salen de la validación real (`RangeSlider`): nada se ofrece si rompe el modelo. El encastre inferior estándar no tiene controles. */
function DiffuserControl({ path, def, setInsert, err, fit }: { path: string; def: LampDefinition; setInsert: (patch: Partial<LampInsertDef>) => void; err: (field: string) => string | undefined; fit: MetricsFit }) {
  const i = def.insert;
  const slider = (label: string, suffix: string, key: keyof LampInsertDef, value: number, round = false) => <RangeSlider key={path} path={path} label={label} value={value} onChange={(v) => setInsert({ [key]: round ? Math.round(v) : v } as Partial<LampInsertDef>)} suffix={suffix} error={err(path)} />;
  switch (path) {
    case "insert.heightMm": {
      const style = i.style;
      const profile = isProfileStyle(style);
      const height = i.heightMm ?? fit?.insertHeightMm ?? 150;
      if (!profile && i.heightMm === null) {
        return (
          <div key={path} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-500">Altura automática ({fmt(height)} mm)</span>
            <button type="button" onClick={() => setInsert({ heightMm: height })} className="rounded-md border border-fg/10 px-2 py-1 font-semibold text-gray-300 hover:text-fg">
              Ajustar altura
            </button>
          </div>
        );
      }
      return (
        <div key={path} className="flex flex-col gap-1">
          {slider("Altura", " mm", "heightMm", height)}
          {!profile && (
            <button type="button" onClick={() => setInsert({ heightMm: null })} className="w-fit text-[11px] font-semibold text-gray-500 underline-offset-2 hover:text-fg hover:underline">
              Volver a la altura automática
            </button>
          )}
        </div>
      );
    }
    case "insert.waves":
      return slider("Número de ondas", "", "waves", i.waves, true);
    case "insert.amplitudeMm":
      return slider("Amplitud", " mm", "amplitudeMm", i.amplitudeMm);
    case "insert.twistDeg":
      return slider("Torsión", "°", "twistDeg", i.twistDeg);
    case "insert.verticalFrequency":
      return slider("Frecuencia vertical (ciclos)", "", "verticalFrequency", i.verticalFrequency);
    case "insert.dropClosureMm":
      return slider("Altura del cierre", " mm", "dropClosureMm", i.dropClosureMm);
    case "insert.dropCurvaturePct":
      return slider("Curvatura", "%", "dropCurvaturePct", i.dropCurvaturePct);
    case "insert.dropTipRadiusMm":
      return slider("Redondeo de la punta", " mm", "dropTipRadiusMm", i.dropTipRadiusMm);
    case "insert.profileWidthMm":
      return slider(i.style === "bell" ? "Ancho del cuerpo (Ø)" : "Ancho (Ø máximo)", " mm", "profileWidthMm", i.profileWidthMm);
    case "insert.profileTopDiameterMm":
      return slider(i.style === "tulip" ? "Apertura superior (Ø)" : "Estrechamiento (Ø superior)", " mm", "profileTopDiameterMm", i.profileTopDiameterMm);
    case "insert.profileCurvaturePct":
      return slider(i.style === "mossglow" ? "Curvatura (0 = cono recto, 100 = abombado)" : "Curvatura", "%", "profileCurvaturePct", i.profileCurvaturePct);
    case "insert.profileWaistPct":
      return slider("Intensidad de la cintura", "%", "profileWaistPct", i.profileWaistPct);
    case "insert.profileWaistPositionPct":
      return slider("Posición de la cintura", "%", "profileWaistPositionPct", i.profileWaistPositionPct);
    case "picker:profileTop": {
      if (!isProfileStyle(i.style)) return null;
      const tops = allowedProfileTops(i.style);
      if (tops.length < 2) return null;
      return (
        <div key={path} className="flex flex-col gap-1.5">
          <span className={SUB_LABEL}>Terminación superior</span>
          <SegmentedControl options={tops.map((value) => ({ value, label: PROFILE_TOP_LABELS[value] }))} value={effectiveProfileTop(i.style, i.profileTop)} onChange={(profileTop) => setInsert({ profileTop })} compact />
        </div>
      );
    }
    case "picker:wavyTop":
      return (
        <div key={path} className="flex flex-col gap-1.5">
          <span className={SUB_LABEL}>Terminación superior</span>
          <SegmentedControl options={[{ value: "open" as const, label: "Abierta" }, { value: "flat" as const, label: "Tapa plana" }]} value={i.wavyTop} onChange={(wavyTop) => setInsert({ wavyTop })} compact />
        </div>
      );
    default:
      return null;
  }
}

/** DIFUSOR: elegir su forma (las compatibles con la familia), 1–3 controles de esa forma y el color. El encastre inferior estándar es el mismo para todas y no se edita. */
function DiffuserSection({ def, onChange, err, status, metrics, onMoreToggle }: SectionProps) {
  const caps = familyCaps(def.shadeType);
  const kind = diffuserKind(def.insert);
  const fit = metrics?.fit ?? null;
  const setInsert = (patch: Partial<LampInsertDef>) => onChange({ ...def, insert: { ...def.insert, ...patch } });
  const deferred = React.useDeferredValue(def);
  const kinds = React.useMemo(() => (def.insert.enabled && caps.diffuser.allowed.length > 1 ? availableDiffuserKinds(deferred) : null), [deferred, def.insert.enabled, caps.diffuser.allowed.length]);
  const controls = DIFFUSER_CONTROLS[kind];
  const more = controls.more.map((path) => <DiffuserControl key={path} path={path} def={def} setInsert={setInsert} err={err} fit={fit} />).filter(Boolean);
  const hasMore = controls.more.length > 0;
  // Calada: el difusor es el dato y la abertura libre de los anillos es su diámetro más la holgura (el motor la resuelve). Es la única medida del difusor de la calada que se ofrece.
  const ringDiameter =
    def.shadeType === "openwork" && def.insert.enabled && def.openwork.diffuserFit === "diameter" ? (
      <div key="ring-diameter" className="flex flex-col gap-1">
        <RangeSlider path="openwork.diffuserDiameterMm" label="Diámetro del difusor" value={def.openwork.diffuserDiameterMm} onChange={(v) => onChange({ ...def, openwork: { ...def.openwork, diffuserDiameterMm: v } })} suffix=" mm" error={err("openwork.diffuserDiameterMm")} />
        <span className="text-[11px] text-gray-500">Entra en una abertura libre de Ø{fmt2(def.openwork.diffuserDiameterMm + def.openwork.diffuserClearanceMm)} mm en los anillos de la pantalla.</span>
      </div>
    ) : null;
  return (
    <>
      <Toggle label={def.shadeType === "double" ? "Agregar un difusor (opcional)" : "Usar difusor"} checked={def.insert.enabled} onChange={(enabled) => setInsert({ enabled })} />
      {caps.diffuser.note && <p className="text-xs text-gray-500">{caps.diffuser.note}</p>}
      {def.insert.enabled && (
        <>
          {caps.diffuser.allowed.length > 1 && (
            <>
              <span className={MAIN_LABEL}>Estilo del difusor</span>
              <div role="radiogroup" aria-label="Estilo del difusor" className="grid grid-cols-3 gap-2">
                {(kinds?.available ?? caps.diffuser.allowed).map((k) => (
                  <DiffuserKindCard key={k} kind={k} def={def} active={kind === k} onSelect={(next) => kind !== next && onChange(applyDiffuserKind(def, next))} />
                ))}
              </div>
              {kinds && <HiddenNote items={kinds.hidden.map((h) => ({ label: DIFFUSER_KIND_LABELS[h.kind], reason: h.reason }))} noun="estilo" />}
            </>
          )}
          <p className="text-xs text-gray-500">{DIFFUSER_KIND_INFO[kind]} Todos entran en la base con el mismo encastre.</p>
          {(controls.main.length > 0 || ringDiameter) && <span className={MAIN_LABEL}>Ajustes del difusor</span>}
          {ringDiameter}
          {controls.main.map((path) => <DiffuserControl key={path} path={path} def={def} setInsert={setInsert} err={err} fit={fit} />)}
          {status}
          {hasMore && more.length > 0 && (
            <Details title="Más ajustes del difusor" id="diffuser-more" onToggle={onMoreToggle}>
              {more}
            </Details>
          )}
          <span className={MAIN_LABEL}>Color de la vista previa</span>
          <div role="radiogroup" aria-label="Color del difusor" className="flex flex-wrap gap-2">
            {INSERT_SWATCHES.map((c) => (
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
          <p className="text-xs text-gray-500">El color es una aproximación visual, no una simulación de la luz.</p>
        </>
      )}
      {!def.insert.enabled && status}
    </>
  );
}

// ================================================================================================ BASE

/** BASE: la mecánica es la estándar validada y está bloqueada. Si el diseño trae otras medidas (diseño anterior), se conservan y se ofrece pasar al estándar con consentimiento. */
function BaseSection({ def, status, onApplyStandard }: { def: LampDefinition; status: React.ReactNode; onApplyStandard: () => void }) {
  const deviations = mechanicalDeviations(def);
  const what = describeDeviations(deviations);
  return (
    <>
      <div className="flex flex-col gap-2 rounded-xl border border-fg/10 bg-fg/[0.03] p-3" data-base-locked>
        <div className="flex items-center gap-2 text-xs font-bold text-gray-200">
          <Lock size={14} aria-hidden="true" />
          Base E27 estándar
        </div>
        <ul className="flex flex-col gap-1 text-xs text-gray-400">
          <li>Alojamiento del portalámparas</li>
          <li>Canal y encastre del difusor</li>
          <li>Rosca de unión con la pantalla</li>
        </ul>
        <p className="text-[11px] text-gray-500">Medidas estándar, fijas para todos los diseños: no hace falta tocarlas. Cambiar la forma de la pantalla o del difusor no las modifica.</p>
        <InfoRow label="Forma exterior de la base" value="Cilíndrica" />
      </div>
      {deviations.length > 0 && (
        <div role="status" data-legacy-mechanics className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          <span className="font-semibold">Este diseño usa medidas anteriores{what.length > 0 ? ` (${what.join(", ")})` : ""}.</span>
          <span className="text-[11px] text-amber-200/80">Se conservan tal cual: no se cambian sin tu permiso. Los diseños nuevos usan el estándar.</span>
          <button type="button" onClick={onApplyStandard} className={accentButton}>
            Usar las medidas estándar
          </button>
        </div>
      )}
      {status}
      <p className="text-[11px] text-gray-500">Pensada para una bombilla LED E27 pequeña tipo gota; la separación se comprueba contra una referencia nominal de Ø{fmt2(def.bulb.diameterMm)} × {fmt2(def.bulb.heightAboveHolderMm)} mm que no está verificada físicamente. Las formas decorativas de la base se agregarán en una versión posterior.</p>
    </>
  );
}

// ================================================================================================ DETALLES TÉCNICOS

function ReportCards({ def, metrics }: { def: LampDefinition; metrics: LampMetrics | null }) {
  const rep = metrics?.openwork ?? null;
  const dw = metrics?.doubleWall ?? null;
  return (
    <>
      {def.shadeType === "openwork" && rep && (
        <div className="flex flex-col gap-1 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
          <InfoRow label="Aberturas" value={`${fmt(rep.aperturePct)} % de la zona calada`} />
          <InfoRow label="Abertura mínima" value={`${fmt(rep.minOpeningMm)} mm`} />
          <InfoRow label="Inclinación máx. de una tira" value={`${fmt(rep.maxStripLeanDeg)}° de la vertical`} />
          {rep.diamondsAround !== null && <InfoRow label="Rombos" value={`${rep.diamondsAround} alrededor · ${rep.diamondRows ?? 0} filas`} />}
          <InfoRow label="Pieza" value={rep.components === 1 ? "Una sola pieza conectada" : `${rep.components} piezas sueltas`} strong={rep.components !== 1} />
          <InfoRow label="Difusor" value={`Ø ${fmt2(def.openwork.diffuserDiameterMm)} en una abertura de Ø ${fmt2(def.openwork.diffuserDiameterMm + def.openwork.diffuserClearanceMm)}`} />
        </div>
      )}
      {def.shadeType === "double" && dw && (
        <div className="flex flex-col gap-1 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
          <InfoRow label="Separación medida entre paredes" value={`${fmt(dw.minGapMm)} mm (exigida ${fmt(dw.requiredGapMm)} mm)`} />
          <InfoRow label="Abertura central (mín. / abajo / arriba)" value={`${fmt(dw.openingMinDiameterMm)} / ${fmt(dw.openingBottomDiameterMm)} / ${fmt(dw.openingTopDiameterMm)} mm`} />
          <InfoRow label="Inclinación máx. de una cara" value={`${fmt(dw.maxLeanDeg)}° de la vertical`} />
          <InfoRow label="Cuerpos / cavidades cerradas" value={`${dw.solidBodies} / ${dw.cavities}`} strong={dw.solidBodies !== 1} />
        </div>
      )}
    </>
  );
}

/** Medidas y holguras calculadas (solo lectura), seguridad y pruebas físicas: consulta secundaria, plegada. */
function TechnicalDetails({ def, metrics, onMoreToggle }: { def: LampDefinition; metrics: LampMetrics | null; onMoreToggle: (open: boolean) => void }) {
  const fit = metrics?.fit ?? null;
  return (
    <Details title="Detalles técnicos y seguridad" id="technical" onToggle={onMoreToggle}>
      <ReportCards def={def} metrics={metrics} />
      <div className="flex flex-col gap-1.5">
        <InfoRow label="Altura total ensamblada" value={metrics ? `${fmt(metrics.totalHeightMm)} mm` : "—"} />
        <InfoRow label="Diámetro máximo" value={metrics ? `Ø ${fmt(metrics.maxDiameterMm)} mm` : "—"} />
        <InfoRow label="Triángulos (todas las piezas)" value={metrics ? String(metrics.totalTriangles) : "—"} />
        {fit?.insertMaxDiameterMm != null && def.insert.enabled && <InfoRow label="Ø máximo del difusor" value={`Ø ${fmt2(fit.insertMaxDiameterMm)} mm`} />}
        {fit?.insertHeightMm != null && def.insert.enabled && <InfoRow label="Altura del difusor" value={`${fmt(fit.insertHeightMm)} mm`} />}
        {fit?.insertEnvelopeGapMm != null && def.insert.enabled && <InfoRow label="Separación mínima a la bombilla (geométrica)" value={`${fmt(fit.insertEnvelopeGapMm)} mm`} />}
      </div>
      {fit && (
        <div className="flex flex-col gap-1 rounded-xl border border-fg/10 bg-fg/[0.03] p-3" aria-label="Holguras del ensamblaje">
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
      <div className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3" aria-label="Seguridad y validación física">
        <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
          <ShieldAlert size={14} aria-hidden="true" />
          Pendiente de validación física
        </div>
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-gray-300">{LAMP_SAFETY_NOTICES.map((t) => <li key={t}>{t}</li>)}</ul>
        <span className={SUB_LABEL}>Medidas que tenés que verificar</span>
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-gray-300">{LAMP_MEASUREMENTS_NEEDED.map((t) => <li key={t}>{t}</li>)}</ul>
        <span className={SUB_LABEL}>Pruebas físicas antes de usarla</span>
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-gray-300">{LAMP_PHYSICAL_TESTS.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
    </Details>
  );
}

// ================================================================================================ PANEL

export interface LampPropertiesPanelProps {
  /** Componente seleccionado en la barra inferior: el panel muestra SOLO sus propiedades. */
  component: EditorComponent;
  def: LampDefinition;
  onChange: (next: LampDefinition) => void;
  errors: LampIssue[];
  warnings: LampIssue[];
  metrics: LampMetrics | null;
  /** Rangos válidos de cada control para el estado actual (restricciones dinámicas) y cuáles todavía se están recalculando. */
  ranges?: Record<string, ControlRange>;
  stale?: ReadonlySet<string>;
  /** true = los valores actuales no se pueden aplicar y el visor muestra la última lámpara válida. */
  outdated?: boolean;
  /** Alguna sección plegable abierta/cerrada: los rangos de sus controles se calculan cuando se abre. */
  onAdvancedToggle?: (open: boolean) => void;
  /** Volver al último diseño sin errores (la página lo recuerda); sin esto no se ofrece. */
  onRestoreLast?: () => void;
  /** Pasar los campos mecánicos de un diseño anterior al estándar (la página pide la confirmación). */
  onApplyStandardMechanics: () => void;
}

function PanelBody({ component, def, onChange, errors, warnings, metrics, ranges = NO_RANGES, stale = NO_STALE, outdated = false, onAdvancedToggle, onRestoreLast, onApplyStandardMechanics }: LampPropertiesPanelProps) {
  const rangeCtx = React.useMemo(() => ({ def, ranges, stale }), [def, ranges, stale]);
  const summary = React.useMemo(() => editorIssueSummary(def, errors, warnings), [def, errors, warnings]);
  const err = (field: string) => fieldMessage(summary, field);

  // Los rangos de los controles plegados se calculan cuando alguna sección plegable se abre.
  const [openSections, setOpenSections] = React.useState<ReadonlySet<string>>(new Set());
  // «Detalles técnicos» solo lee métricas: no pide el cálculo de rangos de los controles avanzados.
  const anyOpen = [...openSections].some((id) => id !== "technical");
  const toggle = (id: string) => (open: boolean) =>
    setOpenSections((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  React.useEffect(() => {
    onAdvancedToggle?.(anyOpen);
  }, [anyOpen, onAdvancedToggle]);
  // Al cambiar de componente o de familia el cuerpo se vuelve a montar (los plegables quedan cerrados): ya no hay secciones abiertas que pidan rangos.
  React.useEffect(() => () => onAdvancedToggle?.(false), [onAdvancedToggle]);

  const handleFix = (fix: IssueFix) => onChange(applyEditorFix(def, fix));
  const status = <LampStatus summary={summary} outdated={outdated} onFix={handleFix} onRestoreLast={onRestoreLast} onReset={() => onChange(resetShade(def))} />;
  const sectionProps: SectionProps = { def, onChange, err, status, metrics, onMoreToggle: toggle(component === "diffuser" ? "diffuser-more" : "shade-more") };

  return (
    <RangeContext.Provider value={rangeCtx}>
      <div className="flex flex-col gap-3" data-panel="properties" data-component={component} data-family={def.shadeType}>
        <SectionLabel>{EDITOR_COMPONENT_LABELS[component]}</SectionLabel>
        {component === "shade" && (def.shadeType === "double" ? <DoubleShade {...sectionProps} /> : def.shadeType === "openwork" ? <OpenworkShade {...sectionProps} /> : <SolidShade {...sectionProps} />)}
        {component === "diffuser" && <DiffuserSection {...sectionProps} />}
        {component === "base" && <BaseSection def={def} status={status} onApplyStandard={onApplyStandardMechanics} />}
        <TechnicalDetails def={def} metrics={metrics} onMoreToggle={toggle("technical")} />
      </div>
    </RangeContext.Provider>
  );
}

/**
 * PANEL DERECHO — propiedades del componente seleccionado. Dos o tres controles principales por familia; el resto, en «Más ajustes». Nunca muestra
 * controles de otra familia ni medidas mecánicas (portalámparas, rosca, tolerancias, encastre y canal del difusor).
 */
export function LampPropertiesPanel(props: LampPropertiesPanelProps) {
  return <PanelBody key={`${props.component}:${props.def.shadeType}`} {...props} />;
}
