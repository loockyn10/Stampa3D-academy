import type { LetterSignParams, InstallationAuxPart } from "@/lib/maker/types";
import { circlePolygon } from "@/lib/maker/geometry/backCutouts";
import { contourGroupsToRawPaths, differenceContourGroups } from "@/lib/maker/geometry/offsets";
import { toTriangleSoupData } from "@/lib/maker/geometry/extrudePolygon";
import { getInstallationSettings } from "@/lib/maker/installation/defaults";
import { buildPrismStack, normalizePolygons, type PrismLayer } from "@/lib/maker/installation/prismStack";
import type { InstallationPlan, StandoffMountSettings } from "@/lib/maker/installation/types";

/**
 * Separador de pared imprimible ("wall spacer"): cuerpo cilíndrico de largo
 * `wallSpacingMm` + espiga que encastra en el receptor de la letra, con agujero
 * pasante para el tornillo que lo fija a la pared (diámetro configurable, sin marca
 * hardcodeada) y rebaje opcional para la cabeza. Se imprime con la base contra la
 * cama y la espiga hacia arriba (sin voladizos). Sólido soldado por capas (sin CSG).
 *
 *   pared │████████████ cuerpo (Ø body, largo = separación)
 *         │        ████ espiga (Ø peg) -> entra en el socket de la letra
 */

/** Chaflán de entrada de la espiga (escalonado en 3 pasos). */
export const PEG_CHAMFER_MM = 0.4;
/** La espiga es más corta que el socket: no toca el techo del receptor. */
export const PEG_SEAT_CLEARANCE_MM = 0.4;
/** Profundidad máxima del rebaje de la cabeza del tornillo. */
export const SCREW_HEAD_RECESS_MAX_MM = 3;

export function pegLengthMm(s: StandoffMountSettings): number {
  return Math.max(0.5, s.insertDepthMm - PEG_SEAT_CLEARANCE_MM);
}

export function wallSpacerHeightMm(s: StandoffMountSettings): number {
  return s.wallSpacingMm + pegLengthMm(s);
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10).replace(".", "_");
}

export function wallSpacerFileBaseName(s: StandoffMountSettings): string {
  return `wall-spacer-${fmt(s.bodyDiameterMm)}x${fmt(s.wallSpacingMm)}`;
}

/** Validez de los parámetros del separador; devuelve mensajes de error (vacío = válido). */
export function validateWallSpacer(s: StandoffMountSettings): string[] {
  const errors: string[] = [];
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (![s.wallSpacingMm, s.bodyDiameterMm, s.pegDiameterMm, s.insertDepthMm, s.screwHoleDiameterMm].every(positive)) errors.push("Las medidas del separador deben ser mayores a 0.");
  if (s.clearanceMm < 0 || s.bossWallMm < 0) errors.push("La holgura y el espesor del refuerzo no pueden ser negativos.");
  if (s.pegDiameterMm >= s.bodyDiameterMm) errors.push("La espiga debe ser más angosta que el cuerpo del separador.");
  if (s.screwHoleDiameterMm > s.pegDiameterMm - 1.6) errors.push("El agujero del tornillo es demasiado grande para la espiga (queda menos de 0.8 mm de pared).");
  if (s.screwHeadDiameterMm > 0 && (s.pegDiameterMm - s.screwHeadDiameterMm) / 2 < 0.8) errors.push("El rebaje de la cabeza deja menos de 0.8 mm de pared en la espiga.");
  if (s.screwHeadDiameterMm > 0 && s.screwHeadDiameterMm <= s.screwHoleDiameterMm) errors.push("El rebaje de la cabeza debe ser mayor que el agujero del tornillo.");
  return errors;
}

function annulus(outerD: number, holeD: number) {
  const outer = normalizePolygons([circlePolygon(0, 0, outerD)]);
  return holeD > 0 ? differenceContourGroups(outer, contourGroupsToRawPaths(normalizePolygons([circlePolygon(0, 0, holeD)]))) : outer;
}

/** Malla del separador (centrada en XY, apoyada en Z=0). */
export function buildWallSpacerMesh(s: StandoffMountSettings) {
  const H = s.wallSpacingMm;
  const top = wallSpacerHeightMm(s);
  const recess = s.screwHeadDiameterMm > 0 ? Math.min(SCREW_HEAD_RECESS_MAX_MM, pegLengthMm(s) - 1) : 0;
  const chamferStart = top - PEG_CHAMFER_MM;
  const bounds = new Set<number>([0, H, top]);
  if (recess > 0) bounds.add(top - recess);
  for (let j = 1; j < 3; j++) bounds.add(chamferStart + (PEG_CHAMFER_MM * j) / 3);
  bounds.add(chamferStart);
  const zs = [...bounds].sort((a, b) => a - b);
  const layers: PrismLayer[] = [];
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i], z1 = zs[i + 1];
    if (z1 - z0 < 1e-6) continue;
    const mid = (z0 + z1) / 2;
    const outerD = mid < H ? s.bodyDiameterMm : mid > chamferStart ? s.pegDiameterMm - 2 * (PEG_CHAMFER_MM * ((mid - chamferStart) / PEG_CHAMFER_MM)) : s.pegDiameterMm;
    const holeD = recess > 0 && mid > top - recess ? s.screwHeadDiameterMm : s.screwHoleDiameterMm;
    layers.push({ z0, z1, groups: annulus(outerD, holeD) });
  }
  return toTriangleSoupData(buildPrismStack(layers, { bottomCap: true, topCap: true }));
}

/**
 * Piezas auxiliares del plan: los separadores, AGRUPADOS por geometría (todos
 * iguales => un solo STL + cantidad). Vacío si no hay montaje de separadores o no
 * quedó ningún punto válido.
 */
export function buildInstallationParts(plan: InstallationPlan | null, params: LetterSignParams): InstallationAuxPart[] {
  const settings = getInstallationSettings(params);
  if (!plan || !plan.active || settings.mounting.type !== "standoff") return [];
  const quantity = plan.letters.reduce((n, l) => n + l.mounts.filter((m) => m.valid && m.kind === "standoff").length, 0);
  if (quantity === 0 || validateWallSpacer(settings.mounting.standoff).length > 0) return [];
  return [
    {
      kind: "wallSpacer",
      filenameSuffix: "separador_pared",
      fileBaseName: wallSpacerFileBaseName(settings.mounting.standoff),
      mesh: buildWallSpacerMesh(settings.mounting.standoff),
      quantity,
    },
  ];
}
