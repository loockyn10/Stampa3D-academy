import { sameAmount } from "@/lib/mercadopago/discount-checkout";
import { parseInvoice, parsePreapproval } from "@/lib/mercadopago/membership-billing";
import type { MembershipProvider } from "@/lib/mercadopago/membership-sync";
import {
  MAX_STEP_UP_ATTEMPTS,
  decideNotice,
  decideStepUp,
  retryDelaySeconds,
  type InstallmentFacts,
  type PriceScheduleFacts,
  type ProviderFacts,
  type ScheduleStatus,
} from "@/lib/mercadopago/price-schedule";

/**
 * Executes the automatic move from the promotional price to the price the user accepted at purchase.
 * Orchestration only: every rule lives in price-schedule.ts (pure) and every write in the database functions.
 *
 * Safety properties (all covered by tests/price-schedule-runner.test.mjs):
 *   - only schedules (allow-list) are ever visited; nothing else is read or written;
 *   - one runner per schedule at a time (database lease);
 *   - Mercado Pago is read right before deciding; the amount is written ONLY when it is exactly the promotional one;
 *   - the target is the accepted price (`postPrice`) and nothing else;
 *   - after the PUT the preapproval is read again: only an `authorized` subscription at the target amount counts as applied;
 *     if Mercado Pago asks for re-authorization the amount is rolled back and the case is left for the user to act;
 *   - with the step-up switch off the runner only reports what it WOULD do (dry run) and sends the notices.
 */

export interface PriceScheduleRecord extends PriceScheduleFacts {
  id: string;
  userId: string;
  preapprovalId: string;
  attempts: number;
  lastReason: string | null;
}

export interface PriceScheduleStore {
  listWork(limit: number): Promise<PriceScheduleRecord[]>;
  claim(id: string, leaseSeconds: number): Promise<PriceScheduleRecord | null>;
  finish(
    id: string,
    result: { status: ScheduleStatus; error?: string | null; snapshot?: Record<string, unknown>; retrySeconds?: number | null },
  ): Promise<void>;
  markNoticeSent(id: string): Promise<void>;
  addEvent(id: string, event: string, detail?: Record<string, unknown>): Promise<void>;
  /** Re-syncs the schedule with the billing circuit (anchor, reconciliation, cancellation). */
  sync(preapprovalId: string, providerStatus: string): Promise<void>;
}

export interface PriceNoticeMailer {
  sendPriceChangeNotice(input: {
    scheduleId: string;
    userId: string;
    promoPrice: number;
    postPrice: number;
    currency: string;
    changeDate: Date;
    sequence: number;
  }): Promise<{ ok: boolean; error?: string }>;
}

export interface PriceAmountWriter {
  /** The only write: `PUT /preapproval/{id}` with `auto_recurring.{transaction_amount,currency_id}`. */
  updateAmount(
    preapprovalId: string,
    amount: number,
    currency: string,
  ): Promise<{ ok: boolean; httpStatus: number; confirmed: { status: string | null; amount: number | null } | null }>;
}

export interface PriceScheduleRunnerDeps {
  store: PriceScheduleStore;
  provider: Pick<MembershipProvider, "getPreapproval" | "searchInvoices">;
  writer: PriceAmountWriter;
  mailer: PriceNoticeMailer | null;
  /** Real PUTs only with this on. Off = dry run: nothing is written and no customer notice is sent. */
  stepUpEnabled: boolean;
  now?: () => Date;
  log?: (message: string, details?: Record<string, unknown>) => void;
}

export interface PriceScheduleRunReport {
  visited: number;
  busy: number;
  waiting: number;
  noticesSent: number;
  /** Notices that would go out (the switch for the real change is off: no customer is told about a change that will not happen). */
  wouldNotify: number;
  noticeFailures: number;
  applied: number;
  wouldApply: number;
  needsReview: number;
  needsReauth: number;
  failedAttempts: number;
  voided: number;
  errors: number;
  stoppedReason: "completed" | "time_budget";
}

const LEASE_SECONDS = 120;

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : error instanceof Error ? error.name : "error";
}

export async function runPriceSchedules(
  input: { limit?: number; shouldStop?: () => boolean },
  deps: PriceScheduleRunnerDeps,
): Promise<PriceScheduleRunReport> {
  const report: PriceScheduleRunReport = {
    visited: 0,
    busy: 0,
    waiting: 0,
    noticesSent: 0,
    wouldNotify: 0,
    noticeFailures: 0,
    applied: 0,
    wouldApply: 0,
    needsReview: 0,
    needsReauth: 0,
    failedAttempts: 0,
    voided: 0,
    errors: 0,
    stoppedReason: "completed",
  };

  const work = await deps.store.listWork(input.limit ?? 40);
  for (const candidate of work) {
    if (input.shouldStop?.()) {
      report.stoppedReason = "time_budget";
      break;
    }
    const schedule = await deps.store.claim(candidate.id, LEASE_SECONDS);
    if (!schedule) {
      report.busy += 1;
      continue;
    }
    report.visited += 1;
    try {
      await processSchedule(schedule, deps, report);
    } catch (error) {
      report.errors += 1;
      deps.log?.("price schedule: unexpected error", { scheduleId: schedule.id, code: errorCode(error) });
      // Always release the lease and keep the promotional price: a bug here can never raise a price.
      try {
        await deps.store.finish(schedule.id, {
          status: "scheduled",
          error: `unexpected:${errorCode(error)}`,
          retrySeconds: retryDelaySeconds(schedule.attempts + 1),
        });
      } catch {
        // the lease expires by itself
      }
    }
  }
  return report;
}

