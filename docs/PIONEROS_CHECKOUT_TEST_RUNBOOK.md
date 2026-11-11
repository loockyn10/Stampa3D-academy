# Edición Pioneros — prueba del checkout con un código de precio fijo $9.900 (runbook)

**Estado:** PREPARADO, **NADA EJECUTADO** (2026-11-11). Sin cambios en Mercado Pago, Supabase, Vercel ni precios; sin push ni deploy. Cada **puerta (G1–G5)** requiere tu autorización explícita y la hacés vos en tu cuenta; ningún paso de este documento lo ejecuta Claude.

> **[C]** confirmado (código del repo, resultado real que pasaste, test contra Postgres real) · **[?]** no verificado.

## 0. Punto de partida (lo que confirmaste)

- Los 3 códigos existentes son **solo de prueba**: se desactivan desde `/admin/codigos` (G0, sin borrarlos).
- `DISCOUNT_CODES_ENABLED` **no existe** en Vercel Production → descuentos deshabilitados hoy.
- No se enciende el interruptor todavía.

## 1. Hallazgos que definen el plan [C]

1. **Qué cambia realmente el interruptor.** Solo dos cosas: (a) `/sin-acceso` muestra el campo «Tengo un código de descuento» y (b) `create-subscription` acepta un `discount_code`. El resto del checkout **ya corre hoy**, con o sin interruptor: el reemplazo de un checkout pendiente de otro importe (`executePlainCheckout`) no depende de él (`create-subscription/route.ts:361`). Es decir, con el interruptor encendido **y sin ningún código activo**, nadie obtiene descuento y el flujo de los demás clientes es el de siempre.
2. **Qué es «Aplicar» y qué es «Activar membresía».** «Aplicar» es una **vista previa de solo lectura** (`reserve_discount_code` en modo `dry_run`, `sin-acceso/actions.ts`): no reserva, no llama a Mercado Pago, no cobra. «Activar membresía» es el POST a `/api/mercadopago/create-subscription`: ahí se reserva el uso, **se crea la preapproval en Mercado Pago a $9.900** (no hay cobro todavía) y se te redirige al checkout de Mercado Pago. **El cobro ocurre recién cuando el pagador confirma en Mercado Pago.**
3. **El precio lo decide la base**, no el navegador: la base toma el precio de lista de `membership_settings` y devuelve 9.900 para el código (verificado en `tests/pioneros-codes-db.test.mjs`).
4. **El código de descuento ya está en producción:** `f45e5ac` y `3d516fa` están en `origin/main` [C: `git merge-base --is-ancestor`]. Si Vercel Production corre un commit anterior a `3d516fa`, el campo no aparecería y un POST con código se **ignoraría** (cobraría $19.900). Por eso **P1 (ver el importe en Mercado Pago antes de pagar) es una condición de parada**.
5. **Lo que NO está en producción:** `0c987c2` (el cambio masivo de precio ya no pisa promociones) es un commit **local**, sin push. Producción todavía tiene el cambio masivo anterior: **no usar `/admin/membresia` → «aplicar a existentes» durante ni después de la prueba** hasta desplegar esa protección.
6. **Un cobro real, no sandbox.** Producción usa el token productivo. La documentación del propio proyecto (`DEPLOY_MEMBERSHIP_BILLING.md` §5) ya concluyó que las alternativas son peores: cambiar el token a uno de prueba **rompe los cobros reales** mientras esté puesto; un Preview comparte base y token de producción salvo que se aísle el entorno completo (nuevo Supabase + aplicación de Mercado Pago de prueba + Preview), lo que decidiste no hacer; y un Preview exige un push. Su conclusión: *«la alternativa de menor riesgo es una compra real con una cuenta propia (monto real, luego cancelada) y revisar las filas que genera»*. Este runbook sigue esa vía.

## 2. Qué configurar (checklist exacta)

**Cuentas**

| Pieza | Requisito |
|---|---|
| Cuenta vendedora | La productiva de siempre (la de la Academia). No se toca. |
| **Cuenta compradora de Mercado Pago** | **Distinta de la vendedora** (Mercado Pago no deja pagarse a uno mismo) y con un medio de pago que acepte $9.900. Puede ser tuya personal o de una persona de confianza que sepa que se hace un cobro real. |
| **Cuenta Universo de prueba** | Nueva, **Free**, registrada **con el mismo correo que la cuenta compradora de Mercado Pago** (así no hace falta el «pagar con otra cuenta»). Si «Confirm email» está activo, confirmarla. No uses una cuenta con membresía ni de un cliente. |

**Código de prueba** (en `/admin/codigos` → Nuevo código)

| Campo | Valor |
|---|---|
| Tipo | **Precio Especial Fijo ($)** |
| Monto / Precio | **9900** |
| Duración | **Para siempre (recurrente)** |
| Límite de usos | **1** |
| Vencimiento | **Pasado mañana** (el campo guarda la fecha a las 00:00 UTC, o sea las 21:00 del día anterior en Argentina: «mañana» vencería esta misma noche) |
| Título / Notas | `PRUEBA INTERNA — no usar` / quién la creó y para qué cuenta |

