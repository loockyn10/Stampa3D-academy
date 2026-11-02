import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMUNITY_FALLBACK_LINKS,
  rowToCommunityLink,
  sortCommunityLinks,
  type CommunityLink,
  type CommunityKind,
} from "./links";

export const COMMUNITY_LINKS_TABLE = "community_links";

interface QueryError {
  code?: string | null;
  message?: string | null;
}

/** La tabla/RPC todavía no existe (migration sin aplicar): se usa el respaldo en vez de vaciar las pantallas. */
export function isMissingCommunityLinks(error: QueryError | null | undefined): boolean {
  if (!error) return false;
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "")) return true;
  return /community_links/.test(error.message ?? "") && /does not exist|schema cache|Could not find/i.test(error.message ?? "");
}

export interface CommunityLinksResult {
  links: CommunityLink[];
  /** `fallback`: migration sin aplicar. `error`: falló la lectura (se muestra vacío, nunca se inventan enlaces). */
  status: "ok" | "fallback" | "error";
}

/**
 * Enlaces activos para quien consulta. Es la RPC `list_community_links()` la que decide el acceso (RLS/membresía en
 * la base): una URL Premium solo llega a quien tiene acceso; al resto le llega `url = null` y `locked = true`.
 */
export async function loadCommunityLinks(
  supabase: Pick<SupabaseClient, "rpc">,
  options: { kind?: CommunityKind } = {},
): Promise<CommunityLinksResult> {
  try {
    const { data, error } = await supabase.rpc("list_community_links");
    if (error) {
      if (isMissingCommunityLinks(error)) return { links: filterKind(COMMUNITY_FALLBACK_LINKS, options.kind), status: "fallback" };
      console.error("[community-links] load failed", { code: error.code });
      return { links: [], status: "error" };
    }
    const links = ((data ?? []) as unknown[])
      .map(rowToCommunityLink)
      .filter((link): link is CommunityLink => link !== null);
    return { links: filterKind(sortCommunityLinks(links), options.kind), status: "ok" };
  } catch {
    console.error("[community-links] load threw");
    return { links: [], status: "error" };
  }
}

function filterKind<T extends CommunityLink>(links: readonly T[], kind?: CommunityKind): T[] {
  return kind ? links.filter((link) => link.kind === kind) : [...links];
}
