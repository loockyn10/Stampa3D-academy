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
const actionValidator = loadTypeScriptModule("src/lib/stampy/action-validator.ts", {
  "./tool-registry": toolRegistry,
  "./types": {}
});
const messagePolicy = loadTypeScriptModule("src/lib/stampy/message-policy.ts");
const clientMessageIds = loadTypeScriptModule("src/lib/stampy/client-message-id.ts");
const toolPrefill = loadTypeScriptModule("src/lib/stampy/tool-prefill.ts");

function loadAskStampyAction({ touchedTables = [], savedMetadata = [], actionRequests = [] } = {}) {
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
      saveMessages: async (...args) => {
        savedMetadata.push(args[5]);
        return { assistantMessageId: "message-1" };
      }
    },
    "@/lib/stampy/action-intents": actionIntents,
    "@/lib/stampy/action-validator": actionValidator,
    "@/lib/stampy/tool-registry": toolRegistry,
    "@/lib/stampy/action-requests": {
      createStampyActionRequest: async (params) => {
        actionRequests.push(params);
        return { actionRequestId: "request-1", error: null };
      }
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

function detectAndValidate(message) {
  const actionIntent = actionIntents.detectStampyActionIntent({ message });
  assert.ok(actionIntent);
  const toolContract = toolRegistry.getStampyToolContractsForIntent(actionIntent.type)[0] ?? null;
  return {
    actionIntent,
    validation: actionValidator.validateStampyActionIntent({ actionIntent, toolContract })
  };
}

test("an incomplete quote asks for client, product and quantity without opening the tool", async () => {
  const { validation } = detectAndValidate("Haceme un presupuesto de 100g");
  assert.equal(validation.isValid, false);
  assert.deepEqual(validation.missingFields, ["clientName", "productName", "quantity"]);

  const savedMetadata = [];
  const actionRequests = [];
  const actions = loadAskStampyAction({ savedMetadata, actionRequests });
  const result = await actions.askStampyAction("Haceme un presupuesto de 100g");

  assert.equal(result.actionIntent.type, "create_quote");
  assert.equal(result.actionIntent.canExecute, false);
  assert.equal(result.actionRequestId, null);
  assert.deepEqual(result.knowledgeTools, []);
  assert.match(result.answer, /cliente, producto y cantidad/);
  assert.match(result.answer, /No calculé ningún precio/);
  assert.equal(actionRequests.length, 0);
  assert.deepEqual(savedMetadata[0].validation, {
    isValid: false,
    missingFields: ["clientName", "productName", "quantity"],
    invalidFields: [],
    warnings: ["El precio debe definirse y revisarse dentro de Presupuestos."]
  });
});

test("a complete quote is validated and derived safely to quotes", async () => {
  const message = "Hacé un presupuesto para Lucas Marchetti de 2 Jarros de Argentina";
  const { actionIntent, validation } = detectAndValidate(message);
  assert.equal(actionIntent.type, "create_quote");
  assert.equal(validation.isValid, true);
  assert.deepEqual(validation.normalizedExtracted, {
    clientName: "Lucas Marchetti",
    productName: "Jarros de Argentina",
    quantity: 2
  });
  const expectedHref = "/presupuestos?action=new&client=Lucas%20Marchetti&title=Presupuesto%20Lucas%20Marchetti";
  assert.equal(actionIntent.toolHref, expectedHref);
  assert.doesNotMatch(actionIntent.toolHref, /[?&]product=/);
  assert.doesNotMatch(actionIntent.toolHref, /[?&]quantity=/);

  const actionRequests = [];
  const savedMetadata = [];
  const actions = loadAskStampyAction({ actionRequests, savedMetadata });
  const result = await actions.askStampyAction(message);
  assert.equal(result.validation.isValid, true);
  assert.equal(result.actionIntent.canExecute, false);
  assert.equal(
    result.knowledgeTools[0].route,
    expectedHref
  );
  assert.equal(actionRequests.length, 1);
  assert.equal(actionRequests[0].actionIntent.toolHref, expectedHref);
  assert.equal(savedMetadata[0].actionIntent.toolHref, expectedHref);
  assert.doesNotMatch(result.answer, /\$|precio de \d/i);
});

test("calculator validates grams and hours and never calculates a price in chat", async () => {
  const message = "Calculame una impresión de 167g y 5h";
  const { actionIntent, validation } = detectAndValidate(message);
  assert.equal(actionIntent.type, "calculate_price");
  assert.equal(validation.isValid, true);
  assert.equal(validation.normalizedExtracted.grams, 167);
  assert.equal(validation.normalizedExtracted.hours, 5);

  const actions = loadAskStampyAction();
  const result = await actions.askStampyAction(message);
  assert.equal(result.validation.isValid, true);
  assert.match(result.knowledgeTools[0].route, /^\/calculadora/);
  assert.equal(result.actionIntent.canExecute, false);
  assert.doesNotMatch(result.answer, /\$|precio de \d/i);
});

test("calculator without grams or hours asks for both and creates no action request", async () => {
  const actionRequests = [];
  const actions = loadAskStampyAction({ actionRequests });
  const result = await actions.askStampyAction("Calculame precio");

  assert.equal(result.validation.isValid, false);
  assert.deepEqual(result.validation.missingFields, ["grams", "hours"]);
  assert.match(result.answer, /gramos y horas/);
  assert.deepEqual(result.knowledgeTools, []);
  assert.equal(result.actionRequestId, null);
  assert.equal(actionRequests.length, 0);
});

test("invalid quote validation removes the tool href", async () => {
  const rawIntent = actionIntents.detectStampyActionIntent({
    message: "Haceme un presupuesto de 100g"
  });
  assert.equal(rawIntent.toolHref, undefined);

  const actions = loadAskStampyAction();
  const result = await actions.askStampyAction("Haceme un presupuesto de 100g");
  assert.equal(result.validation.isValid, false);
  assert.equal(result.actionIntent.toolHref, undefined);
  assert.equal(result.actionIntent.canExecute, false);
});

test("the shared action button navigates with the complete action intent href", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/stampy/ActionIntentCard.tsx"),
    "utf8"
  );

  assert.match(source, /router\.push\(actionIntent\.toolHref\)/);
  assert.match(source, /\[Stampy Tool Link\]/);
  assert.doesNotMatch(source, /router\.push\(.*contract\.route/);
});

