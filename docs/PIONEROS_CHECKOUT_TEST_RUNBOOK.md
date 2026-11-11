# Edición Pioneros — prueba del checkout con un código de precio fijo $250 (compra controlada)

**Estado:** PREPARADO, **NADA EJECUTADO** (2026-11-11). Sin cambios en Mercado Pago, Supabase, Vercel ni precios; sin push ni deploy. Cada **puerta (G0–G5)** requiere tu autorización explícita y la hacés vos en tu cuenta; ningún paso de este documento lo ejecuta Claude.

**Decisión 2026-11-11:** la prueba usa un código `fixed_price` de **$250** (no $9.900) para validar el flujo completo —descuento, Mercado Pago, activación de Premium y consumo del código— con un cobro real mínimo. Lo que cambia respecto de la versión anterior de este runbook: el importe (9.900 → 250), la mitigación del riesgo de un código tan barato (§1.8) y que el reembolso pasa a ser opcional.

> **[C]** confirmado (código del repo, documentación del proyecto, test contra Postgres real) · **[?]** no verificado.

## 0. Punto de partida

- Los 3 códigos existentes son **solo de prueba** (confirmado por vos): se desactivan desde `/admin/codigos` (G0), sin borrarlos.
- `DISCOUNT_CODES_ENABLED` **no existe** en Vercel Production → descuentos deshabilitados hoy. **No se enciende hasta G1.**

## 1. Hallazgos que definen el plan

1. **Qué cambia realmente el interruptor** [C]. Solo dos cosas: (a) `/sin-acceso` muestra el campo «Tengo un código de descuento» y (b) `create-subscription` acepta un `discount_code`. El resto del checkout ya corre hoy, con o sin interruptor (el reemplazo de un checkout pendiente de otro importe no depende de él: `create-subscription/route.ts:361`). Con el interruptor encendido y sin códigos activos, nadie obtiene descuento y el flujo de los demás clientes es el de siempre.
2. **«Aplicar» no cobra; «Activar membresía» crea la suscripción** [C]. «Aplicar» es una vista previa de solo lectura (`reserve_discount_code` en `dry_run`): no reserva ni llama a Mercado Pago. «Activar membresía» reserva el uso, **crea la preapproval en Mercado Pago a $250** (sin cobro todavía) y te redirige al checkout de Mercado Pago. **El cobro ocurre recién cuando confirmás en Mercado Pago.**
3. **El precio lo decide la base** [C], no el navegador: toma el precio de lista de `membership_settings` y devuelve 250 para el código (verificado en `tests/pioneros-codes-db.test.mjs`).
4. **El código de descuento ya está en producción** [C]: `f45e5ac` y `3d516fa` están en `origin/main`. Si Vercel Production corre un commit anterior, el campo no aparecería y un POST con código se **ignoraría** (cobraría $19.900). Por eso **P1 (ver el importe en Mercado Pago antes de pagar) es una condición de parada**.
5. **Lo que NO está en producción** [C]: `0c987c2` (el cambio masivo de precio ya no pisa promociones) es un commit **local**. Producción todavía tiene el cambio masivo anterior: **no usar `/admin/membresia` → «aplicar a existentes»** durante ni después de la prueba hasta desplegar esa protección (pisaría esta suscripción de $250 y las 2 pruebas internas existentes).
6. **Un cobro real, no sandbox** [C]. Producción usa el token productivo. `DEPLOY_MEMBERSHIP_BILLING.md` §5 ya concluyó que lo menos riesgoso es «una compra real con una cuenta propia (monto real, luego cancelada) y revisar las filas que genera»: cambiar el token a uno de prueba rompe los cobros reales mientras esté puesto, y un Preview comparte base y token salvo que se aísle el entorno completo. Con $250 esa compra real cuesta casi nada.
7. **$250 es un importe seguro para Mercado Pago y para la base** [C].
   - Mercado Pago **ya cobró $250 en producción** (incidente del 2026-11-05, `DECISIONS.md` D048: `charged_amount = 250`) y hay 2 suscripciones `authorized` a $250 (pruebas internas confirmadas por vos). El importe no es nuevo para la integración [?: no hay un mínimo documentado por Mercado Pago para preapprovals; este es el único precedente].
   - La base lo acepta: el precio fijo solo exige `> 0` y `< lista` (250 < 19.900); la reserva exige `0 < final < base`. Probado.
   - **Nada en `src/` ni en las migrations trata el importe 250 de forma especial** [C: búsqueda en el repo].
   - **Consecuencia para la verificación:** ya existen 2 suscripciones a $250 de otras cuentas, así que **no se distingue la prueba por el importe**. El diagnóstico separa por **cuenta** (excluye a la cuenta de prueba) y el panel de Mercado Pago se lee por **fecha y correo del pagador**, no por «250».
