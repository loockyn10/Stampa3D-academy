// Notice e-mail + wiring of the price schedules into the existing checkout / billing circuit / cron. No network, no Supabase.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const N = loadTs("src/lib/mercadopago/price-notice.ts");
const Store = loadTs("src/lib/mercadopago/price-schedule-store.ts");

test("notice e-mail states promotional price, accepted later price, exact date and the cancellation option", () => {
  const mail = N.buildPriceChangeNotice({
    promoPrice: 9900,
    postPrice: 19900,
    currency: "ARS",
    changeDate: new Date("2026-07-15T12:00:00.000Z"),
    appUrl: "https://app.example.test",
  });
  assert.match(mail.subject, /15 de julio de 2026/);
  for (const part of ["$9.900", "$19.900", "15 de julio de 2026", "cancelar", "https://app.example.test/configuracion"]) {
    assert.ok(mail.text.includes(part), `text mentions ${part}`);
  }
  assert.ok(mail.html.includes("$19.900"));
  assert.doesNotMatch(mail.html, /<script/i);
});

test("checkout reason (what the payer reads in Mercado Pago) says how long the price lasts and what follows", () => {
  assert.equal(
    N.promoCheckoutReason(9900, { promoCycles: 6, postPrice: 19900 }, "ARS"),
    "Membresía Academia Stampa - $9.900/mes por 6 meses, luego $19.900/mes",
  );
  assert.ok(N.promoCheckoutReason(9900, { promoCycles: 6, postPrice: 19900 }, "ARS").length < 100);
});

function mailer({ email = "buyer@example.test", status = 200, throws = false } = {}) {
  const sent = [];
  const admin = { auth: { admin: { getUserById: async () => ({ data: { user: email ? { email } : null }, error: null }) } } };
  const fetchImpl = async (url, init) => {
    if (throws) throw new Error("network");
    sent.push({ url, init });
    return { ok: status >= 200 && status < 300, status };
  };
  return { sent, mailer: N.createResendPriceNoticeMailer({ admin, apiKey: "key_test", from: "Stampa <no-reply@example.test>", appUrl: null, fetchImpl }) };
}
const notice = { scheduleId: "s1", userId: "u1", promoPrice: 9900, postPrice: 19900, currency: "ARS", changeDate: new Date("2026-07-15T12:00:00Z"), sequence: 1 };

test("resend mailer: sends to the account e-mail with an idempotency key; failures are reported, never thrown", async () => {
  const ok = mailer();
  assert.deepEqual(await ok.mailer.sendPriceChangeNotice(notice), { ok: true });
  const body = JSON.parse(ok.sent[0].init.body);
  assert.deepEqual(body.to, ["buyer@example.test"]);
  assert.equal(ok.sent[0].init.headers["Idempotency-Key"], "price-notice-s1-2026-07-15-1");
  assert.equal(ok.sent[0].init.headers.Authorization, "Bearer key_test");

  assert.deepEqual(await mailer({ status: 500 }).mailer.sendPriceChangeNotice(notice), { ok: false, error: "resend_http_500" });
  assert.equal((await mailer({ email: null }).mailer.sendPriceChangeNotice(notice)).ok, false);
  assert.equal((await mailer({ throws: true }).mailer.sendPriceChangeNotice(notice)).ok, false);
});

test("switches: off unless exactly 'true'; real PUTs also need the schedules switch", () => {
  assert.equal(Store.priceSchedulesEnabled({}), false);
  assert.equal(Store.priceSchedulesEnabled({ PRICE_SCHEDULES_ENABLED: "1" }), false);
  assert.equal(Store.priceSchedulesEnabled({ PRICE_SCHEDULES_ENABLED: "true" }), true);
  assert.equal(Store.priceStepUpEnabled({ PRICE_STEP_UP_ENABLED: "true" }), false, "step-up alone is not enough");
  assert.equal(Store.priceStepUpEnabled({ PRICE_SCHEDULES_ENABLED: "true" }), false);
  assert.equal(Store.priceStepUpEnabled({ PRICE_SCHEDULES_ENABLED: "true", PRICE_STEP_UP_ENABLED: "true" }), true);
});

