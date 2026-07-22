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

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!accessToken) {
      return NextResponse.json({ error: 'MERCADO_PAGO_ACCESS_TOKEN no configurado' }, { status: 500 });
    }
    if (!serviceRoleKey || !supabaseUrl) {
      return NextResponse.json({ error: 'Configuración de Supabase incompleta' }, { status: 500 });
    }

    const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey);

    // Buscar la última suscripción
    const { data: latestSub, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (subError && subError.code !== 'PGRST116') {
      console.error("Error fetching latest subscription", subError);
      return NextResponse.json({ error: 'Error interno al buscar suscripción' }, { status: 500 });
    }

    if (!latestSub) {
      return NextResponse.json({ active: false, status: 'not_found' });
    }

    const preapprovalId = latestSub.mercado_pago_preapproval_id;

    if (!preapprovalId) {
      return NextResponse.json({ active: false, status: 'not_found' });
    }

    // Consultar Mercado Pago
    const mpResponse = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      }
    });

    if (!mpResponse.ok) {
      console.error("Error consultando Mercado Pago:", mpResponse.status, await mpResponse.text());
      return NextResponse.json({ error: 'Error al consultar estado de suscripción' }, { status: 500 });
    }

    const mpSubscription = await mpResponse.json();
    const mpStatus = mpSubscription.status;

    // Actualizar subscriptions
    const subUpdates: any = {
      status: mpStatus,
      raw_data: mpSubscription,
      updated_at: new Date().toISOString()
    };

    if (mpSubscription.payer_email) {
      subUpdates.payer_email = mpSubscription.payer_email;
    }
    
    if (mpStatus === "authorized" && !latestSub.started_at) {
      subUpdates.started_at = new Date().toISOString();
    }

    if (mpSubscription.next_payment_date) {
      subUpdates.next_payment_at = mpSubscription.next_payment_date;
    }

    if ((mpStatus === "cancelled" || mpStatus === "canceled") && !latestSub.cancelled_at) {
      subUpdates.cancelled_at = new Date().toISOString();
    }

    const { error: updateSubError } = await supabaseAdmin
      .from('subscriptions')
      .update(subUpdates)
      .eq('id', latestSub.id);

    if (updateSubError) {
      console.error("Error actualizando subscription", updateSubError);
      return NextResponse.json({ error: 'Error al actualizar suscripción' }, { status: 500 });
    }

    // Actualizar perfiles
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profile) {
      const profileUpdates: any = {};
      
      if (mpStatus === "authorized") {
        profileUpdates.membership_status = "active";
        profileUpdates.membership_started_at = profile.membership_started_at || new Date().toISOString();
        if (mpSubscription.next_payment_date) {
          profileUpdates.membership_expires_at = mpSubscription.next_payment_date;
        } else {
          const expires = new Date();
          expires.setMonth(expires.getMonth() + 1);
          profileUpdates.membership_expires_at = expires.toISOString();
        }
      } else if (mpStatus === "paused") {
        profileUpdates.membership_status = "inactive";
      } else if (mpStatus === "cancelled" || mpStatus === "canceled") {
        profileUpdates.membership_status = "cancelled";
        profileUpdates.membership_expires_at = new Date().toISOString();
      }

      if (Object.keys(profileUpdates).length > 0) {
        const { error: updateProfileError } = await supabaseAdmin
          .from('profiles')
          .update(profileUpdates)
          .eq('id', user.id);
          
        if (updateProfileError) {
          console.error("Error actualizando profile", updateProfileError);
        }
      }
    }

    const isActive = mpStatus === "authorized";

    return NextResponse.json({
      active: isActive,
      status: mpStatus,
      subscription_id: latestSub.id,
      preapproval_id: preapprovalId
    });

  } catch (error: any) {
    console.error("Error in sync-subscription route:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
