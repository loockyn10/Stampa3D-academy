import { applyDiffuserKind, familyCaps } from "@/lib/maker/lamps/capabilities";
import { DEFAULT_ADHESION, DEFAULT_DOUBLE_WALL_LAMP, DEFAULT_INSERT, DEFAULT_OPENWORK, DEFAULT_SHADE } from "@/lib/maker/lamps/defaults";
import { suggestThreadMajorForDiffuser } from "@/lib/maker/lamps/diffuserFit";
import { fitDoubleWallEnds } from "@/lib/maker/lamps/doublewall/params";
import { LAMP_LIMITS, type LampDefinition, type LampIssue, type LampShadeType } from "@/lib/maker/lamps/types";

/**
 * RESUMEN DE ERRORES Y AVISOS para la interfaz. El motor (`validateLamp`) devuelve mensajes completos y técnicos —son los que bloquean la exportación y los
 * que usan los tests y el LÉEME—; la interfaz no los vuelca: acá se convierten en frases cortas y accionables, sin códigos internos, sin repetidos
 * equivalentes y sin lo que pertenece a otra familia. El detalle completo queda disponible al expandir.
 *
 * Tres niveles:
 *   - `blocking`: impide generar o exportar. Se muestra el problema principal en una línea y, si existe, una acción concreta.
 *   - `advice`: recomendaciones (no bloquean). Un indicador discreto «2 recomendaciones» que se expande.
 *   - `safety`: lo térmico/eléctrico pendiente de validar. Proporcional: una línea, sin repetirse por cada causa.
 * Lo meramente informativo (que siempre acompaña al diseño o que el motor ya resolvió) no se muestra.
 */

export type FixId = "useCylinder" | "raiseThread" | "clampField" | "useIntegrated" | "disableAdhesion" | "resetFamily";

export interface IssueFix {
  id: FixId;
  label: string;
  /** Solo `clampField`: campo y valor al que se lleva. */
  field?: string;
  value?: number;
}

export interface SummaryItem {
  /** Clave estable del problema (para React y para deduplicar); NO se muestra. */
  key: string;
  level: "blocking" | "advice" | "safety";
  /** Frase corta, imperativa o descriptiva, de una línea. */
  short: string;
  /** Mensaje completo del motor (se ve al expandir). */
  detail: string;
  /** Campo de la definición al que apunta, si lo hay (para mostrarlo junto al control). */
  field?: string;
  fix?: IssueFix;
}

export interface IssueSummary {
  blocking: SummaryItem[];
  advice: SummaryItem[];
  safety: SummaryItem[];
  /** El problema principal (el primero que bloquea). */
  primary: SummaryItem | null;
}

/** Códigos que nunca se muestran: o acompañan siempre a cualquier diseño (hay un indicador fijo) o el motor ya los resuelve. */
const HIDDEN = new Set(["PHYSICAL_VALIDATION_PENDING", "HOLDER_NOT_VALIDATED", "ADHESION_UNVERIFIED", "DIFFUSER_TABS_NOT_APPLICABLE", "OPENWORK_MESH_COARSE", "OPENWORK_HEAVY"]);

/** Lo térmico/eléctrico pendiente de validar: un solo ítem aunque haya varias causas. */
const SAFETY = new Set(["OPENWORK_NOT_THERMAL", "DW_NOT_THERMAL", "INSERT_CLOSED_THERMAL_PENDING", "INSERT_GAP_UNVALIDATED", "COLLAR_UNVERIFIED"]);

/** Equivalentes: cada grupo muestra una sola frase (el primero que aparece manda). */
const GROUPS: Record<string, string> = {
  INSERT_DOES_NOT_FIT: "diffuser-fit",
  INSERT_TOUCHES_SHADE: "diffuser-fit",
  DIFFUSER_STRUCTURE_INTRUDES: "diffuser-fit",
  DIFFUSER_PATH_BLOCKED: "diffuser-pass",
  DIFFUSER_CANNOT_PASS_TOP: "diffuser-pass",
  DIFFUSER_EXCEEDS_BASE: "diffuser-base",
  TOWER_TOO_WIDE_FOR_THREAD: "diffuser-base",
  SHADE_TOO_STEEP: "steep",
  DW_LEAN: "steep",
  OPENWORK_STRIP_TOO_FLAT: "steep",
  INSERT_TOO_CLOSE_TO_BULB: "bulb",
  INSERT_CLOSURE_TOUCHES_BULB: "bulb",
  SHADE_TOO_CLOSE_TO_BULB: "bulb",
  HOLDER_BODY_WIDER_THAN_THREAD: "holder",
  HOLDER_BODY_WIDER_THAN_BORE: "holder",
  HOLDER_BORE_NARROWER_THAN_THREAD: "holder",
  PRESS_HOLDER_TOO_WIDE: "holder",
  SHADE_RIDGE_TOO_SHARP: "waves",
  SHADE_DEGENERATE: "waves",
  DW_FLUTE_SHARP: "waves",
  DW_FLUTE_DEPTH: "waves",
  INSERT_WAVE_TOO_STEEP: "diffuser-shape",
  INSERT_DROP_TOO_STEEP: "diffuser-shape",
  INSERT_WAVE_STEEP: "diffuser-shape",
  INSERT_DROP_STEEP: "diffuser-shape",
};

