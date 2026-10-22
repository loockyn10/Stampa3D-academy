import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const lib = loadTs("src/lib/business/dashboard.ts");
const now = new Date("2026-10-22T12:00:00Z");
const order = (id, status, extra = {}) => ({
  id, order_number: Number(id.replace(/\D/g, "")) || 1, status, payment_status: "pending", currency: "ARS", total: 1000,
  buyer_name: "Ana", buyer_email: "a@x", buyer_phone: null, provider: "mercado_pago", provider_preference_id: null,
  expires_at: "2026-10-23T00:00:00Z", paid_at: null, created_at: "2026-10-22T10:00:00Z", items: [], ...extra,
});

test("pedidos pendientes: esperando pago vigente + revisión; vencidos y pagados no cuentan", () => {
  const summary = lib.summarizePendingOrders([
    order("o1", "awaiting_payment"),
    order("o2", "awaiting_payment", { expires_at: "2026-10-21T00:00:00Z" }),
    order("o3", "payment_review", { created_at: "2026-10-20T10:00:00Z" }),
    order("o4", "paid"),
    order("o5", "expired"),
  ], now);
  assert.equal(summary.awaitingPayment, 1);
  assert.equal(summary.paymentReview, 1);
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.list.map((o) => o.id), ["o3", "o1"], "revisión primero");
});

test("alertas: revisión de pago, saldo a cobrar y pedidos esperando pago (nunca como ventas)", () => {
  const pending = lib.summarizePendingOrders([order("o1", "awaiting_payment"), order("o3", "payment_review")], now);
  const alerts = lib.buildBusinessAlerts({ metrics: { outstandingReceivables: 2500 }, pending, formatMoney: (v) => `$${v}` });
  assert.deepEqual(alerts.map((a) => a.id), ["payment_review", "receivables", "awaiting_payment"]);
  assert.match(alerts[2].description, /Todavía no son ventas/);
  assert.equal(alerts[0].href, "/mi-negocio/pedidos?estado=payment_review");
  assert.deepEqual(lib.buildBusinessAlerts({ metrics: { outstandingReceivables: 0 }, pending: lib.summarizePendingOrders([], now), formatMoney: String }), []);
});

test("ventas recientes ordenadas por fecha, sin ocultar anuladas", () => {
  const list = lib.recentSales([
    { id: "a", created_at: "2026-10-01T00:00:00Z", status: "completed" },
    { id: "b", created_at: "2026-10-05T00:00:00Z", status: "voided" },
  ]);
  assert.deepEqual(list.map((s) => s.id), ["b", "a"]);
});

test("comparación de período: null sin base válida", () => {
  assert.equal(lib.formatComparison(null), null);
  assert.equal(lib.formatComparison(Number.NaN), null);
  assert.equal(lib.formatComparison(12.4).label, "+12% vs. período anterior");
  assert.equal(lib.formatComparison(-3).tone, "down");
});

test("portada: reutiliza las server actions existentes y conserva las nueve herramientas", () => {
  const ui = read("src/components/business/business-dashboard.tsx");
  for (const action of ["loadBusinessMetricsAction", "loadBusinessSalesAction", "loadBusinessOrdersAction"]) assert.match(ui, new RegExp(action));
  assert.doesNotMatch(ui, /createClient|supabase\.|\.rpc\(|\.from\("/, "sin consultas paralelas");
  for (const href of ["/mi-negocio/catalogo", "/mi-negocio/venta-rapida", "/mi-negocio/ventas", "/mi-negocio/clientes", "/mi-negocio/reposicion", "/mi-negocio/metricas", "/presupuestos", "/mi-negocio/tienda", "/mi-negocio/pedidos"]) {
    assert.ok(ui.includes(`href: "${href}"`), href);
  }
  assert.match(ui, /href="\/presupuestos\?action=new"/);
  assert.match(read("src/app/mi-negocio/pedidos/page.tsx"), /get\("estado"\)/);
});
