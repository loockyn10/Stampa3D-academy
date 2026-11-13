import { INSERT_STYLE_INITIAL } from "@/lib/maker/lamps/defaults";
import type { LampDefinition, LampInsertDef, LampInsertStyle, LampShadeType } from "@/lib/maker/lamps/types";

/**
 * CAPACIDADES POR FAMILIA de pantalla (Sólida / Calada / Doble pared): la ÚNICA definición de qué ofrece cada familia.
 *
 * La interfaz (qué controles se ven y en qué nivel), las restricciones dinámicas (`constraints.ts`), la validación (`validateLamp`), los
 * valores predeterminados y el cambio entre familias consultan este módulo; ninguno repite estas reglas. Es PURO y solo depende de los tipos y de
 * los valores iniciales del difusor: no importa la validación ni la geometría (para que ambas puedan importarlo sin ciclos).
 *
 * Qué NO es: no es un filtro de parámetros del motor. El motor conserva todos sus parámetros (`LampDefinition`); acá se decide cuáles tienen
 * sentido para cada familia y cuáles son «principales» (siempre visibles) o «avanzados» (plegados).
 */

/** Forma del difusor tal como la ve el usuario. «cylinder» es el cilindro recto y abierto (el inserto «ondulado» de amplitud 0); «wavy» tiene ondas o tapa. */
export type DiffuserKind = "cylinder" | "flat" | "drop" | "wavy" | "mossglow" | "tulip" | "hourglass" | "bell";

export const DIFFUSER_KIND_LABELS: Record<DiffuserKind, string> = { cylinder: "Cilíndrico", flat: "Plano", drop: "Gota", wavy: "Ondulado", mossglow: "Mossglow", tulip: "Tulipán", hourglass: "Reloj de arena", bell: "Campana" };

/** Difusores decorativos de perfil: solo con la pantalla sólida (la calada y la doble pared conservan su sistema de difusor). */
export const PROFILE_DIFFUSER_KINDS = ["mossglow", "tulip", "hourglass", "bell"] as const satisfies readonly DiffuserKind[];

export interface FamilyCapabilities {
  type: LampShadeType;
  label: string;
  /** Una línea para la tarjeta de elección. */
  tagline: string;
  controls: {
    /** Controles numéricos (rutas de `LampDefinition`) que se ven siempre: lo que se toca para crear. */
    main: readonly string[];
    /** Dimensiones generales de acceso rápido (también visibles siempre; se calculan con los principales). */
    general: readonly string[];
    /** Controles numéricos de «Personalización avanzada» (plegada por defecto). */
    advanced: readonly string[];
    /** Selectores no numéricos: principales y avanzados (identificadores de la interfaz). */
    pickers: { main: readonly string[]; advanced: readonly string[] };
  };
  diffuser: {
    /** Formas de difusor compatibles con la familia. Cualquier otra se rechaza en la validación y no se ofrece. */
    allowed: readonly DiffuserKind[];
    defaultKind: DiffuserKind;
    /** El difusor viene activado al elegir la familia. */
    defaultEnabled: boolean;
    /** Por qué solo esas formas (se muestra al usuario si la lista es corta). */
    note: string;
  };
  /** Uniones pantalla–base que la familia puede generar. */
  connections: readonly ("integrated" | "collar")[];
  /** Presets/estilos visuales: cuál es la galería de la familia. */
  presetKind: "solidPresets" | "openworkPresets" | "doubleShapes";
}

const SOLID: FamilyCapabilities = {
  type: "solid",
  label: "Sólida",
  tagline: "Superficie continua con ondas, espiral u orgánica.",
  controls: {
    main: ["shade.heightMm", "shade.bottomDiameterMm", "shade.amplitudeMm"],
    general: [],
    advanced: [
      "shade.topDiameterMm",
      "shade.waves",
      "shade.twistDeg",
      "shade.verticalFrequency",
      "shade.patternIntensityPct",
      "shade.organicPct",
      "shade.profileAmountPct",
      "thread.majorDiameterMm",
    ],
    pickers: { main: ["preset"], advanced: ["family", "profile"] },
  },
  diffuser: {
    allowed: ["cylinder", "flat", "drop", "wavy", "mossglow", "tulip", "hourglass", "bell"],
    defaultKind: "cylinder",
    defaultEnabled: true,
    note: "",
  },
  connections: ["integrated", "collar"],
  presetKind: "solidPresets",
};

