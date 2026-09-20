import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePresetSettings, PRESET_SCHEMA_VERSION, type PresetSettings } from "@/lib/maker/presets/presetSettings";
import {
  PROJECT_STORAGE_BUCKET,
  deserializeProject,
  projectSourcePath,
  type LoadedProject,
  type ProjectRow,
} from "@/lib/maker/projects/projectData";

/**
 * Acceso a Supabase para presets/proyectos de Stampa Maker. Capa fina: la
 * seguridad real es RLS + policies de Storage (migration
 * 20260919120000_maker_presets_projects.sql); `user_id` nunca se envía desde
 * el frontend (lo completa `default auth.uid()` y lo exige RLS).
 */
export class MakerPersistenceError extends Error {}

/** Traduce cualquier error (SQL/Storage/red) a un mensaje comprensible: nunca se muestra texto crudo de la base. */
export function toUserMessage(err: unknown, fallback = "No se pudo completar la operación. Probá de nuevo."): string {
  if (err instanceof MakerPersistenceError) return err.message;
  const e = err as { code?: string; message?: string; status?: number; statusCode?: string | number } | null;
  const code = e?.code;
  const status = Number(e?.status ?? e?.statusCode);
  if (code === "23505") return "Ya existe un elemento con esos datos.";
  if (code === "42501" || status === 401 || status === 403) return "No tenés permiso para hacer esto. Verificá tu sesión y tu plan.";
  if (code === "PGRST116" || code === "P0002" || status === 404) return "No se encontró el elemento. Puede haber sido eliminado.";
  if (code === "42P01" || code === "PGRST205") return "La función todavía no está disponible en este entorno.";
  if (status === 413) return "El archivo es demasiado grande.";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "Sin conexión. Revisá tu internet.";
  return fallback;
}

export interface PresetRow {
  id: string;
  name: string;
  settings: PresetSettings;
  schemaVersion: number;
  isDefault: boolean;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  sourceType: string;
  updatedAt: string;
}

interface RawPreset {
  id: string;
  name: string;
  settings: unknown;
  schema_version: number | null;
  is_default: boolean;
  updated_at: string;
}

const PRESET_COLUMNS = "id, name, settings, schema_version, is_default, updated_at";

function mapPreset(row: RawPreset): PresetRow {
  return {
    id: row.id,
    name: row.name,
    settings: normalizePresetSettings(row.settings, row.schema_version),
    schemaVersion: row.schema_version ?? PRESET_SCHEMA_VERSION,
    isDefault: row.is_default,
    updatedAt: row.updated_at,
  };
}

function fail(error: unknown): never {
  throw new MakerPersistenceError(toUserMessage(error));
}

export async function currentUserId(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new MakerPersistenceError("Iniciá sesión para guardar tu trabajo.");
  return data.user.id;
}

// ------------------------------ Presets ------------------------------

export async function listPresets(supabase: SupabaseClient): Promise<PresetRow[]> {
  const { data, error } = await supabase.from("maker_presets").select(PRESET_COLUMNS).order("name", { ascending: true });
  if (error) fail(error);
  return ((data ?? []) as RawPreset[]).map(mapPreset);
}

export async function createPreset(supabase: SupabaseClient, name: string, settings: PresetSettings): Promise<PresetRow> {
  const { data, error } = await supabase
    .from("maker_presets")
    .insert({ name: name.trim(), settings, schema_version: PRESET_SCHEMA_VERSION })
    .select(PRESET_COLUMNS)
    .single();
  if (error) fail(error);
  return mapPreset(data as RawPreset);
}

export async function updatePresetSettings(supabase: SupabaseClient, id: string, settings: PresetSettings): Promise<PresetRow> {
  const { data, error } = await supabase
    .from("maker_presets")
    .update({ settings, schema_version: PRESET_SCHEMA_VERSION })
    .eq("id", id)
    .select(PRESET_COLUMNS)
    .single();
  if (error) fail(error);
  return mapPreset(data as RawPreset);
}

export async function renamePreset(supabase: SupabaseClient, id: string, name: string): Promise<void> {
  const { error } = await supabase.from("maker_presets").update({ name: name.trim() }).eq("id", id);
  if (error) fail(error);
}

export async function deletePreset(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("maker_presets").delete().eq("id", id);
  if (error) fail(error);
}

/** `null` quita el predeterminado. Atómico del lado de la base (ver maker_set_default_preset). */
export async function setDefaultPreset(supabase: SupabaseClient, id: string | null): Promise<void> {
  const { error } = await supabase.rpc("maker_set_default_preset", { p_preset_id: id });
  if (error) fail(error);
}

// ------------------------------ Projects ------------------------------

/** Herramienta dueña de un proyecto. Los de Neon usan `source_type` con prefijo "neon-" (ver migration 20260920120000): Carteles nunca los lista. */
export type MakerToolKind = "sign" | "neon" | "mug";
const SIGN_SOURCE_TYPES = ["text", "svg", "png"];
const NEON_SOURCE_TYPES = ["neon-text", "neon-svg", "neon-png", "neon-jpg"];
const MUG_SOURCE_TYPES = ["mug"];

