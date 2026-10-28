-- DISCOUNT CODES IN THE CHECKOUT — READ-ONLY DIAGNOSTIC
--
-- Paste this WHOLE file into the Supabase SQL Editor. It is a SINGLE SELECT: it changes nothing, creates nothing
-- and never prints a code, an email or a user id (only counts, catalog definitions and yes/no verdicts).
-- One result grid -> copy all rows (section | item | detail) back.
--
-- Run it BEFORE applying supabase/migrations/20261029120000_discount_code_checkout.sql and again after.
-- Business tables are read through query_to_xml(), guarded by to_regclass(): the statement also runs when a table
-- does not exist yet.

with
dyn as (
  select
    case when to_regclass('public.invite_codes') is not null then query_to_xml($q$
      select coalesce(string_agg(l, E'\n' order by l), '(none)') as line from (
        select code_type::text || ' / status=' || status::text || ' / duration=' || coalesce(discount_duration::text, '-')
          || ': codes=' || count(*)::text
          || ', with_max_uses=' || count(max_uses)::text
          || ', used_count_sum=' || coalesce(sum(used_count), 0)::text
          || ', expired=' || count(*) filter (where expires_at is not null and expires_at <= now())::text as l
        from public.invite_codes
        where code_type::text in ('discount_percent', 'discount_fixed_amount', 'fixed_price')
        group by code_type, status, discount_duration) g$q$, false, true, '') end as codes,
    case when to_regclass('public.invite_codes') is not null then query_to_xml($q$
      select 'first-month-only (once) codes that the checkout will refuse as unsupported=' || count(*)::text as line
      from public.invite_codes
      where code_type::text in ('discount_percent', 'discount_fixed_amount', 'fixed_price')
        and coalesce(discount_duration::text, 'forever') <> 'forever'$q$, false, true, '') end as once_codes,
    case when to_regclass('public.discount_code_reservations') is not null then query_to_xml($q$
      select coalesce(string_agg(l, E'\n' order by l), '(none)') as line from (
        select status || ': ' || count(*)::text
          || ', live=' || count(*) filter (where status = 'reserved' and expires_at > now())::text as l
        from public.discount_code_reservations group by status) g$q$, false, true, '') end as reservations,
    case when to_regclass('public.checkout_attempts') is not null and to_regclass('public.subscriptions') is not null then query_to_xml($q$
      select 'completed attempts whose subscription is still pending (they are replaced when the user applies a code)=' || count(*)::text as line
      from public.checkout_attempts a
      join public.subscriptions s on s.id = a.subscription_id
      where a.state = 'completed' and lower(coalesce(s.status, '')) = 'pending'$q$, false, true, '') end as pending_checkouts
),
rows_all as (

  -- 0) verdict
  select '0_VERDICT' as section, 'Discount checkout migration (20261029120000)' as item,
    case
      when to_regprocedure('public.reserve_discount_code(uuid,text,numeric,text,boolean,integer)') is null
        then 'NOT APPLIED: with DISCOUNT_CODES_ENABLED=true the checkout would fail closed (503) until the migration is applied. Keep the switch off.'
      when to_regclass('public.discount_code_reservations') is null
        then 'PARTIAL: function exists but discount_code_reservations is missing'
      else 'applied'
    end as detail
  union all
  select '0_VERDICT', 'dependencies',
    'invite_codes=' || (to_regclass('public.invite_codes') is not null)::text
      || ', invite_code_redemptions=' || (to_regclass('public.invite_code_redemptions') is not null)::text
      || ', checkout_attempts=' || (to_regclass('public.checkout_attempts') is not null)::text
      || ', subscriptions=' || (to_regclass('public.subscriptions') is not null)::text
  union all
  select '0_VERDICT', 'invite_codes.id type',
    coalesce((select data_type from information_schema.columns
              where table_schema = 'public' and table_name = 'invite_codes' and column_name = 'id'), 'column missing')
      || ' (the migration requires uuid)'

  -- A) columns the migration relies on
  union all
  select 'A_columns', table_name || '.' || column_name, data_type || ', nullable=' || is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and ((table_name = 'invite_codes' and column_name in ('id', 'code', 'code_type', 'status', 'starts_at', 'expires_at', 'max_uses', 'used_count', 'discount_value', 'discount_duration'))
      or (table_name = 'invite_code_redemptions' and column_name in ('invite_code_id', 'user_id', 'redeemed_at'))
      or (table_name = 'subscriptions' and column_name in ('id', 'status', 'cancelled_at', 'updated_at'))
      or (table_name = 'checkout_attempts' and column_name in ('id', 'user_id', 'amount', 'currency', 'state', 'subscription_id', 'mercado_pago_preapproval_id')))

  -- C) the new objects: security definer and who can execute them (expected: service_role only)
  union all
  select 'C_functions', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    'security_definer=' || p.prosecdef::text
      || ', anon_execute=' || has_function_privilege('anon', p.oid, 'execute')::text
      || ', authenticated_execute=' || has_function_privilege('authenticated', p.oid, 'execute')::text
      || ', service_role_execute=' || has_function_privilege('service_role', p.oid, 'execute')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('reserve_discount_code', 'attach_discount_reservation', 'confirm_discount_reservation',
                      'release_discount_reservation', 'release_discount_reservation_for_preapproval',
                      'describe_open_checkout', 'close_pending_checkout', 'discount_code_final_amount')
  union all
  select 'C_functions', 'table ' || c.relname,
    'rls_enabled=' || c.relrowsecurity::text
      || ', anon_select=' || has_table_privilege('anon', c.oid, 'select')::text
      || ', authenticated_select=' || has_table_privilege('authenticated', c.oid, 'select')::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('discount_code_reservations', 'discount_code_failed_attempts')

  -- D) counts only (no codes, no users)
  union all
  select 'D_counts', 'discount codes by type/status/duration', regexp_split_to_table((xpath('//row/line/text()', codes))[1]::text, E'\n') from dyn where codes is not null
  union all
  select 'D_counts', 'unsupported codes', regexp_split_to_table((xpath('//row/line/text()', once_codes))[1]::text, E'\n') from dyn where once_codes is not null
  union all
  select 'D_counts', 'reservations by status', regexp_split_to_table((xpath('//row/line/text()', reservations))[1]::text, E'\n') from dyn where reservations is not null
  union all
  select 'D_counts', 'pending checkouts', regexp_split_to_table((xpath('//row/line/text()', pending_checkouts))[1]::text, E'\n') from dyn where pending_checkouts is not null
)
select section, item, detail
from rows_all
order by section, item;
