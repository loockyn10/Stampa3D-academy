import {
  CheckoutProviderError,
  type PreapprovalProvider,
  type ProviderPreapproval,
} from "@/lib/mercadopago/checkout-flow";

const MERCADO_PAGO_API_URL = "https://api.mercadopago.com";
const REQUEST_TIMEOUT_MS = 12_000;
const SEARCH_PAGE_SIZE = 20;
const MAX_SEARCH_PAGES = 100;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function isDefiniteProviderRejection(status: number): boolean {
  if (status < 400 || status >= 500) {
    return false;
  }

  // Timeout, conflict and throttling responses can be ambiguous at a network
  // boundary. They must be reconciled instead of immediately re-created.
  return ![408, 409, 425, 429].includes(status);
}

function toPreapproval(raw: Record<string, unknown>): ProviderPreapproval | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const initPoint =
    typeof raw.init_point === "string"
      ? raw.init_point
      : typeof raw.sandbox_init_point === "string"
        ? raw.sandbox_init_point
        : null;

  if (!id || !initPoint) {
    return null;
  }

  return {
    id,
    initPoint,
    status: typeof raw.status === "string" ? raw.status : "pending",
    raw,
  };
}

export class MercadoPagoPreapprovalClient implements PreapprovalProvider {
  constructor(private readonly accessToken: string) {}

  async create(input: Parameters<PreapprovalProvider["create"]>[0]) {
    const payload = {
      reason: input.reason,
      external_reference: input.attempt.externalReference,
      payer_email: input.attempt.payerEmail,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: input.amount,
        currency_id: input.currency,
      },
      back_url: input.backUrl,
      status: "pending",
    };

    let response: Response;

    try {
      response = await fetch(`${MERCADO_PAGO_API_URL}/preapproval`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CheckoutProviderError({
        code: "mp_transport_or_timeout",
        message:
          error instanceof Error ? error.message : "Error de red de Mercado Pago",
        ambiguous: true,
      });
    }

    let raw: Record<string, unknown> | null;

    try {
      raw = await readJsonRecord(response);
    } catch (error) {
      throw new CheckoutProviderError({
        code: "mp_response_read_error",
        message:
          error instanceof Error
            ? error.message
            : "No se pudo leer la respuesta de Mercado Pago",
        ambiguous: true,
      });
    }

    if (!response.ok) {
      throw new CheckoutProviderError({
        code: `mp_http_${response.status}`,
        message: `Mercado Pago rechazó la creación (HTTP ${response.status}).`,
        ambiguous: !isDefiniteProviderRejection(response.status),
        providerResponse: raw,
      });
    }

    const preapproval = raw ? toPreapproval(raw) : null;

    if (!preapproval) {
      throw new CheckoutProviderError({
        code: "mp_invalid_success_response",
        message:
          "Mercado Pago aceptó la solicitud pero no devolvió una preapproval recuperable.",
        ambiguous: true,
        providerResponse: raw,
      });
    }

    return preapproval;
  }

  async findByExternalReference(input: {
    externalReference: string;
    payerEmail: string;
  }): Promise<ProviderPreapproval | null> {
    const matches: ProviderPreapproval[] = [];
    let offset = 0;

    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const url = new URL(`${MERCADO_PAGO_API_URL}/preapproval/search`);
      url.searchParams.set("payer_email", input.payerEmail);
      url.searchParams.set("limit", String(SEARCH_PAGE_SIZE));
      url.searchParams.set("offset", String(offset));

      let response: Response;

      try {
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new CheckoutProviderError({
          code: "mp_reconciliation_transport_error",
          message:
            error instanceof Error
              ? error.message
              : "Error de red al reconciliar Mercado Pago",
          ambiguous: true,
        });
      }

      const raw = await readJsonRecord(response);

      if (!response.ok || !raw) {
        throw new CheckoutProviderError({
          code: `mp_reconciliation_http_${response.status}`,
          message: `No se pudo buscar la preapproval (HTTP ${response.status}).`,
          ambiguous: true,
          providerResponse: raw,
        });
      }

      const results = Array.isArray(raw.results) ? raw.results : [];

      for (const result of results) {
        const resultRecord = asRecord(result);
        if (
          resultRecord &&
          String(resultRecord.external_reference ?? "") === input.externalReference
        ) {
          const preapproval = toPreapproval(resultRecord);
          if (preapproval) {
            matches.push(preapproval);
          }
        }
      }

      const paging = asRecord(raw.paging);
      const total = typeof paging?.total === "number" ? paging.total : results.length;
      offset += results.length;

      if (results.length === 0 || offset >= total) {
        break;
      }
    }

    if (matches.length > 1) {
      throw new CheckoutProviderError({
        code: "mp_duplicate_external_reference",
        message:
          "Mercado Pago devolvió más de una preapproval para la misma referencia externa.",
        ambiguous: true,
      });
    }

    return matches[0] ?? null;
  }
}
