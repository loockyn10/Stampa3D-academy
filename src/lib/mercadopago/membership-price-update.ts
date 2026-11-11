import { sameAmount } from "@/lib/mercadopago/discount-checkout";

/**
 * Mass price update ("apply the new list price to existing subscriptions").
 *
 * A subscription is repriced ONLY when it provably pays the PREVIOUS LIST PRICE, i.e. when it is a regular
 * subscription. Anything with a special amount (promotional price, discount code, internal test subscription) is left
 * untouched and reported. The amount is read from Mercado Pago (the source of truth) immediately before each change;
 * the local row must agree. No decision is taken from a stale local value alone.
 */

export type PriceUpdateSkipReason =
  | "previous_price_unknown"
  | "provider_unreadable"
  | "provider_not_authorized"
  | "provider_currency_differs"
  | "special_amount"
  | "local_amount_differs"
  | "already_at_new_price";

export type PriceUpdateFailureReason = "provider_rejected" | "provider_unexpected_response" | "provider_error";

export type PriceUpdateItem =
  | { id: string; outcome: "updated" }
  | { id: string; outcome: "skipped"; reason: PriceUpdateSkipReason }
  | { id: string; outcome: "failed"; reason: PriceUpdateFailureReason; httpStatus?: number };

export type PriceUpdateSummary = {
  updated: number;
  skipped: number;
  failed: number;
  skippedByReason: Partial<Record<PriceUpdateSkipReason, number>>;
  items: PriceUpdateItem[];
};

export type ProviderPreapprovalAmount = {
  status: string | null;
  amount: number | null;
  currency: string | null;
};

/** The two Mercado Pago operations the update needs. Nothing else is ever called. */
export interface PriceUpdateGateway {
  /** Read-only. `null` when the preapproval cannot be read. */
  read(preapprovalId: string): Promise<ProviderPreapprovalAmount | null>;
  /** The only write: `PUT /preapproval/{id}` with `auto_recurring.{transaction_amount,currency_id}`. */
  updateAmount(
    preapprovalId: string,
    amount: number,
    currency: string,
  ): Promise<{ ok: boolean; httpStatus: number; confirmed: ProviderPreapprovalAmount | null }>;
}

export type ExistingSubscription = {
  id: string;
  preapprovalId: string;
  /** `subscriptions.amount` (may be a numeric string or null). */
  localAmount: number | string | null;
};

export type ApplyPriceInput = {
  previousPrice: number;
  newPrice: number;
  currency: string;
  subscriptions: readonly ExistingSubscription[];
  gateway: PriceUpdateGateway;
  /** Persists the new amount locally after Mercado Pago confirmed it. Must not throw for the batch to continue. */
  onUpdated: (subscriptionId: string, amount: number, currency: string) => Promise<void>;
};

