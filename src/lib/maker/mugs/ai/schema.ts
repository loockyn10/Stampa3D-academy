import { MUG_BASE_STYLES, MUG_BODY_STYLES, MUG_HANDLE_STYLES, MUG_MODES, MUG_RIM_STYLES, MUG_SURFACE_STYLES } from "@/lib/maker/mugs/defaults";
import { MAX_DECORATIONS, MAX_TEXT_LENGTH, MUG_DECORATION_MODES, MUG_FONT_IDS, MUG_MEDALLION_SHAPES, MUG_TEXT_ALIGNS } from "@/lib/maker/mugs/decorations/decorationDefaults";

/**
 * Schema CERRADO de lo que la IA puede proponer. Es la fuente única de: (1) el JSON schema de structured output,
 * (2) el sanitizador (enums/rangos), (3) el bloque de límites del prompt. Los enums vienen de los mismos arrays que usa
 * `normalizeMugDefinition`/`normalizeDecorations`. Los rangos reflejan `validateMug`/`validateDecorationInputs`
 * (un test verifica que los extremos de este schema nunca disparen errores de rango en el validador).
 */
export type FieldSpec =
  | { type: "enum"; values: readonly string[] }
  | { type: "number"; min: number; max: number; integer?: boolean; unit: string }
  | { type: "boolean" };

export interface FieldDef {
  spec: FieldSpec;
  /** Ruta dentro de `MugPatch` (o clave del campo de decoración) donde se escribe el valor saneado. */
  path: string[];
  hint: string;
}

const en = (values: readonly string[]): FieldSpec => ({ type: "enum", values });
const nm = (min: number, max: number, unit = "mm", integer = false): FieldSpec => ({ type: "number", min, max, unit, integer });
const bool: FieldSpec = { type: "boolean" };
const f = (spec: FieldSpec, path: string[], hint: string): FieldDef => ({ spec, path, hint });

export const MUG_AI_LIMITS = {
  promptMin: 3,
  promptMax: 1500,
  nameMax: 60,
  descriptionMax: 400,
  noteMax: 200,
  maxNotes: 6,
  maxDecorationOps: MAX_DECORATIONS,
  textMax: MAX_TEXT_LENGTH,
  textMaxLines: 4,
  maxAngleAbs: 3600,
} as const;

/** Grupos del mugPatch: `grupo.campo` -> definición. */
export const MUG_PATCH_FIELDS: Record<string, Record<string, FieldDef>> = {
  dimensions: {
    heightMm: f(nm(30, 300), ["heightMm"], "altura total del jarro impreso"),
    topDiameterMm: f(nm(30, 250), ["topDiameterMm"], "diámetro de la boca"),
    bottomDiameterMm: f(nm(30, 250), ["bottomDiameterMm"], "diámetro de la base"),
    wallThicknessMm: f(nm(0.4, 20), ["wallThicknessMm"], "espesor de pared (recomendado 2–4)"),
    bottomThicknessMm: f(nm(0.4, 30), ["bottomThicknessMm"], "espesor del fondo"),
  },
  body: {
    style: f(en(MUG_BODY_STYLES), ["bodyStyle"], "forma del cuerpo"),
    bulgePct: f(nm(0, 100, "%"), ["bodyBulgePct"], "abombado; solo influye en barrel/bulged"),
    rim: f(en(MUG_RIM_STYLES), ["rim"], "borde"),
    base: f(en(MUG_BASE_STYLES), ["base"], "base"),
    surfaceStyle: f(en(MUG_SURFACE_STYLES), ["surface", "style"], "superficie lisa o facetada"),
    facetSides: f(nm(6, 32, "", true), ["surface", "sides"], "lados de la superficie facetada"),
  },
  grooves: {
    enabled: f(bool, ["grooves", "enabled"], "ranuras verticales"),
    count: f(nm(8, 32, "", true), ["grooves", "count"], "cantidad de ranuras"),
    depthMm: f(nm(0, 3), ["grooves", "depthMm"], "profundidad"),
  },
  bands: {
    enabled: f(bool, ["bands", "enabled"], "bandas metálicas en relieve"),
    count: f(nm(0, 5, "", true), ["bands", "count"], "cantidad de bandas"),
    heightMm: f(nm(1, 30), ["bands", "heightMm"], "alto de cada banda"),
    reliefMm: f(nm(0, 5), ["bands", "reliefMm"], "relieve de la banda"),
  },
  handle: {
    enabled: f(bool, ["handle", "enabled"], "tiene asa"),
    style: f(en(MUG_HANDLE_STYLES), ["handle", "style"], "estilo de asa"),
    auto: f(bool, ["handle", "auto"], "true = altura/proyección/posición automáticas según el jarro"),
    heightMm: f(nm(10, 250), ["handle", "heightMm"], "alto del asa (solo si auto=false)"),
    projectionMm: f(nm(5, 150), ["handle", "projectionMm"], "cuánto sale del cuerpo (solo si auto=false)"),
    thicknessMm: f(nm(3, 40), ["handle", "thicknessMm"], "espesor de la sección (recomendado ≥ 6)"),
    sectionWidthMm: f(nm(3, 60), ["handle", "sectionWidthMm"], "ancho de la sección"),
    verticalPositionPct: f(nm(10, 90, "%"), ["handle", "verticalPositionPct"], "posición vertical (solo si auto=false)"),
  },
  insert: {
    heightMm: f(nm(20, 300), ["insert", "heightMm"], "altura del inserto (solo modo insert-shell)"),
    topDiameterMm: f(nm(20, 250), ["insert", "topDiameterMm"], "diámetro superior del inserto"),
    bottomDiameterMm: f(nm(20, 250), ["insert", "bottomDiameterMm"], "diámetro inferior del inserto"),
    clearanceMm: f(nm(0, 5), ["insert", "clearanceMm"], "holgura radial por lado"),
  },
};

