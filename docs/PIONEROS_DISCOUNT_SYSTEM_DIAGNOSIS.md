# Edición Pioneros — diagnóstico del sistema de descuentos existente (2026-11-11)

**Alcance:** verificación y preparación. Nada se aplicó ni se ejecutó: sin cambios en Supabase, Mercado Pago, precios, suscripciones ni Vercel; sin M1; sin push ni deploy. Los pasos marcados **«lo hacés vos»** requieren tu autorización/acción.

> **[C]** confirmado (resultado real del diagnóstico del usuario, código del repo o test contra Postgres real) · **[D]** documentación oficial de Mercado Pago · **[?]** NO verificado.

## 1. Diagnóstico confirmado de la base real [C]

Resultado del diagnóstico de solo lectura `supabase/diagnostics/20261029_discount_codes_state.sql`, ejecutado por el usuario en Supabase el 2026-11-11:

| Punto | Resultado |
|---|---|
| `20261029120000_discount_code_checkout` | **Aplicada** |
| `20261030120000_discount_checkout_consistency` | **Aplicada** (un checkout abierto conserva su cupo; una autorización tardía no supera el límite) |
| Dependencias | `invite_codes`, `invite_code_redemptions`, `checkout_attempts`, `subscriptions` existen; `invite_codes.id` es `uuid` |
| Permisos de las 8 funciones | `SECURITY DEFINER` (menos `discount_code_final_amount`), `EXECUTE` solo para `service_role`; `anon` y `authenticated` sin acceso |
| Tablas nuevas | `discount_code_reservations` y `discount_code_failed_attempts`: RLS activa, sin SELECT para `anon`/`authenticated` |
| Reservas / canjes / sobrecupo / cupos retenidos | 0 / 0 / 0 / 0 |
| Códigos «primer mes» no soportados | 0 |
| **Códigos de descuento existentes** | **3 activos**, uno por tipo (`discount_percent`, `discount_fixed_amount`, `fixed_price`), duración «para siempre», **sin `max_uses`, sin vencimiento, `used_count` = 0** |
| Checkouts completados con suscripción aún pendiente | 3 (informativo; no retienen cupo) |

Lo que **no** se sabe: el valor de `DISCOUNT_CODES_ENABLED` en producción **[?]**, y qué son esos 3 códigos **[?]** (el diagnóstico no imprime nombres).

## 2. Verificar `DISCOUNT_CODES_ENABLED` en Vercel Production (lo hacés vos)

El código solo lo considera encendido si vale **exactamente** `true` en el servidor (`src/lib/discounts/discount-codes.ts:116`). `True`, `TRUE`, `1`, `true ` (con espacio) o variable inexistente = apagado. Está apagado por defecto (`.env.example`).

1. Vercel → proyecto de la Academia → **Settings → Environment Variables**.
2. Buscar `DISCOUNT_CODES_ENABLED` y mirar **qué entornos la tienen** (Production / Preview / Development son independientes). Lo que importa es la fila que incluye **Production**.
3. Tres respuestas posibles:
   - **No existe** (o vale algo distinto de `true`) → apagado. Es el estado deseado ahora.
   - **Vale `true` en Production** → **encendido**: los 3 códigos existentes ya son canjeables hoy por cualquiera que los conozca. Pasar al §3 de inmediato y decidir si apagar la variable.
   - **Está marcada «Sensitive»** y no se ve el valor → usar la verificación en la app (punto 5).
4. **Cuidado con el deploy:** Vercel aplica una variable solo a deployments **posteriores** al cambio. Si se editó pero no se redesplegó, el valor mostrado puede no ser el que corre. Mirar en **Deployments** si el último deployment de Production es posterior a la última edición de la variable (el detalle del deployment muestra «Environment Variables» aplicadas al buildear).
5. **Verificación en la app (no cambia nada):** con una cuenta **Free sin membresía**, entrar a `https://academia-stampa.com/sin-acceso`. Si aparece **«Tengo un código de descuento»** → el interruptor está **encendido**; si no aparece → **apagado**. (El campo se muestra solo cuando el servidor lo tiene encendido: `sin-acceso-client.tsx:365`.)
6. Para **apagarlo** (solo si estuviera encendido, y solo con tu OK): editar la variable a `false` (o borrarla) en Production y **redesplegar**. Es reversible y no toca datos ni suscripciones ya creadas.

