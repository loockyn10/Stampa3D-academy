import type { SupabaseClient } from "@supabase/supabase-js";
import { toDiscountReservation, type DiscountReservation } from "@/lib/discounts/discount-codes";

/** Thin wrappers over the service_role-only discount RPCs (supabase/migrations/20261029120000_discount_code_checkout.sql). */

function record(value: unknown, rpc: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`La RPC ${rpc} devolvió una respuesta inválida`);
  }
  return value as Record<string, unknown>;
}

async function call(client: SupabaseClient, rpc: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc(rpc, args);
  if (error) throw new Error(`${rpc}: ${error.code ?? "error"}`);
  return record(data, rpc);
}

export interface ReserveDiscountInput {
  userId: string;
  code: string;
  baseAmount: number;
  currency: string;
  dryRun?: boolean;
  ttlMinutes?: number;
}

export async function reserveDiscountCode(client: SupabaseClient, input: ReserveDiscountInput): Promise<DiscountReservation> {
  const payload = await call(client, "reserve_discount_code", {
    p_user_id: input.userId,
    p_code: input.code,
    p_base_amount: input.baseAmount,
    p_currency: input.currency,
    p_dry_run: input.dryRun ?? false,
    p_ttl_minutes: input.ttlMinutes ?? 30,
  });
  return toDiscountReservation(payload);
}

export type AttachResult = "attached" | "amount_mismatch" | "not_found" | "not_reservable";

export async function attachDiscountReservation(
  client: SupabaseClient,
  input: { userId: string; reservationId: string; attemptId: string },
): Promise<AttachResult> {
  const payload = await call(client, "attach_discount_reservation", {
    p_user_id: input.userId,
    p_reservation_id: input.reservationId,
    p_attempt_id: input.attemptId,
  });
  const status = payload.status;
  return status === "attached" || status === "amount_mismatch" || status === "not_found" || status === "not_reservable"
    ? status
    : "not_found";
}

export async function releaseDiscountReservation(client: SupabaseClient, input: { userId: string; reservationId: string }): Promise<void> {
  await call(client, "release_discount_reservation", { p_user_id: input.userId, p_reservation_id: input.reservationId });
}

export interface OpenCheckout {
  attemptId: string;
  state: string;
  amount: number;
  preapprovalId: string | null;
  subscriptionStatus: string | null;
}

export async function describeOpenCheckout(client: SupabaseClient, userId: string): Promise<OpenCheckout | null> {
  const payload = await call(client, "describe_open_checkout", { p_user_id: userId });
  if (payload.status !== "open" || typeof payload.attempt_id !== "string" || typeof payload.state !== "string") return null;
  return {
    attemptId: payload.attempt_id,
    state: payload.state,
    amount: Number(payload.amount),
    preapprovalId: typeof payload.preapproval_id === "string" ? payload.preapproval_id : null,
    subscriptionStatus: typeof payload.subscription_status === "string" ? payload.subscription_status : null,
  };
}

export async function closePendingCheckout(client: SupabaseClient, input: { userId: string; attemptId: string }): Promise<boolean> {
  const payload = await call(client, "close_pending_checkout", { p_user_id: input.userId, p_attempt_id: input.attemptId });
  return payload.status === "closed";
}

/** Mercado Pago authorized the preapproval: turns its reservation into a consumed use. Idempotent. */
export async function confirmDiscountReservation(client: SupabaseClient, preapprovalId: string): Promise<string> {
  const payload = await call(client, "confirm_discount_reservation", { p_preapproval_id: preapprovalId });
  return typeof payload.status === "string" ? payload.status : "none";
}

/** The preapproval was cancelled before being authorized: frees the reserved use. */
export async function releaseDiscountForPreapproval(client: SupabaseClient, preapprovalId: string): Promise<void> {
  await call(client, "release_discount_reservation_for_preapproval", { p_preapproval_id: preapprovalId });
}
