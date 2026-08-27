do $stampy_discount_product_dependencies$
begin
  if to_regclass('public.stampy_action_requests') is null then
    raise exception 'Missing dependency: public.stampy_action_requests';
  end if;
  if to_regclass('public.products') is null then
    raise exception 'Missing dependency: public.products';
  end if;
  if to_regclass('public.product_components') is null then
    raise exception 'Missing dependency: public.product_components';
  end if;
  if to_regclass('public.product_component_filaments') is null then
    raise exception 'Missing dependency: public.product_component_filaments';
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
$stampy_discount_product_dependencies$;

alter table public.stampy_action_requests
  drop constraint if exists stampy_action_requests_action_type_check;

alter table public.stampy_action_requests
  add constraint stampy_action_requests_action_type_check
  check (action_type in (
    'discount_filament',
    'discount_product_filaments',
    'add_filament',
    'increase_filament_stock',
    'add_printer',
    'create_product',
    'create_quote',
    'calculate_price',
    'update_stock',
    'unknown_action'
  ));

create or replace function public.confirm_stampy_discount_product_filaments(
  p_action_request_id uuid
)
returns table (
  success boolean,
  action_request_id uuid,
  products_count integer,
  filaments_count integer,
  total_grams numeric,
  error_code text,
  message text
)
language plpgsql
security invoker
set search_path = ''
as $stampy_discount_product_filaments$
declare
  current_user_id uuid := auth.uid();
  action_request public.stampy_action_requests%rowtype;
  target_product public.products%rowtype;
  target_filament public.filaments%rowtype;
  items_value jsonb;
  prepared_products_value jsonb;
  prepared_consumptions_value jsonb;
  item_value jsonb;
  recipe_record record;
  consumption_record record;
  product_name_value text;
  normalized_requested_name text;
  singular_requested_name text;
  quantity_text text;
  item_quantity integer;
  product_matches integer;
  recipe_rows integer;
  component_quantity numeric;
  recipe_grams numeric;
  required_grams numeric;
  expected_remaining numeric;
  resulting_remaining numeric;
  consumption_totals jsonb := '{}'::jsonb;
  processed_products integer := 0;
  processed_filaments integer := 0;
  consumed_grams numeric := 0;
  updated_requests integer;
