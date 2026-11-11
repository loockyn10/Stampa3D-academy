# Spike de Mercado Pago: cambio de monto de una suscripción existente

**Estado:** PREPARADO, **NO EJECUTADO** (2026-11-10). Nadie corrió ninguna llamada a Mercado Pago. Este documento y `scripts/mp-spike/price-change-spike.mjs` son lo único que se creó.
**Para qué:** validar el mecanismo del que depende la Edición Fundadores (paso de $9.900 a $19.900 después del 6.º cobro) antes de autorizar su implementación. Contexto: `docs/FOUNDERS_EDITION_DESIGN.md`.

## 1. Qué se sabe y qué no (documentación oficial, ya investigada)

| Pregunta | Qué dice la documentación | Estado |
|---|---|---|
| ¿Se puede modificar el importe? | `PUT /preapproval/{id}` con `auto_recurring.transaction_amount` + `currency_id` («permite modificar el monto de una suscripción existente») | **Documentado** |
| ¿Cuándo empieza a aplicarse? | No dice si rige desde el próximo débito ni qué pasa con una cuota ya generada o en reintento | **Sin documentar → spike** |
| ¿Requiere nueva autorización del usuario? | No dice. Un hilo del foro de desarrolladores (Google Groups, **no oficial**, no pude leerlo completo) afirma que el pagador recibe un e-mail informativo sin volver a consentir | **Sin documentar → spike** |
| ¿Qué recibe el suscriptor? | Para «Modificar monto» **desde el panel**: «Mercado Pago le avisará el cambio por e-mail». Para el `PUT` por API: no dice | **Sin documentar → spike + consulta a MP** |
| ¿Se puede programar el cambio? | No hay fecha de vigencia ni calendario de montos en el endpoint | **No existe** (según la doc): lo ejecutamos nosotros |
| ¿Tope de aumento? | No documentado (el salto es +101 %) | **Spike** |

## 2. Qué NO se hace
- No se llama a Mercado Pago con credenciales de producción ni se toca ninguna suscripción real.
- No hay cobros reales en la Fase A. No se usa Supabase ni ninguna tabla de la app. No se despliega nada.
- La **Fase B** (única operación real posible) **no está autorizada**: es una propuesta (§6).

## 3. Fase A — prueba aislada, sin cargos reales (costo: $0)

### 3.1 Requisitos (los hacés vos, en el panel de Mercado Pago Developers)
1. Cuentas de prueba (Tus integraciones → tu aplicación → *Cuentas de prueba* → «Crear cuenta de prueba»): **una vendedora y una compradora, del mismo país (Argentina)**. Hasta 15 por aplicación; no se pueden borrar. La doc indica que al crear la aplicación ya se genera una cuenta de prueba.
2. El *Access Token* de la **cuenta vendedora de prueba**. **Nunca** el token de producción de la aplicación. La documentación de Mercado Pago es inconsistente sobre cuál credencial corresponde en suscripciones (Checkout Pro usa las «credenciales de prueba» de la aplicación; la guía de suscripciones de otros países habla de las credenciales de producción de la cuenta de prueba vendedora). No hace falta resolverlo a ciegas: `whoami` (solo lectura) compara el dueño del token con `MP_SPIKE_EXPECTED_USER_ID` y aborta si no es la cuenta de prueba, así que un token equivocado no puede tocar nada.
3. El **User ID** numérico de la cuenta vendedora de prueba (se ve en *Credenciales → Prueba → Cuenta de prueba*).
4. Datos de una **tarjeta de prueba** (la doc los publica; el resultado se controla con el nombre del titular, p. ej. `APRO` = aprobado).
5. (Opcional) una URL receptora de webhooks de prueba configurada en el panel para ver los eventos `subscription_preapproval` y `subscription_authorized_payment`.

### 3.2 Variables (solo en tu PowerShell; no se guardan ni se imprimen)
```powershell
$s = Read-Host "Access token de la CUENTA DE PRUEBA vendedora" -AsSecureString
$env:MP_SPIKE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$env:MP_SPIKE_EXPECTED_USER_ID = "<User ID numérico de la cuenta vendedora de prueba>"
$env:MP_SPIKE_CONFIRM_TEST_ACCOUNT = "yes"
```
Al terminar: `Remove-Item Env:MP_SPIKE_ACCESS_TOKEN`.

### 3.3 Protecciones del script (verificadas con 11 tests con un `fetch` falso)
Se niega a correr si: falta alguna variable · el token es igual al de producción de la app · `VERCEL_ENV=production` · `GET /users/me` devuelve una cuenta distinta de `MP_SPIKE_EXPECTED_USER_ID`. Solo crea/modifica/cancela suscripciones cuyo `external_reference` empiece con `stampa_spike_` (las que crea él mismo). Todo es **DRY-RUN** salvo `--execute`. Solo frecuencia en días (1–30). Los resultados se guardan sin datos personales en `%TEMP%\mp-spike` (o `MP_SPIKE_OUT`).

### 3.4 Procedimiento
Para acelerar, se usa un **escenario reducido** (el conteo de ciclos es nuestro, no de MP): suscripción de $9.900 **diaria**, cambio a $19.900 después del 2.º cobro, y se observa el 3.º. Si todo es limpio se repite con el escenario completo (6 → 7).