**Interruptor** (solo en G1): variable `DISCOUNT_CODES_ENABLED` = `true` (exacto, minúsculas, sin espacios) **solo en el entorno Production**, y **Redeploy** del deployment de producción actual desde Vercel (no un push: el redeploy reutiliza el mismo commit, así que no se publica ningún código nuevo).

**Antes de empezar (solo mirar, cero cambios)**

1. Vercel → Deployments: el deployment de **Production** corre un commit **igual o posterior a `3d516fa`** (hoy `origin/main` está en `fa38359`).
2. `/admin/membresia`: el precio de lista actual es **$19.900** (con una lista ≤ $9.900 el código daría «no mejora el precio»).
3. Elegir un momento de **poco tráfico** y avisar al equipo; el interruptor va a estar encendido unos 20–30 minutos.
4. Correr el diagnóstico de línea base (§4, paso B) y **guardar la salida**.

## 3. Ejecución por puertas (cada una, con tu autorización)

| Puerta | Qué se hace | Costo/efecto | Quién |
|---|---|---|---|
| **G0** | Desactivar los 3 códigos de prueba en `/admin/codigos` (botón del interruptor de cada fila). Luego correr `supabase/diagnostics/20261111_discount_codes_inventory.sql`: los 3 deben figurar `inactive`. | Sin costo. Reversible. | Vos |
| **G1** | Crear el código de prueba (tabla de arriba). Correr la **línea base** (§4.B). Agregar `DISCOUNT_CODES_ENABLED=true` (Production) y **Redeploy**. Verificar en `/sin-acceso` con la cuenta de prueba que aparece «Tengo un código de descuento». | Público: el campo queda visible a los usuarios Free mientras dure. Con un único código válido, de 1 uso y con vencimiento, el riesgo es bajo. | Vos |
| **G2** | Con la cuenta de prueba: **Aplicar** el código → debe mostrar **$19.900 → $9.900** (vista previa, sin llamar a Mercado Pago). Luego **«Activar membresía»**. | **Crea una preapproval en Mercado Pago a $9.900.** Todavía no hay cobro. | Vos |
| **G3** | **Parada obligatoria P1:** en la pantalla de Mercado Pago, comprobar que el importe es **$9.900 por mes**. Si dice $19.900 u otro valor: **no pagar**, cancelar y volver al §5. Si es correcto, pagar con la cuenta compradora. | **Cobro real de $9.900.** | Vos |
| **G4** | Volver a `/pago/estado` (activo). Correr el diagnóstico «después» (§4.C). **Cancelar enseguida** desde Configuración → Membresía → «Cancelar suscripción» y confirmar en el panel de Mercado Pago que la preapproval figura **cancelada**. Reembolsar los $9.900 desde el panel de Mercado Pago (opción de devolver ese pago; los nombres de menú pueden variar). | Evita la renovación del mes siguiente. El reembolso lo hacés vos; si Mercado Pago retiene la comisión de la operación es **[?]** (verificarlo en el panel antes de reembolsar). La devolución no revoca el acceso de la cuenta de prueba (`DEPLOY_MEMBERSHIP_BILLING.md` §10: «Reembolsos y contracargos no revocan acceso automáticamente»). | Vos |
| **G5** | Borrar `DISCOUNT_CODES_ENABLED` (o ponerla en `false`) en Production + **Redeploy**. Desactivar el código de prueba. Correr el inventario: **ningún** código de descuento activo. Verificar en `/sin-acceso` que el campo ya no aparece. | Vuelve al estado actual. | Vos |

**Ventana mínima:** G1→G5 en una sola sesión, sin dejar el interruptor encendido de un día para otro.

## 4. Cómo verificar que la prueba no afecta otras suscripciones

Herramienta: `supabase/diagnostics/20261111_discount_checkout_test_state.sql` (una única sentencia `SELECT`; un test contra Postgres real confirma que es de solo lectura, que no imprime el código ni el correo, y que **detecta** una interferencia). Se pega completa en el SQL Editor y se editan solo tres valores de la CTE `params`: el correo de la cuenta de prueba, el código de prueba y `t0` (la hora justo antes de empezar, con zona horaria: `'2026-11-12 10:30:00-03'`).

- **A. Qué mide.**
  - `1_TEST_USER`: lo que le pasó a la cuenta de prueba (suscripción, intento de checkout, pago, reserva, perfil).
  - `2_TEST_CODE`: estado del código, canjes y reservas.
  - **`3_OTHERS_TOUCHED_SINCE_T0`: todo lo que cambió desde `t0` y NO es de la cuenta de prueba** (suscripciones, pagos, checkouts, reservas, canjes, perfiles con membresía iniciada). **Esperado: 0 en cada fila.**
  - **`4_FINGERPRINT_OTHERS`: huella md5 + conteo de las filas de todas las demás personas** (suscripciones, checkouts, códigos) y la distribución de importes de las suscripciones autorizadas. **Esperado: idéntica antes y después.**
  - `5_WEBHOOK_EVENTS_SINCE_T0`: notificaciones de Mercado Pago recibidas (conteos; las de la prueba deben terminar `processed=true`).
