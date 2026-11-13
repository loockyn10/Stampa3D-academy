import { REFERENCE_DIFFUSER, REFERENCE_PRESS } from "@/lib/maker/lamps/holder/references";
import type { LampAdhesionDef, LampBulbDef, LampCableDef, LampDefinition, LampHolderDef, LampInsertDef, LampThreadDef } from "@/lib/maker/lamps/types";

/**
 * ESTÁNDAR MECÁNICO DE LAS LÁMPARAS E27 (congelado).
 *
 * Son las interfaces físicas que la persona que diseñó el sistema ya imprimió y probó: base con alojamiento del portalámparas (doble anillo), canal de
 * montaje del difusor, encastre inferior del difusor y rosca de unión pantalla–base. Todo diseño NUEVO nace con estos valores y la interfaz del editor
 * NO los expone como controles: ninguna acción del editor (estilos, presets, familias, difusores, variaciones, correcciones) los modifica.
 *
 * Qué NO es:
 *  - No es un recorte del motor: `LampDefinition` conserva todos sus campos y las variantes alternativas (a presión, rosca hembra A y B con patas, collar,
 *    otros portalámparas) siguen existiendo y se leen igual. Un diseño guardado con otras medidas se abre SIN cambiarlas (`mechanicalDeviations`) y solo
 *    pasa al estándar si el usuario lo acepta (`applyStandardMechanics`).
 *  - No es una validación física nueva ni térmica: no se agregó ninguna tolerancia ni se recalculó ningún encastre. Los números son los que ya usaba el
 *    motor (`defaults.ts` los toma de acá) y `tests/maker-lamps-editor-mechanics.test.mjs` los compara contra mediciones del motor ANTERIOR al editor
 *    (`tests/fixtures/lamp-mechanical-baseline.json`) sobre las mallas y los STL exportados.
 *
 * Supuesto a confirmar: el sistema de fijación del portalámparas estándar es el de «doble anillo» (`mount: "rings"`), el que el motor siempre usó por
 * defecto. Los otros tres (a presión, rosca A, rosca B con patas) salen de STL de referencia pero no se asumieron como el estándar de los diseños nuevos.
 * Cambiarlo es cambiar `STANDARD_HOLDER.mount` (y regenerar la línea base, con validación física).
 */

/** Portalámparas E27 y su alojamiento en la torre de la base (doble anillo). `measured` no es una medida: es la marca de «datos de mi portalámparas». */
export const STANDARD_HOLDER: Readonly<LampHolderDef> = Object.freeze({
  mount: "rings",
  pressDepthMm: REFERENCE_PRESS.boreDepthMm,
  measured: false,
  boreDiameterMm: 42,
  ringsDiameterMm: 58,
  ringsClearanceMm: 0.9,
  ringsRecessDepthMm: 5.15,
  seatHeightMm: 31.4,
  bodyDiameterMm: 40,
  heightMm: 55,
});

/** Rosca de unión pantalla–base: propia de StampaMaker (no es la eléctrica E27); la misma para cualquier pantalla. */
export const STANDARD_THREAD: Readonly<LampThreadDef> = Object.freeze({
  connection: "integrated",
  majorDiameterMm: 96,
  pitchMm: 5,
  starts: 2,
  engagementMm: 15,
  clearanceMm: 0.4,
  coreWallMm: 3,
});

/**
 * Encastre inferior y canal de montaje del difusor (diffuser.stl: tubo Ø65,135 con pared de 0,8 mm; ranura de 10 mm de profundidad con 0,35 mm de holgura
 * por lado). El diámetro y el espesor son los del encastre: la forma decorativa nace sobre él con transición de 45° y nunca lo cambia.
 */
export const STANDARD_DIFFUSER_FIT = Object.freeze({
  outerDiameterMm: REFERENCE_DIFFUSER.outerDiameterMm,
  wallMm: 0.8,
  seatDepthMm: 10,
  slotClearanceMm: 0.35,
  minBulbGapMm: 1,
});

/** Reborde interno de adhesión de la pieza roscada y cable/precinto: auxiliares de impresión y montaje, también fijos. */
export const STANDARD_ADHESION: Readonly<LampAdhesionDef> = Object.freeze({ enabled: true, widthMm: 3, heightMm: 0.4 });
export const STANDARD_CABLE: Readonly<LampCableDef> = Object.freeze({ diameterMm: 7, tieAnchor: true });

/**
 * Bombilla de los diseños NUEVOS: LED pequeña tipo gota (Ø30 × 45 mm sobre el portalámparas), la que usan estas lámparas. Los valores anteriores (Ø60 × 85)
 * eran un marcador de posición que rechazaba por separación a la bombilla tres de los cuatro difusores decorativos con sus medidas iniciales. NO es una
 * medida mecánica ni una garantía térmica: define la envolvente contra la que la validación comprueba la separación mínima.
 */
export const STANDARD_BULB: Readonly<LampBulbDef> = Object.freeze({ diameterMm: 30, heightAboveHolderMm: 45 });

