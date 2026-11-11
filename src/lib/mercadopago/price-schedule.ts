import { addPeriod } from "@/lib/mercadopago/membership-billing";
import { sameAmount } from "@/lib/mercadopago/discount-checkout";

/**
 * Price schedule of a promotional subscription (e.g. Pioneros: 9.900 for 6 monthly billing periods, then 19.900).
 * Pure rules, no I/O. See docs/PROMOCIONES_AUTOMATIZADAS_DISENO.md.
 *
 * THE PROMOTION IS MEASURED IN BILLING PERIODS OF THE CALENDAR, NOT IN APPROVED PAYMENTS.
 *   - `anchorAt` is the debit date of the first installment Mercado Pago generated (fixed once, never moved).
 *   - Period k starts at `anchorAt + (k-1) months`; the promotion covers periods 1..promoCycles and ends at
 *     `promoEndsAt = anchorAt + promoCycles months` (computed from the anchor, never by chaining months).
 *   - A rejected / pending / retried charge never moves any of those dates: it can neither extend nor shorten the promotion.
 *   - Approved payments are only used to reconcile (how many promotional periods were actually paid).
 *
 * THE PRICE NEVER GOES ABOVE WHAT THE USER ACCEPTED: the target of a change is `postPrice`, stored at acceptance.
 * Any doubt (unreadable data, special amount, missing notice, too close to the debit) leaves the promotional price in force.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Debit dates are compared with this tolerance (Mercado Pago debits during the day, not at an exact instant). */
export const PERIOD_TOLERANCE_MS = 12 * 60 * 60 * 1000;
/** The amount is never changed this close to a debit (the installment may already be in flight). */
export const STEP_UP_MIN_MARGIN_MS = 48 * 60 * 60 * 1000;

export type ScheduleStatus = "scheduled" | "applied" | "needs_review" | "needs_reauth" | "failed" | "void";

export interface PriceScheduleFacts {
  status: ScheduleStatus;
  currency: string;
  promoPrice: number;
  postPrice: number;
  promoCycles: number;
  /** Minimum days between the notice e-mail and the first debit at the new price. */
  noticeDays: number;
  /** The notice is sent this many days before the end of the promotion. */
  noticeLeadDays: number;
  anchorAt: string | null;
  promoEndsAt: string | null;
  noticeEmailSentAt: string | null;
  nextAttemptAt: string | null;
}

export interface ProviderFacts {
  status: string;
  amount: number | null;
  currency: string | null;
  nextPaymentDate: string | null;
}

export interface InstallmentFacts {
  /** Installment status: scheduled / processed / recycling / cancelled. */
  status: string | null;
  debitDate: string | null;
}

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/** `anchor + months`, always counted from the anchor (Jan 31 + 1 month = Feb 28, + 2 months = Mar 31). */
export function addMonthsFromAnchor(anchor: Date, months: number): Date {
  return addPeriod(anchor, months, "months");
}

export function promoCalendar(anchorAt: Date, promoCycles: number): { periodStarts: Date[]; promoEndsAt: Date } {
  const cycles = Math.max(0, Math.floor(promoCycles));
  const periodStarts = Array.from({ length: cycles }, (_, index) => addMonthsFromAnchor(anchorAt, index));
  return { periodStarts, promoEndsAt: addMonthsFromAnchor(anchorAt, cycles) };
}

/** 1-based billing period a date belongs to (1 before/at the anchor). Periods beyond the promotion keep counting. */
export function billingPeriodAt(anchorAt: Date, date: Date, tolerance = PERIOD_TOLERANCE_MS): number {
  let period = 1;
  while (addMonthsFromAnchor(anchorAt, period).getTime() <= date.getTime() + tolerance && period < 1200) period += 1;
  return period;
}

/** Whether a debit date is still inside the promotional periods. */
export function isDebitInsidePromotion(schedule: Pick<PriceScheduleFacts, "promoEndsAt">, debitDate: string | null): boolean {
  const end = ms(schedule.promoEndsAt);
  const debit = ms(debitDate);
  if (end === null || debit === null) return false;
  return debit < end - PERIOD_TOLERANCE_MS;
}

/** The notice (sent at `sentAt`) gave enough warning for a debit on `debitDate`. */
export function noticeIsSufficient(sentAt: string | null, debitDate: string | null, noticeDays: number): boolean {
  const sent = ms(sentAt);
  const debit = ms(debitDate);
  if (sent === null || debit === null) return false;
  return debit - sent >= noticeDays * DAY_MS;
}

/** When the notice e-mail becomes due: `noticeLeadDays` before the end of the promotion. */
export function noticeDueAt(schedule: Pick<PriceScheduleFacts, "promoEndsAt" | "noticeLeadDays">): Date | null {
  const end = ms(schedule.promoEndsAt);
  return end === null ? null : new Date(end - schedule.noticeLeadDays * DAY_MS);
}

/** The in-platform notice is shown from the moment the notice is due until the change is applied (or the schedule ends). */
export function inAppNoticeVisible(schedule: Pick<PriceScheduleFacts, "status" | "promoEndsAt" | "noticeLeadDays">, now: Date): boolean {
  if (schedule.status === "void") return false;
  const due = noticeDueAt(schedule);
  return due !== null && now.getTime() >= due.getTime() && schedule.status !== "applied";
}

