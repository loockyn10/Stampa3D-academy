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

function makePrinterQuerySupabase(rows, error = null) {
  const query = {
    select() { return this; },
    eq() { return this; },
    then(resolve) { return Promise.resolve({ data: rows, error }).then(resolve); },
  };
  return {
    from(table) {
      assert.equal(table, "printers");
      return query;
    },
  };
}

function makePrinter(overrides = {}) {
  return {
    id: "printer-1",
    user_id: "user-1",
    name: "Bambu A1 Mini",
    power_watts: 350,
    maintenance_cost_per_hour: 0,
    is_active: true,
    source_template_id: null,
    ...overrides,
  };
}

test("printer duplicate matching normalizes accents, spaces and hyphens", async () => {
  const duplicate = await executor.findDuplicatePrinter({
    supabase: makePrinterQuerySupabase([
      makePrinter({ name: "Bambu  A1-Mini" }),
    ]),
    userId: "user-1",
    printerName: "bambu a1 mini",
  });

  assert.equal(duplicate.status, "active_duplicate");
  assert.equal(duplicate.printer.id, "printer-1");
});

test("inactive and ambiguous printer matches never become confirmable", async () => {
  const inactive = await executor.findDuplicatePrinter({
    supabase: makePrinterQuerySupabase([
      makePrinter({ name: "Ender 3", is_active: false }),
    ]),
    userId: "user-1",
    printerName: "Ender-3",
  });
  assert.equal(inactive.status, "inactive_match");

  const ambiguous = await executor.findDuplicatePrinter({
    supabase: makePrinterQuerySupabase([
      makePrinter({ id: "printer-1", name: "Bambu A1 Mini" }),
      makePrinter({ id: "printer-2", name: "Bambu A1 Mini Combo" }),
    ]),
    userId: "user-1",
    printerName: "Bambu A1",
  });
  assert.equal(ambiguous.status, "ambiguous");
});

function createAtomicPrinterRpc({ ownerMatches = true, duplicateStatus = null } = {}) {
  const state = {
    requestStatus: "suggested",
    printers: duplicateStatus
      ? [{ id: "existing-printer", name: "Bambu A1 Mini", is_active: duplicateStatus === "active" }]
      : [],
  };

  const supabase = {
    async rpc(name, params) {
      assert.equal(name, "confirm_stampy_create_printer");
      assert.deepEqual(params, { p_action_request_id: ACTION_REQUEST_ID });

      if (!ownerMatches) {
        return {
          data: [{
            success: false,
            action_request_id: ACTION_REQUEST_ID,
            printer_id: null,
            printer_name: null,
            power_watts: null,
            maintenance_cost_per_hour: null,
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
            printer_id: null,
            printer_name: null,
            power_watts: null,
            maintenance_cost_per_hour: null,
            error_code: "already_executed",
            message: "Esta impresora ya fue creada anteriormente.",
          }],
          error: null,
        };
      }

      if (state.printers.length > 0) {
        const active = state.printers[0].is_active;
        return {
          data: [{
            success: false,
            action_request_id: ACTION_REQUEST_ID,
            printer_id: state.printers[0].id,
            printer_name: "Bambu A1 Mini",
            power_watts: 350,
            maintenance_cost_per_hour: 0,
            error_code: active ? "duplicate_printer" : "inactive_printer_exists",
            message: "Ya existe una impresora parecida.",
          }],
          error: null,
        };
      }

      state.printers.push({
        id: "created-printer",
        name: "Bambu A1 Mini",
        power_watts: 350,
        maintenance_cost_per_hour: 0,
        is_active: true,
      });
      state.requestStatus = "executed";
      return {
        data: [{
          success: true,
          action_request_id: ACTION_REQUEST_ID,
          printer_id: "created-printer",
          printer_name: "Bambu A1 Mini",
          power_watts: 350,
          maintenance_cost_per_hour: 0,
          error_code: null,
          message: "Listo, creé la impresora.",
        }],
        error: null,
      };
    },
  };

  return { state, supabase };
}

test("valid confirmation creates the printer once with explicit numeric values", async () => {
  const { state, supabase } = createAtomicPrinterRpc();
  const first = await executor.executeCreatePrinter({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });
  const second = await executor.executeCreatePrinter({
    supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });

  assert.equal(first.success, true);
  assert.equal(first.printerName, "Bambu A1 Mini");
  assert.equal(first.powerWatts, 350);
  assert.equal(first.maintenanceCostPerHour, 0);
  assert.equal(second.success, false);
  assert.equal(second.errorCode, "already_executed");
  assert.equal(state.printers.length, 1);
  assert.equal(state.requestStatus, "executed");
});

test("duplicates, inactive matches and wrong users never create or reactivate", async () => {
  for (const duplicateStatus of ["active", "inactive"]) {
    const duplicate = createAtomicPrinterRpc({ duplicateStatus });
    const result = await executor.executeCreatePrinter({
      supabase: duplicate.supabase,
      actionRequestId: ACTION_REQUEST_ID,
    });
    assert.equal(result.success, false);
    assert.equal(duplicate.state.printers.length, 1);
    assert.equal(duplicate.state.requestStatus, "suggested");
    assert.equal(duplicate.state.printers[0].is_active, duplicateStatus === "active");
  }

  const wrongUser = createAtomicPrinterRpc({ ownerMatches: false });
  const result = await executor.executeCreatePrinter({
    supabase: wrongUser.supabase,
    actionRequestId: ACTION_REQUEST_ID,
  });
  assert.equal(result.success, false);
  assert.equal(wrongUser.state.printers.length, 0);
});

test("the printer Server Action authenticates and sends only the action request id", async () => {
  const calls = [];
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
      executeCreateFilament: async () => ({ success: false }),
      executeCreatePrinter: async (params) => {
        calls.push(params);
        return { success: true, message: "ok" };
      },
    },
    "./types": {},
  });

  const result = await actionRequests.confirmStampyCreatePrinterAction(
    ACTION_REQUEST_ID
  );
  assert.equal(result.success, true);
  assert.deepEqual(calls, [{ supabase, actionRequestId: ACTION_REQUEST_ID }]);
});

test("the printer migration is RPC-only and keeps insert plus execution atomic", () => {
  const sql = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260827004108_confirm_stampy_create_printer.sql"
    ),
    "utf8"
  );

  assert.doesNotMatch(sql, /create\s+table|alter\s+table|add\s+column/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /stampy_action_requests[\s\S]*for update/i);
  assert.match(sql, /action_request\.action_type is distinct from 'add_printer'/i);
  assert.match(sql, /action_request\.can_execute is distinct from false/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /from public\.printers[\s\S]*for update/i);
  assert.match(sql, /'duplicate_printer'/i);
  assert.match(sql, /'inactive_printer_exists'/i);
  assert.match(sql, /insert into public\.printers/i);
  assert.ok(
    sql.indexOf("insert into public.printers") <
      sql.indexOf("set\n    status = 'executed'")
  );
  assert.match(sql, /updated_requests <> 1[\s\S]*raise exception/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*service_role/i);
});

test("the shared card adds printer confirmation without removing filament controls", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/stampy/ActionIntentCard.tsx"),
    "utf8"
  );

  assert.match(source, /confirmStampyCreatePrinterAction\(actionRequestId\)/);
  assert.match(source, /canConfirmPrinterCreation/);
  assert.match(source, /Potencia/);
  assert.match(source, /Mantenimiento\/hora/);
  assert.match(source, /Confirmar movimiento/);
  assert.match(source, /confirmStampyCreateFilamentAction\(actionRequestId\)/);
});