test("calculator intent extracts and encodes all supported prefill fields", () => {
  const message = "Calculame el precio de una impresión en la Creality HI de 5hs y 167gr de filamento PLA W3D Cian para un cliente minorista";
  const { actionIntent, validation } = detectAndValidate(message);

  assert.equal(actionIntent.type, "calculate_price");
  assert.equal(validation.isValid, true);
  assert.deepEqual(actionIntent.extracted, {
    grams: 167,
    hours: 5,
    printerName: "Creality HI",
    material: "PLA",
    brand: "W3D",
    color: "Cian",
    productType: "minorista"
  });
  assert.equal(
    actionIntent.toolHref,
    "/calculadora?action=calculate&grams=167&hours=5&printer=Creality%20HI&material=PLA&brand=W3D&color=Cian&productType=minorista"
  );
  assert.equal(actionIntent.canExecute, false);
});

test("calculator prefill matching tolerates richer printer and filament labels", () => {
  const printers = [
    { id: "printer-1", name: "Creality HI Combo" },
    { id: "printer-2", name: "Bambu A1" }
  ];
  const filaments = [
    {
      id: "filament-1",
      filament_type: "PLA",
      brand: "W3D",
      name: "PLA W3D SILK",
      color: "Cian"
    }
  ];
  const productTypes = [{ id: "type-1", name: "Minorista" }];

  assert.equal(toolPrefill.findStampyNamedMatch(printers, "Creality HI")?.id, "printer-1");
  assert.equal(
    toolPrefill.findStampyFilamentMatch(filaments, {
      material: "PLA",
      brand: "W3D",
      color: "Cian"
    })?.id,
    "filament-1"
  );
  assert.equal(toolPrefill.findStampyNamedMatch(productTypes, "minorista")?.id, "type-1");
});

