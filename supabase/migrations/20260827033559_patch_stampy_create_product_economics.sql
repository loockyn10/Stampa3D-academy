create or replace function public.confirm_stampy_create_product(
  p_action_request_id uuid
)
returns table (
  success boolean,
  action_request_id uuid,
  product_id uuid,
  product_name text,
  components_count integer,
  unmatched_components_count integer,
  error_code text,
  message text
)
language plpgsql
security invoker
set search_path = ''
as $stampy_create_product_economics$
declare
  current_user_id uuid := auth.uid();
  action_request public.stampy_action_requests%rowtype;
  product_name_value text;
  normalized_product_name text;
  initial_stock_text text;
  print_time_text text;
  base_cost_text text;
  sale_price_text text;
  normalized_number_text text;
  initial_stock_value integer := 0;
  print_time_value integer := 0;
  base_cost_value numeric := 0;
  sale_price_value numeric := 0;
  has_initial_stock boolean := false;
  has_print_time boolean := false;
  has_base_cost boolean := false;
  has_sale_price boolean := false;
  components_value jsonb := '[]'::jsonb;
  component_value jsonb;
  component_grams_text text;
  component_grams numeric;
  component_material text;
  component_brand text;
  component_name text;
  component_color text;
  requested_filament_id_text text;
  requested_filament_id uuid;
  matched_filament_id uuid;
  fallback_filament_id uuid;
  created_product_id uuid;
  created_component_id uuid;
  duplicate_product_id uuid;
  inserted_components integer := 0;
  unmatched_components integer := 0;
  total_recipe_grams numeric := 0;
  component_index integer := 0;
  updated_requests integer;
  result_message text;
  formatted_time text;