/** Consecuencias de una causa que ya se informa: si la causa está, no se repiten (el remedio de la causa las resuelve). */
const CONSEQUENCES: Record<string, readonly string[]> = {
  DIFFUSER_EXCEEDS_BASE: [
    "SHADE_NARROWER_THAN_THREAD",
    "DIFFUSER_STRUCTURE_INTRUDES",
    "INSERT_DOES_NOT_FIT",
    "INSERT_TOUCHES_SHADE",
    "DIFFUSER_FIT_UNSOLVED",
    "TOWER_TOO_WIDE_FOR_THREAD",
    "ADHESION_INTERFERES",
    "DIFFUSER_PATH_BLOCKED",
    "DIFFUSER_CANNOT_PASS_TOP",
  ],
};

/** Frases cortas (sin punto técnico ni códigos). Lo que no está acá cae en `fallbackShort`. */
const SHORT: Record<string, string> = {
  DIFFUSER_NOT_COMPATIBLE: "Este difusor no sirve para esta pantalla.",
  THREAD_ENGAGEMENT_SHORT: "La rosca es demasiado corta.",
  THREAD_MANY_TURNS: "Hacen falta muchas vueltas para cerrar la pantalla.",
  SHADE_NARROWER_THAN_THREAD: "El diámetro es demasiado pequeño.",
  SHADE_RIDGE_TOO_SHARP: "Las ondas son demasiado pronunciadas.",
  SHADE_DEGENERATE: "Las ondas son demasiado pronunciadas.",
  DW_FLUTE_SHARP: "Las ondulaciones son demasiado pronunciadas.",
  DW_FLUTE_DEPTH: "Las ondulaciones son demasiado pronunciadas.",
  SHADE_TOO_STEEP: "La pared se inclina demasiado.",
  DW_LEAN: "La pared se inclina demasiado.",
  OPENWORK_STRIP_TOO_FLAT: "Las tiras quedan casi horizontales.",
  COLLAR_TOO_TALL: "El tramo recto es demasiado alto.",
  SHADE_TOO_CLOSE_TO_BULB: "La pantalla queda muy cerca de la bombilla.",
  INSERT_TOO_CLOSE_TO_BULB: "El difusor queda muy cerca de la bombilla.",
  INSERT_CLOSURE_TOUCHES_BULB: "El difusor queda muy cerca de la bombilla.",
  INSERT_DOES_NOT_FIT: "El difusor no entra.",
  INSERT_TOUCHES_SHADE: "El difusor no entra.",
  DIFFUSER_STRUCTURE_INTRUDES: "El difusor no entra.",
  DIFFUSER_PATH_BLOCKED: "El difusor no se podría colocar ni retirar.",
  DIFFUSER_CANNOT_PASS_TOP: "El difusor no se podría colocar ni retirar.",
  DIFFUSER_EXCEEDS_BASE: "El difusor no pasa por el cuello de la rosca.",
  TOWER_TOO_WIDE_FOR_THREAD: "El difusor no pasa por el cuello de la rosca.",
  DIFFUSER_FIT_UNSOLVED: "La abertura de los anillos no se ajusta al difusor.",
  INSERT_TOO_CLOSE_TO_RINGS: "El difusor choca con los anillos del portalámparas.",
  INSERT_NARROWER_THAN_FIT: "El difusor es demasiado angosto para el encastre.",
  INSERT_TOO_SHORT: "El difusor es demasiado bajo.",
  INSERT_TOO_TALL: "El difusor llega al borde de la pantalla.",
  INSERT_DEGENERATE: "La pared del difusor es demasiado gruesa.",
  INSERT_SEAT_TOO_DEEP: "La ranura del difusor es demasiado profunda.",
  INSERT_WAVE_TOO_STEEP: "La forma del difusor es demasiado extrema.",
  INSERT_DROP_TOO_STEEP: "La forma del difusor es demasiado extrema.",
  INSERT_WAVE_STEEP: "El difusor puede necesitar soportes.",
  INSERT_DROP_STEEP: "El difusor puede necesitar soportes.",
  INSERT_WAVE_COARSE: "El difusor puede verse facetado.",
  INSERT_WAVE_CREST_SHARP: "Las ondas del difusor son demasiado agudas.",
  INSERT_THIN: "El difusor es muy delgado y frágil.",
  INSERT_LOOSE: "El difusor queda flojo en la ranura.",
  INSERT_SHORTER_THAN_BULB: "El difusor deja la bombilla sin cubrir arriba.",
  INSERT_NOT_REMOVABLE_FROM_TOP: "El difusor no sale por arriba.",
  TOWER_INNER_WALL_THIN: "La pared de la torre de la base es delgada.",
  TOWER_ABOVE_BASE: "El apoyo del portalámparas queda muy alto.",
  HOLDER_BODY_WIDER_THAN_THREAD: "Este diseño necesita otro tipo de fijación.",
  HOLDER_BODY_WIDER_THAN_BORE: "Este diseño necesita otro tipo de fijación.",
  HOLDER_BORE_NARROWER_THAN_THREAD: "Este diseño necesita otro tipo de fijación.",
  PRESS_HOLDER_TOO_WIDE: "Este diseño necesita otro tipo de fijación.",
  PRESS_HOLDER_LOOSE: "El portalámparas quedaría flojo en el agujero.",
  PRESS_DEEPER_THAN_HOLDER: "El agujero es más profundo que el portalámparas.",
  RINGS_RECESS_TOO_SMALL: "Los anillos no caben en el rebaje.",
  HOLDER_SEAT_TOO_LOW: "El apoyo del portalámparas queda muy bajo.",
  TIE_ANCHOR_NO_ROOM: "No hay lugar para el precinto del cable.",
  ADHESION_INTERFERES: "El reborde de adhesión es demasiado ancho.",
  BASE_TOO_SMALL: "La base es demasiado chica.",
  BASE_STABILITY: "La base es angosta: la lámpara puede volcar.",
  BULB_EXPOSED: "La bombilla queda a la vista.",
  FLARE_INWARD: "La transición de la rosca va hacia adentro y puede pedir soportes.",
  FLARE_TALL: "La transición de la rosca es muy alta.",
  SHADE_NOT_VASE: "Esta pantalla no sirve para modo vaso.",
  SHADE_TWIST_COARSE: "La torsión es fuerte: las ondas pueden verse facetadas.",
  SHADE_WALL_THIN: "La pared es muy delgada.",
  SHADE_WALL_THIN_INTEGRATED: "La pared es muy delgada para la rosca integrada.",
  SHADE_TOO_TALL_FOR_PRINTER: "La pantalla es más alta que tu impresora.",
  SHADE_TOO_WIDE_FOR_PRINTER: "La pantalla es más ancha que tu cama.",
  BASE_TOO_WIDE_FOR_PRINTER: "La base es más ancha que tu cama.",
  COLLAR_TOO_WIDE_FOR_PRINTER: "El collar es más ancho que tu cama.",
  DIFFUSER_LIMITED_BY_BASE: "El difusor queda limitado por el cuello de la rosca.",
  DIFFUSER_RINGS_MISMATCH: "Los anillos tienen medidas distintas.",
  DIFFUSER_LOOSE_IN_RING: "El difusor queda flojo en los anillos.",
  OPENWORK_STRIP_TOO_THIN: "Las tiras son demasiado finas.",
  OPENWORK_STRIP_THIN: "Las tiras son muy finas.",
  OPENWORK_DEPTH_TOO_THIN: "Las tiras tienen poca profundidad.",
  OPENWORK_DEPTH_THIN: "Las tiras tienen poca profundidad.",
  OPENWORK_OPENING_CLOSED: "Las aberturas se cierran.",
  OPENWORK_OPENING_SMALL: "Las aberturas son muy chicas.",
  OPENWORK_NEARLY_SOLID: "Casi no hay aberturas.",
  OPENWORK_RINGS_TOO_TALL: "Los anillos dejan muy poca zona calada.",
  OPENWORK_RING_IN_COLLAR: "La pantalla calada no admite collar.",
  OPENWORK_TOP_OPEN: "Sin anillo superior quedan puntas finas.",
  OPENWORK_NEEDS_SUPPORT: "Puede necesitar soportes.",
  OPENWORK_SURFACE_LEAN: "La silueta se inclina y puede pedir soportes.",
  OPENWORK_TOO_HEAVY: "El diseño es demasiado denso.",
  OPENWORK_DISCONNECTED: "La estructura queda en piezas sueltas.",
  DW_GAP: "Las paredes quedan demasiado cerca.",
  DW_OPENING_TOO_SMALL: "La abertura central es muy chica para la bombilla.",
  DW_NECK_TOO_SHORT: "El cono interior no cabe en el cuello.",
  DW_ZONES: "La altura no alcanza para piso, cámara y techo.",
  DW_TOO_HEAVY: "El diseño es demasiado denso.",
  DW_COLLAR_UNSUPPORTED: "La doble pared no admite collar.",
  DW_FABRICATION_UNAVAILABLE: "El modo jarrón todavía no está disponible.",
  DW_CLOSED_CAVITY: "La cámara cerrada puede necesitar soportes.",
  DW_OVERHANG: "El techo inclinado puede pedir soportes.",
  DOUBLE_WALL_TOPOLOGY: "No se pudo cerrar la geometría de la doble pared.",
  MESH_NOT_WATERTIGHT: "No se pudo generar un modelo cerrado.",
};