- **B. Línea base (antes de G1):** correrlo con `t0` = «ahora». Guardar las filas `4_FINGERPRINT_OTHERS` y `3_OTHERS… other codes with uses`.
- **C. Después de G4 y de G5:** correrlo de nuevo con **el mismo `t0`** y comparar.
- **D. Mercado Pago (mirar sin tocar):** en el panel, la cantidad de suscripciones activas debe ser **+1 durante la prueba y volver al valor inicial** tras cancelar; las demás conservan su importe.
- **E. Logs de Vercel** de `/api/mercadopago/create-subscription` y del webhook durante la ventana: sin `restart failed`, `definite provider rejection` ni `[membership]` con error para otras cuentas.

**Criterios de aprobación**

| # | Criterio |
|---|---|
| P1 | La pantalla de Mercado Pago muestra **$9.900/mes** (no $19.900) antes de pagar |
| P2 | Después de pagar: `subscriptions` de la cuenta de prueba `authorized` a 9.900; **un** pago `approved` por 9.900; reserva `confirmed` (`base=19900 final=9900`); código `used_count = 1` y 1 canje; perfil `active` |
| P3 | `3_OTHERS_TOUCHED_SINCE_T0` todo en 0 y `4_FINGERPRINT_OTHERS` idéntico al de antes |
| P4 | Mercado Pago: +1 suscripción durante la prueba, −1 tras cancelar; ninguna otra cambió de importe ni de estado |
| P5 | Eventos del webhook de la prueba `processed=true`, sin errores |
| P6 | Tras cancelar: preapproval `cancelled` en Mercado Pago y `subscriptions.status = cancelled`; **el código sigue consumido** (diseño: un uso consumido no se devuelve) |

**Si `3_OTHERS` no da 0:** puede ser un cliente real operando a la vez (un alta o una renovación). Se distingue mirando qué tabla cambió y si pertenece a otra persona; no se concluye «la prueba afectó a otros» sin eso. Por eso conviene una hora de poco tráfico.

## 5. Condiciones de parada y marcha atrás

| Situación | Acción |
|---|---|
| El importe en Mercado Pago no es $9.900 | **No pagar.** Cancelar la preapproval pendiente desde la app («Empezar un pago nuevo») o desde Mercado Pago; ir a G5. No habrá cobro. |
| Respuesta `discount_persistence_pending`, `checkout_reconciliation_pending` o un 5xx | No repetir el clic: esperar y revisar `1_TEST_USER`; si hay una preapproval viva, cancelarla y ir a G5. |
| Aparecen **dos** preapprovals vivas para la cuenta de prueba | Cancelar la que sobre en Mercado Pago; reportar (no debería pasar: lo cubre la prueba de reemplazo de checkouts). |
| `3_OTHERS` ≠ 0 sin explicación, o cambió el importe de una suscripción ajena | **Parar**, ir a G5 y revisar antes de seguir. No usar el cambio masivo de precio. |
| Se pagó pero la cuenta no activó | No pagar de nuevo. `/pago/estado` → «Actualizar estado»; revisar `5_WEBHOOK_EVENTS`. Es el circuito ya validado del incidente P0 (`DEPLOY_MEMBERSHIP_BILLING.md` §13). |
| Cualquier duda en medio | G5 (apagar el interruptor) es siempre seguro y reversible; las suscripciones ya creadas con precio especial siguen válidas en Mercado Pago. |

## 6. Qué prueba y qué NO prueba

**Prueba:** que un código `fixed_price` 9900 de 1 uso reserva, crea la preapproval a $9.900 en Mercado Pago real, el cobro real es de $9.900, el uso se consume al autorizar, el webhook activa la cuenta, y que no se toca a otras personas.

**No prueba (sigue pendiente):**
- La **renovación** a $9.900 en el mes siguiente (producción cobra mensualmente: no se puede acelerar; se confirmaría solo si la cuenta de prueba **no** se cancelara, y no lo recomiendo).
- El **paso a $19.900** después del sexto mes: sigue dependiendo de validar el cambio de importe (spike) o el panel de Mercado Pago (ver `PIONEROS_DISCOUNT_SYSTEM_DIAGNOSIS.md` §6).
- Un fallo del **primer cobro** después de autorizar (el uso ya estaría consumido).
- Los textos legales de la promoción.

## 7. Costo y datos que deja

- **Costo:** $9.900 reales (reembolsables); posible comisión no devuelta **[?]**.
- **Datos:** una cuenta de prueba con membresía activa unos 33 días (aparecerá en métricas como socio; no se edita a mano), un `checkout_attempt`, una `subscription` cancelada, un `payment` aprobado, una reserva `confirmed` y un código consumido. Nada de eso se borra.