export async function listProjects(supabase: SupabaseClient, tool: MakerToolKind = "sign"): Promise<ProjectSummary[]> {
  const { data, error } = await supabase
    .from("maker_projects")
    .select("id, name, source_type, updated_at")
    .in("source_type", tool === "neon" ? NEON_SOURCE_TYPES : tool === "mug" ? MUG_SOURCE_TYPES : SIGN_SOURCE_TYPES)
    .order("updated_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []).map((r: { id: string; name: string; source_type: string; updated_at: string }) => ({
    id: r.id,
    name: r.name,
    sourceType: r.source_type,
    updatedAt: r.updated_at,
  }));
}

export interface LoadedProjectRecord {
  id: string;
  name: string;
  project: LoadedProject;
}

/** Fila cruda de un proyecto (cualquier herramienta): quien la abre la deserializa con su propio módulo (Carteles: projectData; Neon: neonProjectData). */
export async function fetchProjectRow(supabase: SupabaseClient, id: string): Promise<{ id: string; name: string; row: ProjectRow }> {
  const { data, error } = await supabase
    .from("maker_projects")
    .select("id, name, source_type, source_data, settings, preset_id, schema_version")
    .eq("id", id)
    .single();
  if (error) fail(error);
  return { id: data.id as string, name: data.name as string, row: data as ProjectRow };
}

export async function fetchProject(supabase: SupabaseClient, id: string): Promise<LoadedProjectRecord> {
  const { data, error } = await supabase
    .from("maker_projects")
    .select("id, name, source_type, source_data, settings, preset_id, schema_version")
    .eq("id", id)
    .single();
  if (error) fail(error);
  try {
    return { id: data.id as string, name: data.name as string, project: deserializeProject(data) };
  } catch (err) {
    throw new MakerPersistenceError(err instanceof Error ? err.message : "El proyecto está dañado.");
  }
}

/** Descarga el archivo de origen (bucket privado) para volver a procesarlo con el motor vigente. */
export async function downloadProjectSource(supabase: SupabaseClient, storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(PROJECT_STORAGE_BUCKET).download(storagePath);
  if (error || !data) throw new MakerPersistenceError("No se pudo descargar el archivo del proyecto.");
  return data;
}

/** Forma común de lo que se persiste, sea de Carteles (ProjectPayload) o de Neon. */
export interface GenericProjectPayload {
  source_type: string;
  source_data: object;
  settings: object;
  preset_id: string | null;
  schema_version: number;
}

export interface SaveProjectInput {
  /** Id existente (guardar) o nuevo, generado en el cliente (crear / guardar como). */
  id: string;
  isNew: boolean;
  name: string;
  payload: GenericProjectPayload;
  /** Archivo a subir (solo SVG/PNG/JPG y solo si es nuevo o cambió). */
  upload?: { kind: "svg" | "png" | "jpg"; blob: Blob } | null;
  /** Path previo en Storage, para limpiar si cambió la extensión. */
  previousStoragePath?: string | null;
}

/** Sube el archivo (si corresponde) y luego graba la fila; devuelve el storagePath vigente. */
export async function saveProject(supabase: SupabaseClient, input: SaveProjectInput): Promise<{ storagePath: string | null }> {
  let storagePath: string | null = null;
  const source = input.payload.source_data as { storagePath?: string };

  if (!["text", "neon-text", "mug"].includes(input.payload.source_type)) {
    storagePath = input.previousStoragePath ?? null;
    if (input.upload) {
      const userId = await currentUserId(supabase);
      storagePath = projectSourcePath(userId, input.id, input.upload.kind);
      const { error } = await supabase.storage
        .from(PROJECT_STORAGE_BUCKET)
        .upload(storagePath, input.upload.blob, { upsert: true, contentType: input.upload.blob.type || undefined });
      if (error) fail(error);
    }
    if (!storagePath) throw new MakerPersistenceError("Falta el archivo de origen del proyecto.");
    source.storagePath = storagePath;
  }

  const row = {
    name: input.name.trim(),
    source_type: input.payload.source_type,
    source_data: input.payload.source_data,
    settings: input.payload.settings,
    preset_id: input.payload.preset_id,
    schema_version: input.payload.schema_version,
  };
  const { error } = input.isNew
    ? await supabase.from("maker_projects").insert({ id: input.id, ...row })
    : await supabase.from("maker_projects").update(row).eq("id", input.id);
  if (error) fail(error);

  if (input.previousStoragePath && storagePath && input.previousStoragePath !== storagePath) {
    await supabase.storage.from(PROJECT_STORAGE_BUCKET).remove([input.previousStoragePath]);
  }
  return { storagePath };
}

export async function renameProject(supabase: SupabaseClient, id: string, name: string): Promise<void> {
  const { error } = await supabase.from("maker_projects").update({ name: name.trim() }).eq("id", id);
  if (error) fail(error);
}

export async function deleteProject(supabase: SupabaseClient, id: string, storagePath: string | null): Promise<void> {
  const { error } = await supabase.from("maker_projects").delete().eq("id", id);
  if (error) fail(error);
  if (storagePath) await supabase.storage.from(PROJECT_STORAGE_BUCKET).remove([storagePath]);
}