/** Campo top-level `mugMode` (modo del jarro). */
export const MUG_MODE_FIELD: FieldDef = f(en(MUG_MODES), ["mode"], "printed = jarro impreso; insert-shell = carcasa para insertar un vaso");

export const DECORATION_SOURCE_KINDS = ["text", "asset", "none"] as const;
export const DECORATION_OPS = ["add", "update", "remove"] as const;

/** Campos numéricos/enum de una operación de decoración (la clave es la del JSON y la de `ProposedDecoration`). */
export const DECORATION_FIELDS: Record<string, FieldDef> = {
  enabled: f(bool, ["enabled"], "visible"),
  mode: f(en(MUG_DECORATION_MODES), ["mode"], "emboss = relieve, engrave = grabado, medallion = medallón"),
  angleDeg: f(nm(-180, 180, "°"), ["angleDeg"], "0 = frente, 90 = lado del asa, 180 = atrás, -90 = lado opuesto al asa"),
  centerZMm: f(nm(0, 300), ["centerZMm"], "altura del centro medida desde la base (mm)"),
  widthMm: f(nm(3, 300), ["widthMm"], "ancho"),
  heightMm: f(nm(3, 300), ["heightMm"], "alto (se ignora si el aspecto está bloqueado, salvo medallón)"),
  rotationDeg: f(nm(-180, 180, "°"), ["rotationDeg"], "rotación"),
  depthMm: f(nm(0.1, 5), ["depthMm"], "altura del relieve / profundidad del grabado (engrave: menor que pared − 1)"),
  medallionShape: f(en(MUG_MEDALLION_SHAPES), ["medallionShape"], "forma del medallón"),
  medallionBaseDepthMm: f(nm(0.2, 4), ["medallionBaseDepthMm"], "espesor de la base del medallón"),
  medallionPaddingMm: f(nm(0, 20), ["medallionPaddingMm"], "margen del arte dentro del medallón"),
  fontId: f(en(MUG_FONT_IDS), ["fontId"], "fuente del texto"),
  align: f(en(MUG_TEXT_ALIGNS), ["align"], "alineación del texto"),
};

// ---------------------------------------------------------------- JSON schema (structured output, modo strict)
type Json = Record<string, unknown>;