Anotá el resultado (no hace falta pegar valores): «apagado», «encendido» o «no se pudo ver».

## 3. Identificar los tres códigos (lo hacés vos, solo lectura)

**Opción A — la pantalla del admin (sin SQL):** `/admin/codigos` ya lista código, tipo, beneficio, usos, vigencia y estado. Con 3 filas se identifican a ojo.

**Opción B — SQL de solo lectura:** pegar **completo** `supabase/diagnostics/20261111_discount_codes_inventory.sql` en el SQL Editor. Es una única sentencia `SELECT` (verificado por test: corre en transacción de solo lectura). Devuelve por código: fecha de creación, tipo, **código enmascarado** (`PREC**********99`), título, notas, valor, estado, `max_uses`, `used_count`, canjes y reservas. **No imprime el código completo, correos ni ids de usuario.**

Cómo decidir (cada código):

| Evidencia | Conclusión |
|---|---|
| `title`/`notes` dicen prueba/test, creado cuando se desarrolló D032–D034, `used_count`=0, canjes=0, reservas=0 | Código de prueba → **desactivar** (§4) |
| Sin título ni notas, o creado para una persona/campaña real | **No asumir que es de prueba**: preguntarle a quien lo creó antes de tocar |
| `used_count` > 0 o canjes > 0 | Tiene uso real: no desactivar sin revisar a quién se le aplicó (el diagnóstico dice que hoy no hay ninguno) |

## 4. Desactivación preparada (NO ejecutada — requiere tu autorización)

**Vía recomendada: la pantalla `/admin/codigos`.** En la fila del código, el botón del interruptor («Desactivar»). Hace `update invite_codes set status = 'inactive' where id = …` con tu sesión de admin (`page.tsx:228`). No borra el código ni su historial.

Efecto verificado por test contra Postgres real [C]: con `status` distinto de `active`, `reserve_discount_code` responde `invalid` (en vista previa y al reservar) y no crea reservas. Es **reversible** (el mismo botón lo reactiva) y no toca `invite_code_redemptions`, `subscriptions` ni `profiles`. Como hoy no hay reservas ni checkouts abiertos con esos códigos, no hay nada que se quede colgado.

Orden sugerido: (1) confirmar que son de prueba (§3); (2) apagar el interruptor si está encendido (§2.6); (3) desactivar los 3 desde el admin; (4) volver a correr el inventario y verificar `status = inactive` en los 3.

**Plan B (solo si el admin no lo permitiera — p. ej. una política RLS de `invite_codes` que no deje escribir, no verificada [?]):** SQL de ejemplo, **no ejecutar sin autorización**, pegando los ids reales del inventario completo (el inventario enmascarado no trae ids a propósito):

```sql
-- NO EJECUTADO. Reemplazar <id1>,<id2>,<id3> por los ids de los 3 códigos de prueba confirmados.
update public.invite_codes
set status = 'inactive'
where id in ('<id1>', '<id2>', '<id3>')
  and status = 'active'
  and coalesce(used_count, 0) = 0
returning id, code_type, status;
```

## 5. ¿Está listo el sistema para códigos individuales de precio fijo $9.900 y un único uso? [C]

**Sí, para el uso previsto**, con estas salvedades. Evidencia: `tests/pioneros-codes-db.test.mjs` (nuevo, 10 tests, contra Postgres real con **las dos migrations aplicadas**, igual que producción; todos pasan):

