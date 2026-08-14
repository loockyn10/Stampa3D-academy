"use server";

import { createClient } from "@/utils/supabase/server";
export type StampyContextPayload =
  | {
      source: "lesson";
      courseTitle?: string;
      moduleTitle?: string;
      lessonId?: string;
      lessonTitle?: string;
      lessonDescription?: string;
      lessonSummary?: string;
      lessonTopics?: string[];
      lessonProblems?: string[];
      lessonLevel?: string;
      relatedTool?: string;
      transcript?: string;
    }
  | {
      source: "page";
      pathname?: string;
      pageTitle?: string;
      pageDescription?: string;
      userIntentHints?: string[];
      relatedRoutes?: string[];
      toolKey?: string;
    };

function cleanText(value?: string | null): string {
  if (!value) return "";
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function isUsefulText(value?: string | null): boolean {
  const cleaned = cleanText(value);
  return (
    cleaned.length >= 4 &&
    cleaned !== "empty" &&
    cleaned !== "null" &&
    cleaned !== "pendiente" &&
    cleaned !== "sin resumen" &&
    cleaned !== "sin descripcion"
  );
}

function includesUsefulNeedle(haystack: string, needle?: string | null) {
  const cleanedNeedle = cleanText(needle);
  if (!isUsefulText(cleanedNeedle)) return false;
  return haystack.includes(cleanedNeedle);
}

export async function askStampyAction(
  message: string,
  conversation?: { role: "user" | "assistant"; content: string }[],
  context?: StampyContextPayload
) {
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
        courses!inner (id, title, slug, status, course_kind)
      )
    `)
    .eq('is_ai_recommendable', true)
    .eq('course_modules.courses.status', 'published');

  if (error || !lessons) {
    console.error("Stampy DB error", error);
    return { 
      answer: "No pude buscar recomendaciones en este momento. Probá de nuevo.",
      recommendations: [],
      relatedTools: []
    };
  }

  // Limitar/sanear conversation
  let recentConversation = conversation ? conversation.slice(-6) : [];
  recentConversation = recentConversation.map(msg => ({
    role: (msg.role === 'assistant' ? 'assistant' : 'user') as "user" | "assistant",
    content: (msg.content || '').trim().substring(0, 500)
  })).filter(msg => msg.content.length > 0);

  const safeMessage = message.substring(0, 1000);
  const currentQuery = cleanText(safeMessage);

  const dependentPhrases = ["eso", "explicamelo", "y eso?", "que significa", "como lo arreglo", "no entendi", "lo anterior", "esa clase", "ese problema", "y los"];
  const isDependent = currentQuery.length < 25 || dependentPhrases.some(p => currentQuery.includes(p));

  const recentUserMessages = recentConversation.filter(msg => msg.role === 'user').slice(-2).map(m => m.content);
  
  let searchQuery = currentQuery;
  if (isDependent && recentUserMessages.length > 0) {
    searchQuery = cleanText(recentUserMessages.join(" ") + " " + safeMessage);
  }
  const evaluateLessons = (queryToUse: string) => {
    return lessons.map((l: any) => {
      let score = 0;
      let reasons: string[] = [];
      const ai_problems = Array.isArray(l.ai_problems) ? l.ai_problems : [];
      const ai_topics = Array.isArray(l.ai_topics) ? l.ai_topics : [];
      
      ai_problems.forEach((p: string) => {
        if (includesUsefulNeedle(queryToUse, p)) { score += 5; reasons.push(`problem: ${p} +5`); }
      });

      ai_topics.forEach((t: string) => {
        if (includesUsefulNeedle(queryToUse, t)) { score += 3; reasons.push(`topic: ${t} +3`); }
      });

      if (includesUsefulNeedle(queryToUse, l.title)) { score += 2; reasons.push(`title: ${l.title} +2`); }
      if (includesUsefulNeedle(queryToUse, l.ai_summary)) { score += 1; reasons.push(`summary: match +1`); }
      if (includesUsefulNeedle(queryToUse, l.ai_related_tool)) { score += 1; reasons.push(`tool: ${l.ai_related_tool} +1`); }
      if (score === 0 && includesUsefulNeedle(queryToUse, l.description)) { score += 1; reasons.push(`description: match +1`); }

      if (process.env.NODE_ENV === 'development' && score > 0) {
        console.log("[Stampy lesson score]", l.title, score, reasons);
      }

      return { ...l, _score: score };
    }).sort((a: any, b: any) => b._score - a._score);
  };

  let scoredLessons = evaluateLessons(currentQuery);
  let contextRecommendations = scoredLessons.filter(l => l._score >= 3).slice(0, 5);

  const { findRelevantKnowledge } = await import("@/lib/stampy/knowledge-search");
  let knowledgeItems = findRelevantKnowledge(currentQuery);

  const isLessonEmpty = contextRecommendations.length === 0;
  const isKnowledgeEmpty = knowledgeItems.length === 0;

  if ((isLessonEmpty || isKnowledgeEmpty) && isDependent && recentUserMessages.length > 0) {
    if (isLessonEmpty) {
      scoredLessons = evaluateLessons(searchQuery);
      contextRecommendations = scoredLessons.filter(l => l._score >= 3).slice(0, 5);
    }
    if (isKnowledgeEmpty) {
      knowledgeItems = findRelevantKnowledge(searchQuery);
    }
  }

  const topRecommendations = contextRecommendations.slice(0, 3).map(l => ({
    ...l,
    courseKind: l.course_modules?.courses?.course_kind || "course"
  })); // UI gets top 3

  let answer = "";
  let fallbackUsed = false;

  const relatedToolsSet = new Set<string>();
  topRecommendations.forEach(l => {
    if (l.ai_related_tool && l.ai_related_tool !== 'ninguna') {
      relatedToolsSet.add(l.ai_related_tool);
    }
  });

  const relatedToolsList = Array.from(relatedToolsSet);
  
  // Agregamos ids a relatedToolsList si no estaban, por compatibilidad con el UI viejo
  knowledgeItems.forEach(k => {
    if (k.route && !relatedToolsList.includes(k.id)) {
      // Mapeamos ids de knowledge a ids de frontend viejo si coincide
      if (k.id === 'calculator-basic' || k.id === 'calculator-advanced') relatedToolsList.push('calculadora');
      if (k.id === 'budgets') relatedToolsList.push('presupuestos');
      if (k.id === 'products') relatedToolsList.push('productos');
      if (k.id === 'filament-stock' || k.id === 'finished-product-stock') relatedToolsList.push('stock');
      if (k.id === 'courses') relatedToolsList.push('cursos');
      if (k.id === 'workshops') relatedToolsList.push('talleres');
      if (k.id === 'academy') relatedToolsList.push('academia');
      if (k.id === 'stl-library') relatedToolsList.push('libreria-stl');
      if (k.id === 'raffles') relatedToolsList.push('sorteos');
      if (k.id === 'community') relatedToolsList.push('comunidad');
    }
  });

  // Filtramos duplicates (ej. si calculator-basic y advanced metieron 2 'calculadora')
  const uniqueRelatedToolsList = Array.from(new Set(relatedToolsList));

  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY no encontrada. Usando fallback de Stampy.");
    fallbackUsed = true;
  } else {
    try {
      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      let systemPrompt = `Sos Stampy, el asistente inteligente de Academia Stampa.

`;
      
      if (context && context.source === 'lesson') {
        systemPrompt += `ACTUALMENTE EL USUARIO ESTÁ VIENDO UNA CLASE.
Contexto de la clase actual:
Curso: ${context.courseTitle || ''}
Módulo: ${context.moduleTitle || ''}
Clase: ${context.lessonTitle || ''}
Descripción: ${context.lessonDescription || ''}
Resumen IA: ${context.lessonSummary || ''}
Temas: ${context.lessonTopics?.join(', ') || ''}
Problemas resueltos: ${context.lessonProblems?.join(', ') || ''}
Nivel: ${context.lessonLevel || ''}
Transcripción parcial: ${context.transcript ? context.transcript.substring(0, 12000) : 'No disponible'}

Reglas para respuestas en clase:
- Debes responder usando PRIMERO el contexto de la clase.
- Si hay transcripción, úsala como referencia principal.
- No digas "según el contexto provisto".
- No inventes cosas que no estén en la clase.
- Si el usuario pregunta algo fuera de la clase, respóndele y oriéntalo a la herramienta o curso correspondiente.
- Mantén un tono claro, cercano y útil. No uses estructuras robóticas.\n\n`;
      } else if (context && context.source === 'page') {
        systemPrompt += `El usuario está actualmente en esta pantalla de la plataforma:
Pantalla: ${context.pageTitle || ''}
Ruta: ${context.pathname || ''}
Descripción: ${context.pageDescription || ''}

Reglas adicionales para respuesta en pantalla:
- Si el usuario pregunta "qué hago acá" o "cómo funciona", explicá brevemente para qué sirve esta sección.
- Priorizá orientar usando esta herramienta/sección si la pregunta se relaciona con ella.
- No digas "según el contexto provisto".
- Si el usuario pregunta cómo navegar, indicá la ruta correcta.\n\n`;
      }
      
      systemPrompt += `Tu trabajo es escuchar al usuario, entender qué problema o situación tiene con impresión 3D, costos, ventas o gestión de taller, y guiarlo hacia la clase o herramienta correcta dentro de la plataforma.

Personalidad:
- Sos cercano, práctico y vivo.
- Tenés onda, pero no sos payaso.
- Hablás claro y directo.
- Adaptás tu tono al usuario. Si el usuario habla informal (ej: "bro", "lpm"), respondé con más cercanía. Si escribe formal, respondé más prolijo y profesional.
- Usás español rioplatense suave, entendible para cualquier hispanohablante.
- No respondés como informe.
- No usás plantillas rígidas ni listas numeradas a menos que el usuario pida pasos estrictos.

Reglas:
- Si el usuario pregunta por dónde empezar, puedes mandarlo a la sección Academia para ver su ruta recomendada.
- Si quiere formación estructurada, mándalo a Cursos.
- Si quiere proyectos prácticos, mándalo a Talleres.
- Si el usuario expresa una intención clara (ej: "quiero hacer un presupuesto", "cuánto cobrar", "organizar stock"), NO le pidas más datos (ni dimensiones, ni material, ni plazos).
- Si hay una herramienta para eso, respondes con una orientación corta, explicás brevemente el flujo y lo mandás a la herramienta.
- NO intentes hacer cálculos, presupuestos ni gestión dentro del chat. Nunca digas "pasame los datos y te ayudo a calcularlo".
- Usá las herramientas y flujos relevantes de Academia Stampa para guiar al usuario.
- No inventes herramientas.
- No expliques pasos que contradigan la ficha de la herramienta.
- Si una herramienta relevante existe, priorizá llevar al usuario ahí en vez de pedir más datos.
- Solo podés hacer 1 o 2 preguntas concretas si la consulta técnica es muy ambigua (ej: "me imprime mal"). Ahí podés pedir material o qué defecto ve.
- No digas que sos ChatGPT.
- No digas "según el contexto provisto".
- No digas "no hay clases provistas en el contexto".
- No uses títulos fijos como "Diagnóstico breve", "Clase recomendada".
- No inventes cursos, clases, módulos, herramientas ni links.
- Solo podés mencionar clases incluidas en el contexto. La plataforma ya muestra las tarjetas abajo de tu mensaje.
- Si no hay una clase exacta en el contexto, decilo de forma natural (ej: "Todavía no veo una clase específica cargada para esto, pero el camino sería este...").
- No prometas resultados garantizados.
- Mantené respuestas cortas (máximo 120-150 palabras).

Forma ideal:
- 1 párrafo natural entendiendo el problema o intención.
- Si es claro, enviarlo a la herramienta (ej: "Arrancá por la Calculadora y después pasalo a Presupuestos. Abajo te las dejo").
- Si es técnico y requiere pasos, 2 o 3 puntos concretos.
- Cierre corto enviando a la clase o herramienta.`;

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

      const conversationContext = recentConversation.map(msg => 
        `${msg.role === 'user' ? 'Usuario' : 'Stampy'}: ${msg.content}`
      ).join("\n");

      const userPromptWithContext = `Contexto reciente de la conversación:
${conversationContext || "Ninguno"}

Usuario actual: "${safeMessage}"

Reglas adicionales:
- Usá el contexto reciente para entender respuestas cortas como "una A1", "PLA", "210 grados", "sí", "no", etc.
- No repitas preguntas que ya fueron respondidas.
- Si el usuario responde una pregunta previa, continuá el diagnóstico.
- Si la intención ya está clara, guiá hacia clase o herramienta.
- No pidas de nuevo impresora/material si ya aparece en el contexto reciente.

Clases encontradas:
${JSON.stringify(contextObj, null, 2)}

Herramientas disponibles encontradas para este caso:
${uniqueRelatedToolsList.length > 0 ? uniqueRelatedToolsList.join(", ") : "Ninguna"}

Base de conocimiento (herramientas/flujos recomendados):
${JSON.stringify(knowledgeItems.map(k => ({ title: k.title, route: k.route, shortDescription: k.shortDescription, whenToRecommend: k.whenToRecommend, howToUse: k.howToUse, relatedTools: k.relatedTools })), null, 2)}
`;

      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
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
    relatedTools: uniqueRelatedToolsList,
    knowledgeTools: knowledgeItems
  };
}
