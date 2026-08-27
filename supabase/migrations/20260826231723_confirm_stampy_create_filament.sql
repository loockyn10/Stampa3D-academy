begin;

do $$
begin
  if to_regclass('public.stampy_action_requests') is null then
    raise exception 'Missing dependency: public.stampy_action_requests';
  end if;

  if to_regclass('public.filaments') is null then
    raise exception 'Missing dependency: public.filaments';
  end if;

  if to_regclass('public.filament_templates') is null then
    raise exception 'Missing dependency: public.filament_templates';
  end if;

  if to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.has_platform_access(uuid)';
  end if;
end;
$$;

create or replace function public.confirm_stampy_create_filament(
  p_action_request_id uuid
)
returns table (
  success boolean,
  action_request_id uuid,
  filament_id uuid,
  label text,
  total_grams numeric,
  remaining_grams numeric,
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
  material_value text;
  brand_value text;
  subtype_value text;
  color_value text;
  grams_text text;
  normalized_material text;
  normalized_brand text;
  normalized_subtype text;
  normalized_color text;
  duplicate_filament_id uuid;
  created_filament_id uuid;
  created_total_grams numeric;
  created_remaining_grams numeric;
  created_label text;
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
      'Necesitás iniciar sesión para crear el filamento.'::text;
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
      'Este filamento ya fue creado anteriormente.'::text;
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

  if action_request.action_type is distinct from 'add_filament' then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::text,
      null::numeric,
      null::numeric,
      'unsupported_action_type'::text,
      'Esta solicitud no corresponde a crear un filamento.'::text;
    return;
  end if;

  material_value := nullif(btrim(coalesce(
    action_request.extracted ->> 'material',
    action_request.extracted ->> 'filament_type'
  )), '');
  brand_value := nullif(btrim(action_request.extracted ->> 'brand'), '');
  subtype_value := nullif(btrim(coalesce(
    action_request.extracted ->> 'name',
    action_request.extracted ->> 'subtype'
  )), '');
  color_value := coalesce(
    nullif(btrim(action_request.extracted ->> 'color'), ''),
    'Sin color'
  );

  if material_value is null or char_length(material_value) > 40 then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::text,
      null::numeric,
      null::numeric,
      'invalid_material'::text,
      'La solicitud no tiene un material válido.'::text;
    return;
  end if;

  if char_length(coalesce(brand_value, '')) > 100
     or char_length(coalesce(subtype_value, '')) > 100
     or char_length(color_value) > 100 then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::text,
      null::numeric,
      null::numeric,
      'invalid_filament_fields'::text,
      'Los datos del filamento son demasiado largos.'::text;
    return;
  end if;

  grams_text := nullif(btrim(coalesce(
    action_request.extracted ->> 'totalGrams',
    action_request.extracted ->> 'total_grams'
  )), '');

  if grams_text is null then
    created_total_grams := 1000;
  elsif grams_text !~ '^\d+(\.\d+)?$' then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::text,
      null::numeric,
      null::numeric,
      'invalid_total_grams'::text,
      'El peso total del filamento no es válido.'::text;
    return;
  else
    created_total_grams := grams_text::numeric;
  end if;

  if created_total_grams <= 0 then
    return query select
      false,
      action_request.id,
      null::uuid,
      null::text,
      null::numeric,
      null::numeric,
      'invalid_total_grams'::text,
      'El peso total debe ser mayor a cero.'::text;
    return;
  end if;

  material_value := upper(material_value);
  normalized_material := regexp_replace(
    translate(lower(material_value), 'áéíóúüñ', 'aeiouun'),
    '\s+',
    ' ',
    'g'
  );
  normalized_brand := regexp_replace(
    translate(lower(coalesce(brand_value, '')), 'áéíóúüñ', 'aeiouun'),
    '\s+',
    ' ',
    'g'
  );
  normalized_subtype := regexp_replace(
    translate(lower(coalesce(subtype_value, '')), 'áéíóúüñ', 'aeiouun'),
    '\s+',
    ' ',
    'g'
  );
  normalized_color := regexp_replace(
    translate(lower(color_value), 'áéíóúüñ', 'aeiouun'),
    '\s+',
    ' ',
    'g'
  );

  -- Serialize equivalent creations without adding a business-table constraint.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text),
    pg_catalog.hashtext(concat_ws(
      '|',
      normalized_material,
      normalized_brand,
      normalized_subtype,
      normalized_color
    ))
  );

  select filament.id
  into duplicate_filament_id
  from public.filaments as filament
  left join public.filament_templates as template
    on template.id = filament.source_template_id
  where filament.user_id = current_user_id
    and filament.is_active = true
    and regexp_replace(
      translate(lower(btrim(filament.filament_type)), 'áéíóúüñ', 'aeiouun'),
      '\s+', ' ', 'g'
    ) = normalized_material
    and regexp_replace(
      translate(
        lower(btrim(coalesce(filament.brand, template.brand, ''))),
        'áéíóúüñ',
        'aeiouun'
      ),
      '\s+', ' ', 'g'
    ) = normalized_brand
    and regexp_replace(
      translate(lower(btrim(coalesce(filament.name, ''))), 'áéíóúüñ', 'aeiouun'),
      '\s+', ' ', 'g'
    ) = normalized_subtype
    and regexp_replace(
      translate(lower(btrim(coalesce(filament.color, 'Sin color'))), 'áéíóúüñ', 'aeiouun'),
      '\s+', ' ', 'g'
    ) = normalized_color
  limit 1
  for update of filament;

  if duplicate_filament_id is not null then
    return query select
      false,
      action_request.id,
      duplicate_filament_id,
      null::text,
      null::numeric,
      null::numeric,
      'duplicate_filament'::text,
      'Ya existe un filamento parecido. Abrí Stock para revisarlo.'::text;
    return;
  end if;

  insert into public.filaments as filament (
    user_id,
    filament_type,
    brand,
    name,
    color,
    color_hex,
    total_grams,
    remaining_grams,
    purchase_price,
    is_active,
    source_template_id
  ) values (
    current_user_id,
    material_value,
    brand_value,
    subtype_value,
    color_value,
    null,
    created_total_grams,
    created_total_grams,
    0,
    true,
    null
  )
  returning
    filament.id,
    filament.total_grams,
    filament.remaining_grams
  into
    created_filament_id,
    created_total_grams,
    created_remaining_grams;

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

  created_label := concat_ws(
    ' · ',
    material_value,
    brand_value,
    subtype_value,
    color_value
  );

  return query select
    true,
    action_request.id,
    created_filament_id,
    created_label,
    created_total_grams,
    created_remaining_grams,
    null::text,
    'Listo, creé el filamento.'::text;
end;
$$;

revoke all on function public.confirm_stampy_create_filament(uuid)
from public, anon, authenticated;

grant execute on function public.confirm_stampy_create_filament(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
