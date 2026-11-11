// Pure rules of the promotional price schedule (Pioneros: 9.900 x 6 billing periods, then 19.900). No I/O.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const S = loadTs("src/lib/mercadopago/price-schedule.ts");

const d = (iso) => new Date(iso);
const iso = (date) => date.toISOString();

function schedule(overrides = {}) {
  const anchorAt = "2026-01-15T12:00:00.000Z";
  return {
    status: "scheduled",
    currency: "ARS",
    promoPrice: 9900,
    postPrice: 19900,
    promoCycles: 6,
    noticeDays: 20,
    noticeLeadDays: 30,
    anchorAt,
    promoEndsAt: iso(S.addMonthsFromAnchor(d(anchorAt), 6)), // 2026-07-15
    noticeEmailSentAt: null,
    nextAttemptAt: null,
    ...overrides,
  };
}

const authorized = (overrides = {}) => ({ status: "authorized", amount: 9900, currency: "ARS", nextPaymentDate: "2026-07-15T12:00:00.000Z", ...overrides });
const settled = [
  { status: "processed", debitDate: "2026-01-15T12:00:00.000Z" },
  { status: "processed", debitDate: "2026-02-15T12:00:00.000Z" },
  { status: "processed", debitDate: "2026-03-15T12:00:00.000Z" },
  { status: "processed", debitDate: "2026-04-15T12:00:00.000Z" },
  { status: "processed", debitDate: "2026-05-15T12:00:00.000Z" },
  { status: "processed", debitDate: "2026-06-15T12:00:00.000Z" },
];
const decide = (input) => S.decideStepUp({ schedule: schedule(), provider: authorized(), installments: settled, now: d("2026-06-20T12:00:00.000Z"), ...input });

test("the promotion is 6 monthly billing periods counted from the anchor, never by chaining months", () => {
  const cal = S.promoCalendar(d("2026-01-31T10:00:00.000Z"), 6);
  assert.deepEqual(cal.periodStarts.map(iso), [
    "2026-01-31T10:00:00.000Z",
    "2026-02-28T10:00:00.000Z",
    "2026-03-31T10:00:00.000Z", // chaining would give 28
    "2026-04-30T10:00:00.000Z",
    "2026-05-31T10:00:00.000Z",
    "2026-06-30T10:00:00.000Z",
  ]);
  assert.equal(iso(cal.promoEndsAt), "2026-07-31T10:00:00.000Z");
  assert.equal(iso(S.promoCalendar(d("2026-08-31T10:00:00.000Z"), 6).promoEndsAt), "2027-02-28T10:00:00.000Z");
});

test("the calendar depends only on the anchor: payments (approved or rejected) cannot move it", () => {
  const a = S.promoCalendar(d("2026-01-15T12:00:00.000Z"), 6);
  const b = S.promoCalendar(d("2026-01-15T12:00:00.000Z"), 6);
  assert.equal(iso(a.promoEndsAt), iso(b.promoEndsAt));
  // The schedule facts carry no payment information at all.
  assert.equal(Object.keys(schedule()).some((key) => /payment|paid|cycles_paid|approved/i.test(key)), false);
});

test("billingPeriodAt maps dates to periods; 7 starts at the end of the promotion", () => {
  const anchor = d("2026-01-15T12:00:00.000Z");
  assert.equal(S.billingPeriodAt(anchor, d("2026-01-15T12:00:00.000Z")), 1);
  assert.equal(S.billingPeriodAt(anchor, d("2026-06-15T12:00:00.000Z")), 6);
  assert.equal(S.billingPeriodAt(anchor, d("2026-07-15T12:00:00.000Z")), 7);
  assert.equal(S.billingPeriodAt(anchor, d("2026-07-15T03:00:00.000Z")), 7, "a debit a few hours early still belongs to period 7");
  assert.equal(S.billingPeriodAt(anchor, d("2026-07-14T12:00:00.000Z")), 6);
});

test("notice: sufficient only with at least noticeDays before the debit", () => {
  const debit = "2026-07-15T12:00:00.000Z";
  assert.equal(S.noticeIsSufficient("2026-06-25T12:00:00.000Z", debit, 20), true); // exactly 20 days
  assert.equal(S.noticeIsSufficient("2026-06-25T12:00:01.000Z", debit, 20), false);
  assert.equal(S.noticeIsSufficient(null, debit, 20), false);
  assert.equal(S.noticeIsSufficient("2026-06-01T00:00:00.000Z", null, 20), false);
});

