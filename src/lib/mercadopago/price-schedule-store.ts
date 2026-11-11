import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceScheduleRecord, PriceScheduleStore } from "@/lib/mercadopago/price-schedule-runner";
import { inAppNoticeVisible, type ScheduleStatus } from "@/lib/mercadopago/price-schedule";
import type { ScheduleOverviewRow } from "@/lib/mercadopago/price-schedule-alerts";
import type { PriceAlertStore } from "@/lib/mercadopago/price-schedule-alert-runner";

/** Thin wrappers over the service_role-only price-schedule RPCs (supabase/migrations/20261112120000_price_schedules.sql). */

const STATUSES = new Set<string>(["scheduled", "applied", "needs_review", "needs_reauth", "failed", "void"]);

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function iso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function toScheduleRecord(row: Record<string, unknown>): PriceScheduleRecord {
  const status = String(row.status);
  const snapshot = row.last_snapshot && typeof row.last_snapshot === "object" ? (row.last_snapshot as Record<string, unknown>) : {};
  return {
    id: String(row.id),
    userId: String(row.user_id),
    preapprovalId: String(row.mercado_pago_preapproval_id),
    status: (STATUSES.has(status) ? status : "failed") as ScheduleStatus,
    currency: String(row.currency),
    promoPrice: num(row.promo_price),
    postPrice: num(row.post_price),
    promoCycles: num(row.promo_cycles),
    noticeDays: num(row.notice_days),
    noticeLeadDays: num(row.notice_lead_days),
    anchorAt: iso(row.anchor_at),
    promoEndsAt: iso(row.promo_ends_at),
    noticeEmailSentAt: iso(row.notice_email_sent_at),
    nextAttemptAt: iso(row.next_attempt_at),
    attempts: Number(row.attempts ?? 0),
    lastReason: typeof snapshot.reason === "string" ? snapshot.reason : null,
  };
}

export class SupabasePriceScheduleStore implements PriceScheduleStore, PriceAlertStore {
  constructor(private readonly admin: SupabaseClient) {}

  private async rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.admin.rpc(fn, args);
    if (error) throw Object.assign(new Error(`${fn}: ${error.code ?? "error"}`), { code: error.code ?? "rpc_error" });
    return data as T;
  }

  async listWork(limit: number): Promise<PriceScheduleRecord[]> {
    const rows = await this.rpc<Record<string, unknown>[] | null>("list_price_schedule_work", { p_limit: limit });
    return (rows ?? []).map(toScheduleRecord);
  }

  async claim(id: string, leaseSeconds: number): Promise<PriceScheduleRecord | null> {
    const rows = await this.rpc<Record<string, unknown>[] | null>("claim_price_schedule", { p_id: id, p_lease_seconds: leaseSeconds });
    const row = (rows ?? [])[0];
    return row ? toScheduleRecord(row) : null;
  }

  async finish(
    id: string,
    result: { status: ScheduleStatus; error?: string | null; snapshot?: Record<string, unknown>; retrySeconds?: number | null },
  ): Promise<void> {
    await this.rpc("finish_price_schedule", {
      p_id: id,
      p_status: result.status,
      p_error: result.error ?? null,
      p_snapshot: result.snapshot ?? null,
      p_retry_seconds: result.retrySeconds ?? null,
    });
  }

  async markNoticeSent(id: string): Promise<void> {
    await this.rpc("mark_price_notice_sent", { p_id: id });
  }

  async addEvent(id: string, event: string, detail: Record<string, unknown> = {}): Promise<void> {
    await this.rpc("add_price_schedule_event", { p_id: id, p_event: event, p_detail: detail });
  }

  async overview(): Promise<ScheduleOverviewRow[]> {
    return listScheduleOverview(this.admin);
  }

  async hasEvent(scheduleId: string, event: string): Promise<boolean> {
    return scheduleHasEvent(this.admin, scheduleId, event);
  }

  async sync(preapprovalId: string, providerStatus: string): Promise<void> {
    await this.rpc("sync_price_schedule", { p_preapproval_id: preapprovalId, p_provider_status: providerStatus });
  }

  /** Called by the billing circuit after payments are recorded: create the schedule (once) and sync it. Never throws. */
  async ensureAndSync(preapprovalId: string, providerStatus: string): Promise<void> {
    if (providerStatus === "authorized") await this.rpc("ensure_price_schedule", { p_preapproval_id: preapprovalId });
    await this.rpc("sync_price_schedule", { p_preapproval_id: preapprovalId, p_provider_status: providerStatus });
  }
}