/** Etiquetas de los fallos térmicos (un solo ítem para todas las causas). */
const SAFETY_SHORT = "Falta probar la temperatura con tu bombilla.";

function fallbackShort(issue: LampIssue): string {
  const limit = issue.field ? (LAMP_LIMITS as Record<string, { label: string }>)[issue.field] : undefined;
  if (issue.code === "OUT_OF_RANGE") return limit ? `«${limit.label}» está fuera de rango.` : "Hay un valor fuera de rango.";
  if (limit) return `Revisá «${limit.label}».`;
  const first = issue.message.split(/(?<=[.:])\s/)[0].replace(/[:]$/, ".");
  return first.length <= 80 ? first : "Revisá los valores de esta pantalla.";
}

/** Códigos que pertenecen a una sola familia: si la activa es otra, no se muestran (nunca el error de otra pantalla). */
function familyOf(code: string): LampShadeType | null {
  if (code.startsWith("OPENWORK_")) return "openwork";
  if (code.startsWith("DW_") || code.startsWith("DOUBLE_WALL_")) return "double";
  if (["SHADE_RIDGE_TOO_SHARP", "SHADE_TWIST_COARSE", "SHADE_WALL_THIN", "SHADE_WALL_THIN_INTEGRATED", "SHADE_NOT_VASE", "COLLAR_TOO_TALL"].includes(code)) return "solid";
  return null;
}

