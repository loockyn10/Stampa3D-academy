-- Sprint 1 — estado del circuito de membresías (SOLO LECTURA; no devuelve emails ni datos de pago).
-- Correr en el SQL Editor del proyecto. Cada bloque es independiente: el SQL Editor muestra solo el último resultado,
-- así que conviene ejecutarlos de a uno. Nada de este archivo modifica filas, policies ni privilegios.

-- A. Columnas que usa el código (todas deben figurar con exists = true).
select c.table_name, c.column_name,
       exists (select 1 from information_schema.columns i
               where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = c.column_name) as exists
from (values
  ('subscriptions','id'),('subscriptions','user_id'),('subscriptions','mercado_pago_preapproval_id'),('subscriptions','status'),
  ('subscriptions','payer_email'),('subscriptions','amount'),('subscriptions','currency'),('subscriptions','raw_data'),
  ('subscriptions','next_payment_at'),('subscriptions','started_at'),('subscriptions','cancelled_at'),
  ('subscriptions','created_at'),('subscriptions','updated_at'),
  ('payments','id'),('payments','user_id'),('payments','subscription_id'),('payments','mercado_pago_payment_id'),
  ('payments','mercado_pago_preapproval_id'),('payments','status'),('payments','amount'),('payments','currency'),
  ('payments','paid_at'),('payments','raw_data'),('payments','created_at'),
  ('checkout_attempts','external_reference'),('checkout_attempts','user_id'),('checkout_attempts','mercado_pago_preapproval_id'),
  ('mercado_pago_webhook_events','id'),('mercado_pago_webhook_events','event_type'),('mercado_pago_webhook_events','action'),
  ('mercado_pago_webhook_events','data_id'),('mercado_pago_webhook_events','processed'),
  ('mercado_pago_webhook_events','payload'),('mercado_pago_webhook_events','error_message'),
  ('profiles','membership_status'),('profiles','membership_expires_at'),('profiles','membership_started_at')
) as c(table_name, column_name)
order by exists, c.table_name, c.column_name;

-- B. Privilegios de service_role (el webhook y la sincronización escriben con service_role). Todo debe ser true.
select t.table_name,
       has_table_privilege('service_role', 'public.' || t.table_name, 'SELECT') as can_select,
       has_table_privilege('service_role', 'public.' || t.table_name, 'INSERT') as can_insert,
       has_table_privilege('service_role', 'public.' || t.table_name, 'UPDATE') as can_update
from (values ('subscriptions'), ('payments'), ('checkout_attempts'), ('mercado_pago_webhook_events'), ('profiles'), ('founder_members')) as t(table_name)
where to_regclass('public.' || t.table_name) is not null;

-- C. Restricciones únicas (informativo: el código funciona con o sin ellas; si existen, evitan filas duplicadas).
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'u' and conrelid in ('public.subscriptions'::regclass, 'public.payments'::regclass);

-- D. Notificaciones con error en los últimos 7 días (revisar a diario durante el lanzamiento).
select event_type, left(coalesce(error_message, ''), 80) as error, count(*) as events
from public.mercado_pago_webhook_events
where processed = false
  and coalesce((to_jsonb(mercado_pago_webhook_events) ->> 'created_at')::timestamptz, now()) > now() - interval '7 days'
group by 1, 2
order by events desc;

-- E. Estado de suscripciones y pagos (conteos, sin datos personales).
select 'subscriptions' as source, lower(coalesce(status, 'null')) as status, count(*) from public.subscriptions group by 2
union all
select 'payments', lower(coalesce(status, 'null')), count(*) from public.payments group by 2
order by 1, 3 desc;

-- F. Consistencia: perfiles con membresía vigente sin ningún cobro aprobado (deben ser accesos otorgados a mano;
--    revisar uno por uno). Solo ids.
select p.id as user_id, p.membership_expires_at,
       exists (select 1 from public.subscriptions s where s.user_id = p.id and lower(s.status) = 'authorized') as has_authorized_subscription
from public.profiles p
where p.membership_status = 'active'
  and (p.membership_expires_at is null or p.membership_expires_at > now())
  and not exists (select 1 from public.payments pay where pay.user_id = p.id and lower(pay.status) = 'approved')
order by p.membership_expires_at nulls first;

-- G. Suscripciones legacy sin checkout_attempts (informativo: se siguen atribuyendo por su fila local en subscriptions).
select s.id, s.status, s.created_at
from public.subscriptions s
where s.mercado_pago_preapproval_id is not null
  and not exists (select 1 from public.checkout_attempts a where a.mercado_pago_preapproval_id = s.mercado_pago_preapproval_id)
order by s.created_at desc
limit 50;