test("decideNotice: sent from 30 days before the end of the promotion, once, and never after the change", () => {
  const s = schedule();
  assert.equal(S.decideNotice(s, d("2026-06-14T12:00:00.000Z")).send, false); // 31 days before
  assert.equal(S.decideNotice(s, d("2026-06-15T12:00:00.000Z")).send, true); // 30 days before
  assert.equal(S.decideNotice(schedule({ noticeEmailSentAt: "2026-06-15T12:30:00.000Z" }), d("2026-06-20T12:00:00.000Z")).send, false);
  assert.equal(S.decideNotice(s, d("2026-07-15T12:00:00.000Z")).send, false);
  assert.equal(S.decideNotice(s, d("2026-06-26T12:00:00.000Z")).send, false, "less than 20 days left: cannot give enough lead for this debit");
  assert.equal(S.decideNotice(s, d("2026-06-25T12:00:00.000Z")).send, true, "exactly 20 days left");
  assert.equal(S.decideNotice(schedule({ status: "applied" }), d("2026-06-20T12:00:00.000Z")).send, false);
  assert.equal(S.decideNotice(schedule({ anchorAt: null, promoEndsAt: null }), d("2026-06-20T12:00:00.000Z")).send, false);
});

test("in-app notice is visible from the notice date until the change is applied", () => {
  const s = schedule();
  assert.equal(S.inAppNoticeVisible(s, d("2026-06-10T00:00:00.000Z")), false);
  assert.equal(S.inAppNoticeVisible(s, d("2026-06-16T00:00:00.000Z")), true);
  assert.equal(S.inAppNoticeVisible(schedule({ status: "applied" }), d("2026-08-01T00:00:00.000Z")), false);
  assert.equal(S.inAppNoticeVisible(schedule({ status: "void" }), d("2026-06-16T00:00:00.000Z")), false);
});

test("step-up: nothing happens while Mercado Pago's next debit is still a promotional period", () => {
  const out = decide({ provider: authorized({ nextPaymentDate: "2026-05-15T12:00:00.000Z" }), now: d("2026-05-01T12:00:00.000Z") });
  assert.deepEqual(out, { kind: "wait", reason: "promotion_running" });
});

test("step-up: waits while any installment of the promotional periods is scheduled or being retried", () => {
  const installments = [...settled.slice(0, 5), { status: "recycling", debitDate: "2026-06-15T12:00:00.000Z" }];
  assert.deepEqual(decide({ installments }), { kind: "wait", reason: "period_in_progress" });
  const scheduledInstallments = [...settled.slice(0, 5), { status: "scheduled", debitDate: "2026-06-15T12:00:00.000Z" }];
  assert.deepEqual(decide({ installments: scheduledInstallments }), { kind: "wait", reason: "period_in_progress" });
});

test("step-up: a rejected period 6 does not extend the promotion; once it is settled the change is applied", () => {
  // The installment of period 6 ended 'processed' with a rejected payment: it is settled, the calendar did not move.
  const out = decide({ installments: settled, schedule: schedule({ noticeEmailSentAt: "2026-06-16T00:00:00.000Z" }) });
  assert.deepEqual(out, { kind: "apply", targetAmount: 19900 });
});

test("step-up: needs a notice with enough lead time; otherwise sends it or waits one period", () => {
  assert.deepEqual(decide({}), { kind: "notify" }); // 25 days before the debit: a fresh notice still gives 20+
  const late = decide({ now: d("2026-07-01T12:00:00.000Z") }); // 14 days before the debit
  assert.deepEqual(late, { kind: "wait", reason: "notice_window_missed" });
  // Notice sent but too late for this debit (only 10 days) is not enough either.
  const short = decide({ schedule: schedule({ noticeEmailSentAt: "2026-07-05T12:00:00.000Z" }), now: d("2026-07-06T12:00:00.000Z") });
  assert.deepEqual(short, { kind: "wait", reason: "notice_window_missed" });
});

test("step-up: never changes the amount within 48 h of the debit", () => {
  const out = decide({
    schedule: schedule({ noticeEmailSentAt: "2026-06-16T00:00:00.000Z" }),
    now: d("2026-07-14T00:00:00.000Z"), // 36 h before
  });
  assert.deepEqual(out, { kind: "wait", reason: "window_missed" });
});

test("step-up: applies exactly the accepted post price, with notice, once period 6 is settled", () => {
  const out = decide({ schedule: schedule({ noticeEmailSentAt: "2026-06-20T00:00:00.000Z" }) });
  assert.deepEqual(out, { kind: "apply", targetAmount: 19900 });
});

