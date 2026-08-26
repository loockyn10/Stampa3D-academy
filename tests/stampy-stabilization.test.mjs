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
      esModuleInterop: true
    },
    fileName: filename
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

const toolRegistry = loadTypeScriptModule("src/lib/stampy/tool-registry.ts");
const actionIntents = loadTypeScriptModule("src/lib/stampy/action-intents.ts", {
  "./tool-registry": toolRegistry,
  "./types": {}
});
const messagePolicy = loadTypeScriptModule("src/lib/stampy/message-policy.ts");

function loadAskStampyAction({ touchedTables = [] } = {}) {
  const supabase = {
    from(table) {
      touchedTables.push(table);
      return {
        update() { return this; },
        eq() { return this; }
      };
    }
  };

  return loadTypeScriptModule("src/app/stampy/actions.ts", {
    "@/utils/supabase/server": { createClient: async () => supabase },
    "@/lib/auth/user-access": {
      getCurrentUserAccess: async () => ({
        access: {
          authenticated: true,
          userId: "user-1",
          capabilities: { useStampy: true }
        }
      })
    },
    "@/lib/stampy/message-policy": messagePolicy,
    "@/lib/stampy/rate-limit": {
      checkStampyRateLimit: async () => ({ isBlocked: false })
    },
    "@/lib/stampy/history": {
      ensureConversation: async () => "conversation-1",
      getRecentHistory: async () => [],
      saveMessages: async () => ({ assistantMessageId: "message-1" })
    },
    "@/lib/stampy/action-intents": actionIntents,
    "@/lib/stampy/action-requests": {
      createStampyActionRequest: async () => ({ actionRequestId: "request-1", error: null })
    },
    "@/lib/stampy/usage-log": { logStampyUsage: async () => undefined }
  });
}

test("server message policy trims and accepts up to 4000 characters", () => {
  const result = messagePolicy.validateStampyMessage(`  ${"a".repeat(4000)}  `);
  assert.equal(result.valid, true);
  assert.equal(result.message.length, 4000);
});

test("server message policy rejects more than 4000 characters with the expected message", () => {
  const result = messagePolicy.validateStampyMessage("a".repeat(4001));
  assert.deepEqual(result, {
    valid: false,
    error: "Tu mensaje es demasiado largo. Probá dividirlo en partes más chicas."
  });
});

test("askStampyAction rejects oversized messages before loading rate limit, history or OpenAI", async () => {
  const actions = loadAskStampyAction();
  const result = await actions.askStampyAction("a".repeat(4001));
  assert.equal(
    result.answer,
    "Tu mensaje es demasiado largo. Probá dividirlo en partes más chicas."
  );
  assert.equal(result.actionIntent, null);
});

test("normal messages are not converted into direct actions", () => {
  const intent = actionIntents.detectStampyActionIntent({
    message: "¿Qué temperatura recomiendan para imprimir PLA?"
  });
  assert.equal(intent, null);
});

const intentCases = [
  {
    message: "Agregame 50g de PLA Cian W3D",
    intent: "increase_filament_stock",
    contract: "stock.filaments.increase",
    extracted: { grams: 50, material: "PLA", color: "cian", brand: "W3D" }
  },
  {
    message: "Creame un filamento nuevo PETG rojo Elegoo",
    intent: "add_filament",
    contract: "stock.filaments.create",
    extracted: { material: "PETG", color: "rojo", brand: "ELEGOO" }
  },
  {
    message: "Descontame 500g de PLA",
    intent: "discount_filament",
    contract: "stock.filaments.discount",
    extracted: { grams: 500, material: "PLA" }
  }
];

