import { NextResponse, type NextRequest } from "next/server";
import { getValidMercadoPagoSellerToken } from "@/lib/business/mercado-pago-account";
import { MercadoPagoMarketplaceProvider } from "@/lib/business/mercado-pago-provider";
import { createBusinessAdminClient } from "@/lib/business/server";
import { stableWebhookEventId, validateMercadoPagoWebhookSignature } from "@/lib/business/webhook-signature";

export const runtime = "nodejs";

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : typeof value === "number" ? String(value) : null;
}

export async function POST(request: NextRequest) {
  let eventRowId: string | null = null;
  try {
    let payload: Record<string, unknown>;
    try { payload = await request.json() as Record<string, unknown>; }
    catch { return NextResponse.json({ error: "Payload inválido" }, { status: 400 }); }

    const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
    const dataId = request.nextUrl.searchParams.get("data.id") || stringValue(data.id);
    const requestId = request.headers.get("x-request-id");
    if (!validateMercadoPagoWebhookSignature({
      xSignature: request.headers.get("x-signature"), xRequestId: requestId, dataId,
      secret: process.env.MERCADO_PAGO_MARKETPLACE_WEBHOOK_SECRET,
    })) return NextResponse.json({ error: "Firma inválida" }, { status: 401 });

    const eventType = stringValue(payload.type) || stringValue(payload.topic) || "unknown";
    const eventId = stableWebhookEventId(payload, requestId!, dataId!);
    const admin = createBusinessAdminClient();
    const { data: inserted, error: insertError } = await admin.from("business_payment_webhook_events").insert({
      provider: "mercado_pago", provider_event_id: eventId, request_id: requestId, event_type: eventType,
      action: stringValue(payload.action), data_id: dataId, status: "processing", payload,
    }).select("id").single();

    if (insertError?.code === "23505") {
      const { data: existing } = await admin.from("business_payment_webhook_events")
        .select("id, status, processing_attempts, updated_at").eq("provider", "mercado_pago").eq("provider_event_id", eventId).single();
      if (existing?.status === "processed" || existing?.status === "ignored") return NextResponse.json({ received: true, replayed: true });
      const processingIsFresh = existing?.status === "processing" && Date.now() - new Date(existing.updated_at).getTime() < 60_000;
      if (processingIsFresh) return NextResponse.json({ received: true, processing: true }, { status: 202 });
      if (!existing?.id) throw insertError;
      eventRowId = existing.id;
      await admin.from("business_payment_webhook_events").update({ status: "processing", error_message: null, processing_attempts: Number(existing.processing_attempts || 1) + 1 }).eq("id", existing.id);
    } else if (insertError || !inserted) throw insertError || new Error("No se pudo registrar el webhook");
    else eventRowId = inserted.id;

    if (eventType !== "payment") {
      await admin.from("business_payment_webhook_events").update({ status: "ignored", processed_at: new Date().toISOString() }).eq("id", eventRowId);
      return NextResponse.json({ received: true, ignored: true });
    }

    const providerUserId = stringValue(payload.user_id);
    if (!providerUserId) throw new Error("El webhook no identifica al vendedor");
    const { data: account, error: accountError } = await admin.from("business_payment_accounts")
      .select("user_id").eq("provider", "mercado_pago").eq("provider_user_id", providerUserId).eq("status", "connected").single();
    if (accountError || !account) throw accountError || new Error("Cuenta vendedora no encontrada");

    const seller = await getValidMercadoPagoSellerToken(admin, String(account.user_id));
    const payment = await new MercadoPagoMarketplaceProvider(seller.accessToken).getPayment(dataId!);
    const { data: processedData, error: processingError } = await admin.rpc("process_business_payment", {
      p_provider: "mercado_pago", p_payment_id: payment.id, p_status: payment.status,
      p_status_detail: payment.statusDetail, p_amount: payment.amount, p_currency: payment.currency,
      p_external_reference: payment.externalReference, p_collector_id: payment.collectorId,
      p_approved_at: payment.approvedAt, p_raw_data: payment.raw,
    });
    const processed = firstRow(processedData);
    if (processingError || !processed?.success) throw processingError || new Error(String(processed?.message || processed?.error_code || "No se pudo consolidar el pago"));
    await admin.from("business_payment_webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), error_message: null }).eq("id", eventRowId);
    return NextResponse.json({ received: true, replayed: processed.replayed === true, requiresReview: processed.requires_review === true });
  } catch (error) {
    if (eventRowId) {
      try { await createBusinessAdminClient().from("business_payment_webhook_events").update({ status: "error", error_message: (error instanceof Error ? error.message : "Webhook error").slice(0, 500) }).eq("id", eventRowId); }
      catch { /* Mercado Pago will retry because this response remains 5xx. */ }
    }
    console.error("[Business Webhook] Falló el procesamiento", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No se pudo procesar el evento" }, { status: 500 });
  }
}
