begin;

do $$
begin
  if to_regclass('public.stampy_action_requests') is null then
    raise exception 'Missing dependency: public.stampy_action_requests';
  end if;

  if to_regclass('public.printers') is null then
    raise exception 'Missing dependency: public.printers';
  end if;

  if to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.has_platform_access(uuid)';
  end if;
end;
$$;

create or replace function public.confirm_stampy_create_printer(
  p_action_request_id uuid
)
returns table (
  success boolean,
  action_request_id uuid,
  printer_id uuid,
  printer_name text,
  power_watts numeric,
  maintenance_cost_per_hour numeric,
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
  printer_name_value text;
  normalized_printer_name text;
  power_text text;
  maintenance_text text;
  power_value numeric;
  maintenance_value numeric;
  duplicate_printer_id uuid;
  duplicate_is_active boolean;
  created_printer_id uuid;
  created_power_watts numeric;
  created_maintenance_cost numeric;
  updated_requests integer;
begin
  if current_user_id is null then
    return query select
      false,
      p_action_request_id,
      null::uuid,
      null::text,
      null::numeric,
      null::numeric,
      'unauthenticated'::text,
      'Necesitás iniciar sesión para crear la impresora.'::text;
    return;
  end if;

  if public.has_platform_access(current_user_id) is distinct from true then
    return query select
      false,
      p_action_request_id,
      null::uuid,
      null::text,
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
      null::text,
      null::numeric,
      null::numeric,
      'action_request_not_found'::text,
      'No encontré una solicitud de creación válida.'::text;
    return;
  end if;

  if action_request.user_id is distinct from current_user_id then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::text,
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
      null::text,
      null::numeric,
      null::numeric,
      'already_executed'::text,
      'Esta impresora ya fue creada anteriormente.'::text;
    return;
  end if;

  if action_request.status is null
     or action_request.status not in ('suggested', 'opened_tool') then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::text,
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
      null::text,
      null::numeric,
      null::numeric,
      'invalid_execution_policy'::text,
      'La solicitud no cumple la política segura de ejecución.'::text;
    return;
  end if;

  if action_request.action_type is distinct from 'add_printer' then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::text,
      null::numeric,
      null::numeric,
      'unsupported_action_type'::text,
      'Esta solicitud no corresponde a crear una impresora.'::text;
    return;
  end if;

  printer_name_value := nullif(btrim(coalesce(
    action_request.extracted ->> 'printerName',
    action_request.extracted ->> 'name'
  )), '');

  if printer_name_value is null
     or char_length(printer_name_value) < 2
     or char_length(printer_name_value) > 160
     or printer_name_value !~ '[[:alpha:]]' then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::text,
      null::numeric,
      null::numeric,
      'invalid_printer_name'::text,
      'La solicitud no tiene un nombre de impresora válido.'::text;
    return;
  end if;

  power_text := nullif(btrim(coalesce(
    action_request.extracted ->> 'powerWatts',
    action_request.extracted ->> 'power_watts'
  )), '');
  maintenance_text := nullif(btrim(coalesce(
    action_request.extracted ->> 'maintenanceCostPerHour',
    action_request.extracted ->> 'maintenance_cost_per_hour'
  )), '');

  if power_text is null then
    power_value := 0;
  elsif power_text !~ '^\d+(\.\d+)?$' then
    return query select
      false,
      action_request.id,
      null::uuid,
      printer_name_value,
      null::numeric,
      null::numeric,
      'invalid_power_watts'::text,
      'La potencia de la impresora no es válida.'::text;
    return;
  else
    power_value := power_text::numeric;
  end if;

  if maintenance_text is null then
    maintenance_value := 0;
  elsif maintenance_text !~ '^\d+(\.\d+)?$' then
    return query select
      false,
      action_request.id,
      null::uuid,
      printer_name_value,
      power_value,
      null::numeric,
      'invalid_maintenance_cost'::text,
      'El mantenimiento por hora no es válido.'::text;
    return;
  else
    maintenance_value := maintenance_text::numeric;
  end if;

  if power_value < 0 or maintenance_value < 0 then
    return query select
      false,
      action_request.id,
      null::uuid,
      printer_name_value,
      power_value,
      maintenance_value,
      'invalid_printer_values'::text,
      'La potencia y el mantenimiento no pueden ser negativos.'::text;
    return;
  end if;

  normalized_printer_name := btrim(regexp_replace(
    translate(lower(printer_name_value), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+',
    ' ',
    'g'
  ));

  -- Printer creation is infrequent; serialize it per user so equivalent names
  -- such as "Ender-3" and "Ender 3" cannot race through the duplicate check.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text),
    pg_catalog.hashtext('stampy_create_printer')
  );

  select printer.id, printer.is_active
  into duplicate_printer_id, duplicate_is_active
  from public.printers as printer
  where printer.user_id = current_user_id
    and (
      btrim(regexp_replace(
        translate(lower(printer.name), 'áéíóúüñ', 'aeiouun'),
        '[^a-z0-9]+', ' ', 'g'
      )) = normalized_printer_name
      or position(
        normalized_printer_name in btrim(regexp_replace(
          translate(lower(printer.name), 'áéíóúüñ', 'aeiouun'),
          '[^a-z0-9]+', ' ', 'g'
        ))
      ) > 0
      or position(
        btrim(regexp_replace(
          translate(lower(printer.name), 'áéíóúüñ', 'aeiouun'),
          '[^a-z0-9]+', ' ', 'g'
        )) in normalized_printer_name
      ) > 0
    )
  order by printer.is_active desc, printer.created_at asc
  limit 1
  for update;

  if duplicate_printer_id is not null then
    return query select
      false,
      action_request.id,
      duplicate_printer_id,
      printer_name_value,
      power_value,
      maintenance_value,
      case
        when duplicate_is_active then 'duplicate_printer'
        else 'inactive_printer_exists'
      end::text,
      case
        when duplicate_is_active then
          'Ya existe una impresora parecida. Abrí Calculadora para revisarla.'
        else
          'Ya existe una impresora parecida inactiva. Abrí Calculadora para revisarla; Stampy no la reactiva automáticamente.'
      end::text;
    return;
  end if;

  insert into public.printers as printer (
    user_id,
    name,
    power_watts,
    maintenance_cost_per_hour,
    is_active,
    source_template_id
  ) values (
    current_user_id,
    printer_name_value,
    power_value,
    maintenance_value,
    true,
    null
  )
  returning
    printer.id,
    printer.power_watts,
    printer.maintenance_cost_per_hour
  into
    created_printer_id,
    created_power_watts,
    created_maintenance_cost;

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
    created_printer_id,
    printer_name_value,
    created_power_watts,
    created_maintenance_cost,
    null::text,
    'Listo, creé la impresora.'::text;
end;
$$;

revoke all on function public.confirm_stampy_create_printer(uuid)
from public, anon, authenticated;

grant execute on function public.confirm_stampy_create_printer(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
