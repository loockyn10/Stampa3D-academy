import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getMembershipCheckoutPrice } from '@/lib/founder-pricing';

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

    if (!accessToken) return NextResponse.json({ error: 'MERCADO_PAGO_ACCESS_TOKEN no configurado' }, { status: 500 });
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

    const normalPrice = settings?.monthly_price
      ? Number(settings.monthly_price)
      : Number(fallbackPrice);
    const currency = settings?.currency || "ARS";

    if (!normalPrice || isNaN(normalPrice) || normalPrice <= 0) {
      return NextResponse.json({ error: 'Precio de membresía inválido o no configurado' }, { status: 500 });
    }

    // ── Get dynamic price (founder slot or normal) ────────────────
    const pricing = await getMembershipCheckoutPrice(supabaseAdmin, user.id, normalPrice, currency);

    console.log('[create-subscription] Pricing resolved:', {
      userId: user.id,
      price: pricing.price,
      isFounderPrice: pricing.isFounderPrice,
      founderNumber: pricing.founderNumber,
      founderTierName: pricing.founderTierName,
    });

    // Build subscription reason
    let reason = "Membresía Academia Stampa";
    if (pricing.isFounderPrice && pricing.founderTierName) {
      reason = `Membresía Fundadora #${pricing.founderNumber} — ${pricing.founderTierName}`;
    }

    const payload = {
      reason,
      external_reference: user.id,
      payer_email: user.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: Number(pricing.price),
        currency_id: pricing.currency
      },
      back_url: new URL("/pago/estado", process.env.NEXT_PUBLIC_APP_URL!).toString(),
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

    // Save subscription with founder metadata in raw_data
    const { error: insertError } = await supabaseAdmin.from("subscriptions").upsert({
      user_id: user.id,
      mercado_pago_preapproval_id: preapprovalId,
      status: mpData.status || "pending",
      payer_email: user.email,
      amount: Number(pricing.price),
      currency: pricing.currency,
      raw_data: {
        ...mpData,
        founder_number: pricing.founderNumber,
        founder_tier: pricing.founderTierName,
        is_founder_price: pricing.isFounderPrice,
      },
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
      is_founder_price: pricing.isFounderPrice,
      founder_number: pricing.founderNumber,
      founder_tier: pricing.founderTierName,
      price: pricing.price,
    });
  } catch (error: any) {
    console.error("Error in create-subscription route:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
