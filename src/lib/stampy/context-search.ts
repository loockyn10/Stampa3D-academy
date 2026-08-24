import { SupabaseClient } from "@supabase/supabase-js";

function cleanText(value?: string | null): string {
  if (!value) return "";
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

export async function getStampyRelevantContexts({
  supabase,
  message,
  currentPath,
  lessonId,
  courseId,
  limit = 5,
}: {
  supabase: SupabaseClient;
  message: string;
  currentPath?: string | null;
  lessonId?: string | null;
  courseId?: string | null;
  limit?: number;
}) {
  try {
    const { data: activeContexts, error } = await supabase
      .from("stampy_page_contexts")
      .select("id, title, context, route_pattern, match_type, priority, suggested_questions, related_tools")
      .eq("is_active", true);

    if (error) {
      console.error("[Stampy] Error fetching active contexts", error);
      return { text: "", contexts: [], contextsCount: 0 };
    }

    if (!activeContexts || activeContexts.length === 0) {
      return { text: "", contexts: [], contextsCount: 0 };
    }

    const cleanMsg = cleanText(message);
    const msgWords = cleanMsg.split(/\s+/).filter(w => w.length > 3);
    
    // Scoring
    const scoredContexts = activeContexts.map(ctx => {
      let score = 0;
      
      // 1. Path match
      if (currentPath) {
        if (ctx.match_type === "exact" && currentPath === ctx.route_pattern) {
          score += 10;
        } else if (ctx.match_type === "prefix" && currentPath.startsWith(ctx.route_pattern)) {
          score += 7;
        }
      }

      // 2. Keyword/Title match
      const cleanTitle = cleanText(ctx.title);
      if (cleanTitle && cleanMsg.includes(cleanTitle)) {
        score += 5; // title found as phrase
      }
      
      msgWords.forEach(word => {
        if (cleanTitle.includes(word)) score += 3;
      });

      // 3. Content match
      const cleanContent = cleanText(ctx.context);
      msgWords.forEach(word => {
        if (cleanContent.includes(word)) score += 1;
      });
      
      return {
        ...ctx,
        score
      };
    });

    // Sort by score desc, then priority desc
    const sorted = scoredContexts
      .filter(c => c.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.priority || 0) - (a.priority || 0);
      })
      .slice(0, limit);

    if (sorted.length === 0) {
      return { text: "", contexts: [], contextsCount: 0 };
    }

    // Prepare prompt text, limit to ~5000 chars total
    let totalChars = 0;
    const maxChars = 5000;
    
    let text = "CONTEXTOS OFICIALES DE STAMPY:\nEstos bloques son conocimiento editable de Academia Stampa. Usalos como referencia oficial cuando respondas sobre la plataforma.\n\n";
    totalChars += text.length;
    
    const finalContexts = [];

    for (const ctx of sorted) {
      const block = `Contexto: ${ctx.title}\nRuta relacionada: ${ctx.route_pattern}\nContenido:\n${ctx.context}\n\n`;
      
      if (totalChars + block.length > maxChars) {
        // If single block is too large, we could truncate it, but let's just skip it if it's not the first one.
        if (finalContexts.length > 0) break;
      }
      
      text += block;
      totalChars += block.length;
      finalContexts.push({
        id: ctx.id,
        title: ctx.title,
        route: ctx.route_pattern,
        score: ctx.score
      });
    }
    
    text += "Reglas:\n- Usar estos contextos cuando sean relevantes.\n- Si el usuario pregunta dónde hacer algo, priorizar rutas de estos contextos.\n- No inventar rutas si no están en contextos.\n- Si no hay contexto relevante, responder con conocimiento general.\n";

    return {
      text,
      contexts: finalContexts,
      contextsCount: finalContexts.length
    };
    
  } catch (err) {
    console.error("[Stampy] Exception scoring contexts", err);
    return { text: "", contexts: [], contextsCount: 0 };
  }
}
