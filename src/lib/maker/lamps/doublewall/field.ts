import { doubleWallParams } from "@/lib/maker/lamps/doublewall/params";
import { createDoubleWallSurfaces, measureChamberGap, measureLean, minFluteCurvatureRadius, type DoubleWallParams, type GapReport, type LeanReport } from "@/lib/maker/lamps/doublewall/profiles";
import type { ShadeField } from "@/lib/maker/lamps/shade/surface";
import type { LampDefinition } from "@/lib/maker/lamps/types";

/**
 * Campo de la pantalla de DOBLE PARED para el motor de lámparas (`layout`, validación, cache): es lo mismo que `ShadeField` (alturas,
 * radios libres por fila) más las mediciones propias. La geometría real sale de `buildShade.ts` con las MISMAS superficies
 * (`createDoubleWallSurfaces`) que usa este muestreo.
 *
 * El "radio interior libre" de cada fila es el de la cara de la pared interior que mira al vacío central: es la ABERTURA donde van la
 * bombilla, el portalámparas y el difusor.
 */
export interface DoubleWallField extends ShadeField {
  params: DoubleWallParams;
  /** Radios libres de la abertura central: borde inferior, borde superior y mínimo (cintura). Dimensionan el difusor. */
  ringFree: { bottomR: number; topR: number; structureMinR: number };
  gap: GapReport;
  lean: LeanReport;
  /** Columnas angulares de la pared exterior (las de la rosca y las estrías). */
  columns: number;
}

export function doubleWallKey(def: LampDefinition): string {
  return JSON.stringify([def.shade.heightMm, def.shade.bottomDiameterMm, def.shade.topDiameterMm, def.doubleWall]);
}

export function sampleDoubleWallField(def: LampDefinition): DoubleWallField {
  const p = doubleWallParams(def);
  const H = p.heightMm;
  const surf = createDoubleWallSurfaces(p);
  const nRows = Math.ceil(H) + 1;
  const z = new Float64Array(nRows);
  const minInnerByRow = new Float64Array(nRows);
  let minOuter = Infinity, maxOuter = 0, minInner = Infinity;
  let degenerate = false;
  const per = Math.max(48, p.outer.flutes * 4);
  for (let i = 0; i < nRows; i++) {
    z[i] = (H * i) / (nRows - 1);
    const s = surf(z[i]);
    minInnerByRow[i] = s.rii;
    minInner = Math.min(minInner, s.rii);
    if (!(s.rii > 2) || !(s.rio > s.rii) || !Number.isFinite(s.crest)) degenerate = true;
    for (let j = 0; j < per; j++) {
      const r = s.ro((2 * Math.PI * j) / per);
      minOuter = Math.min(minOuter, r);
      maxOuter = Math.max(maxOuter, r);
      if (!Number.isFinite(r) || r <= s.rii) degenerate = true;
    }
  }
  const gap = measureChamberGap(p);
  const lean = measureLean(p);
  return {
    nTheta: p.outer.flutes * p.samplesPerFlute,
    nRows,
    heightMm: H,
    z,
    outer: new Float64Array(0),
    inner: new Float64Array(0),
    minInnerByRow,
    minOuterRadius: minOuter,
    maxOuterRadius: maxOuter,
    minInnerRadius: minInner,
    maxTiltDeg: lean.maxDeg,
    worstTiltZ: lean.atZ,
    minRidgeRadiusMm: minFluteCurvatureRadius(p),
    twistCellsPerRow: 0,
    degenerate,
    params: p,
    ringFree: { bottomR: surf(0).rii, topR: surf(H).rii, structureMinR: minInner },
    gap,
    lean,
    columns: p.outer.flutes * p.samplesPerFlute,
  };
}
