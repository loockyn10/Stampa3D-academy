import { planMugBody } from "@/lib/maker/mugs/body/createMugBody";
import { planHandleAttachments } from "@/lib/maker/mugs/handle/createHandle";
import type { Artwork } from "@/lib/maker/mugs/decorations/artwork";
import { validateDecorationInputs, validateDecorationPlacement } from "@/lib/maker/mugs/decorations/validateDecorations";
import type { MugDecoration, MugDefinition, MugIssue } from "@/lib/maker/mugs/types";
import type { PrinterProfile } from "@/lib/maker/printBed/printerProfiles";

export interface MugValidation {
  /** Bloquean la generación / exportación. */
  errors: MugIssue[];
  /** Avisos de imprimibilidad: nunca bloquean. */
  warnings: MugIssue[];
}

const fin = (v: number) => Number.isFinite(v);

/**
 * Valida una MugDefinition ANTES de generar geometría. Errores = combinaciones físicamente inválidas (no hay malla
 * posible); warnings = imprimibilidad simple (Stampa no es un slicer). Mensajes en español, listos para la UI.
 */
export function validateMug(def: MugDefinition, printer?: PrinterProfile, artworkOf?: (d: MugDecoration) => Artwork | null): MugValidation {
  const errors: MugIssue[] = [];
  const warnings: MugIssue[] = [];
  const err = (code: string, message: string, field?: string) => errors.push({ code, message, field });
  const warn = (code: string, message: string, field?: string) => warnings.push({ code, message, field });
  const range = (field: string, label: string, v: number, min: number, max: number, unit = "mm") => {
    if (!fin(v) || v < min || v > max) err("RANGE", `${label} debe estar entre ${min} y ${max} ${unit}.`, field);
  };

  const insert = def.mode === "insert-shell";
  range("wallThicknessMm", insert ? "El espesor de la carcasa" : "El espesor de pared", def.wallThicknessMm, 0.4, 20);
  range("bottomThicknessMm", insert ? "El espesor de la base de soporte" : "El espesor de base", def.bottomThicknessMm, 0.4, 30);
  if (fin(def.wallThicknessMm) && def.wallThicknessMm <= 0) err("WALL", "El espesor de pared debe ser mayor que 0.", "wallThicknessMm");
  if (fin(def.bottomThicknessMm) && def.bottomThicknessMm <= 0) err("BOTTOM", "El espesor de base debe ser mayor que 0.", "bottomThicknessMm");
  if (insert) {
    range("insert.heightMm", "La altura del inserto", def.insert.heightMm, 20, 300);
    range("insert.topDiameterMm", "El diámetro superior del inserto", def.insert.topDiameterMm, 20, 250);
    range("insert.bottomDiameterMm", "El diámetro inferior del inserto", def.insert.bottomDiameterMm, 20, 250);
    if (fin(def.insert.clearanceMm) && def.insert.clearanceMm < 0) err("CLEARANCE", "La holgura del inserto no puede ser negativa.", "insert.clearanceMm");
    else range("insert.clearanceMm", "La holgura", def.insert.clearanceMm, 0, 5);
  } else {
    range("heightMm", "La altura", def.heightMm, 30, 300);
    range("topDiameterMm", "El diámetro superior", def.topDiameterMm, 30, 250);
    range("bottomDiameterMm", "El diámetro inferior", def.bottomDiameterMm, 30, 250);
  }
  range("bodyBulgePct", "El abombado", def.bodyBulgePct, 0, 100, "%");
  if (def.surface.style === "faceted") range("surface.sides", "La cantidad de lados", def.surface.sides, 6, 32, "");
  if (def.grooves.enabled) {
    range("grooves.count", "La cantidad de ranuras", def.grooves.count, 8, 32, "");
    range("grooves.depthMm", "La profundidad de ranuras", def.grooves.depthMm, 0, 3);
  }
  if (def.bands.enabled) {
    range("bands.count", "La cantidad de bandas", def.bands.count, 0, 5, "");
    range("bands.heightMm", "La altura de banda", def.bands.heightMm, 1, 30);
    range("bands.reliefMm", "El relieve de banda", def.bands.reliefMm, 0, 5);
  }
  if (def.handle.enabled) {
    range("handle.thicknessMm", "El espesor del asa", def.handle.thicknessMm, 3, 40);
    range("handle.sectionWidthMm", "El ancho de sección del asa", def.handle.sectionWidthMm, 3, 60);
    if (!def.handle.auto) {
      range("handle.heightMm", "La altura del asa", def.handle.heightMm, 10, 250);
      range("handle.projectionMm", "La proyección del asa", def.handle.projectionMm, 5, 150);
      range("handle.verticalPositionPct", "La posición vertical del asa", def.handle.verticalPositionPct, 10, 90, "%");
    }
    if (fin(def.handle.thicknessMm) && def.handle.thicknessMm >= 3 && def.handle.thicknessMm < 6) warn("HANDLE_THIN", "El asa tiene una sección muy fina.", "handle.thicknessMm");
  }
  errors.push(...validateDecorationInputs(def));
  if (errors.length > 0) return { errors, warnings };

  // Validaciones que necesitan el cuerpo resuelto.
  const plan = planMugBody(def, "preview");
  let minInner = Infinity;
  for (let z = plan.floorZ; z <= plan.heightMm; z += plan.heightMm / 50) minInner = Math.min(minInner, plan.innerR(z));
  if (!(minInner >= 3)) err("INNER_RADIUS", "El radio interior resultante es demasiado pequeño o inválido: reducí el espesor de pared o agrandá el cuerpo.", "wallThicknessMm");
  if (plan.floorZ >= plan.heightMm * 0.6) err("FLOOR_TOO_HIGH", "El espesor de base es demasiado grande para la altura del jarro.", "bottomThicknessMm");
  if (def.bands.enabled && def.bands.count * def.bands.heightMm > plan.heightMm * 0.76) err("BANDS_DONT_FIT", "Las bandas no entran en la altura del jarro: reducí la cantidad o la altura.", "bands.count");
  if (def.wallThicknessMm < 1.2) warn("WALL_THIN", "Pared menor a 1.2mm.", "wallThicknessMm");

  let handleReach = 0;
  let windows: { zTop: number; zBot: number; halfWidthMm: number; halfHeightMm: number } | null = null;
  if (def.handle.enabled) {
    const att = planHandleAttachments(def, plan);
    const h = att.handle;
    const zc = (plan.heightMm * h.verticalPositionPct) / 100;
    const margin = 2 * plan.dz;
    if (h.projectionMm < h.thicknessMm * 1.5) err("HANDLE_PROJECTION", "La proyección del asa es demasiado corta: entra dentro del cuerpo. Aumentá la proyección o reducí el espesor.", "handle.projectionMm");
    else if (zc + h.heightMm / 2 + att.windowHalfHeightMm + margin > plan.wallTopZ - 4 || zc - h.heightMm / 2 - att.windowHalfHeightMm - margin < Math.max(plan.floorZ, 6))
      err("HANDLE_OUT_OF_BODY", "El asa no cabe en la pared: reducí su altura o cambiá la posición vertical.", "handle.heightMm");
    else if (h.heightMm < 2 * att.windowHalfHeightMm + h.thicknessMm) err("HANDLE_TOO_SHORT", "El asa es demasiado corta para sus zonas de unión: aumentá la altura o reducí el espesor.", "handle.heightMm");
    handleReach = h.projectionMm + h.thicknessMm / 2;
    windows = { zTop: att.rowTop * plan.dz, zBot: att.rowBot * plan.dz, halfWidthMm: att.windowHalfWidthMm, halfHeightMm: att.windowHalfHeightMm };
  }
  if (def.decorations.length > 0) {
    const placement = validateDecorationPlacement(def, { heightMm: plan.heightMm, outerR: plan.outerR, handle: windows, artworkOf });
    errors.push(...placement.errors);
    warnings.push(...placement.warnings);
  }

  if (printer && errors.length === 0) {
    let maxR = 0;
    for (let z = 0; z <= plan.heightMm; z += plan.heightMm / 40) maxR = Math.max(maxR, plan.outerR(z));
    maxR += (def.bands.enabled ? def.bands.reliefMm : 0) + (def.grooves.enabled ? def.grooves.depthMm : 0);
    if (def.surface.style === "faceted") maxR /= Math.cos(Math.PI / def.surface.sides);
    const along = 2 * maxR + handleReach, across = 2 * maxR;
    if (Math.max(along, across) > printer.widthMm || Math.min(along, across) > printer.depthMm) warn("BED_XY", "El diámetro supera la cama configurada.");
    if (plan.heightMm > printer.heightMm) warn("BED_Z", "El jarro supera la altura Z de la impresora.");
  }
  return { errors, warnings };
}
