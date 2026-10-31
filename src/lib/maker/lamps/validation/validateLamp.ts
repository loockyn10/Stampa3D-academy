import { computeLampLayout, type LampLayout } from "@/lib/maker/lamps/layout";
import { LAMP_COLLAR_UNVERIFIED_MESSAGE, LAMP_HOLDER_NOT_VALIDATED_MESSAGE, LAMP_PHYSICAL_VALIDATION_MESSAGE } from "@/lib/maker/lamps/safety";
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

/**
 * Prerrequisitos GEOMÉTRICOS del modo vaso. Cumplirlos no garantiza el laminado: hay que abrir el STL en el laminador.
 * La rosca integrada exige paredes macizas, así que solo la unión por collar deja la pantalla lisa y apta para modo vaso.
 */
export function vaseReportForShade(field: ShadeField, connection: "integrated" | "collar" = "collar"): LampVaseReport {
  const reasons: string[] = [];
  const max = LAMP_GEOMETRY.vaseMaxOverhangDeg;
  if (connection === "integrated") reasons.push("La rosca integrada necesita paredes macizas: para modo vaso usá la unión por collar roscado independiente.");
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
  if (def.thread.connection !== "integrated" && def.thread.connection !== "collar") errors.push({ code: "OUT_OF_RANGE", field: "thread.connection", message: "Unión pantalla–base: elegí rosca integrada o collar roscado." });
  if (def.holder.mount !== "stem" && def.holder.mount !== "screws") errors.push({ code: "OUT_OF_RANGE", field: "holder.mount", message: "Fijación del portalámparas: elegí espiga con tuerca o tornillos." });
}

/**
 * Validación del diseño completo (rangos -> rosca -> superficie -> encaje -> seguridad). Errores BLOQUEAN el STL; avisos no.
 * Nada acá reduce automáticamente una distancia crítica para que una combinación entre: si no cabe, se informa por qué.
 * Todo es GEOMÉTRICO: ningún valor de acá es una distancia o una temperatura segura.
 */
