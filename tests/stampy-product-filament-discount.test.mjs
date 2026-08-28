import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const ACTION_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

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

const toolRegistry = loadTypeScriptModule("src/lib/stampy/tool-registry.ts");
const actionIntents = loadTypeScriptModule("src/lib/stampy/action-intents.ts", {
  "./tool-registry": toolRegistry,
  "./types": {},
});
const actionValidator = loadTypeScriptModule(
  "src/lib/stampy/action-validator.ts",
  { "./tool-registry": toolRegistry, "./types": {} }
);
const executor = loadTypeScriptModule("src/lib/stampy/action-executor.ts");
const messagePolicy = loadTypeScriptModule("src/lib/stampy/message-policy.ts");
const actionSettings = loadTypeScriptModule(
  "src/lib/stampy/action-settings.ts",
  { "./types": {} }
);

function detectAndValidate(message) {
  const actionIntent = actionIntents.detectStampyActionIntent({ message });
  assert.ok(actionIntent, message);
  const toolContract =
    toolRegistry.getStampyToolContractsForIntent(actionIntent.type)[0] ?? null;
  return {
    actionIntent,
    validation: actionValidator.validateStampyActionIntent({
      actionIntent,
      toolContract,
    }),
  };
}

test("product recipe discount parses one product and an explicit quantity", () => {
  const { actionIntent, validation } = detectAndValidate(
    "Descontame los filamentos de 2 Jarros Argentina"
  );
  assert.equal(actionIntent.type, "discount_product_filaments");
  assert.deepEqual(actionIntent.extracted.items, [
    { productName: "Jarros Argentina", quantity: 2 },
  ]);
  assert.equal(validation.isValid, true);
  assert.equal(actionIntent.canExecute, false);
});

test("product recipe discount parses multiple products", () => {
  const { actionIntent } = detectAndValidate(
    "Descontame los filamentos de 2 Jarros Argentina y 3 Maceta Geométrica"
  );
  assert.deepEqual(actionIntent.extracted.items, [
    { productName: "Jarros Argentina", quantity: 2 },
    { productName: "Maceta Geométrica", quantity: 3 },
  ]);
});

test("a single clear product defaults to one unit", () => {
  const { actionIntent } = detectAndValidate(
    "Descontame la receta de Jarro Argentina"
  );
  assert.deepEqual(actionIntent.extracted.items, [
    { productName: "Jarro Argentina", quantity: 1 },
  ]);
});

test("supported used and consumed phrasings stay in the product recipe intent", () => {
  assert.equal(
    actionIntents.detectStampyActionIntent({
      message: "Descontá el material de 2 Jarros Argentina",
    }).type,
    "discount_product_filaments"
  );
  assert.equal(
    actionIntents.detectStampyActionIntent({
      message: "Usé 3 Macetas Geométricas, descontame los filamentos",
    }).type,
    "discount_product_filaments"
  );
  assert.equal(
    actionIntents.detectStampyActionIntent({
      message: "Consumí 2 unidades de Jarro Argentina",
    }).type,
    "discount_product_filaments"
  );
  assert.equal(
    actionIntents.detectStampyActionIntent({
      message: "Restá del stock los materiales de 5 Llaveros Boca",
    }).type,
    "discount_product_filaments"
  );
});

test("a gram-based request remains a direct filament discount", () => {
  const actionIntent = actionIntents.detectStampyActionIntent({
    message: "Descontame 50g de PLA azul",
  });
  assert.equal(actionIntent.type, "discount_filament");
});

test("invalid product quantities and item limits fail validation", () => {
  for (const raw of ["0", "-1", "1,5", "51"]) {
    const { validation } = detectAndValidate(
      `Descontame la receta de ${raw} Jarros Argentina`
    );
    assert.equal(validation.isValid, false, raw);
    assert.match(validation.invalidFields.join(" "), /quantity/i);
  }

  const many = Array.from({ length: 11 }, (_, index) => `1 Producto ${index + 1}`).join(
    " y "
  );
  const { validation } = detectAndValidate(`Descontame los materiales de ${many}`);
  assert.equal(validation.isValid, false);
  assert.ok(validation.invalidFields.includes("items"));
});

