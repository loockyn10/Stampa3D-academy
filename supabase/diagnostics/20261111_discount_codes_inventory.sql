-- DISCOUNT CODES — INVENTORY OF THE ACTIVE DISCOUNT CODES. SOLO LECTURA (una única sentencia SELECT).
--
-- Pegar el archivo COMPLETO en el SQL Editor de Supabase. No cambia, crea ni borra nada.
-- Sirve para identificar los códigos de descuento que ya existen (el diagnóstico 20261029_discount_codes_state.sql solo
-- cuenta: «3 activos sin límite») y decidir cuáles desactivar ANTES de encender DISCOUNT_CODES_ENABLED.
--
-- Privacidad: el código se muestra ENMASCARADO (primeros 4 y últimos 2 caracteres + largo). Un código de descuento es un
-- «portador»: quien lo conozca lo puede usar, así que no lo pegues completo en chats ni tickets. Tampoco imprime correos,
-- ids de usuario ni preapprovals. `title` y `notes` son texto libre que escribió un administrador en /admin/codigos.
--
-- Cómo leerlo:
--   * is_unlimited = true  -> sin max_uses: con el interruptor encendido no se agota nunca.
--   * never_expires = true -> sin vencimiento.
--   * redemptions / reservations / used_count = 0 -> nunca se usó ni se intentó usar (seguro de desactivar).
--   * Si alguno tiene uso real (redemptions > 0 o used_count > 0) NO es un código de prueba sin uso: revisar antes.

select
  k.created_at::date                                              as created,
  k.code_type::text                                               as code_type,
  left(k.code, 4) || repeat('*', greatest(char_length(k.code) - 6, 0)) || right(k.code, 2) as code_masked,
  char_length(k.code)                                             as code_length,
  k.title                                                         as title,
  k.notes                                                         as notes,
  k.discount_value                                                as discount_value,
  k.discount_duration::text                                       as duration,
  k.status::text                                                  as status,
  k.max_uses                                                      as max_uses,
  (k.max_uses is null)                                            as is_unlimited,
  k.used_count                                                    as used_count,
  (select count(*) from public.invite_code_redemptions r where r.invite_code_id = k.id) as redemptions,
  case when to_regclass('public.discount_code_reservations') is null then null
       else (xpath('/row/n/text()',
              query_to_xml(format('select count(*) as n from public.discount_code_reservations where invite_code_id = %L', k.id),
                           false, true, '')))[1]::text::int end   as reservations,
  k.starts_at::date                                               as starts,
  k.expires_at::date                                              as expires,
  (k.expires_at is null)                                          as never_expires
from public.invite_codes k
where k.code_type::text in ('discount_percent', 'discount_fixed_amount', 'fixed_price')
order by k.created_at, k.code_type;
