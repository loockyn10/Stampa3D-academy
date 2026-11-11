-- PRUEBA DEL CHECKOUT CON CÓDIGO DE PRECIO FIJO — ESTADO ANTES / DESPUÉS. SOLO LECTURA (una única sentencia SELECT).
--
-- Pegar COMPLETO en el SQL Editor de Supabase, editando SOLO los tres valores de la CTE `params` (marcados con «EDITAR»).
-- No cambia, crea ni borra nada. No imprime correos, ids de usuario, preapprovals ni el código: solo conteos, estados,
-- importes y huellas (md5) de las filas de OTRAS personas.
--
-- Uso (ver docs/PIONEROS_CHECKOUT_TEST_RUNBOOK.md):
--   1) ANTES de la prueba: correrlo con t0 = «ahora» (la hora justo antes de empezar). Guardar la salida (sobre todo
--      las filas 4_FINGERPRINT_OTHERS).
--   2) DESPUÉS (y en cada paso): correrlo de nuevo con el MISMO t0.
--   El «éxito» es: 3_OTHERS_TOUCHED_SINCE_T0 todo en 0 y 4_FINGERPRINT_OTHERS idéntico al de antes. Si una fila de
--   3_OTHERS no es 0 puede ser un cliente real operando a la vez (un alta o una renovación): mirarlo antes de concluir.