begin
  if current_user_id is null then
    return query select false, p_action_request_id, null::uuid, null::text,
      0, 0, 'unauthenticated'::text,
      'Necesitás iniciar sesión para crear el producto.'::text;
    return;
  end if;

  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, p_action_request_id, null::uuid, null::text,
      0, 0, 'platform_access_required'::text,
      'No tenés acceso habilitado para usar Stampy.'::text;
    return;
  end if;

  select request.*
  into action_request
  from public.stampy_action_requests as request
  where request.id = p_action_request_id
  for update;

  if not found then
    return query select false, p_action_request_id, null::uuid, null::text,
      0, 0, 'action_request_not_found'::text,
      'No encontré una solicitud de creación válida.'::text;
    return;
  end if;

  if action_request.user_id is distinct from current_user_id then
    return query select false, action_request.id, null::uuid, null::text,
      0, 0, 'action_request_forbidden'::text,
      'La solicitud no pertenece al usuario actual.'::text;
    return;
  end if;

  if action_request.status = 'executed' then
    return query select false, action_request.id, null::uuid,
      action_request.extracted ->> 'productName', 0, 0,
      'already_executed'::text,
      'Este producto ya fue creado anteriormente.'::text;
    return;
  end if;

  if action_request.status is null
     or action_request.status not in ('suggested', 'opened_tool') then
    return query select false, action_request.id, null::uuid, null::text,
      0, 0, 'invalid_action_status'::text,
      'La solicitud ya no está pendiente de confirmación.'::text;
    return;
  end if;

  if action_request.can_execute is distinct from false then
    return query select false, action_request.id, null::uuid, null::text,
      0, 0, 'invalid_execution_policy'::text,
      'La solicitud no cumple la política segura de ejecución.'::text;
    return;
  end if;

  if action_request.action_type is distinct from 'create_product' then
    return query select false, action_request.id, null::uuid, null::text,
      0, 0, 'unsupported_action_type'::text,
      'Esta solicitud no corresponde a crear un producto.'::text;
    return;
  end if;

  product_name_value := nullif(btrim(action_request.extracted ->> 'productName'), '');
  if product_name_value is null
     or char_length(product_name_value) < 2
     or char_length(product_name_value) > 160
     or product_name_value !~ '[[:alnum:]]' then
    return query select false, action_request.id, null::uuid, product_name_value,
      0, 0, 'invalid_product_name'::text,
      'La solicitud no tiene un nombre de producto válido.'::text;
    return;
  end if;

  initial_stock_text := nullif(btrim(action_request.extracted ->> 'initialStock'), '');
  has_initial_stock := initial_stock_text is not null;
  if has_initial_stock then
    normalized_number_text := regexp_replace(initial_stock_text, '[[:space:]]', '', 'g');
    if normalized_number_text !~ '^\d+$' then
      return query select false, action_request.id, null::uuid, product_name_value,
        0, 0, 'invalid_initial_stock'::text,
        'El stock inicial no es válido.'::text;
      return;
    end if;
    initial_stock_value := normalized_number_text::integer;
  end if;
  if initial_stock_value < 0 or initial_stock_value > 100000000 then
    return query select false, action_request.id, null::uuid, product_name_value,
      0, 0, 'invalid_initial_stock'::text,
      'El stock inicial está fuera del rango permitido.'::text;
    return;
  end if;

  print_time_text := nullif(btrim(action_request.extracted ->> 'printTimeMinutes'), '');
  has_print_time := print_time_text is not null;
  if has_print_time then
    normalized_number_text := regexp_replace(print_time_text, '[[:space:]]', '', 'g');
    if normalized_number_text !~ '^\d+(\.0+)?$' then
      return query select false, action_request.id, null::uuid, product_name_value,
        0, 0, 'invalid_print_time'::text,
        'El tiempo de impresión no es válido.'::text;
      return;
    end if;
    print_time_value := normalized_number_text::numeric::integer;
  end if;
  if print_time_value < 0 or print_time_value > 100000000 then
    return query select false, action_request.id, null::uuid, product_name_value,
      0, 0, 'invalid_print_time'::text,
      'El tiempo de impresión está fuera del rango permitido.'::text;
    return;
  end if;

  base_cost_text := nullif(btrim(action_request.extracted ->> 'baseCost'), '');
  has_base_cost := base_cost_text is not null;
  if has_base_cost then
    normalized_number_text := regexp_replace(base_cost_text, '[$[:space:]]', '', 'g');
    if normalized_number_text ~ '^\d{1,3}([.,]\d{3})+$' then
      normalized_number_text := regexp_replace(normalized_number_text, '[.,]', '', 'g');
    elsif normalized_number_text ~ '^\d+[.,]\d{1,2}$' then
      normalized_number_text := replace(normalized_number_text, ',', '.');
    elsif normalized_number_text !~ '^\d+$' then
      return query select false, action_request.id, null::uuid, product_name_value,
        0, 0, 'invalid_base_cost'::text,
        'El costo base no es válido.'::text;
      return;
    end if;
    base_cost_value := normalized_number_text::numeric;
  end if;
  if base_cost_value < 0 or base_cost_value > 1000000000000 then
    return query select false, action_request.id, null::uuid, product_name_value,
      0, 0, 'invalid_base_cost'::text,
      'El costo base está fuera del rango permitido.'::text;
    return;
  end if;

  sale_price_text := coalesce(
    nullif(btrim(action_request.extracted ->> 'salePrice'), ''),
    nullif(btrim(action_request.extracted ->> 'price'), '')
  );
  has_sale_price := sale_price_text is not null;
  if has_sale_price then
    normalized_number_text := regexp_replace(sale_price_text, '[$[:space:]]', '', 'g');
    if normalized_number_text ~ '^\d{1,3}([.,]\d{3})+$' then
      normalized_number_text := regexp_replace(normalized_number_text, '[.,]', '', 'g');
    elsif normalized_number_text ~ '^\d+[.,]\d{1,2}$' then
      normalized_number_text := replace(normalized_number_text, ',', '.');
    elsif normalized_number_text !~ '^\d+$' then
      return query select false, action_request.id, null::uuid, product_name_value,
        0, 0, 'invalid_sale_price'::text,
        'El precio de venta no es válido.'::text;
      return;
    end if;
    sale_price_value := normalized_number_text::numeric;
  end if;
  if sale_price_value < 0 or sale_price_value > 1000000000000 then
    return query select false, action_request.id, null::uuid, product_name_value,
      0, 0, 'invalid_sale_price'::text,
      'El precio de venta está fuera del rango permitido.'::text;
    return;
  end if;

  if action_request.extracted ? 'components' then
    if jsonb_typeof(action_request.extracted -> 'components') <> 'array' then
      return query select false, action_request.id, null::uuid, product_name_value,
        0, 0, 'invalid_components'::text,
        'La receta de filamentos no tiene un formato válido.'::text;
      return;
    end if;
    components_value := action_request.extracted -> 'components';
  end if;
  if jsonb_array_length(components_value) > 20 then
    return query select false, action_request.id, null::uuid, product_name_value,
      0, 0, 'too_many_components'::text,
      'La receta supera el máximo de 20 componentes.'::text;
    return;
  end if;

  normalized_product_name := btrim(regexp_replace(
    translate(lower(product_name_value), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', ' ', 'g'
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text),
    pg_catalog.hashtext('stampy_create_product')
  );

  select product.id
  into duplicate_product_id
  from public.products as product
  where product.user_id = current_user_id
    and product.is_active = true
    and (
      btrim(regexp_replace(
        translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
        '[^a-z0-9]+', ' ', 'g'
      )) = normalized_product_name
      or position(normalized_product_name in btrim(regexp_replace(
        translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
        '[^a-z0-9]+', ' ', 'g'
      ))) > 0
      or position(btrim(regexp_replace(
        translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
        '[^a-z0-9]+', ' ', 'g'
      )) in normalized_product_name) > 0
    )
  order by product.created_at asc
  limit 1
  for update;

  if duplicate_product_id is not null then
    return query select false, action_request.id, duplicate_product_id,
      product_name_value, 0, 0, 'duplicate_product'::text,
      'Ya existe un producto parecido. Abrí Productos o Stock para revisarlo.'::text;
    return;
  end if;

  for component_value in select value from jsonb_array_elements(components_value)
  loop
    component_grams_text := nullif(btrim(component_value ->> 'grams'), '');
    component_material := nullif(btrim(component_value ->> 'material'), '');
    component_brand := nullif(btrim(component_value ->> 'brand'), '');
    component_name := nullif(btrim(component_value ->> 'name'), '');
    component_color := nullif(btrim(component_value ->> 'color'), '');

    if component_grams_text is null or component_grams_text !~ '^\d+(\.\d+)?$' then
      return query select false, action_request.id, null::uuid,
        product_name_value, 0, 0, 'invalid_component_grams'::text,
        'Uno de los componentes no tiene gramos válidos.'::text;
      return;
    end if;
    component_grams := component_grams_text::numeric;
    if component_grams <= 0 or component_grams > 99999999.99 then
      return query select false, action_request.id, null::uuid,
        product_name_value, 0, 0, 'invalid_component_grams'::text,
        'Los gramos de la receta están fuera del rango permitido.'::text;
      return;
    end if;
    if component_material is null or char_length(component_material) > 100 then
      return query select false, action_request.id, null::uuid,
        product_name_value, 0, 0, 'invalid_component_material'::text,
        'Uno de los componentes no tiene un material válido.'::text;
      return;
    end if;
    if char_length(coalesce(component_brand, '')) > 100
       or char_length(coalesce(component_name, '')) > 100
       or char_length(coalesce(component_color, '')) > 100 then
      return query select false, action_request.id, null::uuid,
        product_name_value, 0, 0, 'invalid_component_fields'::text,
        'Los datos de uno de los componentes son demasiado largos.'::text;
      return;
    end if;

    requested_filament_id_text := nullif(btrim(component_value ->> 'filamentId'), '');
    matched_filament_id := null;
    if requested_filament_id_text is not null
       and requested_filament_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      requested_filament_id := requested_filament_id_text::uuid;
      select filament.id
      into matched_filament_id
      from public.filaments as filament
      where filament.id = requested_filament_id
        and filament.user_id = current_user_id
        and filament.is_active = true
      for update;
    end if;
    if matched_filament_id is null then
      unmatched_components := unmatched_components + 1;
    elsif fallback_filament_id is null then
      fallback_filament_id := matched_filament_id;
    end if;
    total_recipe_grams := total_recipe_grams + component_grams;
  end loop;

  insert into public.products as product (
    user_id, name, description, image_url, filament_id, grams,
    print_time_minutes, base_cost, sale_price, stock_quantity, is_active
  ) values (
    current_user_id, product_name_value, '', '', fallback_filament_id,
    total_recipe_grams, print_time_value, base_cost_value, sale_price_value,
    initial_stock_value, true
  )
  returning product.id into created_product_id;

  if jsonb_array_length(components_value) > 0 then
    insert into public.product_components as component (
      user_id, product_id, name, quantity_per_product,
      stock_quantity, sort_order, is_active
    ) values (
      current_user_id, created_product_id, 'Producto completo', 1, 0, 0, true
    )
    returning component.id into created_component_id;

    for component_value in select value from jsonb_array_elements(components_value)
    loop
      component_grams := (component_value ->> 'grams')::numeric;
      component_material := nullif(btrim(component_value ->> 'material'), '');
      component_brand := nullif(btrim(component_value ->> 'brand'), '');
      component_name := nullif(btrim(component_value ->> 'name'), '');
      component_color := nullif(btrim(component_value ->> 'color'), '');
      requested_filament_id_text := nullif(btrim(component_value ->> 'filamentId'), '');
      matched_filament_id := null;

      if requested_filament_id_text is not null
         and requested_filament_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        select filament.id
        into matched_filament_id
        from public.filaments as filament
        where filament.id = requested_filament_id_text::uuid
          and filament.user_id = current_user_id
          and filament.is_active = true;
      end if;

      insert into public.product_component_filaments (
        user_id, component_id, filament_id, filament_type,
        brand, name, color, grams, sort_order
      ) values (
        current_user_id, created_component_id, matched_filament_id,
        component_material, component_brand, component_name, component_color,
        component_grams, component_index
      );

      component_index := component_index + 1;
      inserted_components := inserted_components + 1;
    end loop;
  end if;

  update public.stampy_action_requests as request
  set status = 'executed', executed_at = now(), updated_at = now(),
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

  result_message := format('Listo, creé el producto %s.', product_name_value);
  if has_initial_stock or has_print_time or has_base_cost or has_sale_price then
    result_message := result_message || ' Guardé';
    if has_initial_stock then
      result_message := result_message || format(' stock inicial %s;', initial_stock_value);
    end if;
    if has_print_time then
      formatted_time := case
        when print_time_value >= 60 and print_time_value % 60 > 0
          then format('%sh %sm', print_time_value / 60, print_time_value % 60)
        when print_time_value >= 60 then format('%sh', print_time_value / 60)
        else format('%sm', print_time_value)
      end;
      result_message := result_message || format(' tiempo %s;', formatted_time);
    end if;
    if has_base_cost then
      result_message := result_message || format(' costo $%s;', base_cost_value);
    end if;
    if has_sale_price then
      result_message := result_message || format(' venta $%s;', sale_price_value);
    end if;
    result_message := rtrim(result_message, ';') || '.';
  end if;
  if inserted_components > 0 then
    result_message := result_message || format(
      ' También guardé %s componente(s) de filamento.', inserted_components
    );
  end if;
  if unmatched_components > 0 then
    result_message := result_message || format(
      ' %s componente(s) quedaron sin filamento exacto asociado.',
      unmatched_components
    );
  end if;

  return query select true, action_request.id, created_product_id,
    product_name_value, inserted_components, unmatched_components,
    null::text, result_message;
end;
$stampy_create_product_economics$;

revoke all on function public.confirm_stampy_create_product(uuid)
from public, anon, authenticated;

grant execute on function public.confirm_stampy_create_product(uuid)
to authenticated;

notify pgrst, 'reload schema';
