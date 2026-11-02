import { createClient } from "@supabase/supabase-js";
import { loadCommunityLinks, type CommunityLinksResult } from "./server";

/**
 * Enlaces públicos para páginas sin sesión (landing). Usa la clave anónima sin cookies, así la página puede
 * regenerarse (ISR) en vez de renderizarse por request. Un cliente anónimo solo recibe filas de nivel «público».
 */
export async function loadPublicCommunityLinks(): Promise<CommunityLinksResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { links: [], status: "error" };
  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return loadCommunityLinks(supabase);
}
