import { LAMP_GEOMETRY, type LampThreadDef } from "@/lib/maker/lamps/types";

/**
 * Rosca de la interfaz pantalla–base: una ÚNICA definición analítica de la que salen el macho, la hembra, las piezas de
 * prueba y las verificaciones. Es la rosca mecánica de StampaMaker, trapecial con flancos a 45° (el flanco inferior no
 * necesita soportes al imprimir en vertical) y NO tiene relación con la rosca eléctrica E27 de la bombilla.
 *
 * Superficie macho (z de ENSAMBLADO, θ antihorario visto desde +Z; rosca derecha):
 *   r(θ, z) = R_raíz + profundidad · a(z) · f( z / paso − entradas · θ / 2π )
 *
 *   f  perfil trapecial normalizado de periodo 1 (1 = cresta, 0 = raíz)
 *   a  rampa de profundidad: nace en 0 en el extremo inferior (entrada que guía el arranque) y vuelve a 0 arriba
 *
 * Superficie hembra (borde del VACÍO; el material de la base está más afuera):
 *   r_h(θ, z) = R_raíz + holgura + profundidad · f( z / paso − entradas · θ / 2π )
 *
 * Como ambas usan la misma fase en z de ensamblado, en la posición de tope la separación radial es EXACTAMENTE la
 * holgura en todo el tramo de profundidad completa, y el giro del tornillo la conserva (simetría helicoidal).
 */

export interface LampThreadSpec {
  /** Radio de la cresta y de la raíz del macho. */
  majorR: number;
  rootR: number;
  /** Radio interior del cuello macho (y de la cavidad de la base debajo del tope). */
  boreR: number;
  depth: number;
  pitch: number;
  starts: number;
  /** Avance por vuelta = paso × entradas. */
  lead: number;
  /** Longitud roscada del macho. */
  length: number;
  rampIn: number;
  rampOut: number;
  clearance: number;
  /** Media meseta de cresta/raíz en fracción del paso. */
  flatHalf: number;
  /** Tramo axial de cada flanco en fracción del paso (= profundidad / paso con flancos a 45°). */
  flankFrac: number;
  /** Profundidad de la hembra (desde el tope hasta la cara superior de la base). */
  femaleDepth: number;
  entryChamfer: number;
  /** Longitud de profundidad completa (sin entrada ni salida). */
  usefulEngagement: number;
  /** Longitud del cuello liso por encima de la rosca hasta el arranque de la transición. */
  neckLength: number;
}

export function threadSpec(t: LampThreadDef): LampThreadSpec {
  const g = LAMP_GEOMETRY;
  const depth = g.threadDepthFrac * t.pitchMm;
  const majorR = t.majorDiameterMm / 2;
  const rootR = majorR - depth;
  const rampIn = g.threadRampInDepths * depth;
  const rampOut = g.threadRampOutDepths * depth;
  const femaleDepth = t.engagementMm + g.threadFemaleRunoutMm;
  return {
    majorR,
    rootR,
    boreR: rootR - t.coreWallMm,
    depth,
    pitch: t.pitchMm,
    starts: Math.max(1, Math.round(t.starts)),
    lead: t.pitchMm * Math.max(1, Math.round(t.starts)),
    length: t.engagementMm,
    rampIn,
    rampOut,
    clearance: t.clearanceMm,
    flatHalf: (1 - 2 * g.threadDepthFrac) / 4,
    flankFrac: g.threadDepthFrac,
    femaleDepth,
    entryChamfer: g.threadEntryChamferMm,
    usefulEngagement: t.engagementMm - rampIn - rampOut,
    neckLength: femaleDepth + g.shadeBaseGapMm,
  };
}

/** Perfil trapecial normalizado, periodo 1: 1 en la cresta (|v| <= flatHalf), 0 en la raíz, flancos lineales. */
export function threadProfile(spec: LampThreadSpec, v: number): number {
  const d = Math.abs(v - Math.round(v));
  if (d <= spec.flatHalf) return 1;
  const f = 1 - (d - spec.flatHalf) / spec.flankFrac;
  return f < 0 ? 0 : f;
}

function phase(spec: LampThreadSpec, theta: number, z: number): number {
  return z / spec.pitch - (spec.starts * theta) / (2 * Math.PI);
}

/** Rampa de profundidad del macho a la altura `zl` medida desde su extremo inferior (0..length). */
export function maleAmplitude(spec: LampThreadSpec, zl: number): number {
  if (zl <= 0 || zl >= spec.length) return 0;
  return Math.min(1, zl / spec.rampIn, (spec.length - zl) / spec.rampOut);
}

/** Radio exterior del cuello macho. `zBottom` es la z de ensamblado de su extremo inferior (el tope). */
export function maleRadius(spec: LampThreadSpec, theta: number, z: number, zBottom: number): number {
  const a = maleAmplitude(spec, z - zBottom);
  if (a === 0) return spec.rootR;
  return spec.rootR + spec.depth * a * threadProfile(spec, phase(spec, theta, z));
}

/**
 * Radio del vacío roscado de la hembra a la altura `z` (entre el tope `zLedge` y la cara superior). Incluye el
 * avellanado de entrada a 45° en el borde superior.
 */
export function femaleVoidRadius(spec: LampThreadSpec, theta: number, z: number, zLedge: number): number {
  const zTop = zLedge + spec.femaleDepth;
  let r = spec.rootR + spec.clearance + spec.depth * threadProfile(spec, phase(spec, theta, z));
  const chamferStart = zTop - spec.entryChamfer;
  if (z > chamferStart) r += z - chamferStart;
  return r;
}

/** Separación radial entre hembra y macho (en el tope) en un punto; si no hay macho allí (fuera de su longitud) usa la raíz. */
export function radialGapAt(spec: LampThreadSpec, theta: number, z: number, zLedge: number): number {
  return femaleVoidRadius(spec, theta, z, zLedge) - maleRadius(spec, theta, z, zLedge);
}

/** Resumen numérico de la rosca (informe y UI). */
export function threadFacts(spec: LampThreadSpec) {
  const normalClearance = spec.clearance * Math.SQRT1_2;
  return {
    leadMm: spec.lead,
    depthMm: spec.depth,
    turnsToSeat: spec.femaleDepth / spec.lead,
    normalClearanceMm: normalClearance,
    axialPlayMm: 2 * spec.clearance,
  };
}