test("schedule rows map to records and unknown statuses never look active", () => {
  const record = Store.toScheduleRecord({
    id: "s", user_id: "u", mercado_pago_preapproval_id: "p", status: "weird", currency: "ARS", promo_price: "9900.00", post_price: "19900.00",
    promo_cycles: 6, notice_days: 20, notice_lead_days: 30, anchor_at: "2026-01-15T12:00:00Z", promo_ends_at: "2026-07-15T12:00:00Z",
    notice_email_sent_at: null, next_attempt_at: null, attempts: 0, last_snapshot: { reason: "promotion_running" },
  });
  assert.equal(record.status, "failed");
  assert.equal(record.promoPrice, 9900);
  assert.equal(record.postPrice, 19900);
  assert.equal(record.lastReason, "promotion_running");
});

test("the billing circuit calls the schedule hook after payments are recorded, and a store without it still works", () => {
  const sync = readRepoFile("src/lib/mercadopago/membership-sync.ts");
  assert.match(sync, /onBillingSynced\?\.\(/);
  assert.ok(sync.indexOf("recordInvoice") < sync.indexOf("onBillingSynced?.("), "hook runs after the invoices are recorded");
  const store = readRepoFile("src/lib/mercadopago/membership-store.ts");
  assert.match(store, /async onBillingSynced[\s\S]*?if \(!priceSchedulesEnabled\(\)\) return;[\s\S]*?catch/);
});

test("cron: the schedule runner is behind the switch and cannot fail the membership reconciliation", () => {
  const route = readRepoFile("src/app/api/mercadopago/reconcile/route.ts");
  assert.match(route, /createPriceScheduleRunnerDeps\(/);
  assert.match(route, /if \(runnerDeps\) \{\s*try \{[\s\S]*?runPriceSchedules[\s\S]*?\} catch/);
  const server = readRepoFile("src/lib/mercadopago/price-schedule-server.ts");
  assert.match(server, /if \(!priceSchedulesEnabled\(\)\) return null;/);
  assert.match(server, /stepUpEnabled: priceStepUpEnabled\(\)/);
  assert.match(server, /mailer:\s*apiKey && from/);
});

test("checkout: a code with terms needs the schedules on, expresses consent first and never reads a price from the client", () => {
  const route = readRepoFile("src/app/api/mercadopago/create-subscription/route.ts");
  assert.match(route, /getPromoTerms\(supabaseAdmin, code\)/);
  assert.match(route, /if \(!priceSchedulesEnabled\(\)\) \{\s*return response\(\{ code: "promo_unavailable"/, "refused while the machinery is off");
  assert.match(route, /body\.acceptPromoTerms !== promoTerms\.termsVersion[\s\S]*?promo_terms_required/);
  // The acceptance is recorded right after the reservation and before any checkout exists.
  const reserveAt = route.indexOf("reserve: async () =>");
  const executeAt = route.indexOf("executeDiscountedCheckout(checkoutInput");
  const acceptAt = route.indexOf("recordPromoAcceptance(supabaseAdmin");
  assert.ok(executeAt < reserveAt && reserveAt < acceptAt, "recorded inside the reserve step, which runs before the checkout call");
  assert.doesNotMatch(route, /body\.(amount|price|post_price)/);
  assert.doesNotMatch(route, /accept_promo_terms[\s\S]{0,40}(amount|price)/);
});

test("sin-acceso: the later price must be accepted with a checkbox before activating, and the acceptance resets with the code", () => {
  const client = readRepoFile("src/app/sin-acceso/sin-acceso-client.tsx");
  assert.match(client, /const promoBlocked = promo !== null && !promoAccepted;/);
  assert.match(client, /disabled=\{loading \|\| checkingEmail \|\| promoBlocked\}/);
  assert.match(client, /const promoAccepted = appliedCode !== null && promoAcceptedFor === appliedCode;/);
  assert.match(client, /accept_promo_terms: acceptPromoTerms/);
});

test("in-platform notice: membership API returns it behind the switch, and the panel shows it with the cancel option", () => {
  const api = readRepoFile("src/app/api/mercadopago/membership/route.ts");
  assert.match(api, /if \(priceStepUpEnabled\(\)\)[\s\S]*?readPriceNotice[\s\S]*?catch/);
  const panel = readRepoFile("src/components/membership/MembershipPanel.tsx");
  assert.match(panel, /data-testid="price-change-notice"/);
  assert.match(panel, /podés cancelar antes de esa fecha/);
});