export function validateLamp(def: LampDefinition, printer?: PrinterProfile): LampValidation {
  const errors: LampIssue[] = [];
  const warnings: LampIssue[] = [];
  const g = LAMP_GEOMETRY;

  checkRanges(def, errors);
  if (errors.length === 0 && def.shade.collarHeightMm > def.shade.heightMm * 0.5) {
    errors.push({ code: "COLLAR_TOO_TALL", field: "shade.collarHeightMm", message: "El tramo recto inferior no puede superar la mitad de la altura de la pantalla." });
  }
  warnings.push({ code: "PHYSICAL_VALIDATION_PENDING", message: LAMP_PHYSICAL_VALIDATION_MESSAGE });
  if (!def.holder.measured) warnings.push({ code: "HOLDER_NOT_VALIDATED", field: "holder.measured", message: LAMP_HOLDER_NOT_VALIDATED_MESSAGE });
  if (errors.length > 0) return { errors, warnings, field: null, layout: null, vase: null };

  const field = getShadeField(def.shade);
  const layout = computeLampLayout(def, field);
  const vase = vaseReportForShade(field, def.thread.connection);
  const { shade, insert, base, holder, cable, thread } = def;
  const spec = layout.spec;
  const fx = layout.fixing;
  const requiredGap = Math.max(insert.minBulbGapMm, g.bulbGapFloorMm);

  /** Radio interior mínimo de la parte decorativa entre dos z de ensamblado (Infinity si no la alcanza). */
  const decorInner = (zLo: number, zHi: number) => (zHi <= layout.decorZ0 ? Infinity : minInnerRadiusBetween(field, Math.max(0, zLo - layout.decorZ0), zHi - layout.decorZ0));

  // ---- Interfaz roscada
  if (spec.usefulEngagement < 1.5 * spec.pitch) {
    errors.push({ code: "THREAD_ENGAGEMENT_SHORT", field: "thread.engagementMm", message: `La longitud roscada útil (${fmt(spec.usefulEngagement)} mm, sin entrada ni salida del filete) es menor que 1,5 pasos (${fmt(1.5 * spec.pitch)} mm): la unión no sería estable. Aumentá la longitud roscada o reducí el paso.` });
  }
  if (layout.fit.thread.turnsToSeat > 4) warnings.push({ code: "THREAD_MANY_TURNS", field: "thread.starts", message: `Hacen falta ${fmt(layout.fit.thread.turnsToSeat)} vueltas para cerrar la pantalla. Subí las entradas o el paso para que cierre en menos vueltas.` });
  if (shade.bottomDiameterMm / 2 - spec.rootR < g.flareMinMm) {
    errors.push({ code: "SHADE_NARROWER_THAN_THREAD", field: "shade.bottomDiameterMm", message: `El diámetro inferior de la pantalla (Ø ${fmt(shade.bottomDiameterMm)} mm) debe superar la raíz de la rosca (Ø ${fmt(2 * spec.rootR)} mm) por al menos ${fmt(2 * g.flareMinMm)} mm para poder hacer la transición de 45°. Ensanchá la pantalla o reducí el diámetro de la rosca.` });
  } else if (layout.flareH > g.flareWarnMm) {
    warnings.push({ code: "FLARE_TALL", field: "shade.bottomDiameterMm", message: `La transición de 45° entre la rosca y la pantalla mide ${fmt(layout.flareH)} mm de alto (pantalla mucho más ancha que la rosca). Es un efecto de la geometría; reducí el diámetro inferior si no la querés.` });
  }
  if (thread.connection === "collar") warnings.push({ code: "COLLAR_UNVERIFIED", field: "thread.connection", message: LAMP_COLLAR_UNVERIFIED_MESSAGE });

  // ---- Pantalla
  if (field.degenerate) errors.push({ code: "SHADE_DEGENERATE", field: "shade.amplitudeMm", message: "Con estos valores la pantalla se vuelve degenerada (la ondulación se acerca al eje o la pared se pliega). Reducí la amplitud, las ondas o la torsión." });
  if (field.maxTiltDeg > g.hardMaxTiltDeg) errors.push({ code: "SHADE_TOO_STEEP", field: "shade.twistDeg", message: `La pared se inclina ${fmt(field.maxTiltDeg)}° respecto de la vertical: no es imprimible (máximo ${g.hardMaxTiltDeg}°). Reducí la torsión, la amplitud o el cambio de diámetro.` });
  if (field.minRidgeRadiusMm !== null && field.minRidgeRadiusMm < shade.wallMm) errors.push({ code: "SHADE_RIDGE_TOO_SHARP", field: "shade.waves", message: `Las crestas son demasiado agudas (radio ${fmt(field.minRidgeRadiusMm)} mm < espesor ${fmt(shade.wallMm)} mm): la pared se plegaría sobre sí misma. Reducí las ondas o la amplitud.` });
  if (thread.connection === "collar" && !errors.some((e) => e.code === "SHADE_TOO_STEEP") && !vase.ready) warnings.push({ code: "SHADE_NOT_VASE", message: `Pantalla NO apta para modo vaso: ${vase.reasons[0]} Se imprime de forma convencional y puede necesitar soportes.` });
  if (field.twistCellsPerRow > 4) warnings.push({ code: "SHADE_TWIST_COARSE", field: "shade.twistDeg", message: "La torsión es muy fuerte para la resolución de la malla: las ondas pueden verse facetadas. Reducí la torsión o la cantidad de ondas." });
  if (shade.wallMm < 0.8) warnings.push({ code: "SHADE_WALL_THIN", field: "shade.wallMm", message: "Espesor menor a 0,8 mm: solo apto para modo vaso con un perímetro; en impresión convencional puede quedar frágil." });
  if (thread.connection === "integrated" && shade.wallMm < 1) warnings.push({ code: "SHADE_WALL_THIN_INTEGRATED", field: "shade.wallMm", message: "Con la rosca integrada la pantalla se imprime de forma convencional: una pared de menos de 1 mm es frágil en la transición de 45°." });
  if (printer) {
    const printHeight = thread.connection === "collar" ? shade.heightMm : layout.shadeTopZ - layout.ledgeZ;
    if (printHeight > printer.heightMm) warnings.push({ code: "SHADE_TOO_TALL_FOR_PRINTER", message: `La pantalla (${fmt(printHeight)} mm) supera la altura de impresión de ${printer.name} (${printer.heightMm} mm).` });
    if (2 * field.maxOuterRadius > Math.min(printer.widthMm, printer.depthMm)) warnings.push({ code: "SHADE_TOO_WIDE_FOR_PRINTER", message: `La pantalla (Ø ${fmt(2 * field.maxOuterRadius)} mm) supera la cama de ${printer.name}.` });
    if (layout.baseDiameterMm > Math.min(printer.widthMm, printer.depthMm)) warnings.push({ code: "BASE_TOO_WIDE_FOR_PRINTER", message: `La base (Ø ${fmt(layout.baseDiameterMm)} mm) supera la cama de ${printer.name}.` });
    if (layout.collar && 2 * layout.collar.outerWallR > Math.min(printer.widthMm, printer.depthMm)) warnings.push({ code: "COLLAR_TOO_WIDE_FOR_PRINTER", message: `El collar (Ø ${fmt(2 * layout.collar.outerWallR)} mm) supera la cama de ${printer.name}.` });
  }

  // ---- Bombilla y portalámparas contra el cuello y la pantalla (sin inserto, el cuello y la pantalla mismos deben respetar la separación de diseño)
  if (!insert.enabled) {
    const envelopeR = Math.max(layout.bulbR, layout.holderR);
    const nearHolder = Math.min(spec.boreR, decorInner(layout.decorZ0, layout.holderTopZ));
    const nearBulb = Math.min(spec.boreR, decorInner(layout.holderTopZ, layout.bulbTopZ));
    if (nearHolder - envelopeR < requiredGap || nearBulb - layout.bulbR < requiredGap) {
      errors.push({ code: "SHADE_TOO_CLOSE_TO_BULB", field: "shade.bottomDiameterMm", message: `El cuello o la pantalla quedan a menos de ${fmt(requiredGap)} mm de la bombilla o del portalámparas. No se reduce la separación automáticamente: agrandá el diámetro de la rosca o reducí las ondas, o usá un inserto.` });
    }
  }
  if (layout.bulbTopZ > layout.shadeTopZ) warnings.push({ code: "BULB_EXPOSED", message: "La bombilla sobresale por encima de la pantalla: queda a la vista y puede deslumbrar. Subí la altura de la pantalla." });

  // ---- Portalámparas y alojamiento
  if (layout.holderR + 1.5 > spec.boreR) errors.push({ code: "HOLDER_WIDER_THAN_CAVITY", field: "holder.bodyDiameterMm", message: `El portalámparas (Ø ${fmt(holder.bodyDiameterMm)} mm) no entra con holgura en la cavidad de la base (Ø ${fmt(2 * spec.boreR)} mm). Aumentá el diámetro de la rosca o reducí el espesor del cuello.` });
  if (fx.webMm < g.fixingWebMinMm) {
    errors.push({ code: "FIXING_TOO_SHORT", field: "holder.fixingLengthMm", message: `La ${holder.mount === "stem" ? "espiga" : "tornillería"} (${fmt(holder.fixingLengthMm)} mm bajo la cara de apoyo) no llega a atravesar ${fmt(g.fixingWebMinMm)} mm de base más la tuerca (${fmt(holder.nutThicknessMm)} mm) y ${fmt(g.fixingTipMarginMm)} mm de sobrante. Con esas medidas no hay forma de sujetar el portalámparas: medí de nuevo o usá una espiga más larga.` });
  }
  if (holder.nutAcrossFlatsMm < holder.fixingDiameterMm + 1) errors.push({ code: "NUT_SMALLER_THAN_FIXING", field: "holder.nutAcrossFlatsMm", message: "La tuerca (entre caras) debe ser más grande que la espiga o el tornillo." });
  if (holder.mount === "stem" && fx.nutPocketCircumR + 2 > layout.seatR) warnings.push({ code: "NUT_POCKET_WIDE", field: "holder.nutAcrossFlatsMm", message: "El alojamiento de la tuerca queda casi tan ancho como el asiento del portalámparas: el apoyo del faldón sobre la base queda angosto." });
  if (holder.mount === "screws") {
    const half = holder.screwSpacingMm / 2;
    if (half + fx.holeR > holder.bodyDiameterMm / 2) errors.push({ code: "SCREWS_OUTSIDE_BODY", field: "holder.screwSpacingMm", message: "Los tornillos quedan fuera del faldón del portalámparas: revisá la separación entre ejes." });
    if (fx.cableHoleR !== null && half - fx.nutPocketCircumR < fx.cableHoleR + 1.2) errors.push({ code: "SCREWS_OVERLAP", field: "holder.screwSpacingMm", message: "Los alojamientos de las tuercas se superponen con el paso del cable: aumentá la separación entre tornillos o usá una tuerca más chica." });
  }
  if (cable.tieAnchor && !layout.tie) warnings.push({ code: "TIE_ANCHOR_NO_ROOM", field: "cable.tieAnchor", message: "No hay lugar entre el asiento del portalámparas y el inserto para las ranuras del precinto de alivio de tensión: usá otro método de sujeción del cable." });

  // ---- Inserto
  const ins = layout.insert;
  if (ins) {
    if (ins.heightMm < 30) errors.push({ code: "INSERT_TOO_SHORT", field: "insert.heightPct", message: "El inserto resulta demasiado bajo (menos de 30 mm) para alojar muescas, lengüetas y la pared." });
    if (layout.shadeTopZ - ins.z1 < g.insertTopMarginMm) errors.push({ code: "INSERT_TOO_TALL", field: "insert.heightPct", message: `El inserto llegaría a menos de ${g.insertTopMarginMm} mm del borde de la pantalla.` });
    if (ins.innerR <= 0) errors.push({ code: "INSERT_DEGENERATE", field: "insert.thicknessMm", message: "El espesor del inserto es mayor que su radio." });

    const bothDiameters = `Ø ${fmt(2 * ins.outerR)} mm`;
    const available = layout.fit.shadeClearRadiusMm ?? 0;
    if (ins.auto) {
      if (ins.outerR > available + 1e-6) {
        errors.push({
          code: "INSERT_DOES_NOT_FIT",
          field: "insert.minBulbGapMm",
          message: `El inserto no entra: para respetar ${fmt(requiredGap)} mm a la bombilla/portalámparas hace falta un inserto de ${bothDiameters} (interior Ø ${fmt(2 * ins.innerR)} mm) y el cuello o la pantalla dejan como máximo Ø ${fmt(2 * available)} mm. Ensanchá la rosca o la pantalla, o reducí las ondas; no se achica la separación automáticamente.`,
        });
      }
    } else {
      if (ins.outerR > available + 1e-6) errors.push({ code: "INSERT_TOUCHES_SHADE", field: "insert.diameterMm", message: `El inserto de ${bothDiameters} tocaría o atravesaría el cuello o la pantalla: el espacio libre máximo (con la holgura y las lengüetas) es Ø ${fmt(2 * available)} mm.` });
      if (ins.innerR < layout.fit.requiredInsertInnerRadiusMm) errors.push({ code: "INSERT_TOO_CLOSE_TO_BULB", field: "insert.diameterMm", message: `El interior del inserto (Ø ${fmt(2 * ins.innerR)} mm) queda a menos de ${fmt(requiredGap)} mm de la bombilla/portalámparas (hace falta Ø ${fmt(2 * layout.fit.requiredInsertInnerRadiusMm)} mm como mínimo).` });
    }
    if (ins.innerR - insert.clearanceMm < layout.seatR + 1.5) errors.push({ code: "HOLDER_COLLIDES_INSERT_SEAT", field: "holder.bodyDiameterMm", message: "El asiento del portalámparas se superpone con la ranura del inserto. Usá un inserto más ancho o un portalámparas más angosto." });
    if (insert.thicknessMm < 0.6) warnings.push({ code: "INSERT_THIN", field: "insert.thicknessMm", message: "Inserto de menos de 0,6 mm: frágil al manipularlo; considerá un espesor mayor salvo que lo imprimas en modo vaso." });
    if (insert.clearanceMm > 1.5) warnings.push({ code: "INSERT_LOOSE", field: "insert.clearanceMm", message: "Holgura mayor a 1,5 mm: el inserto queda flojo en la ranura." });
    if (layout.bulbTopZ > ins.z1) warnings.push({ code: "INSERT_SHORTER_THAN_BULB", message: "El inserto es más bajo que la bombilla: la parte superior de la bombilla no queda cubierta por el color." });
    if (layout.fit.insertRemovableFromTop === false) warnings.push({ code: "INSERT_NOT_REMOVABLE_FROM_TOP", message: "El inserto no sale por la abertura superior de la pantalla: para cambiarlo hay que desenroscar la pantalla." });
  }

  // ---- Base
  const minBaseR = spec.majorR + spec.clearance + g.baseMinOuterWallMm;
  if (base.diameterMm !== null && base.diameterMm / 2 < minBaseR) errors.push({ code: "BASE_TOO_SMALL", field: "base.diameterMm", message: `La base (Ø ${fmt(base.diameterMm)} mm) deja menos de ${g.baseMinOuterWallMm} mm de pared alrededor de la rosca hembra: necesita al menos Ø ${fmt(2 * minBaseR)} mm.` });
  const maxD = 2 * field.maxOuterRadius;
  if (layout.baseDiameterMm < 0.5 * maxD || layout.baseDiameterMm < 0.3 * layout.shadeTopZ) {
    warnings.push({ code: "BASE_STABILITY", field: "base.diameterMm", message: "La base es angosta respecto de la pantalla y la altura total: la lámpara puede volcar. Es una regla práctica, no un cálculo: verificá la estabilidad con la lámpara montada." });
  }

  return { errors, warnings, field, layout, vase };
}
