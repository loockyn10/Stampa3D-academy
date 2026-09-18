import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(filename, dependencies = {}) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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

const payments = loadTypeScriptModule(path.join(root, "src/lib/business/payments.ts"));
const catalog = loadTypeScriptModule(path.join(root, "src/lib/business/catalog.ts"));
const hidScanner = loadTypeScriptModule(path.join(root, "src/lib/barcode/hid-scanner.ts"));
const cart = loadTypeScriptModule(path.join(root, "src/lib/business/cart.ts"), {
  "./catalog": catalog,
  "../barcode/hid-scanner": hidScanner,
});
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260918120000_business_customer_accounts.sql"), "utf8");
const actions = fs.readFileSync(path.join(root, "src/app/mi-negocio/actions.ts"), "utf8");

test("cash sale with no client leaves zero debt", () => {
  const split = payments.computeSalePaymentSplit(50000, "cash", 50000);
  assert.deepEqual(split.payments, [{ method: "cash", amount: 50000 }]);
  assert.equal(split.debt, 0);
  const validation = payments.validateSalePaymentInput(50000, split.payments, false);
  assert.equal(validation.valid, true);
});

test("transfer sale with no client leaves zero debt", () => {
  const split = payments.computeSalePaymentSplit(50000, "transfer", 50000);
  assert.deepEqual(split.payments, [{ method: "transfer", amount: 50000 }]);
  assert.equal(split.debt, 0);
});

test("pure debt sale with no client is rejected by validation", () => {
  const split = payments.computeSalePaymentSplit(50000, "cash", null);
  assert.deepEqual(split.payments, []);
  assert.equal(split.debt, 50000);
  const validation = payments.validateSalePaymentInput(50000, split.payments, false);
  assert.equal(validation.valid, false);
});

test("pure debt sale with a client is accepted", () => {
  const split = payments.computeSalePaymentSplit(50000, "cash", null);
  const validation = payments.validateSalePaymentInput(50000, split.payments, true);
  assert.equal(validation.valid, true);
});

test("cash plus debt derives the remainder without asking for both amounts", () => {
  const split = payments.computeSalePaymentSplit(50000, "cash", 30000);
  assert.deepEqual(split.payments, [{ method: "cash", amount: 30000 }]);
  assert.equal(split.debt, 20000);
});

test("transfer plus debt derives the remainder the same way", () => {
  const split = payments.computeSalePaymentSplit(50000, "transfer", 30000);
  assert.deepEqual(split.payments, [{ method: "transfer", amount: 30000 }]);
  assert.equal(split.debt, 20000);
});

test("sum of immediate payments plus debt always equals the total", () => {
  for (const immediate of [0, 1, 12345.67, 50000]) {
    const split = payments.computeSalePaymentSplit(50000, "cash", immediate);
    const sum = split.payments.reduce((acc, payment) => acc + payment.amount, 0);
    assert.equal(Math.round((sum + split.debt) * 100) / 100, 50000);
  }
});

test("an immediate amount above the total is clamped, never treated as overpayment client-side", () => {
  const split = payments.computeSalePaymentSplit(50000, "cash", 90000);
  assert.equal(split.payments[0].amount, 50000);
  assert.equal(split.debt, 0);
});

test("validation rejects a payment breakdown that exceeds the total", () => {
  const validation = payments.validateSalePaymentInput(50000, [{ method: "cash", amount: 60000 }], true);
  assert.equal(validation.valid, false);
  assert.match(validation.error, /no puede superar/);
});

test("validation rejects zero or negative amounts and invalid methods", () => {
  assert.equal(payments.validateSalePaymentInput(50000, [{ method: "cash", amount: 0 }], true).valid, false);
  assert.equal(payments.validateSalePaymentInput(50000, [{ method: "cash", amount: -10 }], true).valid, false);
  assert.equal(payments.validateSalePaymentInput(50000, [{ method: "card", amount: 10 }], true).valid, false);
});

