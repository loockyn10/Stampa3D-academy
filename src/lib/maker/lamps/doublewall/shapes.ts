import type { LampDefinition } from "@/lib/maker/lamps/types";

/**
 * Recetas de partida de las siluetas de la doble pared. Son los MISMOS parámetros del motor (no modelos aparte) aplicados sobre la
 * definición actual: la forma exterior y la interior se eligen por separado y después se puede ajustar cualquier valor.
 */
export type DoubleOuterKind = "cylinder" | "bulge" | "wavy" | "fluted" | "twist";
export type DoubleInnerKind = "cylinder" | "cone" | "hourglass" | "organic";

export const DOUBLE_OUTER_LABELS: Record<DoubleOuterKind, string> = {
  cylinder: "Cilíndrica",
  bulge: "Abombada",
  wavy: "Ondulada",
  fluted: "Estriada",
  twist: "Con torsión",
};
export const DOUBLE_INNER_LABELS: Record<DoubleInnerKind, string> = {
  cylinder: "Cilíndrica",
  cone: "Cónica",
  hourglass: "Reloj de arena",
  organic: "Orgánica",
};

export function applyDoubleOuterShape(def: LampDefinition, kind: DoubleOuterKind): LampDefinition {
  const ends = Math.max(def.shade.bottomDiameterMm, def.shade.topDiameterMm);
  const base = { ...def.doubleWall };
  const patch: Partial<typeof base> = {};
  switch (kind) {
    case "cylinder":
      Object.assign(patch, { maxDiameterMm: ends, fluteAmplitudeMm: 0, twistDeg: 0 });
      break;
    case "bulge":
      Object.assign(patch, { maxDiameterMm: Math.round((ends * 1.2) / 5) * 5, bulgePositionPct: 50, curvaturePct: 40, fluteAmplitudeMm: Math.min(base.fluteAmplitudeMm, 0) });
      break;
    case "wavy":
      Object.assign(patch, { flutes: 8, fluteAmplitudeMm: 8 });
      break;
    case "fluted":
      Object.assign(patch, { flutes: 24, fluteAmplitudeMm: 3, twistDeg: 0 });
      break;
    case "twist":
      Object.assign(patch, { flutes: 18, fluteAmplitudeMm: 4, twistDeg: 90 });
      break;
  }
  return { ...def, doubleWall: { ...base, ...patch } };
}

export function applyDoubleInnerShape(def: LampDefinition, kind: DoubleInnerKind): LampDefinition {
  const d = def.doubleWall;
  const bottom = d.innerBottomDiameterMm;
  const patch: Partial<typeof d> = {};
  switch (kind) {
    case "cylinder":
      Object.assign(patch, { innerTopDiameterMm: bottom, innerWaistPct: 0, innerOrganicPct: 0 });
      break;
    case "cone":
      Object.assign(patch, { innerTopDiameterMm: Math.round((bottom * 1.2) / 2) * 2, innerWaistPct: 0, innerOrganicPct: 0 });
      break;
    case "hourglass":
      Object.assign(patch, { innerTopDiameterMm: bottom, innerWaistPct: 25, innerWaistPositionPct: 50, innerCurvaturePct: 30, innerOrganicPct: 0 });
      break;
    case "organic":
      Object.assign(patch, { innerTopDiameterMm: bottom, innerWaistPct: 10, innerOrganicPct: 40 });
      break;
  }
  return { ...def, doubleWall: { ...d, ...patch } };
}
