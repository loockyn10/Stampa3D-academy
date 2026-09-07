import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(filename) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (request) => { throw new Error(`Unexpected dependency: ${request}`); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const contextSearch = loadTypeScriptModule(path.join(root, "src/lib/stampy/context-search.ts"));

test("editable page context remains capped even when the first match is oversized", async () => {
  const supabase = {
    from(table) {
      assert.equal(table, "stampy_page_contexts");
      return {
        select() { return this; },
        async eq() {
          return {
            data: [{
              id: "context-1",
              title: "Calculadora",
              context: "dato ".repeat(5_000),
              route_pattern: "/calculadora",
              match_type: "exact",
              priority: 10,
              suggested_questions: [],
              related_tools: [],
            }],
            error: null,
          };
        },
      };
    },
  };

  const result = await contextSearch.getStampyRelevantContexts({
    supabase,
    message: "calculadora",
    currentPath: "/calculadora",
  });
  assert.ok(result.text.length <= 5_000, `context length was ${result.text.length}`);
  assert.match(result.text, /\[Contexto truncado\]/);
  assert.match(result.text, /No inventar rutas/);
});

test("direct calculator, budget and client paths run before memory, retrieval and OpenAI", () => {
  const source = fs.readFileSync(path.join(root, "src/app/stampy/actions.ts"), "utf8");
  const screenAnalysis = source.indexOf("const screenAnalysis =");
  const clientTool = source.indexOf("const shouldCheckClientTools =");
  const memory = source.indexOf("loadRelevantMemory");
  const retrieval = source.indexOf("retrieveStampyKnowledge");
  const openAi = source.indexOf("openai.chat.completions.create");

  assert.ok(screenAnalysis > 0 && screenAnalysis < memory);
  assert.ok(clientTool > 0 && clientTool < memory);
  assert.ok(screenAnalysis < retrieval && clientTool < retrieval);
  assert.ok(screenAnalysis < openAi && clientTool < openAi);
  assert.match(source.slice(screenAnalysis, memory), /promptChars: 0/);
});

test("prompt sources keep explicit bounded inputs", () => {
  const screenContext = fs.readFileSync(path.join(root, "src/lib/stampy/screen-context.ts"), "utf8");
  const history = fs.readFileSync(path.join(root, "src/lib/stampy/history.ts"), "utf8");
  const memory = fs.readFileSync(path.join(root, "src/lib/stampy/user-memory.ts"), "utf8");
  const retrieval = fs.readFileSync(path.join(root, "src/lib/stampy/retrieval.ts"), "utf8");

  assert.match(screenContext, /visibleEntities: 20/);
  assert.match(screenContext, /promptChars: 4_000/);
  assert.match(history, /\.limit\(8\)/);
  assert.match(history, /substring\(0, 1200\)/);
  assert.match(memory, /maxPromptChars = 1200/);
  assert.match(retrieval, /maxChunks = 8/);
  assert.match(retrieval, /MAX_CHARS = 7000/);
});