const isFinitePositive = (value: number) => Number.isFinite(value) && value > 0;
const toNumber = (value: number | string | null): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function applyListPriceToExisting(input: ApplyPriceInput): Promise<PriceUpdateSummary> {
  const items: PriceUpdateItem[] = [];
  const skip = (id: string, reason: PriceUpdateSkipReason) => items.push({ id, outcome: "skipped", reason });

  for (const sub of input.subscriptions) {
    // Without a trustworthy previous list price nothing can be classified as "regular": change nothing.
    if (!isFinitePositive(input.previousPrice)) {
      skip(sub.id, "previous_price_unknown");
      continue;
    }

    const local = toNumber(sub.localAmount);
    if (local === null || !sameAmount(local, input.previousPrice)) {
      // Includes the new price already stored locally (idempotent re-run) and any special local amount.
      skip(sub.id, local !== null && sameAmount(local, input.newPrice) ? "already_at_new_price" : "local_amount_differs");
      continue;
    }

    let current: ProviderPreapprovalAmount | null;
    try {
      current = await input.gateway.read(sub.preapprovalId);
    } catch {
      current = null;
    }

    if (!current || current.amount === null) {
      skip(sub.id, "provider_unreadable");
      continue;
    }
    if (String(current.status ?? "").toLowerCase() !== "authorized") {
      skip(sub.id, "provider_not_authorized");
      continue;
    }
    if (current.currency && current.currency.toUpperCase() !== input.currency.toUpperCase()) {
      skip(sub.id, "provider_currency_differs");
      continue;
    }
    if (sameAmount(current.amount, input.newPrice)) {
      skip(sub.id, "already_at_new_price");
      continue;
    }
    if (!sameAmount(current.amount, input.previousPrice)) {
      skip(sub.id, "special_amount");
      continue;
    }

    try {
      const result = await input.gateway.updateAmount(sub.preapprovalId, input.newPrice, input.currency);

      if (!result.ok) {
        items.push({ id: sub.id, outcome: "failed", reason: "provider_rejected", httpStatus: result.httpStatus });
        continue;
      }
      // Mercado Pago answered OK: trust it only if it reports the amount we asked for and the subscription is still
      // authorized (a change that left it pending would mean a new authorization is required).
      const confirmed = result.confirmed;
      if (
        !confirmed ||
        confirmed.amount === null ||
        !sameAmount(confirmed.amount, input.newPrice) ||
        String(confirmed.status ?? "").toLowerCase() !== "authorized"
      ) {
        items.push({ id: sub.id, outcome: "failed", reason: "provider_unexpected_response", httpStatus: result.httpStatus });
        continue;
      }

      try {
        await input.onUpdated(sub.id, input.newPrice, input.currency);
      } catch {
        // Mercado Pago already holds the new amount; the next sync (webhook/cron) realigns the local row.
      }
      items.push({ id: sub.id, outcome: "updated" });
    } catch {
      items.push({ id: sub.id, outcome: "failed", reason: "provider_error" });
    }
  }

  const skippedByReason: Partial<Record<PriceUpdateSkipReason, number>> = {};
  for (const item of items) {
    if (item.outcome === "skipped") skippedByReason[item.reason] = (skippedByReason[item.reason] ?? 0) + 1;
  }

  return {
    updated: items.filter((item) => item.outcome === "updated").length,
    skipped: items.filter((item) => item.outcome === "skipped").length,
    failed: items.filter((item) => item.outcome === "failed").length,
    skippedByReason,
    items,
  };
}

const MERCADO_PAGO_API_URL = "https://api.mercadopago.com";
const REQUEST_TIMEOUT_MS = 12_000;

function parseAmount(raw: unknown): ProviderPreapprovalAmount | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const recurring =
    typeof record.auto_recurring === "object" && record.auto_recurring !== null
      ? (record.auto_recurring as Record<string, unknown>)
      : null;
  const amount = recurring && recurring.transaction_amount !== undefined ? Number(recurring.transaction_amount) : NaN;
  return {
    status: typeof record.status === "string" ? record.status : null,
    amount: Number.isFinite(amount) ? amount : null,
    currency: recurring && typeof recurring.currency_id === "string" ? recurring.currency_id : null,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function createMercadoPagoPriceGateway(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): PriceUpdateGateway {
  const url = (id: string) => `${MERCADO_PAGO_API_URL}/preapproval/${encodeURIComponent(id)}`;
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  return {
    async read(preapprovalId) {
      const response = await fetchImpl(url(preapprovalId), { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) return null;
      return parseAmount(await readJson(response));
    },
    async updateAmount(preapprovalId, amount, currency) {
      const response = await fetchImpl(url(preapprovalId), {
        method: "PUT",
        headers,
        body: JSON.stringify({ auto_recurring: { transaction_amount: amount, currency_id: currency } }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return { ok: response.ok, httpStatus: response.status, confirmed: response.ok ? parseAmount(await readJson(response)) : null };
    },
  };
}
