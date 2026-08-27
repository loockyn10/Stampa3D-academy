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

const executor = loadTypeScriptModule("src/lib/stampy/action-executor.ts");

function makeFilament(overrides = {}) {
  return {
    id: "filament-1",
    user_id: "user-1",
    name: "PLA Silk",
    filament_type: "PLA",
    brand: "W3D",
    color: "Cian",
    remaining_grams: 900,
    total_grams: 1000,
    is_active: true,
    filament_templates: null,
    ...overrides,
  };
}

function makeFilamentQuerySupabase(rows, error = null) {
  const filters = {};
  const query = {
    select() {
      return this;
    },
    eq(column, value) {
      filters[column] = value;
      return this;
    },
    then(resolve, reject) {
      const data = rows.filter((row) =>
        Object.entries(filters).every(([column, value]) => row[column] === value)
      );
      return Promise.resolve({ data, error }).then(resolve, reject);
    },
  };

  return {
    from(table) {
      assert.equal(table, "filaments");
      return query;
    },
  };
}

test("resolveFilamentMatch normalizes accents and requires one unique active owned match", async () => {
  const supabase = makeFilamentQuerySupabase([
    makeFilament(),
    makeFilament({
      id: "filament-inactive",
      color: "Cían",
      is_active: false,
    }),
    makeFilament({ id: "filament-other-user", user_id: "user-2" }),
  ]);

  const result = await executor.resolveFilamentMatch({
    supabase,
    userId: "user-1",
    extracted: { material: "pla", brand: "w3d", color: "cían" },
  });

  assert.equal(result.status, "unique");
  assert.equal(result.filament.id, "filament-1");
  assert.match(executor.getResolvedFilamentLabel(result.filament), /PLA.*W3D.*Cian/);
});

test("resolveFilamentMatch refuses multiple and missing matches", async () => {
  const multiple = await executor.resolveFilamentMatch({
    supabase: makeFilamentQuerySupabase([
      makeFilament(),
      makeFilament({ id: "filament-2", name: "PLA Basic" }),
    ]),
    userId: "user-1",
    extracted: { material: "PLA", color: "Cian" },
  });
  assert.equal(multiple.status, "multiple");
  assert.equal(multiple.matches.length, 2);

  const none = await executor.resolveFilamentMatch({
    supabase: makeFilamentQuerySupabase([makeFilament()]),
    userId: "user-1",
    extracted: { material: "PETG", color: "Rojo" },
  });
  assert.deepEqual(none, { status: "none", matches: [] });
});