for (const scenario of intentCases) {
  test(`${scenario.intent} maps to exactly ${scenario.contract} and stays non-executable`, () => {
    const intent = actionIntents.detectStampyActionIntent({ message: scenario.message });
    assert.ok(intent);
    assert.equal(intent.type, scenario.intent);
    assert.equal(intent.canExecute, false);
    assert.deepEqual(
      Object.fromEntries(Object.keys(scenario.extracted).map((key) => [key, intent.extracted[key]])),
      scenario.extracted
    );

    const contracts = toolRegistry.getStampyToolContractsForIntent(intent.type);
    assert.equal(contracts.length, 1);
    assert.equal(contracts[0].id, scenario.contract);
    assert.equal(contracts[0].canExecuteFromChat, false);
  });
}

test("a direct stock intent persists only Stampy metadata and returns before OpenAI", async () => {
  const touchedTables = [];
  const actions = loadAskStampyAction({ touchedTables });
  const result = await actions.askStampyAction("Agregame 50g de PLA Cian W3D");

  assert.equal(result.actionIntent.type, "increase_filament_stock");
  assert.equal(result.actionIntent.canExecute, false);
  assert.equal(result.actionRequestId, "request-1");
  assert.deepEqual(touchedTables, ["stampy_messages"]);
});

test("obsolete or overlapping filament intent mappings are absent", () => {
  assert.equal(toolRegistry.getStampyToolContractsForIntent("create_filament").length, 0);
  assert.equal(toolRegistry.getStampyToolContractsForIntent("decrease_filament_stock").length, 0);
  assert.deepEqual(
    toolRegistry.getStampyToolContractsForIntent("add_filament").map((contract) => contract.id),
    ["stock.filaments.create"]
  );
});

test("direct intents and oversized messages return before OpenAI and retrieval setup", () => {
  const source = fs.readFileSync(path.join(root, "src/app/stampy/actions.ts"), "utf8");
  const validationIndex = source.indexOf("validateStampyMessage(message)");
  const rateLimitIndex = source.indexOf("checkStampyRateLimit");
  const detectionIndex = source.indexOf("detectStampyActionIntent({");
  const directReturnIndex = source.indexOf("actionIntent\n      };", detectionIndex);
  const openAiIndex = source.indexOf('await import("openai")');
  const retrievalIndex = source.indexOf('await import("@/lib/stampy/retrieval")');

  assert.ok(validationIndex > 0);
  assert.ok(rateLimitIndex > validationIndex);
  assert.ok(detectionIndex > rateLimitIndex);
  assert.ok(directReturnIndex > detectionIndex);
  assert.ok(openAiIndex > directReturnIndex);
  assert.ok(retrievalIndex > openAiIndex);
});

function makeActionRequestModule(updateResult) {
  const updateChain = {
    update() { return this; },
    eq() { return this; },
    in() { return this; },
    select() { return this; },
    async maybeSingle() { return updateResult; }
  };
  const supabase = {
    auth: {
      async getUser() {
        return { data: { user: { id: "user-1" } } };
      }
    },
    from() {
      return updateChain;
    }
  };

  return loadTypeScriptModule("src/lib/stampy/action-requests.ts", {
    "@/utils/supabase/server": { createClient: async () => supabase },
    "./types": {}
  });
}

test("opening an action request does not report success when zero rows were updated", async () => {
  const actions = makeActionRequestModule({ data: null, error: null });
  const result = await actions.markStampyActionRequestOpened({ actionRequestId: "missing" });
  assert.equal(result.success, false);
  assert.match(result.error, /No se encontró/);
});

test("cancelling an action request does not report success when zero rows were updated", async () => {
  const actions = makeActionRequestModule({ data: null, error: null });
  const result = await actions.cancelStampyActionRequest({ actionRequestId: "missing" });
  assert.equal(result.success, false);
  assert.match(result.error, /No se encontró/);
});

test("action request updates still report success when a row was returned", async () => {
  const actions = makeActionRequestModule({ data: { id: "request-1" }, error: null });
  assert.equal(
    (await actions.markStampyActionRequestOpened({ actionRequestId: "request-1" })).success,
    true
  );
  assert.equal(
    (await actions.cancelStampyActionRequest({ actionRequestId: "request-1" })).success,
    true
  );
});
