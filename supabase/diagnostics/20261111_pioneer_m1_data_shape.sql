-- Edición Pioneros — M1: FORMA DE LOS DATOS REALES que M1 va a leer. SOLO LECTURA (únicamente SELECT). Ejecutar ANTES de
-- aplicar M1, después de 20261111_pioneer_m1_compat.sql.
--
-- No imprime datos personales: ni ids, ni correos, ni preapprovals. Solo valores de catálogo (estados, monedas) con su
-- cantidad, y conteos. Sirve para confirmar que M1 interpreta bien lo que hoy guarda la app:
--   * M1 reconoce un cobro cuando payments.status es exactamente 'approved' (minúsculas) y el importe/moneda coinciden;
--   * considera cancelada una suscripción cuando subscriptions.status es 'cancelled' (o 'canceled');
--   * considera viva ('authorized', 'active', 'paused') a la persona que ya tiene una suscripción.

select area, value, n
from (
  select 10 as ord, 'payments.status' as area, coalesce(status::text, '(null)') as value, count(*) as n
  from public.payments group by status
  union all
  select 11, 'payments.status: variantes de "approved" que M1 NO reconocería',
         status::text, count(*) from public.payments
  where lower(coalesce(status::text, '')) = 'approved' and status::text <> 'approved' group by status
  union all
  select 20, 'payments.currency', coalesce(currency::text, '(null)'), count(*) from public.payments group by currency
  union all
  select 30, 'payments approved sin user_id o sin subscription_id (M1 no los puede asociar)', 'filas',
         count(*) from public.payments
  where lower(coalesce(status::text, '')) = 'approved' and (user_id is null or subscription_id is null)
  union all
  select 31, 'payments approved con más de 2 decimales (M1 redondea a 2)', 'filas',
         count(*) from public.payments
  where lower(coalesce(status::text, '')) = 'approved' and round(amount::numeric, 2) <> amount::numeric
  union all
  select 40, 'payments approved por importe', coalesce(round(amount::numeric, 2)::text, '(null)'), count(*)
  from public.payments where lower(coalesce(status::text, '')) = 'approved' group by round(amount::numeric, 2)
  union all
  select 50, 'subscriptions.status', coalesce(status::text, '(null)'), count(*) from public.subscriptions group by status
  union all
  select 51, 'subscriptions.status: ortografía "canceled" (con una sola l)', 'filas',
         count(*) from public.subscriptions where lower(coalesce(status::text, '')) = 'canceled'
  union all
  select 52, 'subscriptions.currency', coalesce(currency::text, '(null)'), count(*) from public.subscriptions group by currency
  union all
  select 53, 'subscriptions por importe (autorizadas)', coalesce(amount::text, '(null)'), count(*)
  from public.subscriptions where lower(coalesce(status::text, '')) = 'authorized' group by amount
  union all
  select 54, 'subscriptions con preapproval repetido', 'preapprovals', count(*)
  from (
    select mercado_pago_preapproval_id from public.subscriptions
    where mercado_pago_preapproval_id is not null group by 1 having count(*) > 1
  ) d
  union all
  select 60, 'checkout_attempts.state', coalesce(state::text, '(null)'), count(*) from public.checkout_attempts group by state
  union all
  select 70, 'founder_members.status', coalesce(status::text, '(null)'), count(*) from public.founder_members group by status
  union all
  select 71, 'founder_members con pagos aprobados (informativo)', 'personas',
         count(distinct f.user_id) from public.founder_members f
         join public.payments p on p.user_id = f.user_id and lower(coalesce(p.status::text, '')) = 'approved'
) s
order by ord, value;