| Verificado | Resultado |
|---|---|
| Lista 19.900 + `fixed_price` 9900 → 9.900; `discount_fixed_amount` 10000 → 9.900 | Ambos. `fixed_price` no cambia si la lista cambia (con 24.900 sigue 9.900; el fijo daría 14.900) |
| Un `fixed_price` ≥ lista no es descuento | Rechazado (`no_benefit`) |
| 20 códigos individuales × 1 uso, 20 compradores en conexiones simultáneas | Las 20 reservas salen a $9.900, sin cruces |
| Un código filtrado disputado por 12 personas a la vez | Exactamente 1 gana, 11 «agotado» |
| Flujo completo: reservar → checkout a 9.900 → autorización → confirmación | `subscriptions.amount` = 9.900 (lo que cobra MP cada mes); el uso se consume **solo al autorizar**; webhook duplicado no suma; el código no se puede reutilizar |
| Una persona nunca retiene dos cupos vivos | Cambiar de código libera el anterior |
| Abandono/cancelación antes de autorizar | El código vuelve a quedar disponible |
| Desactivar / vencer | Rechazo inmediato (`invalid` / `expired`) |
| Sin `max_uses` | El código **nunca se agota** (es el riesgo de los 3 existentes) |
| El inventario de solo lectura | Solo lectura, enmascara el código |

**Cómo crearlos en `/admin/codigos`** (uno por uno; no hay alta masiva):

| Campo | Valor |
|---|---|
| Tipo de código | **Precio Especial Fijo ($)** |
| Monto / Precio | **9900** |
| Duración del descuento | **Para siempre (recurrente)** (la única soportada) |
| Límite de usos | **1** (obligatorio: vacío = ilimitado) |
| Vencimiento del código | Una fecha (recomendado: no dejarlo abierto) |
| Título / Notas | p. ej. «Pioneros 2026 #07 — <persona>» (el nº de pionero y a quién se le dio van en las notas; el código no se asocia a una persona) |

Salvedades:

1. **Un código es un portador:** no está atado a una persona; quien lo tenga lo usa (solo una vez en total). Enviarlo por un canal privado.
2. **«Copiar link» del admin no sirve para estos códigos:** copia `…/registro?ref=CÓDIGO`, que es el flujo de acceso Beta; los descuentos **no se precargan desde el registro** (`DEPLOY_DISCOUNT_CODES.md` §5.7). La persona debe entrar a **Sin acceso → «Tengo un código de descuento»** y escribirlo. Indicárselo en el mensaje.
3. **Solo ve el campo quien está en Free** y con el interruptor encendido. Quien ya tiene membresía activa recibe `already_member` y **no puede canjear** (Fundadores incluidos, mientras estén activos).
4. **El uso se consume al autorizar la suscripción, no con el primer cobro aprobado.** Si el primer cobro falla después, el uso queda consumido: emitir otro código a mano.
5. **El descuento rige en todas las renovaciones** (un único importe en la preapproval): $9.900 todos los meses hasta que se cambie el monto. Ver §6.
6. **Hay 8 intentos fallidos por usuario cada 15 min** (rate limit): un código mal tipeado muchas veces bloquea temporalmente a esa persona.
7. **No verificado [?]:** que la política RLS de `invite_codes` permita a un admin insertar/actualizar desde el navegador (es lo que usa la pantalla; los 3 códigos existentes se crearon así, lo que lo sugiere) y que el precio de lista actual en `/admin/membresia` sea 19.900 (si fuera ≤ 9.900 el código daría `no_benefit`).

## 6. Cambio manual de precio desde el panel de Mercado Pago (investigación) 

**Conclusión: el panel NO está confirmado para nuestras suscripciones. Probablemente no aplica.**