with
params as (
  select
    'EDITAR-correo-de-la-cuenta-de-prueba'::text as test_email,      -- EDITAR: el correo de la cuenta Universo de prueba
    'EDITAR-codigo-de-prueba'::text              as test_code,       -- EDITAR: el código de prueba (se compara sin distinguir mayúsculas)
    '2000-01-01 00:00:00-03'::timestamptz        as t0               -- EDITAR: «ahora» justo antes de empezar, p. ej. '2026-11-12 10:30:00-03'
),
tu as (select u.id from auth.users u, params p where lower(u.email) = lower(p.test_email)),
tc as (select k.id from public.invite_codes k, params p where k.code = upper(btrim(p.test_code))),
rows_all as (

  -- 0) parámetros bien cargados
  select '0_PARAMS' as section, 'test user found (expected 1)' as item, (select count(*) from tu)::text as detail
  union all select '0_PARAMS', 'test code found (expected 1)', (select count(*) from tc)::text
  union all select '0_PARAMS', 't0 set (false = edit it, section 3 would be meaningless)', ((select t0 from params) > now() - interval '30 days')::text

  -- 1) lo que le pasó a la cuenta de prueba
  union all select '1_TEST_USER', 'subscriptions',
    coalesce((select string_agg(lower(coalesce(s.status, 'null')) || ' amount=' || coalesce(s.amount::text, '-') || ' ' || coalesce(s.currency, '-'), '; ')
              from public.subscriptions s where s.user_id in (select id from tu)), '(none)')
  union all select '1_TEST_USER', 'checkout attempts',
    coalesce((select string_agg(a.state || ' amount=' || a.amount::text || ' ' || a.currency, '; ' order by a.created_at)
              from public.checkout_attempts a where a.user_id in (select id from tu)), '(none)')
  union all select '1_TEST_USER', 'payments',
    coalesce((select string_agg(lower(coalesce(p.status, 'null')) || ' amount=' || coalesce(p.amount::text, '-') || ' ' || coalesce(p.currency, '-'), '; ')
              from public.payments p where p.user_id in (select id from tu)), '(none)')
  union all select '1_TEST_USER', 'discount reservations',
    coalesce((select string_agg(r.status || ' base=' || r.base_amount::text || ' final=' || r.final_amount::text || ' over_limit=' || coalesce((to_jsonb(r) ->> 'over_limit'), 'n/a'), '; ' order by r.created_at)
              from public.discount_code_reservations r where r.user_id in (select id from tu)), '(none)')
  union all select '1_TEST_USER', 'profile membership',
    coalesce((select 'status=' || coalesce(pr.membership_status::text, 'null') || ', expires=' || coalesce(pr.membership_expires_at::date::text, 'null')
              from public.profiles pr where pr.id in (select id from tu)), '(none)')

  -- 2) el código de prueba
  union all select '2_TEST_CODE', 'code row',
    coalesce((select 'status=' || k.status::text || ', type=' || k.code_type::text || ', value=' || coalesce(k.discount_value::text, '-')
                     || ', max_uses=' || coalesce(k.max_uses::text, 'UNLIMITED') || ', used_count=' || k.used_count::text
              from public.invite_codes k where k.id in (select id from tc)), '(not found)')
  union all select '2_TEST_CODE', 'redemptions',
    (select count(*) from public.invite_code_redemptions r where r.invite_code_id in (select id from tc))::text
  union all select '2_TEST_CODE', 'reservations by status',
    coalesce((select string_agg(x.status || ': ' || x.n, ', ') from (
                select r.status, count(*) as n from public.discount_code_reservations r
                where r.invite_code_id in (select id from tc) group by r.status) x), '(none)')

  -- 3) TODO lo que cambió desde t0 y NO es de la cuenta de prueba (esperado: 0 en cada fila)
  union all select '3_OTHERS_TOUCHED_SINCE_T0', 'subscriptions updated',
    (select count(*) from public.subscriptions s, params p
     where s.updated_at >= p.t0 and not exists (select 1 from tu where tu.id = s.user_id))::text
  union all select '3_OTHERS_TOUCHED_SINCE_T0', 'payments created',
    (select count(*) from public.payments x, params p
     where x.created_at >= p.t0 and not exists (select 1 from tu where tu.id = x.user_id))::text
  union all select '3_OTHERS_TOUCHED_SINCE_T0', 'checkout attempts updated',
    (select count(*) from public.checkout_attempts a, params p
     where a.updated_at >= p.t0 and not exists (select 1 from tu where tu.id = a.user_id))::text
  union all select '3_OTHERS_TOUCHED_SINCE_T0', 'discount reservations created or released',
    (select count(*) from public.discount_code_reservations r, params p
     where greatest(r.created_at, coalesce(r.released_at, r.created_at), coalesce(r.confirmed_at, r.created_at)) >= p.t0
       and not exists (select 1 from tu where tu.id = r.user_id))::text
  union all select '3_OTHERS_TOUCHED_SINCE_T0', 'code redemptions',
    (select count(*) from public.invite_code_redemptions r, params p
     where r.redeemed_at >= p.t0 and not exists (select 1 from tu where tu.id = r.user_id))::text
  union all select '3_OTHERS_TOUCHED_SINCE_T0', 'profiles whose membership started',
    (select count(*) from public.profiles pr, params p
     where pr.membership_started_at >= p.t0 and not exists (select 1 from tu where tu.id = pr.id))::text
  union all select '3_OTHERS_TOUCHED_SINCE_T0', 'other codes with uses (sum of used_count; expected same as before)',
    coalesce((select sum(k.used_count) from public.invite_codes k where k.id not in (select id from tc)), 0)::text

  -- 4) huella de las filas de OTRAS personas: debe ser IDÉNTICA antes y después (solo columnas estables, no updated_at)
  union all select '4_FINGERPRINT_OTHERS', 'subscriptions (count | md5 of id,status,amount,preapproval)',
    (select count(*)::text || ' | ' || coalesce(md5(string_agg(s.id::text || '|' || lower(coalesce(s.status, '')) || '|' || coalesce(s.amount::text, '') || '|' || coalesce(s.mercado_pago_preapproval_id, ''), ',' order by s.id)), '-')
     from public.subscriptions s where not exists (select 1 from tu where tu.id = s.user_id))
  union all select '4_FINGERPRINT_OTHERS', 'authorized subscriptions by amount',
    coalesce((select string_agg(x.amount || ' x' || x.n, ', ' order by x.amount) from (
                select coalesce(s.amount::text, 'null') as amount, count(*) as n from public.subscriptions s
                where lower(coalesce(s.status, '')) = 'authorized' and not exists (select 1 from tu where tu.id = s.user_id)
                group by 1) x), '(none)')
  union all select '4_FINGERPRINT_OTHERS', 'checkout attempts (count | md5 of id,state,amount,preapproval)',
    (select count(*)::text || ' | ' || coalesce(md5(string_agg(a.id::text || '|' || a.state || '|' || a.amount::text || '|' || coalesce(a.mercado_pago_preapproval_id, ''), ',' order by a.id)), '-')
     from public.checkout_attempts a where not exists (select 1 from tu where tu.id = a.user_id))
  union all select '4_FINGERPRINT_OTHERS', 'invite codes except the test code (count | md5 of id,status,used_count,max_uses)',
    (select count(*)::text || ' | ' || coalesce(md5(string_agg(k.id::text || '|' || k.status::text || '|' || k.used_count::text || '|' || coalesce(k.max_uses::text, ''), ',' order by k.id)), '-')
     from public.invite_codes k where k.id not in (select id from tc))

  -- 5) notificaciones de Mercado Pago recibidas desde t0 (conteos; no se pueden atribuir a una persona sin leer payloads)
  union all select '5_WEBHOOK_EVENTS_SINCE_T0', e.event_type || ' processed=' || e.processed::text, count(*)::text
  from public.mercado_pago_webhook_events e, params p
  where coalesce((to_jsonb(e) ->> 'created_at')::timestamptz, now()) >= p.t0
  group by e.event_type, e.processed
)
select section, item, detail from rows_all order by section, item;
