"use server";

import { createClient } from "@/utils/supabase/server";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { isFeatureAvailable, isPathAvailable } from "@/lib/features/server";

export interface StampyPageContext {
  source: "page";
  pathname: string;
  pageTitle: string;
  pageDescription: string;
  userIntentHints?: string[];
  relatedRoutes?: string[];
  toolKey?: string;
  suggestedQuestions?: string[];
  dbContext?: string;
}

const GENERIC_PAGE_CONTEXT = (pathname: string): StampyPageContext => ({
  source: "page",
  pathname,
  pageTitle: "Academia Stampa",
  pageDescription: "Estás navegando por la plataforma. Stampy no tiene un contexto específico para esta sección.",
});

export async function fetchStampyPageContext(pathname: string): Promise<StampyPageContext> {
  const supabase = await createClient();

  let access: Awaited<ReturnType<typeof getCurrentUserAccess>>["access"];
  try {
    // Contexto de una herramienta deshabilitada (o con Stampy deshabilitado): solo el genérico, sin copy ni rutas relacionadas.
    access = (await getCurrentUserAccess(supabase)).access;
    if (
      !(await isFeatureAvailable(supabase, "stampy", access)) ||
      !(await isPathAvailable(supabase, pathname, access))
    ) {
      return GENERIC_PAGE_CONTEXT(pathname);
    }
  } catch {
    return GENERIC_PAGE_CONTEXT(pathname);
  }

  try {
    const { data: contexts, error } = await supabase
      .from("stampy_page_contexts")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: false });

    if (error) {
      console.error("[Stampy] page context DB error", error);
    } else if (contexts && contexts.length > 0) {
      // Exact match first
      let bestMatch = contexts.find(c => c.match_type === 'exact' && c.route_pattern === pathname);
      
      // Then prefix match
      if (!bestMatch) {
        bestMatch = contexts.find(c => c.match_type === 'prefix' && pathname.startsWith(c.route_pattern));
      }

      if (bestMatch) {
        // Las herramientas relacionadas que son rutas deshabilitadas no se ofrecen.
        const relatedTools: string[] = [];
        for (const tool of (bestMatch.related_tools || []) as string[]) {
          if (!tool.startsWith("/") || (await isPathAvailable(supabase, tool, access))) relatedTools.push(tool);
        }
        return {
          source: "page",
          pathname,
          pageTitle: bestMatch.title,
          pageDescription: bestMatch.context,
          dbContext: bestMatch.context, // raw string
          suggestedQuestions: bestMatch.suggested_questions || [],
          relatedRoutes: relatedTools, // we reuse related_routes array for tools if needed
          toolKey: relatedTools.length > 0 ? relatedTools[0] : undefined,
        };
      }
    }
  } catch (err) {
    console.error("[Stampy] page context failed", err);
  }

  // Fallback if no match
  return GENERIC_PAGE_CONTEXT(pathname);
}
