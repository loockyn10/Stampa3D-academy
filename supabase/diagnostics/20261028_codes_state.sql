-- BETA + DISCOUNT CODES — READ-ONLY DIAGNOSTIC
--
-- Paste this WHOLE file into the Supabase SQL Editor. It is a SINGLE SELECT: it changes nothing, creates nothing
-- and never prints a code, an email or a user id (only counts, catalog definitions and yes/no verdicts).
-- One result grid -> copy all rows (section | item | detail) back.
--
-- Run it BEFORE applying supabase/migrations/20261028120000_beta_redeem_legacy_invite_codes.sql and again after.
-- Row "0_VERDICT" tells which part of the code system is live in this database.

with
uag as (select to_regclass('public.user_access_grants') as oid),
inv as (select to_regclass('public.invite_codes') as oid),
red as (select to_regclass('public.invite_code_redemptions') as oid),
redeem_fn as (
  select pg_get_functiondef(to_regprocedure('public.redeem_beta_access_code(text)')) as def
  where to_regprocedure('public.redeem_beta_access_code(text)') is not null
),
-- Business tables are read through query_to_xml(), guarded by to_regclass(): the statement still parses and runs when
-- a table does not exist yet (a plain FROM would fail the whole diagnostic). Counts only: no code, email or user id.
dyn as (
  select
    case when to_regclass('public.invite_codes') is not null then query_to_xml($q$
      select coalesce(string_agg(l, E'\n' order by l), '(none)') as line from (
        select code_type::text || ' / status=' || status::text || ': codes=' || count(*)::text
        || ', used_count_sum=' || coalesce(sum(used_count), 0)::text
        || ', with_max_uses=' || count(max_uses)::text
        || ', depleted=' || count(*) filter (where max_uses is not null and used_count >= max_uses)::text
        || ', expired=' || count(*) filter (where expires_at is not null and expires_at <= now())::text
        || ', not_started=' || count(*) filter (where starts_at is not null and starts_at > now())::text as l
        from public.invite_codes group by code_type, status) g$q$, false, true, '') end as inv_groups,
    case when to_regclass('public.invite_codes') is not null then query_to_xml($q$
      select count(*) filter (where code_type::text not in ('beta_tester', 'manual_free_access'))::text as line
      from public.invite_codes$q$, false, true, '') end as discount_count,
    case when to_regclass('public.invite_codes') is not null and to_regclass('public.invite_code_redemptions') is not null then query_to_xml($q$
      select 'codes_where_used_count_differs=' || count(*)::text as line
      from public.invite_codes k
      where coalesce(k.used_count, 0) <> (select count(*) from public.invite_code_redemptions r where r.invite_code_id = k.id)$q$, false, true, '') end as drift,
    case when to_regclass('public.invite_codes') is not null and to_regclass('public.invite_code_redemptions') is not null
          and to_regclass('public.user_access_grants') is not null then query_to_xml($q$
      select 'count=' || count(*)::text as line
      from public.invite_code_redemptions r
      join public.invite_codes k on k.id = r.invite_code_id
      where k.code_type::text in ('beta_tester', 'manual_free_access')
        and not exists (
          select 1 from public.user_access_grants g
          where g.user_id = r.user_id and g.grant_type::text = k.code_type::text and g.status::text = 'active'
        )$q$, false, true, '') end as orphan_redemptions,
    case when to_regclass('public.user_access_grants') is not null then query_to_xml($q$
      select coalesce(string_agg(l, E'\n' order by l), '(none)') as line from (
        select grant_type::text || ' / ' || status::text || ': ' || count(*)::text as l
        from public.user_access_grants
        where grant_type::text in ('beta_tester', 'manual_free_access', 'internal_tester')
        group by grant_type, status) g$q$, false, true, '') end as grants_by_type,
    case when to_regclass('public.beta_access_codes') is not null then query_to_xml($q$
      select 'codes=' || count(*)::text || ', active=' || count(*) filter (where active)::text as line
      from public.beta_access_codes$q$, false, true, '') end as hashed_codes
),
rows_all as (

  -- 0) verdict
  select '0_VERDICT' as section, 'Beta Access migration (20261005120000)' as item,
    case
      when to_regprocedure('public.redeem_beta_access_code(text)') is null
        then 'NOT APPLIED: redeem_beta_access_code does not exist -> every redemption from the app answers "error" (not "invalid"). Apply 20261005120000 first.'
      when to_regclass('public.beta_access_codes') is null
        then 'PARTIAL: function exists but beta_access_codes is missing'
      else 'applied'
    end as detail
  union all
  select '0_VERDICT', 'Legacy bridge (20261028120000)',
    case
      when not exists (select 1 from redeem_fn) then 'n/a (Beta Access not applied)'
      when exists (select 1 from redeem_fn where def ilike '%redeem_legacy_beta_invite%')
        then 'applied: codes created in /admin/codigos can be redeemed from signup, Perfil and Sin acceso'
      else 'NOT APPLIED: only hashed beta_access_codes are redeemable, so codes created in /admin/codigos answer "Código inválido" in those places'
    end
  union all
  select '0_VERDICT', 'legacy tables',
    'invite_codes=' || (select (oid is not null)::text from inv) || ', invite_code_redemptions=' || (select (oid is not null)::text from red)
  union all
  select '0_VERDICT', 'user_access_grants.grant_type type',
    coalesce((select data_type from information_schema.columns
              where table_schema = 'public' and table_name = 'user_access_grants' and column_name = 'grant_type'), 'column missing')
      || ' (the legacy bridge requires text / character varying)'
  union all
  select '0_VERDICT', 'discount codes',
    case when (select oid from inv) is null then 'n/a'
         else coalesce((select (xpath('//row/line/text()', discount_count))[1]::text from dyn), '?') || ' stored in invite_codes. The app does NOT apply them at checkout (create-subscription charges membership_settings.monthly_price).' end

  -- A) legacy table shape, RLS and policies (the tables are not versioned in the repo)
  union all
  select 'A_invite_tables', 'column ' || table_name || '.' || column_name,
    data_type || ', nullable=' || is_nullable || ', default=' || coalesce(column_default, '-')
  from information_schema.columns
  where table_schema = 'public' and table_name in ('invite_codes', 'invite_code_redemptions')
  union all
  select 'A_invite_tables', 'RLS ' || c.relname, 'enabled=' || c.relrowsecurity::text || ', forced=' || c.relforcerowsecurity::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('invite_codes', 'invite_code_redemptions')
  union all
  select 'A_invite_tables', 'policy ' || tablename || ' / ' || policyname || ' [' || cmd || ']',
    'roles=' || roles::text || E'\nUSING: ' || coalesce(qual, '-') || E'\nWITH CHECK: ' || coalesce(with_check, '-')
  from pg_policies
  where schemaname = 'public' and tablename in ('invite_codes', 'invite_code_redemptions')
  union all
  select 'A_invite_tables', 'constraint ' || conrelid::regclass::text || ' / ' || conname, pg_get_constraintdef(oid)
  from pg_constraint
  where conrelid in (to_regclass('public.invite_codes'), to_regclass('public.invite_code_redemptions'))
  union all
  select 'A_invite_tables', 'privilege ' || r.role_name || ' on ' || t.tbl,
    (select string_agg(p.priv, ',' order by p.priv) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
     where has_table_privilege(r.role_name, to_regclass('public.' || t.tbl), p.priv))
  from (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
  cross join (values ('invite_codes'), ('invite_code_redemptions')) as t(tbl)
  where to_regclass('public.' || t.tbl) is not null

  -- B) what user_access_grants accepts (grant_type / status) and who may touch it
  union all
  select 'B_grants', 'constraint ' || conname, pg_get_constraintdef(oid)
  from pg_constraint
  where conrelid = (select oid from uag)
  union all
  select 'B_grants', 'privilege ' || r.role_name,
    (select string_agg(p.priv, ',' order by p.priv) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
     where has_table_privilege(r.role_name, (select oid from uag), p.priv))
  from (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
  where (select oid from uag) is not null

  -- C) redemption functions: existence, security definer and who can execute them
  union all
  select 'C_functions', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    'security_definer=' || p.prosecdef::text
      || ', anon_execute=' || has_function_privilege('anon', p.oid, 'execute')::text
      || ', authenticated_execute=' || has_function_privilege('authenticated', p.oid, 'execute')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('redeem_beta_access_code', 'redeem_legacy_beta_invite', 'create_beta_access_code', 'revoke_beta_access')

  -- D) counts only (no codes, no users): how healthy the legacy ledger is
  union all
  select 'D_legacy_counts', 'invite_codes by type/status', regexp_split_to_table((xpath('//row/line/text()', inv_groups))[1]::text, E'\n') from dyn where inv_groups is not null
  union all
  select 'D_legacy_counts', 'ledger drift (used_count vs real redemptions)', regexp_split_to_table((xpath('//row/line/text()', drift))[1]::text, E'\n') from dyn where drift is not null
  union all
  select 'D_legacy_counts', 'redemptions without an active grant of the code type', regexp_split_to_table((xpath('//row/line/text()', orphan_redemptions))[1]::text, E'\n') from dyn where orphan_redemptions is not null
  union all
  select 'D_legacy_counts', 'grants by type/status', regexp_split_to_table((xpath('//row/line/text()', grants_by_type))[1]::text, E'\n') from dyn where grants_by_type is not null
  union all
  select 'D_legacy_counts', 'hashed beta codes', regexp_split_to_table((xpath('//row/line/text()', hashed_codes))[1]::text, E'\n') from dyn where hashed_codes is not null
)
select section, item, detail
from rows_all
order by section, item;
