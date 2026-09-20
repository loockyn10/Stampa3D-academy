import { normalizeMugDefinition } from "@/lib/maker/mugs/defaults";
import type { MugDefinition } from "@/lib/maker/mugs/types";

/**
 * PROJECT de Jarros 3D: guarda la `MugDefinition` completa (sin mallas, sin cámara, sin estado transitorio); al abrir
 * se normaliza y se vuelve a generar con el motor vigente. No tiene assets externos, así que NO usa Storage.
 * Reusa `maker_projects` con `source_type = "mug"` (Carteles: text|svg|png; Neon: neon-*): cada herramienta filtra por
 * sus propios tipos y nunca ve las filas de las otras. Ver supabase/migrations/20260921120000_maker_mug_projects.sql.
 */
export const MUG_PROJECT_SCHEMA_VERSION = 1;
export const MUG_SOURCE_TYPE = "mug";

/** Referencia a un asset subido a Storage privado (el contenido NUNCA va en el JSON del proyecto). */
export interface MugAssetRef {
  assetId: string;
  kind: "svg" | "png" | "jpg";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

export interface MugProjectPayload {
  source_type: typeof MUG_SOURCE_TYPE;
  source_data: { definition: MugDefinition; assets: MugAssetRef[] };
  settings: object;
  preset_id: null;
  schema_version: number;
}

export class MugProjectDataError extends Error {}

/** `{user}/{project}/assets/{assetId}.{ext}` en el bucket privado `maker-projects`. */
export function mugAssetPath(userId: string, projectId: string, assetId: string, kind: MugAssetRef["kind"]): string {
  return `${userId}/${projectId}/assets/${assetId}.${kind}`;
}

export function serializeMugProject(def: MugDefinition, assets: MugAssetRef[] = []): MugProjectPayload {
  return { source_type: MUG_SOURCE_TYPE, source_data: { definition: def, assets }, settings: {}, preset_id: null, schema_version: MUG_PROJECT_SCHEMA_VERSION };
}

export function deserializeMugProject(row: { source_type: string; source_data: unknown }): MugDefinition {
  if (row.source_type !== MUG_SOURCE_TYPE) throw new MugProjectDataError("El proyecto no es de Jarros 3D.");
  const data = row.source_data && typeof row.source_data === "object" ? (row.source_data as { definition?: unknown }) : {};
  return normalizeMugDefinition(data.definition);
}

/** Referencias a assets guardadas en la fila (lectura tolerante: se descartan entradas inválidas). */
export function readMugAssetRefs(row: { source_data: unknown }): MugAssetRef[] {
  const data = row.source_data && typeof row.source_data === "object" ? (row.source_data as { assets?: unknown }) : {};
  if (!Array.isArray(data.assets)) return [];
  const out: MugAssetRef[] = [];
  for (const a of data.assets) {
    const r = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    if (typeof r.assetId !== "string" || typeof r.storagePath !== "string" || !r.assetId || !r.storagePath) continue;
    const kind = r.kind === "svg" || r.kind === "png" || r.kind === "jpg" ? r.kind : null;
    if (!kind) continue;
    out.push({ assetId: r.assetId, kind, storagePath: r.storagePath, fileName: typeof r.fileName === "string" ? r.fileName : `asset.${kind}`, mimeType: typeof r.mimeType === "string" ? r.mimeType : "", sizeBytes: typeof r.sizeBytes === "number" ? r.sizeBytes : 0 });
  }
  return out;
}

/** Firma comparable del trabajo (detecta cambios sin guardar). */
export function mugProjectSignature(def: MugDefinition): string {
  return JSON.stringify(serializeMugProject(def).source_data.definition);
}
