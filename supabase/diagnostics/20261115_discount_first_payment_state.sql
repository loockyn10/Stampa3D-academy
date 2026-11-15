-- SOLO LECTURA. Antes y después de aplicar 20261115120000_discount_confirm_on_first_payment.sql.
-- Correr cada bloque por separado en el SQL Editor (muestra solo el último resultado). No modifica nada.

-- A. Dependencias de la migration: deben dar true las cuatro filas.
select 'payments.subscription_id' as check, exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='subscription_id') as ok
union all select 'payments.status', exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='status')
union all select 'subscriptions.mercado_pago_preapproval_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name='mercado_pago_preapproval_id')
union all select 'discount consistency applied', to_regprocedure('public.discount_reservation_holds_seat(text,uuid,timestamptz,timestamptz)') is not null;

-- B. Reservas YA confirmadas bajo la regla anterior (al autorizar) sin ningún pago aprobado.
--    La migration no las toca: quedan confirmadas. Revisar a mano si alguna debería devolverse (decisión comercial).
select r.id as reservation_id, k.code, r.user_id, r.confirmed_at, a.mercado_pago_preapproval_id, s.status as subscription_status
from public.discount_code_reservations r
join public.invite_codes k on k.id = r.invite_code_id
left join public.checkout_attempts a on a.id = r.checkout_attempt_id
left join public.subscriptions s on s.mercado_pago_preapproval_id = a.mercado_pago_preapproval_id
where r.status = 'confirmed'
  and not exists (
    select 1 from public.payments p
    where p.subscription_id = s.id and lower(coalesce(p.status, '')) = 'approved'
  )
order by r.confirmed_at;

-- C. Reservas abiertas que hoy ocupan cupo, con el estado de su suscripción (pending = nunca autorizada).
select k.code, r.id as reservation_id, r.created_at, a.state as attempt_state, s.status as subscription_status, a.created_at as checkout_created_at
from public.discount_code_reservations r
join public.invite_codes k on k.id = r.invite_code_id
left join public.checkout_attempts a on a.id = r.checkout_attempt_id
left join public.subscriptions s on s.id = a.subscription_id
where r.status = 'reserved'
order by r.created_at;

-- D. Después de aplicar: cupos por código (pagados / reservados / disponibles).
-- select * from public.discount_code_seat_summary() order by code;
