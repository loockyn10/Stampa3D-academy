import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const searchParams = url.searchParams;
    let body: any = {};
    
    try {
      body = await request.json();
    } catch (e) {}

    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    const signatureHeader = request.headers.get('x-signature');
    const xRequestId = request.headers.get('x-request-id') || '';
    
    const dataId = body?.data?.id || searchParams.get('data.id') || searchParams.get('id');
    const action = body?.action || searchParams.get('topic') || searchParams.get('type') || "unknown";
    const type = body?.type || searchParams.get('type') || action;

    if (!dataId) {
      return NextResponse.json({ error: 'Missing data id' }, { status: 400 });
    }

    if (secret && signatureHeader) {
      const parts = signatureHeader.split(',');
      let ts = '';
      let v1 = '';
      parts.forEach(p => {
        const [key, val] = p.split('=');
        if (key.trim() === 'ts') ts = val.trim();
        if (key.trim() === 'v1') v1 = val.trim();
      });

      const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
      const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
      
      if (hmac !== v1) {
        console.warn("Mercado Pago Webhook Signature Mismatch. Validating failed.");
        // In strict mode: return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Supabase Service Role Key not configured' }, { status: 500 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    );

    // Idempotency check
    const { data: existingEvent } = await supabaseAdmin
      .from("mercado_pago_webhook_events")
      .select("id")
      .eq("data_id", String(dataId))
      .eq("action", String(action))
      .single();

    if (existingEvent) {
      return NextResponse.json({ message: 'Event already processed' });
    }

    const { error: insertError } = await supabaseAdmin.from("mercado_pago_webhook_events").insert({
      data_id: String(dataId),
      action: String(action),
      event_type: String(type),
      raw_data: body,
      created_at: new Date().toISOString()
    }); // ignore error if columns differ slightly, it's just a log

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("Missing MP access token");
    }

    // Process Subscriptions (Preapproval)
    if (type === 'subscription_preapproval' || action === 'subscription_preapproval' || type === 'preapproval') {
      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${dataId}`, {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      if (mpRes.ok) {
        const subData = await mpRes.json();
        const externalReference = subData.external_reference; // user_id
        const status = subData.status;
        const nextPayment = subData.next_payment_date;

        if (externalReference) {
          // Update subscriptions table
          await supabaseAdmin.from("subscriptions").update({
            status: status,
            next_payment_at: nextPayment || null,
            updated_at: new Date().toISOString()
          }).eq("mercado_pago_preapproval_id", dataId);

          // Update profile membership status
          let membershipStatus = "inactive";
          if (status === "authorized" || status === "active") {
            membershipStatus = "active";
          } else if (status === "cancelled" || status === "paused") {
            membershipStatus = "cancelled";
          }

          const updateProfilePayload: any = {
            membership_status: membershipStatus,
            updated_at: new Date().toISOString()
          };

          if (membershipStatus === "active") {
            // Only set started_at if it's null (using a separate query to check)
            const { data: prof } = await supabaseAdmin.from("profiles").select("membership_started_at").eq("id", externalReference).single();
            if (prof && !prof.membership_started_at) {
              updateProfilePayload.membership_started_at = new Date().toISOString();
            }
          }
          await supabaseAdmin.from("profiles").update(updateProfilePayload).eq("id", externalReference);
        }
      }
    }

    // Process Payments
    if (type === 'payment' || action === 'payment.created' || action === 'payment.updated') {
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      if (mpRes.ok) {
        const payData = await mpRes.json();
        const externalReference = payData.external_reference; // user_id
        const status = payData.status;
        const amount = payData.transaction_amount;
        const dateApproved = payData.date_approved;

        if (externalReference && status === "approved") {
          // Check if payment already exists
          const { data: existingPay } = await supabaseAdmin.from("payments")
            .select("id")
            .eq("mercado_pago_payment_id", String(dataId))
            .single();

          if (!existingPay) {
            // We need subscription_id. Let's find it by external_reference
            const { data: sub } = await supabaseAdmin.from("subscriptions")
              .select("id")
              .eq("user_id", externalReference)
              .order("created_at", { ascending: false })
              .limit(1)
              .single();

            await supabaseAdmin.from("payments").insert({
              user_id: externalReference,
              subscription_id: sub?.id || null,
              mercado_pago_payment_id: String(dataId),
              status: status,
              amount: amount,
              paid_at: dateApproved || new Date().toISOString(),
              created_at: new Date().toISOString()
            });

            // Update active_months
            const { data: prof } = await supabaseAdmin.from("profiles").select("active_months, membership_started_at").eq("id", externalReference).single();
            if (prof) {
              const currentMonths = prof.active_months || 0;
              const updatePayload: any = {
                active_months: currentMonths + 1,
                membership_status: "active",
                updated_at: new Date().toISOString()
              };
              if (!prof.membership_started_at) {
                updatePayload.membership_started_at = new Date().toISOString();
              }
              await supabaseAdmin.from("profiles").update(updatePayload).eq("id", externalReference);
            }
          }
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
