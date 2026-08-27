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
const messagePolicy = loadTypeScriptModule("src/lib/stampy/message-policy.ts");
const actionSettings = loadTypeScriptModule(
  "src/lib/stampy/action-settings.ts",
  { "./types": {} }
);
const executor = loadTypeScriptModule("src/lib/stampy/action-executor.ts");

function detectAndValidate(message) {
  const actionIntent = actionIntents.detectStampyActionIntent({ message });
  assert.ok(actionIntent);
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

test("simple product extracts a name and validates with recipe and stock warnings", () => {
  const { actionIntent, validation } = detectAndValidate(
    "Creame un producto Jarro Argentina"
  );

  assert.equal(actionIntent.type, "create_product");
  assert.equal(actionIntent.extracted.productName, "Jarro Argentina");
  assert.deepEqual(actionIntent.extracted.components, []);
  assert.equal(validation.isValid, true);
  assert.match(validation.warnings.join(" "), /no indicaste receta/i);
  assert.match(validation.warnings.join(" "), /stock inicial/i);
  assert.match(validation.warnings.join(" "), /tiempo de impresión/i);
  assert.match(validation.warnings.join(" "), /costo base/i);
  assert.match(validation.warnings.join(" "), /precio de venta/i);
});

test("product stock is extracted without becoming a recipe amount", () => {
  const { actionIntent, validation } = detectAndValidate(
    "Creame un producto Jarro Argentina con stock 10"
  );

  assert.equal(validation.isValid, true);
  assert.equal(actionIntent.extracted.productName, "Jarro Argentina");
  assert.equal(actionIntent.extracted.initialStock, 10);
  assert.deepEqual(actionIntent.extracted.components, []);
});

test("multi-filament recipes preserve grams, materials, brands and colors", () => {
  const { actionIntent, validation } = detectAndValidate(
    "Creame un producto Jarro Argentina que usa 50g PLA Hellbot azul y 17g PLA Elegoo rojo"
  );

  assert.equal(validation.isValid, true);
  assert.deepEqual(actionIntent.extracted.components, [
    {
      grams: 50,
      material: "PLA",
      brand: "Hellbot",
      name: null,
      color: "azul",
    },
    {
      grams: 17,
      material: "PLA",
      brand: "Elegoo",
      name: null,
      color: "rojo",
    },
  ]);

  const implicit = detectAndValidate(
    "Cargá Maceta Geométrica con 30g PETG negro"
  );
  assert.equal(implicit.actionIntent.type, "create_product");
  assert.equal(implicit.actionIntent.extracted.productName, "Maceta Geométrica");
  assert.equal(implicit.actionIntent.extracted.components[0].grams, 30);

  const stockAndRecipe = detectAndValidate(
    "Creá Llavero Boca con stock 20 y receta 12g PLA azul, 8g PLA amarillo"
  );
  assert.equal(stockAndRecipe.actionIntent.extracted.productName, "Llavero Boca");
  assert.equal(stockAndRecipe.actionIntent.extracted.initialStock, 20);
  assert.deepEqual(
    stockAndRecipe.actionIntent.extracted.components.map((component) => [
      component.grams,
      component.color,
    ]),
    [[12, "azul"], [8, "amarillo"]]
  );

  const priced = detectAndValidate(
    "Creame un producto Soporte Celular con precio 1500"
  );
  assert.equal(priced.actionIntent.extracted.productName, "Soporte Celular");
  assert.equal(priced.actionIntent.extracted.salePrice, 1500);
  assert.equal(priced.actionIntent.extracted.price, undefined);
});

test("product time supports hours, mixed duration, half hours and minutes", () => {
  assert.equal(
    detectAndValidate("Creame un producto Jarro Argentina que tarda 4 horas")
      .actionIntent.extracted.printTimeMinutes,
    240
  );
  assert.equal(
    detectAndValidate("Creame Maceta que demora 3h 30m").actionIntent.extracted
      .printTimeMinutes,
    210
  );
  assert.equal(
    detectAndValidate("Creame Llavero que tarda 45 minutos").actionIntent
      .extracted.printTimeMinutes,
    45
  );
  assert.equal(
    detectAndValidate("Creame Mate que tarda 3 horas y media").actionIntent
      .extracted.printTimeMinutes,
    210
  );
  assert.equal(
    detectAndValidate("Creame Soporte que demora 2 horas 15 minutos")
      .actionIntent.extracted.printTimeMinutes,
    135
  );
});

test("product costs and sale prices are extracted without a generic price field", () => {
  const first = detectAndValidate(
    "Creame Jarro con costo de $1200 y precio de venta $3500"
  );
  assert.equal(first.actionIntent.extracted.productName, "Jarro");
  assert.equal(first.actionIntent.extracted.baseCost, 1200);
  assert.equal(first.actionIntent.extracted.salePrice, 3500);
  assert.equal(first.actionIntent.extracted.price, undefined);

  const second = detectAndValidate(
    "Creame Maceta, costo base 1800 y lo vendo a 4500"
  );
  assert.equal(second.actionIntent.extracted.productName, "Maceta");
  assert.equal(second.actionIntent.extracted.baseCost, 1800);
  assert.equal(second.actionIntent.extracted.salePrice, 4500);
});

test("localized money forms normalize deterministically", () => {
  const cases = [
    ["$1200", 1200],
    ["1200", 1200],
    ["1.200", 1200],
    ["1,200", 1200],
    ["1200,50", 1200.5],
    ["1200.50", 1200.5],
  ];
  for (const [raw, expected] of cases) {
    const { actionIntent } = detectAndValidate(
      `Creame Pieza con costo ${raw} y precio de venta ${raw}`
    );
    assert.equal(actionIntent.extracted.baseCost, expected);
    assert.equal(actionIntent.extracted.salePrice, expected);
  }
});

test("complete product keeps stock, economics, time and multifilament recipe", () => {
  const { actionIntent, validation } = detectAndValidate(
    "Creame un producto Jarro Argentina con stock 5, tarda 4 horas, costo $1200, precio de venta $3500 y usa 50g PLA Hellbot azul y 17g PLA Elegoo rojo"
  );

  assert.equal(validation.isValid, true);
  assert.equal(actionIntent.extracted.productName, "Jarro Argentina");
  assert.equal(actionIntent.extracted.initialStock, 5);
  assert.equal(actionIntent.extracted.printTimeMinutes, 240);
  assert.equal(actionIntent.extracted.baseCost, 1200);
  assert.equal(actionIntent.extracted.salePrice, 3500);
  assert.equal(actionIntent.extracted.components.length, 2);
});

test("stock variants apply only inside create_product", () => {
  assert.equal(
    detectAndValidate("Creame un producto Mate, cantidad 10 unidades").actionIntent
      .extracted.initialStock,
    10
  );
  assert.equal(
    detectAndValidate("Creame un producto Mate y cargá 12 unidades").actionIntent
      .extracted.initialStock,
    12
  );
  assert.notEqual(
    actionIntents.detectStampyActionIntent({
      message: "Haceme un presupuesto para Lucas de 10 mates",
    })?.type,
    "create_product"
  );
});

test("invalid product economics and time are blocked", () => {
  for (const message of [
    "Creame Pieza A con stock -1",
    "Creame Pieza A que tarda -2 horas",
    "Creame Pieza A con costo -1200",
    "Creame Pieza A con precio de venta -3500",
  ]) {
    const { validation } = detectAndValidate(message);
    assert.equal(validation.isValid, false, message);
    assert.ok(validation.invalidFields.length > 0, message);
  }
});

test("calculator sale-price request is not classified as product creation", () => {
  assert.notEqual(
    actionIntents.detectStampyActionIntent({
      message: "Calculame precio de venta para 50g",
    })?.type,
    "create_product"
  );
});

function makeReadSupabase(tables) {
  return {
    from(table) {
      const filters = {};
      return {
        select() { return this; },
        eq(column, value) {
          filters[column] = value;
          return this;
        },
        then(resolve, reject) {
          const rows = (tables[table] ?? []).filter((row) =>
            Object.entries(filters).every(([column, value]) => row[column] === value)
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
    },
  };
}

test("component matching resolves only unique active owned filaments", async () => {
  const supabase = makeReadSupabase({
    filaments: [
      {
        id: "filament-1",
        user_id: "user-1",
        name: null,
        filament_type: "PLA",
        brand: "Hellbot",
        color: "Azul",
        remaining_grams: 900,
        total_grams: 1000,
        is_active: true,
        filament_templates: null,
      },
    ],
  });
  const result = await executor.resolveProductFilamentComponents({
    supabase,
    userId: "user-1",
    components: [
      { grams: 50, material: "PLA", brand: "Hellbot", color: "azul" },
      { grams: 17, material: "PLA", brand: "Elegoo", color: "rojo" },
    ],
  });

  assert.equal(result.components[0].filamentId, "filament-1");
  assert.equal(result.components[0].matchStatus, "unique");
  assert.equal(result.components[1].filamentId, null);
  assert.equal(result.components[1].matchStatus, "none");
  assert.equal(result.unmatchedCount, 1);
});

test("product duplicate matching is scoped to active products owned by the user", async () => {
  const supabase = makeReadSupabase({
    products: [
      {
        id: "product-1",
        user_id: "user-1",
        name: "Jarro Argentina",
        stock_quantity: 2,
        sale_price: 0,
        image_url: null,
        is_active: true,
      },
      {
        id: "product-other",
        user_id: "user-2",
        name: "Jarro Argentina",
        stock_quantity: 2,
        sale_price: 0,
        image_url: null,
        is_active: true,
      },
    ],
  });
  const result = await executor.findDuplicateProduct({
    supabase,
    userId: "user-1",
    productName: "jarro argentina",
  });

  assert.equal(result.status, "duplicate");
  assert.equal(result.product.id, "product-1");
});

function loadAskHarness({
  duplicateProduct = { status: "clear" },
  componentResolution,
} = {}) {
  const actionRequests = [];
  const executions = [];
  const supabase = {
    from() {
      return {
        update() { return this; },
        eq() { return this; },
      };
    },
  };
  const defaultComponentResolution = {
    components: [
      {
        grams: 50,
        material: "PLA",
        brand: "Hellbot",
        name: null,
        color: "azul",
        filamentId: "filament-1",
        filamentLabel: "PLA · Hellbot · azul",
        matchStatus: "unique",
      },
    ],
    unmatchedCount: 0,
    errors: [],
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
    "@/lib/stampy/action-settings": {
      getStampyActionSettings: async () => ({
        settings: {
          autoExecuteLowRisk: true,
          autoExecuteFilamentMovements: true,
          autoExecuteCreateFilament: true,
          autoExecuteCreatePrinter: true,
        },
        error: null,
      }),
      canAutoExecuteStampyAction: actionSettings.canAutoExecuteStampyAction,
    },
    "@/lib/stampy/action-requests": {
      createStampyActionRequest: async (params) => {
        actionRequests.push(params);
        return { actionRequestId: "action-request-1", error: null };
      },
    },
    "@/lib/stampy/action-executor": {
      findDuplicateProduct: async () => duplicateProduct,
      resolveProductFilamentComponents: async () =>
        componentResolution ?? defaultComponentResolution,
      resolveFilamentMatch: async () => ({ status: "none", matches: [] }),
      findDuplicateActiveFilament: async () => ({ status: "clear" }),
      findDuplicatePrinter: async () => ({ status: "clear" }),
      getResolvedFilamentLabel: () => "PLA",
      executeFilamentStockMovement: async () => {
        executions.push("movement");
        return { success: false };
      },
      executeCreateFilament: async () => {
        executions.push("filament");
        return { success: false };
      },
      executeCreatePrinter: async () => {
        executions.push("printer");
        return { success: false };
      },
      executeCreateProduct: async () => {
        executions.push("product");
        return { success: false };
      },
    },
    "@/lib/stampy/usage-log": { logStampyUsage: async () => undefined },
  });

  return { actions, actionRequests, executions };
}

test("a similar active product disables confirmation", async () => {
  const harness = loadAskHarness({
    duplicateProduct: {
      status: "duplicate",
      product: { id: "product-1", name: "Jarro Argentina" },
    },
  });
  const result = await harness.actions.askStampyAction(
    "Creame un producto Jarro Argentina"
  );

  assert.equal(result.actionIntent.extracted.requiresConfirmation, false);
  assert.equal(result.actionIntent.extracted.duplicateStatus, "duplicate");
  assert.match(result.answer, /producto parecido/i);
  assert.match(result.knowledgeTools[0].route, /^\/productos/);
});

test("create_product always requires confirmation and never enters low-risk automation", async () => {
  const harness = loadAskHarness();
  const result = await harness.actions.askStampyAction(
    "Creame un producto Jarro Argentina que usa 50g PLA Hellbot azul"
  );

  assert.equal(result.actionIntent.extracted.requiresConfirmation, true);
  assert.equal(result.actionIntent.canExecute, false);
  assert.deepEqual(result.actionIntent.extracted.autoExecution, {
    attempted: true,
    allowed: false,
    reason: "unsupported_action",
  });
  assert.equal(harness.executions.length, 0);
  assert.match(result.answer, /necesito que confirmes/i);
  assert.equal(harness.actionRequests.length, 1);
  assert.equal(
    actionSettings.canAutoExecuteStampyAction({
      settings: {
        autoExecuteLowRisk: true,
        autoExecuteFilamentMovements: true,
        autoExecuteCreateFilament: true,
        autoExecuteCreatePrinter: true,
      },
      actionType: "create_product",
    }),
    false
  );
});

test("unmatched recipe items remain confirmable with textual data and a warning", async () => {
  const unresolved = {
    grams: 17,
    material: "PLA",
    brand: "Elegoo",
    name: null,
    color: "rojo",
    filamentId: null,
    filamentLabel: null,
    matchStatus: "none",
  };
  const harness = loadAskHarness({
    componentResolution: {
      components: [unresolved],
      unmatchedCount: 1,
      errors: [],
    },
  });
  const result = await harness.actions.askStampyAction(
    "Creame un producto Jarro Argentina que usa 17g PLA Elegoo rojo"
  );

  assert.equal(result.actionIntent.extracted.requiresConfirmation, true);
  assert.equal(result.actionIntent.extracted.components[0].filamentId, null);
  assert.match(result.validation.warnings.join(" "), /sin filamento exacto/i);
});

test("filament and printer creation intents remain distinct from products", () => {
  assert.equal(
    actionIntents.detectStampyActionIntent({
      message: "Creame un filamento nuevo PETG rojo",
    }).type,
    "add_filament"
  );
  assert.equal(
    actionIntents.detectStampyActionIntent({
      message: "Creame una impresora Bambu A1 Mini",
    }).type,
    "add_printer"
  );
  assert.notEqual(
    actionIntents.detectStampyActionIntent({
      message: "Descontame stock del producto Jarro Argentina",
    })?.type,
    "create_product"
  );
});

function createAtomicProductRpc({ unmatched = false } = {}) {
  const state = {
    requestStatus: "suggested",
    products: [],
    components: [],
  };
  const supabase = {
    async rpc(name, params) {
      assert.equal(name, "confirm_stampy_create_product");
      assert.deepEqual(params, { p_action_request_id: ACTION_REQUEST_ID });
      if (state.requestStatus === "executed") {
        return {
          data: [{
            success: false,
            action_request_id: ACTION_REQUEST_ID,
            product_id: null,
            product_name: "Jarro Argentina",
            components_count: 0,
            unmatched_components_count: 0,
            error_code: "already_executed",
            message: "Este producto ya fue creado anteriormente.",
          }],
          error: null,
        };
      }

      state.products.push({
        id: "product-1",
        name: "Jarro Argentina",
        print_time_minutes: 240,
        base_cost: 1200,
        sale_price: 3500,
        stock_quantity: 5,
        grams: 50,
      });
      state.components.push({
        grams: 50,
        filament_id: unmatched ? null : "filament-1",
        filament_type: "PLA",
        brand: "Hellbot",
        color: "azul",
      });
      state.requestStatus = "executed";
      return {
        data: [{
          success: true,
          action_request_id: ACTION_REQUEST_ID,
          product_id: "product-1",
          product_name: "Jarro Argentina",
          components_count: 1,
          unmatched_components_count: unmatched ? 1 : 0,
          error_code: null,
          message: "Listo, creé el producto Jarro Argentina. También guardé 1 componente de filamento.",
        }],
        error: null,
      };
    },
  };
  return { state, supabase };
}

test("valid confirmation creates product and recipe once", async () => {
  const { state, supabase } = createAtomicProductRpc();
  const first = await executor.executeCreateProduct({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });
  const second = await executor.executeCreateProduct({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });

  assert.equal(first.success, true);
  assert.equal(first.productName, "Jarro Argentina");
  assert.equal(first.componentsCount, 1);
  assert.equal(second.success, false);
  assert.equal(second.errorCode, "already_executed");
  assert.equal(state.products.length, 1);
  assert.deepEqual(state.products[0], {
    id: "product-1",
    name: "Jarro Argentina",
    print_time_minutes: 240,
    base_cost: 1200,
    sale_price: 3500,
    stock_quantity: 5,
    grams: 50,
  });
  assert.equal(state.components.length, 1);
  assert.equal(state.requestStatus, "executed");
});

test("unmatched components retain textual snapshots and report their count", async () => {
  const { state, supabase } = createAtomicProductRpc({ unmatched: true });
  const result = await executor.executeCreateProduct({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });

  assert.equal(result.success, true);
  assert.equal(result.unmatchedComponentsCount, 1);
  assert.equal(state.components[0].filament_id, null);
  assert.equal(state.components[0].filament_type, "PLA");
  assert.equal(state.components[0].brand, "Hellbot");
});

test("product Server Action authenticates and sends only actionRequestId", async () => {
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
        executeFilamentStockMovement: async () => ({ success: false }),
        executeCreateFilament: async () => ({ success: false }),
        executeCreatePrinter: async () => ({ success: false }),
        executeCreateProduct: async (params) => {
          calls.push(params);
          return { success: true, message: "ok" };
        },
      },
      "./types": {},
    }
  );

  const result = await actionRequests.confirmStampyCreateProductAction(
    ACTION_REQUEST_ID
  );
  assert.equal(result.success, true);
  assert.deepEqual(calls, [{ supabase, actionRequestId: ACTION_REQUEST_ID }]);
});