async function processSchedule(
  schedule: PriceScheduleRecord,
  deps: PriceScheduleRunnerDeps,
  report: PriceScheduleRunReport,
): Promise<void> {
  const now = deps.now ? deps.now() : new Date();
  const { store } = deps;
  const snapshotOf = (extra: Record<string, unknown> = {}) => ({ at: now.toISOString(), ...extra });

  // 1. What Mercado Pago says right now (never a stale local value).
  let provider: ProviderFacts;
  let installments: InstallmentFacts[];
  try {
    const preapproval = parsePreapproval(await deps.provider.getPreapproval(schedule.preapprovalId));
    if (!preapproval || preapproval.id !== schedule.preapprovalId) throw new Error("invalid_provider_response");
    provider = {
      status: preapproval.status,
      amount: preapproval.amount,
      currency: preapproval.currency,
      nextPaymentDate: preapproval.nextPaymentDate,
    };
    installments = (await deps.provider.searchInvoices(schedule.preapprovalId)).flatMap((raw) => {
      const invoice = parseInvoice(raw);
      return invoice && invoice.preapprovalId === schedule.preapprovalId
        ? [{ status: invoice.status, debitDate: invoice.chargeDate }]
        : [];
    });
  } catch (error) {
    await store.finish(schedule.id, {
      status: "scheduled",
      error: `provider_read:${errorCode(error)}`,
      retrySeconds: retryDelaySeconds(1),
    });
    report.errors += 1;
    return;
  }

  const final = decideStepUp({ schedule, provider, installments, now });

  // 2. Notice by e-mail. Never to a cancelled / paused subscription, to one that needs review, or one already repriced.
  //    The change itself is never applied in the same pass that sends the notice: it waits for the next run.
  const mayNotify = final.kind === "wait" || final.kind === "notify" || final.kind === "apply";
  const noticeWanted = mayNotify && provider.status === "authorized" && (final.kind === "notify" || decideNotice(schedule, now).send);
  if (noticeWanted && !deps.stepUpEnabled) {
    // A notice is a promise that the price changes: it is only sent when the change itself is enabled.
    if (schedule.lastReason !== "dry_run_would_notify") await store.addEvent(schedule.id, "dry_run", { would: "send_notice" });
    await store.finish(schedule.id, { status: "scheduled", snapshot: snapshotOf({ reason: "dry_run_would_notify", provider_amount: provider.amount, next_payment_date: provider.nextPaymentDate }) });
    report.wouldNotify += 1;
    return;
  }
  if (noticeWanted) {
    if (await sendNotice(schedule, deps, report, now)) {
      await store.addEvent(schedule.id, "waiting", { reason: "notice_sent" });
      await store.finish(schedule.id, {
        status: "scheduled",
        snapshot: snapshotOf({ reason: "notice_sent", provider_amount: provider.amount, next_payment_date: provider.nextPaymentDate }),
      });
      report.waiting += 1;
      return;
    }
  }

  // 3. Act on the decision. A notice that could not be sent keeps the price as it is.
  switch (final.kind) {
    case "void": {
      await store.sync(schedule.preapprovalId, "cancelled");
      report.voided += 1;
      return;
    }
    case "skip":
      await store.finish(schedule.id, { status: "scheduled", snapshot: snapshotOf({ reason: final.reason }) });
      return;
    case "wait":
    case "notify": {
      const reason = final.kind === "wait" ? final.reason : "notice_not_sent";
      if (schedule.lastReason !== reason) await store.addEvent(schedule.id, "waiting", { reason });
      await store.finish(schedule.id, {
        status: "scheduled",
        snapshot: snapshotOf({ reason, provider_amount: provider.amount, next_payment_date: provider.nextPaymentDate }),
      });
      report.waiting += 1;
      return;
    }
    case "mark_applied": {
      await store.addEvent(schedule.id, "applied", { how: "already_at_post_price", amount: provider.amount });
      await store.finish(schedule.id, { status: "applied", snapshot: snapshotOf({ amount: provider.amount }) });
      report.applied += 1;
      return;
    }
    case "review": {
      await store.addEvent(schedule.id, "needs_review", { reason: final.reason, provider_amount: provider.amount });
      await store.finish(schedule.id, {
        status: "needs_review",
        error: final.reason,
        snapshot: snapshotOf({ reason: final.reason, provider_amount: provider.amount }),
      });
      report.needsReview += 1;
      return;
    }
    case "apply":
      await applyChange(schedule, final.targetAmount, provider, deps, report, snapshotOf);
      return;
  }
}