/** Valores de los campos mecánicos del difusor dentro de `LampInsertDef` (el resto del difusor es forma decorativa). */
export const STANDARD_INSERT_FIT: Readonly<Pick<LampInsertDef, "thicknessMm" | "clearanceMm" | "seatDepthMm" | "minBulbGapMm">> = Object.freeze({
  thicknessMm: STANDARD_DIFFUSER_FIT.wallMm,
  clearanceMm: STANDARD_DIFFUSER_FIT.slotClearanceMm,
  seatDepthMm: STANDARD_DIFFUSER_FIT.seatDepthMm,
  minBulbGapMm: STANDARD_DIFFUSER_FIT.minBulbGapMm,
});

// ------------------------------------------------------------------ qué campos son mecánicos

/** Rutas de `LampDefinition` que son mecánicas: el editor no las muestra ni las modifica. (`holder.measured` es una marca, no una medida, y no entra.) */
export const MECHANICAL_PATHS: readonly string[] = Object.freeze([
  "holder.mount",
  "holder.pressDepthMm",
  "holder.boreDiameterMm",
  "holder.ringsDiameterMm",
  "holder.ringsClearanceMm",
  "holder.ringsRecessDepthMm",
  "holder.seatHeightMm",
  "holder.bodyDiameterMm",
  "holder.heightMm",
  "thread.connection",
  "thread.majorDiameterMm",
  "thread.pitchMm",
  "thread.starts",
  "thread.engagementMm",
  "thread.clearanceMm",
  "thread.coreWallMm",
  "insert.thicknessMm",
  "insert.clearanceMm",
  "insert.seatDepthMm",
  "insert.minBulbGapMm",
  "adhesion.enabled",
  "adhesion.widthMm",
  "adhesion.heightMm",
  "cable.diameterMm",
  "cable.tieAnchor",
  "base.diameterMm",
]);

const STANDARD_BASE_DIAMETER: number | null = null; // automático: sale de la rosca y del piso

function read(def: LampDefinition, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), def);
}

function standardValue(path: string): unknown {
  const [group, key] = path.split(".");
  switch (group) {
    case "holder":
      return (STANDARD_HOLDER as unknown as Record<string, unknown>)[key];
    case "thread":
      return (STANDARD_THREAD as unknown as Record<string, unknown>)[key];
    case "insert":
      return (STANDARD_INSERT_FIT as unknown as Record<string, unknown>)[key];
    case "adhesion":
      return (STANDARD_ADHESION as unknown as Record<string, unknown>)[key];
    case "cable":
      return (STANDARD_CABLE as unknown as Record<string, unknown>)[key];
    case "base":
      return STANDARD_BASE_DIAMETER;
    default:
      return undefined;
  }
}

function write(def: LampDefinition, path: string, value: unknown): LampDefinition {
  const [group, key] = path.split(".");
  return { ...def, [group]: { ...(def as unknown as Record<string, object>)[group], [key]: value } } as LampDefinition;
}

/** Valores mecánicos de la definición (para compararlos antes/después de una acción del editor). */
export function mechanicalSnapshot(def: LampDefinition): Record<string, unknown> {
  return Object.fromEntries(MECHANICAL_PATHS.map((p) => [p, read(def, p)]));
}

/** Un valor mecánico que no es el del estándar (diseños anteriores, códigos importados). */
export interface MechanicalDeviation {
  path: string;
  value: unknown;
  standard: unknown;
}

const same = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b);

export function mechanicalDeviations(def: LampDefinition): MechanicalDeviation[] {
  return MECHANICAL_PATHS.flatMap((path) => {
    const value = read(def, path);
    const standard = standardValue(path);
    return same(value, standard) ? [] : [{ path, value, standard }];
  });
}

export function usesStandardMechanics(def: LampDefinition): boolean {
  return mechanicalDeviations(def).length === 0;
}

/** Todos los campos mecánicos de `next` se toman de `source`: lo que cambie una acción del editor no puede arrastrar una medida mecánica. */
export function preserveMechanics(source: LampDefinition, next: LampDefinition): LampDefinition {
  return MECHANICAL_PATHS.reduce((acc, path) => (same(read(acc, path), read(source, path)) ? acc : write(acc, path, read(source, path))), next);
}

/** Acción EXPLÍCITA del usuario: lleva los campos mecánicos al estándar validado. Nunca se aplica sola. */
export function applyStandardMechanics(def: LampDefinition): LampDefinition {
  return MECHANICAL_PATHS.reduce((acc, path) => write(acc, path, standardValue(path)), def);
}

/** Descripción breve de lo que difiere del estándar, para decírselo al usuario sin cifras técnicas sueltas. */
export function describeDeviations(deviations: readonly MechanicalDeviation[]): string[] {
  const groups = new Set(deviations.map((d) => d.path.split(".")[0] + (d.path === "thread.connection" ? ".connection" : "")));
  const out: string[] = [];
  if ([...groups].some((g) => g === "holder")) out.push("fijación del portalámparas");
  if ([...groups].some((g) => g === "thread" || g === "thread.connection")) out.push("rosca de unión");
  if (deviations.some((d) => d.path.startsWith("insert."))) out.push("encastre del difusor");
  if (deviations.some((d) => d.path.startsWith("adhesion.") || d.path.startsWith("cable.") || d.path === "base.diameterMm")) out.push("base");
  return out;
}

/** Definición inicial de un diseño NUEVO del editor: base de siempre con el estándar mecánico y la bombilla estándar. */
export function standardBulb(): LampBulbDef {
  return { ...STANDARD_BULB };
}