function makeReadSupabase(tables, tableErrors = {}) {
  return {
    from(table) {
      const equals = {};
      const includes = {};
      const query = {
        select() { return query; },
        eq(column, value) {
          equals[column] = value;
          return query;
        },
        in(column, values) {
          includes[column] = values;
          return query;
        },
        then(resolve, reject) {
          const error = tableErrors[table]
            ? { message: tableErrors[table] }
            : null;
          const data = error
            ? null
            : (tables[table] ?? []).filter((row) =>
                Object.entries(equals).every(([column, value]) => row[column] === value) &&
                Object.entries(includes).every(([column, values]) =>
                  values.includes(row[column])
                )
              );
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function baseTables() {
  return {
    products: [
      {
        id: "product-1",
        user_id: "user-1",
        name: "Jarro Argentina",
        stock_quantity: 8,
        sale_price: 3500,
        image_url: null,
        is_active: true,
      },
      {
        id: "product-2",
        user_id: "user-1",
        name: "Maceta Geométrica",
        stock_quantity: 4,
        sale_price: 4500,
        image_url: null,
        is_active: true,
      },
    ],
    product_components: [
      {
        id: "component-1",
        product_id: "product-1",
        name: "Producto completo",
        quantity_per_product: 1,
        is_active: true,
      },
      {
        id: "component-2",
        product_id: "product-2",
        name: "Cuerpo",
        quantity_per_product: 1,
        is_active: true,
      },
    ],
    product_component_filaments: [
      {
        id: "recipe-1",
        component_id: "component-1",
        filament_id: "filament-1",
        grams: 50,
        filament_type: "PLA",
        brand: "Hellbot",
        name: null,
        color: "azul",
      },
      {
        id: "recipe-2",
        component_id: "component-1",
        filament_id: "filament-2",
        grams: 17,
        filament_type: "PLA",
        brand: "Elegoo",
        name: null,
        color: "rojo",
      },
      {
        id: "recipe-3",
        component_id: "component-2",
        filament_id: "filament-1",
        grams: 30,
        filament_type: "PLA",
        brand: "Hellbot",
        name: null,
        color: "azul",
      },
    ],
    filaments: [
      {
        id: "filament-1",
        user_id: "user-1",
        name: null,
        filament_type: "PLA",
        brand: "Hellbot",
        color: "azul",
        remaining_grams: 850,
        total_grams: 1000,
        is_active: true,
        filament_templates: null,
      },
      {
        id: "filament-2",
        user_id: "user-1",
        name: null,
        filament_type: "PLA",
        brand: "Elegoo",
        color: "rojo",
        remaining_grams: 500,
        total_grams: 1000,
        is_active: true,
        filament_templates: null,
      },
    ],
  };
}

test("preparation blocks a product without an active recipe", async () => {
  const tables = baseTables();
  tables.product_components = tables.product_components.filter(
    (component) => component.product_id !== "product-1"
  );
  const result = await executor.prepareProductFilamentDiscount({
    supabase: makeReadSupabase(tables),
    userId: "user-1",
    items: [{ productName: "Jarro Argentina", quantity: 2 }],
  });
  assert.equal(result.blockers[0].code, "recipe_missing");
});

test("preparation blocks textual recipe snapshots without filament_id", async () => {
  const tables = baseTables();
  tables.product_component_filaments[0].filament_id = null;
  const result = await executor.prepareProductFilamentDiscount({
    supabase: makeReadSupabase(tables),
    userId: "user-1",
    items: [{ productName: "Jarro Argentina", quantity: 2 }],
  });
  const blocker = result.blockers.find((item) => item.code === "filament_unresolved");
  assert.ok(blocker);
  assert.match(blocker.message, /50g PLA Hellbot azul/i);
});

test("preparation blocks insufficient stock", async () => {
  const tables = baseTables();
  tables.filaments[0].remaining_grams = 80;
  const result = await executor.prepareProductFilamentDiscount({
    supabase: makeReadSupabase(tables),
    userId: "user-1",
    items: [{ productName: "Jarro Argentina", quantity: 2 }],
  });
  const blocker = result.blockers.find((item) => item.code === "insufficient_stock");
  assert.ok(blocker);
  assert.match(blocker.message, /necesitás 100g y te quedan 80g/i);
});

test("preparation aggregates repeated filament ids across products", async () => {
  const result = await executor.prepareProductFilamentDiscount({
    supabase: makeReadSupabase(baseTables()),
    userId: "user-1",
    items: [
      { productName: "Jarros Argentina", quantity: 2 },
      { productName: "Macetas Geométricas", quantity: 3 },
    ],
  });
  assert.deepEqual(result.blockers, []);
  assert.equal(result.products.length, 2);
  assert.deepEqual(
    result.consumptions.map((item) => [item.filamentId, item.requiredGrams]),
    [
      ["filament-1", 190],
      ["filament-2", 34],
    ]
  );
});

test("preparation respects component quantity_per_product", async () => {
  const tables = baseTables();
  tables.product_components[1].quantity_per_product = 2;
  const result = await executor.prepareProductFilamentDiscount({
    supabase: makeReadSupabase(tables),
    userId: "user-1",
    items: [{ productName: "Maceta Geométrica", quantity: 3 }],
  });
  assert.deepEqual(result.blockers, []);
  assert.equal(result.consumptions[0].requiredGrams, 180);
});

function loadAskHarness() {
  const actionRequests = [];
  const supabase = {
    from() {
      return {
        update() { return this; },
        eq() { return this; },
      };
    },
  };
  const preparation = {
    products: [
      {
        productId: "product-1",
        productName: "Jarro Argentina",
        quantity: 2,
        componentsCount: 1,
      },
    ],
    consumptions: [
      {
        filamentId: "filament-1",
        label: "PLA · Hellbot · azul",
        requiredGrams: 100,
        remainingGrams: 850,
        afterRemainingGrams: 750,
      },
    ],
    blockers: [],
    warnings: ["No baja el stock de productos terminados todavía."],
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
    "@/lib/stampy/rate-limit": {
      checkStampyRateLimit: async () => ({ isBlocked: false }),
    },
    "@/lib/stampy/history": {
      ensureConversation: async () => "conversation-1",
      getRecentHistory: async () => [],
      saveMessages: async () => ({
        userMessageId: "user-message-1",
        assistantMessageId: "assistant-message-1",
      }),
    },
    "@/lib/stampy/action-intents": actionIntents,
    "@/lib/stampy/action-validator": actionValidator,
    "@/lib/stampy/tool-registry": toolRegistry,
    "@/lib/stampy/action-requests": {
      createStampyActionRequest: async (params) => {
        actionRequests.push(params);
        return { actionRequestId: "action-request-1", error: null };
      },
    },
    "@/lib/stampy/action-executor": {
      prepareProductFilamentDiscount: async () => preparation,
    },
    "@/lib/stampy/usage-log": { logStampyUsage: async () => undefined },
  });
  return { actions, actionRequests };
}

test("askStampyAction stores the fully prepared non-executable action request", async () => {
  const harness = loadAskHarness();
  const result = await harness.actions.askStampyAction(
    "Descontame los filamentos de 2 Jarros Argentina"
  );
  assert.equal(result.actionIntent.type, "discount_product_filaments");
  assert.equal(result.actionIntent.canExecute, false);
  assert.equal(result.actionIntent.extracted.requiresConfirmation, true);
  assert.equal(result.actionIntent.extracted.resolvedProducts.length, 1);
  assert.equal(result.actionIntent.extracted.consumptions[0].requiredGrams, 100);
  assert.deepEqual(result.actionIntent.extracted.autoExecution, {
    attempted: true,
    allowed: false,
    reason: "unsupported_action",
  });
  assert.equal(harness.actionRequests.length, 1);
  assert.equal(
    harness.actionRequests[0].actionIntent.extracted.actionType,
    "discount_product_filaments"
  );
  assert.match(result.answer, /Preparé el descuento de materiales/i);
  assert.match(result.answer, /Confirmá si está bien/i);
});

function createAtomicRpc() {
  const state = { requestStatus: "suggested", calls: 0, productStock: 8 };
  const supabase = {
    async rpc(name, params) {
      assert.equal(name, "confirm_stampy_discount_product_filaments");
      assert.deepEqual(params, { p_action_request_id: ACTION_REQUEST_ID });
      if (state.requestStatus === "executed") {
        return {
          data: [{
            success: false,
            action_request_id: ACTION_REQUEST_ID,
            products_count: 0,
            filaments_count: 0,
            total_grams: 0,
            error_code: "already_executed",
            message: "Este descuento ya fue confirmado anteriormente.",
          }],
          error: null,
        };
      }
      state.calls += 1;
      state.requestStatus = "executed";
      return {
        data: [{
          success: true,
          action_request_id: ACTION_REQUEST_ID,
          products_count: 2,
          filaments_count: 2,
          total_grams: 224,
          error_code: null,
          message: "Listo, desconté los filamentos de 2 productos. Se descontaron 224g en total.",
        }],
        error: null,
      };
    },
  };
  return { state, supabase };
}

test("RPC adapter reports one atomic execution and rejects reconfirmation", async () => {
  const { state, supabase } = createAtomicRpc();
  const first = await executor.executeProductFilamentDiscount({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });
  const second = await executor.executeProductFilamentDiscount({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });
  assert.equal(first.success, true);
  assert.equal(first.totalGrams, 224);
  assert.equal(second.success, false);
  assert.equal(second.errorCode, "already_executed");
  assert.equal(state.calls, 1);
  assert.equal(state.productStock, 8);
});

test("Server Action authenticates and sends only actionRequestId", async () => {
  const calls = [];
  const supabase = {};
  const actionRequests = loadTypeScriptModule(
    "src/lib/stampy/action-requests.ts",
    {
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
      "./action-executor": {
        executeCreateFilament: async () => ({ success: false }),
        executeCreatePrinter: async () => ({ success: false }),
        executeCreateProduct: async () => ({ success: false }),
        executeFilamentStockMovement: async () => ({ success: false }),
        executeProductFilamentDiscount: async (params) => {
          calls.push(params);
          return { success: true, message: "ok" };
        },
      },
      "./types": {},
    }
  );
  const result = await actionRequests.confirmStampyDiscountProductFilamentsAction(
    ACTION_REQUEST_ID
  );
  assert.equal(result.success, true);
  assert.deepEqual(calls, [{ supabase, actionRequestId: ACTION_REQUEST_ID }]);
});

test("product recipe discounts are never eligible for low-risk automation", () => {
  assert.equal(
    actionSettings.canAutoExecuteStampyAction({
      settings: {
        autoExecuteLowRisk: true,
        autoExecuteFilamentMovements: true,
        autoExecuteCreateFilament: true,
        autoExecuteCreatePrinter: true,
      },
      actionType: "discount_product_filaments",
    }),
    false
  );
});

test("migration revalidates recipes, uses stock RPC and never changes product stock", () => {
  const sql = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260827151106_confirm_stampy_discount_product_filaments.sql"
    ),
    "utf8"
  );
  assert.match(sql, /discount_product_filaments/);
  assert.match(sql, /stampy_action_requests[\s\S]*for update/i);
  assert.match(sql, /from public\.products[\s\S]*for update/i);
  assert.match(sql, /from public\.product_components/i);
  assert.match(sql, /product_component_filaments/i);
  assert.match(sql, /from jsonb_each_text\(consumption_totals\)[\s\S]*order by key/i);
  assert.match(sql, /from public\.filaments[\s\S]*for update/i);
  assert.match(sql, /public\.adjust_filament_stock\(/i);
  assert.match(sql, /p_movement_type => 'manual_subtract'/i);
  assert.match(sql, /p_source_type => 'stampy_action_request'/i);
  assert.match(sql, /status = 'executed'/i);
  assert.match(sql, /'already_executed'/i);
  assert.match(sql, /'insufficient_stock'/i);
  assert.doesNotMatch(sql, /update\s+public\.products/i);
  assert.doesNotMatch(sql, /stock_quantity\s*=/i);
  assert.match(sql, /resolvedProducts/);
  assert.match(sql, /consumptions/);
});

test("ActionIntentCard shows safe confirmation, blockers and both fallbacks", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/stampy/ActionIntentCard.tsx"),
    "utf8"
  );
  assert.match(source, /canConfirmProductFilamentDiscount/);
  assert.match(source, /confirmStampyDiscountProductFilamentsAction/);
  assert.match(source, /Confirmar descuento/);
  assert.match(source, /Filamentos a descontar:/);
  assert.match(source, /Abrir Productos/);
  assert.match(source, /Abrir Stock/);
});
