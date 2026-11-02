import { openworkGrid, openworkRingFree } from "@/lib/maker/lamps/openwork/field";
import { threadSpec } from "@/lib/maker/lamps/threads/lampThread";
import type { LampDefinition, LampShadeDef } from "@/lib/maker/lamps/types";

/**
 * Diámetros EFECTIVOS de la pantalla calada cuando el difusor es el dato (`openwork.diffuserFit = "diameter"`).
 *
 * Relación paramétrica (la misma en el anillo inferior y en el superior, que son los dos puntos de montaje del difusor):
 *
 *   Ø interior LIBRE del anillo = Ø exterior del difusor + holgura diametral
 *
 * El interior libre no es el exterior menos la profundidad de la tira: depende también de la pendiente de la silueta dentro del anillo
 * y, en el extremo inferior con rosca integrada y pantalla más ancha que la raíz, del escalón de la transición de 45°. Por eso los
 * diámetros exteriores de los extremos (`shade.bottomDiameterMm` / `shade.topDiameterMm`) se RESUELVEN numéricamente sobre las mismas filas
 * que usa el motor (`openworkGrid` / `openworkRingFree`), no con una fórmula aparte. La silueta decorativa (Ø máximo, cintura, torsión) no
 * entra en la relación: solo puede expandirse hacia afuera de los extremos.
 *
 * Esta función es PURA y no modifica la definición del usuario: createLamp y validateLamp la aplican al empezar, y el resto del motor
 * (campo, layout, malla) trabaja con la definición resuelta, así que lo que se valida es lo que se malla.
 */

/** Radios libres efectivos (mm) de los dos anillos para unos diámetros de extremos dados. */
export function openworkEffectiveFree(def: LampDefinition, shade: LampShadeDef): { bottomR: number; topR: number } {
  const ow = def.openwork;
  const rf = openworkRingFree(openworkGrid(shade, ow), ow);
  const spec = threadSpec(def.thread);
  const rb = shade.bottomDiameterMm / 2;
  // con la rosca integrada y la pantalla más ancha que la raíz, el escalón de 45° deja el interior libre más angosto que el propio anillo
  const ledgeR = def.thread.connection === "integrated" && rb >= spec.rootR ? rb - ow.depthMm * Math.SQRT2 : Infinity;
  return { bottomR: Math.min(rf.bottomR, ledgeR), topR: rf.topR };
}

const TOLERANCE_MM = 1e-7;
const MAX_PASSES = 24;
const CACHE_SIZE = 24;
const cache = new Map<string, LampShadeDef>();

function solveEnds(def: LampDefinition): LampShadeDef {
  const ow = def.openwork;
  const target = (ow.diffuserDiameterMm + ow.diffuserClearanceMm) / 2;
  let shade: LampShadeDef = { ...def.shade, bottomDiameterMm: 2 * (target + ow.depthMm), topDiameterMm: 2 * (target + ow.depthMm) };
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const free = openworkEffectiveFree(def, shade);
    const eb = target - free.bottomR;
    const et = target - free.topR;
    if (Math.abs(eb) < TOLERANCE_MM && Math.abs(et) < TOLERANCE_MM) break;
    shade = { ...shade, bottomDiameterMm: shade.bottomDiameterMm + 2 * eb, topDiameterMm: shade.topDiameterMm + 2 * et };
  }
  return { ...shade, bottomDiameterMm: Math.round(shade.bottomDiameterMm * 1e6) / 1e6, topDiameterMm: Math.round(shade.topDiameterMm * 1e6) / 1e6 };
}

function isDiameterDriven(def: LampDefinition): boolean {
  return def.shadeType === "openwork" && def.openwork.diffuserFit === "diameter";
}

/**
 * Definición con los diámetros de los extremos resueltos a partir del difusor (pantalla calada en modo "diameter"); cualquier otra
 * definición se devuelve tal cual. Valores no numéricos (todavía sin validar) no se resuelven: los rechaza la validación de rangos.
 */
export function resolveLampDef(def: LampDefinition): LampDefinition {
  if (!isDiameterDriven(def)) return def;
  const ow = def.openwork;
  const finite = [ow.diffuserDiameterMm, ow.diffuserClearanceMm, ow.depthMm, ow.stripWidthMm, def.shade.heightMm, ow.maxDiameterMm].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (!finite || ow.diffuserDiameterMm < 20 || ow.depthMm > 40 || def.shade.heightMm < 20 || def.shade.heightMm > 2000) return def;
  const key = JSON.stringify([def.shade.heightMm, ow, def.thread.majorDiameterMm, def.thread.pitchMm, def.thread.connection]);
  let shade = cache.get(key);
  if (shade) {
    cache.delete(key);
  } else {
    shade = solveEnds(def);
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, shade);
  return { ...def, shade: { ...def.shade, bottomDiameterMm: shade.bottomDiameterMm, topDiameterMm: shade.topDiameterMm } };
}

/** Radios libres efectivos de la definición ya resuelta (para comprobar la relación abertura = difusor + holgura). */
export function openingFreeDiameters(def: LampDefinition): { bottomMm: number; topMm: number } {
  const free = openworkEffectiveFree(def, def.shade);
  return { bottomMm: 2 * free.bottomR, topMm: 2 * free.topR };
}