const OPENWORK: FamilyCapabilities = {
  type: "openwork",
  label: "Calada",
  tagline: "Estructura abierta que rodea un difusor cilíndrico.",
  controls: {
    main: ["shade.heightMm", "openwork.divisions", "openwork.bands"],
    general: [],
    advanced: [
      "openwork.diffuserDiameterMm",
      "openwork.diffuserClearanceMm",
      "openwork.diffuserTopGapMm",
      "openwork.maxDiameterMm",
      "shade.bottomDiameterMm",
      "shade.topDiameterMm",
      "openwork.waistPct",
      "openwork.twistDeg",
      "openwork.inclinationDeg",
      "openwork.turns",
      "openwork.stripWidthMm",
      "openwork.depthMm",
      "openwork.bulgePositionPct",
      "openwork.curvaturePct",
      "openwork.organicPct",
      "openwork.variationPct",
      "openwork.variationCycles",
      "thread.majorDiameterMm",
    ],
    pickers: { main: ["preset", "silhouette"], advanced: ["pattern", "topFinish"] },
  },
  diffuser: {
    allowed: ["cylinder"],
    defaultKind: "cylinder",
    defaultEnabled: true,
    note: "La pantalla calada usa un difusor cilíndrico recto: se coloca y se retira por arriba.",
  },
  connections: ["integrated"],
  presetKind: "openworkPresets",
};

const DOUBLE: FamilyCapabilities = {
  type: "double",
  label: "Doble pared",
  tagline: "Dos siluetas distintas con una cámara de aire entre ellas.",
  controls: {
    // Editor visual: tres controles principales (forma exterior, forma interior, separación). La altura y el diámetro máximo pasan a «Más ajustes».
    main: ["doubleWall.minGapMm"],
    general: [],
    advanced: [
      "shade.heightMm",
      "doubleWall.maxDiameterMm",
      "shade.bottomDiameterMm",
      "shade.topDiameterMm",
      "doubleWall.fluteAmplitudeMm",
      "doubleWall.flutes",
      "doubleWall.twistDeg",
      "doubleWall.bulgePositionPct",
      "doubleWall.curvaturePct",
      "doubleWall.innerBottomDiameterMm",
      "doubleWall.innerTopDiameterMm",
      "doubleWall.innerWaistPct",
      "doubleWall.innerWaistPositionPct",
      "doubleWall.innerCurvaturePct",
      "doubleWall.innerOrganicPct",
      "thread.majorDiameterMm",
    ],
    pickers: { main: ["outerShape", "innerShape"], advanced: ["chamber", "fabrication"] },
  },
  diffuser: {
    allowed: ["cylinder"],
    defaultKind: "cylinder",
    defaultEnabled: false,
    note: "La pared interior ya es parte de la pantalla: el difusor es opcional y, si se usa, es un cilindro recto.",
  },
  connections: ["integrated"],
  presetKind: "doubleShapes",
};

export const LAMP_FAMILIES: Readonly<Record<LampShadeType, FamilyCapabilities>> = { solid: SOLID, openwork: OPENWORK, double: DOUBLE };
export const LAMP_FAMILY_ORDER: readonly LampShadeType[] = ["solid", "openwork", "double"];

export function familyCaps(type: LampShadeType): FamilyCapabilities {
  return LAMP_FAMILIES[type] ?? SOLID;
}

/** ¿El control es principal (siempre visible) para esta familia? Las dimensiones generales también cuentan como visibles. */
export function isMainControl(type: LampShadeType, path: string): boolean {
  const c = familyCaps(type).controls;
  return c.main.includes(path) || c.general.includes(path);
}

/** ¿El control pertenece a esta familia (principal, general o avanzado)? Un control que no pertenece no se muestra ni cuenta para los rangos. */
export function familyHasControl(type: LampShadeType, path: string): boolean {
  const c = familyCaps(type).controls;
  return c.main.includes(path) || c.general.includes(path) || c.advanced.includes(path);
}

// ------------------------------------------------------------------ difusor

/** Forma del difusor de la definición actual. */
export function diffuserKind(insert: Pick<LampInsertDef, "style" | "amplitudeMm" | "wavyTop">): DiffuserKind {
  if (insert.style === "flat") return "flat";
  if (insert.style === "drop") return "drop";
  if (insert.style === "mossglow" || insert.style === "tulip" || insert.style === "hourglass" || insert.style === "bell") return insert.style;
  return insert.amplitudeMm === 0 && insert.wavyTop === "open" ? "cylinder" : "wavy";
}

