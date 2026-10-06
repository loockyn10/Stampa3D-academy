import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(relativePath) {
  const filename = path.join(root, relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (specifier) => {
      throw new Error(`Unexpected dependency ${specifier} while loading ${relativePath}`);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const responses = loadTypeScriptModule("src/lib/stampy/responses.ts");
const systemPrompt = loadTypeScriptModule("src/lib/stampy/system-prompt.ts");

test("model config defaults to gpt-5.6-terra with low reasoning and keeps OPENAI_MODEL configurable", () => {
  assert.deepEqual(responses.getStampyModelConfig({}), {
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
    verbosity: null,
    maxOutputTokens: 4000,
  });

  const custom = responses.getStampyModelConfig({
    OPENAI_MODEL: "gpt-5-mini",
    STAMPY_REASONING_EFFORT: "medium",
    STAMPY_TEXT_VERBOSITY: "low",
    STAMPY_MAX_OUTPUT_TOKENS: "6000",
  });
  assert.equal(custom.model, "gpt-5-mini");
  assert.equal(custom.reasoningEffort, "medium");
  assert.equal(custom.verbosity, "low");
  assert.equal(custom.maxOutputTokens, 6000);
});

test("reasoning can be disabled and expensive or invalid values fall back to the default", () => {
  assert.equal(responses.getStampyModelConfig({ STAMPY_REASONING_EFFORT: "off" }).reasoningEffort, null);
  assert.equal(responses.getStampyModelConfig({ STAMPY_REASONING_EFFORT: "max" }).reasoningEffort, "low");
  assert.equal(responses.getStampyModelConfig({ STAMPY_REASONING_EFFORT: "xhigh" }).reasoningEffort, "low");
  assert.equal(responses.getStampyModelConfig({ STAMPY_MAX_OUTPUT_TOKENS: "50" }).maxOutputTokens, 4000);
});

test("the Responses request keeps roles, stores nothing remotely and only sends optional params when set", () => {
  const request = responses.buildStampyResponseRequest({
    config: { model: "gpt-5.6-terra", reasoningEffort: "low", verbosity: null, maxOutputTokens: 4000 },
    instructions: "instrucciones",
    history: [
      { role: "user", content: "Tengo stringing" },
      { role: "assistant", content: "Secá el filamento." },
      { role: "assistant", content: "   " },
    ],
    userMessage: "¿por qué?",
  });

  assert.deepEqual(request, {
    model: "gpt-5.6-terra",
    instructions: "instrucciones",
    input: [
      { role: "user", content: "Tengo stringing" },
      { role: "assistant", content: "Secá el filamento." },
      { role: "user", content: "¿por qué?" },
    ],
    store: false,
    max_output_tokens: 4000,
    reasoning: { effort: "low" },
  });

  const withoutReasoning = responses.buildStampyResponseRequest({
    config: { model: "gpt-4o-mini", reasoningEffort: null, verbosity: "low", maxOutputTokens: 4000 },
    instructions: "x",
    history: [],
    userMessage: "hola",
  });
  assert.equal("reasoning" in withoutReasoning, false);
  assert.deepEqual(withoutReasoning.text, { verbosity: "low" });
  assert.equal("previous_response_id" in withoutReasoning, false);
});

test("response text comes from output_text or from message output items", () => {
  assert.equal(responses.extractStampyResponseText({ output_text: "  Hola  " }), "Hola");
  assert.equal(
    responses.extractStampyResponseText({
      output: [
        { type: "reasoning", content: [] },
        { type: "message", content: [{ type: "output_text", text: "Parte 1. " }, { type: "output_text", text: "Parte 2." }] },
      ],
    }),
    "Parte 1. Parte 2.",
  );
  assert.equal(responses.extractStampyResponseText({ output_text: "", output: [] }), "");
});

test("model errors are summarized without headers or secrets", () => {
  const summary = responses.describeStampyModelError(
    Object.assign(new Error("Incorrect API key provided: sk-proj-1234567890abcdef"), {
      status: 401,
      code: "invalid_api_key",
      requestID: "req_123",
      headers: { authorization: "Bearer sk-proj-1234567890abcdef" },
    }),
  );

  assert.equal(summary.status, 401);
  assert.equal(summary.code, "invalid_api_key");
  assert.equal(summary.requestId, "req_123");
  assert.equal("headers" in summary, false);
  assert.doesNotMatch(JSON.stringify(summary), /sk-proj-1234567890abcdef|Bearer/);
});

test("short or anaphoric messages are detected as follow-ups", () => {
  for (const message of ["¿y con PETG?", "¿por qué?", "explicame mejor", "la otra", "¿y eso?", "Y si uso brim en vez de raft para esta pieza?"]) {
    assert.equal(responses.isStampyFollowUpMessage(message), true, message);
  }
  for (const message of [
    "Se me despega la primera capa con PLA en una Ender 3",
    "¿Cómo calculo cuánto cobrar una impresión de un mate?",
  ]) {
    assert.equal(responses.isStampyFollowUpMessage(message), false, message);
  }
});

test("the context query joins a follow-up with the previous user message only", () => {
  const history = [
    { role: "user", content: "Se me despega la primera capa con PLA" },
    { role: "assistant", content: "Revisá el offset Z." },
  ];

  assert.equal(
    responses.buildStampyContextQuery({ userMessage: "¿y con PETG?", history }),
    "Se me despega la primera capa con PLA\n¿y con PETG?",
  );
  assert.equal(
    responses.buildStampyContextQuery({ userMessage: "¿y con PETG?", history: [] }),
    "¿y con PETG?",
  );
  assert.equal(
    responses.buildStampyContextQuery({
      userMessage: "¿Qué temperatura de cama conviene para imprimir TPU flexible?",
      history,
    }),
    "¿Qué temperatura de cama conviene para imprimir TPU flexible?",
  );
});

test("lesson context is sanitized and bounded", () => {
  const prompt = systemPrompt.formatStampyLessonContextForPrompt({
    courseTitle: "Fundamentos",
    lessonTitle: "Primera capa\n\nsin fallas",
    lessonSummary: "x".repeat(2000),
    lessonTopics: Array.from({ length: 30 }, (_, index) => `tema ${index}`),
  });

  assert.match(prompt, /- Clase: Primera capa sin fallas/);
  assert.ok(prompt.length < 2000);
  assert.doesNotMatch(prompt, /tema 10/);
  assert.equal(systemPrompt.formatStampyLessonContextForPrompt({ courseTitle: "Sin clase" }), "");
});

test("tools are listed with their verified page and capped", () => {
  const prompt = systemPrompt.formatStampyToolsForPrompt([
    { title: "Calculadora avanzada", route: "/calculadora", shortDescription: "Precio real." },
    { title: "B", shortDescription: "b" },
    { title: "C", shortDescription: "c" },
    { title: "D", shortDescription: "d" },
    { title: "E", shortDescription: "e" },
  ]);

  assert.match(prompt, /- Calculadora avanzada \(página: \/calculadora\): Precio real\./);
  assert.doesNotMatch(prompt, /- E:/);
  assert.equal(systemPrompt.formatStampyToolsForPrompt([]), "");
});
