import { MembershipSyncError, type MembershipProvider } from "@/lib/mercadopago/membership-sync";
import { normalizePreapprovalStatus } from "@/lib/mercadopago/membership-billing";

const MERCADO_PAGO_API_URL = "https://api.mercadopago.com";
// Mercado Pago waits 22 s for the webhook answer and a notification may need up to 4 calls.
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_SEARCH_PAGES = 6;
const PROVIDER_REASON_MAX_LENGTH = 160;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Mercado Pago's own explanation of a 4xx (`message` / `error` / first `cause`), for the logs. It never contains
 * credentials or payer data; it is trimmed anyway. Incident 2026-11-05: the installment search answered 400 and only
 * the status code was kept, so nobody knew why.
 */
async function providerReason(response: Response): Promise<string | null> {
  try {
    const body = (await response.text()).slice(0, 2000);
    if (!body) return null;
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const cause = Array.isArray(parsed.cause) ? (parsed.cause[0] as Record<string, unknown> | undefined) : undefined;
    const parts = [parsed.error, parsed.message, cause?.code, cause?.description]
      .filter((part) => typeof part === "string" || typeof part === "number")
      .map(String);
    const reason = parts.join(" · ").replace(/\s+/g, " ").trim();
    return reason ? reason.slice(0, PROVIDER_REASON_MAX_LENGTH) : null;
  } catch {
    return null;
  }
}

function classifyHttpError(status: number, resource: string, reason: string | null): MembershipSyncError {
  const suffix = reason ? ` (${reason})` : "";
  if (status === 404) {
    return new MembershipSyncError("provider_not_found", `Mercado Pago no encontró ${resource}.${suffix}`, false);
  }
  // 401/403 means credentials/config: retrying after the fix recovers the event. 408/429/5xx are transient.
  const retryable = status === 401 || status === 403 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  return new MembershipSyncError(`provider_http_${status}`, `Mercado Pago respondió HTTP ${status} para ${resource}.${suffix}`, retryable);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Membership (preapproval) client used by the webhook, sync and cancellation. Read calls + a single cancel PUT. */
export class MercadoPagoMembershipProvider implements MembershipProvider {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private async request(path: string, resource: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${MERCADO_PAGO_API_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      throw new MembershipSyncError(
        "provider_unreachable",
        `No se pudo consultar ${resource} en Mercado Pago: ${error instanceof Error ? error.message : "error de red"}`,
        true,
      );
    }

    if (!response.ok) throw classifyHttpError(response.status, resource, await providerReason(response));

    try {
      return await response.json();
    } catch {
      throw new MembershipSyncError("provider_invalid_json", `Mercado Pago devolvió una respuesta ilegible para ${resource}.`, true);
    }
  }

  getPreapproval(id: string) {
    return this.request(`/preapproval/${encodeURIComponent(id)}`, "la suscripción");
  }

  getInvoice(id: string) {
    return this.request(`/authorized_payments/${encodeURIComponent(id)}`, "el cobro de la suscripción");
  }

  getPayment(id: string) {
    return this.request(`/v1/payments/${encodeURIComponent(id)}`, "el pago");
  }

  /**
   * Installments of a subscription. The first page is requested with the subscription filter ONLY (the documented
   * parameter): the previous request also sent `limit`/`offset` and Mercado Pago answered HTTP 400 for real
   * subscriptions (incident 2026-11-05). Later pages are requested with `offset` only when Mercado Pago reports more
   * results than it returned; a failure there keeps what was already read.
   */
  async searchInvoices(preapprovalId: string): Promise<unknown[]> {
    const results: unknown[] = [];
    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const query = new URLSearchParams({ preapproval_id: preapprovalId });
      if (page > 0) query.set("offset", String(results.length));
      let raw: unknown;
      try {
        raw = await this.request(`/authorized_payments/search?${query}`, "los cobros de la suscripción");
      } catch (error) {
        if (page === 0) throw error;
        break;
      }
      const body = record(raw);
      const pageResults = Array.isArray(body.results) ? body.results : [];
      results.push(...pageResults);
      const total = typeof record(body.paging).total === "number" ? (record(body.paging).total as number) : results.length;
      if (pageResults.length === 0 || results.length >= total) break;
    }
    // The caller also filters by preapproval_id, in case the filter were ignored by the API.
    return results;
  }

  /**
   * Payments carrying the checkout's `external_reference` (independent of the installment search). The caller only
   * accepts the ones linked to the subscription (see parseSubscriptionPayment).
   */
  async searchPayments(externalReference: string): Promise<unknown[]> {
    const query = new URLSearchParams({ external_reference: externalReference, sort: "date_created", criteria: "desc" });
    const raw = await this.request(`/v1/payments/search?${query}`, "los pagos de la suscripción");
    const body = record(raw);
    return Array.isArray(body.results) ? body.results : [];
  }

  async cancelPreapproval(id: string): Promise<string | null> {
    const raw = await this.request(`/preapproval/${encodeURIComponent(id)}`, "la cancelación", {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
    const status = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).status : null;
    return status ? normalizePreapprovalStatus(status) : null;
  }
}
