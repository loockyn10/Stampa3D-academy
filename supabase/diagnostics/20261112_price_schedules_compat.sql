-- SOLO LECTURA. Ejecutar en el SQL Editor de Supabase ANTES de aplicar 20261112120000_price_schedules.sql.
-- Compara con el catálogo real los tipos y objetos que la migration espera. Devuelve una fila por control:
--   ok = true  -> coincide;  ok = false -> MISMATCH (no aplicar hasta resolverlo);  info -> dato para revisar.
-- No modifica nada, no imprime datos personales.

with expected(tbl, col, allowed_types) as (
  values
    ('invite_codes', 'id', 'uuid'),
    ('invite_codes', 'code', 'text,character varying'),
    ('invite_codes', 'status', 'text,character varying,USER-DEFINED'),
    ('discount_code_reservations', 'id', 'uuid'),
    ('discount_code_reservations', 'invite_code_id', 'uuid'),
    ('discount_code_reservations', 'user_id', 'uuid'),
    ('discount_code_reservations', 'status', 'text'),
    ('discount_code_reservations', 'base_amount', 'numeric'),
    ('discount_code_reservations', 'final_amount', 'numeric'),
    ('discount_code_reservations', 'currency', 'text'),
    ('discount_code_reservations', 'checkout_attempt_id', 'uuid'),
    ('checkout_attempts', 'id', 'uuid'),
    ('checkout_attempts', 'mercado_pago_preapproval_id', 'text,character varying'),
    ('subscriptions', 'id', 'uuid'),
    ('subscriptions', 'user_id', 'uuid'),
    ('subscriptions', 'mercado_pago_preapproval_id', 'text,character varying'),
    ('payments', 'id', 'uuid,bigint,integer,text'),
    ('payments', 'user_id', 'uuid'),
    ('payments', 'subscription_id', 'uuid'),
    ('payments', 'status', 'text,character varying,USER-DEFINED'),
    ('payments', 'amount', 'numeric,double precision,real,integer,bigint'),
    ('payments', 'paid_at', 'timestamp with time zone'),
    ('payments', 'raw_data', 'jsonb,json')
),
actual as (
  select e.tbl, e.col, e.allowed_types, c.data_type
  from expected e
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = e.tbl and c.column_name = e.col
)
select '1_COLUMNA ' || tbl || '.' || col as check_name,
       (data_type is not null and data_type = any (string_to_array(allowed_types, ','))) as ok,
       coalesce(data_type, 'NO EXISTE') || ' (esperado: ' || allowed_types || ')' as detail
from actual

union all
select '2_LA MIGRATION AÚN NO FUE APLICADA: ' || t,
       to_regclass('public.' || t) is null,
       case when to_regclass('public.' || t) is null then 'no existe (correcto)' else 'YA EXISTE: revisar antes de aplicar' end
from unnest(array['discount_code_terms', 'promo_acceptances', 'price_schedules', 'price_schedule_events']) as t

union all
select '3_FUNCIÓN LIBRE: ' || f,
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f),
       'sin colisión de nombre'
from unnest(array['promo_terms_for_code', 'record_promo_acceptance', 'ensure_price_schedule', 'sync_price_schedule',
                  'list_price_schedule_work', 'claim_price_schedule', 'finish_price_schedule', 'mark_price_notice_sent',
                  'add_price_schedule_event']) as f

union all
select '4_FUNCIONES DE DESCUENTOS PRESENTES: ' || f,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f),
       'las migrations de descuentos están aplicadas'
from unnest(array['reserve_discount_code', 'attach_discount_reservation', 'confirm_discount_reservation']) as f

union all
select '5_INFO payments: filas aprobadas con monto 9900 (referencia)',
       true,
       (select count(*)::text from public.payments where lower(coalesce(status::text, '')) = 'approved' and round(amount::numeric, 2) = 9900)

union all
select '6_INFO suscripciones authorized/pending (no se tocan)',
       true,
       (select string_agg(coalesce(status::text, 'null') || '=' || n::text, ', ') from (select status, count(*) n from public.subscriptions group by status) s)

order by 1;
