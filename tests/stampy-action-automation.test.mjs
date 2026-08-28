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

const actionSettings = loadTypeScriptModule(
  "src/lib/stampy/action-settings.ts",
  { "./types": {} }
);
const messagePolicy = loadTypeScriptModule("src/lib/stampy/message-policy.ts");
const toolRegistry = loadTypeScriptModule("src/lib/stampy/tool-registry.ts");
const actionIntents = loadTypeScriptModule("src/lib/stampy/action-intents.ts", {
  "./tool-registry": toolRegistry,
  "./types": {},
});
const actionValidator = loadTypeScriptModule(
  "src/lib/stampy/action-validator.ts",
  { "./tool-registry": toolRegistry, "./types": {} }
);

const defaults = { ...actionSettings.DEFAULT_STAMPY_ACTION_SETTINGS };
const allEnabled = {
  autoExecuteLowRisk: true,
  autoExecuteFilamentMovements: true,
  autoExecuteCreateFilament: true,
  autoExecuteCreatePrinter: true,
};

function loadAutomationHarness({
  settings = defaults,
  settingsError = null,
  filamentMatch = {
    status: "unique",
    filament: {
      id: "filament-1",
      user_id: "user-1",
      name: "Silk",
      filament_type: "PLA",
      brand: "W3D",
      color: "Cian",
      remaining_grams: 900,
      total_grams: 1000,
      is_active: true,
    },
  },
  duplicateFilament = { status: "clear" },
  duplicatePrinter = { status: "clear" },
  movementResult = {
    success: true,
    errorCode: null,
    message: "Listo.",
    newRemainingGrams: 850,
  },
  filamentResult = {
    success: true,
    errorCode: null,
    message: "Listo.",
    label: "PETG · ELEGOO · rojo",
    remainingGrams: 1000,
  },
  printerResult = {
    success: true,
    errorCode: null,
    message: "Listo.",
    printerName: "Bambu A1 Mini",
  },
} = {}) {
  const executions = [];
  const actionRequests = [];
  const actionRequestUpdates = [];
  const messageUpdates = [];

  const supabase = {
    from(table) {
      return {
        update(payload) {
          if (table === "stampy_action_requests") actionRequestUpdates.push(payload);
          if (table === "stampy_messages") messageUpdates.push(payload);
          return this;
        },
        eq() {
          return this;
        },
      };
    },
  };

  const executorModule = {
    resolveFilamentMatch: async () => filamentMatch,
    findDuplicateActiveFilament: async () => duplicateFilament,
    findDuplicatePrinter: async () => duplicatePrinter,
    getResolvedFilamentLabel: (filament) =>
      [filament.filament_type, filament.brand, filament.name, filament.color]
        .filter(Boolean)
        .join(" · "),
    executeFilamentStockMovement: async (params) => {
      executions.push({ kind: "movement", params });
      return movementResult;
    },
    executeCreateFilament: async (params) => {
      executions.push({ kind: "filament", params });
      return filamentResult;
    },
    executeCreatePrinter: async (params) => {
      executions.push({ kind: "printer", params });
      return printerResult;
    },
    executeCreateProduct: async () => {
      executions.push({ kind: "product" });
      return { success: false };
    },
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
      getStampyActionSettings: async () => ({ settings, error: settingsError }),
      canAutoExecuteStampyAction: actionSettings.canAutoExecuteStampyAction,
    },
    "@/lib/stampy/action-requests": {
      createStampyActionRequest: async (params) => {
        actionRequests.push(params);
        return { actionRequestId: "action-request-1", error: null };
      },
    },
    "@/lib/stampy/action-executor": executorModule,
    "@/lib/stampy/usage-log": { logStampyUsage: async () => undefined },
  });

  return {
    actions,
    executions,
    actionRequests,
    actionRequestUpdates,
    messageUpdates,
  };
}

test("missing settings row returns fail-closed defaults", async () => {
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const result = await actionSettings.getStampyActionSettings({
    supabase: { from: () => query },
    userId: "user-1",
  });

  assert.deepEqual(result, { settings: defaults, error: null });
  assert.equal(
    actionSettings.canAutoExecuteStampyAction({
      settings: result.settings,
      actionType: "discount_filament",
    }),
    false
  );
});

test("filament movement with automation off keeps confirmation", async () => {
  const harness = loadAutomationHarness();
  const result = await harness.actions.askStampyAction(
    "Descontame 50g de PLA W3D Cian"
  );

  assert.equal(harness.executions.length, 0);
  assert.equal(result.actionIntent.extracted.requiresConfirmation, true);
  assert.equal(result.actionIntent.extracted.autoExecution.reason, "setting_disabled");
  assert.equal(
    harness.actionRequests[0].actionIntent.extracted.autoExecution.allowed,
    false
  );
  assert.match(result.answer, /Confirmá si está bien/i);
});

test("unique filament movement auto-executes when both settings are on", async () => {
  const harness = loadAutomationHarness({ settings: allEnabled });
  const result = await harness.actions.askStampyAction(
    "Descontame 50g de PLA W3D Cian"
  );

  assert.deepEqual(harness.executions.map((entry) => entry.kind), ["movement"]);
  assert.equal(result.actionIntent.canExecute, false);
  assert.equal(result.actionIntent.extracted.requiresConfirmation, false);
  assert.deepEqual(result.actionIntent.extracted.autoExecution, {
    attempted: true,
    allowed: true,
    reason: "user_setting_enabled",
    executed: true,
    errorCode: null,
  });
  assert.match(result.answer, /Listo, desconté 50g/i);
  assert.match(result.answer, /850g/);
  assert.equal(
    harness.actionRequests[0].actionIntent.extracted.autoExecution.reason,
    "user_setting_enabled"
  );
  assert.equal(harness.actionRequestUpdates.at(-1).extracted.autoExecution.executed, true);
});

