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
  const tower = layout.tower;
  const requiredGap = insert.minBulbGapMm;

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
    const envelopeR = Math.max(layout.bulbR, layout.bodyR);
    const nearHolder = Math.min(spec.boreR, decorInner(layout.decorZ0, layout.holderTopZ));
    const nearBulb = Math.min(spec.boreR, decorInner(layout.holderTopZ, layout.bulbTopZ));
    if (nearHolder - envelopeR < requiredGap || nearBulb - layout.bulbR < requiredGap) {
      errors.push({ code: "SHADE_TOO_CLOSE_TO_BULB", field: "shade.bottomDiameterMm", message: `El cuello o la pantalla quedan a menos de ${fmt(requiredGap)} mm de la bombilla o del portalámparas. No se reduce la separación automáticamente: agrandá el diámetro de la rosca o reducí las ondas, o usá un inserto.` });
    }
  }
  if (layout.bulbTopZ > layout.shadeTopZ) warnings.push({ code: "BULB_EXPOSED", message: "La bombilla sobresale por encima de la pantalla: queda a la vista y puede deslumbrar. Subí la altura de la pantalla." });

  // ---- Portalámparas de doble anillo y torre de la base
  if (holder.bodyDiameterMm > holder.boreDiameterMm - 1) errors.push({ code: "HOLDER_BODY_WIDER_THAN_BORE", field: "holder.bodyDiameterMm", message: `El cuerpo del portalámparas (Ø ${fmt(holder.bodyDiameterMm)} mm) no pasa por el agujero central (Ø ${fmt(holder.boreDiameterMm)} mm): hace falta al menos 1 mm de holgura diametral.` });
  if (tower.recessR < tower.boreR + 2) errors.push({ code: "RINGS_RECESS_TOO_SMALL", field: "holder.ringsDiameterMm", message: `El rebaje de los anillos (Ø ${fmt(2 * tower.recessR)} mm) debe superar el agujero central (Ø ${fmt(holder.boreDiameterMm)} mm) en al menos 4 mm: no queda apoyo para los anillos.` });
  if (tower.seatZ < layout.floorTopZ + 3) errors.push({ code: "HOLDER_SEAT_TOO_LOW", field: "holder.seatHeightMm", message: `El apoyo de los anillos (${fmt(tower.seatZ)} mm sobre la mesa) queda a menos de 3 mm del piso de la base (${fmt(layout.floorTopZ)} mm): no hay material bajo el apoyo. Subí la altura del apoyo.` });
  if (tower.topZ > layout.baseTopZ) errors.push({ code: "TOWER_ABOVE_BASE", field: "holder.seatHeightMm", message: `La cara superior de la torre (${fmt(tower.topZ)} mm) supera la cara superior de la base (${fmt(layout.baseTopZ)} mm): bajá el apoyo de los anillos o alargá la rosca.` });
  if (tower.towerR + 3 > spec.boreR) errors.push({ code: "TOWER_TOO_WIDE_FOR_THREAD", field: "thread.majorDiameterMm", message: `La torre (Ø ${fmt(2 * tower.towerR)} mm) no deja 3 mm de aire radial hasta el orificio del cuello roscado (Ø ${fmt(2 * spec.boreR)} mm). Aumentá el diámetro de la rosca o usá un cilindro más angosto.` });
  if (cable.tieAnchor && !layout.tie) warnings.push({ code: "TIE_ANCHOR_NO_ROOM", field: "cable.tieAnchor", message: "No hay lugar entre la torre y la pared de la cavidad para las ranuras del precinto de alivio de tensión: usá otro método de sujeción del cable." });

  // ---- Cilindro de color
  const ins = layout.insert;
  if (ins && tower.slot) {
    if (ins.heightMm < 30) errors.push({ code: "INSERT_TOO_SHORT", field: "insert.heightPct", message: "El cilindro resulta demasiado bajo (menos de 30 mm) para alojar la ranura de la torre, las lengüetas y la pared." });
    if (layout.shadeTopZ - ins.z1 < g.insertTopMarginMm) errors.push({ code: "INSERT_TOO_TALL", field: "insert.heightPct", message: `El cilindro llegaría a menos de ${g.insertTopMarginMm} mm del borde de la pantalla.` });
    if (ins.innerR <= 0) errors.push({ code: "INSERT_DEGENERATE", field: "insert.thicknessMm", message: "El espesor del cilindro es mayor que su radio." });
    if (tower.slot.bottomZ < layout.floorTopZ + g.towerFloorBelowSlotMm) errors.push({ code: "INSERT_SEAT_TOO_DEEP", field: "insert.seatDepthMm", message: `La ranura del cilindro (${fmt(insert.seatDepthMm)} mm de profundidad) deja menos de ${g.towerFloorBelowSlotMm} mm de material sobre el piso de la base. Reducí la profundidad o subí el apoyo de los anillos.` });
    const innerWall = tower.slot.innerR - tower.recessR;
    if (innerWall < g.towerMinWallMm) {
      errors.push({ code: "TOWER_INNER_WALL_THIN", field: "insert.diameterMm", message: `Entre el rebaje de los anillos (Ø ${fmt(2 * tower.recessR)} mm) y la ranura del cilindro (interior Ø ${fmt(2 * tower.slot.innerR)} mm) queda una pared de ${fmt(innerWall)} mm: menos de ${fmt(g.towerMinWallMm)} mm no sostiene. Usá un cilindro más ancho o anillos más chicos; no se achica nada automáticamente.` });
    } else if (innerWall < g.towerWarnWallMm) {
      warnings.push({ code: "TOWER_INNER_WALL_THIN", field: "insert.diameterMm", message: `La pared entre el rebaje de los anillos y la ranura del cilindro mide ${fmt(innerWall)} mm (menos de ${fmt(g.towerWarnWallMm)} mm): es delgada y depende de los perímetros de tu laminador. La lámpara de referencia impresa tiene 1,7 mm. Pendiente de validación física.` });
    }
    const ringsGap = ins.innerR - layout.ringsR;
    if (ringsGap < g.ringsToInsertMinMm) errors.push({ code: "INSERT_TOO_CLOSE_TO_RINGS", field: "insert.diameterMm", message: `El interior del cilindro (Ø ${fmt(2 * ins.innerR)} mm) queda a ${fmt(ringsGap)} mm de los anillos del portalámparas (Ø ${fmt(holder.ringsDiameterMm)} mm): hace falta al menos ${fmt(g.ringsToInsertMinMm)} mm.` });

    const bothDiameters = `Ø ${fmt(2 * ins.outerR)} mm`;
    const available = layout.fit.shadeClearRadiusMm ?? 0;
    if (ins.auto) {
      if (ins.outerR > available + 1e-6) {
        errors.push({
          code: "INSERT_DOES_NOT_FIT",
          field: "insert.minBulbGapMm",
          message: `El cilindro no entra: para respetar ${fmt(requiredGap)} mm a la bombilla/portalámparas hace falta un cilindro de ${bothDiameters} (interior Ø ${fmt(2 * ins.innerR)} mm) y el cuello o la pantalla dejan como máximo Ø ${fmt(2 * available)} mm. Ensanchá la rosca o la pantalla, o reducí las ondas; no se achica la separación automáticamente.`,
        });
      }
    } else {
      if (ins.outerR > available + 1e-6) errors.push({ code: "INSERT_TOUCHES_SHADE", field: "insert.diameterMm", message: `El cilindro de ${bothDiameters} tocaría o atravesaría el cuello o la pantalla: el espacio libre máximo (con la holgura y las lengüetas) es Ø ${fmt(2 * available)} mm.` });
      if (ins.innerR < layout.fit.requiredInsertInnerRadiusMm - 1e-9) errors.push({ code: "INSERT_TOO_CLOSE_TO_BULB", field: "insert.diameterMm", message: `El interior del cilindro (Ø ${fmt(2 * ins.innerR)} mm) queda a menos de ${fmt(requiredGap)} mm de la bombilla/portalámparas (hace falta Ø ${fmt(2 * layout.fit.requiredInsertInnerRadiusMm)} mm como mínimo, con los anillos y el cuerpo cargados).` });
    }
    const gap = layout.fit.insertBulbGapMm ?? 0;
    if (gap < g.bulbGapAdvisoryMm && gap >= requiredGap - 1e-9) {
      warnings.push({ code: "INSERT_GAP_UNVALIDATED", field: "insert.diameterMm", message: `Separación radial de ${fmt(gap)} mm entre la bombilla (Ø ${fmt(def.bulb.diameterMm)} mm) y el cilindro: no hay datos para afirmar que la ventilación y la temperatura sean aceptables con esa separación. Combinación PENDIENTE DE VALIDACIÓN FÍSICA con tu bombilla y tu filamento.` });
    }
    if (insert.thicknessMm < 0.6) warnings.push({ code: "INSERT_THIN", field: "insert.thicknessMm", message: "Cilindro de menos de 0,6 mm: frágil al manipularlo; considerá un espesor mayor salvo que lo imprimas en modo vaso." });
    if (insert.clearanceMm > 1.5) warnings.push({ code: "INSERT_LOOSE", field: "insert.clearanceMm", message: "Holgura mayor a 1,5 mm: el cilindro queda flojo en la ranura." });
    if (layout.bulbTopZ > ins.z1) warnings.push({ code: "INSERT_SHORTER_THAN_BULB", message: "El cilindro es más bajo que la bombilla: la parte superior de la bombilla no queda cubierta por el color." });
    if (layout.fit.insertRemovableFromTop === false) warnings.push({ code: "INSERT_NOT_REMOVABLE_FROM_TOP", message: "El cilindro no sale por la abertura superior de la pantalla: para cambiarlo hay que desenroscar la pantalla." });
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
