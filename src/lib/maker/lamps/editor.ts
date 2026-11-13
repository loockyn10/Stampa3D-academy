import { allowedDiffuserKinds, applyDiffuserKind, diffuserKind, type DiffuserKind } from "@/lib/maker/lamps/capabilities";
import { shortReason } from "@/lib/maker/lamps/constraints";
import { DEFAULT_LAMP } from "@/lib/maker/lamps/defaults";
import { applyDoubleInnerShape, applyDoubleOuterShape, type DoubleInnerKind, type DoubleOuterKind } from "@/lib/maker/lamps/doublewall/shapes";
import { applyFix, resetFamily, summarizeIssues, type FixId, type IssueFix, type IssueSummary, type SummaryItem } from "@/lib/maker/lamps/issuesSummary";
import { preserveMechanics, standardBulb } from "@/lib/maker/lamps/standard";
import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";
import type { LampDefinition, LampIssue, LampShadeType } from "@/lib/maker/lamps/types";

/**
 * Lógica PURA del editor visual de lámparas (`/stampa-maker/lamparas`): qué se ofrece en cada panel y qué acciones pueden cambiar el diseño. No importa React.
 * El editor solo decide la presentación; la geometría, la validación y los rangos siguen siendo los del motor.
 */

/** Diseño NUEVO: el de siempre con la mecánica estándar (`standard.ts`) y la bombilla estándar. Cada preset/estilo parte de una configuración válida. */
export function newLampDesign(): LampDefinition {
  return { ...DEFAULT_LAMP, bulb: standardBulb() };
}

/** Componentes que se pueden seleccionar en la barra inferior: cada uno muestra SUS propiedades en el panel derecho. */
export type EditorComponent = "shade" | "diffuser" | "base";
export const EDITOR_COMPONENT_LABELS: Readonly<Record<EditorComponent, string>> = { shade: "Pantalla", diffuser: "Difusor", base: "Base" };

/**
 * Controles principales de cada familia (siempre visibles en el panel de propiedades de la pantalla): como máximo tres. Todo lo demás está en «Más ajustes»
 * (parámetros geométricos de la forma). Los identificadores `picker:*` son selectores de forma, no numéricos.
 */
export const EDITOR_MAIN_CONTROLS: Readonly<Record<LampShadeType, readonly string[]>> = Object.freeze({
  solid: ["shade.heightMm", "shade.bottomDiameterMm", "shade.amplitudeMm"],
  openwork: ["shade.heightMm", "picker:silhouette", "openwork.density"],
  double: ["picker:outerShape", "picker:innerShape", "doubleWall.minGapMm"],
});

// ------------------------------------------------------------------ estilos de la doble pared (biblioteca)

/** Combinación de forma exterior e interior de la doble pared (la receta de cada una está en `doublewall/shapes.ts`). */
export interface DoubleStyle {
  id: string;
  label: string;
  description: string;
  outer: DoubleOuterKind;
  inner: DoubleInnerKind;
}

export const DOUBLE_STYLES: readonly DoubleStyle[] = [
  { id: "clasica", label: "Clásica", description: "Pared exterior recta y pared interior recta.", outer: "cylinder", inner: "cylinder" },
  { id: "abombada", label: "Abombada", description: "Exterior que se ensancha en el medio sobre un interior recto.", outer: "bulge", inner: "cylinder" },
  { id: "estriada", label: "Estriada", description: "Estrías finas por fuera y una cintura suave por dentro.", outer: "fluted", inner: "hourglass" },
  { id: "ondulada", label: "Ondulada", description: "Ondas anchas por fuera y pared interior cónica.", outer: "wavy", inner: "cone" },
  { id: "torsion", label: "Torsión", description: "Estrías que giran al subir sobre un interior recto.", outer: "twist", inner: "cylinder" },
  { id: "organica", label: "Orgánica", description: "Exterior abombado con un interior de forma libre.", outer: "bulge", inner: "organic" },
];

export function applyDoubleStyle(def: LampDefinition, style: DoubleStyle): LampDefinition {
  return applyDoubleInnerShape(applyDoubleOuterShape(def, style.outer), style.inner);
}

/** Estilos de doble pared que con las medidas actuales respetan la separación entre paredes y la abertura (no se ofrecen los que dan error). Validación gruesa: solo decide qué mostrar. */
export function availableDoubleStyles(def: LampDefinition, styles: readonly DoubleStyle[] = DOUBLE_STYLES): { available: DoubleStyle[]; hidden: { style: DoubleStyle; reason: string }[] } {
  const base = new Set(validateLamp(def, undefined, { fast: true }).errors.map((e) => e.code));
  const available: DoubleStyle[] = [];
  const hidden: { style: DoubleStyle; reason: string }[] = [];
  for (const style of styles) {
    const errors = validateLamp(applyDoubleStyle(def, style), undefined, { fast: true }).errors.filter((e) => !base.has(e.code));
    if (errors.length === 0) available.push(style);
    else hidden.push({ style, reason: shortReason(errors[0]) });
  }
  return { available, hidden };
}

