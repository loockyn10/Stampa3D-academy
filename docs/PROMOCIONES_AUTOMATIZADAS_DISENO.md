# Promociones automatizadas — diseño técnico (Pioneros 6 ciclos + prueba gratuita)

**Estado:** DISEÑO (2026-11-11). **No se escribió código de producción, no se aplicó ninguna migration, no se llamó a Mercado Pago, no se tocó ninguna suscripción, precio ni flag. Sin push ni deploy.**
**Pedido:** que las promociones por cantidad de ciclos (Pioneros: $9.900 × 6 ciclos → $19.900, 20 usos) y las pruebas gratuitas funcionen a escala (cientos o miles de suscripciones) sin gestionar cambios de precio a mano, **sin crear un segundo sistema de membresías**.

> **[C]** confirmado en el repo · **[D]** confirmado en la documentación oficial de Mercado Pago (leída hoy) · **[?]** NO verificado: requiere prueba real, consulta a MP o decisión. Nada marcado [?] se da por cierto.

Documentos relacionados: `PIONEROS_SIMPLIFIED_PROPOSAL.md` (códigos de descuento, M1 en pausa), `PIONEERS_EDITION_DESIGN.md` + `supabase/migrations/20261111120000_pioneer_edition.sql` (M1, escrita y probada **sin aplicar**), `MP_PRICE_CHANGE_SPIKE.md` (spike del `PUT`, preparado **sin ejecutar**), `PIONEROS_CHECKOUT_TEST_RUNBOOK.md` (compra controlada de $250).

---

## 0. Resumen y recomendación

1. **La promoción se modela como una "agenda de precio" por suscripción** (`subscription_price_schedules`): una fila 1:1 con la preapproval que nace de un código de descuento con condiciones de ciclos. No tiene precios, pagos ni acceso propios: **lee** los pagos de `payments`, **usa** el checkout y la reserva de código existentes y **solo ordena** un `PUT` de monto. No es un segundo sistema de membresías.
2. **Todo se deriva de `payments`**, nunca de contadores que se incrementan. `cycles_paid` = cantidad de cobros `approved` distintos de esa preapproval por el monto promocional. Un webhook repetido, desordenado o un reintento de MP no puede contar dos veces; un pago pendiente o rechazado no cuenta.
3. **El cambio de precio lo ejecuta un servicio idempotente** que, antes de cada `PUT`, re-lee la preapproval en Mercado Pago (estado, monto, próximo cobro), verifica el aviso previo, aplica, re-lee y verifica. Dirección de falla: **ante cualquier duda el cliente sigue pagando el precio promocional** (nunca se cobra un monto no avisado) y se alerta a administración.
4. **Lista blanca, no lista negra:** solo se tocan suscripciones que tienen una agenda. Las 2 pruebas de $250, los fundadores, los descuentos sin condiciones de ciclos y cualquier otra suscripción **no pueden** ser alcanzadas por el servicio porque no existe fila para ellas.
5. **Bloqueante duro:** el `PUT` de monto está documentado, pero **cuándo aplica, si exige reautorización y qué ve el pagador no lo está** [?]. El diseño soporta tres modos según el resultado del spike (§3.8). **No se habilita ningún cambio real hasta validarlo.**
6. **Prueba gratuita:** recomiendo empezar por la modalidad **B** (30 días por código, sin medio de pago, sobre `user_access_grants` que ya vencen solos) y evaluar la **A** (`free_trial` de MP) en paralelo con cuentas de prueba, que no cuestan nada porque no hay cobro (§5).

**Lo que necesito que decidas** está en §8. Lo más importante: (a) aprobar la estructura de datos de §3.2 (migration aditiva, no aplicada); (b) cómo avisamos al usuario antes del cambio (hoy no hay e-mail transaccional propio); (c) autorizar el spike en cuentas de prueba de MP; (d) qué precio rige desde el ciclo 7 (el aceptado al contratar vs. el vigente).

---

## 1. Qué se reutiliza del sistema existente