test("migration reuses the real recipe model and keeps creation transactional", () => {
  const sql = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260827023352_confirm_stampy_create_product.sql"
    ),
    "utf8"
  );

  assert.doesNotMatch(sql, /create table[^;]*product_filament_components/i);
  assert.match(sql, /alter table public\.product_component_filaments/i);
  assert.match(sql, /alter column filament_id drop not null/i);
  assert.match(sql, /check \(grams > 0\) not valid/i);
  assert.match(sql, /product_components enable row level security/i);
  assert.match(sql, /product_component_filaments enable row level security/i);
  assert.match(sql, /product\.user_id = auth\.uid\(\)/i);
  assert.match(sql, /component\.user_id = auth\.uid\(\)/i);
  assert.match(sql, /filament\.user_id = auth\.uid\(\)/i);
  assert.match(sql, /public\.is_admin\(auth\.uid\(\)\)/i);
  assert.match(sql, /revoke all on table public\.product_components from public, anon/i);
  assert.match(sql, /confirm_stampy_create_product\(\s*p_action_request_id uuid/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /stampy_action_requests[\s\S]*for update/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /insert into public\.products/i);
  assert.match(sql, /insert into public\.product_components/i);
  assert.match(sql, /insert into public\.product_component_filaments/i);
  assert.ok(
    sql.indexOf("insert into public.products") <
      sql.indexOf("set\n    status = 'executed'")
  );
  assert.match(sql, /updated_requests <> 1[\s\S]*raise exception/i);
  assert.match(sql, /'already_executed'/i);
  assert.match(sql, /'duplicate_product'/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*service_role/i);
});

