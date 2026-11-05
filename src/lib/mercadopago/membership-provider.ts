import { MembershipSyncError, type MembershipProvider } from "@/lib/mercadopago/membership-sync";
import { normalizePreapprovalStatus } from "@/lib/mercadopago/membership-billing";

const MERCADO_PAGO_API_URL = "https://api.mercadopago.com";
// Mercado Pago waits 22 s for the webhook answer and a notification may need up to 3 calls.
const REQUEST_TIMEOUT_MS = 6_000;
const SEARCH_PAGE_SIZE = 50;
const MAX_SEARCH_PAGES = 6;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function classifyHttpError(status: number, resource: string): MembershipSyncError {
  if (status === 404) {
    return new MembershipSyncError("provider_not_found", `Mercado Pago no encontró ${resource}.`, false);
  }
  // 401/403 means credentials/config: retrying after the fix recovers the event. 408/429/5xx are transient.
  const retryable = status === 401 || status === 403 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  return new MembershipSyncError(`provider_http_${status}`, `Mercado Pago respondió HTTP ${status} para ${resource}.`, retryable);
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

    if (!response.ok) throw classifyHttpError(response.status, resource);

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

  async searchInvoices(preapprovalId: string): Promise<unknown[]> {
    const results: unknown[] = [];
    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const query = new URLSearchParams({
        preapproval_id: preapprovalId,
        limit: String(SEARCH_PAGE_SIZE),
        offset: String(page * SEARCH_PAGE_SIZE),
      });
      const raw = await this.request(`/authorized_payments/search?${query}`, "los cobros de la suscripción");
      const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
      const pageResults = Array.isArray(record.results) ? record.results : [];
      results.push(...pageResults);
      const paging = typeof record.paging === "object" && record.paging !== null ? (record.paging as Record<string, unknown>) : {};
      const total = typeof paging.total === "number" ? paging.total : results.length;
      if (pageResults.length < SEARCH_PAGE_SIZE || results.length >= total) break;
    }
    // The caller also filters by preapproval_id, in case the filter were ignored by the API.
    return results;
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
