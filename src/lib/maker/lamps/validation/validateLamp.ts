import { computeLampLayout, type LampLayout } from "@/lib/maker/lamps/layout";
import { LAMP_HOLDER_NOT_VALIDATED_MESSAGE, LAMP_PHYSICAL_VALIDATION_MESSAGE } from "@/lib/maker/lamps/safety";
import { getShadeField } from "@/lib/maker/lamps/shade/cache";
import { minInnerRadiusBetween, type ShadeField } from "@/lib/maker/lamps/shade/surface";
import { LAMP_GEOMETRY, LAMP_LIMITS, type LampDefinition, type LampIssue, type LampLimitKey, type LampVaseReport } from "@/lib/maker/lamps/types";
import type { PrinterProfile } from "@/lib/maker/printBed/printerProfiles";

export interface LampValidation {
  errors: LampIssue[];
  warnings: LampIssue[];
  /** Solo si los parámetros están en rango (sin errores de rango). */
  field: ShadeField | null;
  layout: LampLayout | null;
  vase: LampVaseReport | null;
}

function valueAt(def: LampDefinition, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), def);
}

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** Prerrequisitos GEOMÉTRICOS del modo vaso. Cumplirlos no garantiza el laminado: hay que abrir el STL en el laminador. */
export function vaseReportForShade(field: ShadeField): LampVaseReport {
  const reasons: string[] = [];
  const max = LAMP_GEOMETRY.vaseMaxOverhangDeg;
  if (field.maxTiltDeg > max) {
    reasons.push(`La pared se inclina hasta ${fmt(field.maxTiltDeg)}° respecto de la vertical (a ${fmt(field.worstTiltZ)} mm de altura); el límite usado es ${max}°.`);
  }
  if (field.degenerate) reasons.push("La geometría es degenerada.");
  return { ready: reasons.length === 0, maxOverhangDeg: Math.round(field.maxTiltDeg * 10) / 10, reasons };
}

function checkRanges(def: LampDefinition, errors: LampIssue[]): void {
  for (const key of Object.keys(LAMP_LIMITS) as LampLimitKey[]) {
    const limit = LAMP_LIMITS[key] as { min: number; max: number; integer?: boolean; label: string };
    const v = valueAt(def, key);
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push({ code: "OUT_OF_RANGE", field: key, message: `${limit.label}: ingresá un número.` });
    } else if (v < limit.min || v > limit.max) {
      errors.push({ code: "OUT_OF_RANGE", field: key, message: `${limit.label}: debe estar entre ${fmt(limit.min)} y ${fmt(limit.max)}.` });
    } else if (limit.integer && !Number.isInteger(v)) {
      errors.push({ code: "OUT_OF_RANGE", field: key, message: `${limit.label}: debe ser un número entero.` });
    }
  }
  const optional: { key: string; min: number; max: number; label: string }[] = [
    { key: "insert.diameterMm", min: 40, max: 280, label: "Diámetro del inserto" },
    { key: "base.diameterMm", min: 80, max: 350, label: "Diámetro de la base" },
  ];
  for (const o of optional) {
    const v = valueAt(def, o.key);
    if (v === null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < o.min || v > o.max) errors.push({ code: "OUT_OF_RANGE", field: o.key, message: `${o.label}: debe estar entre ${o.min} y ${o.max} (o automático).` });
  }
}

/**
 * Validación del diseño completo (rangos -> superficie -> encaje -> seguridad). Errores BLOQUEAN el STL; avisos no.
 * Nada acá reduce automáticamente una distancia crítica para que una combinación entre: si no cabe, se informa por qué.
 */
