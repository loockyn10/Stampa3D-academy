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

export interface MugProjectPayload {
  source_type: typeof MUG_SOURCE_TYPE;
  source_data: { definition: MugDefinition };
  settings: object;
  preset_id: null;
  schema_version: number;
}

export class MugProjectDataError extends Error {}

export function serializeMugProject(def: MugDefinition): MugProjectPayload {
  return { source_type: MUG_SOURCE_TYPE, source_data: { definition: { ...def, decorations: [] } }, settings: {}, preset_id: null, schema_version: MUG_PROJECT_SCHEMA_VERSION };
}

export function deserializeMugProject(row: { source_type: string; source_data: unknown }): MugDefinition {
  if (row.source_type !== MUG_SOURCE_TYPE) throw new MugProjectDataError("El proyecto no es de Jarros 3D.");
  const data = row.source_data && typeof row.source_data === "object" ? (row.source_data as { definition?: unknown }) : {};
  return normalizeMugDefinition(data.definition);
}

/** Firma comparable del trabajo (detecta cambios sin guardar). */
export function mugProjectSignature(def: MugDefinition): string {
  return JSON.stringify(serializeMugProject(def).source_data);
}
