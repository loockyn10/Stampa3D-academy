"use server";

import { getCurrentUserAccess } from "@/lib/auth/user-access";
import {
  isCommunityKind,
  nextSortOrder,
  normalizeCommunityLinkInput,
  rowToAdminLink,
  type CommunityLinkAdmin,
  type CommunityLinkField,
} from "@/lib/community/links";
import { COMMUNITY_LINKS_TABLE, isMissingCommunityLinks } from "@/lib/community/server";
import { createClient } from "@/utils/supabase/server";

export type CommunityLinksAdminResult =
  | { success: true; links: CommunityLinkAdmin[] }
  | { success: false; error: string; code: "forbidden" | "migration_missing" | "load_failed" };

export type SaveCommunityLinkResult =
  | { success: true; link: CommunityLinkAdmin }
  | { success: false; error: string; fieldErrors?: Partial<Record<CommunityLinkField, string>> };

export type CommunityLinkMutationResult = { success: true } | { success: false; error: string };

const COLUMNS =
  "id, kind, platform, name, channel_type, description, url, icon_key, access_level, is_active, sort_order, updated_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIGRATION_MISSING =
  "Falta aplicar la migración de redes y canales en Supabase (20261102120000_community_links.sql).";

/** Solo administradores (profiles.role = admin vía getCurrentUserAccess); nunca se confía en datos del cliente. */
async function requireAdmin() {
  const supabase = await createClient();
  const { access, error } = await getCurrentUserAccess(supabase);
  if (error || !access.userId || !access.capabilities.accessAdmin) return null;
  return { supabase, userId: access.userId };
}

const FORBIDDEN = { success: false, error: "No tenés permiso para administrar redes y canales." } as const;

async function readAll(supabase: NonNullable<Awaited<ReturnType<typeof requireAdmin>>>["supabase"]) {
  const { data, error } = await supabase
    .from(COMMUNITY_LINKS_TABLE)
    .select(COLUMNS)
    .order("kind", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return { data, error };
}

export async function loadCommunityLinksAdminAction(): Promise<CommunityLinksAdminResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, code: "forbidden", error: FORBIDDEN.error };

  const { data, error } = await readAll(admin.supabase);
  if (error) {
    if (isMissingCommunityLinks(error)) return { success: false, code: "migration_missing", error: MIGRATION_MISSING };
    console.error("[community-links] admin load failed", { code: error.code });
    return { success: false, code: "load_failed", error: "No pudimos cargar los enlaces. Probá de nuevo." };
  }

  const links = ((data ?? []) as unknown[]).map(rowToAdminLink).filter((link): link is CommunityLinkAdmin => link !== null);
  return { success: true, links };
}

export async function createCommunityLinkAction(input: unknown): Promise<SaveCommunityLinkResult> {
  const admin = await requireAdmin();
  if (!admin) return FORBIDDEN;

  const parsed = normalizeCommunityLinkInput(input);
  if (!parsed.ok) return { success: false, error: "Revisá los datos del formulario.", fieldErrors: parsed.errors };
  const value = parsed.value;

  // El nuevo elemento va al final de su lista; el orden lo fija el servidor, no el cliente.
  const { data: existing, error: existingError } = await admin.supabase
    .from(COMMUNITY_LINKS_TABLE)
    .select("kind, sort_order")
    .eq("kind", value.kind);
  if (existingError) {
    if (isMissingCommunityLinks(existingError)) return { success: false, error: MIGRATION_MISSING };
    console.error("[community-links] create precheck failed", { code: existingError.code });
    return { success: false, error: "No pudimos guardar el enlace. Probá de nuevo." };
  }
  const sortOrder = nextSortOrder(
    ((existing ?? []) as { kind: string; sort_order: number }[]).flatMap((row) =>
      isCommunityKind(row.kind) ? [{ kind: row.kind, sortOrder: row.sort_order }] : [],
    ),
    value.kind,
  );

  const { data, error } = await admin.supabase
    .from(COMMUNITY_LINKS_TABLE)
    .insert({
      kind: value.kind,
      platform: value.platform,
      name: value.name,
      channel_type: value.channelType,
      description: value.description,
      url: value.url,
      icon_key: value.iconKey,
      access_level: value.accessLevel,
      is_active: value.isActive,
      sort_order: sortOrder,
    })
    .select(COLUMNS)
    .single();

  const link = data ? rowToAdminLink(data) : null;
  if (error || !link) {
    console.error("[community-links] create failed", { code: error?.code });
    return { success: false, error: "No pudimos guardar el enlace. Probá de nuevo." };
  }
  return { success: true, link };
}

