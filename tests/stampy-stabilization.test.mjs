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

function loadAskStampyAction({
  touchedTables = [],
  savedMetadata = [],
  actionRequests = [],
  duplicateCheck = { status: "clear" },
  filamentMatch = {
    status: "unique",
    filament: {
      id: "filament-1",
      user_id: "user-1",
      name: "PLA Cian",
      filament_type: "PLA",
      brand: "W3D",
      color: "Cian",
      remaining_grams: 900,
      total_grams: 1000,
      is_active: true
    }
  }
} = {}) {
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
    "@/lib/stampy/action-executor": {
      resolveFilamentMatch: async () => filamentMatch,
      findDuplicateActiveFilament: async () => duplicateCheck,
      getResolvedFilamentLabel: (filament) =>
        [filament.filament_type, filament.brand, filament.name, filament.color]
          .filter(Boolean)
          .join(" · ")
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

test("a unique filament match creates a suggested confirmation without changing stock", async () => {
  const touchedTables = [];
  const actionRequests = [];
  const savedMetadata = [];
  const actions = loadAskStampyAction({ touchedTables, actionRequests, savedMetadata });
  const result = await actions.askStampyAction("Descontame 50g de PLA Cian W3D");

  assert.equal(result.actionIntent.type, "discount_filament");
  assert.equal(result.actionIntent.canExecute, false);
  assert.equal(result.actionIntent.extracted.requiresConfirmation, true);
  assert.equal(result.actionIntent.extracted.matchStatus, "unique");
  assert.deepEqual(result.actionIntent.extracted.resolvedTarget, {
    type: "filament",
    id: "filament-1",
    label: "PLA · W3D · PLA Cian · Cian",
    remainingGramsBefore: 900
  });
  assert.match(result.answer, /necesito que confirmes/i);
  assert.match(result.answer, /Todavía no modifiqué tu stock/i);
  assert.equal(actionRequests.length, 1);
  assert.equal(actionRequests[0].actionIntent.extracted.requiresConfirmation, true);
  assert.equal(savedMetadata[0].actionIntent.extracted.resolvedTarget.id, "filament-1");
  assert.deepEqual(touchedTables, ["stampy_messages"]);
});

test("multiple filament matches disable confirmation and keep Stock as fallback", async () => {
  const actions = loadAskStampyAction({
    filamentMatch: {
      status: "multiple",
      matches: [{ id: "filament-1" }, { id: "filament-2" }]
    }
  });
  const result = await actions.askStampyAction("Descontame 50g de PLA Cian");

  assert.equal(result.actionIntent.extracted.requiresConfirmation, false);
  assert.equal(result.actionIntent.extracted.matchStatus, "multiple");
  assert.match(result.answer, /más de un filamento/i);
  assert.match(result.knowledgeTools[0].route, /^\/stock/);
});

test("missing filament matches disable confirmation and keep Stock as fallback", async () => {
  const actions = loadAskStampyAction({
    filamentMatch: { status: "none", matches: [] }
  });
  const result = await actions.askStampyAction("Agregame 50g de PETG Rojo");

  assert.equal(result.actionIntent.extracted.requiresConfirmation, false);
  assert.equal(result.actionIntent.extracted.matchStatus, "none");
  assert.match(result.answer, /No encontré un filamento activo/i);
  assert.match(result.knowledgeTools[0].route, /^\/stock/);
});

test("quotes remain safe and never expose real confirmation", async () => {
  const actions = loadAskStampyAction();
  const result = await actions.askStampyAction(
    "Hacé un presupuesto para Lucas Marchetti de 2 Jarros de Argentina"
  );

  assert.equal(result.actionIntent.type, "create_quote");
  assert.equal(result.actionIntent.canExecute, false);
  assert.notEqual(result.actionIntent.extracted.requiresConfirmation, true);
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

test("a valid new PETG filament is prepared for explicit confirmation", async () => {
  const actionRequests = [];
  const actions = loadAskStampyAction({ actionRequests });
  const result = await actions.askStampyAction(
    "Creame un filamento nuevo PETG rojo Elegoo de 1kg"
  );

  assert.equal(result.actionIntent.type, "add_filament");
  assert.equal(result.actionIntent.canExecute, false);
  assert.equal(result.actionIntent.extracted.material, "PETG");
  assert.equal(result.actionIntent.extracted.brand, "ELEGOO");
  assert.equal(result.actionIntent.extracted.color, "rojo");
  assert.equal(result.actionIntent.extracted.totalGrams, 1000);
  assert.equal(result.actionIntent.extracted.totalGramsAssumed, false);
  assert.equal(result.actionIntent.extracted.requiresConfirmation, true);
  assert.equal(result.actionIntent.extracted.duplicateStatus, "clear");
  assert.match(result.answer, /necesito que confirmes/i);
  assert.equal(actionRequests.length, 1);
  assert.equal(actionRequests[0].actionIntent.extracted.actionType, "add_filament");
});

test("a new filament defaults to a clearly disclosed 1000g roll", async () => {
  const actions = loadAskStampyAction();
  const result = await actions.askStampyAction(
    "Creame un filamento nuevo PLA W3D Cian"
  );

  assert.equal(result.actionIntent.type, "add_filament");
  assert.equal(result.actionIntent.extracted.totalGrams, 1000);
  assert.equal(result.actionIntent.extracted.totalGramsAssumed, true);
  assert.match(result.answer, /1000g \(asumido\)/i);
});

test("new filament extraction keeps subtype separate from the full label", () => {
  const intent = actionIntents.detectStampyActionIntent({
    message: "Creá un rollo nuevo de PLA Hellbot Ecofila azul",
  });

  assert.equal(intent.type, "add_filament");
  assert.equal(intent.extracted.material, "PLA");
  assert.equal(intent.extracted.brand, "HELLBOT");
  assert.equal(intent.extracted.name, "Ecofila");
  assert.equal(intent.extracted.color, "azul");
  assert.equal(intent.extracted.totalGrams, 1000);
  assert.equal(intent.extracted.totalGramsAssumed, false);
});

test("a duplicate active filament disables creation confirmation and keeps Stock fallback", async () => {
  const actions = loadAskStampyAction({
    duplicateCheck: {
      status: "duplicate",
      filament: {
        id: "existing-filament",
        user_id: "user-1",
        name: null,
        filament_type: "PLA",
        brand: "W3D",
        color: "Cian",
        remaining_grams: 800,
        total_grams: 1000,
        is_active: true,
      },
    },
  });
  const result = await actions.askStampyAction(
    "Creame un filamento nuevo PLA W3D Cian"
  );

  assert.equal(result.actionIntent.extracted.requiresConfirmation, false);
  assert.equal(result.actionIntent.extracted.duplicateStatus, "duplicate");
  assert.match(result.answer, /evitar duplicados/i);
  assert.match(result.actionIntent.toolHref, /^\/stock/);
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
    "@/lib/auth/user-access": { getCurrentUserAccess: async () => ({ access: {} }) },
    "./action-executor": {
      executeFilamentStockMovement: async () => ({ success: false }),
      executeCreateFilament: async () => ({ success: false }),
    },
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

function loadHistoryModule() {
  return loadTypeScriptModule("src/lib/stampy/history.ts", {
    "@supabase/supabase-js": {},
    "./types": {}
  });
}

function makeHistorySupabase(rows) {
  const queries = [];
  return {
    queries,
    from(table) {
      assert.equal(table, "stampy_messages");
      const filters = {};
      const query = {
        select() {
          return this;
        },
        eq(column, value) {
          filters[column] = value;
          return this;
        },
        order(column, options) {
          assert.equal(column, "created_at");
          assert.deepEqual(options, { ascending: false });
          return this;
        },
        async limit(limit) {
          queries.push({ filters: { ...filters }, limit });
          const data = rows
            .filter((row) =>
              Object.entries(filters).every(([column, value]) => row[column] === value)
            )
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
            .slice(0, limit)
            .map(({ role, content, created_at }) => ({ role, content, created_at }));
          return { data, error: null };
        }
      };
      return query;
    }
  };
}

test("recent history is isolated by both conversation and current user", async () => {
  const history = loadHistoryModule();
  const supabase = makeHistorySupabase([
    {
      conversation_id: "conversation-a",
      user_id: "user-1",
      role: "user",
      content: "Hacé un presupuesto para Lucas de 2 jarros y 100g.",
      created_at: "2026-08-26T10:00:00.000Z"
    },
    {
      conversation_id: "conversation-b",
      user_id: "user-1",
      role: "user",
      content: "Siempre uso OrcaSlicer.",
      created_at: "2026-08-26T11:00:00.000Z"
    },
    {
      conversation_id: "conversation-b",
      user_id: "user-2",
      role: "user",
      content: "Dato de otro usuario.",
      created_at: "2026-08-26T12:00:00.000Z"
    }
  ]);

  const previousMessages = await history.getRecentHistory(
    supabase,
    "conversation-b",
    "user-1"
  );

  assert.deepEqual(previousMessages, [
    { role: "user", content: "Siempre uso OrcaSlicer." }
  ]);
  assert.doesNotMatch(JSON.stringify(previousMessages), /Lucas|jarros|100g|presupuesto/i);
  assert.deepEqual(supabase.queries[0], {
    filters: { conversation_id: "conversation-b", user_id: "user-1" },
    limit: 8
  });
});

test("recent history remains chronological inside the same conversation", async () => {
  const history = loadHistoryModule();
  const supabase = makeHistorySupabase([
    {
      conversation_id: "conversation-blue",
      user_id: "user-1",
      role: "user",
      content: "Mi color favorito para esta prueba es azul marino.",
      created_at: "2026-08-26T10:00:00.000Z"
    },
    {
      conversation_id: "conversation-blue",
      user_id: "user-1",
      role: "assistant",
      content: "Lo tengo presente en esta conversación.",
      created_at: "2026-08-26T10:01:00.000Z"
    }
  ]);

  assert.deepEqual(
    await history.getRecentHistory(supabase, "conversation-blue", "user-1"),
    [
      { role: "user", content: "Mi color favorito para esta prueba es azul marino." },
      { role: "assistant", content: "Lo tengo presente en esta conversación." }
    ]
  );
});

test("ensureConversation creates a new row when no explicit conversation id is sent", async () => {
  const history = loadHistoryModule();
  let existingConversationLookupCount = 0;
  const insertedRows = [];
  const supabase = {
    from(table) {
      assert.equal(table, "stampy_conversations");
      return {
        select() {
          existingConversationLookupCount += 1;
          throw new Error("No existing conversation should be selected");
        },
        insert(row) {
          insertedRows.push(row);
          return {
            select() {
              return {
                async single() {
                  return { data: { id: "conversation-new" }, error: null };
                }
              };
            }
          };
        }
      };
    }
  };

  const conversationId = await history.ensureConversation({
    supabase,
    userId: "user-1",
    conversationId: null,
    message: "¿Qué color te dije recién?"
  });

  assert.equal(conversationId, "conversation-new");
  assert.equal(existingConversationLookupCount, 0);
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].user_id, "user-1");
});

test("ensureConversation never reuses an explicit conversation owned by another user", async () => {
  const history = loadHistoryModule();
  const insertedRows = [];
  let updatedForeignConversation = false;
  const supabase = {
    from(table) {
      assert.equal(table, "stampy_conversations");
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, "id");
              assert.equal(value, "conversation-foreign");
              return {
                async single() {
                  return {
                    data: { id: "conversation-foreign", user_id: "user-2" },
                    error: null
                  };
                }
              };
            }
          };
        },
        update() {
          updatedForeignConversation = true;
          return { eq: async () => ({ error: null }) };
        },
        insert(row) {
          insertedRows.push(row);
          return {
            select() {
              return {
                async single() {
                  return { data: { id: "conversation-owned" }, error: null };
                }
              };
            }
          };
        }
      };
    }
  };

  const conversationId = await history.ensureConversation({
    supabase,
    userId: "user-1",
    conversationId: "conversation-foreign",
    message: "Nueva conversación segura"
  });

  assert.equal(conversationId, "conversation-owned");
  assert.equal(updatedForeignConversation, false);
  assert.equal(insertedRows.length, 1);
});

