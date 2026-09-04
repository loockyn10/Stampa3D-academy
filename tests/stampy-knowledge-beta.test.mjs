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

  assert.match(prompt, /diagnóstico breve/i);
  assert.match(prompt, /hasta 5 pasos numerados/i);
  assert.match(prompt, /offset Z/i);
  assert.match(prompt, /temperatura y velocidad de primera capa/i);
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
    "No encontré una clase específica para esto todavía, pero te dejo la solución práctica."
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