export type StepUpDecision =
  | { kind: "skip"; reason: "terminal" | "manual_review" }
  | { kind: "void"; reason: "provider_cancelled" }
  | { kind: "mark_applied"; reason: "already_at_post_price" }
  | { kind: "review"; reason: "currency_differs" | "special_amount" }
  | {
      kind: "wait";
      reason:
        | "no_anchor"
        | "provider_not_authorized"
        | "promotion_running"
        | "next_debit_unknown"
        | "period_in_progress"
        | "window_missed"
        | "notice_window_missed"
        | "backoff";
    }
  | { kind: "notify" }
  | { kind: "apply"; targetAmount: number };

export interface StepUpInput {
  schedule: PriceScheduleFacts;
  provider: ProviderFacts;
  installments: readonly InstallmentFacts[];
  now: Date;
}

/**
 * What to do with a schedule right now, given what Mercado Pago says RIGHT NOW. The target amount is always the amount
 * accepted at purchase (`postPrice`); there is no other source for it.
 */
export function decideStepUp(input: StepUpInput): StepUpDecision {
  const { schedule, provider, installments, now } = input;
  const nowMs = now.getTime();

  if (schedule.status === "applied" || schedule.status === "void") return { kind: "skip", reason: "terminal" };
  if (schedule.status !== "scheduled") return { kind: "skip", reason: "manual_review" };

  if (provider.status === "cancelled") return { kind: "void", reason: "provider_cancelled" };
  if (!schedule.anchorAt || !schedule.promoEndsAt) return { kind: "wait", reason: "no_anchor" };
  if (provider.status !== "authorized") return { kind: "wait", reason: "provider_not_authorized" };

  if (provider.currency && provider.currency.toUpperCase() !== schedule.currency.toUpperCase()) {
    return { kind: "review", reason: "currency_differs" };
  }
  if (provider.amount === null) return { kind: "wait", reason: "provider_not_authorized" };
  if (sameAmount(provider.amount, schedule.postPrice)) return { kind: "mark_applied", reason: "already_at_post_price" };
  // Anything that is not exactly the promotional price (changed by hand in Mercado Pago, another amount) is not ours.
  if (!sameAmount(provider.amount, schedule.promoPrice)) return { kind: "review", reason: "special_amount" };

  const promoEnd = ms(schedule.promoEndsAt) as number;
  const next = ms(provider.nextPaymentDate);
  if (next === null) return { kind: "wait", reason: "next_debit_unknown" };

  // The next debit is still a promotional period: nothing to do yet (notices are sent by calendar, see decideNotice).
  if (next < promoEnd - PERIOD_TOLERANCE_MS) return { kind: "wait", reason: "promotion_running" };

  // Every installment of the promotional periods must be settled (processed / cancelled). One still scheduled or being
  // retried could be charged at the NEW amount if we changed it now.
  const open = installments.some((installment) => {
    const status = (installment.status ?? "").toLowerCase();
    return isDebitInsidePromotion(schedule, installment.debitDate) && (status === "scheduled" || status === "recycling");
  });
  if (open) return { kind: "wait", reason: "period_in_progress" };

  if (next - nowMs < STEP_UP_MIN_MARGIN_MS) return { kind: "wait", reason: "window_missed" };

  if (!noticeIsSufficient(schedule.noticeEmailSentAt, provider.nextPaymentDate, schedule.noticeDays)) {
    // A fresh notice can still reach the user in time for THIS debit; otherwise the change waits a period
    // (the user pays one more promotional period: always on the safe side).
    return next - nowMs >= schedule.noticeDays * DAY_MS ? { kind: "notify" } : { kind: "wait", reason: "notice_window_missed" };
  }

  const retryAt = ms(schedule.nextAttemptAt);
  if (retryAt !== null && retryAt > nowMs) return { kind: "wait", reason: "backoff" };

  return { kind: "apply", targetAmount: schedule.postPrice };
}

/** Whether the notice e-mail should go out now (independent of Mercado Pago: purely calendar). */
export function decideNotice(schedule: PriceScheduleFacts, now: Date): { send: boolean } {
  if (schedule.status !== "scheduled" || !schedule.promoEndsAt) return { send: false };
  const due = noticeDueAt(schedule);
  const end = ms(schedule.promoEndsAt) as number;
  if (!due || now.getTime() < due.getTime()) return { send: false };
  if (now.getTime() >= end) return { send: false };
  // Too late to give `noticeDays` of warning for the first debit at the new price: it is not sent for that debit. If the
  // change slips a period, decideStepUp asks for a fresh notice ("notify") that does give enough lead time.
  if (end - now.getTime() < schedule.noticeDays * DAY_MS) return { send: false };
  // The promotion's own debit date is the one the notice talks about.
  return { send: !noticeIsSufficient(schedule.noticeEmailSentAt, schedule.promoEndsAt, schedule.noticeDays) };
}

/** Exponential backoff for retries of a failed change: 1 h, 6 h, 24 h, then 24 h. */
export function retryDelaySeconds(attempts: number): number {
  const steps = [3600, 6 * 3600, 24 * 3600];
  return steps[Math.min(Math.max(attempts, 1), steps.length) - 1];
}

export const MAX_STEP_UP_ATTEMPTS = 6;
