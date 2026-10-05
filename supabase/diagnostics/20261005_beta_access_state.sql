-- BETA ACCESS — READ-ONLY DIAGNOSTIC
--
-- Paste this WHOLE file into the Supabase SQL Editor and run it. It is a SINGLE SELECT over system
-- catalogs: it changes nothing, creates nothing and does not read any business table (so it also works
-- before the Beta migration exists). One result grid -> copy all rows (section | item | detail) back.
--
-- Run it BEFORE applying supabase/migrations/20261005120000_beta_access_codes.sql.
-- Do NOT apply the migration if row "0_VERDICT" does not say COMPATIBLE, or if you disagree after reading
-- the has_platform_access definition (section A).

with
fn as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('has_platform_access', 'is_admin')
),
uag as (
  select c.oid, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
  where c.oid = to_regclass('public.user_access_grants')
),
rows_all as (

  -- 0) verdict (heuristic: necessary, not sufficient; read section A yourself)
  select '0_VERDICT' as section, 'has_platform_access(uuid)' as item,
    case
      when to_regprocedure('public.has_platform_access(uuid)') is null
        then 'INCOMPATIBLE: public.has_platform_access(uuid) does not exist'
      when exists (
        select 1 from fn
        where oid = to_regprocedure('public.has_platform_access(uuid)')
          and def ilike '%user_access_grants%' and def ilike '%expires_at%' and def ilike '%status%'
      )
        then 'COMPATIBLE (heuristic): definition references user_access_grants + status + expires_at. Still read section A.'
      else 'INCOMPATIBLE: definition does not visibly honour user_access_grants. DO NOT apply the migration - send this output.'
    end as detail

  union all
  select '0_VERDICT', 'user_access_grants table',
    case when exists (select 1 from uag) then 'exists' else 'MISSING' end

  union all
  select '0_VERDICT', 'user_access_grants privileges',
    case
      when not exists (select 1 from uag) then 'n/a (table missing)'
      when exists (
        select 1 from uag
        where has_table_privilege('anon', uag.oid, 'TRUNCATE') or has_table_privilege('authenticated', uag.oid, 'TRUNCATE')
           or has_table_privilege('anon', uag.oid, 'REFERENCES') or has_table_privilege('authenticated', uag.oid, 'REFERENCES')
           or has_table_privilege('anon', uag.oid, 'TRIGGER') or has_table_privilege('authenticated', uag.oid, 'TRIGGER')
           or has_table_privilege('anon', uag.oid, 'SELECT') or has_table_privilege('anon', uag.oid, 'INSERT')
           or has_table_privilege('anon', uag.oid, 'UPDATE') or has_table_privilege('anon', uag.oid, 'DELETE')
      )
        then 'NOT HARDENED: anon/authenticated still hold TRUNCATE, REFERENCES, TRIGGER (or anon holds data privileges). Expected BEFORE applying the Beta migration, must NOT appear after.'
      else 'HARDENED: anon has no privileges, authenticated has no TRUNCATE / REFERENCES / TRIGGER.'
    end

  -- A) current has_platform_access / is_admin definitions
  union all
  select 'A_functions', proname || '(' || args || ')', def from fn

  -- B) policies on user_access_grants
  union all
  select 'B_policies', 'RLS enabled / forced',
    'enabled=' || relrowsecurity::text || ', forced=' || relforcerowsecurity::text from uag
  union all
  select 'B_policies', policyname || ' [' || cmd || '] ' || permissive,
    'roles=' || roles::text || E'\nUSING: ' || coalesce(qual, '-') || E'\nWITH CHECK: ' || coalesce(with_check, '-')
  from pg_policies
  where schemaname = 'public' and tablename = 'user_access_grants'
  union all
  select 'B_policies', 'WARNING',
    'No policies found on user_access_grants (with RLS enabled that means deny-all for non-owners, without RLS it means open table).'
  where exists (select 1 from uag) and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_access_grants')

  -- C) privileges and shape of user_access_grants
  union all
  select 'C_privileges', r.role_name || ' ' || p.priv,
    has_table_privilege(r.role_name, uag.oid, p.priv)::text
  from uag
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
  union all
  select 'C_privileges', 'column ' || ordinal_position || ': ' || column_name,
    data_type || ', nullable=' || is_nullable || ', default=' || coalesce(column_default, '-')
  from information_schema.columns
  where table_schema = 'public' and table_name = 'user_access_grants'
  union all
  select 'C_privileges', 'constraint ' || conname, pg_get_constraintdef(oid)
  from pg_constraint
  where conrelid = to_regclass('public.user_access_grants')
  union all
  select 'C_privileges', 'trigger ' || tgname, pg_get_triggerdef(oid)
  from pg_trigger
  where tgrelid = to_regclass('public.user_access_grants') and not tgisinternal

  -- D) Beta objects, if any already exist
  union all
  select 'D_beta_objects', 'table ' || c.relname,
    'rls_enabled=' || c.relrowsecurity::text
      || ', anon_select=' || has_table_privilege('anon', c.oid, 'select')::text
      || ', authenticated_select=' || has_table_privilege('authenticated', c.oid, 'select')::text
      || ', authenticated_insert=' || has_table_privilege('authenticated', c.oid, 'insert')::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'beta\_access\_%'
  union all
  select 'D_beta_objects', 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    'security_definer=' || p.prosecdef::text
      || ', anon_execute=' || has_function_privilege('anon', p.oid, 'execute')::text
      || ', authenticated_execute=' || has_function_privilege('authenticated', p.oid, 'execute')::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('redeem_beta_access_code', 'create_beta_access_code', 'revoke_beta_access',
                      'normalize_beta_access_code', 'beta_access_code_digest')
  union all
  select 'D_beta_objects', 'state',
    case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname like 'beta\_access\_%')
      then 'Beta objects already exist (migration already applied or partially applied).'
      else 'No Beta objects yet (migration not applied).' end

  -- E) legacy invite_codes (informational only; not used by Beta Access)
  union all
  select 'E_legacy_invite_codes', 'invite_codes table',
    case when to_regclass('public.invite_codes') is not null then 'exists (legacy, plaintext codes - not used by Beta Access)' else 'does not exist' end
  union all
  select 'E_legacy_invite_codes', 'policy ' || policyname || ' [' || cmd || ']', 'roles=' || roles::text
  from pg_policies
  where schemaname = 'public' and tablename in ('invite_codes', 'invite_code_redemptions')
)
select section, item, detail
from rows_all
order by section, item;
