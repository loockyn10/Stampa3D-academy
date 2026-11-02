import type { LampLayout } from "@/lib/maker/lamps/layout";
import type { DoubleWallField } from "@/lib/maker/lamps/doublewall/field";
import { doubleWallZones, measureChamberGap, measureLean, minFluteCurvatureRadius, type DoubleWallParams, type GapReport, type LeanReport } from "@/lib/maker/lamps/doublewall/profiles";
import { LAMP_DOUBLE_WALL_CLOSED_MESSAGE } from "@/lib/maker/lamps/safety";
import { LAMP_GEOMETRY, type LampDefinition } from "@/lib/maker/lamps/types";

export interface DoubleWallIssue {
  code: string;
  message: string;
}

/** Valida los parámetros y la geometría resultante. Devuelve errores (no se exporta) y avisos. Nada se corrige en silencio. */
export function validateDoubleWall(p: DoubleWallParams, pre?: { gap?: GapReport; lean?: LeanReport }): { errors: DoubleWallIssue[]; warnings: DoubleWallIssue[]; gap: GapReport; lean: LeanReport } {
  const errors: DoubleWallIssue[] = [];
  const warnings: DoubleWallIssue[] = [];
  const o = p.outer, i = p.inner;
  const positive = [p.heightMm, p.wallMm, p.minGapMm, o.maxDiameterMm, o.endDiameterMm, i.endDiameterMm, p.rowMm, p.samplesPerFlute, p.innerSegments];
  if (positive.some((v) => !Number.isFinite(v) || v <= 0)) errors.push({ code: "DW_PARAM_RANGE", message: "Altura, espesor, separación, diámetros y resolución deben ser números positivos." });
  if (!Number.isInteger(o.flutes) || o.flutes < 3) errors.push({ code: "DW_FLUTES", message: "Las estrías deben ser un entero ≥ 3." });
  if (errors.length) return { errors, warnings, gap: { minGapMm: NaN, atZ: 0, minRadialGapMm: NaN, minInnerVoidRadiusMm: NaN, topInnerVoidRadiusMm: NaN }, lean: { outerFaceDeg: NaN, innerFaceDeg: NaN, chamberFacesDeg: NaN, maxDeg: NaN, atZ: 0 } };
  if (p.wallMm < 0.8) errors.push({ code: "DW_WALL_THIN", message: "El espesor del modelo (< 0,8 mm) es menor que 2 líneas de 0,4 mm: el laminador puede no reconocer la pared." });
  if (o.maxDiameterMm < o.endDiameterMm) errors.push({ code: "DW_BULGE", message: "El diámetro máximo no puede ser menor que el de los bordes (la pared exterior es abombada)." });
  if (o.fluteAmplitudeMm < 0 || o.fluteAmplitudeMm > 0.2 * o.endDiameterMm / 2) errors.push({ code: "DW_FLUTE_DEPTH", message: "La profundidad de las estrías es negativa o excesiva." });
  const rc = minFluteCurvatureRadius(p);
  if (rc < p.wallMm * 1.5) errors.push({ code: "DW_FLUTE_SHARP", message: `Las crestas de las estrías tienen un radio de curvatura de ${rc.toFixed(2)} mm: con ${p.wallMm} mm de espesor la pared interior del desfase se pliega. Reducí la profundidad o la cantidad de estrías.` });
  if (!Number.isFinite(p.slitMm) || p.slitMm < 0.5 || p.slitMm > 6) errors.push({ code: "DW_SLIT", message: "La abertura posterior debe estar entre 0,5 y 6 mm." });
  if (!(p.floorMm >= 1.2 && p.floorMm <= 10)) errors.push({ code: "DW_FLOOR", message: "El piso que une las paredes debe medir entre 1,2 y 10 mm (menos no es estructural)." });
  if (!(p.roofCapMm >= 1.2 && p.roofCapMm <= 10)) errors.push({ code: "DW_ROOF_CAP", message: "El rim superior debe medir entre 1,2 y 10 mm." });
  if (!(p.topGapMm >= 0.8 && p.topGapMm <= 10)) errors.push({ code: "DW_TOP_GAP", message: "El ancho final de la cámara arriba debe estar entre 0,8 y 10 mm." });
  if (!(p.roofHeightMm >= 8)) errors.push({ code: "DW_ROOF_HEIGHT", message: "La zona de techo debe medir al menos 8 mm para que la inclinación sea razonable." });
  const zones = doubleWallZones(p);
  if (zones.roofStart - zones.floorTop < 20) errors.push({ code: "DW_ZONES", message: `Entre el piso y el arranque del techo quedan ${(zones.roofStart - zones.floorTop).toFixed(1)} mm de paredes rectas (mínimo 20): la altura no alcanza para piso, cámara y techo.` });
  if (errors.length) return { errors, warnings, gap: { minGapMm: NaN, atZ: 0, minRadialGapMm: NaN, minInnerVoidRadiusMm: NaN, topInnerVoidRadiusMm: NaN }, lean: { outerFaceDeg: NaN, innerFaceDeg: NaN, chamberFacesDeg: NaN, maxDeg: NaN, atZ: 0 } };
  const gap = pre?.gap ?? measureChamberGap(p);
  const lean = pre?.lean ?? measureLean(p);
  if (lean.maxDeg > 68) errors.push({ code: "DW_LEAN", message: `Una cara se inclina ${lean.maxDeg.toFixed(1)}° respecto de la vertical a ${lean.atZ.toFixed(0)} mm de altura: no es imprimible. Alargá la zona de techo (roofHeightMm) o reducí la torsión/estrías.` });
  else if (lean.maxDeg > 45) warnings.push({ code: "DW_OVERHANG", message: `Una cara se inclina ${lean.maxDeg.toFixed(1)}° respecto de la vertical (límite orientativo 45°): es un voladizo y puede pedir soportes. Alargá la zona de techo.` });
  if (!(gap.minGapMm >= p.minGapMm)) {
    errors.push({ code: "DW_GAP", message: `La separación mínima medida entre las paredes (estrías incluidas) es ${gap.minGapMm.toFixed(2)} mm a ${gap.atZ.toFixed(0)} mm de altura: menos de los ${p.minGapMm} mm exigidos. Reducí el diámetro de la pared interior o achicá la cintura/estrías; no se corrige automáticamente.` });
  }
  if (gap.minInnerVoidRadiusMm < 15) warnings.push({ code: "DW_VOID_SMALL", message: `El vacío central queda con un radio mínimo de ${gap.minInnerVoidRadiusMm.toFixed(1)} mm: no entra una bombilla ni un portalámparas E27 (esto es solo el experimento de fabricación).` });
  return { errors, warnings, gap, lean };
}

