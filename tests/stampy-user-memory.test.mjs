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
  const loadedModule = { exports: {} };

  new Function("require", "module", "exports", outputText)(
    (specifier) => {
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      throw new Error(`Unexpected dependency ${specifier} while loading ${relativePath}`);
    },
    loadedModule,
    loadedModule.exports
  );

  return loadedModule.exports;
}

const userMemory = loadTypeScriptModule("src/lib/stampy/user-memory.ts");
const messagePolicy = loadTypeScriptModule("src/lib/stampy/message-policy.ts");
const knowledgeIntent = loadTypeScriptModule("src/lib/stampy/knowledge-intent.ts");
const screenContext = loadTypeScriptModule("src/lib/stampy/screen-context.ts");
const toolRegistry = loadTypeScriptModule("src/lib/stampy/tool-registry.ts");
const actionIntents = loadTypeScriptModule("src/lib/stampy/action-intents.ts", {
  "./tool-registry": toolRegistry,
  "./types": {},
});
const actionValidator = loadTypeScriptModule("src/lib/stampy/action-validator.ts", {
  "./tool-registry": toolRegistry,
  "./types": {},
});
const replyPolicy = loadTypeScriptModule("src/lib/stampy/reply-policy.ts");

function makeMemory(overrides = {}) {
  return {
    id: "memory-1",
    user_id: "user-1",
    category: "printing",
    memory_key: "preferred_material",
    memory_value: "PLA",
    confidence: 0.9,
    source_message_id: null,
    created_at: "2026-08-25T12:00:00.000Z",
    updated_at: "2026-08-25T12:00:00.000Z",
    ...overrides,
  };
}

