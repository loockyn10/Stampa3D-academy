import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migration = read("supabase/migrations/20260908014943_business_ecommerce_base.sql");
const checkout = read("src/app/api/business/storefront/[slug]/checkout/route.ts");
const webhook = read("src/app/api/business/mercadopago/webhook/route.ts");
const provider = read("src/lib/business/mercado-pago-provider.ts");
const oauth = `${read("src/app/api/business/mercadopago/connect/route.ts")}\n${read("src/app/api/business/mercadopago/callback/route.ts")}`;
const cart = read("src/components/business/PublicStorefrontCart.tsx");

function loadSignatureModule() {
  const filename = path.join(root, "src/lib/business/webhook-signature.ts");
  const source = read("src/lib/business/webhook-signature.ts");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((request) => request === "node:crypto" ? crypto : null, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

test("webhook signature is mandatory, time bounded and HMAC verified", () => {
  const { validateMercadoPagoWebhookSignature } = loadSignatureModule();
  const secret = "test-secret"; const dataId = "123"; const requestId = "request-1"; const tsValue = "2000";
  const digest = crypto.createHmac("sha256", secret).update(`id:${dataId};request-id:${requestId};ts:${tsValue};`).digest("hex");
  assert.equal(validateMercadoPagoWebhookSignature({ xSignature: `ts=${tsValue},v1=${digest}`, xRequestId: requestId, dataId, secret, nowSeconds: 2000 }), true);
  assert.equal(validateMercadoPagoWebhookSignature({ xSignature: null, xRequestId: requestId, dataId, secret, nowSeconds: 2000 }), false);
  assert.equal(validateMercadoPagoWebhookSignature({ xSignature: `ts=${tsValue},v1=${digest}`, xRequestId: requestId, dataId, secret, nowSeconds: 3000 }), false);
});

test("database is the final concurrency and idempotency boundary", () => {
  assert.match(migration, /business_orders_user_idempotency_uidx/);
  assert.match(migration, /business_payments_provider_payment_uidx/);
  assert.match(migration, /business_payment_webhook_event_uidx/);
  assert.match(migration, /business_sales_order_uidx/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /for update/g);
  assert.match(migration, /business_stock_reservations_order_catalog_uidx/);
  assert.match(migration, /on conflict \(provider,provider_payment_id\)/);
});

test("checkout ignores frontend prices and reserves server-side stock atomically", () => {
  assert.match(checkout, /p_items: body\.items/);
  assert.doesNotMatch(checkout, /body\.(?:price|total|subtotal)/);
  assert.match(migration, /computed_total := computed_total \+ item\.sale_price \* requested\.quantity/);
  assert.match(migration, /insert into public\.business_stock_reservations/);
  assert.match(migration, /already_reserved/);
  assert.match(migration, /on_hand - already_reserved < requested\.quantity/);
});

test("provider is abstracted and preference creation uses stable external reference", () => {
  assert.match(read("src/lib/business/payment-provider.ts"), /interface PaymentProvider/);
  assert.match(provider, /external_reference: input\.externalReference/);
  assert.match(provider, /marketplace_fee/);
  assert.match(provider, /findCheckoutByExternalReference/);
  assert.doesNotMatch(provider.slice(provider.indexOf("createCheckout"), provider.indexOf("findCheckoutByExternalReference")), /X-Idempotency-Key/i);
  assert.match(checkout, /stampa-order-|external_reference|externalReference/);
});

test("OAuth is authorization-code PKCE and credentials stay encrypted server-side", () => {
  assert.match(oauth, /code_challenge_method.*S256/s);
  assert.match(oauth, /state_hash/);
  assert.match(oauth, /code_verifier/);
  assert.match(oauth, /encryptBusinessSecret/);
  assert.match(migration, /revoke all on table public\.business_payment_accounts from public, anon, authenticated/);
  assert.doesNotMatch(cart, /access_token|refresh_token|service_role/i);
});

test("duplicate webhook cannot duplicate sale or stock movements", () => {
  assert.match(webhook, /code === "23505"/);
  assert.match(webhook, /getPayment\(dataId/);
  assert.match(webhook, /process_business_payment/);
  assert.match(webhook, /status: 500/);
  assert.match(migration, /if o\.status = 'paid' and o\.sale_id is not null/);
  assert.match(migration, /update public\.business_stock_reservations set status='consumed'/);
});

test("expired orders release reservations and public cart is scoped to one store", () => {
  assert.match(migration, /create or replace function public\.expire_business_orders/);
  assert.match(migration, /set status='released'/);
  assert.match(cart, /stampa-cart:\$\{store\.slug\}/);
  assert.match(cart, /items: lines\.map\(\(line\) => \(\{ productSlug: line\.product\.slug, quantity: line\.quantity \}\)\)/);
});

test("RLS isolates seller data and service role exclusively owns financial mutations", () => {
  assert.match(migration, /business_orders_select_own[\s\S]*user_id = auth\.uid\(\)/);
  assert.match(migration, /grant select on table public\.business_orders, public\.business_order_items, public\.business_stock_reservations, public\.business_payments to authenticated/);
  assert.match(migration, /grant execute on function public\.process_business_payment[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all) on table public\.business_(?:orders|payments|stock_reservations).*to authenticated/i);
});

test("migration is non-destructive and production payments default off", () => {
  assert.doesNotMatch(migration, /\b(?:drop table|truncate|delete from)\b/i);
  assert.match(read(".env.example"), /BUSINESS_MERCADO_PAGO_ALLOW_LIVE=false/);
  assert.match(read("src/lib/business/server.ts"), /=== "true"/);
});
