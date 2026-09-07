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

const intents = loadTypeScriptModule(path.join(root, "src/lib/stampy/client-tool-intents.ts"));
const tools = loadTypeScriptModule(path.join(root, "src/lib/stampy/client-tools.ts"));

const selectedClientContext = {
  page: { section: "budgets", route: "/presupuestos" },
  selectedEntity: { type: "client", id: "client-1", name: "Lucas" },
};

test("client intent uses only the selected client identifier", () => {
  const intent = intents.detectStampyClientToolIntent({
    message: "¿Qué presupuestos tiene este cliente?",
    screenContext: selectedClientContext,
  });
  assert.deepEqual(intent, { toolName: "clients.inspect", clientId: "client-1", aspect: "budgets" });
  assert.equal(intents.detectStampyClientToolIntent({
    message: "¿Cuál es su email?",
    screenContext: { ...selectedClientContext, selectedEntity: null },
  }), null);
});

test("client intent resolves one visible client by name without frontend contact data", () => {
  const intent = intents.detectStampyClientToolIntent({
    message: "¿Cuál fue el último presupuesto de Martina?",
    screenContext: {
      page: { section: "budgets", route: "/presupuestos" },
      visibleEntities: [
        { type: "client", id: "client-1", name: "Lucas", position: 1 },
        { type: "client", id: "client-2", name: "Martina", position: 2 },
      ],
    },
  });
  assert.deepEqual(intent, { toolName: "clients.inspect", clientId: "client-2", aspect: "last_budget" });
});

test("client queries validate ownership for both client and budgets", async () => {
  const filters = [];
  const clientBuilder = {
    select() { return this; },
    eq(column, value) { filters.push(["clients", column, value]); return this; },
    async maybeSingle() {
      return {
        data: {
          id: "client-1", user_id: "user-1", name: "Lucas", email: "lucas@example.com",
          phone: "", address: "", city: "", province: "", postal_code: "",
          contact_person: "", fiscal_condition: "", cuit: "", is_active: true,
        },
        error: null,
      };
    },
  };
  const budgetBuilder = {
    select() { return this; },
    eq(column, value) { filters.push(["budgets", column, value]); return this; },
    order() { return this; },
    async limit() {
      return {
        data: [{ title: "Pedido septiembre", budget_number: 12, status: "sent", total_amount: 15_000, created_at: "2026-09-01" }],
        error: null,
      };
    },
  };
  const supabase = {
    from(table) {
      if (table === "clients") return clientBuilder;
      if (table === "budgets") return budgetBuilder;
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const result = await tools.executeStampyClientTool({
    supabase,
    userId: "user-1",
    intent: { toolName: "clients.inspect", clientId: "client-1", aspect: "budgets" },
  });
  assert.equal(result.success, true);
  assert.deepEqual(filters, [
    ["clients", "id", "client-1"],
    ["clients", "user_id", "user-1"],
    ["budgets", "user_id", "user-1"],
    ["budgets", "client_id", "client-1"],
  ]);
  assert.match(tools.formatStampyClientToolResult(result), /Pedido septiembre/);
});

test("client email is returned only for the explicit email aspect", async () => {
  const supabase = {
    from(table) {
      assert.equal(table, "clients");
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return {
            data: {
              id: "client-1", name: "Lucas", email: "lucas@example.com", phone: "",
              address: "", city: "", province: "", postal_code: "", contact_person: "",
              fiscal_condition: "", cuit: "", is_active: true,
            },
            error: null,
          };
        },
      };
    },
  };
  const result = await tools.executeStampyClientTool({
    supabase,
    userId: "user-1",
    intent: { toolName: "clients.inspect", clientId: "client-1", aspect: "email" },
  });
  assert.match(tools.formatStampyClientToolResult(result), /lucas@example\.com/);
});

test("Stampy exposes a specific read-only client contract, never a generic update", () => {
  const registry = fs.readFileSync(path.join(root, "src/lib/stampy/tool-registry.ts"), "utf8");
  assert.match(registry, /id: "clients\.inspect"/);
  assert.match(registry, /area: "clients"/);
  assert.doesNotMatch(registry, /update_(?:any|client)|clients\.update/);
});
