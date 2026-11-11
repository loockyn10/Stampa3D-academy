// Runner of the automatic price change (Pioneros). Everything runs against fakes: no Mercado Pago, no Supabase, no real
// subscription is read or changed.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { runPriceSchedules } = loadTs("src/lib/mercadopago/price-schedule-runner.ts");

const PRE = "pre_pioneer_1";
const NOW = new Date("2026-06-20T12:00:00.000Z"); // 25 days before the 7th debit (2026-07-15)

const record = (overrides = {}) => ({
  id: "sched_1",
  userId: "user_1",
  preapprovalId: PRE,
  status: "scheduled",
  currency: "ARS",
  promoPrice: 9900,
  postPrice: 19900,
  promoCycles: 6,
  noticeDays: 20,
  noticeLeadDays: 30,
  anchorAt: "2026-01-15T12:00:00.000Z",
  promoEndsAt: "2026-07-15T12:00:00.000Z",
  noticeEmailSentAt: "2026-06-16T00:00:00.000Z",
  nextAttemptAt: null,
  attempts: 0,
  lastReason: null,
  ...overrides,
});

const rawPreapproval = (overrides = {}) => ({
  id: PRE,
  status: "authorized",
  next_payment_date: "2026-07-15T12:00:00.000Z",
  auto_recurring: { transaction_amount: 9900, currency_id: "ARS", frequency: 1, frequency_type: "months" },
  ...overrides,
});
const rawInvoice = (n, status = "processed") => ({
  id: `inv_${n}`,
  preapproval_id: PRE,
  status,
  debit_date: `2026-0${n}-15T12:00:00.000Z`,
  transaction_amount: 9900,
  currency_id: "ARS",
});
const settled = [1, 2, 3, 4, 5, 6].map((n) => rawInvoice(n));

const stripLease = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "leased"));

/** In-memory store with the same semantics as the database functions (atomic lease, terminal states). */
function fakeStore(initial) {
  const rows = new Map(initial.map((r) => [r.id, { ...r, leased: false }]));
  const events = [];
  const finishes = [];
  const syncs = [];
  return {
    rows,
    events,
    finishes,
    syncs,
    store: {
      async listWork() {
        return [...rows.values()].filter((r) => r.status === "scheduled" && !r.leased).map((r) => stripLease(r));
      },
      async claim(id) {
        const r = rows.get(id);
        if (!r || r.status !== "scheduled" || r.leased) return null;
        r.leased = true;
        return stripLease(r);
      },
      async finish(id, result) {
        const r = rows.get(id);
        finishes.push({ id, ...result });
        if (!r || r.status !== "scheduled") return;
        r.leased = false;
        r.status = result.status;
        if (result.error) r.attempts += 1;
        r.lastReason = result.snapshot?.reason ?? r.lastReason;
        r.nextAttemptAt = result.retrySeconds ? new Date(NOW.getTime() + result.retrySeconds * 1000).toISOString() : null;
      },
      async markNoticeSent(id) {
        rows.get(id).noticeEmailSentAt = NOW.toISOString();
        events.push({ id, event: "notice_email_sent" });
      },
      async addEvent(id, event, detail) {
        events.push({ id, event, detail });
      },
      async sync(preapprovalId, status) {
        syncs.push({ preapprovalId, status });
        if (status === "cancelled") for (const r of rows.values()) if (r.preapprovalId === preapprovalId && r.status === "scheduled") r.status = "void";
      },
    },
  };
}

