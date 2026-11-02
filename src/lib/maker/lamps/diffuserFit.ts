import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";
import type { LampDefinition } from "@/lib/maker/lamps/types";

/**
 * Ayudas del difusor de las pantallas calada y de doble pared (las llama la interfaz; la regla vive en `layout.ts`).
 * Ninguna modifica nada por su cuenta: devuelven una definición nueva que la persona elige aplicar.
 */

/** Diámetro interior LIBRE medido hoy de un anillo (calada) tal como lo ve el difusor, o null si no hay layout. */
function ringFreeDiameter(def: LampDefinition, which: "bottom" | "top"): number | null {
  const fit = validateLamp(def).layout?.fit.diffuser;
  if (!fit) return null;
  return which === "bottom" ? fit.ringBottomFreeDiameterMm : fit.ringTopFreeDiameterMm;
}

/**
 * Fija el diámetro interior libre de un anillo de la pantalla calada (p. ej. 80 mm) moviendo el diámetro del extremo correspondiente
 * (compartido con las otras pantallas): el libre es el del extremo menos la profundidad de las tiras (y, con la transición hacia afuera,
 * el escalón de 45°). Se resuelve numéricamente sobre el mismo cálculo que usa el difusor.
 */
export function setRingFreeDiameter(def: LampDefinition, which: "bottom" | "top", freeMm: number): LampDefinition {
  return solveRing(def, which, freeMm);
}

/** Fija los dos anillos a la vez (la silueta de un extremo depende apenas del otro: se resuelve en dos pasadas). */
export function setRingFreeDiameters(def: LampDefinition, bottomMm: number, topMm: number): LampDefinition {
  let next = def;
  for (let pass = 0; pass < 2; pass++) next = solveRing(solveRing(next, "bottom", bottomMm), "top", topMm);
  return next;
}

function solveRing(def: LampDefinition, which: "bottom" | "top", freeMm: number): LampDefinition {
  const key = which === "bottom" ? "bottomDiameterMm" : "topDiameterMm";
  let next: LampDefinition = { ...def, shade: { ...def.shade, [key]: Math.round((freeMm + 2 * def.openwork.depthMm) * 100) / 100 } };
  for (let i = 0; i < 10; i++) {
    const measured = ringFreeDiameter(next, which);
    if (measured === null || Math.abs(measured - freeMm) < 0.0005) break;
    next = { ...next, shade: { ...next.shade, [key]: Math.round((next.shade[key] + (freeMm - measured)) * 10000) / 10000 } };
  }
  return next;
}

/**
 * Diámetro de la rosca (de montaje) más chico, desde el actual, con el que el difusor deja de estar limitado por la base y pasa a
 * depender de los anillos / de la abertura. null si ya no lo limita la base o no se encuentra hasta Ø200 mm.
 */
export function suggestThreadMajorForDiffuser(def: LampDefinition): number | null {
  const first = validateLamp(def).layout?.fit.diffuser;
  if (first?.source === "diameter") return minThreadMajorForDiffuserDiameter(def);
  if (!first || first.limitedBy !== "base") return null;
  for (let major = Math.ceil(def.thread.majorDiameterMm) + 1; major <= 200; major++) {
    const probe = { ...def, thread: { ...def.thread, majorDiameterMm: major } };
    const fit = validateLamp(probe).layout?.fit.diffuser;
    if (fit && fit.limitedBy !== "base") return major;
  }
  return null;
}

/** Errores de montaje que una rosca más ancha puede resolver: ninguno de estos puede quedar para que la rosca sea una solución. */
const MOUNT_CODES = new Set(["DIFFUSER_EXCEEDS_BASE", "TOWER_TOO_WIDE_FOR_THREAD", "SHADE_NARROWER_THAN_THREAD", "ADHESION_INTERFERES", "TOWER_INNER_WALL_THIN", "DIFFUSER_FIT_UNSOLVED"]);

/**
 * Rosca de montaje (Ø mayor, enteros) más chica desde la cual la base aloja el difusor del modo «por su diámetro» SIN errores de montaje: el mínimo
 * de la torre (`fit.diffuser.minThreadMajorMm`) puede caer en un intervalo donde la transición de 45° con la rosca no cabe, así que se verifica
 * cada candidato con la validación completa. null si no hay ninguna hasta Ø200 mm. No modifica nada: es la propuesta que la persona decide aplicar.
 */
export function minThreadMajorForDiffuserDiameter(def: LampDefinition): number | null {
  const start = validateLamp(def).layout?.fit.diffuser?.minThreadMajorMm;
  if (start === undefined || start === null) return null;
  for (let major = Math.ceil(start); major <= 200; major++) {
    const errors = validateLamp({ ...def, thread: { ...def.thread, majorDiameterMm: major } }).errors;
    if (!errors.some((e) => MOUNT_CODES.has(e.code))) return major;
  }
  return null;
}
