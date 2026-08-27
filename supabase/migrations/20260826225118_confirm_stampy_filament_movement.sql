begin;

-- This RPC deliberately reuses the existing stock movement function so Stampy
-- follows the same business rules and movement audit trail as the Stock UI.
do $$
begin
  if to_regclass('public.stampy_action_requests') is null then
    raise exception 'Missing dependency: public.stampy_action_requests';
  end if;

  if to_regclass('public.filaments') is null then
    raise exception 'Missing dependency: public.filaments';
  end if;

  if to_regprocedure(
    'public.adjust_filament_stock(uuid,numeric,text,text,text,uuid)'
  ) is null then
    raise exception 'Missing dependency: public.adjust_filament_stock(uuid,numeric,text,text,text,uuid)';
  end if;

  if to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.has_platform_access(uuid)';
  end if;
end;
$$;

create or replace function public.confirm_stampy_filament_movement(
  p_action_request_id uuid
)
returns table (
  success boolean,
  action_request_id uuid,
  filament_id uuid,
  previous_remaining_grams numeric,
  new_remaining_grams numeric,
  delta_grams numeric,
  error_code text,
  message text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  action_request public.stampy_action_requests%rowtype;
  target_filament public.filaments%rowtype;
  grams_text text;
  movement_grams numeric;
  signed_delta numeric;
  target_filament_id uuid;
  resulting_remaining_grams numeric;
  updated_requests integer;
begin
  if current_user_id is null then
    return query select
      false,
      p_action_request_id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'unauthenticated'::text,
      'Necesitás iniciar sesión para confirmar el movimiento.'::text;
    return;
  end if;

  if public.has_platform_access(current_user_id) is distinct from true then
    return query select
      false,
      p_action_request_id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'platform_access_required'::text,
      'No tenés acceso habilitado para usar Stampy.'::text;
    return;
  end if;

  select request.*
  into action_request
  from public.stampy_action_requests as request
  where request.id = p_action_request_id
  for update;

  if not found then
    return query select
      false,
      p_action_request_id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'action_request_not_found'::text,
      'No encontré una solicitud de acción válida.'::text;
    return;
  end if;

  if action_request.user_id is distinct from current_user_id then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'action_request_forbidden'::text,
      'La solicitud no pertenece al usuario actual.'::text;
    return;
  end if;

  if action_request.status = 'executed' then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'already_executed'::text,
      'Este movimiento ya fue confirmado anteriormente.'::text;
    return;
  end if;

  if action_request.status is null
     or action_request.status not in ('suggested', 'opened_tool') then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'invalid_action_status'::text,
      'La solicitud ya no está pendiente de confirmación.'::text;
    return;
  end if;

  if action_request.can_execute is distinct from false then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'invalid_execution_policy'::text,
      'La solicitud no cumple la política segura de ejecución.'::text;
    return;
  end if;

  if action_request.action_type is null
     or action_request.action_type not in (
       'increase_filament_stock',
       'discount_filament'
     ) then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'unsupported_action_type'::text,
      'Esta acción no se puede ejecutar desde Stampy.'::text;
    return;
  end if;

  grams_text := nullif(btrim(action_request.extracted ->> 'grams'), '');
  if grams_text is null or grams_text !~ '^\d+(\.\d+)?$' then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'invalid_grams'::text,
      'La solicitud no tiene una cantidad de gramos válida.'::text;
    return;
  end if;

  movement_grams := grams_text::numeric;
  if movement_grams <= 0 then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'invalid_grams'::text,
      'La cantidad de gramos debe ser mayor a cero.'::text;
    return;
  end if;

  begin
    target_filament_id := coalesce(
      nullif(action_request.extracted ->> 'filamentId', '')::uuid,
      nullif(action_request.extracted ->> 'filament_id', '')::uuid,
      nullif(action_request.extracted #>> '{resolvedTarget,id}', '')::uuid,
      nullif(action_request.extracted #>> '{metadata,resolvedTarget,id}', '')::uuid
    );
  exception
    when invalid_text_representation then
      target_filament_id := null;
  end;

  if target_filament_id is null then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::numeric,
      null::numeric,
      null::numeric,
      'filament_target_missing'::text,
      'La solicitud no tiene un filamento único confirmado.'::text;
    return;
  end if;

  select filament.*
  into target_filament
  from public.filaments as filament
  where filament.id = target_filament_id
  for update;

  if not found then
    return query select
      false,
      action_request.id,
      target_filament_id,
      null::numeric,
      null::numeric,
      null::numeric,
      'filament_not_found'::text,
      'No encontré el filamento seleccionado.'::text;
    return;
  end if;

  if target_filament.user_id is distinct from current_user_id then
    return query select
      false,
      action_request.id,
      target_filament.id,
      target_filament.remaining_grams::numeric,
      target_filament.remaining_grams::numeric,
      null::numeric,
      'filament_forbidden'::text,
      'El filamento no pertenece al usuario actual.'::text;
    return;
  end if;

  if target_filament.is_active is distinct from true then
    return query select
      false,
      action_request.id,
      target_filament.id,
      target_filament.remaining_grams::numeric,
      target_filament.remaining_grams::numeric,
      null::numeric,
      'filament_inactive'::text,
      'El filamento seleccionado ya no está activo.'::text;
    return;
  end if;

  if action_request.action_type = 'discount_filament'
     and coalesce(target_filament.remaining_grams, 0)::numeric < movement_grams then
    return query select
      false,
      action_request.id,
      target_filament.id,
      coalesce(target_filament.remaining_grams, 0)::numeric,
      coalesce(target_filament.remaining_grams, 0)::numeric,
      -movement_grams,
      'insufficient_stock'::text,
      'No hay suficientes gramos disponibles para realizar el descuento.'::text;
    return;
  end if;

  signed_delta := case
    when action_request.action_type = 'increase_filament_stock' then movement_grams
    else -movement_grams
  end;

  perform public.adjust_filament_stock(
    p_filament_id => target_filament.id,
    p_grams_delta => signed_delta,
    p_movement_type => case
      when signed_delta > 0 then 'manual_add'
      else 'manual_subtract'
    end,
    p_reason => case
      when signed_delta > 0 then 'Suma confirmada desde Stampy'
      else 'Descuento confirmado desde Stampy'
    end,
    p_source_type => 'stampy_action_request',
    p_source_id => action_request.id
  );

  select filament.remaining_grams::numeric
  into resulting_remaining_grams
  from public.filaments as filament
  where filament.id = target_filament.id;

  if resulting_remaining_grams is distinct from
     coalesce(target_filament.remaining_grams, 0)::numeric + signed_delta then
    raise exception using
      errcode = 'P0001',
      message = 'adjust_filament_stock returned an unexpected remaining_grams value';
  end if;

  update public.stampy_action_requests as request
  set
    status = 'executed',
    executed_at = now(),
    updated_at = now(),
    can_execute = false
  where request.id = action_request.id
    and request.user_id = current_user_id
    and request.status in ('suggested', 'opened_tool')
    and request.can_execute = false;

  get diagnostics updated_requests = row_count;
  if updated_requests <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'Could not mark the Stampy action request as executed';
  end if;

  return query select
    true,
    action_request.id,
    target_filament.id,
    coalesce(target_filament.remaining_grams, 0)::numeric,
    resulting_remaining_grams,
    signed_delta,
    null::text,
    'Listo, actualicé el stock de filamento.'::text;
end;
$$;

revoke all on function public.confirm_stampy_filament_movement(uuid)
from public, anon, authenticated;

grant execute on function public.confirm_stampy_filament_movement(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