function setup({ schedules = [record()], preapproval = rawPreapproval(), invoices = settled, writer, mailer, stepUpEnabled = true, getPreapproval, searchInvoices } = {}) {
  const fake = fakeStore(schedules);
  const calls = { reads: [], writes: [], mails: [] };
  const defaultWriter = {
    async updateAmount(id, amount, currency) {
      calls.writes.push({ id, amount, currency });
      return { ok: true, httpStatus: 200, confirmed: { status: "authorized", amount } };
    },
  };
  const deps = {
    store: fake.store,
    provider: {
      async getPreapproval(id) {
        calls.reads.push(id);
        if (getPreapproval) return getPreapproval(id);
        return preapproval;
      },
      async searchInvoices(id) {
        if (searchInvoices) return searchInvoices(id);
        return invoices;
      },
    },
    writer: writer ? { updateAmount: async (...a) => (calls.writes.push({ id: a[0], amount: a[1], currency: a[2] }), writer(...a)) } : defaultWriter,
    mailer:
      mailer === null
        ? null
        : {
            async sendPriceChangeNotice(input) {
              calls.mails.push(input);
              return mailer ? mailer(input) : { ok: true };
            },
          },
    stepUpEnabled,
    now: () => NOW,
  };
  return { fake, calls, deps, run: (extra = {}) => runPriceSchedules(extra, deps) };
}

test("applies exactly the accepted post price once period 6 is settled and the notice was sent; the second run does nothing", async () => {
  const { fake, calls, run } = setup();
  const first = await run();
  assert.deepEqual(calls.writes, [{ id: PRE, amount: 19900, currency: "ARS" }]);
  assert.equal(first.applied, 1);
  assert.equal(fake.rows.get("sched_1").status, "applied");
  const second = await run();
  assert.equal(second.visited, 0);
  assert.equal(calls.writes.length, 1, "no second PUT");
});

test("dry run (step-up switch off): reports what it would do, writes nothing", async () => {
  const { fake, calls, run } = setup({ stepUpEnabled: false });
  const report = await run();
  assert.equal(calls.writes.length, 0);
  assert.equal(report.wouldApply, 1);
  assert.equal(fake.rows.get("sched_1").status, "scheduled");
  assert.ok(fake.events.some((e) => e.event === "dry_run" && e.detail.would_set === 19900));
});

test("without a notice it sends the e-mail first and does NOT change the price in the same pass", async () => {
  const { fake, calls, run } = setup({ schedules: [record({ noticeEmailSentAt: null })] });
  const first = await run();
  assert.equal(calls.mails.length, 1);
  assert.equal(calls.mails[0].postPrice, 19900);
  assert.equal(calls.mails[0].promoPrice, 9900);
  assert.equal(new Date(calls.mails[0].changeDate).toISOString(), "2026-07-15T12:00:00.000Z");
  assert.equal(first.noticesSent, 1);
  assert.equal(calls.writes.length, 0);
  assert.ok(fake.rows.get("sched_1").noticeEmailSentAt);
  // Next run (notice on file, 25 days ahead): applies.
  await run();
  assert.equal(calls.writes.length, 1);
});

test("no mailer configured / the e-mail fails: the price is never raised", async () => {
  const none = setup({ schedules: [record({ noticeEmailSentAt: null })], mailer: null });
  await none.run();
  assert.equal(none.calls.writes.length, 0);
  assert.ok(none.fake.events.some((e) => e.detail?.reason === "notice_mailer_missing"));

  const failing = setup({ schedules: [record({ noticeEmailSentAt: null })], mailer: () => ({ ok: false, error: "resend_500" }) });
  const report = await failing.run();
  assert.equal(failing.calls.writes.length, 0);
  assert.equal(report.noticeFailures, 1);
  assert.equal(failing.fake.rows.get("sched_1").noticeEmailSentAt, null);

  const throwing = setup({ schedules: [record({ noticeEmailSentAt: null })], mailer: () => { throw new Error("boom"); } });
  await throwing.run();
  assert.equal(throwing.calls.writes.length, 0);
});