| Paso | Comando | Qué se observa |
|---|---|---|
| 0 | `node scripts/mp-spike/price-change-spike.mjs whoami` | Cuenta verificada (id/usuario). |
| 1 | `… create --amount 9900 --email <comprador-de-prueba> --days 1` (dry-run) y luego `--execute` | Estado inicial `pending`; devuelve `init_point`. |
| 2 | Abrir `init_point` con la cuenta **compradora** y pagar con tarjeta de prueba (titular `APRO`) | La suscripción debe pasar a `authorized`. |
| 3 | `… inspect <id>` cada día | ¿Se generan cobros recurrentes en prueba? (`charged_quantity`, cuotas `processed` + pago `approved`, montos, `debit_date`). **Puerta 0**: si en prueba **no** hay cobros recurrentes, la Fase A no puede responder «cuándo se aplica»; se pasa a la Fase B. |
| 4 | Con `charged_quantity ≥ 2`: `… put-amount <id> --amount 19900 --require-charged 2` (dry-run) y luego `--execute` | Respuesta HTTP del `PUT`; **estado, `version`, `next_payment_date` y monto antes/después**. |
| 5 | `… inspect <id>` inmediatamente después, y otra vez tras el próximo débito | Monto de la **cuota ya programada** y de la **siguiente**; ¿pidió reautorización (estado `pending`/acción del pagador)? |
| 6 | `… cancel <id> --execute` al terminar | Cierra la suscripción de prueba. |

### 3.5 Cómo responde cada pregunta del pedido
1. **¿Se modifica el importe correctamente?** `put.ok` + monto releído = 19900 + estado sigue `authorized`.
2. **¿Cuándo empieza a aplicarse?** Comparar `transaction_amount` de las cuotas en `before.invoices` vs. `after.invoices` y el monto efectivamente cobrado en el débito siguiente (¿cuota ya programada con el monto viejo o con el nuevo? ¿qué pasa con una cuota en reintento `recycling`?).
3. **¿Requiere nueva autorización?** El estado tras el `PUT` (`authorized` = no; `pending` = sí), y si el débito siguiente se produce sin acción de la compradora.
4. **¿Qué notificación recibe el suscriptor?** La Fase A solo ve el **webhook** (`subscription_preapproval` por actualización, si se configuró URL de prueba) y el cambio de `version`/`last_modified`. **El e-mail al suscriptor no se puede ver con cuentas de prueba** (la documentación no dice que tengan bandeja real): se resuelve con la Fase B o consultando a Mercado Pago (§7).
5. **¿Cómo evitar que el cambio se aplique antes del 7.º período?** La regla que la prueba debe confirmar y que el sistema impondrá: **solo `PUT` cuando el 6.º cobro esté aprobado y no haya cuota en reintento** (`--require-charged` replica la parte verificable). Hay que confirmar que el `PUT` posterior a un cobro no altera ese cobro ya hecho ni la cuota ya generada si esta lleva el monto viejo.

### 3.5.1 Criterio de decisión
- **Modo A (`put_amount`)**: el `PUT` se acepta, el estado sigue `authorized`, el débito siguiente sale con el monto nuevo y no hay pedido de reautorización → seguir con la implementación.
- **Modo B (`reconsent`)**: estado `pending`, pedido de acción del pagador, rechazo del aumento o cobro con monto inesperado → rediseño acotado (nueva suscripción a precio regular con consentimiento explícito).
- **Inconcluso** (no hay cobros recurrentes en prueba o no se ve el e-mail) → Fase B o respuesta de Mercado Pago.

## 4. Duración y esfuerzo
Fase A: 1 hora de preparación + 3–4 días de calendario para el escenario reducido (un ciclo por día), más 7–8 días para el completo si se quiere. Solo hace falta correr un comando por día.

## 5. Qué hace falta de tu lado
Las cuentas de prueba, el token de prueba, el User ID y correr los comandos (o autorizarme a correrlos en una sesión donde estén esas variables y me indiques que son de prueba). Yo no tengo ni pido esas credenciales.

## 6. Fase B — operación real mínima (NO AUTORIZADA; solo propuesta)
**Solo si la Fase A no alcanza** (típicamente: ver el e-mail real del suscriptor o confirmar la reautorización con una tarjeta real).
- **Alcance:** 1 suscripción real, creada por una cuenta compradora real **tuya** (otra cuenta de Mercado Pago o un familiar que acepte), a un monto mínimo, **con un solo cobro** real; luego un `PUT` de monto y la cancelación inmediata antes del siguiente débito.
- **Costo:** 1 cobro real del monto mínimo (a confirmar el mínimo que acepta MP; un incidente previo registró un cobro real de $250). Se puede pedir su reembolso desde la cuenta compradora.
- **Riesgo:** bajo y acotado (una sola suscripción propia, sin usuarios ni datos de la app, no pasa por nuestra base). Se crea en la cuenta de producción de MP, por lo que **no se haría con el script actual** (sus guardas lo impiden): se prepararía una variante con las mismas protecciones solo si la autorizás con ese alcance exacto.
- **Procedimiento:** se te presenta paso a paso antes de ejecutar; vos autorizás cada operación de escritura.

## 7. Preguntas para Mercado Pago (soporte/desarrolladores) en paralelo
1. Al modificar `auto_recurring.transaction_amount` por API de una preapproval `authorized`, ¿el nuevo monto aplica desde el próximo débito programado? ¿y a la cuota ya generada / en reintento?
2. ¿Se envía e-mail al pagador cuando el cambio es por API (como en «Modificar monto» del panel)? ¿con qué texto y anticipación?
3. ¿El pagador debe reautorizar? ¿Hay un tope o una política de aumentos para Argentina?
4. ¿`reason` tiene un largo máximo? ¿Se muestra en el checkout y en los e-mails?
5. ¿Los cobros recurrentes se generan con cuentas de prueba?

## 8. Resultado
_Pendiente de ejecución. Completar acá (fecha, entorno, comandos, hallazgos, decisión Modo A/B) y trasladarlo a `docs/DEPLOY_MEMBERSHIP_BILLING.md`._