export interface PromoTerms {
  promoCycles: number;
  postPrice: number;
  noticeDays: number;
  termsVersion: string;
}

/** Terms of a discount code, or null when it has none. Throws when the RPC fails (callers fail closed). */
export async function getPromoTerms(admin: SupabaseClient, code: string): Promise<PromoTerms | null> {
  const { data, error } = await admin.rpc("promo_terms_for_code", { p_code: code });
  if (error) throw new Error(`promo_terms_for_code: ${error.code ?? "error"}`);
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (record.has_terms !== true) return null;
  const terms = {
    promoCycles: num(record.promo_cycles),
    postPrice: num(record.post_price),
    noticeDays: num(record.notice_days),
    termsVersion: String(record.terms_version ?? ""),
  };
  if (!(terms.promoCycles >= 1) || !(terms.postPrice > 0) || !terms.termsVersion) return null;
  return terms;
}

export type PromoAcceptanceStatus = "recorded" | "already_recorded" | "not_found" | "not_reservable" | "no_terms" | "terms_mismatch";

export async function recordPromoAcceptance(
  admin: SupabaseClient,
  input: { userId: string; reservationId: string; termsVersion: string | null },
): Promise<PromoAcceptanceStatus> {
  const { data, error } = await admin.rpc("record_promo_acceptance", {
    p_user_id: input.userId,
    p_reservation_id: input.reservationId,
    p_terms_version: input.termsVersion,
  });
  if (error) throw new Error(`record_promo_acceptance: ${error.code ?? "error"}`);
  const status = data && typeof data === "object" ? (data as Record<string, unknown>).status : null;
  const known = ["recorded", "already_recorded", "not_found", "not_reservable", "no_terms", "terms_mismatch"];
  return (typeof status === "string" && known.includes(status) ? status : "not_found") as PromoAcceptanceStatus;
}

/** What the user sees in the platform about the coming price change (null when there is nothing to show). */
export interface PriceNoticeDto {
  promo_price: number;
  post_price: number;
  currency: string;
  /** First debit at the new price. */
  change_date: string;
}

/** In-platform notice: shown from the notice date until the change is applied. Reads only the session user's own schedule. */
export async function readPriceNotice(admin: SupabaseClient, userId: string, now = new Date()): Promise<PriceNoticeDto | null> {
  const { data, error } = await admin
    .from("price_schedules")
    .select("status, currency, promo_price, post_price, promo_ends_at, notice_lead_days")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .not("promo_ends_at", "is", null)
    .order("promo_ends_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`price_schedules select: ${error.code ?? "error"}`);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const promoEndsAt = iso(row.promo_ends_at);
  if (!promoEndsAt || !inAppNoticeVisible({ status: "scheduled", promoEndsAt, noticeLeadDays: num(row.notice_lead_days) }, now)) return null;
  return { promo_price: num(row.promo_price), post_price: num(row.post_price), currency: String(row.currency), change_date: promoEndsAt };
}

/** Feature switches. Both are off unless the server variable is exactly "true". */
export function priceSchedulesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PRICE_SCHEDULES_ENABLED === "true";
}

/** Real PUTs. Requires the schedules switch too, so the amount can never change without the notices running. */
export function priceStepUpEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return priceSchedulesEnabled(env) && env.PRICE_STEP_UP_ENABLED === "true";
}

/** Admin overview (service role): every schedule with what an administrator needs. Never exposes provider payloads. */
export async function listScheduleOverview(admin: SupabaseClient, limit = 500): Promise<ScheduleOverviewRow[]> {
  const { data, error } = await admin
    .from("price_schedules")
    .select("id, user_id, status, promo_price, post_price, promo_ends_at, notice_email_sent_at, attempts, last_error")
    .order("promo_ends_at", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`price_schedules overview: ${error.code ?? "error"}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    status: String(row.status),
    promoPrice: num(row.promo_price),
    postPrice: num(row.post_price),
    promoEndsAt: iso(row.promo_ends_at),
    noticeEmailSentAt: iso(row.notice_email_sent_at),
    attempts: Number(row.attempts ?? 0),
    lastError: text(row.last_error),
  }));
}

export async function scheduleHasEvent(admin: SupabaseClient, scheduleId: string, event: string): Promise<boolean> {
  const { data, error } = await admin.from("price_schedule_events").select("id").eq("schedule_id", scheduleId).eq("event", event).limit(1);
  if (error) throw new Error(`price_schedule_events select: ${error.code ?? "error"}`);
  return (data ?? []).length > 0;
}
