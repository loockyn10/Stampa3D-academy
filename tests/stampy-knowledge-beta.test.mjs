import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(relativePath, dependencies = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    throw new Error(`Unexpected dependency ${specifier} while loading ${relativePath}`);
  };
  new Function("require", "module", "exports", outputText)(
    localRequire,
    module,
    module.exports
  );
  return module.exports;
}

const knowledgeIntent = loadTypeScriptModule(
  "src/lib/stampy/knowledge-intent.ts"
);
const toolRegistry = loadTypeScriptModule(
  "src/lib/stampy/tool-registry.ts"
);
const actionIntents = loadTypeScriptModule(
  "src/lib/stampy/action-intents.ts",
  { "./types": {} }
);
const lessonRecommendations = loadTypeScriptModule(
  "src/lib/stampy/lesson-recommendations.ts"
);

function candidate(overrides = {}) {
  return {
    id: "lesson-1",
    title: "Primera capa sin fallas",
    description:
      "Una guía práctica para diagnosticar adherencia, nivelación y offset Z.",
    videoUrl: "https://video.example/primera-capa",
    isActive: true,
    isPublished: true,
    isAiRecommendable: true,
    aiSummary: "Cómo corregir problemas de adherencia en la primera capa.",
    aiTopics: ["primera capa", "adherencia"],
    aiProblems: ["la impresión se despega"],
    aiLevel: "beginner",
    moduleActive: true,
    courseId: "course-1",
    courseSlug: "fundamentos-impresion-3d",
    courseTitle: "Fundamentos de impresión 3D",
    courseStatus: "published",
    courseKind: "course",
    transcriptReady: false,
    transcriptText: "",
    transcriptSegmentsCount: 0,
    indexedTranscriptContent: "",
    ...overrides,
  };
}

test("non-operational questions are classified without becoming stock actions", () => {
  const cases = [
    ["se me despega la primera capa", "technical_troubleshooting"],
    ["tengo stringing", "technical_troubleshooting"],
    ["qué temperatura uso para PETG", "material_help"],
    ["cómo calibro retracción", "slicer_help"],
    ["qué producto puedo vender", "business_help"],
    ["dónde veo cursos", "platform_navigation"],
    ["tenés un video sobre soportes?", "course_recommendation"],
    ["¿Qué diferencia hay entre Cursos y Talleres?", "platform_navigation"],
    ["¿Podés arrancarme el curso?", "course_content_question"],
    ["Dame el primer ejercicio del curso", "course_content_question"],
    ["¿Dónde está Fundamentos Express?", "platform_navigation"],
  ];

  for (const [message, expected] of cases) {
    assert.equal(
      knowledgeIntent.classifyStampyKnowledgeIntent(message)?.type,
      expected,
      message
    );
    assert.equal(
      actionIntents.detectStampyActionIntent({ message }),
      null,
      `${message} no debe convertirse en una acción operativa`
    );
  }
});

test("technical guidance asks for a short diagnosis and concrete ordered steps", () => {
  const intent = knowledgeIntent.classifyStampyKnowledgeIntent(
    "se me despega la primera capa"
  );
  const prompt = knowledgeIntent.formatStampyKnowledgeIntentForPrompt(intent);

  assert.match(prompt, /causa probable con palabras cotidianas/i);
  assert.match(prompt, /hasta 5 pruebas o ajustes concretos/i);
  assert.match(prompt, /offset Z/i);
  assert.match(prompt, /temperatura y velocidad de primera capa/i);
  assert.match(prompt, /término técnico.*importante/i);
});