test("step-up: a different amount in Mercado Pago (manual change) is never touched", () => {
  assert.deepEqual(decide({ provider: authorized({ amount: 250 }) }), { kind: "review", reason: "special_amount" });
  assert.deepEqual(decide({ provider: authorized({ amount: 14900 }) }), { kind: "review", reason: "special_amount" });
  assert.deepEqual(decide({ provider: authorized({ currency: "USD" }) }), { kind: "review", reason: "currency_differs" });
});

test("step-up: already at the accepted post price is marked applied without writing", () => {
  assert.deepEqual(decide({ provider: authorized({ amount: 19900 }) }), { kind: "mark_applied", reason: "already_at_post_price" });
});

test("step-up: cancelled -> void; paused / pending / unreadable -> wait; terminal and manual states are skipped", () => {
  assert.deepEqual(decide({ provider: authorized({ status: "cancelled" }) }), { kind: "void", reason: "provider_cancelled" });
  assert.deepEqual(decide({ provider: authorized({ status: "paused" }) }), { kind: "wait", reason: "provider_not_authorized" });
  assert.deepEqual(decide({ provider: authorized({ status: "pending" }) }), { kind: "wait", reason: "provider_not_authorized" });
  assert.deepEqual(decide({ provider: authorized({ amount: null }) }), { kind: "wait", reason: "provider_not_authorized" });
  assert.deepEqual(decide({ provider: authorized({ nextPaymentDate: null }) }), { kind: "wait", reason: "next_debit_unknown" });
  assert.deepEqual(decide({ schedule: schedule({ status: "applied" }) }), { kind: "skip", reason: "terminal" });
  assert.deepEqual(decide({ schedule: schedule({ status: "void" }) }), { kind: "skip", reason: "terminal" });
  for (const status of ["needs_review", "needs_reauth", "failed"]) {
    assert.deepEqual(decide({ schedule: schedule({ status }) }), { kind: "skip", reason: "manual_review" });
  }
  assert.deepEqual(decide({ schedule: schedule({ anchorAt: null, promoEndsAt: null }) }), { kind: "wait", reason: "no_anchor" });
});

test("step-up: respects the retry backoff", () => {
  const out = decide({
    schedule: schedule({ noticeEmailSentAt: "2026-06-20T00:00:00.000Z", nextAttemptAt: "2026-06-20T18:00:00.000Z" }),
  });
  assert.deepEqual(out, { kind: "wait", reason: "backoff" });
});

test("property: whatever the inputs, an 'apply' decision never targets more than the accepted post price", () => {
  const statuses = ["authorized", "paused", "pending", "cancelled", "weird"];
  const amounts = [null, 0, 250, 9900, 14900, 19900, 24900];
  const nexts = [null, "2026-05-15T12:00:00.000Z", "2026-07-15T12:00:00.000Z", "2026-08-15T12:00:00.000Z"];
  const notices = [null, "2026-06-16T00:00:00.000Z", "2026-07-10T00:00:00.000Z"];
  const nows = ["2026-06-20T12:00:00.000Z", "2026-07-14T12:00:00.000Z", "2026-07-16T12:00:00.000Z"];
  const posts = [19900, 15000];
  let applies = 0;
  for (const status of statuses) for (const amount of amounts) for (const next of nexts) for (const notice of notices) for (const now of nows) for (const postPrice of posts) {
    const out = S.decideStepUp({
      schedule: schedule({ postPrice, noticeEmailSentAt: notice }),
      provider: { status, amount, currency: "ARS", nextPaymentDate: next },
      installments: settled,
      now: d(now),
    });
    if (out.kind === "apply") {
      applies += 1;
      assert.equal(out.targetAmount, postPrice);
      assert.equal(status, "authorized");
      assert.equal(amount, 9900);
      assert.ok(S.noticeIsSufficient(notice, next, 20));
      assert.ok(new Date(next).getTime() - new Date(now).getTime() >= 48 * 3600 * 1000);
    }
  }
  assert.ok(applies > 0, "the property must exercise at least one apply");
});

test("retry delays grow 1 h, 6 h, 24 h", () => {
  assert.equal(S.retryDelaySeconds(1), 3600);
  assert.equal(S.retryDelaySeconds(2), 6 * 3600);
  assert.equal(S.retryDelaySeconds(3), 24 * 3600);
  assert.equal(S.retryDelaySeconds(9), 24 * 3600);
});