/** Acción concreta para el problema, si hay una fiable. */
function fixFor(def: LampDefinition, issue: LampIssue): IssueFix | undefined {
  switch (issue.code) {
    case "DIFFUSER_NOT_COMPATIBLE":
      return { id: "useCylinder", label: "Usar difusor cilíndrico" };
    case "DIFFUSER_EXCEEDS_BASE":
    case "TOWER_TOO_WIDE_FOR_THREAD":
      return def.insert.enabled && suggestThreadMajorForDiffuser(def) !== null ? { id: "raiseThread", label: "Agrandar la rosca" } : undefined;
    case "ADHESION_INTERFERES":
      return { id: "disableAdhesion", label: "Quitar el reborde" };
    case "DW_COLLAR_UNSUPPORTED":
    case "OPENWORK_RING_IN_COLLAR":
      return { id: "useIntegrated", label: "Usar rosca integrada" };
    case "OUT_OF_RANGE": {
      const limit = issue.field ? (LAMP_LIMITS as Record<string, { min: number; max: number; integer?: boolean }>)[issue.field] : undefined;
      const v = issue.field ? readNumber(def, issue.field) : undefined;
      if (!limit || v === undefined) return undefined;
      const value = Math.min(limit.max, Math.max(limit.min, v));
      return { id: "clampField", label: `Llevar a ${String(Math.round(value * 100) / 100).replace(".", ",")}`, field: issue.field, value };
    }
    default:
      return undefined;
  }
}