| Necesidad | Qué ya existe | Cómo se usa | Estado |
|---|---|---|---|
| Código de precio fijo, límite de usos, vencimiento | `invite_codes` (`fixed_price`, `max_uses`, `expires_at`, `status`) + `reserve_discount_code` / `attach` / `confirm` / `release` | **Sin cambios.** Los 20 cupos son 20 códigos de un uso o 1 código con `max_uses = 20` (probado: `tests/pioneros-codes-db.test.mjs`, 12 tests, 12 simultáneos → gana 1) | [C] |
| Precio original y promocional registrados | `discount_code_reservations` (`base_amount`, `final_amount`, `code_type`, `discount_value`, `confirmed_at`) | Ya guarda el precio de lista visto y el promocional al reservar. Solo faltan ciclos y precio posterior | [C] |
| Precio decidido en servidor | `discount_code_final_amount`, `loadMembershipPrice` | Sin cambios; el cliente nunca manda un monto | [C] |
| Checkout idempotente | `checkout_attempts`, `executeDiscountedCheckout` (reservar → checkout al monto reservado → vincular → confirmar al autorizar → liberar) | Sin cambios | [C] |
| Webhook firmado + eventos | `/api/mercadopago/webhook`, `membership-webhook.ts` (firma, `webhook_events`, 200/401/500 según el error), `membership-sync.ts` (`syncPreapproval` re-lee de MP y converge) | **Punto de enganche:** un hook nuevo `onPaymentsRecorded` junto a `onSubscriptionAuthorized` | [C] |
| Cobros idempotentes | `store.recordInvoice` (una fila por cuota, clave `mercado_pago_payment_id`, merge por `paymentId`, `23505` reintenta) | La fuente del conteo de ciclos | [C] |
| Conciliación / tareas programadas | `reconcileMemberships` + cron diario (`vercel.json`: 1 cron, `15 9 * * *`) | Se **extiende** con un paso "agendas vencidas" en la misma ruta (no agrega crons) | [C] |
| Cambio de monto con verificación | `membership-price-update.ts` (`PriceUpdateGateway.read/updateAmount`, relee antes y confirma después; omite montos especiales) y `scripts/mp-spike/price-change-spike.mjs` | Se **reutiliza el gateway** y el patrón "leer → escribir → releer → verificar" | [C] |
| Acceso con vencimiento automático | `user_access_grants` (`grant_type`, `status`, `expires_at`) leído por `resolveUserAccess`; canje `redeem_beta_access_code` | Base de la prueba gratuita B (§5.2) | [C] |
| Patrones de DB aprobados | M1: pagos que califican derivados de `payments`, `_chargeable`, `sync_*`, locks, triggers de inmutabilidad, bitácora append-only, RLS y grants explícitos, preflight | **Se reutilizan los patrones** (no las tablas de Pioneros, §4) | [C] |
| Protección de precio masivo | `0c987c2` (el cambio masivo no pisa promos) | **Local, sin deploy.** Debe desplegarse antes de cualquier "aplicar a existentes" | [C] |

**Lo que NO existe** (hay que construir): conteo de ciclos por suscripción, estado del paso al regular, servicio que ejecuta el `PUT` con reintentos, aviso previo al usuario (no hay e-mail transaccional propio: solo Supabase Auth para verificación), pantalla admin de estado, soporte de duración "N ciclos" en códigos (hoy solo `forever`, D033), prueba gratuita.

---

## 2. Qué soporta oficialmente Mercado Pago y qué falta validar