test("quotes applies prefill once after loading and cleans the URL without navigation", () => {
  const source = fs
    .readFileSync(path.join(root, "src/app/presupuestos/page.tsx"), "utf8")
    .replace(/\r\n/g, "\n");

  const loadingGuardIndex = source.indexOf("if (loading || prefillAppliedRef.current) return;");
  const markAppliedIndex = source.indexOf("prefillAppliedRef.current = true;", loadingGuardIndex);
  const openNewIndex = source.indexOf('setEditingId("new");', markAppliedIndex);
  const cleanUrlIndex = source.indexOf("window.history.replaceState", openNewIndex);

  assert.ok(loadingGuardIndex > 0);
  assert.ok(markAppliedIndex > loadingGuardIndex);
  assert.ok(openNewIndex > markAppliedIndex);
  assert.ok(cleanUrlIndex > openNewIndex);
  assert.match(source, /searchParams\.get\("client"\)/);
  assert.match(source, /searchParams\.get\("product"\)/);
  assert.match(source, /searchParams\.get\("quantity"\)/);
  assert.match(source, /searchParams\.get\("title"\)/);
  assert.match(source, /searchParams\.get\("notes"\)/);
  assert.doesNotMatch(source, /router\.replace\("\/presupuestos"/);
});

test("consecutive client replies keep the second response tied to the second request", () => {
  const firstRequestId = "request-1";
  const secondRequestId = "request-2";
  const messages = [
    {
      id: clientMessageIds.createStampyMessageId(firstRequestId, "user"),
      content: "Respondé solamente: Azul marino"
    },
    {
      id: clientMessageIds.createStampyMessageId(firstRequestId, "assistant"),
      content: "Azul marino"
    },
    {
      id: clientMessageIds.createStampyMessageId(secondRequestId, "user"),
      content: "Respondé solamente: una torta de cumpleaños"
    },
    {
      id: clientMessageIds.createStampyMessageId(secondRequestId, "assistant"),
      content: "una torta de cumpleaños"
    }
  ];

  assert.equal(messages.at(-1).id, "request-2:assistant");
  assert.equal(messages.at(-1).content, "una torta de cumpleaños");
  assert.notEqual(messages.at(-1).content, messages[1].content);

  for (const relativePath of [
    "src/app/stampy/page.tsx",
    "src/components/stampy/GlobalStampyWidget.tsx",
    "src/components/stampy/StampyLessonChat.tsx"
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(source, /setMessages\(\[\.\.\.newMessages/);
    assert.match(source, /key=\{(?:msg|m)\.id\}/);
    assert.match(source, /requestInFlightRef\.current/);
  }
});

test("filament stock increase remains valid and non-executable", () => {
  const { actionIntent, validation } = detectAndValidate("Agregame 50g de PLA Cian W3D");
  assert.equal(actionIntent.type, "increase_filament_stock");
  assert.equal(validation.isValid, true);
  assert.equal(validation.normalizedExtracted.grams, 50);
  assert.equal(actionIntent.canExecute, false);
});

test("one filament roll is normalized to 1000 grams", () => {
  const { actionIntent, validation } = detectAndValidate("Agregame un rollo de PLA W3D");
  assert.equal(actionIntent.type, "increase_filament_stock");
  assert.equal(validation.isValid, true);
  assert.equal(validation.normalizedExtracted.grams, 1000);
});

test("filament discount without grams is invalid", async () => {
  const actions = loadAskStampyAction();
  const result = await actions.askStampyAction("Descontame PLA");

  assert.equal(result.actionIntent.type, "discount_filament");
  assert.equal(result.validation.isValid, false);
  assert.deepEqual(result.validation.missingFields, ["grams"]);
  assert.match(result.answer, /gramos/);
  assert.equal(result.actionRequestId, null);
});

test("new filament validates as create rather than stock increase", () => {
  const { actionIntent, validation } = detectAndValidate(
    "Creame un filamento nuevo PETG rojo Elegoo"
  );
  assert.equal(actionIntent.type, "add_filament");
  assert.notEqual(actionIntent.type, "increase_filament_stock");
  assert.equal(validation.isValid, true);
  assert.equal(validation.normalizedExtracted.material, "PETG");
  assert.equal(actionIntent.canExecute, false);
});

test("direct intents and oversized messages return before OpenAI and retrieval setup", () => {
  const source = fs
    .readFileSync(path.join(root, "src/app/stampy/actions.ts"), "utf8")
    .replace(/\r\n/g, "\n");
  const validationIndex = source.indexOf("validateStampyMessage(message)");
  const rateLimitIndex = source.indexOf("checkStampyRateLimit");
  const detectionIndex = source.indexOf("detectStampyActionIntent({");
  const directReturnIndex = source.indexOf(
    "actionIntent: validatedActionIntent,\n        validation: validationMetadata,\n      };",
    detectionIndex
  );
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
