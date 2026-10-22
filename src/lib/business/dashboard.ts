import type { BusinessSaleSummary } from "./catalog";
import type { BusinessMetrics } from "./metrics";
import type { BusinessOrderSummary } from "./orders";

/**
 * Resumen comercial de la portada de Mi Negocio. No calcula ingresos propios:
 * - facturación, cantidad de ventas, ticket promedio y top productos vienen de `get_business_metrics`
 *   (solo ventas `completed`; las anuladas no cuentan);
 * - un pedido online pendiente NO es una venta: se cuenta aparte y nunca suma a la facturación.
 */

export const PENDING_ORDER_STATUSES = ["awaiting_payment", "payment_review"] as const;

export interface PendingOrdersSummary {
  awaitingPayment: number;
  paymentReview: number;
  total: number;
  /** Primero los que requieren revisión manual, luego los que esperan pago (más recientes primero). */
  list: BusinessOrderSummary[];
}

export function summarizePendingOrders(orders: BusinessOrderSummary[], now: Date = new Date(), limit = 4): PendingOrdersSummary {
  const nowMs = now.getTime();
  // Un pedido "esperando pago" ya vencido no se presenta como pendiente (el checkout expiró).
  const awaiting = orders.filter((order) => order.status === "awaiting_payment" && !(order.expires_at && Date.parse(order.expires_at) <= nowMs));
  const review = orders.filter((order) => order.status === "payment_review");
  const byDateDesc = (a: BusinessOrderSummary, b: BusinessOrderSummary) => Date.parse(b.created_at) - Date.parse(a.created_at);
  return {
    awaitingPayment: awaiting.length,
    paymentReview: review.length,
    total: awaiting.length + review.length,
    list: [...review.sort(byDateDesc), ...awaiting.sort(byDateDesc)].slice(0, limit),
  };
}

/** Ventas recientes para mostrar: incluye anuladas marcadas como tales (no se ocultan ni se suman). */
export function recentSales(sales: BusinessSaleSummary[], limit = 5): BusinessSaleSummary[] {
  return [...sales].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, limit);
}

export interface BusinessAlert {
  id: "payment_review" | "receivables" | "awaiting_payment";
  tone: "red" | "yellow" | "neutral";
  title: string;
  description: string;
  href: string;
}

export function buildBusinessAlerts({
  metrics,
  pending,
  formatMoney,
}: {
  metrics: BusinessMetrics | null;
  pending: PendingOrdersSummary | null;
  formatMoney: (value: number) => string;
}): BusinessAlert[] {
  const alerts: BusinessAlert[] = [];
  if (pending && pending.paymentReview > 0) {
    alerts.push({
      id: "payment_review",
      tone: "red",
      title: `${pending.paymentReview} ${pending.paymentReview === 1 ? "pago para revisar" : "pagos para revisar"}`,
      description: "Mercado Pago informó un estado que requiere revisión antes de confirmar la venta.",
      href: "/mi-negocio/pedidos?estado=payment_review",
    });
  }
  if (metrics && metrics.outstandingReceivables > 0) {
    alerts.push({
      id: "receivables",
      tone: "yellow",
      title: `Saldo a cobrar: ${formatMoney(metrics.outstandingReceivables)}`,
      description: "Deuda de clientes en cuenta corriente (total actual, no solo del período).",
      href: "/mi-negocio/clientes",
    });
  }
  if (pending && pending.awaitingPayment > 0) {
    alerts.push({
      id: "awaiting_payment",
      tone: "neutral",
      title: `${pending.awaitingPayment} ${pending.awaitingPayment === 1 ? "pedido espera" : "pedidos esperan"} el pago`,
      description: "Todavía no son ventas: se registran cuando Mercado Pago confirma el pago.",
      href: "/mi-negocio/pedidos?estado=awaiting_payment",
    });
  }
  return alerts;
}

/** Variación contra el período anterior; `null` cuando no hay base válida para comparar. */
export function formatComparison(percent: number | null | undefined): { label: string; tone: "up" | "down" | "flat" } | null {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent);
  if (rounded === 0) return { label: "igual que el período anterior", tone: "flat" };
  return { label: `${rounded > 0 ? "+" : ""}${rounded}% vs. período anterior`, tone: rounded > 0 ? "up" : "down" };
}
