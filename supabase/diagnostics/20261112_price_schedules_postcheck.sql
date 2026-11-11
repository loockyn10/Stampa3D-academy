-- SOLO LECTURA. Ejecutar DESPUÉS de aplicar 20261112120000_price_schedules.sql.
-- Todas las filas deben dar ok = true. No modifica nada, no imprime datos personales.

select '1_TABLA ' || t as check_name,
       to_regclass('public.' || t) is not null as ok,
       'existe' as detail
from unnest(array['discount_code_terms', 'promo_acceptances', 'price_schedules', 'price_schedule_events']) as t

union all
select '2_RLS ' || c.relname, c.relrowsecurity, 'row level security activa'
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('discount_code_terms', 'promo_acceptances', 'price_schedules', 'price_schedule_events')

union all
select '3_SIN ACCESO PARA anon/authenticated (escritura) ' || t,
       not exists (
         select 1 from information_schema.role_table_grants g
         where g.table_schema = 'public' and g.table_name = t
           and g.grantee in ('anon', 'authenticated') and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
       ),
       'ni anon ni authenticated pueden escribir'
from unnest(array['discount_code_terms', 'promo_acceptances', 'price_schedules', 'price_schedule_events']) as t

union all
select '4_FUNCIÓN SOLO service_role: ' || p.proname,
       has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('authenticated', p.oid, 'execute'),
       'execute solo para service_role'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('promo_terms_for_code', 'record_promo_acceptance', 'ensure_price_schedule', 'sync_price_schedule',
                    'list_price_schedule_work', 'claim_price_schedule', 'finish_price_schedule', 'mark_price_notice_sent',
                    'add_price_schedule_event')

union all
select '5_TRIGGERS DE INMUTABILIDAD ' || tg.tgname, true, 'presente'
from pg_trigger tg
where not tg.tgisinternal
  and tg.tgname in ('price_schedules_guard_trg', 'promo_acceptances_guard_trg', 'discount_code_terms_guard_trg', 'price_schedule_events_guard_trg')

union all
select '6_SIN DATOS TODAVÍA (la migration no crea filas)',
       (select count(*) from public.price_schedules) = 0 and (select count(*) from public.discount_code_terms) = 0,
       'price_schedules=' || (select count(*)::text from public.price_schedules) || ', terms=' || (select count(*)::text from public.discount_code_terms)

order by 1;
