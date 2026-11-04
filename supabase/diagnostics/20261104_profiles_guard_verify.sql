-- SPRINT 0 (P0-1) — VERIFICACIÓN POST-APLICACIÓN de supabase/migrations/20261104120000_profiles_privileged_columns_guard.sql
--
-- QUÉ HACE: simula, dentro de UNA transacción, lo que haría una cuenta Free de prueba vía la API (rol
-- `authenticated` con su JWT), opcionalmente un administrador y el service_role del webhook de Mercado Pago.
--
-- NO DEJA NADA GUARDADO: el bloque termina SIEMPRE con un error a propósito ("RESULTADO ...") que revierte toda la
-- transacción, incluidos los intentos que hayan funcionado. El informe es el texto de ese error.
-- Toca únicamente las filas de profiles de las cuentas que indiques abajo, y solo dentro de la transacción.
--
-- CÓMO USARLO:
--   1. Reemplazar v_free por el id (auth.users.id) de una cuenta Free DE PRUEBA (no admin, no un cliente real).
--   2. Opcional: v_admin = id de tu cuenta admin, para comprobar que el panel /admin/usuarios sigue pudiendo editar.
--   3. Supabase Dashboard -> SQL Editor -> New query -> pegar completo -> Run.
--   4. El editor muestra "ERROR: RESULTADO (todo revertido): ...". Copiar ese mensaje.
--
-- RESULTADO ESPERADO con el fix aplicado: trigger=PRESENTE, todos los casos "OK", ningún "MAL".
-- Si se corre ANTES de aplicar la migration, los intentos privilegiados salen "PERMITIDO (MAL)": eso confirma la
-- vulnerabilidad sin dejar cambios.

do $profiles_guard_verify$
declare
  v_free  uuid := '00000000-0000-0000-0000-000000000000';  -- REEMPLAZAR: cuenta Free de prueba
  v_admin uuid := null;                                    -- OPCIONAL: tu cuenta admin
  v_report text := '';
  v_rows integer;
  v_case record;
begin
  if v_free = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Configurar v_free con el id de una cuenta Free de prueba antes de correr el script.';
  end if;
  if not exists (select 1 from public.profiles where id = v_free) then
    raise exception 'v_free no existe en public.profiles.';
  end if;
  if public.is_admin(v_free) then
    raise exception 'v_free es administrador: usar una cuenta Free de prueba.';
  end if;
  if v_admin is not null and not public.is_admin(v_admin) then
    raise exception 'v_admin no es administrador.';
  end if;

  v_report := 'trigger=' || case when exists (
      select 1 from pg_trigger t
      where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'profiles_guard_privileged_columns'
        and not t.tgisinternal and t.tgenabled <> 'D')
    then 'PRESENTE' else 'AUSENTE' end || ' | ';

  -- Usuario Free con su propio JWT, como PostgREST.
  perform set_config('request.jwt.claims', json_build_object('sub', v_free, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Edición legítima del propio perfil (onboarding / Configuración / Mi negocio): debe funcionar.
  begin
    update public.profiles
    set full_name = full_name, display_name = display_name, phone = phone, main_goal = main_goal,
        company_name = company_name, onboarding_completed = onboarding_completed, updated_at = now()
    where id = v_free;
    get diagnostics v_rows = row_count;
    v_report := v_report || 'free edita su perfil: ' || case when v_rows = 1 then 'OK' else 'MAL (filas=' || v_rows || ')' end || ' | ';
  exception when others then
    v_report := v_report || 'free edita su perfil: MAL (' || sqlstate || ' ' || sqlerrm || ') | ';
  end;

  -- 2. Reenviar valores sin cambios (formularios que mandan la fila completa): debe funcionar.
  begin
    update public.profiles set role = role, membership_status = membership_status where id = v_free;
    v_report := v_report || 'free reenvía valores iguales: OK | ';
  exception when others then
    v_report := v_report || 'free reenvía valores iguales: MAL (' || sqlstate || ') | ';
  end;

  -- 3. Intentos de escalada: todos deben quedar BLOQUEADOS (42501).
  for v_case in
    -- Cada sentencia SIEMPRE cambia el valor actual, para que "PERMITIDO" nunca sea un falso positivo.
    select * from (values
      ('role=admin',                 'update public.profiles set role = ''admin'' where id = $1'),
      ('membership_status',          'update public.profiles set membership_status = case when membership_status = ''active'' then ''inactive'' else ''active'' end where id = $1'),
      ('membership_expires_at+10a',  'update public.profiles set membership_expires_at = coalesce(membership_expires_at, now()) + interval ''10 years'' where id = $1'),
      ('membership_started_at',      'update public.profiles set membership_started_at = coalesce(membership_started_at, now()) - interval ''1 day'' where id = $1'),
      ('member_level',               'update public.profiles set member_level = case when member_level = ''elite'' then ''gold'' else ''elite'' end where id = $1'),
      ('active_months+12',           'update public.profiles set active_months = active_months + 12 where id = $1'),
      ('referred_by_user_id',        'update public.profiles set referred_by_user_id = case when referred_by_user_id is null then id else null end where id = $1'),
      ('email',                      'update public.profiles set email = coalesce(email, '''') || ''.x'' where id = $1')
    ) as c(label, stmt)
  loop
    begin
      execute v_case.stmt using v_free;
      get diagnostics v_rows = row_count;
      v_report := v_report || v_case.label || ': ' ||
        case when v_rows = 0 then 'sin filas (revisar) | ' else 'PERMITIDO (MAL) | ' end;
    exception
      when insufficient_privilege then v_report := v_report || v_case.label || ': BLOQUEADO (OK) | ';
      when others then v_report := v_report || v_case.label || ': error inesperado ' || sqlstate || ' | ';
    end;
  end loop;

  -- 4. Administrador editando la membresía del usuario Free (panel /admin/usuarios): debe funcionar.
  if v_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    begin
      update public.profiles set membership_status = 'active', member_level = 'silver' where id = v_free;
      get diagnostics v_rows = row_count;
      v_report := v_report || 'admin edita membresía ajena: ' || case when v_rows = 1 then 'OK' else 'MAL (filas=' || v_rows || ')' end || ' | ';
    exception when others then
      v_report := v_report || 'admin edita membresía ajena: MAL (' || sqlstate || ') | ';
    end;
  else
    v_report := v_report || 'admin: no probado (v_admin vacío) | ';
  end if;

  -- 5. service_role (webhook / sync-subscription de Mercado Pago): debe funcionar.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    set local role service_role;
    update public.profiles
    set membership_status = 'active', membership_expires_at = now() + interval '1 month'
    where id = v_free;
    get diagnostics v_rows = row_count;
    v_report := v_report || 'service_role activa membresía: ' || case when v_rows = 1 then 'OK' else 'MAL (filas=' || v_rows || ')' end;
  exception when others then
    v_report := v_report || 'service_role activa membresía: MAL (' || sqlstate || ')';
  end;

  raise exception 'RESULTADO (todo revertido): %', v_report;
end;
$profiles_guard_verify$;
