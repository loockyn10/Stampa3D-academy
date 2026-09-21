import { DECORATION_FIELDS, DECORATION_OPS, DECORATION_SOURCE_KINDS, MUG_AI_LIMITS, MUG_MODE_FIELD, MUG_PATCH_FIELDS, type FieldDef } from "@/lib/maker/mugs/ai/schema";
import { MUG_AI_SCHEMA_VERSION, type MugAiAssetInfo, type MugAiMode, type MugDecorationOp, type MugDesignProposal, type MugPatch, type ProposedDecoration } from "@/lib/maker/mugs/ai/types";
import type { MugDecorationSource } from "@/lib/maker/mugs/types";

/**
 * La salida del modelo NUNCA es confiable. Este sanitizador es la única puerta de entrada: descarta campos
 * desconocidos, exige enums del schema cerrado (un valor inválido se IGNORA con aviso, no se reemplaza por otro),
 * acota números al rango del validador, corta strings y rechaza NaN/Infinity.
 */
export interface SanitizeContext {
  /** Modo pedido: la respuesta debe coincidir (no se infiere cuál quiso devolver el modelo). */
  mode: MugAiMode;
  assets: MugAiAssetInfo[];
  /** Ids de las decoraciones actuales (para validar update/remove). */
  currentDecorationIds: string[];
}

export type SanitizeResult = { ok: true; proposal: MugDesignProposal } | { ok: false; error: string };

const MAX_ADJUST_NOTES = 8;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Reemplaza caracteres de control por espacios (conserva \n si `keepNewlines`). */
export function stripControl(s: string, keepNewlines = false): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += (c < 32 && !(keepNewlines && c === 10)) || c === 127 ? " " : ch;
  }
  return out;
}

/** Quita caracteres de control (conserva \n si `keepNewlines`) y recorta. */
export function cleanString(v: unknown, max: number, keepNewlines = false): string {
  if (typeof v !== "string") return "";
  const stripped = stripControl(v, keepNewlines);
  return stripped.replace(/[ \t]+/g, " ").trim().slice(0, max);
}

function cleanList(v: unknown, max: number, count: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = cleanString(item, max);
    if (s) out.push(s);
    if (out.length >= count) break;
  }
  return out;
}

/** Valida un valor contra su FieldDef. `undefined` = "no especificado" (null/ausente); `null` = inválido y descartado. */
function readField(raw: unknown, def: FieldDef, label: string, notes: string[]): unknown | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = def.spec;
  if (s.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    notes.push(`Se ignoró «${label}»: valor no válido.`);
    return undefined;
  }
  if (s.type === "enum") {
    if (typeof raw === "string" && s.values.includes(raw)) return raw;
    notes.push(`Se ignoró «${label}»: la opción «${cleanString(raw, 30)}» no existe en el generador.`);
    return undefined;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    notes.push(`Se ignoró «${label}»: valor numérico no válido.`);
    return undefined;
  }
  let n = s.integer ? Math.round(raw) : raw;
  if (n < s.min || n > s.max) {
    const clamped = Math.min(s.max, Math.max(s.min, n));
    notes.push(`«${label}» estaba fuera de rango (${s.min}–${s.max}${s.unit ? ` ${s.unit}` : ""}); se ajustó a ${clamped}.`);
    n = clamped;
  }
  return Math.round(n * 100) / 100;
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown) {
  let cur = target;
  for (let i = 0; i < path.length - 1; i++) {
    const next = rec(cur[path[i]]);
    cur[path[i]] = next;
    cur = next;
  }
  cur[path[path.length - 1]] = value;
}

function sanitizePatch(raw: Record<string, unknown>, notes: string[]): MugPatch {
  const patch: Record<string, unknown> = {};
  const mode = readField(raw.mugMode, MUG_MODE_FIELD, "modo del jarro", notes);
  if (mode !== undefined) setPath(patch, MUG_MODE_FIELD.path, mode);
  for (const [group, fields] of Object.entries(MUG_PATCH_FIELDS)) {
    const src = rec(raw[group]);
    for (const [key, def] of Object.entries(fields)) {
      const v = readField(src[key], def, `${group}.${key}`, notes);
      if (v !== undefined) setPath(patch, def.path, v);
    }
  }
  return patch as MugPatch;
}

