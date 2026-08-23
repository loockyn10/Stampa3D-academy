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

    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_status, role, membership_expires_at')
      .eq('id', user.id)
      .single();

    let hasAccess = profile?.role === 'admin';
    if (!hasAccess && profile?.membership_status === 'active') {
      const expiresAt = profile?.membership_expires_at;
      if (!expiresAt || new Date(expiresAt).getTime() > Date.now()) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      return {
        answer: "Para usar Stampy necesitás tener una membresía activa.",
        recommendations: [],
        knowledgeTools: [],
        relatedTools: [],
        suggestedQuestions: []
      };
    }

    const { OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // 0. Contexto del taller del usuario (Solo Lectura)
    const { getStampyWorkshopContext } = await import("@/lib/stampy/workshop-context");
    const workshopContext = await getStampyWorkshopContext({
      supabase,
      userId: user.id,
      message
    });

    if (message.trim() === "/debug taller") {
      const debugText = `DEBUG CONTEXTO TALLER\n\nuserId: ${user.id}\n\nprintersCount: ${workshopContext.printersCount}\nactiveFilamentsCount: ${workshopContext.filamentsCount}\nactiveFilamentsError: ${workshopContext.activeFilamentsErrorMsg}\nproductsCount: ${workshopContext.productsCount}\n\nFilamentos activos sample:\n${workshopContext.sampleFilaments}\n\nContexto final:\n${workshopContext.text}`;
      
      return {
        answer: debugText,
        recommendations: [],
        knowledgeTools: [],
        relatedTools: [],
        suggestedQuestions: []
      };
    }

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
- Si el usuario pregunta algo fuera de esta sección, respondé normal orientando a la ruta correcta.\n`;
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
- Si falta onboarding, podés sugerir completar el perfil/configuración.
- No menciones datos internos.\n`;
    }

    if (pathname && pathname.startsWith("/sorteos")) {
      let rafflesContext = null;
      try {
        const { getStampyRafflesContext } = await import("@/lib/stampy/tool-contexts/raffles-context");
        rafflesContext = await getStampyRafflesContext(user.id);
      } catch (error) {
        console.error("[Stampy] raffles context failed", error);
      }

      if (rafflesContext) {
        systemPrompt += `\n\nContexto real de sorteos del usuario:
- Código de referido: ${rafflesContext.referralCode || 'No tiene'}
- Participaciones base: ${rafflesContext.baseEntries}
- Participaciones extra: ${rafflesContext.bonusEntries}
- Participaciones totales: ${rafflesContext.totalEntries}
- Referidos pendientes: ${rafflesContext.pendingReferrals}
- Referidos convertidos: ${rafflesContext.convertedReferrals}
- Sorteo activo: ${rafflesContext.activeRaffle?.title || 'Ninguno'}

Reglas:
- Usá estos datos solo si el usuario pregunta por sorteos, chances, participaciones o referidos.
- No recites todos los números si no hace falta.
- Si pregunta cómo sumar chances, mencioná su código de referido.
- No prometas premios ni resultados.
- No digas que ganó si no hay dato real.\n`;
      }
    }

    if (pathname && pathname.startsWith("/stock")) {
      let stockContext = null;
      try {
        const { getStampyStockContext } = await import("@/lib/stampy/tool-contexts/stock-context");
        stockContext = await getStampyStockContext(user.id, message);
      } catch (error) {
        console.error("[Stampy] stock context failed", error);
      }

      if (stockContext) {
        if (stockContext.specificFilamentQuery) {
          const q = stockContext.specificFilamentQuery;
          systemPrompt += `\n\nConsulta específica de filamento detectada:
- Material detectado: ${q.detectedMaterial || 'Cualquiera'}
- Color detectado: ${q.detectedColor || 'Cualquiera'}
- Filamentos encontrados:
${q.matches.length > 0 ? q.matches.map(m => `  - ${m.name}: ${m.remainingGrams} g disponibles`).join('\n') : '  No encontré filamentos activos que coincidan.'}
- Total disponible: ${q.totalRemainingGrams} g

Reglas:
- Si el usuario pregunta "cuántos gramos", responder con cantidades.
- Si hay varios filamentos, listar cada uno y el total.
- Si no hay coincidencias, decir que no encontraste filamentos que coincidan con ese material/color.
- No responder solo con resumen de stock bajo si hay una consulta específica.
- No mencionar HEX.
- Si el usuario quiere modificar stock, explicale dónde hacerlo.\n`;
        } else if (stockContext.totalFilaments === 0 && stockContext.totalProducts === 0) {
          systemPrompt += `\n\nContexto real de stock del usuario:
El usuario todavía no tiene filamentos ni productos cargados en su stock.`;
        } else {
          systemPrompt += `\n\nContexto real de stock del usuario:
- Filamentos activos: ${stockContext.totalFilaments}
- Filamentos bajos: ${stockContext.lowStockFilaments.length > 0 ? stockContext.lowStockFilaments.map(f => f.name).join(', ') : 'Ninguno'}
- Filamentos vacíos: ${stockContext.emptyFilaments.length > 0 ? stockContext.emptyFilaments.map(f => f.name).join(', ') : 'Ninguno'}
- Productos activos: ${stockContext.totalProducts}
- Productos sin stock: ${stockContext.outOfStockProducts.length > 0 ? stockContext.outOfStockProducts.map(p => p.name).join(', ') : 'Ninguno'}
- Productos con stock bajo: ${stockContext.lowStockProducts.length > 0 ? stockContext.lowStockProducts.map(p => p.name).join(', ') : 'Ninguno'}`;

          if (stockContext.lowMarginProducts && stockContext.lowMarginProducts.length > 0) {
            systemPrompt += `\n- Productos con margen bajo: ${stockContext.lowMarginProducts.map(p => p.name).join(', ')}`;
          }
          if (stockContext.recentMovements && stockContext.recentMovements.length > 0) {
            systemPrompt += `\n- Últimos movimientos: ${stockContext.recentMovements.map(m => m.label).join(' | ')}`;
          }
          
          systemPrompt += `\n\nReglas:
- Usá estos datos solo si el usuario pregunta por stock, filamentos, productos, faltantes, reposición o movimientos.
- No recites todos los datos si no hace falta.
- Priorizá alertas accionables.
- No digas que descontaste stock.
- Si el usuario quiere modificar stock, explicale dónde hacerlo.
- Si no hay datos, sugerí cargarlos.\n`;
        }
      }
    }

    systemPrompt += `\n\nDATOS DEL USUARIO Y TALLER:
${workshopContext.text}

Reglas del taller:
- Estos datos son solo lectura.
- No digas "no tengo acceso" si el dato está en este bloque.
- Si el dato no está disponible, decilo naturalmente.
- No inventes stock, impresoras ni productos fuera del contexto.
- Podés usar este contexto para responder preguntas sobre impresoras cargadas, filamentos disponibles, stock aproximado, productos cargados y configuración general.

No podés todavía:
- crear datos
- editar datos
- descontar stock
- crear presupuestos
- ejecutar acciones

Si el usuario pide una acción:
- explicá brevemente que por ahora podés orientarlo
- mandalo a la herramienta correspondiente
- no digas que lo hiciste\n`;

    systemPrompt += `\nReglas generales:
- Respuestas MUY breves y prácticas.
- No inventes datos.
- No modifiques datos reales, solo orientá sobre cómo hacerlo.
- Cuando el usuario pregunte por filamentos, materiales o tipos como PLA/PETG/TPU, usá exclusivamente el contexto de filamentos. No interpretes esos términos como productos. Si recomendás una herramienta, mandá a Stock de filamentos, no a Stock de productos.`;

    // 5. Buscar herramientas de conocimiento
    const { findRelevantKnowledge } = await import("@/lib/stampy/knowledge-search");
    let knowledgeTools = findRelevantKnowledge(message);

    // Ajustar herramientas según intent
    if (workshopContext.isFilamentQuery) {
      knowledgeTools = knowledgeTools.filter((t: any) => t.id !== "finished-product-stock" && t.id !== "products");
    } else if (workshopContext.isProductQuery) {
      knowledgeTools = knowledgeTools.filter((t: any) => t.id !== "filament-stock");
    }

    console.log("[Stampy DEBUG] intent routing", {
      message,
      isFilamentQuery: workshopContext.isFilamentQuery,
      isProductQuery: workshopContext.isProductQuery,
      selectedContext: workshopContext.isFilamentQuery ? "filaments" : workshopContext.isProductQuery ? "products" : "general",
      relatedTools: knowledgeTools.map((t: any) => t.id),
    });

    console.log("[Stampy DEBUG] final workshop context", {
      chars: workshopContext.text.length,
      includesFilamentos: workshopContext.text.toLowerCase().includes("filamento"),
      preview: workshopContext.text.slice(0, 2000),
    });

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


    // 6. Buscar lecciones recomendables (búsqueda textual simple)
    const { data: rawLessons } = await supabase
      .from('lessons')
      .select(`
        id,
        title,
        description,
        is_published,
        is_ai_recommendable,
        ai_summary,
        ai_topics,
        ai_problems,
        ai_level,
        course_modules!inner (
          id,
          is_active,
          courses!inner (
            id,
            slug,
            title,
            status,
            course_kind
          )
        )
      `)
      .eq('is_ai_recommendable', true)
      .eq('is_published', true)
      .eq('course_modules.is_active', true)
      .eq('course_modules.courses.status', 'published');

    let recommendations: any[] = [];
    if (rawLessons && rawLessons.length > 0) {
      const normalize = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const q = normalize(message);
      
      const scored = rawLessons.map(l => {
        let score = 0;
        const kwds = [l.title, l.ai_summary, l.ai_topics, l.ai_problems].filter(Boolean).join(" ");
        if (normalize(kwds).includes(q)) score += 5;
        // Simple fallback
        if (score === 0) {
           const words = q.split(/\s+/).filter(w => w.length > 3);
           words.forEach(w => {
             if (normalize(kwds).includes(w)) score += 1;
           });
        }
        return { ...l, score, courseKind: (l.course_modules as any)?.courses?.course_kind };
      }).filter(l => l.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
      
      recommendations = scored;
    }

    return {
      answer: completion.choices[0]?.message?.content || "No pude generar una respuesta.",
      recommendations,
      knowledgeTools,
      relatedTools: [],
      suggestedQuestions: staticContext?.suggestedQuestions || []
    };
  } catch (error) {
    console.error("[Stampy] OpenAI request failed", {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      error
    });
    return {
      answer: "No pude conectarme con Stampy en este momento. Revisá la configuración de OpenAI.",
      recommendations: [],
      knowledgeTools: [],
      relatedTools: [],
      suggestedQuestions: []
    };
  }
}
