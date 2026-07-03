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

    const price = process.env.MEMBERSHIP_MONTHLY_PRICE || "15000";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    if (!accessToken) {
      return NextResponse.json({ error: 'Mercado Pago token not configured' }, { status: 500 });
    }

    // Call Mercado Pago API to create preapproval (subscription)
    const payload = {
      reason: "Membresía Stampa3D Academy",
      external_reference: user.id,
      payer_email: user.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: parseInt(price, 10),
        currency_id: "ARS"
      },
      back_url: `${appUrl}/perfil`
    };

    const mpResponse = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload)
    });

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("Error from Mercado Pago:", mpData);
      return NextResponse.json({ error: 'Failed to create subscription in Mercado Pago' }, { status: 500 });
    }

    const initPoint = mpData.init_point;
    const preapprovalId = mpData.id;

    // We must save the subscription locally as pending/created.
    // Use service_role to bypass RLS since the user is modifying subscriptions.
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Supabase Service Role Key not configured' }, { status: 500 });
    }

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    );

    const { error: insertError } = await supabaseAdmin.from("subscriptions").upsert({
      user_id: user.id,
      mercado_pago_subscription_id: preapprovalId,
      status: "pending", // we wait for webhook to set it to authorized
      amount: parseInt(price, 10),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });

    if (insertError) {
      console.error("Error saving subscription to DB:", insertError);
      return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
    }

    return NextResponse.json({ init_point: initPoint });
  } catch (error: any) {
    console.error("Error in create-subscription route:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
