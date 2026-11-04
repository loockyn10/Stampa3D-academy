-- SPRINT 0 (P0-1) — Guarda de columnas privilegiadas de public.profiles.
--
-- Problema (diagnóstico remoto 2026-11-04, supabase/diagnostics/20261104_profiles_security_audit.sql):
--   * policy "Users can update own profile" (UPDATE, authenticated): USING/WITH CHECK auth.uid() = id, sin
--     restricción de columnas;
--   * `authenticated` tiene UPDATE sobre TODAS las columnas de profiles (role, membership_*, ...);
--   * no existe ningún trigger sobre profiles.
--   => cualquier usuario con sesión podía hacer PATCH /rest/v1/profiles?id=eq.<su id> con {"role":"admin"} o
--      {"membership_status":"active"} (membership_expires_at NULL = acceso sin vencimiento en has_platform_access).
--
-- Solución: trigger BEFORE INSERT OR UPDATE que rechaza (SQLSTATE 42501) cambios de columnas privilegiadas cuando
-- quien escribe es un rol de la API (anon / authenticated) que NO es administrador.
--
-- Qué NO cambia (por diseño):
--   * service_role (webhook y sync-subscription de Mercado Pago, auth/callback) -> sin restricción;
--   * postgres / SQL Editor / migrations -> sin restricción;
--   * handle_new_user (SECURITY DEFINER sobre auth.users) -> corre como su owner, sin restricción;
--   * administradores (public.is_admin(auth.uid())) -> /admin/usuarios sigue editando rol y membresía;
--   * usuarios comunes siguen editando nombre, teléfono, onboarding, preferencias y datos del negocio, y pueden
--     generar su referral_code una sola vez (NULL -> valor), que es lo que hace src/lib/referral.ts.
--   * No se tocan policies, GRANTs ni datos existentes. Solo se agregan una función y un trigger.
--
-- Columnas protegidas para no-admin: id, role, membership_status, membership_started_at, membership_expires_at,
-- member_level, active_months, referred_by_user_id, email, created_at; referral_code una vez asignado.
-- En INSERT (hoy `authenticated` no tiene privilegio INSERT; esto es defensa en profundidad) se exigen los mismos
-- valores iniciales que crea handle_new_user: member / inactive / bronze / 0, sin fechas de membresía ni referente.
--
-- Idempotente (create or replace + drop trigger if exists). Aborta sin cambiar nada si faltan dependencias.
--
-- ROLLBACK (inmediato, no toca datos):
--   drop trigger if exists profiles_guard_privileged_columns on public.profiles;
--   drop function if exists public.guard_profile_privileged_columns();
--
-- Verificación post-aplicación: supabase/diagnostics/20261104_profiles_guard_verify.sql
-- Pasos de despliegue: docs/DEPLOY_PROFILES_GUARD.md

do $profiles_guard_dependencies$
declare
  v_missing text;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Missing dependency: public.profiles. Nothing was changed.';
  end if;
  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid). Nothing was changed.';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'Missing dependency: auth.uid(). Nothing was changed.';
  end if;

  select string_agg(required.col, ', ' order by required.col)
  into v_missing
  from (values ('id'), ('role'), ('membership_status'), ('membership_started_at'), ('membership_expires_at'),
               ('member_level'), ('active_months'), ('referral_code'), ('referred_by_user_id'), ('email'),
               ('created_at')) as required(col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'profiles' and c.column_name = required.col
  );

  if v_missing is not null then
    raise exception 'public.profiles is missing expected columns: %. Nothing was changed.', v_missing;
  end if;
end;
$profiles_guard_dependencies$;

create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $profiles_guard$
begin
  -- SECURITY INVOKER: current_user es el rol real de quien escribe. Solo se restringen los roles de la API.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if auth.uid() is not null and public.is_admin(auth.uid()) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is distinct from 'member'
       or new.membership_status is distinct from 'inactive'
       or new.membership_started_at is not null
       or new.membership_expires_at is not null
       or new.member_level is distinct from 'bronze'
       or new.active_months is distinct from 0
       or new.referred_by_user_id is not null then
      raise exception 'No autorizado: los valores de rol y membresía de un perfil nuevo no se pueden elegir.'
        using errcode = '42501',
              hint = 'Rol y membresía los asignan el alta de usuario, Mercado Pago o un administrador.';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.membership_status is distinct from old.membership_status
     or new.membership_started_at is distinct from old.membership_started_at
     or new.membership_expires_at is distinct from old.membership_expires_at
     or new.member_level is distinct from old.member_level
     or new.active_months is distinct from old.active_months
     or new.referred_by_user_id is distinct from old.referred_by_user_id
     or new.email is distinct from old.email
     or new.created_at is distinct from old.created_at
     or (old.referral_code is not null and new.referral_code is distinct from old.referral_code) then
    raise exception 'No autorizado: no podés modificar el rol, la membresía ni otros datos protegidos del perfil.'
      using errcode = '42501',
            hint = 'Rol y membresía los asignan Mercado Pago o un administrador.';
  end if;

  return new;
end;
$profiles_guard$;

comment on function public.guard_profile_privileged_columns() is
  'P0-1: impide que anon/authenticated no-admin modifiquen columnas privilegiadas de profiles (rol, membresía, referente, email, id, created_at; referral_code una vez asignado). service_role, postgres, handle_new_user y administradores no se restringen.';

-- Una función de trigger no se puede invocar como RPC, pero no tiene por qué ser ejecutable por los roles de la API.
revoke all on function public.guard_profile_privileged_columns() from public, anon, authenticated;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;

create trigger profiles_guard_privileged_columns
before insert or update on public.profiles
for each row execute function public.guard_profile_privileged_columns();
