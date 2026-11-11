import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { applyListPriceToExisting, createMercadoPagoPriceGateway } from '@/lib/mercadopago/membership-price-update';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
    }

    const { new_price, apply_to_existing, notes } = body;

    if (!new_price || isNaN(Number(new_price)) || Number(new_price) <= 0) {
      return NextResponse.json({ error: 'Precio inválido' }, { status: 400 });
    }

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!serviceRoleKey || !supabaseUrl) {
      return NextResponse.json({ error: 'Configuración de Supabase incompleta' }, { status: 500 });
    }

    if (apply_to_existing && !accessToken) {
      return NextResponse.json({ error: 'Falta MERCADO_PAGO_ACCESS_TOKEN para actualizar suscripciones' }, { status: 500 });
    }

    const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey);

    // Leer precio anterior
    const { data: currentSettings } = await supabaseAdmin
      .from('membership_settings')
      .select('monthly_price, currency')
      .eq('id', 'default')
      .single();

    const previous_price = currentSettings?.monthly_price || Number(process.env.MEMBERSHIP_MONTHLY_PRICE) || 0;
    const currency = 'ARS';

    // Sin un precio de lista anterior confiable no se puede saber qué suscripciones son «regulares»: no se cambia nada.
    if (apply_to_existing && !(Number(previous_price) > 0)) {
      return NextResponse.json(
        { error: 'No se conoce el precio de lista anterior: no se puede aplicar el cambio a suscripciones existentes.' },
        { status: 409 },
      );
    }

    // Actualizar membership_settings
    const { error: upsertError } = await supabaseAdmin
      .from('membership_settings')
      .upsert({
        id: 'default',
        monthly_price: Number(new_price),
        currency: currency,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (upsertError) {
      console.error('Error updating membership_settings:', upsertError);
      return NextResponse.json({ error: 'Error al actualizar membership_settings: ' + upsertError.message }, { status: 500 });
    }

    let affected_subscriptions = 0;
    let failed_subscriptions = 0;
    let skipped_subscriptions = 0;
    let skipped_by_reason: Record<string, number> = {};
    let raw_results: Array<{ id: string; outcome: string; reason?: string; httpStatus?: number }> = [];

    if (apply_to_existing) {
      // Only subscriptions that provably pay the PREVIOUS list price are repriced (see membership-price-update.ts):
      // promotional prices, discounted checkouts and internal test subscriptions keep their amount.
      const { data: activeSubs } = await supabaseAdmin
        .from('subscriptions')
        .select('id, mercado_pago_preapproval_id, amount')
        .eq('status', 'authorized')
        .not('mercado_pago_preapproval_id', 'is', null);

      const summary = await applyListPriceToExisting({
        previousPrice: Number(previous_price),
        newPrice: Number(new_price),
        currency,
        subscriptions: (activeSubs ?? []).map((sub) => ({
          id: String(sub.id),
          preapprovalId: String(sub.mercado_pago_preapproval_id),
          localAmount: sub.amount,
        })),
        gateway: createMercadoPagoPriceGateway(accessToken as string),
        onUpdated: async (subscriptionId, amount, subscriptionCurrency) => {
          await supabaseAdmin
            .from('subscriptions')
            .update({ amount, currency: subscriptionCurrency, updated_at: new Date().toISOString() })
            .eq('id', subscriptionId);
        },
      });

      affected_subscriptions = summary.updated;
      failed_subscriptions = summary.failed;
      skipped_subscriptions = summary.skipped;
      skipped_by_reason = summary.skippedByReason;
      raw_results = summary.items;
    }

    const { error: historyError } = await supabaseAdmin.from('membership_price_history').insert({
      previous_price,
      new_price: Number(new_price),
      currency,
      changed_by: user.id,
      apply_to_existing: Boolean(apply_to_existing),
      affected_subscriptions,
      created_at: new Date().toISOString()
    });

    if (historyError) {
      console.error('Error inserting into membership_price_history:', historyError);
      return NextResponse.json({ error: 'Error guardando en el historial: ' + historyError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      previous_price,
      new_price: Number(new_price),
      apply_to_existing: Boolean(apply_to_existing),
      affected_subscriptions,
      failed_subscriptions,
      skipped_subscriptions,
      skipped_by_reason,
      results: raw_results
    });

  } catch (error: any) {
    console.error('Error updating membership price:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
