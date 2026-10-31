import { mulberry32 } from "@/lib/maker/lamps/random";
import { LAMP_PRESETS, applyLampPreset } from "@/lib/maker/lamps/presets";
import { LAMP_GEOMETRY, LAMP_LIMITS, type LampDefinition, type LampFamily, type LampProfile } from "@/lib/maker/lamps/types";
import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";

/** Pendiente máxima aceptada al generar variaciones: por debajo del límite del modo vaso, para que sean imprimibles sin soportes. */
const VARIATION_MAX_TILT_DEG = LAMP_GEOMETRY.vaseMaxOverhangDeg - 5;
const MAX_ATTEMPTS = 60;

const FAMILIES: LampFamily[] = ["wavy", "spiral", "spiral", "organic", "organic"];
const PROFILES: LampProfile[] = ["straight", "barrel", "barrel", "waist", "bell", "tulip"];

export interface LampVariation {
  def: LampDefinition;
  /** Cuántos candidatos hubo que descartar por geometría inválida (0 = el primero sirvió). */
  rejected: number;
  /** true si ningún candidato pasó y se usó el diseño inicial de reserva. */
  fellBack: boolean;
}

/**
 * Variación REPRODUCIBLE: la misma (definición base, semilla) da siempre exactamente el mismo diseño. Cambia la forma de
 * la pantalla (familia, perfil, diámetro superior, ondas, amplitud, torsión, relieve vertical, orgánica) y conserva
 * altura, diámetro inferior, espesor, inserto, base y portalámparas. Cada candidato pasa por la validación completa
 * (sin autointersecciones, sin crestas que se plieguen, pendiente imprimible, el inserto sigue cabiendo): si no pasa
 * se descarta y se sortea otro con el mismo generador.
 */
export function generateLampVariation(base: LampDefinition, seed: number): LampVariation {
  const rand = mulberry32(seed);
  const range = (a: number, b: number) => a + rand() * (b - a);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length) % list.length];
  const lim = LAMP_LIMITS;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const family = pick(FAMILIES);
    const profile = pick(PROFILES);
    const bottom = base.shade.bottomDiameterMm;
    const topRatio = profile === "bell" || profile === "tulip" ? range(1.1, 1.6) : range(0.8, 1.4);
    const sign = rand() < 0.5 ? -1 : 1;
    const twist = family === "wavy" ? 0 : family === "spiral" ? sign * range(120, 720) : sign * range(0, 300);
    const vertical = rand() < 0.5;
    const candidate: LampDefinition = {
      ...base,
      shade: {
        ...base.shade,
        family,
        profile,
        profileAmountPct: Math.round(profile === "straight" ? 0 : range(25, 80)),
        topDiameterMm: Math.round(Math.min(lim["shade.topDiameterMm"].max, Math.max(lim["shade.topDiameterMm"].min, bottom * topRatio))),
        waves: Math.round(range(4, 20)),
        amplitudeMm: Math.round(range(2, Math.min(11, bottom * 0.09)) * 2) / 2,
        twistDeg: Math.round(twist / 5) * 5,
        verticalFrequency: vertical ? Math.round(range(0.5, 4) * 2) / 2 : 0,
        patternIntensityPct: vertical ? Math.round(range(15, 70)) : 0,
        organicPct: family === "organic" ? Math.round(range(40, 90)) : 0,
        seed,
      },
    };
    const check = validateLamp(candidate);
    if (check.errors.length === 0 && check.field && check.field.maxTiltDeg <= VARIATION_MAX_TILT_DEG) return { def: candidate, rejected: attempt, fellBack: false };
  }
  // Reserva (no debería ocurrir con rangos razonables): un diseño inicial conocido, con la semilla pedida.
  const fallback = applyLampPreset(base, LAMP_PRESETS[0]);
  return { def: { ...fallback, shade: { ...fallback.shade, seed } }, rejected: MAX_ATTEMPTS, fellBack: true };
}