function leafSchema(spec: FieldSpec, hint: string): Json {
  // strict: todo campo es requerido y "no especificado" = null. Los rangos van en la descripción (strict no los admite
  // en todos los modelos) y se imponen en el sanitizador.
  if (spec.type === "enum") return { type: ["string", "null"], enum: [...spec.values, null], description: hint };
  if (spec.type === "boolean") return { type: ["boolean", "null"], description: hint };
  return { type: [spec.integer ? "integer" : "number", "null"], description: `${hint} [${spec.min}–${spec.max}${spec.unit ? ` ${spec.unit}` : ""}]` };
}

const obj = (properties: Record<string, Json>, description?: string): Json => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
  ...(description ? { description } : {}),
});

/** JSON schema para `response_format: { type: "json_schema", strict: true }`. Se genera desde `MUG_PATCH_FIELDS`. */
export function buildMugDesignJsonSchema(): Json {
  const groups: Record<string, Json> = {};
  for (const [group, fields] of Object.entries(MUG_PATCH_FIELDS)) {
    groups[group] = obj(Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, leafSchema(d.spec, d.hint)])));
  }
  const decorationProps: Record<string, Json> = {
    op: { type: "string", enum: [...DECORATION_OPS] },
    targetId: { type: ["string", "null"], description: "id de una decoración EXISTENTE (obligatorio en update/remove; null en add)" },
    name: { type: ["string", "null"], description: "nombre corto" },
    sourceKind: { type: ["string", "null"], enum: [...DECORATION_SOURCE_KINDS, null], description: "text = texto; asset = archivo (SVG/logo/imagen) ya cargado; none = medallón liso" },
    text: { type: ["string", "null"], description: `texto a grabar (máx ${MAX_TEXT_LENGTH} caracteres, hasta ${MUG_AI_LIMITS.textMaxLines} líneas)` },
    assetId: { type: ["string", "null"], description: "id de un archivo de la lista de archivos disponibles; null si no sabés cuál" },
  };
  for (const [k, d] of Object.entries(DECORATION_FIELDS)) decorationProps[k] = leafSchema(d.spec, d.hint);
  return obj({
    mode: { type: "string", enum: ["full", "patch"], description: "Debe coincidir con el modo pedido." },
    name: { type: "string", description: "nombre corto del diseño" },
    description: { type: "string", description: "2–3 frases explicando qué se configuró" },
    mugMode: leafSchema(MUG_MODE_FIELD.spec, MUG_MODE_FIELD.hint),
    ...groups,
    replaceDecorations: { type: "boolean", description: "true SOLO si el usuario pidió reemplazar/quitar todas las decoraciones actuales" },
    decorations: { type: "array", items: obj(decorationProps), description: `máx ${MAX_DECORATIONS}` },
    warnings: { type: "array", items: { type: "string" }, description: "avisos breves (p. ej. aproximaciones)" },
    unsupportedRequests: { type: "array", items: { type: "string" }, description: "pedidos que el motor NO puede hacer (texturas, escultura 3D, etc.)" },
  });
}

/** Bloque de texto con enums y rangos permitidos para el system prompt (derivado del mismo schema). */
export function describeMugDesignLimits(): string {
  const fmt = (name: string, d: FieldDef) => {
    const s = d.spec;
    const v = s.type === "enum" ? s.values.join(" | ") : s.type === "boolean" ? "true | false" : `${s.integer ? "entero" : "número"} ${s.min}–${s.max}${s.unit ? ` ${s.unit}` : ""}`;
    return `  - ${name}: ${v} — ${d.hint}`;
  };
  const lines: string[] = ["mugMode:", fmt("mugMode", MUG_MODE_FIELD)];
  for (const [group, fields] of Object.entries(MUG_PATCH_FIELDS)) {
    lines.push(`${group}:`);
    for (const [k, d] of Object.entries(fields)) lines.push(fmt(k, d));
  }
  lines.push(`decorations[] (máx ${MAX_DECORATIONS}; op = ${DECORATION_OPS.join(" | ")}; sourceKind = ${DECORATION_SOURCE_KINDS.join(" | ")}):`);
  for (const [k, d] of Object.entries(DECORATION_FIELDS)) lines.push(fmt(k, d));
  return lines.join("\n");
}
