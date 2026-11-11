// Alerts so that validating the price change never stays pending, admin terms validation and the admin wiring.
// Everything runs against fakes: no Mercado Pago, no Supabase.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const A = loadTs("src/lib/mercadopago/price-schedule-alerts.ts");
const { runPriceScheduleAlerts } = loadTs("src/lib/mercadopago/price-schedule-alert-runner.ts");
const { validatePromoTerms } = loadTs("src/lib/mercadopago/promo-terms.ts");

const NOW = new Date("2026-11-12T12:00:00.000Z");
const inDays = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();
const row = (overrides = {}) => ({
  id: "s1", userId: "u1", status: "scheduled", promoPrice: 9900, postPrice: 19900, promoEndsAt: inDays(170),
  noticeEmailSentAt: null, attempts: 0, lastError: null, ...overrides,
});
const alertFor = (days, stepUpEnabled = false, extra = []) =>
  A.computeValidationAlert({ stepUpEnabled, schedules: [row({ promoEndsAt: inDays(days) }), ...extra], now: NOW });

test("validation alert: silent far from the end, then far / mid / near / urgent as the first promotion approaches", () => {
  assert.equal(alertFor(170).level, "none");
  assert.equal(alertFor(120).level, "far");
  assert.equal(alertFor(75).level, "mid");
  assert.equal(alertFor(45).level, "near");
  assert.equal(alertFor(28).level, "urgent");
  assert.equal(alertFor(1).level, "urgent");
  assert.equal(alertFor(-3).level, "overdue");
  assert.match(alertFor(-3).message, /NO está habilitado/);
  assert.match(alertFor(40).message, /20 días de anticipación/);
});

test("validation alert: counts down to the FIRST schedule to reach the regular price and attaches to it", () => {
  const later = row({ id: "s2", promoEndsAt: inDays(160) });
  const earlier = row({ id: "s3", promoEndsAt: inDays(60) });
  const alert = A.computeValidationAlert({ stepUpEnabled: false, schedules: [later, earlier], now: NOW });
  assert.equal(alert.scheduleId, "s3");
  assert.equal(alert.level, "mid");
  assert.equal(alert.activeSchedules, 2);
});

test("validation alert: no alert once the change is enabled, with no schedules, or only closed ones", () => {
  assert.equal(alertFor(10, true).level, "none");
  assert.equal(A.computeValidationAlert({ stepUpEnabled: false, schedules: [], now: NOW }).level, "none");
  assert.equal(
    A.computeValidationAlert({ stepUpEnabled: false, schedules: [row({ status: "applied", promoEndsAt: inDays(5) }), row({ id: "x", status: "void", promoEndsAt: inDays(5) })], now: NOW }).level,
    "none",
  );
  // A schedule still waiting for its first charge has no calendar yet.
  assert.equal(A.computeValidationAlert({ stepUpEnabled: false, schedules: [row({ promoEndsAt: null })], now: NOW }).level, "none");
});

test("event names are snake_case (the database only accepts [a-z_]{3,40}) and attention cases are recognised", () => {
  for (const level of ["far", "mid", "near", "urgent", "overdue"]) assert.match(A.alertEventName(level), /^[a-z_]{3,40}$/);
  assert.equal(A.alertEventName("none"), null);
  for (const status of ["needs_review", "needs_reauth", "failed"]) assert.match(A.attentionEventName({ status }), /^[a-z_]{3,40}$/);
  const attention = A.attentionSchedules([row(), row({ id: "a", status: "needs_reauth" }), row({ id: "b", status: "failed" }), row({ id: "c", status: "applied" })]);
  assert.deepEqual(attention.map((r) => r.id), ["a", "b"]);
});

function fakeAlertDeps({ schedules, mailer, stepUpEnabled = false }) {
  const events = new Set();
  const added = [];
  const logs = [];
  return {
    events,
    added,
    logs,
    deps: {
      store: {
        async overview() { return schedules; },
        async hasEvent(id, event) { return events.has(`${id}:${event}`); },
        async addEvent(id, event, detail) { events.add(`${id}:${event}`); added.push({ id, event, detail }); },
      },
      mailer,
      stepUpEnabled,
      now: () => NOW,
      log: (message, details) => logs.push({ message, details }),
    },
  };
}

test("alert runner: e-mails each level ONCE and keeps logging from 'near' on", async () => {
  const sent = [];
  const mailer = { async send(message) { sent.push(message); return { ok: true }; } };
  const fake = fakeAlertDeps({ schedules: [row({ promoEndsAt: inDays(40) })], mailer });
  const first = await runPriceScheduleAlerts(fake.deps);
  assert.equal(first.alert.level, "near");
  assert.equal(first.emailsSent, 1);
  assert.match(sent[0].subject, /faltan 40 días/);
  const second = await runPriceScheduleAlerts(fake.deps);
  assert.equal(second.emailsSent, 0, "the same level is not mailed twice");
  assert.equal(sent.length, 1);
  assert.ok(fake.logs.filter((l) => l.message.startsWith("ALERTA")).length === 2, "but it is logged on every run");
  // The next level is a new e-mail.
  const urgent = fakeAlertDeps({ schedules: [row({ promoEndsAt: inDays(20) })], mailer });
  urgent.events.add("s1:validation_alert_near");
  assert.equal((await runPriceScheduleAlerts(urgent.deps)).emailsSent, 1);
});