test("notice too late for this debit: no PUT, the next period stays promotional", async () => {
  const late = setup({ schedules: [record({ noticeEmailSentAt: null })], mailer: undefined });
  // 14 days before the debit
  late.deps.now = () => new Date("2026-07-01T12:00:00.000Z");
  const report = await runPriceSchedules({}, late.deps);
  assert.equal(late.calls.writes.length, 0);
  assert.equal(late.calls.mails.length, 0, "a notice that cannot give 20 days is not sent for this debit");
  assert.equal(report.waiting, 1);
});

test("a period still being retried (installment 'recycling') blocks the change", async () => {
  const { calls, run } = setup({ invoices: [...settled.slice(0, 5), rawInvoice(6, "recycling")] });
  await run();
  assert.equal(calls.writes.length, 0);
});

test("a special amount in Mercado Pago (e.g. 250 or changed by hand) is never touched and goes to review", async () => {
  for (const amount of [250, 14900, 24900]) {
    const { fake, calls, run } = setup({ preapproval: rawPreapproval({ auto_recurring: { transaction_amount: amount, currency_id: "ARS" } }) });
    const report = await run();
    assert.equal(calls.writes.length, 0, `amount ${amount}`);
    assert.equal(report.needsReview, 1);
    assert.equal(fake.rows.get("sched_1").status, "needs_review");
    assert.equal((await run()).visited, 0, "needs_review is not retried automatically");
  }
});

test("already at the post price: marked applied without any PUT", async () => {
  const { fake, calls, run } = setup({ preapproval: rawPreapproval({ auto_recurring: { transaction_amount: 19900, currency_id: "ARS" } }) });
  await run();
  assert.equal(calls.writes.length, 0);
  assert.equal(fake.rows.get("sched_1").status, "applied");
});

test("cancelled in Mercado Pago: the schedule is voided, nothing is written or e-mailed", async () => {
  const { fake, calls, run } = setup({ schedules: [record({ noticeEmailSentAt: null })], preapproval: rawPreapproval({ status: "cancelled" }) });
  const report = await run();
  assert.equal(report.voided, 1);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.mails.length, 0);
  assert.equal(fake.rows.get("sched_1").status, "void");
});

test("paused or pending subscriptions are neither e-mailed nor repriced", async () => {
  for (const status of ["paused", "pending"]) {
    const { calls, run } = setup({ schedules: [record({ noticeEmailSentAt: null })], preapproval: rawPreapproval({ status }) });
    await run();
    assert.equal(calls.writes.length, 0);
    assert.equal(calls.mails.length, 0);
  }
});

test("while the next debit is still promotional nothing is written", async () => {
  const { calls, run } = setup({ preapproval: rawPreapproval({ next_payment_date: "2026-06-15T12:00:00.000Z" }) });
  await run();
  assert.equal(calls.writes.length, 0);
});

test("Mercado Pago unreadable: no write, retry scheduled, no exception", async () => {
  const { fake, calls, run } = setup({ getPreapproval: () => { throw Object.assign(new Error("down"), { code: "provider_http_500" }); } });
  const report = await run();
  assert.equal(calls.writes.length, 0);
  assert.equal(report.errors, 1);
  const row = fake.rows.get("sched_1");
  assert.equal(row.status, "scheduled");
  assert.ok(row.nextAttemptAt);
});

test("PUT rejected: attempt counted with backoff; after the maximum attempts it is 'failed'; never retried inside the same run", async () => {
  const { fake, calls, run } = setup({ writer: async () => ({ ok: false, httpStatus: 500, confirmed: null }) });
  const first = await run();
  assert.equal(calls.writes.length, 1);
  assert.equal(first.failedAttempts, 1);
  assert.equal(fake.rows.get("sched_1").status, "scheduled");
  assert.equal(fake.rows.get("sched_1").attempts, 1);
  const last = setup({ schedules: [record({ attempts: 5 })], writer: async () => ({ ok: false, httpStatus: 500, confirmed: null }) });
  await last.run();
  assert.equal(last.fake.rows.get("sched_1").status, "failed");
});