| Tema | Lo que dice la documentación / lo que se sabe | Estado |
|---|---|---|
| Cambiar el monto de una suscripción | `PUT /preapproval/{id}` actualiza «motivo, monto, medio de pago, estado y otra información»; el cuerpo usa `auto_recurring.transaction_amount` + `currency_id` | **[D]** |
| Desde cuándo rige el nuevo monto (cuota ya generada, en reintento, próxima) | No documentado | **[?]** spike |
| Si exige reautorización del pagador / estado resultante (`authorized` vs `pending`) | No documentado. La página del `PUT` no enuncia restricciones ni topes. Un hilo no oficial sugiere que no | **[?]** spike |
| Aviso al pagador por e-mail | Documentado solo para «Modificar monto» **en el panel** (planes). Para el `PUT` por API: no dice | **[?]** consulta a MP / Fase B |
| Programar el cambio (calendario de montos) | No existe; el endpoint no tiene fecha de vigencia | **[D]** (ausencia): lo ejecutamos nosotros |
| Cantidad de ciclos / fin | `auto_recurring.end_date` y `repetitions` (planes) existen; `end_date` aparece en los ejemplos de `POST/PUT /preapproval` | **[D]** (ejemplos) |
| Leer estado y próximo cobro antes de cambiar | `GET /preapproval/{id}` (estado, `auto_recurring`, `next_payment_date`, `summarized`) y `GET /authorized_payments/search` | **[D]**/**[C]** (el código ya los usa) |
| `free_trial` | Objeto `auto_recurring.free_trial {frequency, frequency_type}` en planes (más `first_invoice_offset`, días hasta la 1.ª factura) y en los ejemplos de `POST /preapproval`. El glosario: período gratuito antes de la primera carga | **[D]** existe; el comportamiento fino **[?]** |
| Suscripción **asociada a un plan** | Se crea con `POST /preapproval` + `preapproval_plan_id`, **siempre con `card_token_id` y estado `authorized`**; la doc no menciona `init_point` ni redirección | **[D]** |
| Nuestro checkout hoy | Preapproval **sin plan**, estado `pending`, el pagador autoriza en MP vía `init_point` (no hay `preapproval_plan_id` en `src/`) | **[C]** |
| `free_trial` en una preapproval **sin plan** con `init_point` | Aparece en los ejemplos de `POST /preapproval`; si MP lo acepta en ese flujo y cómo trata la tarjeta durante la prueba no está explicado | **[?]** spike (sin costo: no hay cobro) |
| Si MP valida la tarjeta con un cobro durante la prueba | No documentado | **[?]** |
| Impedir varias pruebas por persona | MP no lo hace entre cuentas | **Lo resolvemos nosotros** (§5) |
| Importe mínimo / aceptación de $9.900 | No documentado; solo hay precedente de $250 y $19.900 | **[?]** |
| Reintentos de cobro | Hasta 4 en ~10 días; 3 cuotas rechazadas cancelan la suscripción | **[D]** (D044) |

Conclusión: **lo único oficial y suficiente hoy** es leer estado/monto/cobros y escribir el monto. Todo lo que determina *si el paso al regular es transparente para el cliente* es [?] y se resuelve con el spike, no con suposiciones.

---

## 3. Pioneros: arquitectura de las promociones por ciclos

### 3.1 Idea central
```
código (invite_codes + términos)  ──reserva/attach/confirm (existente)──▶  preapproval al precio promocional
                                                                              │
                         webhook / sync / cron  ──syncPreapproval (existente)─┤ recordInvoice (existente)
                                                                              ▼
                                   sync_price_schedule(preapproval)  ← lee payments, cuenta ciclos (nuevo, solo DB)
                                                                              ▼
                                   runner del paso al regular (nuevo) ──GET → verifica → PUT → GET──▶ Mercado Pago
```

### 3.2 Datos (migration **aditiva**, propuesta, sin aplicar). Ninguna tabla existente se altera.

**`discount_code_terms`** (1:1 opcional con `invite_codes`, clave `invite_code_id`): las condiciones comerciales de la campaña que el administrador podrá editar sin código.
| Columna | Para qué |
|---|---|
| `promo_cycles int` (1–24) | Ciclos al precio promocional (6) |
| `post_price_mode text` (`list_at_acceptance` \| `fixed`), `post_price numeric` | Precio posterior. Recomendado: el precio de lista **aceptado al contratar** como tope (§8 P-1) |
| `notice_days int` (default 20) | Aviso mínimo antes del cambio |
| `terms_version text` | Texto de condiciones que el usuario acepta (versionado) |
| `trial_days int`, `trial_mode text` (`none` \| `grant` \| `provider`) | Pruebas gratuitas (§5); `none` por defecto |
| `badge_key text`, `early_access_features text[]` | Opcionales, para la insignia/acceso anticipado de Pioneros (capa aparte, §4) |

La **cantidad de usos** y el **vencimiento de la campaña** siguen siendo `invite_codes.max_uses` y `invite_codes.expires_at` (ya existen). Precio especial = `invite_codes.discount_value` con `code_type = fixed_price`.

**`subscription_price_schedules`** (una fila por preapproval promocional): `id`, `invite_code_id`, `reservation_id` (único, FK a `discount_code_reservations`), `user_id`, `mercado_pago_preapproval_id` (único), **`list_price_at_purchase`** (= `reservation.base_amount`), **`promo_price`** (= `final_amount`), **`promo_cycles`**, **`post_price_accepted`**, `terms_version`, `accepted_at`, `status`, `cycles_paid` (derivado, monótono), `first_payment_id`, `due_at`, `notice_sent_at`, `notice_channel`, `target_price`, `attempts`, `next_attempt_at`, `lease_until`, `applied_at`, `last_error`, `last_provider_snapshot jsonb` (estado, monto y próximo cobro vistos en MP), `created_at`, `updated_at`.
Invariantes por trigger (como M1): los términos (`promo_price`, `promo_cycles`, `post_price_accepted`, `accepted_at`) son **inmutables**; `cycles_paid` nunca baja; `applied` es terminal; ninguna escritura directa para `anon/authenticated/service_role`, solo funciones `security definer` con `search_path` fijo y `grant execute` explícito a `service_role`; RLS: cada persona lee solo su fila y columnas no sensibles (para mostrarle su aviso).

**`price_schedule_events`**: bitácora append-only (cada transición, cada intento de `PUT` con el monto leído antes/después y el HTTP status, cada aviso). Es lo que se muestra en administración y lo que respalda ante un reclamo.

Con esto quedan registrados todos los datos pedidos: precio original (`list_price_at_purchase`), promocional (`promo_price`), cantidad de ciclos (`promo_cycles`), precio posterior aceptado (`post_price_accepted`), el consentimiento (`terms_version` + `accepted_at`) y errores (`last_error` + eventos).

### 3.3 Nacimiento de la agenda
Cuando MP autoriza la preapproval y se confirma la reserva del código (`confirm_discount_reservation`, hoy en `onSubscriptionAuthorized`), si el código tiene términos con `promo_cycles`, se crea la agenda con los valores de la reserva. Es **idempotente** (clave única `reservation_id`/`preapproval_id`). Para cuentas ya existentes no se crea nada: solo nacen agendas de compras nuevas con esos códigos.
Pendiente de verificar [?]: que `invite_codes.discount_duration` admita un valor nuevo (`cycles`) o si hay un CHECK; si lo hay, se resuelve con un valor nuevo agregado por migration aditiva y no editando migrations aplicadas.

### 3.4 Conteo idempotente de ciclos
`sync_price_schedule(preapproval_id, provider_status)` se llama desde el hook `onPaymentsRecorded` en `syncPreapproval` (después de `recordInvoice`), o sea desde **los mismos tres caminos** que hoy sincronizan (webhook, "revisar mi pago" del usuario y cron). Calcula:
```
cycles_paid = count(distinct payments.mercado_pago_payment_id)
              where subscription = esa preapproval, user = dueño, status = 'approved',
                    currency = la de la agenda, round(amount,2) = promo_price
```
- **No se cuenta dos veces un webhook:** no hay `+1`; se recalcula desde filas únicas por cuota. Repetir la llamada 12 veces da el mismo número (se prueba).
- **No se adelanta por pendientes o rechazados:** solo `approved`; un reintento de la misma cuota reutiliza el mismo id.
- **Monto ≠ promocional** (cobro de validación, cobro con otro importe): no cuenta y queda anotado en el evento para revisión.
- `cycles_paid >= promo_cycles` ⇒ `scheduled → due`. Una cancelación en MP ⇒ `void` (el precio promocional se pierde, el uso del código ya consumido no se devuelve, igual que hoy).

### 3.5 Máquina de estados
```
scheduled ──(cycles_paid ≥ promo_cycles)──▶ due ──(aviso ≥ notice_days y ventana ok)──▶ applying ──PUT+verificación ok──▶ applied
    │                                          │                                            │
    │                                          └─ventana no alcanza──▶ needs_review         └─falla──▶ due (reintento con backoff) ──▶ failed (tope de intentos)
    └──(cancelled en MP)──▶ void                (se mantiene el precio promocional; alerta)
```
Estados terminales: `applied`, `void`. `needs_review`/`failed` se resuelven desde administración (reintento seguro, pasar a `manual`).

### 3.6 Aviso previo al usuario
- **Aviso 1** (al aprobarse el cobro `promo_cycles − 1`, ~30 días antes del cobro 7): «Tu precio promocional de $9.900 termina con tu próximo ciclo. Desde el cobro del DD/MM pagarás $19.900/mes. Podés cancelar antes.» Se guarda `notice_sent_at`, canal y versión del texto.
- **Aviso 2** (al aprobarse el cobro `promo_cycles`): confirma fecha y monto del próximo débito.
- El `PUT` **solo se ejecuta si** `now ≥ notice_sent_at + notice_days` y falta más que un margen (p. ej. 48 h) hasta el débito. Si el aviso no llegó a tiempo, **no se sube el precio**: ese ciclo sale al promocional (falla a favor del cliente) y se alerta.
- **Canal [decisión]:** hoy no existe e-mail transaccional propio (R10). Opciones: (a) aviso dentro de la app (banner en Perfil/Membresía + `/sin-acceso`) + el aviso propio de MP si lo envía [?]; (b) sumar un proveedor de e-mail (Resend/Postmark) para avisos de membresía. **Recomiendo (a) + (b)**: el aviso con constancia de entrega es lo que más protege legalmente (consultar abogado; no es asesoramiento legal).

### 3.7 Servicio que ejecuta el cambio (runner)
Se invoca (1) desde el hook cuando un sync deja una agenda `due`, y (2) desde el cron diario ya existente como red de seguridad. Para cada agenda `due`, **en orden y con lease** (`lease_until`, compare-and-set `due → applying`, así dos ejecuciones simultáneas no hacen dos `PUT`):
1. **Elegibilidad en la base:** agenda `due`, aviso cumplido, sin `paused_by_admin`, dueño sin fila en `founder_members`, no hay otra agenda activa de esa persona.
2. **`GET /preapproval/{id}` (verificación en MP):** `status = authorized`; moneda correcta; `transaction_amount == promo_price` (si ya está en `target_price` ⇒ marcar `applied` sin `PUT`; si es **otro** monto ⇒ `needs_review`, no se toca); `next_payment_date` futuro y fuera del margen; sin cuota en reintento (`/authorized_payments/search`) [?: qué hace MP con una cuota ya generada].
3. **Objetivo:** `target_price = least(precio vigente, post_price_accepted)` (o el fijo del código), nunca por encima de lo aceptado (§8 P-1).
4. **`PUT`** `auto_recurring.{transaction_amount, currency_id}` (el mismo gateway ya probado con fakes).
5. **`GET` de nuevo:** debe informar `target_price` **y** seguir `authorized`. Si no (p. ej. pasó a `pending` por reautorización [?]) ⇒ no se da por aplicado, `failed` con el motivo, **se avisa** y se activa el Modo B (§3.8).
6. Escribe `applied_at`, el snapshot y el evento; actualiza `subscriptions.amount` (el sync lo realinea de todos modos).
- **Reintentos seguros:** cada paso es idempotente (releer antes de escribir; el mismo `PUT` dos veces deja el mismo monto). Backoff 1 h → 6 h → 24 h, tope de intentos, y **siempre detenerse** si faltan menos del margen para el débito.
- **Registro de errores:** HTTP status, código de MP, cuerpo truncado y sin datos personales, en `price_schedule_events` + `last_error`; nada de tokens ni correos en logs.
- **Escala:** el cron procesa por lotes con presupuesto de tiempo (`shouldStop`) y orden por `due_at`, como `reconcileMemberships` [C]; con 1 cron diario y avisos de ~30 días el margen es amplio; el webhook del 6.º cobro es el disparador principal.

### 3.8 Los tres modos según el resultado del spike (decisión de diseño que el spike cierra)
| Modo | Condición verificada en MP | Qué hace el sistema |
|---|---|---|
| **A — `PUT` directo** | El `PUT` se acepta, queda `authorized`, el cobro siguiente sale al monto nuevo, sin reautorización | El runner de §3.7 tal cual |
| **B — reconsentimiento** | MP exige reautorización o pone `pending` | Al llegar a `due` se invita **dentro de la app** a una suscripción nueva al precio regular (reusa el checkout normal) y se cancela la anterior recién cuando la nueva está `authorized`. Costo: parte de los usuarios no completa el paso |
| **B′ — vencimiento natural (sin `PUT`)** | Si se prefiere no depender del `PUT` | La preapproval promocional se crea con `end_date` a `promo_cycles` períodos; al terminar, MP no cobra más y la app ofrece reactivar a precio regular con un clic. Es lo más transparente legalmente y no requiere `PUT`, pero **no es automático** (hay que reactivar). Requiere confirmar que MP respeta `end_date` en preapprovals sin plan [?] |

**Mi recomendación técnica:** implementar todo hasta el borde (agenda, conteo, avisos, runner en modo *dry-run*) y **decidir A/B/B′ con el spike**. Las piezas de §3.2–§3.6 son idénticas en los tres modos.

### 3.9 Exclusiones (cómo se evita tocar lo que no corresponde)
- **Lista blanca por construcción:** el runner solo itera `subscription_price_schedules`. No hay `SELECT` sobre `subscriptions` para decidir qué cambiar.
- Las **2 suscripciones de $250**, las de prueba y los **Fundadores** no tienen agenda ⇒ intocables. Un fundador ni puede crear agenda (check de elegibilidad); un test lo cubre.
- **Otros descuentos** (porcentaje, monto fijo, "para siempre"): sin términos de ciclos ⇒ sin agenda.
- **Doble escudo:** el runner exige que el monto leído en MP sea exactamente `promo_price` antes del `PUT`; cualquier otro monto ⇒ `needs_review` (cubre cambios hechos a mano en el panel de MP).
- **Cambio masivo de precio (`/admin/membresia`):** debe excluir explícitamente toda preapproval con agenda activa o `applied` y, **antes**, desplegarse `0c987c2` (hoy local) [C]. Pendiente 1b.

### 3.10 Administración (consulta de estado)
`/admin/promociones` (primero **solo lectura**): resumen por estado (scheduled/due/applying/applied/failed/needs_review/void), tabla (n.º de cupo si aplica, estado, `cycles_paid/N`, monto en MP vs. esperado, fecha de aviso, próximo débito, último error), detalle con eventos. Acciones auditadas, en una segunda etapa: **reintentar** (re-encola, seguro), **pausar** una agenda, **marcar manual**. Nada que escriba precios a mano desde la pantalla.
Config sin tocar código (a futuro): el formulario de `/admin/codigos` suma, para `fixed_price`, los campos de `discount_code_terms` (ciclos, precio posterior, aviso, texto de condiciones, prueba gratuita). La arquitectura ya lo permite porque todo está en datos.

### 3.11 Pruebas previstas (todas locales, sin MP ni Supabase)
Unitarias de la máquina de estados y de elegibilidad; runner con gateway falso (mismo estilo que `tests/membership-price-update.test.mjs`); DB con Postgres embebido (mismo helper que descuentos): 12 webhooks repetidos ⇒ `cycles_paid` igual; pagos `pending/rejected` no avanzan; cobro de otro importe no cuenta; reintento de la misma cuota no duplica; dos runners simultáneos ⇒ un solo `PUT`; aviso insuficiente ⇒ no se sube; monto leído distinto ⇒ `needs_review`; 2 suscripciones de $250 y un fundador ⇒ intactos; cancelación a mitad ⇒ `void`; términos inmutables; RLS/privilegios por rol. Una mutación (quitar el lease o el filtro `approved`) debe romper las pruebas.

---

## 4. Relación con M1 (Pioneros v3, en pausa)

M1 resolvía el mismo problema con una tabla específica (`pioneer_members`: n.º 1–20, reserva por 60 min, confirmación por primer pago, `cycles_paid`, `step_up_status`). Este diseño **generaliza lo valioso y descarta lo redundante**:
- **Se rescatan:** derivar ciclos de `payments`, `_chargeable`, la lógica de `sync_*`, triggers de inmutabilidad, bitácora, RLS/grants y el patrón de tests con concurrencia.
- **Se descarta:** el cupo propio (`reserve_pioneer_seat`, retención de 60 min, `_sweep_expired`): los cupos ya los da `max_uses` con reservas del sistema de descuentos, que está en producción [C].
- **Capa opcional "Pionero #N" + acceso anticipado:** si se quiere insignia numerada, se asigna al **confirmarse** la agenda (n.º en orden de `confirmed_at`, bajo lock, `check ≤ 20`) y vive en una tabla chica aparte; es independiente del paso de precio y puede ir después. Decisión tuya (§8 P-5).
- M1 **no se aplica ni se borra**: queda como referencia hasta decidir.

---

## 5. Prueba gratuita (segunda etapa)

### 5.1 Modalidad A — con medio de pago autorizado desde el comienzo (`free_trial` de MP)
- **Qué soporta MP [D]:** `free_trial` en el plan y en los ejemplos de `POST /preapproval`; el primer cobro llega al terminar la prueba, y los siguientes siguen solos.
- **Obstáculo [D]:** una suscripción **asociada a plan** exige `card_token_id` y `authorized` (sin `init_point`). Nuestro checkout hoy es **sin plan y con redirección** [C]. Usar plan implica tokenizar la tarjeta en nuestra web (Bricks/SDK JS), un cambio de flujo y de alcance de seguridad (PCI) que **no** corresponde mezclar con Pioneros.
- **Camino de menor cambio [?]:** `auto_recurring.free_trial` en la preapproval **sin plan** con `init_point`. Si MP lo acepta, se prueba **sin costo** con cuentas de prueba (no hay cobro). Preguntas del spike: ¿se acepta?; ¿valida la tarjeta con un cobro?; ¿cuándo se genera la primera factura?; ¿cómo se ven `charged_quantity`/cuotas en la prueba?; ¿qué pasa si se cancela dentro de la prueba?
- **Conflicto con D044 (decisión necesaria):** hoy solo un cobro `approved` da Premium. En una prueba no hay cobro, así que el acceso durante la prueba debe salir de una regla explícita: **grant temporal** en `user_access_grants` creado al autorizarse la preapproval con prueba, con `expires_at = fin de prueba + gracia`. Cuando entra el primer cobro aprobado, rige la membresía normal. No se toca la regla «Premium solo con cobro aprobado»; se agrega una vía de acceso acotada y con vencimiento.
- **Una prueba por usuario:** tabla `user_trials` con `UNIQUE (user_id)`; además se evalúa e-mail normalizado y, cuando MP lo informe, el pagador de MP [?] (una misma tarjeta/cuenta de MP con varias cuentas de Universo es el vector de abuso; `payer_email` ya se separa del e-mail de la cuenta, D048).
- **Vencimientos:** MP convierte solo en el primer débito; el webhook registra el cobro y extiende. Si el cobro falla, el grant vence solo.

### 5.2 Modalidad B — sin medio de pago (30 días por código)
- **Reutiliza** `invite_codes` + canje + `user_access_grants` [C]. El código (de un solo uso, uno por impresora vendida; generación por lote en el admin) otorga un grant de 30 días **a partir del canje**, de tipo propio (`free_trial`) para distinguirlo de Beta y de acceso manual. Hoy `redeem_beta_access_code` solo canjea `beta_tester`/`manual_free_access` con vencimiento absoluto [C]: hace falta una función de canje hermana (aditiva) con `trial_days` relativo [?: confirmar si `code_type` admite un valor nuevo o hay CHECK/enum].
- **Vence solo:** el acceso ya se evalúa por `expires_at` en `resolveUserAccess`/`has_platform_access`; **no hace falta un job para cortar el acceso**. El cron solo envía recordatorios (p. ej. a los 25 días) y `/sin-acceso` muestra «tu prueba terminó» con el checkout normal (opcionalmente con un código de conversión).
- **Una prueba por usuario:** `user_trials UNIQUE(user_id)` + e-mail normalizado (Gmail: puntos y `+alias`); un código = un uso (probado). Idealmente el código se emite contra el comprobante de la impresora.
- **Riesgos:** conversión menor que en A (hay que contratar activamente); abuso con múltiples cuentas de e-mail (se acota con un código de un uso por venta).

### 5.3 Recomendación
**B primero** (sin dependencia de MP, reutiliza grants, vence solo) y **A después**, condicionada al spike gratuito de `free_trial` sin plan. Ambas comparten `discount_code_terms.trial_days/trial_mode` y `user_trials`.

---

## 6. Qué cambia en el código (cuando se autorice implementar)
Aditivo y detrás de interruptores de servidor apagados (`PRICE_SCHEDULES_ENABLED`, `PRICE_STEP_UP_ENABLED`; ninguno se enciende sin autorización):
- Migration nueva `…_price_schedules.sql` (preflight que aborta si falta una dependencia; re-ejecutable; sin `ALTER/UPDATE/DELETE` de tablas existentes). **No se aplica sin autorización.**
- `membership-sync.ts`: hook `onPaymentsRecorded` (no bloqueante, no lanza). `membership-store.ts`: implementa el hook. `membership-reconcile.ts` / ruta `reconcile`: paso "agendas vencidas".
- `src/lib/mercadopago/price-schedule.ts` (puro: estados, elegibilidad, ventana) y `price-schedule-runner.ts` (gateway inyectable).
- Checkout: sin cambios de flujo; el texto de condiciones y el `reason` de la preapproval incluyen los ciclos y el precio posterior (largo máximo de `reason` [?]).
- `/admin/promociones` (lectura) y banner de aviso en Perfil/Membresía.
- Documentación: `DECISIONS.md` (nueva decisión), `CURRENT_STATE.md`, `DEPLOY_*`.

---

## 7. Plan por etapas y puertas

| Etapa | Alcance | Toca prod | Puerta |
|---|---|---|---|
| **0** | Este diseño + tu aprobación de §8 | No | **Tu aprobación** |
| **1** | Lógica pura + tests (estados, ventana, elegibilidad, runner con gateway falso) | No | Revisión |
| **2** | Migration escrita **sin aplicar** + tests con Postgres embebido (conteo idempotente, concurrencia, exclusiones, inmutabilidad) | No | Revisión de la migration |
| **3** | Hook `onPaymentsRecorded` + creación de agenda **en modo sombra** (calcula y registra, no ejecuta `PUT`) detrás de flag apagado | No hasta aplicar la migration | **Autorización para aplicar la migration** (con diagnóstico previo/posterior) |
| **4** | `/admin/promociones` (lectura) + aviso en la app (+ proveedor de e-mail si se decide) | No | QA |
| **5 (paralela, no bloquea 1–4)** | **Spike del `PUT` y de `free_trial`** con cuentas de prueba de MP (`MP_PRICE_CHANGE_SPIKE.md`; cada operación con autorización explícita) + consulta a Soporte MP | **Sí, MP (solo prueba)** | **Autorización por comando** |
| **6** | Elegir Modo A/B/B′; runner con **dry-run** (loguea lo que haría) | No | Resultado del spike |
| **7** | QA del escenario reducido (suscripción diaria en cuenta de prueba, 2 → 3 cobros) y completo si se quiere | MP de prueba | Aprobación |
| **8** | Encender `PRICE_STEP_UP_ENABLED` y lanzar la promoción real (textos legales y D045 resueltos) | **Sí** | **Autorización explícita** |
| **9** | Prueba gratuita B (y A si el spike lo permite) | Según | Aprobación |

**Margen de calendario:** el primer paso al regular ocurre ~5–6 meses después de la primera venta, así que las etapas 6–8 no necesitan estar listas el día del lanzamiento **siempre que** el texto de condiciones que acepta el comprador sea cierto en los tres modos (A/B/B′) y se resuelva antes de vender; si preferís no vender hasta tener el resultado del spike, el texto puede ser más específico. **Decisión tuya.**

---

## 8. Decisiones que necesito de vos (con recomendación)

| # | Decisión | Recomendación |
|---|---|---|
| D1 | ¿Aprobás la estructura de §3.2 (tablas nuevas `discount_code_terms`, `subscription_price_schedules`, `price_schedule_events`; migration aditiva sin aplicar) en lugar de M1? | **Sí.** Reusa cupos/códigos en producción; M1 queda como referencia |
| P-1 | Precio desde el ciclo 7 | El **aceptado al contratar** como tope. Cobrar «el vigente» exige texto legal y aviso; consultar abogado |
| N1 | Canal del aviso previo | In-app + e-mail con proveedor transaccional (nuevo gasto/dependencia) |
| N2 | `notice_days` mínimo | 20 días (config. por campaña) |
| S1 | ¿Autorizás preparar el spike en cuentas de prueba de MP (hoy lo habías pospuesto)? Cada operación se autoriza antes | Sí: es lo que desbloquea el paso al regular **y** `free_trial`; costo $0 |
| P-2 | Quien cancela antes del ciclo 6 | Pierde la promoción; el uso del código ya está consumido; quien vuelve paga el regular |
| P-5 | ¿Insignia numerada «Pionero #N» y acceso anticipado? | Capa opcional posterior (§4), no bloquea el paso de precio |
| T1 | Prueba gratuita: ¿B primero? ¿Qué pasa con el acceso si cancela en la prueba (A)? | B primero; en A, el acceso sigue hasta fin de la prueba |
| L1 | Textos legales (condiciones, aviso, D045 baja) | Abogado antes de vender |

## 9. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | El `PUT` no aplica como se espera / exige reautorización | Modos A/B/B′ (§3.8); sin spike no se habilita |
| R2 | Cobro 7 ya generado con el monto viejo [?] | Falla a favor del cliente; verificación del cobro 7; alerta; ventana y margen explícitos |
| R3 | Se sube el precio sin aviso suficiente | Condición dura de aviso ≥ `notice_days` en el runner y en la base |
| R4 | Dos ejecuciones simultáneas del runner | Lease + compare-and-set; probado con concurrencia |
| R5 | Tocar suscripciones ajenas a la promo | Lista blanca por agenda + monto leído exacto + test de intocabilidad |
| R6 | Un único cron diario en Vercel | El webhook del cobro dispara el paso; el cron es red de seguridad; los avisos son a ~30 días |
| R7 | Contar un cobro de validación o de otro importe como ciclo | Solo `approved` por exactamente `promo_price` |
| R8 | Abuso de la prueba gratuita (varias cuentas) | Un código por venta, `UNIQUE(user_id)`, e-mail normalizado; evaluar pagador de MP |
| R9 | Cambio de precio masivo que pise a Pioneros | Desplegar `0c987c2` y excluir agendas (1b) |
| R10 | `reason`/condiciones demasiado largos para MP [?] | Mostrar condiciones completas en `/sin-acceso` y en el aviso; `reason` corto |

## 10. Qué se hizo y qué no en esta etapa
**Hecho:** revisión del código existente (webhook, sync, conciliación, cobros, descuentos, cambio de precio, grants, M1, spike), lectura de la documentación oficial de MP y este diseño.
**No se hizo:** ningún código de producción, ninguna migration aplicada, ninguna llamada a Mercado Pago, ningún cambio de suscripciones, precios, flags ni datos; sin push ni deploy. El runbook de la compra de $250 sigue vigente e independiente.
