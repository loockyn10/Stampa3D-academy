export type BusinessOrderStatus = "awaiting_payment" | "paid" | "cancelled" | "expired" | "refunded" | "partially_refunded" | "payment_review";
export type BusinessPaymentStatus = "pending" | "in_process" | "approved" | "rejected" | "cancelled" | "refunded" | "partially_refunded" | "unknown";

export interface BusinessOrderItemSummary {
  id: string;
  order_id: string;
  product_name_snapshot: string;
  sku_snapshot: string | null;
  image_url_snapshot: string | null;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

export interface BusinessOrderSummary {
  id: string;
  order_number: number;
  status: BusinessOrderStatus;
  payment_status: BusinessPaymentStatus;
  currency: "ARS";
  total: number;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  provider: "mercado_pago";
  provider_preference_id: string | null;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
  items: BusinessOrderItemSummary[];
}

export interface BusinessPaymentConnection {
  provider: "mercado_pago";
  status: "connected" | "disconnected" | "error";
  providerUserId: string | null;
  liveMode: boolean;
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  lastError: string | null;
}

export function normalizeMarketplaceFeePercent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return 0;
  return Number(parsed.toFixed(4));
}