test("voice-sensitive questions receive the right depth instruction without hardcoded answers", () => {
  const slicerPrompt = knowledgeIntent.formatStampyKnowledgeIntentForPrompt(
    knowledgeIntent.classifyStampyKnowledgeIntent("¿Qué es un slicer?")
  );
  const coursesPrompt = knowledgeIntent.formatStampyKnowledgeIntentForPrompt(
    knowledgeIntent.classifyStampyKnowledgeIntent("¿Qué son Cursos y Talleres?")
  );
  const advancedPrompt = knowledgeIntent.formatStampyKnowledgeIntentForPrompt(
    knowledgeIntent.classifyStampyKnowledgeIntent("Explicame técnicamente qué hace pressure advance")
  );
  const locationPrompt = knowledgeIntent.formatStampyKnowledgeIntentForPrompt(
    knowledgeIntent.classifyStampyKnowledgeIntent("¿Dónde encuentro Cursos?")
  );
  const adhesionPrompt = knowledgeIntent.formatStampyKnowledgeIntentForPrompt(
    knowledgeIntent.classifyStampyKnowledgeIntent("¿Por qué esta pieza se despega?")
  );

  assert.match(slicerPrompt, /Si el término del slicer puede no ser conocido, explicalo brevemente/i);
  assert.match(coursesPrompt, /Respondé sólo con la sección o ubicación/i);
  assert.match(advancedPrompt, /Si la pregunta pide detalle técnico, usá el vocabulario preciso/i);
  assert.match(locationPrompt, /No agregues configuración técnica ni contenido lateral/i);
  assert.match(adhesionPrompt, /causa probable con palabras cotidianas/i);
});

test("stringing guidance focuses on temperature, retraction and humidity", () => {
  const intent = knowledgeIntent.classifyStampyKnowledgeIntent("tengo stringing");
  const prompt = knowledgeIntent.formatStampyKnowledgeIntentForPrompt(intent);

  assert.match(prompt, /temperatura/i);
  assert.match(prompt, /retracción/i);
  assert.match(prompt, /humedad del filamento/i);
});

test("material guidance requests a practical range and printer-specific validation", () => {
  const intent = knowledgeIntent.classifyStampyKnowledgeIntent(
    "qué temperatura uso para PETG"
  );
  const prompt = knowledgeIntent.formatStampyKnowledgeIntentForPrompt(intent);

  assert.equal(intent.type, "material_help");
  assert.match(prompt, /rango práctico/i);
  assert.match(prompt, /marca, la impresora y la velocidad/i);
});

test("business guidance stays actionable and avoids long generic idea lists", () => {
  const intent = knowledgeIntent.classifyStampyKnowledgeIntent(
    "qué puedo vender con impresión 3D"
  );
  const prompt = knowledgeIntent.formatStampyKnowledgeIntentForPrompt(intent);

  assert.equal(intent.type, "business_help");
  assert.match(prompt, /como máximo 3 líneas concretas/i);
  assert.match(prompt, /validación rápida/i);
  assert.match(prompt, /no.*inventes demanda o rentabilidad/i);
});

test("lesson ranking recommends at most two strong real-content matches", () => {
  const recommendations = lessonRecommendations.rankStampyLessonRecommendations({
    query: "se me despega la primera capa",
    candidates: [
      candidate(),
      candidate({
        id: "lesson-2",
        title: "Adherencia y nivelación",
        aiTopics: ["primera capa", "nivelación"],
      }),
      candidate({
        id: "lesson-3",
        title: "Offset Z paso a paso",
        aiTopics: ["primera capa", "offset Z"],
      }),
    ],
    limit: 10,
  });

  assert.equal(recommendations.length, 2);
  assert.equal(recommendations[0].href, "/cursos/fundamentos-impresion-3d");
  assert.ok(recommendations.every((item) => item.score >= 5));
});

test("draft, inactive and empty lessons are never recommended", () => {
  const query = "tenés un video sobre soportes";
  const supportFields = {
    title: "Soportes fáciles de retirar",
    aiTopics: ["soportes"],
    aiProblems: ["soportes pegados"],
  };
  const recommendations = lessonRecommendations.rankStampyLessonRecommendations({
    query,
    candidates: [
      candidate({ ...supportFields, courseStatus: "draft" }),
      candidate({ ...supportFields, moduleActive: false }),
      candidate({ ...supportFields, isActive: false }),
      candidate({ ...supportFields, isPublished: false }),
      candidate({
        ...supportFields,
        videoUrl: null,
        description: null,
        transcriptReady: false,
        transcriptText: "",
        transcriptSegmentsCount: 0,
        indexedTranscriptContent: "",
      }),
    ],
  });

  assert.deepEqual(recommendations, []);
});