- **[D] Panel:** la documentación oficial describe «Modificar monto» **solo** dentro de **«Planes de suscripción» → pestaña «Suscriptores»**: tres puntos → *Modificar monto* (o *Ver detalles* → *Modificar monto*), se ingresa el monto nuevo y se confirma; «Mercado Pago le avisará el cambio por e-mail» (fuentes: [Gestionar planes de suscripción](https://www.mercadopago.com.ar/developers/es/docs/subscription-plans/manage-subscription-plan), [Gestión de suscripciones](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management)).
- **[C] Nuestras suscripciones se crean sin plan:** no hay ninguna referencia a `preapproval_plan_id` en `src/`; cada checkout crea una `preapproval` con su propio `auto_recurring.transaction_amount`. Por lo tanto **no cuelgan de un «Plan de suscripción»** y es probable que no aparezcan en esa pestaña **[?]**.
- **[?] Qué no dice la documentación:** si el panel funciona para suscripciones sin plan creadas por API; **desde qué cobro** rige el monto nuevo; si el pagador debe **reautorizar**. Tampoco documenta el efecto por API más allá de «Permite modificar el monto de una suscripción existente» (`PUT /preapproval/{id}` con `auto_recurring.transaction_amount` y `currency_id`).
- **[C] Lo que ya existe en la app:** el cambio masivo de precio (`/admin/membresia`) usa ese mismo `PUT /preapproval/{id}`, **pero se salta toda suscripción con monto especial** (promo, descuento, prueba), a propósito (commit `0c987c2`). **No sirve para subir a los Pioneros** a $19.900 y no existe una herramienta por suscripción individual.

**Cómo salir de la duda sin operar (lo hacés vos, solo mirar):** en tu panel de Mercado Pago (cuenta vendedora real), abrir **Planes de suscripción → Suscriptores** y ver si aparecen las suscripciones de la Academia ya creadas (por ejemplo las de Fundadores). Si **aparecen** → el camino A (panel) es plausible y habría que probarlo con una suscripción de prueba. Si **no aparecen** → el panel no sirve para nuestras suscripciones. No hay que hacer clic en «Modificar monto» ni en nada que cambie algo. Si querés además buscar otra vista («Suscripciones», «Tus cobros»), mirar sin modificar.

**Plan de acción para el paso a $19.900 sin desarrollar nada nuevo** (en orden de preferencia, todo pendiente de validación; no se promete «6 meses y luego regular» hasta validar uno):
1. **Panel**, si el paso anterior muestra las suscripciones.
2. **`PUT /preapproval/{id}` manual (20 veces)**, por una sola vez y por persona, con el script que ya existe (`scripts/mp-spike/price-change-spike.mjs`, requiere cuentas/credenciales y tu autorización por operación). Validarlo con el spike antes de usarlo con clientes.
3. **Contingencia:** cancelar la suscripción promocional y pedir que se resuscriba al precio de lista (fricción; posible baja).

En los tres casos hay que **avisar a cada Pionero ~30 días antes** (no hay e-mail transaccional propio). El texto de la oferta y del aviso lo define el asesor legal.

## 7. Qué cambió y qué sigue

- **Repositorio:** + `docs/PIONEROS_DISCOUNT_SYSTEM_DIAGNOSIS.md` (este), + `supabase/diagnostics/20261111_discount_codes_inventory.sql`, + `tests/pioneros-codes-db.test.mjs`; actualizados `docs/PIONEROS_SIMPLIFIED_PROPOSAL.md`, `docs/CURRENT_STATE.md` y `docs/DEPLOY_DISCOUNT_CODES.md` (migrations ya aplicadas). Cero código de producción, cero migrations nuevas.
- **Pendiente tuyo:** (1) estado del interruptor en Vercel (§2); (2) identificar los 3 códigos (§3); (3) autorizar su desactivación (§4); (4) mirar si las suscripciones aparecen en el panel de MP (§6).
- **Riesgo que sigue abierto:** el checkout con descuento **nunca corrió contra Mercado Pago real**. `DEPLOY_DISCOUNT_CODES.md` §2.6 pide probarlo con usuarios de prueba **antes** de encender el interruptor; si se posterga el spike, el primer checkout real con código de un Pionero sería también la primera prueba real. Decisión 2026-11-11: la primera prueba se hace con un **código de $250 de un solo uso** y una compra real mínima (runbook: `PIONEROS_CHECKOUT_TEST_RUNBOOK.md`; no se hace sin tu autorización en cada puerta).