8. **Un código de $250 es muy valioso si se filtra** (98,7 % de descuento, «para siempre»). Mitigaciones, todas obligatorias:
   - generarlo con el botón **«Generar»** (sufijo aleatorio `PRECIO-XXXXXX`; no inventar una palabra adivinable) y **no compartirlo ni pegarlo en ningún chat**;
   - **crearlo recién cuando vayas a empezar** (con el interruptor apagado el código es inerte) y mantener el interruptor encendido **solo la ventana mínima (≈ 20 min)**;
   - límite de usos **1** y vencimiento **pasado mañana** (el campo guarda la fecha a las 00:00 UTC, es decir las 21:00 del día anterior en Argentina: «mañana» vencería esta misma noche);
   - el sistema limita a 8 intentos fallidos por usuario cada 15 min;
   - en G5 se **desactiva** aunque ya esté consumido;
   - si alguien ajeno lo usara igual, el efecto es **una** suscripción a $250 (límite de 1 uso): se cancela en el panel de Mercado Pago, y `3_OTHERS_TOUCHED_SINCE_T0` del diagnóstico lo muestra.

## 2. Qué configurar (checklist exacta)

**Cuentas**

| Pieza | Requisito |
|---|---|
| Cuenta vendedora | La productiva de siempre. No se toca. |
| **Cuenta compradora de Mercado Pago** | **Distinta de la vendedora** (Mercado Pago no deja pagarse a uno mismo) y con un medio de pago que acepte $250. Puede ser tuya personal o de una persona de confianza que sepa que se hace un cobro real. |
| **Cuenta Universo de prueba** | Nueva, **Free**, registrada **con el mismo correo que la cuenta compradora de Mercado Pago** (así no hace falta «pagar con otra cuenta»). Si «Confirm email» está activo, confirmarla. No usar una cuenta con membresía ni de un cliente. |

**Código de prueba** (en `/admin/codigos` → Nuevo código; crearlo en G1)

| Campo | Valor |
|---|---|
| Código | El que propone **«Generar»** (`PRECIO-XXXXXX`) |
| Tipo | **Precio Especial Fijo ($)** |
| Monto / Precio | **250** |
| Duración | **Para siempre (recurrente)** (la única soportada) |
| Límite de usos | **1** (vacío = ilimitado: no dejarlo vacío) |
| Vencimiento | **Pasado mañana** (ver §1.8) |
| Título / Notas | `PRUEBA INTERNA — no usar` / quién la creó y para qué cuenta |

**Interruptor** (solo en G1): variable `DISCOUNT_CODES_ENABLED` = `true` (exacto, minúsculas, sin espacios) **solo en el entorno Production**, y **Redeploy** del deployment de producción actual desde Vercel (no un push: el redeploy reutiliza el mismo commit, así que no se publica ningún código nuevo).

**Antes de empezar (solo mirar, cero cambios)**

1. Vercel → Deployments: el deployment de **Production** corre un commit **igual o posterior a `3d516fa`** (hoy `origin/main` está en `fa38359`).
2. `/admin/membresia`: el precio de lista actual es **$19.900** (con una lista ≤ $250 el código daría «no mejora el precio»).
3. Un momento de **poco tráfico**; avisar al equipo.
4. Anotar cuántas suscripciones `authorized` hay hoy en el panel de Mercado Pago y su detalle (esperado: las de clientes + **2 de $250** de pruebas internas).
5. Correr el diagnóstico de línea base (§4.B) y **guardar la salida**.

## 3. Ejecución por puertas (cada una, con tu autorización)

| Puerta | Qué se hace | Costo/efecto | Quién |
|---|---|---|---|
| **G0** | Desactivar los 3 códigos de prueba en `/admin/codigos` (botón del interruptor de cada fila). Luego correr `supabase/diagnostics/20261111_discount_codes_inventory.sql`: los 3 deben figurar `inactive`. | Sin costo. Reversible. | Vos |
| **G1** | Hacer §2 («Antes de empezar»). Crear el código de prueba. Correr la **línea base** (§4.B, anotando la hora como `t0`). Agregar `DISCOUNT_CODES_ENABLED=true` (Production) y **Redeploy**. Verificar en `/sin-acceso` con la cuenta de prueba que aparece «Tengo un código de descuento». | Público: el campo queda visible a los usuarios Free mientras dure. Con un único código, de 1 uso, aleatorio y con vencimiento, el riesgo es bajo (§1.8). | Vos |
| **G2** | Con la cuenta de prueba: **Aplicar** el código → debe mostrar **$19.900 → $250** (vista previa, sin llamar a Mercado Pago). Luego **«Activar membresía»**. | **Crea una preapproval en Mercado Pago a $250.** Todavía no hay cobro. | Vos |
| **G3** | **Parada obligatoria P1:** en la pantalla de Mercado Pago, comprobar que el importe es **$250 por mes**. Si dice $19.900 u otro valor: **no pagar**, cancelar y volver al §5. Si es correcto, pagar con la cuenta compradora. | **Cobro real de $250.** | Vos |
| **G4** | Volver a `/pago/estado` (activo). Correr el diagnóstico «después» (§4.C). Después, **elegir** (ver abajo). | Ver abajo. | Vos |
| **G5** | Borrar `DISCOUNT_CODES_ENABLED` (o ponerla en `false`) en Production + **Redeploy**. Desactivar el código de prueba. Correr el inventario: **ningún** código de descuento activo. Verificar en `/sin-acceso` que el campo ya no aparece. Correr el diagnóstico por última vez. | Vuelve al estado actual. | Vos |