test("economics patch maps extracted fields to the existing product columns", () => {
  const sql = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260827033559_patch_stampy_create_product_economics.sql"
    ),
    "utf8"
  );

  assert.match(sql, /create or replace function public\.confirm_stampy_create_product/i);
  assert.equal(
    (sql.match(/as \$stampy_create_product_economics\$/g) ?? []).length,
    1
  );
  assert.equal(
    (sql.match(/^\$stampy_create_product_economics\$;$/gm) ?? []).length,
    1
  );
  assert.doesNotMatch(sql, /as \$\$/i);
  assert.doesNotMatch(sql, /^\$\$;$/m);
  assert.doesNotMatch(sql, /^\s*begin;\s*$/im);
  assert.doesNotMatch(sql, /^\s*commit;\s*$/im);
  assert.match(sql, /extracted ->> 'printTimeMinutes'/i);
  assert.match(sql, /extracted ->> 'baseCost'/i);
  assert.match(sql, /extracted ->> 'salePrice'/i);
  assert.match(
    sql,
    /coalesce\([\s\S]*extracted ->> 'salePrice'[\s\S]*extracted ->> 'price'/i
  );
  assert.doesNotMatch(
    sql,
    /base_cost_text\s*:=\s*[^;]*extracted ->> 'price'/i
  );
  assert.match(
    sql,
    /print_time_minutes, base_cost, sale_price, stock_quantity[\s\S]*print_time_value, base_cost_value, sale_price_value,[\s\S]*initial_stock_value/i
  );
  assert.match(sql, /total_recipe_grams/i);
  assert.match(sql, /Guardé[\s\S]*stock inicial[\s\S]*tiempo[\s\S]*costo[\s\S]*venta/i);
  assert.match(sql, /stampy_action_requests[\s\S]*for update/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /updated_requests <> 1[\s\S]*raise exception/i);
  assert.doesNotMatch(sql, /alter table|add column|create table/i);
});

test("ActionIntentCard exposes product confirmation and recipe summary", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/stampy/ActionIntentCard.tsx"),
    "utf8"
  );

  assert.match(source, /confirmStampyCreateProductAction\(actionRequestId\)/);
  assert.match(source, /canConfirmProductCreation/);
  assert.match(source, /Receta:/);
  assert.match(source, /Stock inicial:/);
  assert.match(source, /Tiempo de impresión:/);
  assert.match(source, /Costo base:/);
  assert.match(source, /Precio de venta:/);
  assert.match(source, /Intl\.NumberFormat\("es-AR"/);
  assert.match(source, /Confirmar creación/);
});
