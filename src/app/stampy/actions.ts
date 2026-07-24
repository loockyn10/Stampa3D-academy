"use server";

import { createClient } from "@/utils/supabase/server";
export async function askStampyAction(message: string) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "No autorizado" };
  }

  // Fetch recommendable lessons
  const { data: lessons, error } = await supabase
    .from('lessons')
    .select(`
      id, title, description, ai_summary, ai_topics, ai_problems, ai_level, ai_related_tool,
      course_modules!inner (
        id, title,
        courses!inner (id, title, slug)
      )
    `)
    .eq('is_ai_recommendable', true);

  if (error || !lessons) {
    console.error("Stampy DB error", error);
    return { 
      answer: "No pude buscar recomendaciones en este momento. Probá de nuevo.",
      recommendations: [],
      relatedTools: []
    };
  }

  const q = message.toLowerCase();
  
  const scoredLessons = lessons.map((l: any) => {
    let score = 0;
    const ai_problems = Array.isArray(l.ai_problems) ? l.ai_problems : [];
    const ai_topics = Array.isArray(l.ai_topics) ? l.ai_topics : [];
    
    // si la consulta contiene una frase de ai_problems: +5
    ai_problems.forEach((p: string) => {
      if (p && q.includes(p.toLowerCase())) score += 5;
    });

    // si contiene un tema de ai_topics: +3
    ai_topics.forEach((t: string) => {
      if (t && q.includes(t.toLowerCase())) score += 3;
    });

    // si coincide con title: +2
    if (l.title && q.includes(l.title.toLowerCase())) score += 2;

    // si coincide con ai_summary: +1
    if (l.ai_summary && q.includes(l.ai_summary.toLowerCase())) score += 1;
    
    // si hay palabras clave relacionadas con ai_related_tool: +1
    if (l.ai_related_tool && q.includes(l.ai_related_tool.toLowerCase())) score += 1;

    // fallback
    if (score === 0 && l.description && q.includes(l.description.toLowerCase())) score += 1;

    return { ...l, _score: score };
  });

  const sorted = scoredLessons.sort((a, b) => b._score - a._score);
  const contextRecommendations = sorted.filter(l => l._score > 0).slice(0, 5);
  const topRecommendations = contextRecommendations.slice(0, 3); // UI gets top 3

  let answer = "";
  let fallbackUsed = false;

  const relatedToolsSet = new Set<string>();
  topRecommendations.forEach(l => {
    if (l.ai_related_tool && l.ai_related_tool !== 'ninguna') {
      relatedToolsSet.add(l.ai_related_tool);
    }
  });
  
  if (q.includes('presupuesto') || q.includes('cobrar') || q.includes('precio') || q.includes('costo')) relatedToolsSet.add('calculadora');
  if (q.includes('stock') || q.includes('filamento') || q.includes('material')) relatedToolsSet.add('stock');

  const relatedToolsList = Array.from(relatedToolsSet);

  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY no encontrada. Usando fallback de Stampy.");
    fallbackUsed = true;
  } else {
    try {
      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const systemPrompt = `Sos Stampy, el asistente de Academia Stampa.

Tu función es ayudar a alumnos de impresión 3D a entender qué les está pasando y guiarlos hacia las clases o herramientas correctas de la plataforma.

Reglas:
- Respondé en español rioplatense, claro y práctico.
- No uses respuestas largas.
- Primero orientá el problema en pocas líneas.
- Después recomendá clases si fueron provistas en el contexto.
- Solo podés recomendar clases incluidas en el contexto.
- No inventes cursos, módulos, clases, links ni herramientas.
- Si no hay una clase exacta, decilo con honestidad.
- Si el problema parece técnico, sugerí pasos concretos para revisar.
- Si el problema es de precios, costos o ventas, orientá hacia calculadora, presupuestos o productos si aparecen como herramientas relacionadas.
- No des consejos peligrosos.
- No prometas resultados garantizados.
- No digas que sos ChatGPT.
- Tu nombre es Stampy.

Formato recomendado:
1. Diagnóstico breve.
2. Qué revisaría primero.
3. Clase recomendada, si existe.
4. Herramienta recomendada, si existe.`;

      const contextObj = contextRecommendations.map(l => ({
        lessonId: l.id,
        lessonTitle: l.title,
        courseTitle: l.course_modules?.courses?.title,
        moduleTitle: l.course_modules?.title,
        aiSummary: l.ai_summary,
        topics: l.ai_topics,
        problems: l.ai_problems,
        level: l.ai_level,
        relatedTool: l.ai_related_tool,
        score: l._score
      }));

      const userPromptWithContext = `Consulta del usuario:
"${message}"

Clases encontradas:
${JSON.stringify(contextObj, null, 2)}

Herramientas disponibles encontradas para este caso:
${relatedToolsList.length > 0 ? relatedToolsList.join(", ") : "Ninguna"}`;

      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini", // Use gpt-4o-mini as gpt-5-mini doesn't exist yet typically but using the fallback pattern
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPromptWithContext }
        ]
      });

      answer = response.choices[0]?.message?.content || "";
      if (!answer) fallbackUsed = true;
      
    } catch (err) {
      console.error("Error llamando a OpenAI:", err);
      fallbackUsed = true;
    }
  }

  if (fallbackUsed) {
    if (topRecommendations.length > 0) {
      answer = "Pude encontrar algunas clases relacionadas, pero no pude generar una respuesta avanzada en este momento. Te recomiendo empezar por estas clases:";
    } else {
      answer = "Todavía no encontré una clase exacta para eso. Te puedo orientar de forma general, pero conviene cargar más metadata en las clases para que Stampy recomiende mejor.";
    }
  }

  return {
    answer,
    recommendations: topRecommendations,
    relatedTools: relatedToolsList
  };
}