function loadMemoryAwareAskStampyAction({
  loadMemory,
  saveMemory,
  openAiAnswer = "Respuesta normal",
  recentHistory = [],
  retrieveKnowledge,
  findRecommendations,
  buildRecommendationText,
} = {}) {
  const events = [];
  const assistantMetadata = [];
  const metadataUpdates = [];
  const rpcCalls = [];
  const completionPayloads = [];
  const savedTurns = [];
  const retrievalCalls = [];
  const recommendationCalls = [];

  const lessonsQuery = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  const supabase = {
    async rpc(name, params) {
      events.push("memory-save");
      rpcCalls.push({ name, params });
      return { data: null, error: null };
    },
    from(table) {
      if (table === "lessons") return lessonsQuery;
      if (table === "stampy_messages") {
        return {
          update(payload) {
            metadataUpdates.push(payload.metadata);
            return {
              async eq() {
                return { data: null, error: null };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  class MockOpenAI {
    constructor() {
      this.chat = {
        completions: {
          create: async (payload) => {
            events.push("openai");
            completionPayloads.push(payload);
            return { choices: [{ message: { content: openAiAnswer } }] };
          },
        },
      };
    }
  }

  const memoryModule = {
    loadRelevantMemory:
      loadMemory ??
      (async () => {
        events.push("memory-load");
        return { memories: [], promptText: "", error: null };
      }),
    saveUserMemory: saveMemory ?? userMemory.saveUserMemory,
  };

  const actions = loadTypeScriptModule("src/app/stampy/actions.ts", {
    "@/utils/supabase/server": { createClient: async () => supabase },
    "@/lib/auth/user-access": {
      getCurrentUserAccess: async () => ({
        access: {
          authenticated: true,
          userId: "user-1",
          capabilities: { useStampy: true },
        },
      }),
    },
    "@/lib/stampy/message-policy": messagePolicy,
    "@/lib/stampy/screen-context": screenContext,
    "@/lib/stampy/static-page-contexts": {
      getStaticStampyPageContext: () => null,
    },
    "@/lib/stampy/rate-limit": {
      checkStampyRateLimit: async () => ({ isBlocked: false }),
    },
    "@/lib/stampy/history": {
      ensureConversation: async () => "conversation-1",
      getRecentHistory: async () => recentHistory,
      saveMessages: async (...args) => {
        events.push("messages-saved");
        assistantMetadata.push(args[5]);
        savedTurns.push({ user: args[3], assistant: args[4] });
        return { userMessageId: "user-message-1", assistantMessageId: "assistant-message-1" };
      },
    },
    "@/lib/stampy/action-intents": actionIntents,
    "@/lib/stampy/action-validator": actionValidator,
    "@/lib/stampy/reply-policy": replyPolicy,
    "@/lib/stampy/tool-registry": toolRegistry,
    "@/lib/stampy/action-settings": {
      getStampyActionSettings: async () => ({
        settings: {
          autoExecuteLowRisk: false,
          autoExecuteFilamentMovements: false,
          autoExecuteCreateFilament: false,
          autoExecuteCreatePrinter: false,
        },
        error: null,
      }),
      canAutoExecuteStampyAction: () => false,
    },
    "@/lib/stampy/action-requests": {
      createStampyActionRequest: async () => ({
        actionRequestId: "action-request-1",
        error: null,
      }),
    },
    "@/lib/stampy/action-executor": {
      findDuplicateActiveFilament: async () => ({ status: "clear" }),
      findDuplicatePrinter: async () => ({ status: "clear" }),
      resolveFilamentMatch: async () => ({
        status: "unique",
        filament: {
          id: "filament-1",
          user_id: "user-1",
          name: "PLA",
          filament_type: "PLA",
          brand: null,
          color: null,
          remaining_grams: 900,
          total_grams: 1000,
          is_active: true,
        },
      }),
      getResolvedFilamentLabel: () => "PLA",
      executeFilamentStockMovement: async () => ({ success: false }),
      executeCreateFilament: async () => ({ success: false }),
      executeCreatePrinter: async () => ({ success: false }),
      executeCreateProduct: async () => ({ success: false }),
    },
    "@/lib/stampy/user-memory": memoryModule,
    "@/lib/stampy/workshop-context": {
      getStampyWorkshopContext: async () => ({
        text: "Sin datos de taller cargados.",
        printersCount: 0,
        filamentsCount: 0,
        productsCount: 0,
        activeFilamentsErrorMsg: null,
        sampleFilaments: "",
        isFilamentQuery: false,
        isProductQuery: false,
      }),
    },
    "@/lib/stampy/context-search": {
      getStampyRelevantContexts: async () => ({ contextsCount: 0, text: "" }),
    },
    "@/lib/stampy/user-context": { getStampyUserContext: async () => null },
    "@/lib/stampy/knowledge-search": { findRelevantKnowledge: () => [] },
    "@/lib/stampy/retrieval": {
      retrieveStampyKnowledge: async (params) => {
        retrievalCalls.push(params);
        return retrieveKnowledge ? retrieveKnowledge(params) : "";
      },
    },
    "@/lib/stampy/knowledge-intent": knowledgeIntent,
    "@/lib/stampy/lesson-recommendations": {
      findStampyLessonRecommendations: async (params) => {
        recommendationCalls.push(params);
        return findRecommendations ? findRecommendations(params) : [];
      },
      buildStampyLessonRecommendationText:
        buildRecommendationText ?? (() => ""),
    },
    "@/lib/stampy/usage-log": { logStampyUsage: async () => undefined },
    openai: { OpenAI: MockOpenAI },
  });

  return {
    actions,
    events,
    assistantMetadata,
    metadataUpdates,
    rpcCalls,
    completionPayloads,
    savedTurns,
    retrievalCalls,
    recommendationCalls,
  };
}

test('"Siempre uso Orca" extracts only a software memory', () => {
  assert.deepEqual(userMemory.extractUsefulMemory("Siempre uso Orca"), [
    {
      category: "software",
      memoryKey: "preferred_slicer",
      memoryValue: "Orca",
      confidence: 0.95,
    },
  ]);
});

test('"Siempre imprimo PLA" extracts a printing memory', () => {
  assert.deepEqual(userMemory.extractUsefulMemory("Siempre imprimo PLA"), [
    {
      category: "printing",
      memoryKey: "preferred_material",
      memoryValue: "PLA",
      confidence: 0.95,
    },
  ]);
});

test('"Vendo mates" extracts a business memory', () => {
  assert.deepEqual(userMemory.extractUsefulMemory("Vendo mates"), [
    {
      category: "business",
      memoryKey: "product",
      memoryValue: "mates",
      confidence: 0.9,
    },
  ]);
});

test("casual or irrelevant personal details are not remembered", () => {
  assert.deepEqual(userMemory.extractUsefulMemory("No dormí bien"), []);
  assert.deepEqual(userMemory.extractUsefulMemory("Mi perro se llama Moro"), []);
  assert.deepEqual(userMemory.extractUsefulMemory("Hoy estoy cansado"), []);
  assert.deepEqual(
    userMemory.extractUsefulMemory("Hacé un presupuesto para Lucas de 2 jarros y 100g"),
    []
  );
  assert.deepEqual(userMemory.extractUsefulMemory("Mi color favorito es azul marino"), []);
});

test("questions and negated facts are not remembered", () => {
  assert.deepEqual(userMemory.extractUsefulMemory("¿Usás Orca?"), []);
  assert.deepEqual(userMemory.extractUsefulMemory("No uso Orca"), []);
  assert.deepEqual(userMemory.extractUsefulMemory("Nunca imprimo PLA"), []);
  assert.deepEqual(userMemory.extractUsefulMemory("No vendo mates"), []);
});

test("hardware and workflow rules normalize useful values", () => {
  assert.deepEqual(userMemory.extractUsefulMemory("Tengo nozzle 0,6"), [
    {
      category: "hardware",
      memoryKey: "nozzle_diameter",
      memoryValue: "0.6 mm",
      confidence: 0.95,
    },
  ]);
  assert.deepEqual(userMemory.extractUsefulMemory("Siempre uso brim"), [
    {
      category: "workflow",
      memoryKey: "bed_adhesion",
      memoryValue: "Brim",
      confidence: 0.95,
    },
  ]);
});

test("saving an identical fact twice converges on one row and refreshes only updated_at", async () => {
  const rows = new Map();
  let clock = 0;
  const supabase = {
    async rpc(name, params) {
      assert.equal(name, "save_stampy_user_memory");
      const key = [
        params.p_user_id,
        params.p_category,
        params.p_memory_key,
        params.p_memory_value,
      ].join("|");
      const existing = rows.get(key);
      clock += 1;

      if (existing) {
        rows.set(key, { ...existing, updated_at: `time-${clock}` });
      } else {
        rows.set(key, {
          ...params,
          created_at: `time-${clock}`,
          updated_at: `time-${clock}`,
        });
      }

      return { data: rows.get(key), error: null };
    },
  };

  const first = await userMemory.saveUserMemory({
    supabase,
    userId: "user-1",
    message: "Siempre imprimo PLA",
    sourceMessageId: "message-1",
  });
  const original = structuredClone([...rows.values()][0]);
  const second = await userMemory.saveUserMemory({
    supabase,
    userId: "user-1",
    message: "Siempre imprimo PLA",
    sourceMessageId: "message-2",
  });
  const updated = [...rows.values()][0];

  assert.equal(rows.size, 1);
  assert.equal(first.savedCount, 1);
  assert.equal(second.savedCount, 1);
  assert.equal(updated.p_source_message_id, original.p_source_message_id);
  assert.equal(updated.p_confidence, original.p_confidence);
  assert.equal(updated.created_at, original.created_at);
  assert.notEqual(updated.updated_at, original.updated_at);
});

test("warping loads only hardware, printing and workflow memories", async () => {
  let queriedCategories = [];
  const rows = [
    makeMemory(),
    makeMemory({
      id: "memory-2",
      category: "hardware",
      memory_key: "nozzle_diameter",
      memory_value: "0.6 mm",
    }),
    makeMemory({
      id: "memory-3",
      category: "workflow",
      memory_key: "bed_adhesion",
      memory_value: "Brim",
    }),
  ];
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in(column, categories) {
      assert.equal(column, "category");
      queriedCategories = categories;
      return this;
    },
    order() {
      return this;
    },
    async limit() {
      return { data: rows, error: null };
    },
  };
  const supabase = {
    from(table) {
      assert.equal(table, "stampy_user_memory");
      return query;
    },
  };

  const result = await userMemory.loadRelevantMemory({
    supabase,
    userId: "user-1",
    message: "Tengo warping en las esquinas",
  });

  assert.deepEqual(queriedCategories, ["hardware", "printing", "workflow"]);
  assert.equal(queriedCategories.includes("business"), false);
  assert.equal(result.memories.length, 3);
  assert.match(result.promptText, /^MEMORIAS ÚTILES DEL USUARIO:/);
});

test("unrelated messages do not query persistent memory", async () => {
  let queryCount = 0;
  const supabase = {
    from() {
      queryCount += 1;
      throw new Error("No query expected");
    },
  };

  const result = await userMemory.loadRelevantMemory({
    supabase,
    userId: "user-1",
    message: "Hola, ¿cómo estás?",
  });

  assert.equal(queryCount, 0);
  assert.deepEqual(result, { memories: [], promptText: "", error: null });
});

test("askStampyAction saves an extracted memory only after persisting the response", async () => {
  const harness = loadMemoryAwareAskStampyAction();
  const result = await harness.actions.askStampyAction("Siempre uso Orca");

  assert.equal(result.answer, "Respuesta normal");
  assert.equal(harness.rpcCalls.length, 1);
  assert.deepEqual(harness.rpcCalls[0], {
    name: "save_stampy_user_memory",
    params: {
      p_user_id: "user-1",
      p_category: "software",
      p_memory_key: "preferred_slicer",
      p_memory_value: "Orca",
      p_confidence: 0.95,
      p_source_message_id: "user-message-1",
    },
  });
  assert.ok(harness.events.indexOf("openai") < harness.events.indexOf("messages-saved"));
  assert.ok(harness.events.indexOf("messages-saved") < harness.events.indexOf("memory-save"));
  assert.deepEqual(harness.metadataUpdates.at(-1).memory, {
    loadedCount: 0,
    savedCount: 1,
  });
});

test("askStampyAction injects relevant Orca memory into the system prompt", async () => {
  const orcaMemory = makeMemory({
    id: "software-1",
    category: "software",
    memory_key: "preferred_slicer",
    memory_value: "Orca",
  });
  const harness = loadMemoryAwareAskStampyAction({
    loadMemory: async ({ query, limit }) => {
      harness.events.push("memory-load");
      assert.equal(query, "¿Qué slicer me conviene usar?");
      assert.equal(limit, 10);
      return {
        memories: [orcaMemory],
        promptText: userMemory.formatRelevantMemoryForPrompt([orcaMemory]),
        error: null,
      };
    },
  });

  const result = await harness.actions.askStampyAction("¿Qué slicer me conviene usar?");
  const completionMessages = harness.completionPayloads[0].messages;
  const systemPrompt = completionMessages[0].content;

  assert.equal(result.answer, "Respuesta normal");
  assert.match(systemPrompt, /MEMORIAS ÚTILES DEL USUARIO:\n- Usa Orca\./);
  assert.doesNotMatch(systemPrompt, /Lucas|jarros|100g/i);
  assert.doesNotMatch(JSON.stringify(completionMessages.slice(1)), /Lucas|jarros|100g/i);
  assert.ok(
    systemPrompt.indexOf("DATOS DEL USUARIO Y TALLER:") <
      systemPrompt.indexOf("MEMORIAS ÚTILES DEL USUARIO:")
  );
  assert.ok(harness.events.indexOf("memory-load") < harness.events.indexOf("openai"));
  assert.deepEqual(harness.assistantMetadata[0].memory, {
    loadedCount: 1,
    savedCount: 0,
  });
});

test("askStampyAction injects a sanitized current UI snapshot before history", async () => {
  const harness = loadMemoryAwareAskStampyAction({
    recentHistory: [{ role: "assistant", content: "Mensaje histórico" }],
  });

  await harness.actions.askStampyAction("¿Qué te parece este presupuesto?", null, {
    source: "page",
    pathname: "/presupuestos",
    screenContext: {
      page: { section: "budgets", route: "/presupuestos", title: "Presupuestos" },
      mode: "create",
      permissions: { admin: true },
      formState: {
        kind: "budgetDraft",
        budgetType: "professional",
        client: { id: "client-1", name: "Cliente Demo" },
        items: [{ productId: "product-1", name: "Mate Messi", quantity: 2, unitPrice: 8500, unitBaseCost: 1 }],
        discountPercent: 10,
        taxRate: 21,
        additionalCharges: 500,
        summary: { subtotal: 17000, discount: 1700, tax: 3213, total: 19013 },
      },
    },
  });

  const messages = harness.completionPayloads[0].messages;
  const prompt = messages[0].content;
  assert.match(prompt, /CURRENT UI CONTEXT:/);
  assert.match(prompt, /Borrador de presupuesto: professional/);
  assert.match(prompt, /Mate Messi: cantidad 2, precio unitario 8500/);
  assert.match(prompt, /total 19013/);
  assert.doesNotMatch(prompt, /unitBaseCost|admin: true/);
  assert.equal(messages[1].content, "Mensaje histórico");
});

test("askStampyAction prioritizes the exact intent and a minimum sufficient response", async () => {
  const harness = loadMemoryAwareAskStampyAction();

  await harness.actions.askStampyAction("¿Cuánto es el total?");
  const prompt = harness.completionPayloads[0].messages[0].content;

  assert.match(prompt, /Resolver la intención actual del usuario/);
  assert.match(prompt, /respuesta mínima suficiente/i);
  assert.match(prompt, /Consulta simple: respondé en 1 a 3 frases/);
  assert.match(prompt, /Si el usuario pide el motivo, un desglose o más detalle, recién entonces ampliá/);
  assert.match(prompt, /No enumeres ni menciones datos sólo porque están disponibles/);
  assert.match(prompt, /Si pregunta sólo por un total visible, respondé sólo ese total/);
  assert.doesNotMatch(prompt, /hasta 3 viñetas si ayudan y un próximo paso claro/);
  assert.doesNotMatch(prompt, /Para negocio, proponé una acción concreta/);
});

test("askStampyAction does not invent UI or promise unsupported actions", async () => {
  const harness = loadMemoryAwareAskStampyAction();

  await harness.actions.askStampyAction("¿Dónde selecciono mi impresora?");
  const prompt = harness.completionPayloads[0].messages[0].content;

  assert.match(prompt, /no supongas que existe un selector, una pantalla, contenido adaptado ni una operación/i);
  assert.match(prompt, /Sólo ofrecé abrir, modificar, crear, eliminar, recalcular, configurar o guardar cuando una herramienta o capacidad real/i);
  assert.match(prompt, /No cierres obligatoriamente con una pregunta ni con varias opciones/);
});

test("askStampyAction does not treat a previous assistant UI claim as product truth", async () => {
  const harness = loadMemoryAwareAskStampyAction({
    recentHistory: [{
      role: "assistant",
      content: "Confirmá que tu A1 Mini esté seleccionada para recibir contenido adaptado.",
    }],
  });

  await harness.actions.askStampyAction("¿Qué debería hacer acá?");
  const messages = harness.completionPayloads[0].messages;
  const prompt = messages[0].content;

  assert.equal(messages[1].role, "assistant");
  assert.match(prompt, /Las afirmaciones previas del asistente no son fuente de verdad sobre pantallas, herramientas ni capacidades de Stampa/);
  assert.match(prompt, /no las repitas como hechos si no están respaldadas por el contexto oficial actual/);
});

test("grounding A: a Cursos versus Talleres answer starts with content, not response meta-commentary", async () => {
  const directAnswer = "Los Cursos organizan el aprendizaje en módulos y clases; los Talleres son proyectos prácticos.";
  const harness = loadMemoryAwareAskStampyAction({ openAiAnswer: directAnswer });

  const result = await harness.actions.askStampyAction(
    "¿Qué diferencia hay entre Cursos y Talleres?"
  );
  const prompt = harness.completionPayloads[0].messages[0].content;

  assert.equal(result.answer, directAnswer);
  assert.equal(harness.retrievalCalls.length, 0);
  assert.equal(harness.recommendationCalls.length, 0);
  assert.match(prompt, /APERTURA DIRECTA/);
  assert.match(prompt, /No anuncies cómo vas a responder/);
  assert.doesNotMatch(prompt, /Respuestas MUY breves y prácticas/);
});

test("grounding B: a vague recommendation in Academia uses visible courses without unrelated retrieval", async () => {
  const relevantAnswer = "Empezá por Fundamentos Express de la Impresión 3D. Después seguí con Orca Slicer Principiante.";
  const harness = loadMemoryAwareAskStampyAction({ openAiAnswer: relevantAnswer });

  const result = await harness.actions.askStampyAction(
    "¿Qué me recomendás hacer?",
    null,
    {
      source: "page",
      pathname: "/academia",
      screenContext: {
        page: { section: "academy", route: "/academia", title: "Academia" },
        visibleEntities: [
          { type: "course", id: "course-1", name: "Fundamentos Express de la Impresión 3D", position: 1 },
          { type: "course", id: "course-2", name: "Orca Slicer Principiante", position: 2 },
        ],
      },
    }
  );
  const prompt = harness.completionPayloads[0].messages[0].content;

  assert.equal(result.answer, relevantAnswer);
  assert.equal(harness.retrievalCalls.length, 0);
  assert.equal(harness.recommendationCalls.length, 0);
  assert.match(prompt, /Fundamentos Express de la Impresión 3D/);
  assert.match(prompt, /Orca Slicer Principiante/);
  assert.doesNotMatch(prompt, /HELLBOT|W3D|Benchy|calibration cube/i);
});

test("grounding C: Academia exposes no capability to start a course", async () => {
  const safeAnswer = "No puedo iniciarlo por vos desde acá; lo encontrás dentro de Cursos.";
  const harness = loadMemoryAwareAskStampyAction({ openAiAnswer: safeAnswer });

  const result = await harness.actions.askStampyAction(
    "¿Podés arrancarme el curso?",
    null,
    { source: "page", pathname: "/academia" }
  );
  const prompt = harness.completionPayloads[0].messages[0].content;

  assert.equal(result.answer, safeAnswer);
  assert.equal(harness.recommendationCalls.length, 0);
  assert.match(prompt, /AVAILABLE ACTIONS \(FUENTE CANÓNICA DEL TURNO\)/);
  assert.match(prompt, /Acciones que esta respuesta puede ejecutar:\n- Ninguna/);
  assert.match(prompt, /no afirmes ni sugieras que podés realizarla/i);
});

test("grounding D: an absent course exercise cannot be presented as official content", async () => {
  const safeAnswer = "No encuentro un primer ejercicio definido en el contenido oficial disponible.";
  const harness = loadMemoryAwareAskStampyAction({ openAiAnswer: safeAnswer });

  const result = await harness.actions.askStampyAction(
    "Dame el primer ejercicio del curso.",
    null,
    { source: "page", pathname: "/academia" }
  );
  const prompt = harness.completionPayloads[0].messages[0].content;

  assert.equal(result.answer, safeAnswer);
  assert.equal(harness.recommendationCalls.length, 0);
  assert.match(prompt, /GROUNDING DE CONTENIDO DE ACADEMIA/);
  assert.match(prompt, /un título de curso no prueba que tenga determinado primer ejercicio/i);
  assert.match(prompt, /sugerencia de Stampy.*nunca como parte oficial/i);
});

test("grounding E: a visible course location stays concrete and avoids semantic retrieval", async () => {
  const locationAnswer = "Lo encontrás dentro de Cursos como “Fundamentos Express de la Impresión 3D”.";
  const harness = loadMemoryAwareAskStampyAction({ openAiAnswer: locationAnswer });

  const result = await harness.actions.askStampyAction(
    "¿Dónde está Fundamentos Express?",
    null,
    {
      source: "page",
      pathname: "/academia",
      screenContext: {
        page: { section: "academy", route: "/academia" },
        visibleEntities: [
          { type: "section", id: "courses", name: "Cursos", position: 1 },
          { type: "course", id: "course-1", name: "Fundamentos Express de la Impresión 3D", position: 2 },
        ],
      },
    }
  );

  assert.equal(result.answer, locationAnswer);
  assert.equal(harness.retrievalCalls.length, 0);
  assert.equal(harness.recommendationCalls.length, 0);
});

test("grounding F: a false capability in assistant history is overridden by current canonical actions", async () => {
  const harness = loadMemoryAwareAskStampyAction({
    recentHistory: [{
      role: "assistant",
      content: "Puedo arrancarte el curso y marcar la primera clase como iniciada.",
    }],
    openAiAnswer: "No puedo iniciarlo por vos desde acá; tenés que abrirlo desde Cursos.",
  });

  await harness.actions.askStampyAction(
    "Entonces arrancalo.",
    null,
    { source: "page", pathname: "/academia" }
  );
  const prompt = harness.completionPayloads[0].messages[0].content;

  assert.match(prompt, /Un nombre o una capacidad mencionados por una respuesta anterior del asistente no prueban que existan/);
  assert.match(prompt, /Acciones que esta respuesta puede ejecutar:\n- Ninguna/);
  assert.match(prompt, /Las afirmaciones previas del asistente no son fuente de verdad/);
});

test("askStampyAction returns and persists only the current turn when the model repeats a prior reply", async () => {
  const previousReply = "Empezá por la ruta Principiante Bambu.";
  const currentReply = "Los Cursos enseñan por clases y los Talleres son proyectos prácticos.";
  const harness = loadMemoryAwareAskStampyAction({
    recentHistory: [
      { role: "user", content: "¿Qué debería hacer acá?" },
      { role: "assistant", content: previousReply },
    ],
    openAiAnswer: `${previousReply}\n\n${currentReply}`,
  });

  const result = await harness.actions.askStampyAction("¿Qué son los Cursos y Talleres?");
  const completionMessages = harness.completionPayloads[0].messages;

  assert.equal(completionMessages[2].content, previousReply);
  assert.equal(result.answer, currentReply);
  assert.deepEqual(harness.savedTurns, [{
    user: "¿Qué son los Cursos y Talleres?",
    assistant: currentReply,
  }]);
});

test("askStampyAction keeps short history inside the same explicit conversation", async () => {
  const harness = loadMemoryAwareAskStampyAction({
    recentHistory: [
      { role: "user", content: "Mi color favorito para esta prueba es azul marino." },
      { role: "assistant", content: "Entendido para esta conversación." },
    ],
  });

  await harness.actions.askStampyAction("¿Qué color te dije recién?");
  const messages = harness.completionPayloads[0].messages;

  assert.equal(messages[1].content, "Mi color favorito para esta prueba es azul marino.");
  assert.equal(messages.at(-1).content, "¿Qué color te dije recién?");
});

test("askStampyAction has no casual color context in a new conversation", async () => {
  const harness = loadMemoryAwareAskStampyAction();

  await harness.actions.askStampyAction("¿Qué color te dije recién?");
  const messages = harness.completionPayloads[0].messages;

  assert.equal(messages.length, 2);
  assert.equal(messages.at(-1).content, "¿Qué color te dije recién?");
  assert.doesNotMatch(JSON.stringify(messages), /azul marino/i);
});

test("askStampyAction does not persist casual messages", async () => {
  const harness = loadMemoryAwareAskStampyAction();
  const result = await harness.actions.askStampyAction("No dormí bien");

  assert.equal(result.answer, "Respuesta normal");
  assert.equal(harness.rpcCalls.length, 0);
  assert.deepEqual(harness.assistantMetadata[0].memory, {
    loadedCount: 0,
    savedCount: 0,
  });
});

test("memory load and save failures never replace a valid Stampy response", async () => {
  const harness = loadMemoryAwareAskStampyAction({
    loadMemory: async () => {
      throw new Error("load unavailable");
    },
    saveMemory: async () => {
      throw new Error("save unavailable");
    },
  });

  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const result = await harness.actions.askStampyAction("Siempre uso Orca");
    assert.equal(result.answer, "Respuesta normal");
    assert.equal(result.actionIntent, null);
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(harness.assistantMetadata[0].memory, {
    loadedCount: 0,
    savedCount: 0,
  });
});

test("direct intents keep the fast path without loading or saving memory", async () => {
  let memoryCalls = 0;
  const harness = loadMemoryAwareAskStampyAction({
    loadMemory: async () => {
      memoryCalls += 1;
      return { memories: [], promptText: "", error: null };
    },
    saveMemory: async () => {
      memoryCalls += 1;
      return { extracted: [], savedCount: 0, errors: [] };
    },
  });

  const result = await harness.actions.askStampyAction("Agregame 50g de PLA");

  assert.equal(memoryCalls, 0);
  assert.equal(result.actionIntent.type, "increase_filament_stock");
  assert.equal(result.actionIntent.canExecute, false);
  assert.equal(harness.events.includes("openai"), false);
  assert.deepEqual(harness.assistantMetadata[0].memory, {
    loadedCount: 0,
    savedCount: 0,
  });
});

test("memory prompt is capped at 1200 characters without partial lines", () => {
  const memories = Array.from({ length: 10 }, (_, index) =>
    makeMemory({
      id: `long-${index}`,
      memory_key: `detail_${index}`,
      memory_value: "x".repeat(250),
    })
  );
  const prompt = userMemory.formatRelevantMemoryForPrompt(memories);

  assert.ok(prompt.length <= 1200);
  assert.equal(prompt.endsWith("."), true);
});

test("ranking returns at most ten relevant memories and prompt formatting is explicit", () => {
  const memories = Array.from({ length: 12 }, (_, index) =>
    makeMemory({
      id: `printing-${index}`,
      memory_key: `printing_key_${index}`,
      memory_value: `printing value ${index}`,
      updated_at: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    })
  );
  memories.push(
    makeMemory({
      id: "business-1",
      category: "business",
      memory_key: "product",
      memory_value: "mates",
    })
  );

  const ranked = userMemory.rankRelevantMemory({
    message: "¿Cómo mejoro esta impresión en PLA?",
    memories,
    maxResults: 50,
  });

  assert.equal(ranked.length, 10);
  assert.equal(ranked.some((memory) => memory.category === "business"), false);

  const prompt = userMemory.formatRelevantMemoryForPrompt([
    makeMemory({
      id: "software-1",
      category: "software",
      memory_key: "preferred_slicer",
      memory_value: "Orca",
    }),
    makeMemory(),
    makeMemory({
      id: "hardware-1",
      category: "hardware",
      memory_key: "nozzle_diameter",
      memory_value: "0.6 mm",
    }),
  ]);
  assert.equal(
    prompt,
    "MEMORIAS ÚTILES DEL USUARIO:\n- Usa Orca.\n- Prefiere PLA.\n- Tiene nozzle 0.6 mm."
  );
});

test("the migration enforces atomic duplicate handling without changing stored facts", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260826182313_stampy_user_memory.sql"),
    "utf8"
  );

  assert.match(sql, /unique \(user_id, category, memory_key, memory_value\)/i);
  assert.match(
    sql,
    /on conflict \(user_id, category, memory_key, memory_value\)\s+do update set updated_at = now\(\)/i
  );
  assert.doesNotMatch(sql, /do update set[^;]*(memory_value|confidence|source_message_id)\s*=/i);
});
