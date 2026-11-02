import { computeLampLayout, type LampLayout } from "@/lib/maker/lamps/layout";
import { LAMP_ADHESION_UNVERIFIED_MESSAGE, LAMP_CLOSED_INSERT_MESSAGE, LAMP_COLLAR_UNVERIFIED_MESSAGE, LAMP_HOLDER_NOT_VALIDATED_MESSAGE, LAMP_PHYSICAL_VALIDATION_MESSAGE } from "@/lib/maker/lamps/safety";
import { doubleWallIssues } from "@/lib/maker/lamps/doublewall/validate";
import type { DoubleWallField } from "@/lib/maker/lamps/doublewall/field";
import { openworkIssues } from "@/lib/maker/lamps/openwork/validate";
import type { OpenworkField } from "@/lib/maker/lamps/openwork/field";
import { openingFreeDiameters, resolveLampDef } from "@/lib/maker/lamps/resolve";
import { getLampField } from "@/lib/maker/lamps/shade/cache";
import { minInnerRadiusBetween, type ShadeField } from "@/lib/maker/lamps/shade/surface";
import { LAMP_GEOMETRY, LAMP_LIMITS, type LampDefinition, type LampIssue, type LampLimitKey, type LampVaseReport } from "@/lib/maker/lamps/types";
import type { PrinterProfile } from "@/lib/maker/printBed/printerProfiles";

export interface LampValidation {
  /** Definición con lo derivado ya resuelto (p. ej. diámetros de los extremos de la calada en modo "diameter"): es la que usa el resto del motor. */
  resolved: LampDefinition;
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
export function vaseReportForShade(field: ShadeField, connection: "integrated" | "collar" = "collar", notVaseReason: string | false = false): LampVaseReport {
  const reasons: string[] = [];
  if (notVaseReason) reasons.push(notVaseReason);
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
    // Los parámetros de la pantalla calada solo se exigen cuando esa pantalla está activa (los del otro tipo se conservan sin validarse).
    if (key.startsWith("openwork.") && def.shadeType !== "openwork") continue;
    if (key.startsWith("doubleWall.") && def.shadeType !== "double") continue;
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
    { key: "insert.heightMm", min: 30, max: 400, label: "Altura del inserto" },
    { key: "base.diameterMm", min: 80, max: 350, label: "Diámetro de la base" },
  ];
  for (const o of optional) {
    const v = valueAt(def, o.key);
    if (v === null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < o.min || v > o.max) errors.push({ code: "OUT_OF_RANGE", field: o.key, message: `${o.label}: debe estar entre ${o.min} y ${o.max} (o automático).` });
  }
  if (!["flat", "drop", "wavy"].includes(def.insert.style)) errors.push({ code: "OUT_OF_RANGE", field: "insert.style", message: "Estilo del inserto: elegí plano, gota u ondulado." });
  if (def.insert.wavyTop !== "open" && def.insert.wavyTop !== "flat") errors.push({ code: "OUT_OF_RANGE", field: "insert.wavyTop", message: "Terminación del inserto ondulado: abierta o con tapa plana." });
  if (def.thread.connection !== "integrated" && def.thread.connection !== "collar") errors.push({ code: "OUT_OF_RANGE", field: "thread.connection", message: "Unión pantalla–base: elegí rosca integrada o collar roscado." });
}

/**
 * Validación del diseño completo (rangos -> rosca -> superficie -> encaje -> seguridad). Errores BLOQUEAN el STL; avisos no.
 * Nada acá reduce automáticamente una distancia crítica para que una combinación entre: si no cabe, se informa por qué.
 * Todo es GEOMÉTRICO: ningún valor de acá es una distancia o una temperatura segura.
 */