/** ¿Los parámetros actuales son los de este estilo de doble pared? (marca el activo en la biblioteca). */
export function doubleStyleMatches(def: LampDefinition, style: DoubleStyle): boolean {
  if (def.shadeType !== "double") return false;
  const applied = applyDoubleStyle(def, style).doubleWall as unknown as Record<string, unknown>;
  const cur = def.doubleWall as unknown as Record<string, unknown>;
  return Object.keys(applied).every((k) => applied[k] === cur[k]);
}

// ------------------------------------------------------------------ difusores

/** Formas de difusor de la familia que, aplicadas con sus valores iniciales sobre el diseño actual, producen una geometría válida. */
export function availableDiffuserKinds(def: LampDefinition): { available: DiffuserKind[]; hidden: { kind: DiffuserKind; reason: string }[] } {
  const kinds = allowedDiffuserKinds(def);
  const base = new Set(validateLamp(def).errors.map((e) => e.code));
  const current = def.insert.enabled ? diffuserKind(def.insert) : null;
  const available: DiffuserKind[] = [];
  const hidden: { kind: DiffuserKind; reason: string }[] = [];
  for (const kind of kinds) {
    if (kind === current) {
      available.push(kind);
      continue;
    }
    const errors = validateLamp(applyDiffuserKind({ ...def, insert: { ...def.insert, enabled: true } }, kind)).errors.filter((e) => !base.has(e.code));
    if (errors.length === 0) available.push(kind);
    else hidden.push({ kind, reason: shortReason(errors[0]) });
  }
  return { available, hidden };
}

/** Controles de cada forma de difusor: principales (siempre visibles al elegir el difusor) y los que van en «Más ajustes del difusor». Los espesores y holguras del encastre no están: son mecánicos. */
export interface DiffuserControls {
  main: readonly string[];
  more: readonly string[];
}
export const DIFFUSER_CONTROLS: Readonly<Record<DiffuserKind, DiffuserControls>> = Object.freeze({
  cylinder: { main: ["insert.heightMm"], more: [] },
  flat: { main: ["insert.heightMm"], more: [] },
  drop: { main: ["insert.heightMm", "insert.dropClosureMm", "insert.dropCurvaturePct"], more: ["insert.dropTipRadiusMm"] },
  wavy: { main: ["insert.heightMm", "insert.waves", "insert.amplitudeMm"], more: ["insert.twistDeg", "insert.verticalFrequency", "picker:wavyTop"] },
  mossglow: { main: ["insert.heightMm", "insert.profileWidthMm", "insert.profileTopDiameterMm"], more: ["insert.profileCurvaturePct", "picker:profileTop"] },
  tulip: { main: ["insert.heightMm", "insert.profileTopDiameterMm", "insert.profileCurvaturePct"], more: ["picker:profileTop"] },
  hourglass: { main: ["insert.heightMm", "insert.profileWidthMm", "insert.profileWaistPct"], more: ["insert.profileWaistPositionPct", "picker:profileTop"] },
  bell: { main: ["insert.heightMm", "insert.profileWidthMm", "insert.profileCurvaturePct"], more: ["picker:profileTop"] },
});

// ------------------------------------------------------------------ correcciones y avisos

/** Correcciones que cambian una medida mecánica: el editor no las ofrece (solo el botón explícito «Usar las medidas estándar»). */
const MECHANICAL_FIXES: ReadonlySet<FixId> = new Set<FixId>(["raiseThread", "disableAdhesion", "useIntegrated"]);

/** Resumen de errores y avisos para el editor: el del motor, sin las correcciones que tocarían la mecánica. */
export function editorIssueSummary(def: LampDefinition, errors: readonly LampIssue[], warnings: readonly LampIssue[]): IssueSummary {
  const strip = (item: SummaryItem): SummaryItem => (item.fix && MECHANICAL_FIXES.has(item.fix.id) ? { ...item, fix: undefined } : item);
  const s = summarizeIssues(def, errors, warnings);
  const blocking = s.blocking.map(strip);
  return { ...s, blocking, primary: blocking[0] ?? null };
}

/** Aplica una corrección ofrecida por el editor: nunca deja una medida mecánica distinta de la que tenía el diseño. */
export function applyEditorFix(def: LampDefinition, fix: IssueFix): LampDefinition {
  return preserveMechanics(def, applyFix(def, fix));
}

/** «Restablecer esta pantalla»: valores iniciales de la familia sin tocar la mecánica del diseño. */
export function resetShade(def: LampDefinition): LampDefinition {
  return preserveMechanics(def, resetFamily(def));
}
