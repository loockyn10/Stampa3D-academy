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

    const price = process.env.MEMBERSHIP_MONTHLY_PRICE;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!accessToken) {
      return NextResponse.json({ error: 'MERCADO_PAGO_ACCESS_TOKEN no configurado' }, { status: 500 });
    }
    if (!price || isNaN(Number(price)) || Number(price) <= 0) {
      return NextResponse.json({ error: 'MEMBERSHIP_MONTHLY_PRICE inválido o no configurado' }, { status: 500 });
    }
    if (!appUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL no configurado' }, { status: 500 });
    }
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY no configurado' }, { status: 500 });
    }

    // Call Mercado Pago API to create preapproval (subscription)
    const payload = {
      reason: "Membresía mensual Stampa3D",
      external_reference: user.id,
      payer_email: user.email,
      back_url: `${appUrl}/perfil`,
      status: "pending",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: Number(price),
        currency_id: "ARS"
      }
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
    let mpData = null;

    try {
      mpData = mpText ? JSON.parse(mpText) : null;
    } catch (error) {
      console.error("Mercado Pago respondió texto no JSON:", mpText);
    }

    console.error("Mercado Pago preapproval response", {
      ok: mpResponse.ok,
      status: mpResponse.status,
      statusText: mpResponse.statusText,
      body: mpData || mpText || null,
    });

    if (!mpResponse.ok) {
      return NextResponse.json(
        {
          error: "Mercado Pago rejected subscription creation",
          status: mpResponse.status,
          statusText: mpResponse.statusText,
          details: mpData || mpText || null,
        },
        { status: mpResponse.status }
      );
    }

    if (!mpData?.id || !mpData?.init_point) {
      console.error("Mercado Pago no devolvió init_point o id:", mpData);
      return NextResponse.json({
        error: "Mercado Pago no devolvió init_point",
        details: mpData
      }, { status: 500 });
    }

    const initPoint = mpData.init_point;
    const preapprovalId = mpData.id;

    // We must save the subscription locally as pending/created.
    // Use service_role to bypass RLS since the user is modifying subscriptions.
    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    );

    const { error: insertError } = await supabaseAdmin.from("subscriptions").upsert({
      user_id: user.id,
      mercado_pago_preapproval_id: preapprovalId,
      status: mpData.status || "pending",
      payer_email: user.email,
      amount: Number(price),
      currency: "ARS",
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

    return NextResponse.json({ init_point: initPoint });
  } catch (error: any) {
    console.error("Error in create-subscription route:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
