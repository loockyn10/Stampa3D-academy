"use server";

import { createClient } from "@/utils/supabase/server";

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

export async function fetchStampyPageContext(pathname: string): Promise<StampyPageContext> {
  const supabase = await createClient();
  
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
        return {
          source: "page",
          pathname,
          pageTitle: bestMatch.title,
          pageDescription: bestMatch.context,
          dbContext: bestMatch.context, // raw string
          suggestedQuestions: bestMatch.suggested_questions || [],
          relatedRoutes: bestMatch.related_tools || [], // we reuse related_routes array for tools if needed
          toolKey: (bestMatch.related_tools && bestMatch.related_tools.length > 0) ? bestMatch.related_tools[0] : undefined,
        };
      }
    }
  } catch (err) {
    console.error("[Stampy] page context failed", err);
  }

  // Fallback if no match
  return {
    source: "page",
    pathname,
    pageTitle: "Academia Stampa",
    pageDescription: "Estás navegando por la plataforma. Stampy no tiene un contexto específico para esta sección.",
  };
}
