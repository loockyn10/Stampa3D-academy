// Batería de evaluación conversacional de Stampy (QA manual reproducible).
//
// Construye, para cada caso de scripts/stampy-eval-cases.json, el mismo
// request de Responses API que arma askStampyAction (system prompt, contexto
// de clase, orientación por intención, herramientas, clases recuperadas e
// historial con roles). No usa Supabase: el contexto de usuario/taller queda
// fuera para que los resultados sean comparables entre corridas.
//
// Uso:
//   node scripts/stampy-eval.mjs                 # dry run: sin llamadas a OpenAI
//   node scripts/stampy-eval.mjs --live          # llama a OpenAI (consume créditos)
//   node scripts/stampy-eval.mjs --live --only material-switch,continuity-the-other
//   node scripts/stampy-eval.mjs --live --out stampy-eval.md
//
// En modo --live toma OPENAI_API_KEY / OPENAI_MODEL / STAMPY_* del entorno o
// de .env.local.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

function loadTypeScriptModule(relativePath, dependencies = {}) {
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
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      throw new Error(`Unexpected dependency ${specifier} while loading ${relativePath}`);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(OPENAI_API_KEY|OPENAI_MODEL|STAMPY_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const live = args.includes("--live");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? new Set(args[onlyIndex + 1].split(",")) : null;
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;

const responses = loadTypeScriptModule("src/lib/stampy/responses.ts");
const systemPrompt = loadTypeScriptModule("src/lib/stampy/system-prompt.ts");
const knowledgeIntent = loadTypeScriptModule("src/lib/stampy/knowledge-intent.ts");
const knowledgeSearch = loadTypeScriptModule("src/lib/stampy/knowledge-search.ts", {
  "./app-knowledge": loadTypeScriptModule("src/lib/stampy/app-knowledge.ts"),
});
const toolRegistry = loadTypeScriptModule("src/lib/stampy/tool-registry.ts");

const cases = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/stampy-eval-cases.json"), "utf8"),
).filter((evalCase) => !only || only.has(evalCase.id));

function buildCaseRequest(evalCase, config) {
  const history = evalCase.history ?? [];
  const contextQuery = responses.buildStampyContextQuery({
    userMessage: evalCase.message,
    history,
  });
  const intent = knowledgeIntent.classifyStampyKnowledgeIntent(contextQuery);
  let tools = knowledgeSearch.findRelevantKnowledge(evalCase.message);
  if (tools.length === 0 && responses.isStampyFollowUpMessage(evalCase.message)) {
    tools = knowledgeSearch.findRelevantKnowledge(contextQuery);
  }
  const recommendations =
    intent?.type === "course_recommendation" ? evalCase.recommendations ?? [] : null;

  const turnContext = [
    evalCase.lesson ? systemPrompt.formatStampyLessonContextForPrompt(evalCase.lesson) : "",
    knowledgeIntent.formatStampyKnowledgeIntentForPrompt(intent),
    "DATOS DEL USUARIO Y TALLER:\nSin datos de taller (evaluación sin cuenta real).",
    systemPrompt.formatStampyToolsForPrompt(tools),
    recommendations ? systemPrompt.formatStampyLessonRecommendationsForPrompt(recommendations) : "",
    toolRegistry.formatStampyAvailableActionsForPrompt([]),
  ];
  const instructions = [
    systemPrompt.STAMPY_SYSTEM_PROMPT,
    systemPrompt.STAMPY_TURN_CONTEXT_HEADER,
    ...turnContext.map((section) => section.trim()).filter(Boolean),
  ].join("\n\n");

  return {
    request: responses.buildStampyResponseRequest({
      config,
      instructions,
      history,
      userMessage: evalCase.message,
    }),
    meta: {
      followUp: contextQuery !== evalCase.message,
      intent: intent?.type ?? null,
      tools: tools.map((tool) => tool.id),
      recommendations: recommendations?.map((item) => item.title) ?? null,
    },
  };
}

if (live) loadEnvLocal();
const config = responses.getStampyModelConfig(process.env);
let client = null;
if (live) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Falta OPENAI_API_KEY (entorno o .env.local).");
    process.exit(1);
  }
  const { default: OpenAI } = await import("openai");
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const lines = [
  `# Stampy eval — ${new Date().toISOString()}`,
  "",
  `Modo: ${live ? "live" : "dry run"} · modelo: ${config.model} · reasoning: ${config.reasoningEffort ?? "off"} · verbosity: ${config.verbosity ?? "default"}`,
  "",
];

for (const evalCase of cases) {
  const { request, meta } = buildCaseRequest(evalCase, config);
  lines.push(`## ${evalCase.id} — ${evalCase.category}`, "");
  for (const message of evalCase.history ?? []) {
    lines.push(`> **${message.role}:** ${message.content}`);
  }
  lines.push(`> **user:** ${evalCase.message}`, "");
  lines.push(
    `Contexto: follow-up=${meta.followUp} · intención=${meta.intent ?? "ninguna"} · herramientas=${meta.tools.join(", ") || "ninguna"}` +
      (meta.recommendations ? ` · clases=${meta.recommendations.join(", ") || "ninguna"}` : "") +
      ` · instrucciones=${request.instructions.length} chars · input=${request.input.length} mensajes`,
    "",
  );

  if (client) {
    const startedAt = Date.now();
    try {
      const response = await client.responses.create(request);
      const text = responses.extractStampyResponseText(response);
      lines.push(
        `**Stampy** (${Date.now() - startedAt} ms, ${response.usage?.input_tokens ?? "?"} in / ${response.usage?.output_tokens ?? "?"} out):`,
        "",
        text || "_(sin texto)_",
        "",
      );
    } catch (error) {
      lines.push(`**Error:** ${JSON.stringify(responses.describeStampyModelError(error))}`, "");
    }
  }

  lines.push("Esperado:");
  for (const item of evalCase.expect) lines.push(`- [ ] ${item}`);
  lines.push("Evitar:");
  for (const item of evalCase.avoid ?? []) lines.push(`- [ ] ${item}`);
  if (evalCase.note) lines.push("", `_Nota: ${evalCase.note}_`);
  lines.push("");
}

const output = lines.join("\n");
if (outPath) {
  fs.writeFileSync(outPath, output, "utf8");
  console.log(`Resultados en ${outPath}`);
} else {
  console.log(output);
}
