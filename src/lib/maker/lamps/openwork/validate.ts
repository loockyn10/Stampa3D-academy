import type { LampLayout } from "@/lib/maker/lamps/layout";
import type { OpenworkField } from "@/lib/maker/lamps/openwork/field";
import { LAMP_OPENWORK_MESSAGE } from "@/lib/maker/lamps/safety";
import { LAMP_GEOMETRY, type LampDefinition } from "@/lib/maker/lamps/types";

export interface OpenworkIssue {
  code: string;
  message: string;
  field?: string;
  severity: "error" | "warning";
}

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/**
 * Validaciones de la pantalla calada: mínimos de fabricación (ancho, profundidad, aberturas), voladizos de las tiras, anillos,
 * presupuesto de malla y compatibilidad con la unión. Todo es GEOMÉTRICO: ninguna cifra de acá es una garantía de impresión
 * ni de seguridad térmica. No se corrige nada en silencio: lo que no cumple se informa con el motivo y el parámetro a mover.
 */
export function openworkIssues(def: LampDefinition, field: OpenworkField, layout: LampLayout): OpenworkIssue[] {
  const g = LAMP_GEOMETRY;
  const ow = def.openwork;
  const rep = field.report;
  const out: OpenworkIssue[] = [];
  const err = (code: string, message: string, fieldName?: string) => out.push({ code, message, field: fieldName, severity: "error" });
  const warn = (code: string, message: string, fieldName?: string) => out.push({ code, message, field: fieldName, severity: "warning" });

  // ---- Fabricación: ancho y profundidad de las tiras (boquilla de 0,4 mm como referencia, sin asumir una cantidad exacta de perímetros)
  if (ow.stripWidthMm < g.openworkMinStripMm) err("OPENWORK_STRIP_TOO_THIN", `Las tiras de ${fmt(ow.stripWidthMm)} mm son más finas que ${fmt(g.openworkMinStripMm)} mm: no se pueden imprimir con boquilla de 0,4 mm. Aumentá el ancho de las tiras.`, "openwork.stripWidthMm");
  else if (ow.stripWidthMm < g.openworkWarnStripMm) warn("OPENWORK_STRIP_THIN", `Tiras de ${fmt(ow.stripWidthMm)} mm: equivalen a 2-3 líneas de extrusión de 0,4 mm y quedan frágiles. El laminador decide la cantidad de perímetros; probá la pieza antes de confiar en ella.`, "openwork.stripWidthMm");
  if (ow.depthMm < g.openworkMinDepthMm) err("OPENWORK_DEPTH_TOO_THIN", `Profundidad de ${fmt(ow.depthMm)} mm: menor que ${fmt(g.openworkMinDepthMm)} mm, la estructura no tiene cuerpo para imprimirse. Aumentá la profundidad.`, "openwork.depthMm");
  else if (ow.depthMm < g.openworkWarnDepthMm) warn("OPENWORK_DEPTH_THIN", `Profundidad de ${fmt(ow.depthMm)} mm: es delgada y puede flexar. Considerá ${fmt(g.openworkWarnDepthMm)} mm o más.`, "openwork.depthMm");

  // ---- Aberturas reales
  if (rep.minOpeningMm < g.openworkMinOpeningMm) {
    err("OPENWORK_OPENING_CLOSED", `Entre las tiras queda una abertura de ${fmt(rep.minOpeningMm)} mm (menos de ${fmt(g.openworkMinOpeningMm)} mm): no hay huecos reales. Reducí el ancho de las tiras, bajá la cantidad de divisiones/bandas o aumentá el diámetro.`, ow.pattern === "diamond" ? "openwork.divisions" : "openwork.bands");
  } else if (rep.minOpeningMm < g.openworkWarnOpeningMm) {
    warn("OPENWORK_OPENING_SMALL", `La abertura mínima es de ${fmt(rep.minOpeningMm)} mm: es muy chica para dejar pasar la luz y para que los puentes de los huecos se impriman limpios. Reducí el ancho de las tiras o la densidad.`, "openwork.stripWidthMm");
  }
  if (rep.minOpeningMm >= g.openworkMinOpeningMm && rep.aperturePct < g.openworkWarnAperturePct) {
    warn("OPENWORK_NEARLY_SOLID", `Solo el ${fmt(rep.aperturePct)} % de la zona calada es abertura: casi una pantalla sólida. Reducí el ancho de las tiras.`, "openwork.stripWidthMm");
  }

  // ---- Anillos
  const latticeMm = def.shade.heightMm - ow.bottomRingMm - (ow.topFinish === "ring" ? ow.topRingMm : 0);
  if (latticeMm < Math.max(15, 3 * ow.stripWidthMm)) {
    err("OPENWORK_RINGS_TOO_TALL", `Los anillos dejan solo ${fmt(Math.max(0, latticeMm))} mm de zona calada de los ${fmt(def.shade.heightMm)} mm de la pantalla. Reducí los anillos o aumentá la altura.`, "openwork.bottomRingMm");
  }
  if (layout.connection === "collar" && ow.bottomRingMm < def.shade.collarHeightMm) {
    err("OPENWORK_RING_IN_COLLAR", `Con el collar roscado, el borde inferior de la pantalla entra ${fmt(def.shade.collarHeightMm)} mm en el pozo del collar: el anillo inferior (${fmt(ow.bottomRingMm)} mm) debe cubrir esa profundidad para que las tiras no queden dentro del pozo.`, "openwork.bottomRingMm");
  }
  if (ow.topFinish === "open") {
    warn("OPENWORK_TOP_OPEN", "Sin anillo superior las tiras terminan cortadas a ras del borde: quedan puntas finas sin apoyo estructural. Se recomienda terminar con anillo.", "openwork.topFinish");
  }

  // ---- Imprimibilidad: voladizos
  if (rep.maxStripLeanDeg > g.openworkLeanHardDeg) {
    err("OPENWORK_STRIP_TOO_FLAT", `Algunas tiras se inclinan ${fmt(rep.maxStripLeanDeg)}° respecto de la vertical (casi horizontales): no es imprimible. Aumentá la inclinación de las diagonales, reducí la torsión o las vueltas.`, ow.pattern === "diamond" ? "openwork.inclinationDeg" : "openwork.turns");
  } else if (rep.maxStripLeanDeg > g.openworkLeanWarnDeg) {
    warn("OPENWORK_NEEDS_SUPPORT", `Algunas tiras se inclinan hasta ${fmt(rep.maxStripLeanDeg)}° respecto de la vertical (límite orientativo ${g.openworkLeanWarnDeg}°): su cara inferior es un voladizo y puede pedir soportes o salir con rugosidad. Probalo en el laminador.`, ow.pattern === "diamond" ? "openwork.inclinationDeg" : "openwork.turns");
  }
  if (rep.maxSurfaceTiltDeg > g.openworkLeanWarnDeg && rep.maxSurfaceTiltDeg <= g.hardMaxTiltDeg) {
    warn("OPENWORK_SURFACE_LEAN", `La silueta se inclina hasta ${fmt(rep.maxSurfaceTiltDeg)}° respecto de la vertical: la pared es un voladizo y puede pedir soportes.`, "openwork.maxDiameterMm");
  }

  // ---- Malla y rendimiento
  // el cuello roscado se malla con la misma cantidad de columnas: filas de la rosca + transición e interior
  const neckTriangles = 2 * field.nTheta * (Math.ceil((layout.spec.length / layout.spec.pitch) * g.threadRowsPerPitch) + 9);
  const total = rep.latticeTriangles + (layout.connection === "integrated" ? neckTriangles : 0);
  if (total > g.openworkMaxTriangles) {
    err("OPENWORK_TOO_HEAVY", `Con estos valores la pantalla tendría unos ${Math.round(total / 1000)} mil triángulos (máximo ${Math.round(g.openworkMaxTriangles / 1000)} mil): el visor y el STL serían demasiado pesados. Reducí la altura, el diámetro o la densidad, o aumentá el ancho de las tiras.`, "openwork.stripWidthMm");
  } else if (total > g.openworkWarnTriangles) {
    warn("OPENWORK_HEAVY", `La pantalla tiene unos ${Math.round(total / 1000)} mil triángulos: el STL será pesado (unos ${Math.round((total * 50) / 1e6)} MB) y el visor puede ir más lento en el celular.`, "openwork.stripWidthMm");
  }
  if (rep.coarse) {
    warn("OPENWORK_MESH_COARSE", `Para respetar el presupuesto de malla, la grilla usa celdas de ${fmt(rep.cellMm)} mm (${fmt(def.openwork.stripWidthMm / rep.cellMm)} por ancho de tira): los bordes de las tiras pueden verse facetados. Subí el ancho de las tiras o reducí el tamaño.`, "openwork.stripWidthMm");
  }

  warn("OPENWORK_NOT_THERMAL", LAMP_OPENWORK_MESSAGE, "shadeType");
  return out;
}
