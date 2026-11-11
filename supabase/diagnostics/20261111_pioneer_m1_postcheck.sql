-- Edición Pioneros — M1: verificación DESPUÉS de aplicar la migration. SOLO LECTURA (únicamente SELECT).
-- Ejecutar solo cuando 20261111120000_pioneer_edition.sql ya esté aplicada. Debe devolver `ok = true` en TODAS las filas
-- (las filas con ok = false se listan primero). No imprime datos personales.

with fns(name, signature, callable) as (
  values
    ('pioneer_offer_state', 'public.pioneer_offer_state()', true),
    ('reserve_pioneer_seat', 'public.reserve_pioneer_seat(uuid,numeric,text,text)', true),
    ('attach_pioneer_seat', 'public.attach_pioneer_seat(uuid,uuid,uuid)', true),
    ('sync_pioneer_seat', 'public.sync_pioneer_seat(text,text)', true),
    ('release_pioneer_seat', 'public.release_pioneer_seat(uuid,text,uuid)', true),
    ('release_expired_pioneer_holds', 'public.release_expired_pioneer_holds()', true),
    ('pioneer_early_access_features', 'public.pioneer_early_access_features(uuid)', true),
    ('_pioneer_lock', 'public._pioneer_lock()', false),
    ('_pioneer_log', 'public._pioneer_log(uuid,text,jsonb)', false),
    ('_pioneer_qualifying_payments', 'public._pioneer_qualifying_payments(uuid)', false),
    ('_pioneer_sweep_expired', 'public._pioneer_sweep_expired()', false)
),
roles(role) as (values ('anon'), ('authenticated'), ('service_role')),
tbls(name) as (values ('pioneer_edition'), ('pioneer_members'), ('pioneer_seat_events')),
checks(name, expected, actual) as (
  -- Configuración: apagada, sin términos, acceso anticipado vacío, condiciones aprobadas.
  select 'edition.rows', '1', (select count(*)::text from public.pioneer_edition)
  union all select 'edition.enabled', 'false', (select enabled::text from public.pioneer_edition where id = 'default')
  union all select 'edition.terms_version_is_null', 'true', (select (terms_version is null)::text from public.pioneer_edition where id = 'default')
  union all select 'edition.capacity', '20', (select capacity::text from public.pioneer_edition where id = 'default')
  union all select 'edition.promo_price', '9900.00', (select promo_price::text from public.pioneer_edition where id = 'default')
  union all select 'edition.price_cycles', '6', (select price_cycles::text from public.pioneer_edition where id = 'default')
  union all select 'edition.early_access_features', '{}', (select early_access_features::text from public.pioneer_edition where id = 'default')
  -- Sin lugares todavía (la migration no crea ninguno).
  union all select 'members.rows', '0', (select count(*)::text from public.pioneer_members)
  -- RLS activo y triggers de guarda presentes.
  union all
  select 'rls:' || t.name, 'true', (select relrowsecurity::text from pg_class where oid = ('public.' || t.name)::regclass)
  from tbls t
  union all select 'trigger:pioneer_members_guard_trg', '1', (select count(*)::text from pg_trigger where tgname = 'pioneer_members_guard_trg' and not tgisinternal)
  union all select 'trigger:pioneer_edition_guard_trg', '1', (select count(*)::text from pg_trigger where tgname = 'pioneer_edition_guard_trg' and not tgisinternal)
  union all select 'trigger:pioneer_seat_events_guard_trg', '1', (select count(*)::text from pg_trigger where tgname = 'pioneer_seat_events_guard_trg' and not tgisinternal)
  -- Índices de integridad.
  union all select 'index:number_occupied', '1', (select count(*)::text from pg_indexes where indexname = 'pioneer_members_number_occupied_idx')
  union all select 'index:user_occupied', '1', (select count(*)::text from pg_indexes where indexname = 'pioneer_members_user_occupied_idx')
  union all select 'index:preapproval', '1', (select count(*)::text from pg_indexes where indexname = 'pioneer_members_preapproval_idx')
  -- Funciones: solo service_role ejecuta las públicas; las internas, nadie.
  union all
  select 'fn_exec:' || f.name || ':' || r.role,
         (r.role = 'service_role' and f.callable)::text,
         has_function_privilege(r.role, f.signature, 'EXECUTE')::text
  from fns f cross join roles r
  -- Tablas: ninguna escritura directa para nadie; service_role solo lee; anon no ve nada.
  union all
  select 'table_write:' || t.name || ':' || r.role || ':' || p.priv, case when t.name = 'pioneer_edition' and r.role = 'service_role' and p.priv = 'UPDATE' then 'true' else 'false' end,
         has_table_privilege(r.role, 'public.' || t.name, p.priv)::text
  from tbls t cross join roles r cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
  union all
  select 'table_select:' || t.name || ':' || r.role, (r.role = 'service_role')::text, has_table_privilege(r.role, 'public.' || t.name, 'SELECT')::text
  from tbls t cross join roles r
  -- authenticated: solo columnas no sensibles de pioneer_members.
  union all
  select 'column_select:authenticated:' || c.col, c.allowed::text, has_column_privilege('authenticated', 'public.pioneer_members', c.col, 'SELECT')::text
  from (values
    ('pioneer_number', true), ('status', true), ('cycles_paid', true), ('confirmed_at', true),
    ('mercado_pago_preapproval_id', false), ('checkout_attempt_id', false), ('first_payment_id', false),
    ('release_reason', false), ('step_up_error', false), ('step_up_target', false)
  ) c(col, allowed)
  -- Una sola policy en pioneer_members y de solo lectura.
  union all select 'policies:pioneer_members', '1', (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'pioneer_members')
  union all select 'policy_cmd:pioneer_members', 'SELECT', (select string_agg(cmd, ',') from pg_policies where schemaname = 'public' and tablename = 'pioneer_members')
  union all select 'policies:pioneer_edition_and_events', '0', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('pioneer_edition', 'pioneer_seat_events'))
)
select name, expected, actual, (actual is not distinct from expected) as ok
from checks
order by ok, name;