test("a ready transcript is real content but still needs a clear topical match", () => {
  const transcriptCandidate = candidate({
    title: "Ajustes avanzados",
    description: null,
    videoUrl: null,
    aiSummary: null,
    aiTopics: [],
    aiProblems: [],
    transcriptReady: true,
    transcriptText:
      "Para reducir stringing revisamos temperatura, retracción y humedad del filamento antes de cambiar otros parámetros.",
  });

  assert.equal(
    lessonRecommendations.rankStampyLessonRecommendations({
      query: "tengo stringing",
      candidates: [transcriptCandidate],
    }).length,
    1
  );
  assert.equal(
    lessonRecommendations.rankStampyLessonRecommendations({
      query: "cómo diseño una caja",
      candidates: [transcriptCandidate],
    }).length,
    0
  );
});

test("recommendation copy never invents a class when ranking returns no match", () => {
  const intent = knowledgeIntent.classifyStampyKnowledgeIntent(
    "tenés un video sobre soportes?"
  );
  assert.equal(
    lessonRecommendations.buildStampyLessonRecommendationText({
      recommendations: [],
      intent,
    }),
    "No encontré una clase específica que coincida con esta consulta."
  );
});

test("retrieval is skipped for vague or navigation turns and kept for grounded knowledge intents", () => {
  assert.equal(knowledgeIntent.shouldRetrieveStampyKnowledge(null), false);
  assert.equal(
    knowledgeIntent.shouldRetrieveStampyKnowledge({ type: "platform_navigation" }),
    false
  );
  assert.equal(
    knowledgeIntent.shouldRetrieveStampyKnowledge({ type: "technical_troubleshooting" }),
    true
  );
  assert.equal(knowledgeIntent.shouldRetrieveStampyKnowledge(null, true), true);
});

test("available actions distinguish executable capabilities from informational contracts", () => {
  const academyContracts = toolRegistry.getRelevantContractsForPath("/academia");
  const calculatorContracts = toolRegistry.getRelevantContractsForPath("/calculadora");
  const academyPrompt = toolRegistry.formatStampyAvailableActionsForPrompt(
    academyContracts
  );
  const calculatorPrompt = toolRegistry.formatStampyAvailableActionsForPrompt(
    calculatorContracts
  );

  assert.deepEqual(academyContracts, []);
  assert.match(academyPrompt, /Acciones que esta respuesta puede ejecutar:\n- Ninguna/);
  assert.match(calculatorPrompt, /Referencias informativas verificadas/);
  assert.match(calculatorPrompt, /Calculadora de precios: \/calculadora/);
  assert.match(calculatorPrompt, /una ruta.*no concede capacidad/i);
  assert.ok(calculatorContracts.every((contract) => !contract.canExecuteFromChat));
  assert.match(
    toolRegistry.formatToolContractForPrompt(calculatorContracts[0]),
    /Ejecución desde esta respuesta: no disponible/
  );
});

test("askStampyAction delegates recommendations to the strict helper", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/stampy/actions.ts"),
    "utf8"
  );

  assert.match(source, /classifyStampyKnowledgeIntent\(userMessage\)/);
  assert.match(source, /findStampyLessonRecommendations/);
  assert.match(source, /knowledgeIntent\?\.type === "course_recommendation"/);
  assert.match(source, /const recommendationText = shouldRecommendLessons/);
  assert.match(source, /limit: 2/);
  assert.doesNotMatch(source, /búsqueda textual simple/);
  assert.doesNotMatch(source, /slice\(0, 3\)/);
});
