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
  
  if (q.includes('presupuesto') || q.includes('cotización') || q.includes('cotizacion') || q.includes('cliente') || q.includes('enviar precio')) {
    relatedToolsSet.add('presupuestos');
    relatedToolsSet.add('calculadora');
  }
  if (q.includes('cuánto cobrar') || q.includes('cuanto cobrar') || q.includes('precio') || q.includes('costo') || q.includes('margen') || q.includes('ganancia')) {
    relatedToolsSet.add('calculadora');
    relatedToolsSet.add('presupuestos');
  }
  if (q.includes('stock') || q.includes('filamento restante') || q.includes('inventario') || q.includes('material disponible')) {
    relatedToolsSet.add('stock');
  }
  if (q.includes('producto') || q.includes('catálogo') || q.includes('catalogo') || q.includes('pieza recurrente')) {
    relatedToolsSet.add('productos');
  }
  if (q.includes('curso') || q.includes('aprender') || q.includes('clase')) {
    relatedToolsSet.add('cursos');
  }

  const relatedToolsList = Array.from(relatedToolsSet);

  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY no encontrada. Usando fallback de Stampy.");
    fallbackUsed = true;
  } else {
    try {
      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const systemPrompt = `Sos Stampy, el asistente inteligente de Academia Stampa.

Tu trabajo es escuchar al usuario, entender qué problema o situación tiene con impresión 3D, costos, ventas o gestión de taller, y guiarlo hacia la clase o herramienta correcta dentro de la plataforma.

Personalidad:
- Sos cercano, práctico y vivo.
- Tenés onda, pero no sos payaso.
- Hablás claro y directo.
- Adaptás tu tono al usuario. Si el usuario habla informal (ej: "bro", "lpm"), respondé con más cercanía. Si escribe formal, respondé más prolijo y profesional.
- Usás español rioplatense suave, entendible para cualquier hispanohablante.
- No respondés como informe.
- No usás plantillas rígidas ni listas numeradas a menos que el usuario pida pasos estrictos.

Reglas:
- Si el usuario expresa una intención clara (ej: "quiero hacer un presupuesto", "cuánto cobrar", "organizar stock"), NO le pidas más datos (ni dimensiones, ni material, ni plazos).
- Si hay una herramienta para eso, respondes con una orientación corta, explicás brevemente el flujo y lo mandás a la herramienta.
- NO intentes hacer cálculos, presupuestos ni gestión dentro del chat. Nunca digas "pasame los datos y te ayudo a calcularlo".
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

      const userPromptWithContext = `Consulta del usuario:
"${message}"

Clases encontradas:
${JSON.stringify(contextObj, null, 2)}

Herramientas disponibles encontradas para este caso:
${relatedToolsList.length > 0 ? relatedToolsList.join(", ") : "Ninguna"}`;

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
    relatedTools: relatedToolsList
  };
}
