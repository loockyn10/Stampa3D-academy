import { verifyMembershipWebhookSignature } from "@/lib/mercadopago/webhook-signature";
import {
  MembershipSyncError,
  processMembershipNotification,
  type MembershipDependencies,
} from "@/lib/mercadopago/membership-sync";

/**
 * HTTP contract of the membership webhook (Mercado Pago expects 200/201 within 22 s, otherwise it retries every
 * 15 minutes and then less often, without a documented end):
 *
 * | Situation                                                    | Answer | Why                                      |
 * |--------------------------------------------------------------|--------|------------------------------------------|
 * | Secret not configured / server misconfigured                 | 503    | retried once the configuration is fixed  |
 * | Missing or invalid signature                                  | 401    | not from Mercado Pago; nothing persisted |
 * | Valid, processed or deliberately ignored (unknown topic, …)  | 200    | done                                     |
 * | Valid, permanent business error (unlinked preapproval, …)    | 200    | a retry cannot fix it; left for review   |
 * | Valid, transient error (Mercado Pago / Supabase unavailable) | 500    | Mercado Pago retries; processing is idempotent |
 */

export interface WebhookEventLog {
  insert(event: { eventType: string | null; action: string | null; dataId: string | null; payload: unknown }): Promise<string | null>;
  finish(id: string, result: { processed: boolean; errorMessage: string | null }): Promise<void>;
}

export interface MembershipWebhookRequest {
  url: string;
  headers: { get(name: string): string | null };
  bodyText: string;
}

export interface MembershipWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function readNotification(request: Pick<MembershipWebhookRequest, "url" | "bodyText">) {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = request.bodyText ? JSON.parse(request.bodyText) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const params = new URL(request.url).searchParams;
  const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : {};
  const queryDataId = text(params.get("data.id"));
  const topic = text(params.get("type")) ?? text(params.get("topic")) ?? text(payload.type) ?? text(payload.topic);
  // Legacy IPN style (`?topic=…&id=…`): there `id` is the resource; in the JSON body `id` is the notification id.
  const dataId = queryDataId ?? text(data.id) ?? (params.get("topic") ? text(params.get("id")) : null);
  return { payload, topic, action: text(payload.action), dataId, signedDataId: queryDataId ?? dataId };
}

export async function handleMembershipWebhook(
  request: MembershipWebhookRequest,
  config: {
    secret: string | undefined | null;
    /** null when Supabase / Mercado Pago credentials are missing. */
    dependencies: (MembershipDependencies & { eventLog: WebhookEventLog }) | null;
    log?: (message: string, details?: Record<string, unknown>) => void;
  },
): Promise<MembershipWebhookResult> {
  const log = config.log ?? (() => undefined);

  if (!config.secret) {
    log("membership webhook rejected: MERCADO_PAGO_WEBHOOK_SECRET is not configured");
    return { status: 503, body: { error: "webhook_not_configured" } };
  }

  const notification = readNotification(request);
  const signed = verifyMembershipWebhookSignature({
    secret: config.secret,
    xSignature: request.headers.get("x-signature"),
    xRequestId: request.headers.get("x-request-id"),
    dataId: notification.signedDataId,
  });
  if (!signed) {
    return { status: 401, body: { error: "invalid_signature" } };
  }

  if (!config.dependencies) {
    log("membership webhook: server configuration incomplete");
    return { status: 503, body: { error: "server_not_configured" } };
  }
  const deps = config.dependencies;

  let eventId: string | null;
  try {
    eventId = await deps.eventLog.insert({
      eventType: notification.topic,
      action: notification.action,
      dataId: notification.dataId,
      payload: notification.payload,
    });
  } catch (error) {
    log("membership webhook: event could not be recorded", { error: error instanceof Error ? error.message : "error" });
    return { status: 500, body: { error: "storage_unavailable", retry: true } };
  }

  const finish = async (processed: boolean, errorMessage: string | null) => {
    if (!eventId) return;
    try {
      await deps.eventLog.finish(eventId, { processed, errorMessage });
    } catch (error) {
      log("membership webhook: event status not saved", { error: error instanceof Error ? error.message : "error" });
    }
  };

  if (!notification.dataId) {
    await finish(true, "ignored: notification without data.id");
    return { status: 200, body: { received: true, ignored: "missing_data_id" } };
  }

  try {
    const outcome = await processMembershipNotification({ topic: notification.topic, dataId: notification.dataId }, deps);
    if (outcome.kind === "ignored") {
      await finish(true, `ignored: ${outcome.reason}`);
      return { status: 200, body: { received: true, ignored: outcome.reason } };
    }
    await finish(true, null);
    return { status: 200, body: { received: true, processed: true } };
  } catch (error) {
    const syncError =
      error instanceof MembershipSyncError
        ? error
        : new MembershipSyncError("unexpected_error", error instanceof Error ? error.message : "error", true);
    log("membership webhook processing error", { code: syncError.code, retryable: syncError.retryable });
    await finish(false, `${syncError.code}: ${syncError.message}`.slice(0, 1000));
    if (syncError.retryable) {
      return { status: 500, body: { error: syncError.code, retry: true } };
    }
    // Permanent: acknowledged so Mercado Pago stops retrying; recorded with processed=false for review.
    return { status: 200, body: { received: true, error: syncError.code } };
  }
}
