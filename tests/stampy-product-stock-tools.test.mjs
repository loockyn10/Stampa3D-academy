import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(filename, dependencies = {}) {
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
    (request) => {
      if (request in dependencies) return dependencies[request];
      throw new Error(`Unexpected dependency: ${request}`);
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const intents = loadTypeScriptModule(
  path.join(root, "src/lib/stampy/product-stock-tool-intents.ts"),
);
const pricingStatus = loadTypeScriptModule(
  path.join(root, "src/lib/products/pricing-status.ts"),
);
const registry = loadTypeScriptModule(
  path.join(root, "src/lib/stampy/tool-registry.ts"),
);
const tools = loadTypeScriptModule(
  path.join(root, "src/lib/stampy/product-stock-tools.ts"),
  {
    "@/lib/products/pricing-status": pricingStatus,
    "./tool-registry": registry,
  },
);

const selectedContext = {
  page: { section: "products", route: "/productos", title: "Productos" },
  selectedEntity: { type: "product", id: "product-a", name: "Jarro Argentina" },
  visibleEntities: [
    { type: "product", id: "product-a", name: "Jarro Argentina", position: 1, facts: [{ label: "Precio", value: 150 }] },
    { type: "product", id: "product-b", name: "Mate", position: 2, facts: [{ label: "Precio", value: 300 }] },
  ],
};

test("selectedEntity resolves product reads, recalculation and capacity without asking again", () => {
  assert.deepEqual(
    intents.detectStampyProductStockToolIntent({ message: "¿Cuánto gano con este?", screenContext: selectedContext }),
    { toolName: "products.inspect", productId: "product-a", productName: "Jarro Argentina", aspect: "profit", clarification: undefined },
  );
  assert.equal(
    intents.detectStampyProductStockToolIntent({ message: "Recalculalo", screenContext: selectedContext }).productId,
    "product-a",
  );
  const capacity = intents.detectStampyProductStockToolIntent({ message: "¿Me alcanza para fabricar 10 de este?", screenContext: selectedContext });
  assert.equal(capacity.productId, "product-a");
  assert.equal(capacity.quantity, 10);
});

test("visibleEntities identifies ordinals and refuses ambiguous references", () => {
  const second = intents.detectStampyProductStockToolIntent({ message: "¿Cuánto gano con el segundo?", screenContext: selectedContext });
  assert.equal(second.productId, "product-b");
  const ambiguous = intents.detectStampyProductStockToolIntent({
    message: "¿Cuánto gano con este?",
    screenContext: { ...selectedContext, selectedEntity: null },
  });
  assert.equal(ambiguous.productId, undefined);
  assert.match(ambiguous.clarification, /qué producto/i);
});

test("unsafe batch and finished-stock requests are blocked by specific intents", () => {
  assert.equal(
    intents.detectStampyProductStockToolIntent({ message: "Recalculá todos", screenContext: selectedContext }).toolName,
    "products.batch_recalculate_blocked",
  );
  assert.equal(
    intents.detectStampyProductStockToolIntent({ message: "Registrá 5 y agregalos al stock", screenContext: selectedContext }).toolName,
    "products.production_with_stock_blocked",
  );
});

test("selected product is bound to the existing safe consumption preview", () => {
  assert.equal(
    intents.bindSelectedProductToConsumptionMessage("Descontá lo necesario para fabricar 4", selectedContext),
    "Descontá los filamentos de 4 Jarro Argentina",
  );
});

class Query {
  constructor(rows) {
    this.rows = rows;
    this.filters = [];
  }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
  order() { return this; }
  filtered() { return this.rows.filter((row) => this.filters.every((filter) => filter(row))); }
  maybeSingle() { return Promise.resolve({ data: this.filtered()[0] ?? null, error: null }); }
  then(resolve, reject) { return Promise.resolve({ data: this.filtered(), error: null }).then(resolve, reject); }
}

function createSupabase() {
  const rows = {
    products: [{
      id: "product-a", user_id: "user-a", name: "Jarro Argentina", description: null,
      stock_quantity: 2, base_cost: 100, sale_price: 150, filament_id: "filament-a", grams: 999,
      printer_id: null, product_type_id: null, print_time_minutes: 60,
      calculation_snapshot: {}, cost_updated_at: null, is_active: true,
    }],
    product_components: [{ id: "component-a", product_id: "product-a", user_id: "user-a", name: "Cuerpo", quantity_per_product: 1, sort_order: 0, stock_quantity: 0, is_active: true }],
    product_component_filaments: [{ id: "recipe-a", user_id: "user-a", component_id: "component-a", filament_id: "filament-a", grams: 100, filament_type: "PLA", brand: "W3D", name: null, color: "blanco", sort_order: 0 }],
    filaments: [{ id: "filament-a", user_id: "user-a", name: null, filament_type: "PLA", brand: "W3D", color: "blanco", remaining_grams: 500, total_grams: 1000, purchase_price: 10000, is_active: true }],
    printers: [],
    calculator_product_types: [],
  };
  return { from(table) { return new Query(rows[table] ?? []); } };
}

test("capacity uses component recipes once and current server stock", async () => {
  const result = await tools.executeStampyProductStockTool({
    supabase: createSupabase(),
    userId: "user-a",
    intent: { toolName: "products.production_capacity", productId: "product-a", quantity: 6 },
  });
  assert.equal(result.data.requirements[0].requiredGrams, 600);
  assert.equal(result.data.requirements[0].missingGrams, 100);
  assert.equal(result.data.maxProducible, 5);
  assert.equal(result.data.requirements.length, 1, "legacy product grams must not be added when components exist");
});

test("stock read sums matching real bobbins and never accepts a caller userId", async () => {
  const result = await tools.executeStampyProductStockTool({
    supabase: createSupabase(),
    userId: "user-a",
    intent: { toolName: "stock.filaments.list", filamentQuery: { material: "PLA" } },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.totalRemainingGrams, 500);
  assert.match(tools.formatStampyProductStockToolResult(result), /500 g/);
});

test("recalculation delegates to the existing Products action", async () => {
  let receivedProductId = null;
  const result = await tools.executeStampyProductStockTool({
    supabase: createSupabase(),
    userId: "user-a",
    intent: { toolName: "products.recalculate", productId: "product-a" },
    recalculateProduct: async (productId) => {
      receivedProductId = productId;
      return { success: true, product: { sale_price: 180, base_cost: 110 } };
    },
  });
  assert.equal(receivedProductId, "product-a");
  assert.equal(result.data.previousPrice, 150);
  assert.equal(result.data.newPrice, 180);
});

test("tool registry is the canonical impact and confirmation source", () => {
  assert.deepEqual(
    { impact: registry.getStampyToolContract("products.inspect").impact, confirmationRequired: registry.getStampyToolContract("products.inspect").confirmationRequired },
    { impact: "read", confirmationRequired: false },
  );
  assert.deepEqual(
    { impact: registry.getStampyToolContract("products.filaments.discount").impact, confirmationRequired: registry.getStampyToolContract("products.filaments.discount").confirmationRequired },
    { impact: "destructive", confirmationRequired: true },
  );
});

test("Stampy orchestration keeps tool events, auth and stale-context protection server-side", () => {
  const actions = fs.readFileSync(path.join(root, "src/app/stampy/actions.ts"), "utf8");
  const requests = fs.readFileSync(path.join(root, "src/lib/stampy/action-requests.ts"), "utf8");
  assert.match(actions, /getCurrentUserAccess\(supabase\)/);
  assert.match(actions, /toolExecution:/);
  assert.match(actions, /recalculateProductPriceAction/);
  assert.match(requests, /errorCode: "stale_context"/);
  assert.match(requests, /executeProductFilamentDiscount\(\{ supabase, actionRequestId \}\)/);
});
