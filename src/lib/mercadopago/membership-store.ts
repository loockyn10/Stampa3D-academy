import type { SupabaseClient } from "@supabase/supabase-js";
import { confirmDiscountReservation, releaseDiscountForPreapproval } from "@/lib/discounts/repository";
import { invoiceStoredStatus, type InvoiceSnapshot, type PreapprovalSnapshot, type ProfileMembership } from "@/lib/mercadopago/membership-billing";
import type { CheckoutAttemptOwner, MembershipStore, StoredSubscription } from "@/lib/mercadopago/membership-sync";
import {
  RECONCILE_DUE_LOOKAHEAD_MS,
  RECONCILE_PENDING_MIN_AGE_MS,
  RECONCILE_PENDING_WINDOW_MS,
  RECONCILE_STALE_AFTER_MS,
  RECONCILE_UNVERIFIED_WINDOW_MS,
  type ReconciliationCandidate,
  type ReconciliationStore,
} from "@/lib/mercadopago/membership-reconcile";

/**
 * Supabase implementation of the membership store. Must be built with the SERVICE ROLE client (server only): the
 * profiles guard (20261104120000) only lets admins and service_role write `membership_*`.
 *
 * Every write is idempotent: subscriptions are keyed by preapproval id, payments by installment id, and the profile
 * uses compare-and-set so concurrent notifications can never shorten a membership.
 */

// `provider_charged_amount` = what the last stored preapproval snapshot reported as collected (money, not proof).
const SUBSCRIPTION_COLUMNS =
  "id, user_id, mercado_pago_preapproval_id, status, started_at, cancelled_at, next_payment_at, amount, currency, created_at, provider_charged_amount:raw_data->summarized->>charged_amount";

interface SubscriptionRow {
  id: string;
  user_id: string;
  mercado_pago_preapproval_id: string | null;
  status: string | null;
  started_at: string | null;
  cancelled_at: string | null;
  next_payment_at: string | null;
  amount: number | string | null;
  currency: string | null;
  created_at?: string | null;
  provider_charged_amount?: number | string | null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toSubscription(row: SubscriptionRow): StoredSubscription {
  const amount = row.amount === null || row.amount === undefined ? null : Number(row.amount);
  return {
    id: row.id,
    userId: row.user_id,
    preapprovalId: row.mercado_pago_preapproval_id,
    status: row.status,
    startedAt: row.started_at,
    cancelledAt: row.cancelled_at,
    nextPaymentAt: row.next_payment_at,
    amount: Number.isFinite(amount) ? amount : null,
    currency: row.currency,
    createdAt: row.created_at ?? null,
    providerChargedAmount: numberOrNull(row.provider_charged_amount),
  };
}

function fail(label: string, error: { message?: string; code?: string } | null): never {
  throw new Error(`${label}: ${error?.code ?? ""} ${error?.message ?? "error desconocido"}`.trim());
}

export class SupabaseMembershipStore implements MembershipStore, ReconciliationStore {
  constructor(private readonly admin: SupabaseClient) {}