test("Stampy clients use separate conversation storage keys and reset controls", () => {
  const mainSource = fs.readFileSync(path.join(root, "src/app/stampy/page.tsx"), "utf8");
  const widgetSource = fs.readFileSync(
    path.join(root, "src/components/stampy/GlobalStampyWidget.tsx"),
    "utf8"
  );
  const lessonSource = fs.readFileSync(
    path.join(root, "src/components/stampy/StampyLessonChat.tsx"),
    "utf8"
  );
  const courseSource = fs.readFileSync(
    path.join(root, "src/app/cursos/[id]/page.tsx"),
    "utf8"
  );

  assert.match(mainSource, /stampy_main_conversation_id/);
  assert.match(widgetSource, /stampy_widget_conversation_id/);
  assert.match(lessonSource, /stampy_lesson_conversation_id_\$\{lessonId\}/);
  assert.match(mainSource, /localStorage\.removeItem\(MAIN_CONVERSATION_STORAGE_KEY\)/);
  assert.match(widgetSource, /localStorage\.removeItem\(WIDGET_CONVERSATION_STORAGE_KEY\)/);
  assert.match(
    lessonSource,
    /localStorage\.removeItem\(getLessonConversationStorageKey\(lesson\.id\)\)/
  );
  assert.match(widgetSource, />\s*Nueva conversación\s*</);
  assert.match(lessonSource, />\s*Nueva conversación\s*</);
  assert.match(courseSource, /<StampyLessonChat\s+key=\{activeLesson\.id\}/);
});

test("history diagnostics are development-only and contain compact previews", () => {
  const source = fs.readFileSync(path.join(root, "src/lib/stampy/history.ts"), "utf8");
  const environmentGuard = source.indexOf('process.env.NODE_ENV !== "production"');
  const logIndex = source.indexOf('console.log("[Stampy History]"');

  assert.ok(environmentGuard > 0);
  assert.ok(logIndex > environmentGuard);
  assert.match(source, /previousMessagesCount: history\.length/);
  assert.match(source, /substring\(0, 80\)/);
});
