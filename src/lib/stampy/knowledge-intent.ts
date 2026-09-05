export type StampyKnowledgeIntentType =
  | "technical_troubleshooting"
  | "slicer_help"
  | "material_help"
  | "printer_calibration"
  | "business_help"
  | "platform_navigation"
  | "course_recommendation"
  | "course_content_question"
  | "general_3d_question";

export interface StampyKnowledgeIntent {
  type: StampyKnowledgeIntentType;
  confidence: number;
  matchedTerms: string[];
  focus: string[];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findTerms(message: string, terms: string[]): string[] {
  return terms.filter((term) => message.includes(normalize(term)));
}

const COURSE_RECOMMENDATION_TERMS = [
  "recomendame un curso",
  "recomendas un curso",
  "que curso",
  "que clase",
  "que video",
  "tenes un video",
  "hay un video",
  "busco un curso",
  "contenido sobre",
  "donde explican",
];
const COURSE_CONTENT_TERMS = [
  "video",
  "clase",
  "curso",
  "modulo",
  "ejercicio",
  "tutorial",
];
const PLATFORM_TERMS = [
  "donde veo",
  "donde encuentro",
  "donde esta",
  "como entro",
  "en que seccion",
  "en esta pantalla",
  "que puedo hacer aca",
  "que puedo hacer aqui",
];
const BUSINESS_TERMS = [
  "que puedo vender",
  "puedo vender",
  "producto para vender",
  "producto rentable",
  "ideas para vender",
  "nicho",
  "mercado",
  "clientes",
  "como vender",
  "negocio",
];
const SLICER_TERMS = [
  "orca",
  "orca slicer",
  "bambu studio",
  "cura",
  "prusaslicer",
  "slicer",
  "retraccion",
  "soportes",
  "laminador",
];
const MATERIAL_TERMS = [
  "pla",
  "petg",
  "tpu",
  "abs",
  "asa",
  "nylon",
  "resina",
  "filamento humedo",
  "humedad",
  "temperatura",
];
const CALIBRATION_TERMS = [
  "calibrar",
  "calibracion",
  "offset z",
  "nivelar",
  "cama desnivelada",
  "flow",
  "flujo",
  "pressure advance",
  "input shaping",
  "torre de temperatura",
];
const TROUBLESHOOTING_TERMS = [
  "se despega",
  "primera capa",
  "warping",
  "stringing",
  "hilos",
  "under extrusion",
  "subextrusion",
  "over extrusion",
  "sobreextrusion",
  "boquilla tapada",
  "no pega",
  "se levanta",
  "falla",
  "problema",
  "sale mal",
];
const GENERAL_3D_TERMS = [
  "impresion 3d",
  "impresora 3d",
  "filamento",
  "boquilla",
  "cama",
  "gcode",
  "stl",
  "capa",
  "extrusor",
];

function buildFocus(message: string, matchedTerms: string[]): string[] {
  const focus = new Set<string>();
  if (matchedTerms.some((term) => ["stringing", "hilos", "retraccion"].includes(term))) {
    focus.add("temperatura");
    focus.add("retracción");
    focus.add("humedad del filamento");
  }
  if (matchedTerms.some((term) => ["primera capa", "se despega", "no pega", "se levanta", "warping"].includes(term))) {
    focus.add("limpieza y nivelación de la cama");
    focus.add("offset Z");
    focus.add("temperatura y velocidad de primera capa");
  }
  if (matchedTerms.some((term) => ["petg", "pla", "tpu", "abs", "asa", "nylon"].includes(term))) {
    focus.add("rango inicial de temperatura");
    focus.add("marca del material e impresora");
  }
  if (message.includes("soporte")) {
    focus.add("orientación, densidad e interfaz de soportes");
  }
  return Array.from(focus).slice(0, 4);
}

export function classifyStampyKnowledgeIntent(
  rawMessage: string
): StampyKnowledgeIntent | null {
  const message = normalize(rawMessage);
  if (!message) return null;

  const courseAndWorkshopComparison =
    message.includes("curso") && message.includes("taller");
  const platformMatches = findTerms(message, PLATFORM_TERMS);
  if (platformMatches.length > 0 || courseAndWorkshopComparison) {
    return {
      type: "platform_navigation",
      confidence: 0.9,
      matchedTerms: courseAndWorkshopComparison
        ? [...platformMatches, "cursos y talleres"]
        : platformMatches,
      focus: [],
    };
  }

  const courseRecommendationMatches = findTerms(
    message,
    COURSE_RECOMMENDATION_TERMS
  );
  if (courseRecommendationMatches.length > 0) {
    return {
      type: "course_recommendation",
      confidence: 0.95,
      matchedTerms: courseRecommendationMatches,
      focus: [],
    };
  }

  const courseContentMatches = findTerms(message, COURSE_CONTENT_TERMS);
  if (courseContentMatches.length > 0) {
    return {
      type: "course_content_question",
      confidence: 0.85,
      matchedTerms: courseContentMatches,
      focus: [],
    };
  }

  const businessMatches = findTerms(message, BUSINESS_TERMS);
  if (businessMatches.length > 0) {
    return {
      type: "business_help",
      confidence: 0.9,
      matchedTerms: businessMatches,
      focus: ["tres líneas de producto", "validación rápida con clientes reales"],
    };
  }

  const slicerMatches = findTerms(message, SLICER_TERMS);
  if (slicerMatches.length > 0) {
    return {
      type: "slicer_help",
      confidence: 0.88,
      matchedTerms: slicerMatches,
      focus: buildFocus(message, slicerMatches),
    };
  }

  const calibrationMatches = findTerms(message, CALIBRATION_TERMS);
  if (calibrationMatches.length > 0) {
    return {
      type: "printer_calibration",
      confidence: 0.88,
      matchedTerms: calibrationMatches,
      focus: buildFocus(message, calibrationMatches),
    };
  }

  const troubleshootingMatches = findTerms(message, TROUBLESHOOTING_TERMS);
  if (troubleshootingMatches.length > 0) {
    return {
      type: "technical_troubleshooting",
      confidence: 0.9,
      matchedTerms: troubleshootingMatches,
      focus: buildFocus(message, troubleshootingMatches),
    };
  }

  const materialMatches = findTerms(message, MATERIAL_TERMS);
  if (materialMatches.length > 0) {
    return {
      type: "material_help",
      confidence: 0.85,
      matchedTerms: materialMatches,
      focus: buildFocus(message, materialMatches),
    };
  }

  const generalMatches = findTerms(message, GENERAL_3D_TERMS);
  if (generalMatches.length > 0) {
    return {
      type: "general_3d_question",
      confidence: 0.75,
      matchedTerms: generalMatches,
      focus: [],
    };
  }

  return null;
}

export function formatStampyKnowledgeIntentForPrompt(
  intent: StampyKnowledgeIntent | null
): string {
  if (!intent) return "";

  const focusText = intent.focus.length > 0
    ? `\nPuntos que conviene revisar: ${intent.focus.join(", ")}.`
    : "";

  if (intent.type === "technical_troubleshooting") {
    return `TIPO DE CONSULTA: diagnóstico técnico.${focusText}
Respondé con un diagnóstico breve, hasta 5 pasos numerados, ajustes concretos y qué dato pedir si el problema continúa.`;
  }
  if (intent.type === "slicer_help") {
    return `TIPO DE CONSULTA: ayuda de slicer.${focusText}
Indicá dónde revisar el ajuste, qué cambiar primero y cómo validar el resultado. Evitá listar parámetros que no sean relevantes.`;
  }
  if (intent.type === "material_help") {
    return `TIPO DE CONSULTA: material de impresión.${focusText}
Dá un rango práctico como punto de partida, aclarando que debe validarse con la marca, la impresora y la velocidad usadas.`;
  }
  if (intent.type === "printer_calibration") {
    return `TIPO DE CONSULTA: calibración de impresora.${focusText}
Ordená la calibración en pasos seguros, de a un cambio por vez, e indicá cómo comprobar si mejoró.`;
  }
  if (intent.type === "business_help") {
    return `TIPO DE CONSULTA: negocio de impresión 3D.${focusText}
Proponé como máximo 3 líneas concretas y una validación rápida. No des una lista larga ni inventes demanda o rentabilidad.`;
  }
  if (intent.type === "platform_navigation") {
    return "TIPO DE CONSULTA: navegación de Academia Stampa. Respondé sólo con la sección o ubicación respaldada por el contexto actual. No agregues configuración técnica ni contenido lateral.";
  }
  if (intent.type === "course_recommendation") {
    return "TIPO DE CONSULTA: búsqueda de clase o video. Respondé la duda si podés, pero no nombres una clase concreta: el servidor agregará sólo recomendaciones verificadas del catálogo.";
  }
  if (intent.type === "course_content_question") {
    return "TIPO DE CONSULTA: pregunta sobre contenido educativo existente. Usá sólo contenido oficial recuperado o visible; si no respalda el dato pedido, decí que no lo encontrás definido y no completes la estructura del curso por inferencia.";
  }
  return "TIPO DE CONSULTA: consulta general de impresión 3D. Respondé la pregunta puntual y terminá cuando quede resuelta.";
}

export function shouldRetrieveStampyKnowledge(
  intent: StampyKnowledgeIntent | null,
  hasLessonContext = false
): boolean {
  if (hasLessonContext) return true;
  return Boolean(intent && intent.type !== "platform_navigation");
}