export function validateLamp(def: LampDefinition, printer?: PrinterProfile): LampValidation {
  const errors: LampIssue[] = [];
  const warnings: LampIssue[] = [];
  const g = LAMP_GEOMETRY;

  checkRanges(def, errors);
  if (errors.length === 0 && def.shade.collarHeightMm > def.shade.heightMm * 0.5) {
    errors.push({ code: "COLLAR_TOO_TALL", field: "shade.collarHeightMm", message: "El collar recto no puede superar la mitad de la altura de la pantalla." });
  }
  if (errors.length === 0 && def.holder.nutRecessDiameterMm < def.holder.threadDiameterMm + 8) {
    errors.push({ code: "NUT_RECESS_TOO_SMALL", field: "holder.nutRecessDiameterMm", message: "El alojamiento de la tuerca debe ser al menos 8 mm más ancho que la espiga." });
  }
  warnings.push({ code: "PHYSICAL_VALIDATION_PENDING", message: LAMP_PHYSICAL_VALIDATION_MESSAGE });
  if (!def.holder.measured) warnings.push({ code: "HOLDER_NOT_VALIDATED", field: "holder.measured", message: LAMP_HOLDER_NOT_VALIDATED_MESSAGE });
  if (errors.length > 0) return { errors, warnings, field: null, layout: null, vase: null };

  const field = getShadeField(def.shade);
  const layout = computeLampLayout(def, field);
  const vase = vaseReportForShade(field);
  const { shade, insert, base, holder } = def;

  // ---- Pantalla
  if (field.degenerate) errors.push({ code: "SHADE_DEGENERATE", field: "shade.amplitudeMm", message: "Con estos valores la pantalla se vuelve degenerada (la ondulación se acerca al eje o la pared se pliega). Reducí la amplitud, las ondas o la torsión." });
  if (field.maxTiltDeg > g.hardMaxTiltDeg) errors.push({ code: "SHADE_TOO_STEEP", field: "shade.twistDeg", message: `La pared se inclina ${fmt(field.maxTiltDeg)}° respecto de la vertical: no es imprimible (máximo ${g.hardMaxTiltDeg}°). Reducí la torsión, la amplitud o el cambio de diámetro.` });
  if (field.minRidgeRadiusMm !== null && field.minRidgeRadiusMm < shade.wallMm) errors.push({ code: "SHADE_RIDGE_TOO_SHARP", field: "shade.waves", message: `Las crestas son demasiado agudas (radio ${fmt(field.minRidgeRadiusMm)} mm < espesor ${fmt(shade.wallMm)} mm): la pared se plegaría sobre sí misma. Reducí las ondas o la amplitud.` });
  if (!errors.some((e) => e.code === "SHADE_TOO_STEEP") && !vase.ready) warnings.push({ code: "SHADE_NOT_VASE", message: `Pantalla NO apta para modo vaso: ${vase.reasons[0]} Se imprime de forma convencional y puede necesitar soportes.` });
  if (field.twistCellsPerRow > 4) warnings.push({ code: "SHADE_TWIST_COARSE", field: "shade.twistDeg", message: "La torsión es muy fuerte para la resolución de la malla: las ondas pueden verse facetadas. Reducí la torsión o la cantidad de ondas." });
  if (shade.wallMm < 0.8) warnings.push({ code: "SHADE_WALL_THIN", field: "shade.wallMm", message: "Espesor menor a 0,8 mm: solo apto para modo vaso con un perímetro; en impresión convencional puede quedar frágil." });
  if (printer) {
    if (shade.heightMm > printer.heightMm) warnings.push({ code: "SHADE_TOO_TALL_FOR_PRINTER", message: `La pantalla (${fmt(shade.heightMm)} mm) supera la altura de impresión de ${printer.name} (${printer.heightMm} mm).` });
    if (2 * field.maxOuterRadius > Math.min(printer.widthMm, printer.depthMm)) warnings.push({ code: "SHADE_TOO_WIDE_FOR_PRINTER", message: `La pantalla (Ø ${fmt(2 * field.maxOuterRadius)} mm) supera la cama de ${printer.name}.` });
    if (layout.baseDiameterMm > Math.min(printer.widthMm, printer.depthMm)) warnings.push({ code: "BASE_TOO_WIDE_FOR_PRINTER", message: `La base (Ø ${fmt(layout.baseDiameterMm)} mm) supera la cama de ${printer.name}.` });
  }

  // ---- Bombilla y portalámparas contra la pantalla (sin inserto: la pantalla misma debe respetar la separación de diseño)
  const requiredGap = Math.max(insert.minBulbGapMm, g.bulbGapFloorMm);
  if (!insert.enabled) {
    const envelopeR = Math.max(layout.bulbR, layout.holderR);
    const nearHolder = minInnerRadiusBetween(field, 0, layout.holderTopZ - layout.shadeZ0);
    const nearBulb = minInnerRadiusBetween(field, layout.holderTopZ - layout.shadeZ0, layout.bulbTopZ - layout.shadeZ0);
    if (nearHolder - envelopeR < requiredGap || nearBulb - layout.bulbR < requiredGap) {
      errors.push({ code: "SHADE_TOO_CLOSE_TO_BULB", field: "shade.bottomDiameterMm", message: `La pantalla queda a menos de ${fmt(requiredGap)} mm de la bombilla o del portalámparas. No se reduce la separación automáticamente: agrandá el diámetro o reducí las ondas.` });
    }
  }
  if (layout.bulbTopZ > layout.shadeTopZ) warnings.push({ code: "BULB_EXPOSED", message: "La bombilla sobresale por encima de la pantalla: queda a la vista y puede deslumbrar. Subí la altura de la pantalla." });

  // ---- Inserto
  const ins = layout.insert;
  if (ins) {
    if (ins.heightMm < 30) errors.push({ code: "INSERT_TOO_SHORT", field: "insert.heightPct", message: "El inserto resulta demasiado bajo (menos de 30 mm) para alojar muescas, lengüetas y la pared." });
    if (layout.shadeTopZ - ins.z1 < g.insertTopMarginMm) errors.push({ code: "INSERT_TOO_TALL", field: "insert.heightPct", message: `El inserto llegaría a menos de ${g.insertTopMarginMm} mm del borde de la pantalla.` });
    if (ins.innerR <= 0) errors.push({ code: "INSERT_DEGENERATE", field: "insert.thicknessMm", message: "El espesor del inserto es mayor que su radio." });

    const bothDiameters = `Ø ${fmt(2 * ins.outerR)} mm`;
    if (ins.auto && ins.innerR < layout.fit.requiredInsertInnerRadiusMm) {
      errors.push({
        code: "INSERT_DOES_NOT_FIT",
        field: "insert.minBulbGapMm",
        message: `El inserto no entra: la pantalla deja como máximo un inserto de ${bothDiameters} (interior Ø ${fmt(2 * ins.innerR)} mm) y para respetar ${fmt(requiredGap)} mm a la bombilla/portalámparas hace falta un interior de Ø ${fmt(2 * layout.fit.requiredInsertInnerRadiusMm)} mm. Ensanchá la pantalla o reducí las ondas; no se achica la separación automáticamente.`,
      });
    } else if (!ins.auto) {
      const available = layout.fit.shadeClearRadiusMm ?? 0;
      if (ins.outerR > available + 1e-6) errors.push({ code: "INSERT_TOUCHES_SHADE", field: "insert.diameterMm", message: `El inserto de ${bothDiameters} tocaría o atravesaría la pantalla: el espacio libre máximo (con la holgura y las lengüetas) es Ø ${fmt(2 * available)} mm.` });
      if (ins.innerR < layout.fit.requiredInsertInnerRadiusMm) errors.push({ code: "INSERT_TOO_CLOSE_TO_BULB", field: "insert.diameterMm", message: `El interior del inserto (Ø ${fmt(2 * ins.innerR)} mm) queda a menos de ${fmt(requiredGap)} mm de la bombilla/portalámparas (hace falta Ø ${fmt(2 * layout.fit.requiredInsertInnerRadiusMm)} mm como mínimo).` });
    }
    const holderRecessR = layout.holderR + g.holderFitClearanceMm;
    if (ins.innerR - insert.clearanceMm < holderRecessR + 1.5) errors.push({ code: "HOLDER_COLLIDES_INSERT_SEAT", field: "holder.bodyDiameterMm", message: "El asiento del portalámparas se superpone con la ranura del inserto. Usá un inserto más ancho o un portalámparas más angosto." });
    if (insert.thicknessMm < 0.6) warnings.push({ code: "INSERT_THIN", field: "insert.thicknessMm", message: "Inserto de menos de 0,6 mm: frágil al manipularlo; considerá un espesor mayor salvo que lo imprimas en modo vaso." });
    if (insert.clearanceMm > 1.5) warnings.push({ code: "INSERT_LOOSE", field: "insert.clearanceMm", message: "Holgura mayor a 1,5 mm: el inserto queda flojo en la ranura." });
    if (layout.bulbTopZ > ins.z1) warnings.push({ code: "INSERT_SHORTER_THAN_BULB", message: "El inserto es más bajo que la bombilla: la parte superior de la bombilla no queda cubierta por el color." });
  }

  // ---- Base
  const channelDepth = def.cable.diameterMm + 1;
  if (base.diameterMm !== null && base.diameterMm / 2 < layout.lipOuterR + 4) errors.push({ code: "BASE_TOO_SMALL", field: "base.diameterMm", message: `La base (Ø ${fmt(base.diameterMm)} mm) es demasiado chica para el aro de la pantalla: necesita al menos Ø ${fmt(2 * (layout.lipOuterR + 4))} mm.` });
  if (base.heightMm - Math.max(holder.nutRecessDepthMm, channelDepth) < g.baseMinRoofMm || base.heightMm - g.grooveDepthMm - channelDepth < 5) {
    errors.push({ code: "BASE_TOO_LOW", field: "base.heightMm", message: `La base es demasiado baja para el alojamiento de la tuerca y el canal de cable (quedaría menos de ${g.baseMinRoofMm} mm de material encima). Subí la altura.` });
  }
  if (layout.holderR + g.holderFitClearanceMm + 6 > layout.baseDiameterMm / 2) errors.push({ code: "HOLDER_WIDER_THAN_BASE", field: "holder.bodyDiameterMm", message: "El portalámparas es demasiado ancho para esta base." });
  const maxD = 2 * field.maxOuterRadius;
  if (layout.baseDiameterMm < 0.5 * maxD || layout.baseDiameterMm < 0.3 * layout.shadeTopZ) {
    warnings.push({ code: "BASE_STABILITY", field: "base.diameterMm", message: "La base es angosta respecto de la pantalla y la altura total: la lámpara puede volcar. Es una regla práctica, no un cálculo: verificá la estabilidad con la lámpara montada." });
  }

  return { errors, warnings, field, layout, vase };
}