begin
  if current_user_id is null then
    return query select false, p_action_request_id, 0, 0, 0::numeric,
      'unauthenticated'::text,
      'Necesitás iniciar sesión para confirmar el descuento.'::text;
    return;
  end if;

  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, p_action_request_id, 0, 0, 0::numeric,
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
    return query select false, p_action_request_id, 0, 0, 0::numeric,
      'action_request_not_found'::text,
      'No encontré una solicitud de descuento válida.'::text;
    return;
  end if;

  if action_request.user_id is distinct from current_user_id then
    return query select false, action_request.id, 0, 0, 0::numeric,
      'action_request_forbidden'::text,
      'La solicitud no pertenece al usuario actual.'::text;
    return;
  end if;

  if action_request.status = 'executed' then
    return query select false, action_request.id, 0, 0, 0::numeric,
      'already_executed'::text,
      'Este descuento ya fue confirmado anteriormente.'::text;
    return;
  end if;

  if action_request.status is null
     or action_request.status not in ('suggested', 'opened_tool') then
    return query select false, action_request.id, 0, 0, 0::numeric,
      'invalid_action_status'::text,
      'La solicitud ya no está pendiente de confirmación.'::text;
    return;
  end if;

  if action_request.can_execute is distinct from false then
    return query select false, action_request.id, 0, 0, 0::numeric,
      'invalid_execution_policy'::text,
      'La solicitud no cumple la política segura de ejecución.'::text;
    return;
  end if;

  if action_request.action_type is distinct from 'discount_product_filaments' then
    return query select false, action_request.id, 0, 0, 0::numeric,
      'unsupported_action_type'::text,
      'Esta solicitud no corresponde a un descuento por receta de producto.'::text;
    return;
  end if;

  items_value := action_request.extracted -> 'items';
  prepared_products_value := coalesce(
    action_request.extracted -> 'resolvedProducts', '[]'::jsonb
  );
  prepared_consumptions_value := coalesce(
    action_request.extracted -> 'consumptions', '[]'::jsonb
  );
  if jsonb_typeof(items_value) is distinct from 'array'
     or jsonb_array_length(items_value) < 1
     or jsonb_array_length(items_value) > 10
     or jsonb_typeof(prepared_products_value) is distinct from 'array'
     or jsonb_typeof(prepared_consumptions_value) is distinct from 'array' then
    return query select false, action_request.id, 0, 0, 0::numeric,
      'invalid_items'::text,
      'La solicitud no contiene una lista de productos válida.'::text;
    return;
  end if;

  for item_value in select value from jsonb_array_elements(items_value)
  loop
    product_name_value := nullif(btrim(item_value ->> 'productName'), '');
    quantity_text := nullif(btrim(item_value ->> 'quantity'), '');
    if product_name_value is null
       or char_length(product_name_value) < 2
       or char_length(product_name_value) > 160
       or product_name_value !~ '[[:alnum:]]' then
      return query select false, action_request.id, 0, 0, 0::numeric,
        'invalid_product_name'::text,
        'Uno de los productos no tiene un nombre válido.'::text;
      return;
    end if;
    if quantity_text is null or quantity_text !~ '^\d+$' then
      return query select false, action_request.id, 0, 0, 0::numeric,
        'invalid_quantity'::text,
        'Una de las cantidades no es un entero válido.'::text;
      return;
    end if;
    item_quantity := quantity_text::integer;
    if item_quantity < 1 or item_quantity > 50 then
      return query select false, action_request.id, 0, 0, 0::numeric,
        'invalid_quantity'::text,
        'Cada cantidad debe estar entre 1 y 50 unidades.'::text;
      return;
    end if;

    normalized_requested_name := btrim(regexp_replace(
      translate(lower(product_name_value), 'áéíóúüñ', 'aeiouun'),
      '[^a-z0-9]+', ' ', 'g'
    ));
    singular_requested_name := btrim(regexp_replace(
      normalized_requested_name,
      's([[:space:]]|$)', '\1', 'g'
    ));

    select count(*)::integer
    into product_matches
    from public.products as product
    where product.user_id = current_user_id
      and product.is_active = true
      and (
        btrim(regexp_replace(
          btrim(regexp_replace(
            translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
            '[^a-z0-9]+', ' ', 'g'
          )),
          's([[:space:]]|$)', '\1', 'g'
        )) = singular_requested_name
        or position(singular_requested_name in btrim(regexp_replace(
          btrim(regexp_replace(
            translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
            '[^a-z0-9]+', ' ', 'g'
          )),
          's([[:space:]]|$)', '\1', 'g'
        ))) > 0
        or position(btrim(regexp_replace(
          btrim(regexp_replace(
            translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
            '[^a-z0-9]+', ' ', 'g'
          )),
          's([[:space:]]|$)', '\1', 'g'
        )) in singular_requested_name) > 0
      );

    if product_matches = 0 then
      return query select false, action_request.id, processed_products, 0,
        0::numeric, 'product_not_found'::text,
        format('No encontré un producto activo que coincida con %s.', product_name_value);
      return;
    end if;
    if product_matches > 1 then
      return query select false, action_request.id, processed_products, 0,
        0::numeric, 'product_ambiguous'::text,
        format('Encontré más de un producto parecido a %s.', product_name_value);
      return;
    end if;

    select product.*
    into target_product
    from public.products as product
    where product.user_id = current_user_id
      and product.is_active = true
      and (
        btrim(regexp_replace(
          btrim(regexp_replace(
            translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
            '[^a-z0-9]+', ' ', 'g'
          )),
          's([[:space:]]|$)', '\1', 'g'
        )) = singular_requested_name
        or position(singular_requested_name in btrim(regexp_replace(
          btrim(regexp_replace(
            translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
            '[^a-z0-9]+', ' ', 'g'
          )),
          's([[:space:]]|$)', '\1', 'g'
        ))) > 0
        or position(btrim(regexp_replace(
          btrim(regexp_replace(
            translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
            '[^a-z0-9]+', ' ', 'g'
          )),
          's([[:space:]]|$)', '\1', 'g'
        )) in singular_requested_name) > 0
      )
    limit 1
    for update;

    if not found then
      return query select false, action_request.id, processed_products, 0,
        0::numeric, 'product_not_found'::text,
        format('El producto %s dejó de estar disponible.', product_name_value);
      return;
    end if;

    perform component.id
    from public.product_components as component
    where component.product_id = target_product.id
      and component.user_id = current_user_id
      and component.is_active = true
    for update;

    perform recipe.id
    from public.product_component_filaments as recipe
    join public.product_components as component
      on component.id = recipe.component_id
    where component.product_id = target_product.id
      and component.user_id = current_user_id
      and component.is_active = true
    for update of recipe;

    recipe_rows := 0;
    for recipe_record in
      select
        component.id as component_id,
        component.quantity_per_product,
        recipe.filament_id,
        recipe.grams
      from public.product_components as component
      left join public.product_component_filaments as recipe
        on recipe.component_id = component.id
      where component.product_id = target_product.id
        and component.user_id = current_user_id
        and component.is_active = true
      order by component.id, recipe.id
    loop
      recipe_rows := recipe_rows + 1;
      if recipe_record.filament_id is null then
        return query select false, action_request.id, processed_products, 0,
          0::numeric, 'filament_unresolved'::text,
          format(
            'El producto %s tiene un componente sin filamento exacto asociado.',
            target_product.name
          );
        return;
      end if;
      component_quantity := recipe_record.quantity_per_product::numeric;
      recipe_grams := recipe_record.grams::numeric;
      if component_quantity is null
         or recipe_grams is null
         or component_quantity <= 0
         or recipe_grams <= 0 then
        return query select false, action_request.id, processed_products, 0,
          0::numeric, 'invalid_recipe'::text,
          format('La receta de %s contiene cantidades inválidas.', target_product.name);
        return;
      end if;
      required_grams := recipe_grams * component_quantity * item_quantity;
      consumption_totals := jsonb_set(
        consumption_totals,
        array[recipe_record.filament_id::text],
        to_jsonb(
          coalesce(
            (consumption_totals ->> recipe_record.filament_id::text)::numeric,
            0
          ) + required_grams
        ),
        true
      );
    end loop;

    if recipe_rows = 0 then
      return query select false, action_request.id, processed_products, 0,
        0::numeric, 'recipe_missing'::text,
        format(
          'El producto %s no tiene receta de filamentos cargada.',
          target_product.name
        );
      return;
    end if;
    processed_products := processed_products + 1;
  end loop;

  if consumption_totals = '{}'::jsonb then
    return query select false, action_request.id, processed_products, 0,
      0::numeric, 'recipe_missing'::text,
      'Los productos no tienen consumos de filamento válidos.'::text;
    return;
  end if;

  -- Lock every affected filament in a deterministic order and validate all
  -- stock before making the first movement.
  for consumption_record in
    select key as filament_id, value::numeric as required_grams
    from jsonb_each_text(consumption_totals)
    order by key
  loop
    select filament.*
    into target_filament
    from public.filaments as filament
    where filament.id = consumption_record.filament_id::uuid
    for update;

    if not found
       or target_filament.user_id is distinct from current_user_id
       or target_filament.is_active is distinct from true then
      return query select false, action_request.id, processed_products, 0,
        0::numeric, 'filament_unavailable'::text,
        'Un filamento de la receta no existe, no está activo o no pertenece al usuario.'::text;
      return;
    end if;
    required_grams := consumption_record.required_grams;
    if coalesce(target_filament.remaining_grams, 0)::numeric < required_grams then
      return query select false, action_request.id, processed_products, 0,
        0::numeric, 'insufficient_stock'::text,
        format(
          'No alcanza el stock de %s: necesitás %sg y te quedan %sg.',
          coalesce(target_filament.name, target_filament.filament_type, 'filamento'),
          required_grams,
          coalesce(target_filament.remaining_grams, 0)
        );
      return;
    end if;
    processed_filaments := processed_filaments + 1;
    consumed_grams := consumed_grams + required_grams;
  end loop;

  for consumption_record in
    select key as filament_id, value::numeric as required_grams
    from jsonb_each_text(consumption_totals)
    order by key
  loop
    select filament.*
    into target_filament
    from public.filaments as filament
    where filament.id = consumption_record.filament_id::uuid;
    required_grams := consumption_record.required_grams;
    expected_remaining :=
      coalesce(target_filament.remaining_grams, 0)::numeric - required_grams;

    perform public.adjust_filament_stock(
      p_filament_id => target_filament.id,
      p_grams_delta => -required_grams,
      p_movement_type => 'manual_subtract',
      p_reason => 'Stampy: descuento por receta de producto',
      p_source_type => 'stampy_action_request',
      p_source_id => action_request.id
    );

    select filament.remaining_grams::numeric
    into resulting_remaining
    from public.filaments as filament
    where filament.id = target_filament.id;
    if resulting_remaining is distinct from expected_remaining then
      raise exception using
        errcode = 'P0001',
        message = 'adjust_filament_stock returned an unexpected remaining_grams value';
    end if;
  end loop;

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

  return query select true, action_request.id, processed_products,
    processed_filaments, consumed_grams, null::text,
    format(
      'Listo, desconté los filamentos de %s producto(s). Se descontaron %sg en total.',
      processed_products,
      consumed_grams
    );
end;
$stampy_discount_product_filaments$;

revoke all on function public.confirm_stampy_discount_product_filaments(uuid)
from public, anon, authenticated;

grant execute on function public.confirm_stampy_discount_product_filaments(uuid)
to authenticated;

notify pgrst, 'reload schema';