**G4 — qué hacer con la suscripción de prueba (decisión tuya):**
- **Opción A (por defecto): cancelar enseguida.** Configuración → Membresía → «Cancelar suscripción»; confirmar en el panel de Mercado Pago que la preapproval figura **cancelada**. Evita la renovación del mes siguiente. El reembolso de los $250 es **opcional** (el monto es trivial; si querés devolverlo, usá la opción de devolver el pago en el panel de Mercado Pago; si se devuelve la comisión es **[?]**). La devolución no revoca el acceso de la cuenta de prueba (`DEPLOY_MEMBERSHIP_BILLING.md` §10).
- **Opción B (requiere tu decisión explícita): dejarla activa como «conejillo»** a $250/mes. Sirve para observar la **primera renovación** (≈ un mes después) y, con otra autorización por separado, para probar el cambio de importe de una suscripción real con un monto chico (el spike), sin arriesgar a ningún cliente. Costo: $250 por mes mientras viva; hay que acordarse de cancelarla. Por defecto **no** se hace.

**Ventana mínima:** G1→G5 en una sola sesión, sin dejar el interruptor encendido de un día para otro.

## 4. Cómo verificar que la prueba no afecta otras suscripciones

Herramienta: `supabase/diagnostics/20261111_discount_checkout_test_state.sql` (una única sentencia `SELECT`; un test contra Postgres real confirma que es de solo lectura, que no imprime el código ni el correo, que **separa a la cuenta de prueba de las demás aunque tengan el mismo importe de $250**, y que **detecta** una interferencia). Se pega completa en el SQL Editor y se editan solo tres valores de la CTE `params`: el correo de la cuenta de prueba, el código de prueba y `t0` (la hora justo antes de empezar, con zona horaria: `'2026-11-12 10:30:00-03'`).

- **A. Qué mide.**
  - `1_TEST_USER`: lo que le pasó a la cuenta de prueba (suscripción, intento de checkout, pago, reserva, perfil).
  - `2_TEST_CODE`: estado del código, canjes y reservas.
  - **`3_OTHERS_TOUCHED_SINCE_T0`: todo lo que cambió desde `t0` y NO es de la cuenta de prueba** (suscripciones, pagos, checkouts, reservas, canjes, perfiles con membresía iniciada). **Esperado: 0 en cada fila.**
  - **`4_FINGERPRINT_OTHERS`: huella md5 + conteo de las filas de todas las demás personas** (suscripciones, checkouts, códigos) y la distribución de importes de las suscripciones autorizadas de las demás (**debe seguir mostrando las 2 de $250 de pruebas internas, ni una más ni una menos**). **Esperado: idéntica antes y después.**
  - `5_WEBHOOK_EVENTS_SINCE_T0`: notificaciones de Mercado Pago recibidas (conteos; las de la prueba deben terminar `processed=true`).
- **B. Línea base (antes de G1):** correrlo con `t0` = «ahora». Guardar las filas `4_FINGERPRINT_OTHERS` y `3_OTHERS… other codes with uses`.
- **C. Después de G4 y de G5:** correrlo de nuevo con **el mismo `t0`** y comparar.
- **D. Mercado Pago (mirar sin tocar):** cantidad de suscripciones activas **+1 durante la prueba y de vuelta al valor inicial** tras cancelar (con la Opción B queda +1 a propósito). Como ya hay otras de $250, identificá la tuya por **fecha de alta y correo del pagador**. Las demás conservan su importe y estado.
- **E. Logs de Vercel** de `/api/mercadopago/create-subscription` y del webhook durante la ventana: sin `restart failed`, `definite provider rejection` ni `[membership]` con error para otras cuentas.

**Criterios de aprobación**