/** Difusor cilíndrico recto y abierto a partir del inserto actual (conserva color, diámetro, espesor, holgura y altura). Sin lengüetas (los difusores nunca las llevan). */
export function cylinderInsert(insert: LampInsertDef): LampInsertDef {
  return { ...insert, ...INSERT_STYLE_INITIAL.wavy, style: "wavy", amplitudeMm: 0, twistDeg: 0, verticalFrequency: 0, wavyTop: "open", tabs: false };
}

/** Formas de difusor ofrecidas para la definición actual (las de la familia). */
export function allowedDiffuserKinds(def: Pick<LampDefinition, "shadeType">): readonly DiffuserKind[] {
  return familyCaps(def.shadeType).diffuser.allowed;
}

/** ¿El difusor actual es compatible con la familia? (si no hay difusor, sí). */
export function diffuserCompatible(def: LampDefinition): boolean {
  return !def.insert.enabled || familyCaps(def.shadeType).diffuser.allowed.includes(diffuserKind(def.insert));
}

const STYLE_OF_KIND: Record<Exclude<DiffuserKind, "cylinder">, LampInsertStyle> = { flat: "flat", drop: "drop", wavy: "wavy", mossglow: "mossglow", tulip: "tulip", hourglass: "hourglass", bell: "bell" };

/** Cambia la forma del difusor (acción del usuario) conservando color, diámetro, espesor, holgura y altura. No hace nada si la familia no la admite. */
export function applyDiffuserKind(def: LampDefinition, kind: DiffuserKind): LampDefinition {
  if (!familyCaps(def.shadeType).diffuser.allowed.includes(kind)) return def;
  if (kind === "cylinder") return { ...def, insert: cylinderInsert(def.insert) };
  const style = STYLE_OF_KIND[kind];
  return { ...def, insert: { ...def.insert, ...INSERT_STYLE_INITIAL[style], style } };
}

// ------------------------------------------------------------------ cambio de familia

/** Lo que se recuerda de una familia al dejarla: el difusor y los diámetros de los extremos (compartidos entre familias) tal como los dejó el usuario. */
export interface FamilyMemoryEntry {
  insert: LampInsertDef;
  bottomDiameterMm: number;
  topDiameterMm: number;
  connection: "integrated" | "collar";
}
export type FamilyMemory = Partial<Record<LampShadeType, FamilyMemoryEntry>>;

/**
 * Deja la definición coherente con la familia: difusor compatible (cilíndrico si el actual no lo es), unión compatible y difusor activado según el
 * predeterminado de la familia cuando se viene de otra con un predeterminado distinto. No toca dimensiones, rosca, base ni los parámetros propios de
 * cada familia (conviven en la definición). Es lo que se aplica al elegir una familia; no se aplica al cargar un diseño (ahí lo valida el motor).
 */
export function conformToFamily(def: LampDefinition, from: LampShadeType | null = null): LampDefinition {
  const caps = familyCaps(def.shadeType);
  let insert = def.insert;
  if (from && from !== def.shadeType && familyCaps(from).diffuser.defaultEnabled !== caps.diffuser.defaultEnabled) insert = { ...insert, enabled: caps.diffuser.defaultEnabled };
  if (!caps.diffuser.allowed.includes(diffuserKind(insert))) insert = cylinderInsert(insert);
  else if (def.shadeType !== "solid" && insert.tabs) insert = { ...insert, tabs: false };
  const connection = caps.connections.includes(def.thread.connection) ? def.thread.connection : caps.connections[0];
  const thread = connection === def.thread.connection ? def.thread : { ...def.thread, connection };
  return insert === def.insert && thread === def.thread ? def : { ...def, insert, thread };
}

export function rememberFamily(def: LampDefinition, memory: FamilyMemory): FamilyMemory {
  return { ...memory, [def.shadeType]: { insert: def.insert, bottomDiameterMm: def.shade.bottomDiameterMm, topDiameterMm: def.shade.topDiameterMm, connection: def.thread.connection } };
}

/** Vuelve a lo que el usuario había dejado en la familia (difusor, extremos y unión), si lo recordamos y sigue siendo compatible. */
export function restoreFamily(def: LampDefinition, memory: FamilyMemory): LampDefinition {
  const saved = memory[def.shadeType];
  if (!saved) return def;
  const caps = familyCaps(def.shadeType);
  const insert = caps.diffuser.allowed.includes(diffuserKind(saved.insert)) ? saved.insert : def.insert;
  const connection = caps.connections.includes(saved.connection) ? saved.connection : def.thread.connection;
  return { ...def, insert, thread: { ...def.thread, connection }, shade: { ...def.shade, bottomDiameterMm: saved.bottomDiameterMm, topDiameterMm: saved.topDiameterMm } };
}
