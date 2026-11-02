import { shortReason } from "@/lib/maker/lamps/constraints";
import { applyDoubleInnerShape, applyDoubleOuterShape, type DoubleInnerKind, type DoubleOuterKind } from "@/lib/maker/lamps/doublewall/shapes";
import { LAMP_PRESETS, applyLampPreset, type LampPreset } from "@/lib/maker/lamps/presets";
import { applyOpenworkPreset, applySilhouette, type OpenworkPreset } from "@/lib/maker/lamps/openwork/presets";
import type { SilhouetteKind } from "@/lib/maker/lamps/openwork/silhouette";
import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";
import type { LampDefinition } from "@/lib/maker/lamps/types";

/**
 * Disponibilidad de los diseños (presets y siluetas) con las medidas ACTUALES: se aplica el diseño sobre la definición y se pasa por la misma
 * validación que bloquea la exportación. Lo que no produce una geometría válida no se ofrece (y se informa cuántos diseños quedaron fuera y por qué):
 * un preset es una combinación de parámetros, no una promesa independiente de las medidas de montaje.
 */
export interface Availability {
  ok: boolean;
  /** Razón breve del primer error (null si está disponible). */
  reason: string | null;
}

/** Códigos de error que el diseño ya tiene por otras causas: un diseño no se descarta por lo que no introduce él. */
function baseline(def: LampDefinition): Set<string> {
  return new Set(validateLamp(def).errors.map((e) => e.code));
}

function check(base: Set<string>, next: LampDefinition): Availability {
  const errors = validateLamp(next).errors.filter((e) => !base.has(e.code));
  return errors.length === 0 ? { ok: true, reason: null } : { ok: false, reason: shortReason(errors[0]) };
}

export function openworkPresetAvailability(def: LampDefinition, preset: OpenworkPreset, base = baseline(def)): Availability {
  return check(base, applyOpenworkPreset(def, preset));
}

export function lampPresetAvailability(def: LampDefinition, preset: LampPreset, base = baseline(def)): Availability {
  return check(base, applyLampPreset(def, preset));
}

export function silhouetteAvailability(def: LampDefinition, kind: SilhouetteKind, base = baseline(def)): Availability {
  return check(base, applySilhouette(def, kind));
}

/** Diseños calados que producen una geometría válida con las medidas actuales (el resto no se ofrece). */
export function availableOpenworkPresets(def: LampDefinition, presets: readonly OpenworkPreset[]): { available: OpenworkPreset[]; hidden: { preset: OpenworkPreset; reason: string }[] } {
  const base = baseline(def);
  const available: OpenworkPreset[] = [];
  const hidden: { preset: OpenworkPreset; reason: string }[] = [];
  for (const preset of presets) {
    const a = openworkPresetAvailability(def, preset, base);
    if (a.ok) available.push(preset);
    else hidden.push({ preset, reason: a.reason ?? "" });
  }
  return { available, hidden };
}

/** Presets de la pantalla sólida que producen una geometría válida con las medidas actuales. */
export function availableLampPresets(def: LampDefinition): { available: LampPreset[]; hidden: { preset: LampPreset; reason: string }[] } {
  const base = baseline(def);
  const available: LampPreset[] = [];
  const hidden: { preset: LampPreset; reason: string }[] = [];
  for (const preset of LAMP_PRESETS) {
    const a = lampPresetAvailability(def, preset, base);
    if (a.ok) available.push(preset);
    else hidden.push({ preset, reason: a.reason ?? "" });
  }
  return { available, hidden };
}

/**
 * Formas de la doble pared (exterior e interior) que no rompen la separación entre paredes ni la abertura con las medidas actuales. La doble pared valida con
 * el muestreo grueso (`fast`): es solo para decidir qué ofrecer, la exportación siempre valida con el muestreo completo.
 */
export function availableDoubleShapes<K extends string>(def: LampDefinition, kinds: readonly K[], apply: (def: LampDefinition, kind: K) => LampDefinition): { available: K[]; hidden: { kind: K; reason: string }[] } {
  const base = new Set(validateLamp(def, undefined, { fast: true }).errors.map((e) => e.code));
  const available: K[] = [];
  const hidden: { kind: K; reason: string }[] = [];
  for (const kind of kinds) {
    const errors = validateLamp(apply(def, kind), undefined, { fast: true }).errors.filter((e) => !base.has(e.code));
    if (errors.length === 0) available.push(kind);
    else hidden.push({ kind, reason: shortReason(errors[0]) });
  }
  return { available, hidden };
}

export const availableDoubleOuterShapes = (def: LampDefinition, kinds: readonly DoubleOuterKind[]) => availableDoubleShapes(def, kinds, applyDoubleOuterShape);
export const availableDoubleInnerShapes = (def: LampDefinition, kinds: readonly DoubleInnerKind[]) => availableDoubleShapes(def, kinds, applyDoubleInnerShape);
