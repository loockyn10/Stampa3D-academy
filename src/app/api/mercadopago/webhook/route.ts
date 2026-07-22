import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  let webhookEventId: string | null = null;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceRoleKey || !supabaseUrl) {
    console.error("Faltan variables de entorno de Supabase en webhook");
    return NextResponse.json({ error: "Configuración incompleta" }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const url = new URL(request.url);
    const searchParams = url.searchParams;
    let payload: any = {};
    
    try {
      payload = await request.json();
    } catch (e) {
      // Body vacío o inválido, payload seguirá siendo {}
    }

    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    const signatureHeader = request.headers.get('x-signature');
    const xRequestId = request.headers.get('x-request-id') || '';

    const eventType = payload.type || payload.topic || searchParams.get('topic') || searchParams.get('type') || null;
    const action = payload.action || searchParams.get('action') || null;
    const dataId = payload.data?.id || payload.id || searchParams.get('data.id') || searchParams.get('id') || null;

    // 1. Guardar evento crudo siempre
    const { data: insertedEvent, error: insertError } = await supabaseAdmin
      .from('mercado_pago_webhook_events')
      .insert({
        event_type: eventType ? String(eventType) : null,
        action: action ? String(action) : null,
        data_id: dataId ? String(dataId) : null,
        processed: false,
        payload: payload,
        error_message: null
      })
      .select('id')
      .single();

    if (insertError) {
      console.error("Error guardando webhook event:", insertError);
    } else if (insertedEvent) {
      webhookEventId = insertedEvent.id;
    }

    // 2. Validación de firma
    if (!secret) {
      console.warn("Webhook recibido sin validación de firma porque no hay secret configurado");
    } else if (signatureHeader) {
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
        throw new Error("Firma de webhook inválida");
      }
    }

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("MERCADO_PAGO_ACCESS_TOKEN no configurado");
    }

    if (!dataId) {
      // Retornamos 200 porque recibimos bien, pero no hay data
      throw new Error("Missing data.id o id en el payload del webhook");
    }

    // 3. Procesamiento según event type
    if (eventType === 'subscription_preapproval') {
      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${dataId}`, {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      
      if (!mpRes.ok) {
        throw new Error(`Error al consultar preapproval en MP: ${mpRes.status}`);
      }

      const preapproval = await mpRes.json();
      const status = preapproval.status;
      const externalReference = preapproval.external_reference; 
      const nextPaymentDate = preapproval.next_payment_date;

      let userId = externalReference;
      let subscriptionId = null;

      // Buscar subscription (Fallback si external_reference falla o para tener el ID local)
      const { data: existingSub } = await supabaseAdmin
        .from('subscriptions')
        .select('id, user_id, started_at, cancelled_at, next_payment_at')
        .eq('mercado_pago_preapproval_id', String(preapproval.id))
        .single();

      if (existingSub) {
        subscriptionId = existingSub.id;
        if (!userId) userId = existingSub.user_id;
      }

      if (userId) {
        // Actualizar subscriptions
        const subUpdates: any = {
          user_id: userId,
          mercado_pago_preapproval_id: String(preapproval.id),
          status: status,
          payer_email: preapproval.payer_email || null,
          raw_data: preapproval,
          updated_at: new Date().toISOString()
        };

        if (preapproval.auto_recurring) {
          subUpdates.amount = preapproval.auto_recurring.transaction_amount;
          subUpdates.currency = preapproval.auto_recurring.currency_id;
        }

        if (status === "authorized" && (!existingSub || !existingSub.started_at)) {
          subUpdates.started_at = new Date().toISOString();
        }
        if (nextPaymentDate) {
          subUpdates.next_payment_at = nextPaymentDate;
        }
        if ((status === "cancelled" || status === "canceled") && (!existingSub || !existingSub.cancelled_at)) {
          subUpdates.cancelled_at = new Date().toISOString();
        }

        if (subscriptionId) {
          await supabaseAdmin.from('subscriptions').update(subUpdates).eq('id', subscriptionId);
        } else {
          // No encontró sub previa, intentamos un upsert
          await supabaseAdmin.from('subscriptions').upsert(subUpdates, { onConflict: 'mercado_pago_preapproval_id' });
        }

        // Actualizar profiles
        const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
        if (profile) {
          const profileUpdates: any = {};
          
          let paidUntil: Date | null = null;
          if (profile.membership_expires_at && new Date(profile.membership_expires_at).getTime() > Date.now()) {
            paidUntil = new Date(profile.membership_expires_at);
          } else if (existingSub?.next_payment_at && new Date(existingSub.next_payment_at).getTime() > Date.now()) {
            paidUntil = new Date(existingSub.next_payment_at);
          } else if (nextPaymentDate && new Date(nextPaymentDate).getTime() > Date.now()) {
            paidUntil = new Date(nextPaymentDate);
          }

          if (status === "authorized") {
            profileUpdates.membership_status = "active";
            profileUpdates.membership_started_at = profile.membership_started_at || new Date().toISOString();
            if (nextPaymentDate) {
              profileUpdates.membership_expires_at = nextPaymentDate;
            } else {
              const nextMonth = new Date();
              nextMonth.setMonth(nextMonth.getMonth() + 1);
              profileUpdates.membership_expires_at = nextMonth.toISOString();
            }
          } else if (status === "paused" || status === "cancelled" || status === "canceled") {
            if (paidUntil && paidUntil.getTime() > Date.now()) {
              profileUpdates.membership_status = "active";
              profileUpdates.membership_expires_at = paidUntil.toISOString();
            } else {
              profileUpdates.membership_status = status === "paused" ? "inactive" : "expired";
              profileUpdates.membership_expires_at = new Date().toISOString();
            }
          }

          if (Object.keys(profileUpdates).length > 0) {
            await supabaseAdmin.from('profiles').update(profileUpdates).eq('id', userId);
          }
        }
      } else {
         console.warn(`No se pudo resolver el user_id para el preapproval ${preapproval.id}`);
      }

    } else if (eventType === 'subscription_authorized_payment') {
      const mpRes = await fetch(`https://api.mercadopago.com/authorized_payments/${dataId}`, {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      
      if (!mpRes.ok) {
        throw new Error(`Error al consultar authorized_payment en MP: ${mpRes.status}`);
      }

      const authorizedPayment = await mpRes.json();
      const preapprovalId = authorizedPayment.preapproval_id;

      if (preapprovalId) {
        // Buscar la subscription asociada para ligar el pago al user_id correcto
        const { data: sub } = await supabaseAdmin
          .from('subscriptions')
          .select('id, user_id')
          .eq('mercado_pago_preapproval_id', String(preapprovalId))
          .single();

        if (sub) {
          // Guardar el pago
          await supabaseAdmin.from('payments').insert({
            user_id: sub.user_id,
            subscription_id: sub.id,
            mercado_pago_payment_id: String(authorizedPayment.id),
            mercado_pago_preapproval_id: String(preapprovalId),
            status: authorizedPayment.status,
            amount: authorizedPayment.transaction_amount,
            currency: authorizedPayment.currency_id,
            paid_at: authorizedPayment.date_created || authorizedPayment.date_last_updated || new Date().toISOString(),
            raw_data: authorizedPayment,
            created_at: new Date().toISOString()
          });

          // Si el cobro está aprobado/procesado, garantizar que la membresía se mantenga activa un mes más
          const status = authorizedPayment.status;
          if (status === "approved" || status === "authorized" || status === "processed") {
            const nextPaymentDate = authorizedPayment.next_payment_date; // Aunque authorized_payments a veces no lo trae
            const profileUpdates: any = {
              membership_status: "active"
            };
            if (nextPaymentDate) {
              profileUpdates.membership_expires_at = nextPaymentDate;
            } else {
              const nextMonth = new Date();
              nextMonth.setMonth(nextMonth.getMonth() + 1);
              profileUpdates.membership_expires_at = nextMonth.toISOString();
            }
            await supabaseAdmin.from('profiles').update(profileUpdates).eq('id', sub.user_id);
          }
        } else {
           console.warn(`No se encontró subscription para el preapprovalId ${preapprovalId} del authorized payment`);
        }
      } else {
         console.warn(`Authorized payment ${dataId} no tiene preapproval_id`);
      }

    } else if (eventType === 'payment') {
      // Legacy payment handling
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });

      if (!mpRes.ok) {
        throw new Error(`Error al consultar v1/payments en MP: ${mpRes.status}`);
      }

      const payData = await mpRes.json();
      const externalReference = payData.external_reference; // user_id in legacy setup
      
      if (externalReference && payData.status === "approved") {
        const { data: existingPay } = await supabaseAdmin.from("payments")
          .select("id")
          .eq("mercado_pago_payment_id", String(payData.id))
          .single();
          
        if (!existingPay) {
           await supabaseAdmin.from("payments").insert({
              user_id: externalReference,
              mercado_pago_payment_id: String(payData.id),
              status: payData.status,
              amount: payData.transaction_amount,
              currency: payData.currency_id,
              paid_at: payData.date_approved || new Date().toISOString(),
              raw_data: payData,
              created_at: new Date().toISOString()
           });
           
           // Legacy profile update
           const { data: prof } = await supabaseAdmin.from("profiles").select("membership_started_at").eq("id", externalReference).single();
           if (prof) {
              const updatePayload: any = {
                membership_status: "active",
                updated_at: new Date().toISOString()
              };
              if (!prof.membership_started_at) {
                updatePayload.membership_started_at = new Date().toISOString();
              }
              const nextMonth = new Date();
              nextMonth.setMonth(nextMonth.getMonth() + 1);
              updatePayload.membership_expires_at = nextMonth.toISOString();
              
              await supabaseAdmin.from("profiles").update(updatePayload).eq("id", externalReference);
           }
        }
      }
    }

    // 4. Marcar evento como procesado correctamente
    if (webhookEventId) {
      await supabaseAdmin
        .from('mercado_pago_webhook_events')
        .update({
          processed: true,
          error_message: null
        })
        .eq('id', webhookEventId);
    }

    // Retornamos 200 siempre al final de un procesamiento exitoso o un evento ignorado
    return NextResponse.json({ success: true, message: "Webhook processed" });

  } catch (error: any) {
    console.error("Webhook processing error:", error);
    
    // Marcar evento con error si pudimos guardarlo al principio
    if (webhookEventId) {
      await supabaseAdmin
        .from('mercado_pago_webhook_events')
        .update({
          processed: false,
          error_message: error.message || "Unknown error"
        })
        .eq('id', webhookEventId);
    }

    // Retornamos 200 para evitar que Mercado Pago reintente infinitamente
    // si recibimos la solicitud correctamente pero falló la lógica interna.
    return NextResponse.json({ success: false, error: error.message }, { status: 200 });
  }
}
