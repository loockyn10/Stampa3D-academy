import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user.email) {
      return NextResponse.json({ error: 'Usuario sin email configurado' }, { status: 400 });
    }

    const fallbackPrice = process.env.MEMBERSHIP_MONTHLY_PRICE;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!accessToken) return NextResponse.json({ error: 'Falta configurar Mercado Pago.' }, { status: 500 });
    if (!appUrl) return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL no configurado' }, { status: 500 });
    if (!serviceRoleKey) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY no configurado' }, { status: 500 });

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    );

    // Get base price from membership_settings
    const { data: settings } = await supabaseAdmin
      .from("membership_settings")
      .select("monthly_price, currency")
      .eq("id", "default")
      .single();

    const price = settings?.monthly_price
      ? Number(settings.monthly_price)
      : Number(fallbackPrice);
    const currency = settings?.currency || "ARS";

    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: 'Precio de membresía inválido o no configurado' }, { status: 500 });
    }

    console.log("[MP create-subscription] price", price);

    let backUrlStr = "";
    try {
      backUrlStr = new URL("/pago/estado", appUrl).toString();
    } catch (e) {
      // Fallback in case NEXT_PUBLIC_APP_URL is missing the protocol
      backUrlStr = `https://${appUrl.replace(/^https?:\/\//, '')}/pago/estado`;
    }

    const payload = {
      reason: "Membresía Academia Stampa",
      external_reference: user.id,
      payer_email: user.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: price,
        currency_id: currency
      },
      back_url: backUrlStr,
      status: "pending"
    };

    const mpResponse = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload)
    });

    const mpText = await mpResponse.text();
    
    console.error("[MP create-subscription] status", mpResponse.status);
    console.error("[MP create-subscription] response", mpText);

    if (!mpResponse.ok) {
      return NextResponse.json(
        { error: "No pudimos crear la suscripción. Probá de nuevo." },
        { status: mpResponse.status }
      );
    }

    let mpData = null;
    try {
      mpData = JSON.parse(mpText);
    } catch (error) {
      console.error("Mercado Pago respondió texto no JSON:", mpText);
      return NextResponse.json({ error: "Respuesta inválida de Mercado Pago." }, { status: 500 });
    }

    const initPoint = mpData.init_point ?? mpData.sandbox_init_point;
    if (!initPoint) {
      console.error("Mercado Pago no devolvió init_point o id:", mpData);
      return NextResponse.json({
        error: "No pudimos crear la suscripción. Probá de nuevo."
      }, { status: 500 });
    }

    const preapprovalId = mpData.id;

    // Save subscription
    const { error: insertError } = await supabaseAdmin.from("subscriptions").upsert({
      user_id: user.id,
      mercado_pago_preapproval_id: preapprovalId,
      status: mpData.status || "pending",
      payer_email: user.email,
      amount: price,
      currency: currency,
      raw_data: mpData,
      next_payment_at: mpData.next_payment_date || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: "mercado_pago_preapproval_id" });

    if (insertError) {
      console.error("Supabase subscription save error", insertError);
      return NextResponse.json({
        error: "Failed to save subscription",
        details: insertError
      }, { status: 500 });
    }

    return NextResponse.json({
      init_point: initPoint,
      preapproval_id: preapprovalId,
    });
  } catch (error: any) {
    console.error("Error in create-subscription route:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