/** Normaliza un ángulo semántico: envuelve a [-180, 180]; valores absurdos se rechazan. */
function readAngle(raw: unknown, notes: string[]): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || Math.abs(raw) > MUG_AI_LIMITS.maxAngleAbs) {
    notes.push("Se ignoró el ángulo de una decoración: valor no válido.");
    return undefined;
  }
  let a = raw % 360;
  if (a > 180) a -= 360;
  else if (a < -180) a += 360;
  return Math.round(a * 100) / 100;
}

function cleanText(v: unknown): string {
  const lines = cleanString(v, 400, true).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, MUG_AI_LIMITS.textMaxLines);
  return lines.join("\n").slice(0, MUG_AI_LIMITS.textMax);
}

interface SourceRead {
  /** undefined = no se especificó; null = falta elegir archivo; objeto = fuente resuelta. */
  source?: MugDecorationSource | null;
  needsAssetChoice?: boolean;
  /** true = la operación no puede aplicarse (se descarta completa). */
  drop?: boolean;
}

function assetSource(asset: MugAiAssetInfo): MugDecorationSource {
  return asset.kind === "svg"
    ? { kind: "svg", assetId: asset.id, fileName: asset.fileName }
    : { kind: "raster", assetId: asset.id, fileName: asset.fileName, format: asset.kind, detection: "auto", threshold: null, invert: false };
}

function readSource(o: Record<string, unknown>, assets: MugAiAssetInfo[], notes: string[]): SourceRead {
  const kind = o.sourceKind;
  if (kind === null || kind === undefined) {
    // Sin sourceKind pero con texto explícito (modelo descuidado): se toma como texto.
    const text = cleanText(o.text);
    return text ? { source: { kind: "text", text, fontId: "montserrat-bold", align: "center" } } : {};
  }
  if (typeof kind !== "string" || !(DECORATION_SOURCE_KINDS as readonly string[]).includes(kind)) {
    notes.push(`Se ignoró una decoración: tipo de arte «${cleanString(kind, 20)}» no soportado.`);
    return { drop: true };
  }
  if (kind === "none") return { source: { kind: "none" } };
  if (kind === "text") {
    const text = cleanText(o.text);
    if (!text) {
      notes.push("Se ignoró una decoración de texto sin texto.");
      return { drop: true };
    }
    return { source: { kind: "text", text, fontId: "montserrat-bold", align: "center" } };
  }
  // asset
  if (assets.length === 0) {
    notes.push("Pediste usar un logo o archivo, pero todavía no cargaste ninguno. Cargalo en Personalización y volvé a pedirlo.");
    return { drop: true };
  }
  const chosen = typeof o.assetId === "string" ? assets.find((a) => a.id === o.assetId) : undefined;
  if (chosen) return { source: assetSource(chosen) };
  // Sin id válido: con un único archivo no hay ambigüedad; con varios NO se adivina.
  if (assets.length === 1) return { source: assetSource(assets[0]) };
  return { source: null, needsAssetChoice: true };
}

function sanitizeDecoration(o: Record<string, unknown>, notes: string[]): ProposedDecoration {
  const out: Record<string, unknown> = {};
  const name = cleanString(o.name, MUG_AI_LIMITS.nameMax);
  if (name) out.name = name;
  for (const [key, def] of Object.entries(DECORATION_FIELDS)) {
    const v = key === "angleDeg" ? readAngle(o[key], notes) : readField(o[key], def, `decoración.${key}`, notes);
    if (v !== undefined) out[def.path[0]] = v;
  }
  return out as ProposedDecoration;
}