  async findSubscriptionByPreapprovalId(preapprovalId: string): Promise<StoredSubscription | null> {
    const { data, error } = await this.admin
      .from("subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .eq("mercado_pago_preapproval_id", preapprovalId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) fail("subscriptions select", error);
    const row = (data ?? [])[0] as SubscriptionRow | undefined;
    return row ? toSubscription(row) : null;
  }

  async findSubscriptionForUser(userId: string, subscriptionId?: string | null): Promise<StoredSubscription | null> {
    let query = this.admin.from("subscriptions").select(SUBSCRIPTION_COLUMNS).eq("user_id", userId);
    if (subscriptionId) query = query.eq("id", subscriptionId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(1);
    if (error) fail("subscriptions select", error);
    const row = (data ?? [])[0] as SubscriptionRow | undefined;
    return row ? toSubscription(row) : null;
  }

  async listSubscriptionsForUser(userId: string, limit: number): Promise<StoredSubscription[]> {
    const { data, error } = await this.admin
      .from("subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.max(1, limit));
    if (error) fail("subscriptions select", error);
    return ((data ?? []) as unknown as SubscriptionRow[]).map(toSubscription);
  }

  async findCheckoutAttemptByExternalReference(externalReference: string): Promise<CheckoutAttemptOwner | null> {
    const { data, error } = await this.admin
      .from("checkout_attempts")
      .select("user_id, mercado_pago_preapproval_id")
      .eq("external_reference", externalReference)
      .maybeSingle();
    if (error) fail("checkout_attempts select", error);
    if (!data) return null;
    return { userId: data.user_id as string, preapprovalId: (data.mercado_pago_preapproval_id as string | null) ?? null };
  }

  async saveSubscription(input: {
    existingId: string | null;
    userId: string;
    preapproval: PreapprovalSnapshot;
    startedAt: string | null;
    cancelledAt: string | null;
    now: Date;
  }): Promise<StoredSubscription> {
    const { preapproval } = input;
    const fields: Record<string, unknown> = {
      status: preapproval.status,
      raw_data: preapproval.raw,
      updated_at: input.now.toISOString(),
      started_at: input.startedAt,
      cancelled_at: input.cancelledAt,
    };
    if (preapproval.payerEmail) fields.payer_email = preapproval.payerEmail;
    if (preapproval.nextPaymentDate) fields.next_payment_at = preapproval.nextPaymentDate;
    if (preapproval.amount !== null) fields.amount = preapproval.amount;
    if (preapproval.currency) fields.currency = preapproval.currency;

    if (input.existingId) {
      // user_id is never rewritten: the row keeps the owner it was created for.
      const { data, error } = await this.admin
        .from("subscriptions")
        .update(fields)
        .eq("id", input.existingId)
        .eq("user_id", input.userId)
        .select(SUBSCRIPTION_COLUMNS)
        .single();
      if (error) fail("subscriptions update", error);
      return toSubscription(data as SubscriptionRow);
    }

    const { data, error } = await this.admin
      .from("subscriptions")
      .insert({
        ...fields,
        user_id: input.userId,
        mercado_pago_preapproval_id: preapproval.id,
        created_at: input.now.toISOString(),
      })
      .select(SUBSCRIPTION_COLUMNS)
      .single();
    if (error?.code === "23505") {
      // Created concurrently (webhook vs. sync): update the winner instead.
      const existing = await this.findSubscriptionByPreapprovalId(preapproval.id);
      if (!existing || existing.userId !== input.userId) fail("subscriptions insert", error);
      return this.saveSubscription({ ...input, existingId: existing.id });
    }
    if (error) fail("subscriptions insert", error);
    return toSubscription(data as SubscriptionRow);
  }

  async recordInvoice(
    input: { userId: string; subscriptionId: string; invoice: InvoiceSnapshot; now: Date },
    retry = true,
  ): Promise<void> {
    const { invoice } = input;
    const fields = {
      user_id: input.userId,
      subscription_id: input.subscriptionId,
      mercado_pago_preapproval_id: invoice.preapprovalId,
      status: invoiceStoredStatus(invoice),
      amount: invoice.amount,
      currency: invoice.currency,
      paid_at: invoice.chargeDate ?? input.now.toISOString(),
      raw_data: invoice.raw,
    };

    // One row per installment (its id is stable across retries). Older rows of the same installment are updated too.
    const { data: existing, error: selectError } = await this.admin
      .from("payments")
      .select("id, user_id")
      .eq("mercado_pago_payment_id", invoice.id);
    if (selectError) fail("payments select", selectError);

    const rows = (existing ?? []) as { id: string; user_id: string }[];
    // The same charge may have been recorded first from its payment (keyed by the payment id): merge into that row
    // instead of adding a second one. Restricted to this subscription.
    if (invoice.paymentId && invoice.paymentId !== invoice.id) {
      const { data: byPayment, error: byPaymentError } = await this.admin
        .from("payments")
        .select("id, user_id")
        .eq("mercado_pago_payment_id", invoice.paymentId)
        .eq("subscription_id", input.subscriptionId);
      if (byPaymentError) fail("payments select", byPaymentError);
      for (const row of (byPayment ?? []) as { id: string; user_id: string }[]) {
        if (!rows.some((known) => known.id === row.id)) rows.push(row);
      }
    }
    if (rows.some((row) => row.user_id !== input.userId)) {
      fail("payments owner", { message: `el cobro ${invoice.id} ya está asociado a otra cuenta` });
    }
    if (rows.length > 0) {
      const { error } = await this.admin
        .from("payments")
        .update(fields)
        .in("id", rows.map((row) => row.id));
      if (error) fail("payments update", error);
      return;
    }

    const { error } = await this.admin
      .from("payments")
      .insert({ ...fields, mercado_pago_payment_id: invoice.id, created_at: input.now.toISOString() });
    // Inserted concurrently by another notification: update that row instead (once).
    if (error?.code === "23505" && retry) return this.recordInvoice(input, false);
    if (error) fail("payments insert", error);
  }

  async listApprovedChargeDates(subscriptionId: string): Promise<string[]> {
    const { data, error } = await this.admin
      .from("payments")
      .select("paid_at")
      .eq("subscription_id", subscriptionId)
      .eq("status", "approved")
      .order("paid_at", { ascending: false })
      .limit(24);
    if (error) fail("payments select", error);
    return ((data ?? []) as { paid_at: string | null }[]).map((row) => row.paid_at).filter((value): value is string => Boolean(value));
  }

  async latestInvoiceStatus(subscriptionId: string): Promise<string | null> {
    const { data, error } = await this.admin
      .from("payments")
      .select("status")
      .eq("subscription_id", subscriptionId)
      .order("paid_at", { ascending: false })
      .limit(1);
    if (error) fail("payments select", error);
    const row = (data ?? [])[0] as { status: string | null } | undefined;
    return row?.status?.toLowerCase() ?? null;
  }

  async getProfileMembership(userId: string): Promise<ProfileMembership | null> {
    const { data, error } = await this.admin
      .from("profiles")
      .select("membership_status, membership_expires_at, membership_started_at")
      .eq("id", userId)
      .maybeSingle();
    if (error) fail("profiles select", error);
    if (!data) return null;
    return {
      membershipStatus: (data.membership_status as string | null) ?? null,
      membershipExpiresAt: (data.membership_expires_at as string | null) ?? null,
      membershipStartedAt: (data.membership_started_at as string | null) ?? null,
    };
  }

  async writeProfileMembership(
    userId: string,
    expected: ProfileMembership,
    fields: { membership_status: "active"; membership_expires_at: string; membership_started_at: string },
  ): Promise<boolean> {
    let query = this.admin.from("profiles").update(fields).eq("id", userId);
    query = expected.membershipStatus === null
      ? query.is("membership_status", null)
      : query.eq("membership_status", expected.membershipStatus);
    query = expected.membershipExpiresAt === null
      ? query.is("membership_expires_at", null)
      : query.eq("membership_expires_at", expected.membershipExpiresAt);
    const { data, error } = await query.select("id");
    if (error) fail("profiles update", error);
    return (data ?? []).length > 0;
  }

  async onSubscriptionAuthorized(input: { userId: string; preapprovalId: string }): Promise<void> {
    try {
      await confirmDiscountReservation(this.admin, input.preapprovalId);
    } catch (error) {
      console.error("[membership] discount confirmation error", error instanceof Error ? error.message : "unknown");
    }

    // Founder slot (legacy, pricing disconnected): confirm a still valid reservation. Never blocks the membership.
    try {
      const { data: pendingFounder } = await this.admin
        .from("founder_members")
        .select("id, reservation_expires_at")
        .eq("user_id", input.userId)
        .eq("status", "reserved")
        .maybeSingle();
      if (pendingFounder) {
        const valid = !pendingFounder.reservation_expires_at || new Date(pendingFounder.reservation_expires_at) > new Date();
        await this.admin
          .from("founder_members")
          .update(
            valid
              ? { status: "active", confirmed_at: new Date().toISOString(), mercado_pago_preapproval_id: input.preapprovalId }
              : { status: "expired" },
          )
          .eq("id", pendingFounder.id)
          .eq("status", "reserved");
      }
    } catch (error) {
      console.error("[membership] founder confirmation error", error instanceof Error ? error.message : "unknown");
    }
  }

  async listReconciliationCandidates(input: { now: Date; limit: number }): Promise<ReconciliationCandidate[]> {
    const nowMs = input.now.getTime();
    const iso = (offset: number) => new Date(nowMs + offset).toISOString();
    const columns =
      "id, user_id, mercado_pago_preapproval_id, status, next_payment_at, updated_at, created_at, provider_charged_amount:raw_data->summarized->>charged_amount";
    const base = () => this.admin.from("subscriptions").select(columns).not("mercado_pago_preapproval_id", "is", null);

    // Small indexed-friendly queries instead of one OR filter; the pure selection dedupes and ranks them.
    const queries = [
      base().eq("status", "authorized").lte("next_payment_at", iso(RECONCILE_DUE_LOOKAHEAD_MS)).order("next_payment_at", { ascending: true }),
      base()
        .eq("status", "pending")
        .gte("created_at", iso(-RECONCILE_PENDING_WINDOW_MS))
        .lte("created_at", iso(-RECONCILE_PENDING_MIN_AGE_MS))
        .order("created_at", { ascending: true }),
      base().in("status", ["authorized", "paused"]).lt("updated_at", iso(-RECONCILE_STALE_AFTER_MS)).order("updated_at", { ascending: true }),
      base().in("status", ["authorized", "paused"]).is("updated_at", null),
      // Recent subscriptions (any status, cancelled included) that may hold a charge without an approved payment.
      base().gte("created_at", iso(-RECONCILE_UNVERIFIED_WINDOW_MS)).order("created_at", { ascending: false }),
    ];

    const rows: ReconciliationCandidate[] = [];
    for (const query of queries) {
      const { data, error } = await query.limit(input.limit);
      if (error) fail("subscriptions select (reconcile)", error);
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        rows.push({
          id: row.id as string,
          userId: row.user_id as string,
          preapprovalId: (row.mercado_pago_preapproval_id as string | null) ?? null,
          status: (row.status as string | null) ?? null,
          nextPaymentAt: (row.next_payment_at as string | null) ?? null,
          updatedAt: (row.updated_at as string | null) ?? null,
          createdAt: (row.created_at as string | null) ?? null,
          providerChargedAmount: numberOrNull(row.provider_charged_amount),
        });
      }
    }

    const ids = [...new Set(rows.map((row) => row.id))];
    if (ids.length > 0) {
      const { data, error } = await this.admin
        .from("payments")
        .select("subscription_id")
        .in("subscription_id", ids)
        .eq("status", "approved");
      if (error) fail("payments select (reconcile)", error);
      const paid = new Set(((data ?? []) as { subscription_id: string | null }[]).map((row) => row.subscription_id));
      for (const row of rows) row.hasApprovedPayment = paid.has(row.id);
    }
    return rows;
  }

  async onSubscriptionCancelled(input: { userId: string; preapprovalId: string }): Promise<void> {
    try {
      await releaseDiscountForPreapproval(this.admin, input.preapprovalId);
    } catch (error) {
      console.error("[membership] discount release error", error instanceof Error ? error.message : "unknown");
    }
  }
}
