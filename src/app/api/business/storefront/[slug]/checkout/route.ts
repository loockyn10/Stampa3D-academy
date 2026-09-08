import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { MercadoPagoMarketplaceProvider } from "@/lib/business/mercado-pago-provider";
import { getValidMercadoPagoSellerToken } from "@/lib/business/mercado-pago-account";
import { normalizeMarketplaceFeePercent } from "@/lib/business/orders";
import { businessLiveModeAllowed, createBusinessAdminClient, requireBusinessAppUrl } from "@/lib/business/server";
import { normalizeStorefrontSlug } from "@/lib/business/storefront";

export const runtime = "nodejs";

type CheckoutBody = {
  idempotencyKey?: unknown;
  items?: unknown;
  buyer?: { name?: unknown; email?: unknown; phone?: unknown };
};

function requestFingerprint(request: NextRequest): string {
  const secret = process.env.BUSINESS_CHECKOUT_FINGERPRINT_SECRET;
  if (!secret) throw new Error("BUSINESS_CHECKOUT_FINGERPRINT_SECRET no configurada");
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return crypto.createHmac("sha256", secret).update(`${forwarded}:${userAgent}`).digest("hex");
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  let orderId: string | null = null;
  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeStorefrontSlug(rawSlug);
    let body: CheckoutBody;
    try { body = await request.json() as CheckoutBody; }
    catch { return NextResponse.json({ error: "La solicitud no tiene un formato válido." }, { status: 400 }); }
    if (!slug || !isUuid(body.idempotencyKey) || !Array.isArray(body.items) || !body.buyer || typeof body.buyer !== "object") {
      return NextResponse.json({ error: "La solicitud de compra no es válida." }, { status: 400 });
    }
    const admin = createBusinessAdminClient();
    const feePercent = normalizeMarketplaceFeePercent(process.env.BUSINESS_MARKETPLACE_FEE_PERCENT);
    const { data: orderData, error: orderError } = await admin.rpc("create_public_business_order", {
      p_store_slug: slug,
      p_idempotency_key: body.idempotencyKey,
      p_items: body.items,
      p_buyer_name: body.buyer.name,
      p_buyer_email: body.buyer.email,
      p_buyer_phone: body.buyer.phone,
      p_request_fingerprint_hash: requestFingerprint(request),
      p_marketplace_fee_percent: feePercent,
      p_allow_live: businessLiveModeAllowed(),
    });
    const order = firstRow(orderData);
    if (orderError) throw orderError;
    if (!order?.success) {
      const status = order?.error_code === "rate_limited" ? 429 : order?.error_code === "store_not_found" ? 404 : 409;
      return NextResponse.json({ error: String(order?.message || "No pudimos crear el pedido.") }, { status });
    }
    orderId = String(order.order_id);
    const publicToken = String(order.public_token);
    if (order.checkout_status === "created" && order.checkout_url) {
      return NextResponse.json({ checkoutUrl: String(order.checkout_url), orderToken: publicToken, replayed: true });
    }

    const { data: claimData, error: claimError } = await admin.rpc("claim_business_order_checkout", { p_order_id: orderId });
    const claim = firstRow(claimData);
    if (claimError || !claim?.success) throw claimError || new Error(String(claim?.error_code || "No se pudo preparar el checkout"));
    if (claim.operation === "existing" && claim.checkout_url) {
      return NextResponse.json({ checkoutUrl: String(claim.checkout_url), orderToken: publicToken, replayed: true });
    }
    if (!claim.claimed || claim.operation === "wait") {
      return NextResponse.json({ error: "El pago se está preparando. Reintentá en unos segundos.", orderToken: publicToken, retryable: true }, { status: 409, headers: { "Retry-After": "2" } });
    }
    const seller = await getValidMercadoPagoSellerToken(admin, String(claim.user_id));
    const provider = new MercadoPagoMarketplaceProvider(seller.accessToken);
    let checkout = claim.operation === "reconcile"
      ? await provider.findCheckoutByExternalReference(String(claim.external_reference))
      : null;
    if (claim.operation === "reconcile" && !checkout) {
      await admin.rpc("fail_business_order_checkout", { p_order_id: orderId, p_ambiguous: true, p_error: "Preference reconciliation returned no result" });
      return NextResponse.json({ error: "Estamos verificando el pago. Reintentá más tarde.", orderToken: publicToken, retryable: true }, { status: 503 });
    }
    const { data: itemRows, error: itemsError } = await admin.from("business_order_items")
      .select("catalog_item_id, product_name_snapshot, image_url_snapshot, unit_price, quantity")
      .eq("order_id", orderId).eq("user_id", String(claim.user_id));
    if (itemsError || !itemRows?.length) throw itemsError || new Error("El pedido no tiene productos");
    const appUrl = requireBusinessAppUrl();
    const returnUrl = `${appUrl}/tienda/${slug}/pedido/${publicToken}`;
    checkout ??= await provider.createCheckout({
      externalReference: String(claim.external_reference),
      items: itemRows.map((item) => ({ reference: String(item.catalog_item_id), title: String(item.product_name_snapshot), quantity: Number(item.quantity), unitPrice: Number(item.unit_price), pictureUrl: item.image_url_snapshot ? String(item.image_url_snapshot) : null })),
      payerEmail: String(claim.buyer_email),
      marketplaceFee: Number(claim.marketplace_fee_amount),
      expiresAt: String(claim.expires_at),
      successUrl: returnUrl, pendingUrl: returnUrl, failureUrl: returnUrl,
      notificationUrl: `${appUrl}/api/business/mercadopago/webhook`,
    });
    const checkoutUrl = seller.liveMode ? checkout.initPoint : checkout.sandboxInitPoint || checkout.initPoint;
    const { data: completed, error: completeError } = await admin.rpc("complete_business_order_checkout", {
      p_order_id: orderId, p_preference_id: checkout.id, p_checkout_url: checkoutUrl,
    });
    if (completeError || completed !== true) throw completeError || new Error("No se pudo guardar la preferencia creada");
    return NextResponse.json({ checkoutUrl, orderToken: publicToken, replayed: order.replayed === true });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : 0;
    const ambiguous = orderId !== null && (!status || status >= 500 || status === 408 || status === 429);
    if (orderId) {
      try { await createBusinessAdminClient().rpc("fail_business_order_checkout", { p_order_id: orderId, p_ambiguous: ambiguous, p_error: error instanceof Error ? error.message : "Checkout error" }); }
      catch { /* The stale creating state will force reconciliation after its timeout. */ }
    }
    console.error("[Business Checkout] Falló el inicio", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: ambiguous ? "No pudimos confirmar si Mercado Pago creó el pago. Reintentá más tarde." : "No pudimos iniciar el pago.", retryable: ambiguous }, { status: ambiguous ? 503 : 502 });
  }
}