function sanitizeOps(raw: unknown, ctx: SanitizeContext, notes: string[]): MugDecorationOp[] {
  if (!Array.isArray(raw)) return [];
  const ops: MugDecorationOp[] = [];
  if (raw.length > MUG_AI_LIMITS.maxDecorationOps) notes.push(`Se propusieron demasiadas decoraciones; se conservaron las primeras ${MUG_AI_LIMITS.maxDecorationOps}.`);
  for (const item of raw.slice(0, MUG_AI_LIMITS.maxDecorationOps)) {
    const o = rec(item);
    const op = o.op;
    if (typeof op !== "string" || !(DECORATION_OPS as readonly string[]).includes(op)) {
      notes.push("Se ignoró una decoración con operación no válida.");
      continue;
    }
    if (op === "add") {
      const src = readSource(o, ctx.assets, notes);
      if (src.drop) continue;
      const decoration = sanitizeDecoration(o, notes);
      if (src.source === undefined) {
        // Sin arte: solo un medallón liso es válido.
        if (decoration.mode !== "medallion") {
          notes.push("Se ignoró una decoración nueva sin texto ni archivo.");
          continue;
        }
        decoration.source = { kind: "none" };
      } else {
        decoration.source = src.source;
      }
      if (decoration.source?.kind === "none" && decoration.mode !== "medallion") {
        notes.push("Solo un medallón puede ir liso; se ignoró una decoración sin arte.");
        continue;
      }
      ops.push({ op: "add", decoration, ...(src.needsAssetChoice ? { needsAssetChoice: true } : {}) });
      continue;
    }
    const targetId = typeof o.targetId === "string" ? o.targetId : "";
    if (!targetId || !ctx.currentDecorationIds.includes(targetId)) {
      notes.push("Se ignoró un cambio sobre una decoración que no existe.");
      continue;
    }
    if (op === "remove") {
      ops.push({ op: "remove", targetId });
      continue;
    }
    const src = readSource(o, ctx.assets, notes);
    if (src.drop) continue;
    const changes = sanitizeDecoration(o, notes);
    if (src.source !== undefined) changes.source = src.source;
    ops.push({ op: "update", targetId, changes, ...(src.needsAssetChoice ? { needsAssetChoice: true } : {}) });
  }
  return ops;
}

export function sanitizeMugDesignProposal(raw: unknown, ctx: SanitizeContext): SanitizeResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "La respuesta no es un objeto." };
  const r = raw as Record<string, unknown>;
  if (r.mode !== ctx.mode) return { ok: false, error: `El modo de la respuesta (${cleanString(r.mode, 12) || "ausente"}) no coincide con el pedido (${ctx.mode}).` };

  const adjustNotes: string[] = [];
  const mugPatch = sanitizePatch(r, adjustNotes);
  const decorationOps = sanitizeOps(r.decorations, ctx, adjustNotes);
  const replaceDecorations = r.replaceDecorations === true;
  const unsupportedRequests = cleanList(r.unsupportedRequests, 160, MUG_AI_LIMITS.maxNotes);
  const warnings = [...cleanList(r.warnings, MUG_AI_LIMITS.noteMax, MUG_AI_LIMITS.maxNotes), ...adjustNotes.slice(0, MAX_ADJUST_NOTES)];

  const hasChanges = Object.keys(mugPatch).length > 0 || decorationOps.length > 0 || replaceDecorations;
  if (!hasChanges && unsupportedRequests.length === 0) return { ok: false, error: "La propuesta no contiene ningún cambio válido." };

  return {
    ok: true,
    proposal: {
      aiDesignSchemaVersion: MUG_AI_SCHEMA_VERSION,
      mode: ctx.mode,
      name: cleanString(r.name, MUG_AI_LIMITS.nameMax) || (ctx.mode === "full" ? "Diseño con IA" : "Ajuste con IA"),
      description: cleanString(r.description, MUG_AI_LIMITS.descriptionMax),
      mugPatch,
      replaceDecorations,
      decorationOps,
      warnings,
      unsupportedRequests,
    },
  };
}
