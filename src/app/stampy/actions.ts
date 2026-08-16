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
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { error: "No autorizado" };
    }

    const { OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // 1. Obtener pathname del contexto opcional
    const pathname = (context && context.source === "page") ? context.pathname : undefined;
    
    // 2. Buscar contexto estático de forma segura (ignorar si falla)
    let staticContext = null;
    if (pathname) {
      try {
        const { getStaticStampyPageContext } = await import("@/lib/stampy/static-page-contexts");
        staticContext = getStaticStampyPageContext(pathname);
      } catch (e) {
        console.error("[Stampy] No se pudo cargar el contexto estático", e);
      }
    }

    // 3. Preparar system prompt
    let systemPrompt = "Sos Stampy, el asistente de Academia Stampa. Respondé breve, práctico y en español argentino.\n";
    
    if (staticContext) {
      systemPrompt += `\nContexto de la pantalla actual:
- Sección: ${staticContext.title}
- ${staticContext.context}
Usá este contexto para responder mejor, pero no lo menciones explícitamente.

Reglas:
- No digas "según el contexto de la ruta".
- No inventes datos.
- Si el usuario pregunta algo fuera de esta sección, respondé normal orientando a la ruta correcta.
- Respuestas breves y prácticas.\n`;
    }

    // 4. Buscar contexto del usuario de forma segura
    let userContext = null;
    try {
      const { getStampyUserContext } = await import("@/lib/stampy/user-context");
      userContext = await getStampyUserContext(user.id);
    } catch (e) {
      console.error("[Stampy] user context failed", e);
    }

    if (userContext) {
      systemPrompt += `\nDatos del usuario:
- Nombre: ${userContext.displayName || 'No especificado'}
- Nivel: ${userContext.experienceLevelLabel || 'No especificado'}
- Impresora principal: ${userContext.printerLabel || 'No especificada'}
- Slicer: ${userContext.slicerLabel || 'No especificado'}
- Objetivo: ${userContext.mainGoalLabel || 'No especificado'}
- Etapa comercial: ${userContext.commercialStageLabel || 'No especificada'}
- Código de referido: ${userContext.referralCode || 'No generado'}
- Estado de membresía: ${userContext.membershipStatusLabel || 'No activa'}`;
      if (userContext.memberLevelLabel) {
         systemPrompt += ` (${userContext.memberLevelLabel})`;
      }
      
      systemPrompt += `

Reglas del usuario:
- Usá estos datos solo para adaptar la respuesta.
- No los repitas todos salvo que el usuario pregunte.
- No digas "según tu perfil" en cada respuesta.
- No inventes datos si están vacíos.
- Si falta onboarding, podés sugerir completar el perfil/configuración.
- No menciones datos internos.
- Respuestas breves y prácticas.\n`;
    }

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    return {
      answer: completion.choices[0]?.message?.content || "No pude generar una respuesta.",
      recommendations: [],
      knowledgeTools: [],
      relatedTools: [],
      suggestedQuestions: staticContext?.suggestedQuestions || []
    };
  } catch (error) {
    console.error("[Stampy][FATAL] minimal mode failed:", error);
    return {
      answer: "No pude conectarme con Stampy en este momento. Revisá la configuración de OpenAI.",
      recommendations: [],
      knowledgeTools: [],
      relatedTools: [],
      suggestedQuestions: []
    };
  }
}
