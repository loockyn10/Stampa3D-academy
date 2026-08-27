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

const executor = loadTypeScriptModule("src/lib/stampy/action-executor.ts");

function makeFilamentQuerySupabase(rows, error = null) {
  const query = {
    select() { return this; },
    eq() { return this; },
    then(resolve) { return Promise.resolve({ data: rows, error }).then(resolve); },
  };
  return {
    from(table) {
      assert.equal(table, "filaments");
      return query;
    },
  };
}

test("strong duplicate matching uses material, brand, subtype and color", async () => {
  const existing = {
    id: "filament-1",
    user_id: "user-1",
    name: "Silk",
    filament_type: "PLA",
    brand: "W3D",
    color: "Cían",
    remaining_grams: 800,
    total_grams: 1000,
    is_active: true,
    filament_templates: null,
  };

  const duplicate = await executor.findDuplicateActiveFilament({
    supabase: makeFilamentQuerySupabase([existing]),
    userId: "user-1",
    extracted: { material: "pla", brand: "w3d", name: "silk", color: "cian" },
  });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.filament.id, "filament-1");

  const distinctSubtype = await executor.findDuplicateActiveFilament({
    supabase: makeFilamentQuerySupabase([existing]),
    userId: "user-1",
    extracted: { material: "PLA", brand: "W3D", name: "Mate", color: "Cian" },
  });
  assert.equal(distinctSubtype.status, "clear");
});

function createAtomicCreateRpc({ ownerMatches = true, existingDuplicate = false } = {}) {
  const state = {
    requestStatus: "suggested",
    filaments: existingDuplicate
      ? [{ id: "existing-filament", total_grams: 1000, remaining_grams: 750 }]
      : [],
  };

  const supabase = {
    async rpc(name, params) {
      assert.equal(name, "confirm_stampy_create_filament");
      assert.deepEqual(params, { p_action_request_id: ACTION_REQUEST_ID });

      if (!ownerMatches) {
        return {
          data: [{
            success: false,
            action_request_id: ACTION_REQUEST_ID,
            filament_id: null,
            label: null,
            total_grams: null,
            remaining_grams: null,
            error_code: "action_request_not_found",
            message: "No encontré una solicitud de creación válida.",
          }],
          error: null,
        };
      }

      if (state.requestStatus === "executed") {
        return {
          data: [{
            success: false,
            action_request_id: ACTION_REQUEST_ID,
            filament_id: null,
            label: null,
            total_grams: null,
            remaining_grams: null,
            error_code: "already_executed",
            message: "Este filamento ya fue creado anteriormente.",
          }],
          error: null,
        };
      }

      if (state.filaments.length > 0) {
        return {
          data: [{
            success: false,
            action_request_id: ACTION_REQUEST_ID,
            filament_id: state.filaments[0].id,
            label: null,
            total_grams: null,
            remaining_grams: null,
            error_code: "duplicate_filament",
            message: "Ya existe un filamento parecido. Abrí Stock para revisarlo.",
          }],
          error: null,
        };
      }

      state.filaments.push({
        id: "created-filament",
        filament_type: "PETG",
        brand: "ELEGOO",
        name: null,
        color: "rojo",
        total_grams: 1000,
        remaining_grams: 1000,
      });
      state.requestStatus = "executed";
      return {
        data: [{
          success: true,
          action_request_id: ACTION_REQUEST_ID,
          filament_id: "created-filament",
          label: "PETG · ELEGOO · rojo",
          total_grams: 1000,
          remaining_grams: 1000,
          error_code: null,
          message: "Listo, creé el filamento.",
        }],
        error: null,
      };
    },
  };

  return { state, supabase };
}

test("valid confirmation creates equal total and remaining grams and executes once", async () => {
  const { state, supabase } = createAtomicCreateRpc();
  const first = await executor.executeCreateFilament({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });
  const second = await executor.executeCreateFilament({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });

  assert.equal(first.success, true);
  assert.equal(first.totalGrams, 1000);
  assert.equal(first.remainingGrams, 1000);
  assert.equal(second.success, false);
  assert.equal(second.errorCode, "already_executed");
  assert.equal(state.filaments.length, 1);
  assert.equal(state.requestStatus, "executed");
});

test("a duplicate or wrong user never creates a filament", async () => {
  const duplicate = createAtomicCreateRpc({ existingDuplicate: true });
  const duplicateResult = await executor.executeCreateFilament({
    supabase: duplicate.supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });
  assert.equal(duplicateResult.errorCode, "duplicate_filament");
  assert.equal(duplicate.state.requestStatus, "suggested");
  assert.equal(duplicate.state.filaments.length, 1);

  const wrongUser = createAtomicCreateRpc({ ownerMatches: false });
  const wrongUserResult = await executor.executeCreateFilament({
    supabase: wrongUser.supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });
  assert.equal(wrongUserResult.success, false);
  assert.equal(wrongUser.state.filaments.length, 0);
  assert.equal(wrongUser.state.requestStatus, "suggested");
});

test("the create Server Action authenticates and sends only the action request id", async () => {
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
      executeFilamentStockMovement: async () => ({ success: false }),
      executeCreatePrinter: async () => ({ success: false }),
      executeCreateFilament: async (params) => {
        executorCalls.push(params);
        return { success: true, message: "ok" };
      },
    },
    "./types": {},
  });

  const result = await actionRequests.confirmStampyCreateFilamentAction(
    ACTION_REQUEST_ID
  );
  assert.equal(result.success, true);
  assert.deepEqual(executorCalls, [{ supabase, actionRequestId: ACTION_REQUEST_ID }]);
});

test("the migration is RPC-only, serializes duplicates and keeps insert plus execution atomic", () => {
  const sql = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260826231723_confirm_stampy_create_filament.sql"
    ),
    "utf8"
  );

  assert.doesNotMatch(sql, /create\s+table|alter\s+table|add\s+column/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /stampy_action_requests[\s\S]*for update/i);
  assert.match(sql, /action_request\.action_type is distinct from 'add_filament'/i);
  assert.match(sql, /action_request\.can_execute is distinct from false/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /from public\.filaments[\s\S]*is_active = true[\s\S]*for update/i);
  assert.match(sql, /'duplicate_filament'::text/i);
  assert.match(sql, /insert into public\.filaments/i);
  assert.match(sql, /created_total_grams,[\s\S]*created_total_grams,[\s\S]*0,[\s\S]*true/i);
  assert.ok(
    sql.indexOf("insert into public.filaments") <
      sql.indexOf("set\n    status = 'executed'")
  );
  assert.match(sql, /updated_requests <> 1[\s\S]*raise exception/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*service_role/i);
});

test("the shared card exposes creation confirmation without changing movement controls", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/stampy/ActionIntentCard.tsx"),
    "utf8"
  );

  assert.match(source, /Confirmar creación/);
  assert.match(source, /confirmStampyCreateFilamentAction\(actionRequestId\)/);
  assert.match(source, /duplicateStatus === "clear"/);
  assert.match(source, /Confirmar movimiento/);
  assert.match(source, /Abrir \{actionIntent\.toolLabel \|\| "herramienta"\}/);
  assert.match(source, /handleCancel/);
});