test("sale fingerprint changes when the payment split changes, invalidating a stale idempotency key", () => {
  const cartItems = [{ catalogItemId: "a", quantity: 1 }];
  const cashOnly = cart.buildBusinessSaleFingerprint(cartItems, "client-1", [{ method: "cash", amount: 100 }]);
  const splitDebt = cart.buildBusinessSaleFingerprint(cartItems, "client-1", [{ method: "cash", amount: 50 }]);
  assert.notEqual(cashOnly, splitDebt);
});

test("sale fingerprint is stable across payment array order", () => {
  const cartItems = [{ catalogItemId: "a", quantity: 1 }];
  const left = cart.buildBusinessSaleFingerprint(cartItems, "client-1", [
    { method: "cash", amount: 30 },
    { method: "transfer", amount: 20 },
  ]);
  const right = cart.buildBusinessSaleFingerprint(cartItems, "client-1", [
    { method: "transfer", amount: 20 },
    { method: "cash", amount: 30 },
  ]);
  assert.equal(left, right);
});

test("confirm_business_sale rejects overpayment and requires a client for any remaining debt", () => {
  assert.match(migration, /'overpayment'::text/);
  assert.match(migration, /sum_payments > computed_total/);
  assert.match(migration, /'client_required'::text/);
  assert.match(migration, /debt_amount > 0 and p_client_id is null/);
});

test("confirm_business_sale keeps debt as a single derived ledger movement, never as its own payment allocation", () => {
  assert.match(migration, /insert into public\.customer_account_movements[\s\S]*movement_type, delta, sale_id, reference/);
  assert.match(migration, /method text not null check \(method in \('cash', 'transfer'\)\)/);
});

test("the old 3-arg sale RPC signatures are dropped, not just shadowed by a default parameter", () => {
  assert.match(migration, /drop function if exists public\.confirm_business_sale\(uuid, jsonb, uuid\);/);
  assert.match(migration, /drop function if exists public\.confirm_business_showroom_sale\(uuid, jsonb, uuid\);/);
});

test("void_business_sale reverses debt exactly once per sale via a unique partial index", () => {
  assert.match(migration, /customer_account_movements_sale_type_uidx/);
  assert.match(migration, /on public\.customer_account_movements \(sale_id, movement_type\)/);
  assert.match(migration, /'sale_reversal', -original_debt_delta, target_sale\.id/);
  assert.doesNotMatch(migration, /delete from public\.customer_account_movements/);
});

test("register_customer_payment rejects overpayment against the ledger balance", () => {
  assert.match(migration, /create or replace function public\.register_customer_payment/);
  assert.match(migration, /normalized_amount > current_balance/);
  assert.match(migration, /'overpayment'::text/);
});

test("new tables never grant direct insert/update to authenticated; writes only via security definer RPCs", () => {
  assert.doesNotMatch(migration, /create policy [\s\S]{0,120}for insert to authenticated/i);
  assert.match(migration, /revoke all on table public\.customer_account_movements from anon, authenticated;/);
  assert.match(migration, /revoke all on table public\.business_sale_payment_allocations from anon, authenticated;/);
});

test("server action validates payment shape before calling the RPC and maps known error codes", () => {
  const start = actions.indexOf("export async function confirmBusinessSaleAction");
  const end = actions.indexOf("export async function loadBusinessReplenishmentAction", start);
  const block = actions.slice(start, end);
  assert.match(block, /p_payments: input\.payments/);
  assert.match(block, /overpayment:/);
  assert.match(block, /client_required:/);
});

test("register customer payment action validates amount and method before the RPC round trip", () => {
  const start = actions.indexOf("export async function registerCustomerPaymentAction");
  const block = actions.slice(start);
  assert.match(block, /input\.method !== "cash" && input\.method !== "transfer"/);
  assert.match(block, /input\.amount <= 0/);
  assert.match(block, /register_customer_payment/);
});