test("ambiguous movement never auto-executes even when settings are on", async () => {
  const harness = loadAutomationHarness({
    settings: allEnabled,
    filamentMatch: { status: "multiple", matches: [{ id: "a" }, { id: "b" }] },
  });
  const result = await harness.actions.askStampyAction("Descontame 50g de PLA");

  assert.equal(harness.executions.length, 0);
  assert.equal(result.actionIntent.extracted.autoExecution.reason, "ambiguous_target");
  assert.match(result.answer, /más de un filamento/i);
});

test("create filament respects its specific setting", async () => {
  const specificOff = loadAutomationHarness({
    settings: { ...allEnabled, autoExecuteCreateFilament: false },
  });
  const offResult = await specificOff.actions.askStampyAction(
    "Creame un filamento nuevo PETG rojo Elegoo"
  );
  assert.equal(specificOff.executions.length, 0);
  assert.equal(offResult.actionIntent.extracted.requiresConfirmation, true);

  const specificOn = loadAutomationHarness({ settings: allEnabled });
  const onResult = await specificOn.actions.askStampyAction(
    "Creame un filamento nuevo PETG rojo Elegoo"
  );
  assert.deepEqual(specificOn.executions.map((entry) => entry.kind), ["filament"]);
  assert.match(onResult.answer, /Listo, creé el filamento/i);
  assert.equal(onResult.actionIntent.extracted.autoExecution.executed, true);
});

test("create printer auto-executes only after a clear duplicate check", async () => {
  const harness = loadAutomationHarness({ settings: allEnabled });
  const result = await harness.actions.askStampyAction(
    "Creame una impresora Bambu A1 Mini de 350 watts"
  );

  assert.deepEqual(harness.executions.map((entry) => entry.kind), ["printer"]);
  assert.match(result.answer, /Listo, creé la impresora Bambu A1 Mini/i);
});

test("quotes and calculator never auto-execute", async () => {
  for (const message of [
    "Hacé un presupuesto para Lucas Marchetti de 2 Jarros de Argentina",
    "Calculame una impresión de 167g y 5h",
  ]) {
    const harness = loadAutomationHarness({ settings: allEnabled });
    const result = await harness.actions.askStampyAction(message);
    assert.equal(harness.executions.length, 0);
    assert.equal(result.actionIntent.extracted.autoExecution.reason, "unsupported_action");
  }
});

test("insufficient stock is rejected before the executor and returns a clear answer", async () => {
  const harness = loadAutomationHarness({
    settings: allEnabled,
    filamentMatch: {
      status: "unique",
      filament: {
        id: "filament-1",
        user_id: "user-1",
        name: "PLA",
        filament_type: "PLA",
        brand: "W3D",
        color: "Cian",
        remaining_grams: 20,
        total_grams: 1000,
        is_active: true,
      },
    },
  });
  const result = await harness.actions.askStampyAction(
    "Descontame 50g de PLA W3D Cian"
  );

  assert.equal(harness.executions.length, 0);
  assert.equal(result.actionIntent.extracted.requiresConfirmation, false);
  assert.equal(result.actionIntent.extracted.autoExecution.reason, "insufficient_stock");
  assert.match(result.answer, /No hay suficientes gramos/i);
});

test("settings read failures remain fail closed", async () => {
  const harness = loadAutomationHarness({
    settings: allEnabled,
    settingsError: "relation unavailable",
  });
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const result = await harness.actions.askStampyAction(
      "Descontame 50g de PLA W3D Cian"
    );
    assert.equal(harness.executions.length, 0);
    assert.equal(result.actionIntent.extracted.autoExecution.reason, "settings_unavailable");
    assert.match(result.answer, /Confirmá si está bien/i);
  } finally {
    console.error = originalConsoleError;
  }
});

test("RPC failures keep the action pending for manual confirmation", async () => {
  const harness = loadAutomationHarness({
    settings: allEnabled,
    movementResult: {
      success: false,
      errorCode: "rpc_error",
      message: "No pude actualizar el stock.",
      newRemainingGrams: null,
    },
  });
  const result = await harness.actions.askStampyAction(
    "Descontame 50g de PLA W3D Cian"
  );

  assert.equal(harness.executions.length, 1);
  assert.equal(result.actionIntent.extracted.requiresConfirmation, true);
  assert.deepEqual(result.actionIntent.extracted.autoExecution, {
    attempted: true,
    allowed: false,
    reason: "rpc_error",
    executed: false,
    errorCode: "rpc_error",
  });
  assert.match(result.answer, /No pude actualizar el stock/i);
  assert.match(result.answer, /confirmar la acción manualmente/i);
});

test("migration keeps defaults off, enforces own-row RLS and grants no anon access", () => {
  const sql = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260827013758_stampy_user_action_settings.sql"
    ),
    "utf8"
  );

  assert.match(sql, /user_id uuid primary key references auth\.users\(id\) on delete cascade/i);
  assert.ok((sql.match(/boolean not null default false/gi) ?? []).length >= 4);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /using \(user_id = auth\.uid\(\)\)/i);
  assert.match(sql, /with check \(user_id = auth\.uid\(\)\)/i);
  assert.match(sql, /public\.is_admin\(auth\.uid\(\)\)/i);
  assert.match(sql, /revoke all on table public\.stampy_user_action_settings from public, anon/i);
  assert.doesNotMatch(sql, /grant[^;]*anon/i);
});
