-- Edición Pioneros — M1: foto del estado ANTES y DESPUÉS de aplicar la migration. SOLO LECTURA (únicamente SELECT).
--
-- Cómo usarla (Supabase → SQL Editor):
--   1. ANTES de aplicar supabase/migrations/20261111120000_pioneer_edition.sql: ejecutar este archivo y guardar el resultado.
--   2. Aplicar la migration (solo con autorización expresa).
--   3. DESPUÉS: ejecutar este archivo otra vez. Las filas `founder_*` y `subscriptions_at_250` deben ser IDÉNTICAS.
--      `subscriptions` / `payments` pueden variar por tráfico normal (webhooks): no se comparan por hash.
-- No imprime datos personales: solo conteos, hashes y estructura. No modifica nada.

select item, value
from (
  select 10 as ord, 'founder_members.count' as item, count(*)::text as value from public.founder_members
  union all
  select 11, 'founder_members.md5', md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.founder_members t
  union all
  select 12, 'founder_members.acl', coalesce((select relacl::text from pg_class where oid = 'public.founder_members'::regclass), '(default)')
  union all
  select 13, 'founder_members.triggers', count(*)::text
  from pg_trigger where tgrelid = 'public.founder_members'::regclass and not tgisinternal
  union all
  select 14, 'founder_members.policies', count(*)::text from pg_policies where schemaname = 'public' and tablename = 'founder_members'
  union all
  select 15, 'founder_members.indexes', coalesce(string_agg(indexname, ',' order by indexname), '')
  from pg_indexes where schemaname = 'public' and tablename = 'founder_members'
  union all
  select 20, 'founder_pricing_tiers.count', count(*)::text from public.founder_pricing_tiers
  union all
  select 21, 'founder_pricing_tiers.md5', md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.founder_pricing_tiers t
  union all
  select 30, 'subscriptions.count', count(*)::text from public.subscriptions
  union all
  select 31, 'subscriptions_at_250.count', count(*)::text from public.subscriptions where amount = 250
  union all
  select 32, 'subscriptions_at_250.md5',
         md5(coalesce(string_agg(s.id::text || ':' || s.amount::text || ':' || coalesce(s.currency, '') || ':' || coalesce(s.status, ''), '|' order by s.id::text), ''))
  from public.subscriptions s where s.amount = 250
  union all
  select 40, 'payments.count', count(*)::text from public.payments
  union all
  select 50, 'checkout_attempts.count', count(*)::text from public.checkout_attempts
  union all
  select 60, 'pioneer_edition.exists', (to_regclass('public.pioneer_edition') is not null)::text
  union all
  select 61, 'pioneer_members.exists', (to_regclass('public.pioneer_members') is not null)::text
  union all
  select 62, 'pioneer_seat_events.exists', (to_regclass('public.pioneer_seat_events') is not null)::text
) as state
order by ord;