function readNumber(def: LampDefinition, path: string): number | undefined {
  const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), def);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function summarizeIssues(def: LampDefinition, errors: readonly LampIssue[], warnings: readonly LampIssue[]): IssueSummary {
  const active = def.shadeType;
  const seen = new Set<string>();
  const present = new Set(errors.map((e) => e.code));
  const consequences = new Set(Object.entries(CONSEQUENCES).flatMap(([root, list]) => (present.has(root) ? list : [])));
  let safety = null as SummaryItem | null;

  const make = (issue: LampIssue, level: SummaryItem["level"]): SummaryItem | null => {
    const owner = familyOf(issue.code);
    if (owner && owner !== active) return null;
    if (HIDDEN.has(issue.code) || (level === "blocking" && consequences.has(issue.code))) return null;
    const group = GROUPS[issue.code] ?? issue.code;
    const short = SHORT[issue.code] ?? fallbackShort(issue);
    const key = `${level}:${group}:${short}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return { key, level, short, detail: issue.message, field: issue.field, fix: level === "blocking" ? fixFor(def, issue) : undefined };
  };

  const blocking: SummaryItem[] = [];
  for (const e of errors) {
    const item = make(e, "blocking");
    if (item) blocking.push(item);
  }
  const advice: SummaryItem[] = [];
  for (const w of warnings) {
    if (SAFETY.has(w.code)) {
      safety = safety ? { ...safety, detail: `${safety.detail}\n${w.message}` } : { key: "safety", level: "safety", short: SAFETY_SHORT, detail: w.message, field: w.field };
      continue;
    }
    const item = make(w, "advice");
    if (item) advice.push(item);
  }
  return { blocking, advice, safety: safety ? [safety] : [], primary: blocking[0] ?? null };
}

/** Mensaje corto de un campo concreto (para mostrar bajo el control): el primer problema que lo señala. */
export function fieldMessage(summary: IssueSummary, field: string): string | undefined {
  return summary.blocking.find((i) => i.field === field)?.short;
}

// ------------------------------------------------------------------ correcciones (puras: devuelven una definición nueva)

/** Valores iniciales de la familia activa (lo que parte de cero un diseño de esa familia) conservando dimensiones de montaje, color, base y portalámparas. */
export function resetFamily(def: LampDefinition): LampDefinition {
  // la altura se conserva salvo que sea justamente lo que está fuera de rango
  const limit = LAMP_LIMITS["shade.heightMm"];
  const heightMm = def.shade.heightMm >= limit.min && def.shade.heightMm <= limit.max ? def.shade.heightMm : DEFAULT_SHADE.heightMm;
  const base: LampDefinition = { ...def, adhesion: { ...DEFAULT_ADHESION, enabled: def.adhesion.enabled } };
  const insert = { ...DEFAULT_INSERT, previewColor: def.insert.previewColor, enabled: familyCaps(def.shadeType).diffuser.defaultEnabled };
  if (def.shadeType === "openwork") return { ...base, shade: { ...DEFAULT_SHADE, heightMm }, openwork: DEFAULT_OPENWORK, insert: { ...insert, tabs: false } };
  if (def.shadeType === "double") return fitDoubleWallEnds({ ...base, shade: { ...DEFAULT_SHADE, heightMm }, doubleWall: DEFAULT_DOUBLE_WALL_LAMP, insert: { ...insert, tabs: false } });
  return { ...base, shade: { ...DEFAULT_SHADE, heightMm }, insert };
}

export function applyFix(def: LampDefinition, fix: IssueFix): LampDefinition {
  switch (fix.id) {
    case "useCylinder":
      return applyDiffuserKind(def, "cylinder");
    case "raiseThread": {
      const major = suggestThreadMajorForDiffuser(def);
      return major === null ? def : { ...def, thread: { ...def.thread, majorDiameterMm: major } };
    }
    case "disableAdhesion":
      return { ...def, adhesion: { ...def.adhesion, enabled: false } };
    case "useIntegrated":
      return { ...def, thread: { ...def.thread, connection: "integrated" } };
    case "clampField": {
      if (!fix.field || fix.value === undefined) return def;
      const [a, b] = fix.field.split(".");
      return { ...def, [a]: { ...(def as unknown as Record<string, object>)[a], [b]: fix.value } } as LampDefinition;
    }
    case "resetFamily":
      return resetFamily(def);
  }
}
