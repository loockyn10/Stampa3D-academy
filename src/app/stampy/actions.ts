"use server";

import { createClient } from "@/utils/supabase/server";
import { getStampyUserContext } from "@/lib/stampy/user-context";
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
      dbContext?: string; // New: context directly from database
      userIntentHints?: string[];
      relatedRoutes?: string[];
      toolKey?: string;
      suggestedQuestions?: string[];
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

  const userContext = await getStampyUserContext(user.id);

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
  
  const searchQueries = isDependent && recentUserMessages.length > 0
    ? [...recentUserMessages, currentQuery]
    : [currentQuery];
  
  const relevantLessons = lessons.filter(lesson => {
    let score = 0;
    for (const q of searchQueries) {
      if (includesUsefulNeedle(lesson.title, q)) score += 5;
      if (includesUsefulNeedle(lesson.description, q)) score += 3;
      if (includesUsefulNeedle(lesson.ai_summary, q)) score += 4;
      if (lesson.ai_topics?.some((t: string) => includesUsefulNeedle(t, q))) score += 3;
      if (lesson.ai_problems?.some((p: string) => includesUsefulNeedle(p, q))) score += 4;
    }
    return score > 0;
  });

  const knowledgeItems = [
    { id: 'calculator-basic', route: '/calculadora', keywords: ['calculadora', 'precio', 'cotizar', 'cobrar', 'costo', 'ganancia', 'margen', 'markup'] },
    { id: 'calculator-advanced', route: '/calculadora', keywords: ['calculadora avanzada', 'desglose', 'electricidad', 'amortizacion', 'envio', 'comision', 'mano de obra'] },
    { id: 'budgets', route: '/presupuestos', keywords: ['presupuesto', 'cotizacion', 'cliente', 'pdf', 'enviar precio'] },
    { id: 'products', route: '/productos', keywords: ['catalogo', 'producto', 'guardar precio', 'piezas', 'repetitivo'] },
    { id: 'filament-stock', route: '/stock', keywords: ['stock', 'filamento', 'rollo', 'inventario', 'colores', 'material'] },
    { id: 'finished-product-stock', route: '/stock', keywords: ['stock', 'producto terminado', 'inventario'] },
    { id: 'courses', route: '/cursos', keywords: ['cursos', 'aprender', 'formacion', 'clases', 'estudiar'] },
    { id: 'workshops', route: '/talleres', keywords: ['taller', 'proyecto', 'practica', 'paso a paso'] },
    { id: 'academy', route: '/academia', keywords: ['academia', 'empezar', 'ruta'] },
    { id: 'stl-library', route: '/libreria-stl', keywords: ['stl', 'descargar', 'modelo', '3d', 'archivo'] },
    { id: 'raffles', route: '/sorteos', keywords: ['sorteo', 'ganar', 'beneficio', 'premio'] },
    { id: 'community', route: '/canales', keywords: ['comunidad', 'grupo', 'telegram', 'whatsapp', 'ayuda', 'foro'] },
  ];

  let contextRecommendations = relevantLessons;
  if (context && context.source === 'lesson') {
    const currentLessonModuleId = context.lessonId 
      ? lessons.find(l => l.id === context.lessonId)?.course_modules 
        ? (lessons.find(l => l.id === context.lessonId)?.course_modules as any).id 
        : null
      : null;
    
    if (currentLessonModuleId) {
      const sameModuleLessons = lessons.filter(l => 
        (l.course_modules as any)?.id === currentLessonModuleId && 
        l.id !== context.lessonId
      );
      
      const others = relevantLessons.filter(l => (l.course_modules as any)?.id !== currentLessonModuleId);
      contextRecommendations = [...sameModuleLessons, ...others];
    }
  }

  const topRecommendations = contextRecommendations.slice(0, 3).map(l => ({
    ...l,
    courseKind: (l.course_modules as any)?.courses?.course_kind || "course"
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

  // Si hay contexto de página y tiene toolKey relacionada (desde BD)
  if (context && context.source === 'page' && context.relatedRoutes) {
    context.relatedRoutes.forEach(rt => {
       relatedToolsList.push(rt);
    });
  }

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
Contexto Base de Datos: ${context.dbContext || 'Sin contexto base'}

Reglas adicionales para respuesta en pantalla:
- Usá este contexto para responder más útilmente.
- Si el usuario pregunta "qué hago acá" o "cómo funciona", explicá brevemente para qué sirve esta sección en base al contexto.
- Priorizá orientar usando esta herramienta/sección si la pregunta se relaciona con ella.
- No digas "según el contexto cargado" o provisto.
- Si el usuario pregunta algo fuera de esta pantalla, podés responder normal orientando a la ruta correcta.
- Mantené respuestas breves y prácticas.\n\n`;
      }
      
      if (userContext) {
        systemPrompt += `CONTEXTO DEL USUARIO:
- Nombre: ${userContext.displayName || userContext.fullName || 'No especificado'}
- Nivel: ${userContext.experienceLevel || 'No especificado'}
- Impresora principal: ${userContext.printerBrand || 'No especificada'}${userContext.printerModel ? ` (${userContext.printerModel})` : ''}
- Slicer: ${userContext.slicerPreference || 'No especificado'}
- Objetivo: ${userContext.mainGoal || 'No especificado'}
- Etapa comercial: ${userContext.commercialStage || 'No especificada'}
- Ruta recomendada: ${userContext.recommendedPathTitle || 'No especificada'}
- Código de referido: ${userContext.referralCode || 'No generado'}
- Estado de membresía: ${userContext.membershipStatus || 'No activa'}

Reglas para el contexto del usuario:
- Usá estos datos para adaptar la respuesta a su situación.
- No menciones todos los datos a menos que sea relevante.
- No digas "según tu perfil" ni "como me indica tu contexto" todo el tiempo. Sé natural.
- Si faltan datos clave (ej. no sabes su nivel o su impresora), podés sugerirle sutilmente que complete su perfil/configuración para ayudarlo mejor.
- No inventes datos que estén como "No especificado".\n\n`;
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
        courseTitle: (l.course_modules as any)?.courses?.title,
        moduleTitle: (l.course_modules as any)?.title,
        aiSummary: l.ai_summary,
        topics: l.ai_topics,
        problems: l.ai_problems,
        level: l.ai_level,
        relatedTool: l.ai_related_tool
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
${JSON.stringify(knowledgeItems.map(k => ({ id: k.id, route: k.route, keywords: k.keywords })), null, 2)}
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