| # | Criterio |
|---|---|
| P1 | La pantalla de Mercado Pago muestra **$250/mes** (no $19.900) antes de pagar |
| P2 | Después de pagar: `subscriptions` de la cuenta de prueba `authorized` a 250; **un** pago `approved` por 250; reserva `confirmed` (`base=19900 final=250`); código `used_count = 1` y 1 canje; perfil `active` con acceso hasta ≈ cobro + 1 mes + gracia |
| P3 | `3_OTHERS_TOUCHED_SINCE_T0` todo en 0 y `4_FINGERPRINT_OTHERS` idéntico al de antes (incluidas las 2 de $250 ajenas) |
| P4 | Mercado Pago: +1 suscripción durante la prueba, −1 tras cancelar (Opción A); ninguna otra cambió de importe ni de estado |
| P5 | Eventos del webhook de la prueba `processed=true`, sin errores |
| P6 | Opción A: preapproval `cancelled` en Mercado Pago y `subscriptions.status = cancelled`; **el código sigue consumido** (diseño: un uso consumido no se devuelve) |
| P7 | Premium **funciona de verdad** con la cuenta de prueba: Inicio, Academia y Stampy abren sin pasar por `/sin-acceso` |
| P8 | Un segundo intento con el mismo código (otra cuenta Free, solo «Aplicar») responde «límite de usos» (opcional; lo cubre el test de base de datos) |

**Si `3_OTHERS` no da 0:** puede ser un cliente real operando a la vez (un alta o una renovación). Se distingue mirando qué tabla cambió y si pertenece a otra persona; no se concluye «la prueba afectó a otros» sin eso. Por eso conviene una hora de poco tráfico.

## 5. Condiciones de parada y marcha atrás

| Situación | Acción |
|---|---|
| El importe en Mercado Pago no es $250 | **No pagar.** Cancelar la preapproval pendiente desde la app («Empezar un pago nuevo») o desde Mercado Pago; ir a G5. No habrá cobro. |
| Mercado Pago rechaza crear la suscripción de $250 | No insistir. Es un hallazgo (el importe sí funcionó antes, pero no hay un mínimo documentado): ir a G5 y revisar el motivo. |
| Respuesta `discount_persistence_pending`, `checkout_reconciliation_pending` o un 5xx | No repetir el clic: esperar y revisar `1_TEST_USER`; si hay una preapproval viva, cancelarla y ir a G5. |
| Aparecen **dos** preapprovals vivas para la cuenta de prueba | Cancelar la que sobre en Mercado Pago; reportar (no debería pasar). |
| `3_OTHERS` ≠ 0 sin explicación, o cambió el importe de una suscripción ajena | **Parar**, ir a G5 y revisar antes de seguir. No usar el cambio masivo de precio. |
| Se pagó pero la cuenta no activó | No pagar de nuevo. `/pago/estado` → «Actualizar estado»; revisar `5_WEBHOOK_EVENTS`. Es el circuito ya corregido del incidente P0 (`DEPLOY_MEMBERSHIP_BILLING.md` §13). |
| El código lo usó alguien ajeno | Cancelar esa suscripción de $250 en Mercado Pago, ir a G5, revisar cómo se enteró del código. |
| Cualquier duda en medio | G5 (apagar el interruptor) es siempre seguro y reversible; las suscripciones ya creadas con precio especial siguen válidas en Mercado Pago. |

## 6. Qué prueba y qué NO prueba

**Prueba:** que un código `fixed_price` de 1 uso reserva, crea la preapproval al importe del código en Mercado Pago real, el cobro real es de ese importe, el uso se consume al autorizar, el webhook activa Premium, y que no se toca a otras personas.

**No prueba (sigue pendiente):**
- La **renovación** al precio del código (solo con la Opción B, un mes después).
- El **paso a $19.900** después del sexto mes: sigue dependiendo de validar el cambio de importe (spike) o el panel de Mercado Pago (ver `PIONEROS_DISCOUNT_SYSTEM_DIAGNOSIS.md` §6).
- Que $9.900 (el precio real de la promoción) sea aceptado: es muy probable, pero **no se probó**; $250 y $19.900 son los únicos importes con precedente. Es un riesgo bajo, pero real; se cubre con la primera venta real controlada, con un código de $9.900 de 1 uso entregado a una persona conocida.
- Un fallo del **primer cobro** después de autorizar (el uso ya estaría consumido).
- Los textos legales de la promoción.

## 7. Costo y datos que deja

- **Costo:** $250 reales (opcionalmente reembolsables; con la Opción B, $250 por mes mientras la suscripción viva).
- **Datos:** una cuenta de prueba con membresía activa ≈ 33 días (aparecerá en métricas como socio; no se edita a mano), un `checkout_attempt`, una `subscription`, un `payment` aprobado, una reserva `confirmed` y un código consumido. Nada de eso se borra.