export interface DoubleWallLampIssue extends DoubleWallIssue {
  field?: string;
  severity: "error" | "warning";
}

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/**
 * Validación de la doble pared dentro de la lámpara: las reglas del motor (separación medida sobre las superficies reales, estrías,
 * inclinaciones, zonas) más las del montaje real (cono interior contra el orificio del cuello, unión por rosca integrada, presupuesto
 * de malla) y los avisos de fabricación (cámara cerrada, modo jarrón no disponible, sin validación térmica). Nada se corrige solo.
 */
export function doubleWallIssues(def: LampDefinition, field: DoubleWallField, layout: LampLayout): DoubleWallLampIssue[] {
  const g = LAMP_GEOMETRY;
  const d = def.doubleWall;
  const p = field.params;
  const out: DoubleWallLampIssue[] = [];
  const fieldOf = (code: string): string | undefined =>
    ({
      DW_GAP: "doubleWall.minGapMm",
      DW_FLUTE_SHARP: "doubleWall.fluteAmplitudeMm",
      DW_FLUTE_DEPTH: "doubleWall.fluteAmplitudeMm",
      DW_FLOOR: "doubleWall.floorMm",
      DW_ROOF_CAP: "doubleWall.roofCapMm",
      DW_TOP_GAP: "doubleWall.topGapMm",
      DW_ROOF_HEIGHT: "doubleWall.roofHeightMm",
      DW_ZONES: "doubleWall.roofHeightMm",
      DW_LEAN: "doubleWall.roofHeightMm",
      DW_OVERHANG: "doubleWall.roofHeightMm",
      DW_WALL_THIN: "doubleWall.wallMm",
      DW_FLUTES: "doubleWall.flutes",
    })[code];
  const base = validateDoubleWall(p, { gap: field.gap, lean: field.lean });
  for (const e of base.errors) out.push({ ...e, field: fieldOf(e.code), severity: "error" });
  for (const w of base.warnings) {
    // el vacío central de este experimento se aviso aparte: acá lo validan el difusor y la bombilla
    if (w.code === "DW_VOID_SMALL") continue;
    out.push({ ...w, field: fieldOf(w.code), severity: "warning" });
  }
  if (def.thread.connection === "collar") {
    out.push({ code: "DW_COLLAR_UNSUPPORTED", field: "thread.connection", severity: "error", message: "La pantalla de doble pared se une a la base con la rosca integrada: el collar roscado es para pantallas lisas de modo vaso. Elegí «Rosca en la pantalla»." });
  }
  // cono interior de 45° entre el orificio del cuello y la pared interior: debe caber sobre el reborde de adhesión, dentro del cuello
  const rii0 = field.ringFree.bottomR;
  const coneH = Math.abs(layout.spec.boreR - rii0);
  const adhesionTop = layout.ledgeZ + (layout.adhesion.enabled ? layout.adhesion.heightMm : 0);
  if (layout.decorZ0 - coneH < adhesionTop + 0.5) {
    out.push({ code: "DW_NECK_TOO_SHORT", field: "doubleWall.innerBottomDiameterMm", severity: "error", message: `El cono de 45° entre el orificio del cuello (Ø ${fmt(2 * layout.spec.boreR)} mm) y la pared interior (Ø ${fmt(2 * rii0)} mm libres) mide ${fmt(coneH)} mm y no cabe en el cuello (${fmt(layout.decorZ0 - adhesionTop)} mm sobre el reborde). Acercá el diámetro inferior de la pared interior al del orificio.` });
  }
  // la abertura central debe dejar pasar al menos el portalámparas y la bombilla (la separación a la bombilla la validan el difusor y la envolvente)
  const need = Math.max(layout.bulbR, layout.bodyR) + def.insert.minBulbGapMm;
  if (field.ringFree.structureMinR < need) {
    out.push({ code: "DW_OPENING_TOO_SMALL", field: "doubleWall.innerWaistPct", severity: "error", message: `La abertura central queda con un radio libre de ${fmt(field.ringFree.structureMinR)} mm en la cintura: no deja pasar la bombilla (Ø ${fmt(2 * layout.bulbR)} mm) con ${fmt(def.insert.minBulbGapMm)} mm de separación. Ensanchá la pared interior o suavizá la cintura.` });
  }
  // presupuesto de malla (cuatro lazos): triángulos estimados
  const tri = 2 * (field.columns * (Math.ceil(p.heightMm / p.rowMm) * 2 + 120) + p.innerSegments * Math.ceil(p.heightMm / p.rowMm) * 2);
  if (tri > g.openworkMaxTriangles) out.push({ code: "DW_TOO_HEAVY", field: "doubleWall.flutes", severity: "error", message: `La doble pared tendría unos ${Math.round(tri / 1000)} mil triángulos (máximo ${Math.round(g.openworkMaxTriangles / 1000)} mil): reducí las estrías o la altura.` });
  // cámara cerrada: cavidad interna imprimible solo si el techo se inclina razonablemente; se avisa SIEMPRE
  if (d.chamber === "closed") {
    out.push({ code: "DW_CLOSED_CAVITY", field: "doubleWall.chamber", severity: "warning", message: LAMP_DOUBLE_WALL_CLOSED_MESSAGE + ` Techo inclinado hasta ${fmt(field.lean.maxDeg)}° respecto de la vertical y cielorraso de ${fmt(d.topGapMm)} mm. Con «Abierta arriba» la cámara termina en una ranura y no queda aire encerrado.` });
  }
  out.push({ code: "DW_NOT_THERMAL", field: "shadeType", severity: "warning", message: "Pantalla de doble pared: las dos paredes y la cámara de aire NO son una validación térmica ni eléctrica. El modo jarrón no está disponible (experimental, sin verificar con un laminador): se imprime de forma convencional." });
  return out;
}