export function validateLamp(input: LampDefinition, printer?: PrinterProfile, opts: { fast?: boolean } = {}): LampValidation {
  const def = resolveLampDef(input);
  const errors: LampIssue[] = [];
  const warnings: LampIssue[] = [];
  const g = LAMP_GEOMETRY;

  checkRanges(def, errors);
  if (def.shadeType !== "solid" && def.shadeType !== "openwork" && def.shadeType !== "double") errors.push({ code: "OUT_OF_RANGE", field: "shadeType", message: "Tipo de pantalla: elegí sólida, calada o doble pared." });
  if (def.shadeType === "double") {
    if (def.doubleWall.chamber !== "closed" && def.doubleWall.chamber !== "open") errors.push({ code: "OUT_OF_RANGE", field: "doubleWall.chamber", message: "Cámara: cerrada o abierta arriba." });
    if (def.doubleWall.fabrication !== "conventional") errors.push({ code: "DW_FABRICATION_UNAVAILABLE", field: "doubleWall.fabrication", message: "El modo jarrón de la doble pared es experimental y no está disponible: solo impresión convencional (docs/STAMPA_MAKER_DOUBLE_WALL.md)." });
  }
  if (def.shadeType === "openwork") {
    if (!["diameter", "rings", "manual"].includes(def.openwork.diffuserFit)) errors.push({ code: "OUT_OF_RANGE", field: "openwork.diffuserFit", message: "Ajuste del difusor: según su diámetro, según los anillos o manual." });
    if (def.openwork.pattern !== "diamond" && def.openwork.pattern !== "spiral") errors.push({ code: "OUT_OF_RANGE", field: "openwork.pattern", message: "Patrón calado: elegí diamante o espiral." });
    if (def.openwork.topFinish !== "ring" && def.openwork.topFinish !== "open") errors.push({ code: "OUT_OF_RANGE", field: "openwork.topFinish", message: "Terminación superior: anillo o abierta." });
  }
  if (errors.length === 0 && def.shadeType === "solid" && def.shade.collarHeightMm > def.shade.heightMm * 0.5) {
    errors.push({ code: "COLLAR_TOO_TALL", field: "shade.collarHeightMm", message: "El tramo recto inferior no puede superar la mitad de la altura de la pantalla." });
  }
  warnings.push({ code: "PHYSICAL_VALIDATION_PENDING", message: LAMP_PHYSICAL_VALIDATION_MESSAGE });
  if (!def.holder.measured) warnings.push({ code: "HOLDER_NOT_VALIDATED", field: "holder.measured", message: LAMP_HOLDER_NOT_VALIDATED_MESSAGE });
  if (errors.length > 0) return { resolved: def, errors, warnings, field: null, layout: null, vase: null };

  const openworkActive = def.shadeType === "openwork";
  const doubleActive = def.shadeType === "double";
  const solidActive = def.shadeType === "solid";
  const field = getLampField(def, opts.fast);
  const layout = computeLampLayout(def, field);
  const vase = vaseReportForShade(
    field,
    def.thread.connection,
    openworkActive ? "La pantalla calada es una estructura de tiras con aberturas: no se imprime en modo vaso (impresión convencional)." : doubleActive ? "La pantalla de doble pared se imprime de forma convencional: el modo jarrón es experimental y no está disponible." : false,
  );
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
  const flareDelta = shade.bottomDiameterMm / 2 - spec.rootR;
  if (openworkActive && thread.connection === "integrated" ? Math.abs(flareDelta) < g.flareMinMm : flareDelta < g.flareMinMm) {
    errors.push({ code: "SHADE_NARROWER_THAN_THREAD", field: "shade.bottomDiameterMm", message: `El diámetro inferior de la pantalla (Ø ${fmt(shade.bottomDiameterMm)} mm) debe superar la raíz de la rosca (Ø ${fmt(2 * spec.rootR)} mm) por al menos ${fmt(2 * g.flareMinMm)} mm para poder hacer la transición de 45°. Ensanchá la pantalla o reducí el diámetro de la rosca.` });
  } else if (openworkActive && thread.connection === "integrated" && flareDelta < 0) {
    warnings.push({ code: "FLARE_INWARD", field: "shade.bottomDiameterMm", message: `Los anillos son más angostos que la raíz de la rosca (Ø ${fmt(2 * spec.rootR)} mm): la transición de 45° entre el cuello y la pantalla va hacia ADENTRO (${fmt(layout.flareH)} mm de alto). Su cara interior es un voladizo de 45°: puede pedir soportes; revisalo en el laminador.` });
  } else if (layout.flareH > g.flareWarnMm) {
    warnings.push({ code: "FLARE_TALL", field: "shade.bottomDiameterMm", message: `La transición de 45° entre la rosca y la pantalla mide ${fmt(layout.flareH)} mm de alto (pantalla mucho más ancha que la rosca). Es un efecto de la geometría; reducí el diámetro inferior si no la querés.` });
  }
  if (thread.connection === "collar") warnings.push({ code: "COLLAR_UNVERIFIED", field: "thread.connection", message: LAMP_COLLAR_UNVERIFIED_MESSAGE });

  // ---- Pantalla calada: estructura, aberturas, imprimibilidad y empalme con la interfaz E27
  if (openworkActive) {
    for (const issue of openworkIssues(def, field as OpenworkField, layout)) (issue.severity === "error" ? errors : warnings).push({ code: issue.code, field: issue.field, message: issue.message });
  }

  // ---- Pantalla de doble pared: separación, uniones, abertura central y montaje
  if (doubleActive) {
    for (const issue of doubleWallIssues(def, field as DoubleWallField, layout)) (issue.severity === "error" ? errors : warnings).push({ code: issue.code, field: issue.field, message: issue.message });
  }

  // ---- Pantalla
  if (solidActive && field.degenerate) errors.push({ code: "SHADE_DEGENERATE", field: "shade.amplitudeMm", message: "Con estos valores la pantalla se vuelve degenerada (la ondulación se acerca al eje o la pared se pliega). Reducí la amplitud, las ondas o la torsión." });
  if (!solidActive && field.degenerate) errors.push({ code: "SHADE_DEGENERATE", field: "openwork.depthMm", message: "Con estos valores la pantalla calada se vuelve degenerada (la silueta se acerca al eje o la profundidad de las tiras supera el radio). Reducí la profundidad o la cintura." });
  if (field.maxTiltDeg > g.hardMaxTiltDeg) errors.push({ code: "SHADE_TOO_STEEP", field: "shade.twistDeg", message: `La pared se inclina ${fmt(field.maxTiltDeg)}° respecto de la vertical: no es imprimible (máximo ${g.hardMaxTiltDeg}°). Reducí la torsión, la amplitud o el cambio de diámetro.` });
  if (solidActive && field.minRidgeRadiusMm !== null && field.minRidgeRadiusMm < shade.wallMm) errors.push({ code: "SHADE_RIDGE_TOO_SHARP", field: "shade.waves", message: `Las crestas son demasiado agudas (radio ${fmt(field.minRidgeRadiusMm)} mm < espesor ${fmt(shade.wallMm)} mm): la pared se plegaría sobre sí misma. Reducí las ondas o la amplitud.` });
  if (solidActive && thread.connection === "collar" && !errors.some((e) => e.code === "SHADE_TOO_STEEP") && !vase.ready) warnings.push({ code: "SHADE_NOT_VASE", message: `Pantalla NO apta para modo vaso: ${vase.reasons[0]} Se imprime de forma convencional y puede necesitar soportes.` });
  if (solidActive && field.twistCellsPerRow > 4) warnings.push({ code: "SHADE_TWIST_COARSE", field: "shade.twistDeg", message: "La torsión es muy fuerte para la resolución de la malla: las ondas pueden verse facetadas. Reducí la torsión o la cantidad de ondas." });
  if (solidActive && shade.wallMm < 0.8) warnings.push({ code: "SHADE_WALL_THIN", field: "shade.wallMm", message: "Espesor menor a 0,8 mm: solo apto para modo vaso con un perímetro; en impresión convencional puede quedar frágil." });
  if (solidActive && thread.connection === "integrated" && shade.wallMm < 1) warnings.push({ code: "SHADE_WALL_THIN_INTEGRATED", field: "shade.wallMm", message: "Con la rosca integrada la pantalla se imprime de forma convencional: una pared de menos de 1 mm es frágil en la transición de 45°." });
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
  const dif = layout.fit.diffuser;
  const diameterMode = dif?.source === "diameter";
  /** Campo que el usuario debe mover cuando el cilindro no cabe: con el difusor como dato, su diámetro; si no, el Ø del inserto. */
  const insField = diameterMode ? "openwork.diffuserDiameterMm" : "insert.diameterMm";
  if (ins && tower.slot) {
    if (ins.heightMm < 30) errors.push({ code: "INSERT_TOO_SHORT", field: insert.heightMm === null ? "insert.heightPct" : "insert.heightMm", message: "El cilindro resulta demasiado bajo (menos de 30 mm) para alojar la ranura de la torre, las lengüetas y la pared." });
    if (layout.shadeTopZ - ins.z1 < g.insertTopMarginMm) errors.push({ code: "INSERT_TOO_TALL", field: insert.heightMm === null ? "insert.heightPct" : "insert.heightMm", message: `El cilindro llegaría a menos de ${g.insertTopMarginMm} mm del borde de la pantalla.` });
    if (ins.innerR <= 0) errors.push({ code: "INSERT_DEGENERATE", field: "insert.thicknessMm", message: "El espesor del cilindro es mayor que su radio." });
    if (tower.slot.bottomZ < layout.floorTopZ + g.towerFloorBelowSlotMm) errors.push({ code: "INSERT_SEAT_TOO_DEEP", field: "insert.seatDepthMm", message: `La ranura del cilindro (${fmt(insert.seatDepthMm)} mm de profundidad) deja menos de ${g.towerFloorBelowSlotMm} mm de material sobre el piso de la base. Reducí la profundidad o subí el apoyo de los anillos.` });
    const innerWall = tower.slot.innerR - tower.recessR;
    if (innerWall < g.towerMinWallMm) {
      errors.push({ code: "TOWER_INNER_WALL_THIN", field: insField, message: `Entre el rebaje de los anillos (Ø ${fmt(2 * tower.recessR)} mm) y la ranura del cilindro (interior Ø ${fmt(2 * tower.slot.innerR)} mm) queda una pared de ${fmt(innerWall)} mm: menos de ${fmt(g.towerMinWallMm)} mm no sostiene. Usá un cilindro más ancho o anillos más chicos; no se achica nada automáticamente.` });
    } else if (innerWall < g.towerWarnWallMm) {
      warnings.push({ code: "TOWER_INNER_WALL_THIN", field: "insert.diameterMm", message: `La pared entre el rebaje de los anillos y la ranura del cilindro mide ${fmt(innerWall)} mm (menos de ${fmt(g.towerWarnWallMm)} mm): es delgada y depende de los perímetros de tu laminador. La lámpara de referencia impresa tiene 1,7 mm. Pendiente de validación física.` });
    }
    const ringsGap = ins.innerR - layout.ringsR;
    if (ringsGap < g.ringsToInsertMinMm) errors.push({ code: "INSERT_TOO_CLOSE_TO_RINGS", field: insField, message: `El interior del cilindro (Ø ${fmt(2 * ins.innerR)} mm) queda a ${fmt(ringsGap)} mm de los anillos del portalámparas (Ø ${fmt(holder.ringsDiameterMm)} mm): hace falta al menos ${fmt(g.ringsToInsertMinMm)} mm.` });

    const bothDiameters = `Ø ${fmt(2 * ins.bodyMaxR)} mm`;
    const available = layout.fit.shadeClearRadiusMm ?? 0;
    if (ins.auto) {
      if (ins.bodyMaxR > available + 1e-6) {
        errors.push({
          code: "INSERT_DOES_NOT_FIT",
          field: "insert.minBulbGapMm",
          message: `El cilindro no entra: para respetar ${fmt(requiredGap)} mm a la bombilla/portalámparas hace falta un cilindro de ${bothDiameters} (interior Ø ${fmt(2 * ins.innerR)} mm) y el cuello o la pantalla dejan como máximo Ø ${fmt(2 * available)} mm. Ensanchá la rosca o la pantalla, o reducí las ondas; no se achica la separación automáticamente.`,
        });
      }
    } else {
      if (ins.bodyMaxR > available + 1e-6 && (dif?.source === "rings" || diameterMode)) {
        errors.push({ code: "DIFFUSER_STRUCTURE_INTRUDES", field: "openwork.diffuserClearanceMm", message: `La estructura calada invade el volumen del difusor: queda libre como máximo Ø ${fmt(2 * available)} mm (con la holgura de montaje) en algún punto del alto del difusor (la cintura o el cuello son más angostos que los anillos) y el difusor mide Ø ${fmt(2 * ins.bodyMaxR)} mm. Ensanchá la cintura de la silueta o aumentá la holgura diametral; no se achica nada automáticamente.` });
      } else if (ins.bodyMaxR > available + 1e-6) errors.push({ code: "INSERT_TOUCHES_SHADE", field: insField, message: `El cilindro de ${bothDiameters} tocaría o atravesaría el cuello o la pantalla: el espacio libre máximo (con la holgura y las lengüetas) es Ø ${fmt(2 * available)} mm.` });
      if (ins.innerR < layout.fit.requiredInsertInnerRadiusMm - 1e-9) errors.push({ code: "INSERT_TOO_CLOSE_TO_BULB", field: insField, message: `El interior del cilindro (Ø ${fmt(2 * ins.innerR)} mm) queda a menos de ${fmt(requiredGap)} mm de la bombilla/portalámparas (hace falta Ø ${fmt(2 * layout.fit.requiredInsertInnerRadiusMm)} mm como mínimo, con los anillos y el cuerpo cargados).` });
    }
    const gap = layout.fit.insertBulbGapMm ?? 0;
    if (gap < g.bulbGapAdvisoryMm && gap >= requiredGap - 1e-9) {
      warnings.push({ code: "INSERT_GAP_UNVALIDATED", field: "insert.diameterMm", message: `Separación radial de ${fmt(gap)} mm entre la bombilla (Ø ${fmt(def.bulb.diameterMm)} mm) y el cilindro: no hay datos para afirmar que la ventilación y la temperatura sean aceptables con esa separación. Combinación PENDIENTE DE VALIDACIÓN FÍSICA con tu bombilla y tu filamento.` });
    }
    if (insert.thicknessMm < 0.6) warnings.push({ code: "INSERT_THIN", field: "insert.thicknessMm", message: "Cilindro de menos de 0,6 mm: frágil al manipularlo; considerá un espesor mayor salvo que lo imprimas en modo vaso." });
    if (insert.clearanceMm > 1.5) warnings.push({ code: "INSERT_LOOSE", field: "insert.clearanceMm", message: "Holgura mayor a 1,5 mm: el cilindro queda flojo en la ranura." });
    for (const issue of ins.surface.issues) (issue.severity === "error" ? errors : warnings).push({ code: issue.code, field: issue.field, message: issue.message });
    // Cierre / tapa: la cara interior (cierre incluido) debe respetar la separación de diseño a la bombilla y al portalámparas
    if (ins.surface.valid && gap < requiredGap - 1e-9 && !errors.some((e) => e.code === "INSERT_TOO_CLOSE_TO_BULB")) {
      errors.push({
        code: "INSERT_CLOSURE_TOUCHES_BULB",
        field: insert.heightMm === null ? "insert.heightPct" : "insert.heightMm",
        message: `La cara interior del inserto (${ins.closedTop ? "tapa o cierre superior incluido" : "pared"}) queda a ${fmt(gap)} mm de la envolvente de la bombilla (Ø ${fmt(def.bulb.diameterMm)} mm, hasta ${fmt(layout.bulbTopZ)} mm de altura): se exigen ${fmt(requiredGap)} mm. Subí la altura del inserto (la bombilla llega a ${fmt(layout.bulbTopZ)} mm sobre la mesa), ensanchá el inserto o acortá el cierre.`,
      });
    }
    if (ins.closedTop) {
      warnings.push({ code: "INSERT_CLOSED_THERMAL_PENDING", field: "insert.style", message: LAMP_CLOSED_INSERT_MESSAGE });
    }
    if (!ins.closedTop && layout.bulbTopZ > ins.z1) warnings.push({ code: "INSERT_SHORTER_THAN_BULB", message: "El cilindro es más bajo que la bombilla: la parte superior de la bombilla no queda cubierta por el color." });
    if (dif) {
      const dcfg = doubleActive ? def.doubleWall : def.openwork;
      const half = dcfg.diffuserClearanceMm / 2;
      if (diameterMode) {
        // La base debe alojar el Ø pedido: no se achica el difusor en silencio ni se toca la rosca; se informa la causa y la rosca mínima.
        const towerLimit = spec.boreR - 3 - g.towerOuterWallMm - insert.clearanceMm;
        if (ins.outerR > towerLimit + 1e-9) {
          const need = dif.minThreadMajorMm;
          errors.push({
            code: "DIFFUSER_EXCEEDS_BASE",
            field: "openwork.diffuserDiameterMm",
            message: `La base no aloja un difusor de Ø ${fmt(2 * ins.outerR)} mm: la torre que lo recibe (ranura de ${fmt(insert.clearanceMm)} mm de holgura y ${fmt(g.towerOuterWallMm)} mm de pared) necesita 3 mm de aire hasta el orificio del cuello roscado (Ø ${fmt(2 * spec.boreR)} mm con una rosca Ø ${fmt(thread.majorDiameterMm)} mm), y eso limita el difusor a Ø ${fmt(2 * towerLimit)} mm${dif.baseLimitDiameterMm < 2 * towerLimit - 1e-6 ? ` (Ø ${fmt(dif.baseLimitDiameterMm)} mm si además se respeta el reborde de adhesión de ${fmt(def.adhesion.widthMm)} mm con 1 mm de holgura)` : ""}. ${need === null ? "Ninguna rosca de hasta Ø200 mm lo aloja: reducí el difusor." : `Subí el diámetro de la rosca de montaje a Ø ${fmt(need)} mm o más${def.adhesion.enabled ? " (con el reborde de adhesión actual)" : ""}, o reducí el difusor.`} No se modifica nada automáticamente.`,
          });
        }
        // La relación pedida: Ø interior libre de CADA anillo = Ø difusor + holgura diametral. Si el motor no la pudo resolver, no se exporta.
        const wanted = def.openwork.diffuserDiameterMm + def.openwork.diffuserClearanceMm;
        const open = openingFreeDiameters(def);
        if (Math.abs(open.bottomMm - wanted) > 0.01 || Math.abs(open.topMm - wanted) > 0.01) {
          errors.push({ code: "DIFFUSER_FIT_UNSOLVED", field: "openwork.diffuserClearanceMm", message: `No se pudo ajustar la abertura de los anillos a Ø ${fmt(wanted)} mm (difusor Ø ${fmt(def.openwork.diffuserDiameterMm)} mm + holgura ${fmt(dcfg.diffuserClearanceMm)} mm): quedan en Ø ${fmt(open.bottomMm)} mm abajo y Ø ${fmt(open.topMm)} mm arriba. Cambiá la profundidad de las tiras, la rosca o el diámetro del difusor.` });
        }
      }
      if (dcfg.diffuserFit === "rings" || diameterMode) {
        if (dif.limitedBy === "base") {
          warnings.push({ code: "DIFFUSER_LIMITED_BY_BASE", field: "thread.majorDiameterMm", message: `El difusor queda en Ø ${fmt(dif.diffuserDiameterMm)} mm limitado por la base y la rosca (la torre que lo aloja necesita al menos 3 mm de aire hasta el orificio del cuello, o el ancho del reborde de adhesión más 1 mm si es mayor: máximo Ø ${fmt(dif.baseLimitDiameterMm)} mm), no por los anillos (Ø ${fmt(dif.ringBottomFreeDiameterMm)} mm abajo, Ø ${fmt(dif.ringTopFreeDiameterMm)} mm arriba). Para un difusor más ancho aumentá el diámetro de la rosca; la base no se modifica sola.` });
        }
        if (doubleActive || diameterMode) {
          // la abertura central ya es el límite (doble pared), o los dos anillos se resuelven al mismo diámetro (modo "diameter"): sin anillos que comparar
        } else if (Math.abs(dif.ringBottomFreeDiameterMm - dif.ringTopFreeDiameterMm) > 4) {
          const wide = dif.ringBottomFreeDiameterMm > dif.ringTopFreeDiameterMm ? "inferior" : "superior";
          warnings.push({ code: "DIFFUSER_RINGS_MISMATCH", field: "openwork.diffuserFit", message: `Los anillos tienen diámetros interiores libres distintos (inferior Ø ${fmt(dif.ringBottomFreeDiameterMm)} mm, superior Ø ${fmt(dif.ringTopFreeDiameterMm)} mm): el difusor es un cilindro rígido y se dimensiona por el más angosto, así que en el anillo ${wide} queda ${fmt(Math.max(dif.radialClearanceBottomMm, dif.radialClearanceTopMm))} mm de holgura radial y no lo centra. Igualá los diámetros de los extremos si querés que ambos anillos lo guíen.` });
        } else if (Math.max(dif.radialClearanceBottomMm, dif.radialClearanceTopMm) > half + 1.5) {
          warnings.push({ code: "DIFFUSER_LOOSE_IN_RING", field: "openwork.diffuserClearanceMm", message: `El difusor queda con ${fmt(Math.max(dif.radialClearanceBottomMm, dif.radialClearanceTopMm))} mm de holgura radial en los anillos (pedido: ${fmt(half)} mm): no los aprovecha y puede bailar. Es una consecuencia de que lo limita la base.` });
        }
        if (def.insert.tabs) warnings.push({ code: "DIFFUSER_TABS_NOT_APPLICABLE", field: "insert.tabs", message: "Las lengüetas de extracción no caben entre el difusor y el anillo: se ignoran. El difusor se retira por la abertura superior agarrándolo del borde." });
      }
      // Recorrido de inserción y extracción: el difusor baja por la abertura superior hasta su asiento y vuelve a salir; debe pasar con la holgura de montaje en TODO el trayecto
      if (!doubleActive && (dif.source === "rings" || diameterMode) && !dif.insertable && dif.ringTopFreeDiameterMm / 2 - ins.bodyMaxR >= insert.clearanceMm - 1e-6 && !errors.some((e) => e.code === "DIFFUSER_STRUCTURE_INTRUDES" || e.code === "INSERT_TOUCHES_SHADE")) {
        errors.push({ code: "DIFFUSER_PATH_BLOCKED", field: doubleActive ? "doubleWall.diffuserClearanceMm" : "openwork.diffuserClearanceMm", message: `El difusor (Ø ${fmt(2 * ins.bodyMaxR)} mm) no podría introducirse ni retirarse: en algún punto del recorrido por la abertura superior la estructura o el cuello roscado dejan libre apenas Ø ${fmt(dif.pathMinFreeDiameterMm)} mm (${fmt(dif.pathClearanceMm)} mm de holgura radial; se exigen ${fmt(insert.clearanceMm)} mm). Ensanchá la cintura o los anillos, o reducí el difusor.` });
      }
      if (dif.ringTopFreeDiameterMm / 2 - ins.bodyMaxR < insert.clearanceMm - 1e-6) {
        errors.push({ code: "DIFFUSER_CANNOT_PASS_TOP", field: doubleActive ? "doubleWall.diffuserClearanceMm" : "openwork.diffuserClearanceMm", message: `El difusor (Ø ${fmt(2 * ins.bodyMaxR)} mm) no pasa por el anillo superior (Ø ${fmt(dif.ringTopFreeDiameterMm)} mm libres): no se podría introducir ni retirar. Reducí el difusor o ensanchá el anillo superior.` });
      }
    }
    if (layout.fit.insertRemovableFromTop === false) warnings.push({ code: "INSERT_NOT_REMOVABLE_FROM_TOP", message: "El cilindro no sale por la abertura superior de la pantalla: para cambiarlo hay que desenroscar la pantalla." });
  }

  // ---- Reborde interno de adhesión (pantalla o collar): el ancho pedido debe dejar la holgura de diseño a la torre y al inserto
  const adhesion = layout.adhesion;
  if (adhesion.enabled) {
    if (adhesion.widthMm > adhesion.availableWidthMm + 1e-9) {
      const nearest = adhesion.limitedBy === "insert" ? "el inserto" : "la torre central";
      errors.push({
        code: "ADHESION_INTERFERES",
        field: "adhesion.widthMm",
        message: `El reborde de adhesión de ${fmt(adhesion.widthMm)} mm interfiere con ${nearest}: entre el orificio del cuello (Ø ${fmt(2 * spec.boreR)} mm) y ${nearest} quedan ${fmt(adhesion.availableWidthMm)} mm libres con ${fmt(g.adhesionClearanceMm)} mm de holgura. Reducí el ancho a ${fmt(Math.max(0, Math.floor(adhesion.availableWidthMm * 10) / 10))} mm o menos, o desactivá la adhesión interna; no se modifica ninguna medida del ensamblaje automáticamente.`,
      });
    }
    warnings.push({ code: "ADHESION_UNVERIFIED", field: "adhesion.enabled", message: LAMP_ADHESION_UNVERIFIED_MESSAGE });
  }

  // ---- Base
  const minBaseR = spec.majorR + spec.clearance + g.baseMinOuterWallMm;
  if (base.diameterMm !== null && base.diameterMm / 2 < minBaseR) errors.push({ code: "BASE_TOO_SMALL", field: "base.diameterMm", message: `La base (Ø ${fmt(base.diameterMm)} mm) deja menos de ${g.baseMinOuterWallMm} mm de pared alrededor de la rosca hembra: necesita al menos Ø ${fmt(2 * minBaseR)} mm.` });
  const maxD = 2 * field.maxOuterRadius;
  if (layout.baseDiameterMm < 0.5 * maxD || layout.baseDiameterMm < 0.3 * layout.shadeTopZ) {
    warnings.push({ code: "BASE_STABILITY", field: "base.diameterMm", message: "La base es angosta respecto de la pantalla y la altura total: la lámpara puede volcar. Es una regla práctica, no un cálculo: verificá la estabilidad con la lámpara montada." });
  }

  // Con el difusor como dato, que la torre no entre en el cuello (y el reborde de adhesión que queda sin lugar) es CONSECUENCIA de un solo hecho que ya se informó con su remedio.
  if (errors.some((e) => e.code === "DIFFUSER_EXCEEDS_BASE")) {
    for (let i = errors.length - 1; i >= 0; i--) if (errors[i].code === "TOWER_TOO_WIDE_FOR_THREAD" || errors[i].code === "ADHESION_INTERFERES") errors.splice(i, 1);
  }

  return { resolved: def, errors, warnings, field, layout, vase };
}