test("alert runner: without an e-mail provider nothing is marked as sent (it is retried when configured) and it is flagged", async () => {
  const fake = fakeAlertDeps({ schedules: [row({ promoEndsAt: inDays(20) })], mailer: null });
  const report = await runPriceScheduleAlerts(fake.deps);
  assert.equal(report.mailerMissing, true);
  assert.equal(fake.added.length, 0);
});

test("alert runner: a failing provider is reported, not thrown, and not marked as sent", async () => {
  const fake = fakeAlertDeps({ schedules: [row({ promoEndsAt: inDays(20) })], mailer: { send: async () => ({ ok: false, error: "resend_http_500" }) } });
  const report = await runPriceScheduleAlerts(fake.deps);
  assert.equal(report.errors, 1);
  assert.equal(fake.added.length, 0);
  const throwing = fakeAlertDeps({ schedules: [row({ promoEndsAt: inDays(20) })], mailer: { send: async () => { throw new Error("boom"); } } });
  assert.equal((await runPriceScheduleAlerts(throwing.deps)).errors, 1);
});

test("alert runner: schedules that need a person are mailed once each, and nothing is sent while all is well", async () => {
  const sent = [];
  const mailer = { async send(message) { sent.push(message); return { ok: true }; } };
  const fake = fakeAlertDeps({ schedules: [row({ promoEndsAt: inDays(170) }), row({ id: "r", status: "needs_reauth", lastError: "reauthorization_required" })], mailer });
  const report = await runPriceScheduleAlerts(fake.deps);
  assert.equal(report.attention, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /autorice de nuevo|autorice/i);
  await runPriceScheduleAlerts(fake.deps);
  assert.equal(sent.length, 1);

  const quiet = fakeAlertDeps({ schedules: [row({ promoEndsAt: inDays(170) })], mailer });
  assert.equal((await runPriceScheduleAlerts(quiet.deps)).emailsSent, 0);
});

test("promo terms: the later price must be higher, periods 1-24, notice 7-60 days; the version identifies what is accepted", () => {
  const today = new Date("2026-11-12T10:00:00Z");
  const ok = validatePromoTerms({ promoCycles: 6, postPrice: 19900 }, { promoPrice: 9900, today });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.terms, { promoCycles: 6, postPrice: 19900, noticeDays: 20, noticeLeadDays: 30, termsVersion: "20261112-6x9900-then19900" });
  assert.equal(validatePromoTerms({ promoCycles: 6, postPrice: 9900 }, { promoPrice: 9900 }).ok, false, "not a later price");
  assert.equal(validatePromoTerms({ promoCycles: 6, postPrice: 5000 }, { promoPrice: 9900 }).ok, false);
  for (const cycles of [0, 25, 1.5, "x", null]) assert.equal(validatePromoTerms({ promoCycles: cycles, postPrice: 19900 }, { promoPrice: 9900 }).ok, false, String(cycles));
  assert.equal(validatePromoTerms({ promoCycles: 6, postPrice: 19900, noticeDays: 3 }, { promoPrice: 9900 }).ok, false);
  assert.equal(validatePromoTerms({ promoCycles: 6, postPrice: 19900, noticeDays: 90 }, { promoPrice: 9900 }).ok, false);
  assert.equal(validatePromoTerms({ promoCycles: 6, postPrice: 19900, noticeDays: 45 }, { promoPrice: 9900 }).terms.noticeLeadDays, 55);
  assert.equal(validatePromoTerms({ promoCycles: 6, postPrice: 19900 }, { promoPrice: 0 }).ok, false);
});

test("admin: terms are saved by a server route (admin only, service role); a code with terms is created inactive and activated afterwards", () => {
  const route = readRepoFile("src/app/api/admin/promo-terms/route.ts");
  assert.match(route, /profile\.role !== "admin"/);
  assert.match(route, /Forbidden/);
  assert.match(route, /code\.code_type !== "fixed_price"/);
  assert.match(route, /cannot change once users accepted/);
  const page = readRepoFile("src/app/admin/codigos/page.tsx");
  assert.match(page, /payload\.status = wantsPromo \? "inactive" : "active"/);
  const saveAt = page.indexOf('fetch("/api/admin/promo-terms", {');
  const activateAt = page.indexOf('.update({ status: "active" }).eq("id", savedId)');
  assert.ok(saveAt > 0 && activateAt > saveAt, "activated only after the terms were saved");
  assert.match(page, /El código quedó INACTIVO hasta que se guarden/);
  assert.match(page, /data-testid="promo-terms-form"/);
});

test("customer notices only exist while the real change is enabled (runner, banner) and the admin sees the state", () => {
  const api = readRepoFile("src/app/api/mercadopago/membership/route.ts");
  assert.match(api, /if \(priceStepUpEnabled\(\)\) \{[\s\S]*?readPriceNotice/);
  const adminApi = readRepoFile("src/app/api/admin/price-schedules/route.ts");
  assert.match(adminApi, /profile\.role !== "admin"/);
  assert.match(adminApi, /computeValidationAlert/);
  assert.doesNotMatch(adminApi, /raw_data|last_snapshot/, "no provider payloads leave the server");
  const adminIndex = readRepoFile("src/app/admin/page.tsx");
  assert.match(adminIndex, /<PriceScheduleAlertBanner \/>/);
  const cron = readRepoFile("src/app/api/mercadopago/reconcile/route.ts");
  assert.match(cron, /createPriceAlertDeps\(deps\.admin\)[\s\S]*?runPriceScheduleAlerts[\s\S]*?catch/);
});