async function sendNotice(
  schedule: PriceScheduleRecord,
  deps: PriceScheduleRunnerDeps,
  report: PriceScheduleRunReport,
  now: Date,
): Promise<boolean> {
  if (!deps.mailer) {
    if (schedule.lastReason !== "notice_mailer_missing") await deps.store.addEvent(schedule.id, "waiting", { reason: "notice_mailer_missing" });
    report.noticeFailures += 1;
    return false;
  }
  try {
    const result = await deps.mailer.sendPriceChangeNotice({
      scheduleId: schedule.id,
      userId: schedule.userId,
      promoPrice: schedule.promoPrice,
      postPrice: schedule.postPrice,
      currency: schedule.currency,
      changeDate: new Date(schedule.promoEndsAt as string),
      sequence: 1,
    });
    if (!result.ok) {
      await deps.store.addEvent(schedule.id, "notice_email_failed", { error: (result.error ?? "unknown").slice(0, 120) });
      report.noticeFailures += 1;
      return false;
    }
    await deps.store.markNoticeSent(schedule.id);
    report.noticesSent += 1;
    return true;
  } catch (error) {
    await deps.store.addEvent(schedule.id, "notice_email_failed", { error: errorCode(error), at: now.toISOString() });
    report.noticeFailures += 1;
    return false;
  }
}

async function applyChange(
  schedule: PriceScheduleRecord,
  target: number,
  provider: ProviderFacts,
  deps: PriceScheduleRunnerDeps,
  report: PriceScheduleRunReport,
  snapshotOf: (extra?: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const { store, writer } = deps;

  // Defence in depth: the target is the accepted price and it can never exceed it.
  if (!(target > 0) || target > schedule.postPrice + 0.005) {
    await store.finish(schedule.id, { status: "needs_review", error: "target_above_accepted", snapshot: snapshotOf() });
    report.needsReview += 1;
    return;
  }

  if (!deps.stepUpEnabled) {
    if (schedule.lastReason !== "dry_run_would_apply") {
      await store.addEvent(schedule.id, "dry_run", { would_set: target, current: provider.amount, next_payment_date: provider.nextPaymentDate });
    }
    await store.finish(schedule.id, { status: "scheduled", snapshot: snapshotOf({ reason: "dry_run_would_apply", would_set: target }) });
    report.wouldApply += 1;
    return;
  }

  await store.addEvent(schedule.id, "put_attempt", { from: provider.amount, to: target, next_payment_date: provider.nextPaymentDate });
  const failAttempt = async (error: string, extra: Record<string, unknown> = {}) => {
    const attemptNumber = schedule.attempts + 1;
    const exhausted = attemptNumber >= MAX_STEP_UP_ATTEMPTS;
    await store.addEvent(schedule.id, "put_failed", { error, attempt: attemptNumber, ...extra });
    await store.finish(schedule.id, {
      status: exhausted ? "failed" : "scheduled",
      error,
      snapshot: snapshotOf({ reason: error, ...extra }),
      retrySeconds: exhausted ? null : retryDelaySeconds(attemptNumber),
    });
    report.failedAttempts += 1;
  };

  let result: Awaited<ReturnType<PriceAmountWriter["updateAmount"]>>;
  try {
    result = await writer.updateAmount(schedule.preapprovalId, target, schedule.currency);
  } catch (error) {
    await failAttempt(`put_error:${errorCode(error)}`);
    return;
  }

  if (!result.ok) {
    await failAttempt(`put_http_${result.httpStatus}`, { http_status: result.httpStatus });
    return;
  }

  const confirmed = result.confirmed;
  const confirmedStatus = String(confirmed?.status ?? "").toLowerCase();

  if (confirmed && confirmed.amount !== null && sameAmount(confirmed.amount, target) && confirmedStatus === "authorized") {
    await store.addEvent(schedule.id, "applied", { from: provider.amount, to: confirmed.amount, how: "put" });
    await store.finish(schedule.id, { status: "applied", snapshot: snapshotOf({ amount: confirmed.amount, status: confirmedStatus }) });
    await store.sync(schedule.preapprovalId, confirmedStatus);
    report.applied += 1;
    return;
  }

  if (confirmedStatus !== "authorized" && confirmedStatus !== "") {
    // Mercado Pago accepted the new amount but wants the payer to authorize again (status left `authorized`). Charges could
    // stop: put the promotional amount back, and leave the case for the action the customer has to take.
    let rolledBack = false;
    try {
      const back = await writer.updateAmount(schedule.preapprovalId, schedule.promoPrice, schedule.currency);
      rolledBack = back.ok;
    } catch {
      rolledBack = false;
    }
    await store.addEvent(schedule.id, "needs_reauth", { provider_status: confirmedStatus, rolled_back: rolledBack });
    await store.finish(schedule.id, {
      status: "needs_reauth",
      error: "reauthorization_required",
      snapshot: snapshotOf({ provider_status: confirmedStatus, rolled_back: rolledBack }),
    });
    report.needsReauth += 1;
    return;
  }

  await failAttempt("put_unexpected_response", { confirmed_amount: confirmed?.amount ?? null, confirmed_status: confirmedStatus || null });
}
