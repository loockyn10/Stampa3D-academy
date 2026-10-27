-- Feature flags de plataforma: lanzamiento progresivo de Universo Stampa.
--
-- * public.platform_feature_flags: una fila por funcionalidad que el Admin configuró EXPLÍCITAMENTE.
--   El registro de funcionalidades vive en el código (src/lib/features/registry.ts); la tabla solo guarda el estado.
--   SIN FILA = "todavía no configurada" -> el código aplica el default del registro (habilitada, es decir, el
--   acceso actual se preserva). Una fila con enabled = false = "deshabilitada explícitamente".
--   Esta migration NO inserta filas: aplicarla no restringe nada.
-- * Lectura: anon + authenticated (la navegación y el proxy la consultan; no contiene datos de usuarios).
-- * Escritura: solo administradores (public.is_admin(auth.uid())) vía RLS. Un trigger fija updated_by/updated_at
--   desde la sesión, no desde lo que envíe el cliente.
-- * No toca datos de usuarios, membresías ni policies de otras tablas.
--
-- Depende de public.is_admin(uuid) (no versionada en este repo, igual que en el resto de las migrations).
-- Segura de re-ejecutar (idempotente).

do $feature_flags_dependencies$
begin
  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid)';
  end if;
end;
$feature_flags_dependencies$;

create table if not exists public.platform_feature_flags (
  feature_id text primary key,
  enabled boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint platform_feature_flags_feature_id_format check (feature_id ~ '^[a-z][a-z0-9_]{1,47}$')
);

comment on table public.platform_feature_flags is
  'Estado público (habilitada/deshabilitada) de cada funcionalidad. Sin fila = no configurada (default del registro en código). Los admins siempre conservan acceso.';

alter table public.platform_feature_flags enable row level security;

-- Privilegios: lectura para anon/authenticated; escritura solo authenticated (filtrada por RLS a admins).
revoke all on table public.platform_feature_flags from public;
revoke all on table public.platform_feature_flags from anon, authenticated;
grant select on table public.platform_feature_flags to anon, authenticated;
grant insert, update on table public.platform_feature_flags to authenticated;
grant select, insert, update, delete on table public.platform_feature_flags to service_role;

drop policy if exists platform_feature_flags_select_all on public.platform_feature_flags;
create policy platform_feature_flags_select_all
on public.platform_feature_flags for select to anon, authenticated
using (true);

drop policy if exists platform_feature_flags_admin_insert on public.platform_feature_flags;
create policy platform_feature_flags_admin_insert
on public.platform_feature_flags for insert to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists platform_feature_flags_admin_update on public.platform_feature_flags;
create policy platform_feature_flags_admin_update
on public.platform_feature_flags for update to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Sin policy de DELETE para authenticated: "volver a no configurada" no se ofrece desde la UI; un reset se hace por SQL/service_role.

create or replace function public.platform_feature_flags_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists platform_feature_flags_stamp on public.platform_feature_flags;
create trigger platform_feature_flags_stamp
before insert or update on public.platform_feature_flags
for each row execute function public.platform_feature_flags_stamp();

notify pgrst, 'reload schema';