export async function updateCommunityLinkAction(id: unknown, input: unknown): Promise<SaveCommunityLinkResult> {
  const admin = await requireAdmin();
  if (!admin) return FORBIDDEN;
  if (typeof id !== "string" || !UUID_RE.test(id)) return { success: false, error: "El enlace indicado no es válido." };

  const parsed = normalizeCommunityLinkInput(input);
  if (!parsed.ok) return { success: false, error: "Revisá los datos del formulario.", fieldErrors: parsed.errors };
  const value = parsed.value;

  // El tipo (red social / canal) no se cambia al editar: mover un elemento entre listas rompería su orden.
  const { data, error } = await admin.supabase
    .from(COMMUNITY_LINKS_TABLE)
    .update({
      platform: value.platform,
      name: value.name,
      channel_type: value.channelType,
      description: value.description,
      url: value.url,
      icon_key: value.iconKey,
      access_level: value.accessLevel,
      is_active: value.isActive,
    })
    .eq("id", id)
    .eq("kind", value.kind)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[community-links] update failed", { code: error.code });
    return { success: false, error: "No pudimos guardar el enlace. Probá de nuevo." };
  }
  const link = data ? rowToAdminLink(data) : null;
  if (!link) return { success: false, error: "El enlace ya no existe. Actualizá la página." };
  return { success: true, link };
}

export async function setCommunityLinkActiveAction(id: unknown, isActive: unknown): Promise<SaveCommunityLinkResult> {
  const admin = await requireAdmin();
  if (!admin) return FORBIDDEN;
  if (typeof id !== "string" || !UUID_RE.test(id) || typeof isActive !== "boolean") {
    return { success: false, error: "El cambio solicitado no es válido." };
  }

  const { data, error } = await admin.supabase
    .from(COMMUNITY_LINKS_TABLE)
    .update({ is_active: isActive })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[community-links] toggle failed", { code: error.code });
    return { success: false, error: "No pudimos guardar el cambio. Probá de nuevo." };
  }
  const link = data ? rowToAdminLink(data) : null;
  if (!link) return { success: false, error: "El enlace ya no existe. Actualizá la página." };
  return { success: true, link };
}

export async function deleteCommunityLinkAction(id: unknown): Promise<CommunityLinkMutationResult> {
  const admin = await requireAdmin();
  if (!admin) return FORBIDDEN;
  if (typeof id !== "string" || !UUID_RE.test(id)) return { success: false, error: "El enlace indicado no es válido." };

  const { error } = await admin.supabase.from(COMMUNITY_LINKS_TABLE).delete().eq("id", id);
  if (error) {
    console.error("[community-links] delete failed", { code: error.code });
    return { success: false, error: "No pudimos eliminar el enlace. Probá de nuevo." };
  }
  return { success: true };
}

/** `ids` es el orden final completo de un tipo. La RPC lo aplica en una sola sentencia (atómico). */
export async function reorderCommunityLinksAction(kind: unknown, ids: unknown): Promise<CommunityLinkMutationResult> {
  const admin = await requireAdmin();
  if (!admin) return FORBIDDEN;
  if (
    !isCommunityKind(kind) ||
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 200 ||
    !ids.every((id): id is string => typeof id === "string" && UUID_RE.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return { success: false, error: "El orden indicado no es válido." };
  }

  const { error } = await admin.supabase.rpc("reorder_community_links", { p_kind: kind, p_ids: ids });
  if (error) {
    console.error("[community-links] reorder failed", { code: error.code });
    return { success: false, error: "No pudimos guardar el nuevo orden. Probá de nuevo." };
  }
  return { success: true };
}
