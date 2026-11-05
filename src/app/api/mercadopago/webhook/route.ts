import { NextResponse } from "next/server";
import { createMembershipDependencies, createWebhookEventLog } from "@/lib/mercadopago/membership-server";
import { handleMembershipWebhook } from "@/lib/mercadopago/membership-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Membership webhook (topics subscription_preapproval, subscription_authorized_payment, payment).
 * Signature is mandatory; the state is always re-read from Mercado Pago; transient failures answer 5xx so Mercado
 * Pago retries. Contract and status codes: src/lib/mercadopago/membership-webhook.ts.
 */
export async function POST(request: Request) {
  const dependencies = createMembershipDependencies();
  const result = await handleMembershipWebhook(
    {
      url: request.url,
      headers: request.headers,
      bodyText: await request.text().catch(() => ""),
    },
    {
      secret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
      dependencies: dependencies ? { ...dependencies, eventLog: createWebhookEventLog(dependencies.admin) } : null,
      log: (message, details) => console.error(`[MP membership webhook] ${message}`, details ?? {}),
    },
  );
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