test("PUT throws: counted as a failed attempt, the price is not marked applied", async () => {
  const { fake, run } = setup({ writer: async () => { throw new Error("network"); } });
  await run();
  assert.equal(fake.rows.get("sched_1").status, "scheduled");
  assert.equal(fake.rows.get("sched_1").attempts, 1);
});

test("Mercado Pago answers OK but not with the requested amount: not applied", async () => {
  const { fake, run } = setup({ writer: async () => ({ ok: true, httpStatus: 200, confirmed: { status: "authorized", amount: 9900 } }) });
  await run();
  assert.equal(fake.rows.get("sched_1").status, "scheduled");
  assert.equal(fake.rows.get("sched_1").attempts, 1);
});

test("Mercado Pago asks the payer to authorize again: amount rolled back to the promotional one, left for the customer's action", async () => {
  const { fake, calls, run } = setup({
    writer: async (id, amount) => ({ ok: true, httpStatus: 200, confirmed: { status: amount === 19900 ? "pending" : "authorized", amount } }),
  });
  const report = await run();
  assert.deepEqual(calls.writes.map((w) => w.amount), [19900, 9900], "the second write restores the promotional amount");
  assert.equal(report.needsReauth, 1);
  assert.equal(fake.rows.get("sched_1").status, "needs_reauth");
  const event = fake.events.find((e) => e.event === "needs_reauth");
  assert.equal(event.detail.rolled_back, true);
  assert.equal((await run()).visited, 0);
});

test("two runners at the same time: exactly one PUT (database lease)", async () => {
  const a = setup();
  const b = { ...a.deps };
  const results = await Promise.all([runPriceSchedules({}, a.deps), runPriceSchedules({}, b)]);
  assert.equal(a.calls.writes.length, 1);
  assert.equal(results.reduce((n, r) => n + r.visited, 0), 1);
});

test("only schedules are visited: Mercado Pago is never asked about any other subscription", async () => {
  const { calls, run } = setup({ schedules: [record(), record({ id: "sched_2", preapprovalId: "pre_other", userId: "user_2" })], getPreapproval: (id) => ({ ...rawPreapproval(), id }) , searchInvoices: (id) => settled.map((i) => ({ ...i, preapproval_id: id })) });
  await run();
  assert.deepEqual([...new Set(calls.reads)].sort(), [PRE, "pre_other"].sort());
  assert.deepEqual(calls.writes.map((w) => w.id).sort(), [PRE, "pre_other"].sort());
});

test("invoices of another preapproval are ignored when deciding", async () => {
  const foreignOpen = { ...rawInvoice(6, "recycling"), preapproval_id: "someone_else" };
  const { calls, run } = setup({ invoices: [...settled.slice(0, 5), foreignOpen, rawInvoice(6)] });
  await run();
  assert.equal(calls.writes.length, 1);
});

test("an unexpected error in one schedule releases it with the price untouched and the run continues", async () => {
  const { fake, calls, run } = setup({
    schedules: [record(), record({ id: "sched_2", preapprovalId: "pre_2", userId: "user_2" })],
    getPreapproval: (id) => (id === PRE ? { status: "authorized", id: PRE, next_payment_date: {}, auto_recurring: null } : { ...rawPreapproval(), id }),
    searchInvoices: (id) => settled.map((i) => ({ ...i, preapproval_id: id })),
  });
  const report = await run();
  assert.equal(report.visited, 2);
  assert.ok(!calls.writes.some((w) => w.id === PRE));
  assert.equal(fake.rows.get("sched_1").status, "scheduled");
});

test("time budget: stops cleanly before the next schedule", async () => {
  const { calls, run } = setup({ schedules: [record(), record({ id: "sched_2", preapprovalId: "pre_2" })] });
  let n = 0;
  const report = await run({ shouldStop: () => ++n > 1 });
  assert.equal(report.stoppedReason, "time_budget");
  assert.ok(calls.writes.length <= 1);
});
