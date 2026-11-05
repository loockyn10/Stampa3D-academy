-- Incidente P0 2026-11-05 — pago aprobado sin Premium. SOLO LECTURA: no modifica filas, policies ni privilegios.
-- No devuelve emails ni datos de tarjeta. Correr bloque por bloque en el SQL Editor (muestra solo el último resultado).
-- Preapprovals del incidente:
--   1) 6248ec22c52f4079b9a3894c16a9583e  (checkout dc7cc1e5-…, MP: cancelled, charged_amount 250)
--   2) 58a1029cc7ee43ed9e086b08c9476195  (checkout b7dcb085-…, MP: cancelled, charged_amount 0)

-- A. Filas locales de las dos suscripciones (status, fechas y lo que MP informó como cobrado en el último snapshot).
select s.id as subscription_id, s.user_id, s.mercado_pago_preapproval_id, s.status, s.created_at, s.updated_at,
       s.started_at, s.cancelled_at, s.next_payment_at,
       s.raw_data -> 'summarized' ->> 'charged_amount' as mp_charged_amount_snapshot,
       s.raw_data -> 'summarized' ->> 'last_charged_date' as mp_last_charged_snapshot
from public.subscriptions s
where s.mercado_pago_preapproval_id in ('6248ec22c52f4079b9a3894c16a9583e', '58a1029cc7ee43ed9e086b08c9476195')
order by s.created_at;

-- B. Pagos registrados para esas suscripciones (esperado ANTES del fix: ninguno `approved` para la 1).
select p.id, p.subscription_id, p.mercado_pago_payment_id, p.mercado_pago_preapproval_id, p.status, p.amount,
       p.paid_at, p.created_at, p.raw_data -> 'payment' ->> 'status' as installment_payment_status
from public.payments p
where p.mercado_pago_preapproval_id in ('6248ec22c52f4079b9a3894c16a9583e', '58a1029cc7ee43ed9e086b08c9476195')
   or p.subscription_id in (select id from public.subscriptions
                            where mercado_pago_preapproval_id in ('6248ec22c52f4079b9a3894c16a9583e', '58a1029cc7ee43ed9e086b08c9476195'))
order by p.created_at;

-- C. Notificaciones de Mercado Pago recibidas el 5/11 (¿llegó el webhook? ¿con qué resultado?).
--    data_id es el id de la preapproval (subscription_preapproval), de la cuota (subscription_authorized_payment) o
--    del pago (payment). Si no hay NINGUNA fila de las 17:13Z en adelante: el webhook no llegó o fue rechazado por
--    firma (401: no se persiste; buscar en Vercel el log "invalid or missing signature", que agrega este fix).
select e.id, e.event_type, e.action, e.data_id, e.processed, left(coalesce(e.error_message, ''), 160) as error,
       (to_jsonb(e) ->> 'created_at') as created_at
from public.mercado_pago_webhook_events e
where coalesce((to_jsonb(e) ->> 'created_at')::timestamptz, now()) between '2026-11-05 17:00:00+00' and '2026-11-06 06:00:00+00'
order by (to_jsonb(e) ->> 'created_at');

-- D. Intentos de checkout del usuario y membresía actual de su perfil (solo columnas de membresía).
select a.id as attempt_id, a.state, a.provider_status, a.last_error_code, a.mercado_pago_preapproval_id,
       a.subscription_id, a.created_at, a.completed_at, a.closed_at,
       pr.membership_status, pr.membership_expires_at, pr.membership_started_at
from public.checkout_attempts a
join public.profiles pr on pr.id = a.user_id
where a.user_id = (select user_id from public.checkout_attempts where id = 'dc7cc1e5-50d6-460e-a6a9-b17c9620d359')
order by a.created_at;

-- E. Accesos alternativos del usuario (grants), para descartar que otra fuente explique el estado.
select g.grant_type, g.status, g.expires_at
from public.user_access_grants g
where g.user_id = (select user_id from public.checkout_attempts where id = 'dc7cc1e5-50d6-460e-a6a9-b17c9620d359');