function createAtomicMovementRpc({
  actionType = "discount_filament",
  remainingGrams = 900,
  grams = 50,
  ownerMatches = true,
} = {}) {
  const state = {
    requestStatus: "suggested",
    remainingGrams,
    executedAt: null,
    rpcCalls: 0,
  };
  let queue = Promise.resolve();

  const supabase = {
    rpc(name, params) {
      assert.equal(name, "confirm_stampy_filament_movement");
      assert.deepEqual(Object.keys(params), ["p_action_request_id"]);

      const operation = queue.then(async () => {
        state.rpcCalls += 1;
        if (!ownerMatches) {
          return {
            data: [{
              success: false,
              action_request_id: params.p_action_request_id,
              filament_id: null,
              previous_remaining_grams: null,
              new_remaining_grams: null,
              delta_grams: null,
              error_code: "action_request_not_found",
              message: "No encontré una solicitud de acción válida.",
            }],
            error: null,
          };
        }
        if (state.requestStatus === "executed") {
          return {
            data: [{
              success: false,
              action_request_id: params.p_action_request_id,
              filament_id: null,
              previous_remaining_grams: null,
              new_remaining_grams: null,
              delta_grams: null,
              error_code: "already_executed",
              message: "Este movimiento ya fue confirmado anteriormente.",
            }],
            error: null,
          };
        }

        const delta = actionType === "increase_filament_stock" ? grams : -grams;
        if (state.remainingGrams + delta < 0) {
          return {
            data: [{
              success: false,
              action_request_id: params.p_action_request_id,
              filament_id: "filament-1",
              previous_remaining_grams: state.remainingGrams,
              new_remaining_grams: state.remainingGrams,
              delta_grams: delta,
              error_code: "insufficient_stock",
              message: "No hay suficientes gramos disponibles para realizar el descuento.",
            }],
            error: null,
          };
        }

        const previous = state.remainingGrams;
        state.remainingGrams += delta;
        state.requestStatus = "executed";
        state.executedAt = "2026-08-26T22:00:00.000Z";
        return {
          data: [{
            success: true,
            action_request_id: params.p_action_request_id,
            filament_id: "filament-1",
            previous_remaining_grams: previous,
            new_remaining_grams: state.remainingGrams,
            delta_grams: delta,
            error_code: null,
            message: "Listo, actualicé el stock de filamento.",
          }],
          error: null,
        };
      });

      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };

  return { state, supabase };
}

const ACTION_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

test("a valid discount executes once and concurrent reconfirmation cannot duplicate it", async () => {
  const { state, supabase } = createAtomicMovementRpc();
  const [first, second] = await Promise.all([
    executor.executeFilamentStockMovement({ supabase, actionRequestId: ACTION_REQUEST_ID }),
    executor.executeFilamentStockMovement({ supabase, actionRequestId: ACTION_REQUEST_ID }),
  ]);

  assert.equal([first, second].filter((result) => result.success).length, 1);
  assert.equal([first, second].find((result) => !result.success).errorCode, "already_executed");
  assert.equal(state.remainingGrams, 850);
  assert.equal(state.requestStatus, "executed");
  assert.ok(state.executedAt);
});

test("insufficient stock never changes grams or executes the request", async () => {
  const { state, supabase } = createAtomicMovementRpc({ remainingGrams: 20 });
  const result = await executor.executeFilamentStockMovement({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "insufficient_stock");
  assert.match(result.message, /suficientes gramos/);
  assert.equal(state.remainingGrams, 20);
  assert.equal(state.requestStatus, "suggested");
});

test("a valid increase changes only the signed remaining grams result and executes", async () => {
  const { state, supabase } = createAtomicMovementRpc({
    actionType: "increase_filament_stock",
    remainingGrams: 850,
  });
  const result = await executor.executeFilamentStockMovement({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });

  assert.equal(result.success, true);
  assert.equal(result.previousRemainingGrams, 850);
  assert.equal(result.newRemainingGrams, 900);
  assert.equal(result.deltaGrams, 50);
  assert.equal(state.requestStatus, "executed");
});

test("an action request hidden from the current user cannot execute", async () => {
  const { state, supabase } = createAtomicMovementRpc({ ownerMatches: false });
  const result = await executor.executeFilamentStockMovement({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "action_request_not_found");
  assert.equal(state.remainingGrams, 900);
  assert.equal(state.requestStatus, "suggested");
});

test("the confirmation Server Action authenticates and sends only the action request id", async () => {
  const executorCalls = [];
  const supabase = {};
  const actionRequests = loadTypeScriptModule("src/lib/stampy/action-requests.ts", {
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
      executeFilamentStockMovement: async (params) => {
        executorCalls.push(params);
        return { success: true, message: "ok" };
      },
    },
    "./types": {},
  });

  const result = await actionRequests.confirmStampyActionRequest({
    actionRequestId: ACTION_REQUEST_ID,
    grams: 9999,
    filamentId: "attacker-controlled",
  });

  assert.equal(result.success, true);
  assert.deepEqual(executorCalls, [{ supabase, actionRequestId: ACTION_REQUEST_ID }]);
});

test("the migration is RPC-only and keeps movement plus executed status atomic", () => {
  const sql = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260826225118_confirm_stampy_filament_movement.sql"
    ),
    "utf8"
  );
  const normalized = sql.replace(/\s+/g, " ");

  assert.doesNotMatch(sql, /create\s+table|alter\s+table|add\s+column/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /stampy_action_requests[\s\S]*for update/i);
  assert.match(sql, /filaments[\s\S]*for update/i);
  assert.match(sql, /status not in \('suggested', 'opened_tool'\)/i);
  assert.match(sql, /action_request\.can_execute is distinct from false/i);
  assert.match(sql, /action_request\.extracted ->> 'grams'/i);
  assert.match(sql, /resolvedTarget,id/i);
  assert.match(sql, /has_platform_access\(current_user_id\) is distinct from true/i);
  assert.match(sql, /action_request\.status is null[\s\S]*not in \('suggested', 'opened_tool'\)/i);
  assert.match(sql, /action_request\.action_type is null[\s\S]*not in \([\s\S]*'increase_filament_stock'[\s\S]*'discount_filament'/i);
  assert.match(
    normalized,
    /perform public\.adjust_filament_stock\( p_filament_id => target_filament\.id, p_grams_delta => signed_delta, p_movement_type =>/i
  );
  assert.match(sql, /p_source_type => 'stampy_action_request'/i);
  assert.match(sql, /p_source_id => action_request\.id/i);
  assert.ok(
    sql.indexOf("perform public.adjust_filament_stock") <
      sql.indexOf("set\n    status = 'executed'"),
  );
  assert.match(sql, /updated_requests <> 1[\s\S]*raise exception/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*service_role/i);
});

test("the shared card exposes confirmation only behind the resolved safe flag", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/stampy/ActionIntentCard.tsx"),
    "utf8"
  );

  assert.match(source, /actionIntent\.extracted\?\.requiresConfirmation === true/);
  assert.match(source, /Confirmar movimiento/);
  assert.match(source, /confirmStampyActionRequest\(\{ actionRequestId \}\)/);
  assert.match(source, /Abrir \{actionIntent\.toolLabel \|\| "herramienta"\}/);
  assert.match(source, /handleCancel/);
});
