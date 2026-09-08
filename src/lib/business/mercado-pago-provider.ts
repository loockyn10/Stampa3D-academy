import "server-only";
import type {
  CreatePaymentCheckoutInput,
  PaymentProvider,
  ProviderCheckout,
  ProviderPayment,
} from "./payment-provider";

const API_URL = "https://api.mercadopago.com";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : typeof value === "number" ? String(value) : null;
}

function checkoutFrom(value: unknown): ProviderCheckout | null {
  const row = record(value);
  const id = stringValue(row.id);
  const initPoint = stringValue(row.init_point);
  const externalReference = stringValue(row.external_reference);
  if (!id || !initPoint || !externalReference) return null;
  return { id, initPoint, sandboxInitPoint: stringValue(row.sandbox_init_point), externalReference, raw: row };
}

export class MercadoPagoMarketplaceProvider implements PaymentProvider {
  readonly name = "mercado_pago" as const;
  constructor(private readonly accessToken: string) {}

  private async request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { Accept: "application/json", Authorization: `Bearer ${this.accessToken}`, ...init?.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const raw = await response.text();
    let body: Record<string, unknown> = {};
    try { body = raw ? record(JSON.parse(raw)) : {}; } catch { body = {}; }
    if (!response.ok) {
      const message = stringValue(body.message) || stringValue(body.error) || `Mercado Pago respondió HTTP ${response.status}`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async createCheckout(input: CreatePaymentCheckoutInput): Promise<ProviderCheckout> {
    const body: Record<string, unknown> = {
      items: input.items.map((item) => ({
        id: item.reference,
        title: item.title,
        currency_id: "ARS",
        quantity: item.quantity,
        unit_price: item.unitPrice,
        ...(item.pictureUrl ? { picture_url: item.pictureUrl } : {}),
      })),
      payer: { email: input.payerEmail },
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      back_urls: { success: input.successUrl, pending: input.pendingUrl, failure: input.failureUrl },
      auto_return: "approved",
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: input.expiresAt,
      statement_descriptor: "STAMPA",
      ...(input.marketplaceFee > 0 ? { marketplace_fee: input.marketplaceFee } : {}),
    };
    const created = checkoutFrom(await this.request("/checkout/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    if (!created) throw new Error("Mercado Pago no devolvió una preferencia utilizable");
    return created;
  }

  async findCheckoutByExternalReference(externalReference: string): Promise<ProviderCheckout | null> {
    const query = new URLSearchParams({ external_reference: externalReference, limit: "20" });
    const response = await this.request(`/checkout/preferences/search?${query.toString()}`);
    const results = Array.isArray(response.elements) ? response.elements : Array.isArray(response.results) ? response.results : [];
    const matches = results.map(checkoutFrom).filter((item): item is ProviderCheckout => item?.externalReference === externalReference);
    if (matches.length > 1) throw new Error("Mercado Pago devolvió múltiples preferencias para el mismo pedido");
    return matches[0] ?? null;
  }

  async getPayment(paymentId: string): Promise<ProviderPayment> {
    const raw = await this.request(`/v1/payments/${encodeURIComponent(paymentId)}`);
    const id = stringValue(raw.id);
    const status = stringValue(raw.status);
    const amount = Number(raw.transaction_amount);
    const refundedAmount = Number(raw.transaction_amount_refunded || 0);
    const currency = stringValue(raw.currency_id);
    if (!id || !status || !Number.isFinite(amount) || !currency) throw new Error("Respuesta de pago incompleta de Mercado Pago");
    const normalizedStatus = status === "approved" && refundedAmount > 0
      ? (refundedAmount >= amount ? "refunded" : "partially_refunded")
      : status;
    return {
      id,
      status: normalizedStatus,
      statusDetail: stringValue(raw.status_detail),
      amount,
      refundedAmount: Number.isFinite(refundedAmount) ? refundedAmount : 0,
      currency,
      externalReference: stringValue(raw.external_reference),
      collectorId: stringValue(raw.collector_id),
      approvedAt: stringValue(raw.date_approved),
      raw,
    };
  }
}
