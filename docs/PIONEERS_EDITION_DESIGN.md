# Edición Pioneros — informe técnico (v3)

**Estado:** DISEÑO + protección de precios implementada (2026-11-11). La implementación de Pioneros **NO está activada ni autorizada**: se autoriza por etapas (§9); el cobro depende de validar Mercado Pago. No se aplicó ninguna migration, no se tocó la base, Mercado Pago, precios, suscripciones, usuarios, permisos, feature flags ni la landing. Sin push ni deploy.
Reemplaza a la v2 («Edición Fundadores»). **La v2 quedó obsoleta**: asumía que `founder_members` eran lugares promocionales; son los 3 creadores de Universo Stampa.

**Condiciones definitivas:** Edición Pioneros · 20 cupos · $9.900/mes durante 6 ciclos mensuales · después el precio regular acordado al contratar (hoy $19.900) · acceso anticipado a herramientas seleccionadas por administración mientras haya membresía Premium activa · insignia «Pionero #001»–«#020» permanente. El cupo se confirma solo con el **primer pago aprobado**.

> **[C]** confirmado en el repo o en la base · **[D]** confirmado en la documentación oficial de Mercado Pago · **[?]** NO verificado (requiere prueba real, consulta a MP o decisión). Nada marcado [?] se da por cierto.

Documentos hermanos: [`MP_PRICE_CHANGE_SPIKE.md`](MP_PRICE_CHANGE_SPIKE.md) (runbook del spike, pendiente), `scripts/mp-spike/price-change-spike.mjs`, `supabase/diagnostics/20261110_founders_legacy_state.sql` (M0, ya ejecutado por el usuario).

---

## 1. Dos identidades separadas

| | **Fundadores** | **Pioneros** |
|---|---|---|
| Quiénes | Los 3 creadores de Universo Stampa | Los primeros 20 usuarios que contraten la promoción Premium |
| Dónde viven | `founder_members` (3 filas `active`, n.º 1–3, sin preapproval) **[C]** | `pioneer_members` (tabla nueva, §4.1) |
| Insignia | «Fundador #N» (Perfil, ya funciona) | «Pionero #001»–«#020», permanente |
| Cupos | No consumen ninguno | 20 |
| Promoción comercial | No participan | Sí |
| Acceso anticipado | No lo da la insignia | Mientras mantengan membresía Premium activa |

**Reglas de separación (se prueban, §8):**
1. Las migrations de Pioneros **no hacen DDL ni DML** sobre `founder_members` ni `founder_pricing_tiers`. La única referencia es un `SELECT` de elegibilidad dentro de una función. Un test estático lo impide y el procedimiento de aplicación compara un checksum de `founder_members` antes y después.
2. Un fundador **no puede ocupar un cupo**: la reserva de Pioneros rechaza a quien tenga cualquier fila en `founder_members`.
3. La insignia Fundador no se lee ni se escribe desde código nuevo. `/perfil` agrega una segunda lectura (Pionero) sin modificar la del Fundador.
4. Se deja tal cual el código heredado del sistema fundador (`activateFounderOverrideAdmin`, el bloque inerte de `onSubscriptionAuthorized`, `founder-pricing.ts` muerto, los 2 tramos de `founder_pricing_tiers`). Todo es del dominio Fundadores; su limpieza, si se quiere, es una tarea aparte.

---

## 2. Resultado de la validación técnica de Mercado Pago (spike pendiente)

### 2.1 Lo que se pudo validar sin tocar Mercado Pago
| Pregunta | Resultado | Fuente |
|---|---|---|
| ¿Se puede modificar el importe de una suscripción existente? | **Sí**: `PUT /preapproval/{id}` con `auto_recurring.transaction_amount` y `currency_id`. | [D] |
| ¿Se puede **programar** el cambio para el ciclo 7? | **No**: no hay fecha de vigencia ni calendario de montos. Lo ejecutamos nosotros en el momento correcto. | [D] (ausencia) |
| ¿Cambiar nuestra base cambia el cobro? | **No**. `subscriptions.amount` es una copia que se reescribe con lo que informa MP. | [C] |
| ¿Cuándo empieza a aplicarse el nuevo monto (cuota ya generada o en reintento)? | No documentado. | [?] |
| ¿Exige nueva autorización del usuario? | No documentado. Un hilo no oficial del foro sugiere que no. | [?] |
| ¿Qué recibe el suscriptor? | Con «Modificar monto» **en el panel**, MP avisa por e-mail [D]. Para el `PUT` por API: no documentado. | [D]/[?] |
| ¿Tope de aumento? | No documentado (+101 % acá). | [?] |
| ¿Comportamiento con pagos rechazados o pendientes? | Se reintentan hasta 4 veces en ~10 días; 3 cuotas rechazadas cancelan la suscripción [D]. Cómo interactúan con un cambio de monto: sin documentar. | [D]/[?] |
| ¿Pruebas sin cargos reales? | **Sí**: cuentas de prueba (vendedora + compradora, mismo país, hasta 15 por aplicación) y tarjetas de prueba. | [D] |
| ¿Se ve el e-mail con cuentas de prueba? | Probablemente no. Se cubre con la Fase B (no autorizada) o con una consulta a MP. | [?] |

### 2.2 Qué quedó preparado (no ejecutado)
El script `scripts/mp-spike/price-change-spike.mjs` (`whoami | create | inspect | put-amount | cancel`), sus 11 tests con `fetch` falso y el runbook. Todo es dry-run salvo `--execute`; exige un token de cuenta de prueba con User ID coincidente; se niega a correr con el token de producción; solo opera sobre suscripciones propias (`stampa_spike_…`). **No se ejecutó ninguna operación sobre Mercado Pago.** Antes de cada una se te muestra el comando exacto y se pide autorización.

### 2.3 Resultado
**La validación NO está completa.** Hasta tener el resultado de la Fase A (y de la B o una respuesta de MP sobre el e-mail) **no se implementa el aumento automático** ni se lanza la promoción: sin el paso al precio regular, la oferta de «6 ciclos y luego regular» no se puede cumplir.

---

## 3. Revisión de la arquitectura existente

### 3.1 Qué se reutiliza tal cual (los Pioneros usan el sistema de suscripciones existente) [C]
- **Checkout idempotente** (`checkout_attempts`, `begin/complete_membership_checkout`, bloqueo por usuario, un intento abierto por persona) y `executeCheckout`.
- **Precio decidido solo en servidor** (`membership_settings`, `loadMembershipPrice`); el cliente nunca manda un monto.
- **Facturación D044/D049**: solo un pago `approved` otorga Premium; cada cobro cubre un período más 2 días de gracia; MP es la fuente de verdad; `syncPreapproval` (webhook, `sync-subscription` y cron `/api/mercadopago/reconcile`) es el único circuito.
- **Patrón de descuentos** (D033/D034): reservar → crear la preapproval con el monto reservado → vincular (la base verifica el monto) → confirmar al autorizar → liberar. Se replica la forma, no el código ni las tablas de descuentos.
- **Acceso**: `resolveUserAccess` / `resolveFeatureAccess` y los feature flags globales (`platform_feature_flags`, sin fila = habilitado).

### 3.2 Estado del sistema fundador heredado (M0, base real) [C]
- `reserve_founder_slot` **no existe** en la base. `founder_members`: 3 filas `active` (n.º 1–3, sin preapproval) = **los 3 creadores**. `founder_pricing_tiers`: 2 tramos heredados (1–25 a $9.900; 26–50 a $14.900).
- `founder_members_user_unique_idx` es `UNIQUE (user_id)` **incondicional** y `founder_members_number_unique_idx` es parcial. Los grants de `anon`/`service_role` sobre esas tablas son solo `REFERENCES/TRIGGER/TRUNCATE` (a verificar, §7 R4).
- `has_platform_access`: cualquier grant activo y vigente da acceso; **no filtra por tipo**. Un grant de «acceso anticipado» daría acceso completo en RLS: **descartado**.
- `membership_settings` = $19.900 ARS. **2 suscripciones `authorized` a $250: son pruebas internas** (confirmado por el usuario).

### 3.3 Decisión: tabla propia `pioneer_members`, sin tocar `founder_members`
| Alternativa | Veredicto |
|---|---|
| Reutilizar `founder_members` agregando columnas | **Descartada.** Mezcla dos identidades en una tabla que tiene un `UNIQUE (user_id)` incondicional, el override manual de admin escribe ahí y las migrations tocarían las filas de los creadores. |
| Una tabla única con una columna `kind` | **Descartada.** Mismo riesgo: un error en un `UPDATE`/migration alcanza a los 3 fundadores; las invariantes (20 cupos, numeración) se mezclarían con las del otro grupo. |
| Guardar la edición en `membership_settings` (columnas `pioneer_*`) | **Descartada.** Acopla una tabla crítica del checkout a una promoción temporal. |
| **`pioneer_members` + `pioneer_edition` (una fila de configuración)** | **Elegida.** Dos tablas pequeñas, aditivas, con invariantes propias; no cambia ninguna tabla existente. No es una segunda arquitectura de membresías: **no hay precios, ciclos ni pagos propios**, solo el cupo, el consentimiento y el seguimiento del precio sobre la suscripción existente. |

---

## 4. Arquitectura definitiva recomendada

### 4.1 Datos (migration M1, solo tablas y funciones nuevas)
**`pioneer_edition`** (una fila `id = 'default'`): `enabled boolean not null default false` (interruptor único), `capacity int check (between 1 and 20)` = 20, `promo_price numeric(12,2)` = 9900, `currency` = 'ARS', `price_cycles int` = 6, `terms_version text`, `hold_minutes int` = 60, `early_access_features text[] not null default '{}'` (vacía), `updated_at`, `updated_by`. RLS: solo admin; la lectura pública es por función agregada.

**`pioneer_members`** (un lugar por persona): `id`, `user_id uuid references auth.users on delete set null` (si se borra la cuenta, el número **no** se reasigna), `pioneer_number int not null check (between 1 and 20)`, `status text check in ('reserved','active','released')`, `checkout_attempt_id`, `mercado_pago_preapproval_id`, `locked_price`, `locked_cycles`, `accepted_regular_price`, `accepted_terms_version`, `accepted_at`, `reserved_at`, `reservation_expires_at`, `confirmed_at`, `first_payment_id`, `cycles_paid int not null default 0` (monótono), `step_up_status` (`not_due|due|applied|failed|manual`), `step_up_target`, `step_up_applied_at`, `step_up_error`, `released_at`, `release_reason`, `created_at`, `updated_at`.
- **Invariantes en la base:** índice único parcial `(pioneer_number) where status in ('reserved','active')` e índice único parcial `(user_id) where status in ('reserved','active')`. El número se asigna **al reservar** (el menor libre ≤ capacidad) bajo un `advisory lock`: imposible tener 21 ocupados aunque falle el código.
- `active` es **permanente** (la insignia no se pierde nunca, ni aunque la membresía venza o se cancele). Solo `reserved` puede pasar a `released`.
- RLS: cada persona lee solo su fila; ninguna escritura para `authenticated`/`anon`; funciones `security definer`, `search_path` fijo, `EXECUTE` solo para `service_role`; `grant` explícitos (M0 mostró que no se puede asumir los grants por defecto).
- **No se tocan:** `founder_members`, `founder_pricing_tiers`, `subscriptions`, `payments`, `profiles`, `membership_settings`, `platform_feature_flags`, `user_access_grants`, `has_platform_access`, `checkout_attempts`.

### 4.2 Funciones (idempotentes)
`pioneer_offer_state()` (lectura agregada: habilitada, capacidad, ocupados `active`, retenidos `reserved` vigentes, disponibles, precio, ciclos; **única fuente** de checkout, landing y admin) · `reserve_pioneer_seat(user, regular_price, currency, terms_version)` · `attach_pioneer_seat(user, seat, attempt)` (la base verifica que el intento lleva exactamente `locked_price`) · `sync_pioneer_seat(preapproval_id)` · `release_pioneer_seat(…)` · `list_expired_pioneer_holds()` · `mark_pioneer_step_up(…)`.
**Elegibilidad dentro de `reserve_pioneer_seat`:** oferta habilitada; **sin fila en `founder_members`** (los 3 creadores quedan fuera); sin lugar `reserved|active` previo; sin cobros aprobados previos (las 2 cuentas de prueba internas y cualquier suscriptor actual quedan fuera; nadie recibe el precio promocional por defecto).

### 4.3 Checkout (cambio acotado en `create-subscription`, con la oferta apagada por defecto)
Mismo esqueleto que descuentos: reservar → `executeCheckout` con el monto de la base → vincular. El cliente solo envía `expected_offer` y `accept_terms_version`. Si esperaba el precio Pionero y el cupo ya no existe → `409 pioneer_sold_out` **sin crear nada**; la UI muestra el regular y pide nueva confirmación. No se combina con códigos de descuento. `restart` y cambio de `payer_email` conservan el lugar. El `reason` que ve el pagador en MP incluye las condiciones (largo máximo **[?]**).
- **Reservas temporales:** un checkout `pending` sin autorizar retiene 60 min; vencido, un job **cancela antes la preapproval en MP** (solo si MP la informa `pending`) y recién entonces libera. `authorized` sin pago aprobado retiene hasta que MP resuelva el primer cobro (≤ ~10 días de reintentos [D]) y se libera si se cancela o se agotan los reintentos. **Un pago rechazado o abandonado nunca consume un cupo permanente.**

### 4.4 Confirmación, ciclos y paso al precio regular
- Hook nuevo `onPaymentsRecorded` en `syncPreapproval` → `sync_pioneer_seat`: **primer pago aprobado → `active`** (se asigna la insignia). `cycles_paid` = pagos aprobados distintos con monto ≈ `locked_price` (no cuenta un eventual cobro de validación **[?]**); al llegar a 6 → `step_up_status = 'due'`. Todo se deriva de `payments` (clave: id de cuota): **un webhook repetido no cambia nada**.
- **Paso al regular — NO se implementa hasta validar el spike.** Diseño previsto (Modo A): servicio idempotente que re-lee la preapproval (`authorized`, monto Pionero, **sin cuota en reintento**) → `PUT` del monto objetivo → re-lee y verifica monto y estado → `applied`; reintentos por webhook y cron; si faltan < 3 días para el próximo débito y no se aplicó → alerta y **se mantiene el precio promocional** (nunca se cobra un monto no avisado). Modo B (si MP exige reautorización): invitación dentro de la app a una suscripción nueva a precio regular con consentimiento explícito.
- **Monto objetivo:** el regular **aceptado en la compra** como tope (`least(vigente, aceptado)`). Cobrar el «vigente» sin tope exige texto legal y aviso previo (**consultar abogado**).
- **Evitar el cambio antes del 7.º período:** el `PUT` solo se ejecuta con el 6.º cobro aprobado y sin cuota en reintento. Que MP no altere ese cobro ni una cuota ya generada es **[?]** (Fase A).

### 4.5 Insignia y acceso anticipado
- **Insignia:** `/perfil` lee la fila `active` de `pioneer_members` (select-own) y muestra «Pionero #001»–«#020» (`lpad` a 3). La del Fundador queda como está. Permanece aunque la membresía venza.
- **Acceso anticipado sin grants ni roles, reutilizando el sistema de permisos:** `resolveFeatureAccess(snapshot, id, { isAdmin })` ya recibe opciones por usuario. Se le suma una opción **opcional** `earlyAccess?: readonly FeatureId[]` (default `[]`: ningún llamador actual cambia). Una funcionalidad **deshabilitada públicamente** se permite a quien la tenga en `earlyAccess`.
- **Quién la tiene:** derivado, no un grant: **lugar Pionero `active` + membresía Premium vigente** (se suspende solo si vence; vuelve si renueva). No es rol admin, no es Beta, no usa `user_access_grants`.
- **Qué herramientas:** solo las de `pioneer_edition.early_access_features`, **vacía por defecto**, validadas contra `FEATURE_REGISTRY`. La lista la elige **administración expresamente** (pantalla `/admin/pioneros`, §4.6); no se habilita nada automáticamente ni se modifican `platform_feature_flags` ni `FEATURE_REGISTRY`.
- **Plomería:** `UserAccessSnapshot.capabilities.earlyAccessFeatures` se calcula en `resolveUserAccess` con una consulta extra **solo si** la persona tiene un lugar `active`, y se pasa en los ~6 puntos que hoy pasan `isAdmin` (`server.ts` ×2, `middleware.ts`, `visibility.ts`, `feature-gate.ts` de Stampy, `sin-acceso`). Las lecturas directas del navegador siguen gobernadas por RLS; las herramientas que toquen pagos de terceros requieren QA propio antes de listarse.

### 4.6 Administración
`/admin/pioneros`: capacidad, **ocupados / retenidos / disponibles** reales, tabla de lugares (n.º, estado, `cycles_paid/6`, `step_up_status`, monto en MP vs. esperado), selector de herramientas de acceso anticipado, interruptor `enabled` con confirmación, acciones auditadas (liberar una retención cancelando antes en MP; reintentar el paso al regular). Solo lectura al principio. La edición de precio/ciclos/capacidad se bloquea con lugares existentes.

### 4.7 Landing `/landing-preview`, `/sin-acceso` y Perfil (etapa final)
- Fuente única: `pioneer_offer_state()` + `membership_settings`. Ningún precio, cupo ni contador en `commercial-content.ts`.
- Se muestra «EDICIÓN PIONEROS · SOLO 20 LUGARES» (texto y CTA «Quiero ser Pionero» del pedido) **solo si** `enabled` **y** hay lugares reales; cualquier error, edición apagada o 0 lugares → **Premium regular exactamente como hoy**. **No se anuncia ni se muestran contadores hasta que el checkout respete la promoción** (etapa 7; `enabled` se enciende en la 8).
- Frescura: ISR de 60 s + consulta cliente a un endpoint público de solo agregados (caché ~15–30 s) que degrada a regular al agotarse; la confirmación final la da `/sin-acceso` antes de pagar. Casilla de aceptación versionada.

---

## 5. Protección frente a cambios generales de precio (IMPLEMENTADA, sin ejecutar nada real)

**Problema [C]:** `/api/admin/membership/update-price` con «Aplicar a suscripciones activas existentes» hacía `PUT` a **todas** las `authorized` sin mirar su monto: habría llevado al precio nuevo también a promociones, descuentos y a las 2 pruebas internas de $250.

**Corrección (código, sin migration):** `src/lib/mercadopago/membership-price-update.ts` + la ruta + el texto de la UI. Una suscripción se actualiza **solo si** todas estas condiciones se cumplen:
1. el monto local **y** el monto leído en MP (releído justo antes de cada `PUT`) son **iguales al precio de lista anterior**;
2. está `authorized` en MP y la moneda coincide;
3. MP no la informa ya al precio nuevo (idempotencia).

Todo lo demás se **omite y se informa** con motivo (`special_amount`, `local_amount_differs`, `provider_not_authorized`, `already_at_new_price`, …). Además: si no se conoce un precio de lista anterior confiable, la ruta responde 409 **antes** de cambiar nada; una respuesta de MP que no confirme el monto pedido o deje la suscripción fuera de `authorized` se cuenta como fallo y **no** se guarda; un error al guardar en la base no frena el lote; la base guarda solo `amount`/`currency` (el resto lo realinea el webhook). La respuesta y la UI informan actualizadas / omitidas / con error. **Qué protege hoy:** promociones ($9.900), descuentos, pruebas internas ($250) y cualquier importe histórico, por **monto**, sin depender de que exista una tabla de Pioneros.

**Pendiente (etapa 1b, cuando exista `pioneer_members`):** exclusión **explícita** de toda preapproval vinculada a un lugar Pionero `reserved|active` (para que, ya en $19.900 tras el paso al regular, el botón del admin no los suba por encima del precio acordado). **Mientras tanto:** no usar «Aplicar a existentes» sin revisar el resultado; el cambio de precio sin esa casilla no afecta a las suscripciones existentes.

**Tests:** `tests/membership-price-update.test.mjs` (11), con fakes: ninguna llamada real.

---

## 6. Migraciones necesarias

| # | Qué | Riesgo | Cuándo |
|---|---|---|---|
| **M0** | `20261110_founders_legacy_state.sql` (solo lectura) | Ninguno | **Hecha** (ejecutada por el usuario) |
| **M1** | **Una** migration **aditiva**: `pioneer_edition` + `pioneer_members` + funciones + RLS + `grant` explícitos. Sin `ALTER`/`UPDATE`/`DELETE` sobre ninguna tabla existente. Preflight que aborta si falta una dependencia. | Bajo (solo objetos nuevos) | Etapa 2, tras autorización |
| — | **No** hacen falta: cambios en `founder_members`/`founder_pricing_tiers`, `subscriptions`, `payments`, `profiles`, `platform_feature_flags`, `user_access_grants`, `has_platform_access`. | — | — |

Procedimiento de aplicación de M1 (cuando se autorice): checksum de `founder_members` antes y después (debe ser idéntico), `select count(*)` de las tablas existentes sin cambios, y la configuración nace con `enabled = false`.
Cambios de código (sin migration): hook `onPaymentsRecorded`, `create-subscription`, servicio de paso al regular + job de vencimientos (extiende `/api/mercadopago/reconcile`), `earlyAccess`, `/admin/pioneros`, `/sin-acceso`, landing, Perfil.

---

## 7. Riesgos pendientes

| # | Riesgo | Estado / mitigación |
|---|---|---|
| R1 | **El `PUT` no se acepta, exige reautorización o no aplica como se espera** | **Abierto.** Spike Fase A (+B/consulta a MP). Modo B como alternativa. Sin resultado no se activa la promoción. |
| R2 | Consentimiento y legalidad del escalón (defensa del consumidor, información clara y previa) | Abierto. Texto aprobado por abogado, versionado y guardado por persona; `reason` de MP con condiciones; aviso en la app. No es asesoramiento legal. |
| R3 | Un fundador o una cuenta interna toma un cupo | Cerrado por diseño (elegibilidad en la base) + tests. |
| R4 | Privilegios de `service_role` sobre las tablas fundador (M0: solo `REFERENCES/TRIGGER/TRUNCATE`) | A verificar con `has_table_privilege`. No afecta a Pioneros (tablas nuevas con `grant` explícitos); afecta al bloque fundador inerte de `onSubscriptionAuthorized`, que no se toca. |
| R5 | Sobreventa por compras simultáneas | Resuelto por diseño (índice parcial + lock + `check ≤ 20`) y probado con 20+ reservas paralelas. |
| R6 | Cupos trabados por checkouts abandonados / pago tardío con cupo liberado | TTL 60 min + cancelar en MP antes de liberar; caso residual honrado y marcado `over_limit`. |
| R7 | Cuota 7 ya generada con el monto viejo [?] | Falla segura hacia el monto menor; verificación del cobro 7; alerta. |
| R8 | Contar un cobro de validación de tarjeta como ciclo [?] | Contar solo cobros aprobados ≈ `locked_price`. |
| R9 | `update-price` reprecia promociones/descuentos/pruebas | **Resuelto** (§5). Pendiente 1b: exclusión explícita de Pioneros. |
| R10 | No hay e-mail transaccional propio | Aviso en la app + aviso de MP; e-mail propio solo si se aprueba. |
| R11 | Sin base de pruebas reproducible (tablas base no versionadas) | Conocido (RIESGO-03). Tests de la base con Postgres embebido opt-in, como los de descuentos. |
| R12 | Un solo cron diario en Vercel | El webhook es el disparador principal; el paso al regular tiene ~30 días de margen. |
| R13 | Textos legales de la oferta y baja de servicio (D045) | Independientes de este diseño; bloquean el lanzamiento público. |
| R14 | Abuso (varias cuentas / mismo pagador) | Un lugar por usuario; evaluar por cuenta de MP más adelante. |
| R15 | El override de admin de Fundadores permite crear más fundadores | Fuera de alcance; opcional: limitarlo a 3. No afecta a los cupos Pioneros. |

---

## 8. Decisiones aún abiertas (con recomendación)

| # | Decisión | Recomendación |
|---|---|---|
| P-1 | Precio desde el ciclo 7 | Regular **aceptado en la compra** como tope; consultar abogado antes de cobrar «el vigente». |
| P-2 | Quien cancela antes del ciclo 6 | El cupo queda consumido y la insignia es permanente (consecuencia de «insignia permanente»). Sin promoción si vuelve. |
| P-3 | Un Pionero que vence y se resuscribe | Paga el precio regular; conserva la insignia; el acceso anticipado vuelve con la membresía. |
| P-4 | Elegibilidad | Sin cobros previos y sin registro fundador; un lugar por usuario. |
| P-5 | Retención | 60 min sin autorizar; autorizado sin pago hasta resolución de MP. |
| P-6 | Quién elige las herramientas anticipadas y cuándo | Administración, desde `/admin/pioneros`, una a una; vacía hasta entonces. |
| P-7 | Interruptor de la oferta | `pioneer_edition.enabled` (DB, apagado), sin redeploy; se enciende solo tras QA. |
| P-8 | Borrado de cuenta | `user_id` pasa a `null`; el número no se reasigna. |
| P-9 | Combinación con descuentos | No se combina. |
| P-10 | Contador público | Real, desde `pioneer_offer_state()`, con degradación a regular. |

---

## 9. Plan de implementación por etapas

| Etapa | Alcance | Puerta |
|---|---|---|
| **0** | Vos: crear cuentas de prueba de MP, correr el spike Fase A (cada operación se autoriza antes), decidir P-1 con asesoramiento legal; opcional Fase B / consulta a MP. | **Spike validado → autorizás avanzar al cobro** |
| **1** | **Protección de `update-price`** (§5) — **hecha y commiteada**. | Revisión |
| 1b | Exclusión explícita de Pioneros en `update-price` (necesita la tabla). | Con M1 |
| 2 | M1 + funciones + tests de DB (capacidad, concurrencia 20+, idempotencia, ciclos, TTL, elegibilidad, **inmutabilidad de `founder_members`**). Sin UI ni checkout. | Tests + revisión de la migration |
| 3 | Insignia en `/perfil` y acceso anticipado (`earlyAccess`) con lista vacía + `/admin/pioneros` (lectura). **No depende del spike.** | QA de permisos Free/Premium/Pionero/Fundador/Admin |
| 4 | Checkout Pioneros tras `enabled = false`; `/sin-acceso` con oferta y aceptación de términos; hook `onPaymentsRecorded`; job de vencimientos. | Pruebas con usuarios de prueba de MP |
| 5 | **Paso al regular** (Modo A o B según el spike) + alertas. **Solo tras el spike validado.** | Ciclo 6→7 (o reducido) en entorno aislado |
| 6 | QA final: 20+ compras en paralelo, rechazos, abandonos, webhooks repetidos/desordenados, cancelación a mitad, `update-price` con Pioneros, rollback. | Aprobación para encender |
| 7 | `/landing-preview` (oferta + fallback), endpoint público de oferta. **Sin anuncio ni contadores antes de que el checkout respete la promoción.** | Revisión visual 375/390/escritorio |
| 8 | Textos legales y D045 resueltos → `enabled = true` → monitoreo diario. | — |

**Rollback:** poner `enabled = false` devuelve checkout y landing a los regulares; los lugares ya activos siguen su curso.

---

## 9b. Estado de M1 (2026-11-11): ESCRITA Y PROBADA, NO APLICADA

Archivos: `supabase/migrations/20261111120000_pioneer_edition.sql`, `supabase/diagnostics/20261111_pioneer_m1_state.sql` (foto antes/después, solo lectura), `supabase/diagnostics/20261111_pioneer_m1_postcheck.sql` (verificación posterior, solo lectura), `tests/pioneer-migration.test.mjs` (estáticos) y `tests/pioneer-seats-db.test.mjs` (Postgres real descartable: concurrencia con conexiones simultáneas).

**Decisiones comerciales confirmadas para M1:** 20 cupos; $9.900 × 6 ciclos; desde el 7.º, el regular aceptado al contratar; insignia permanente al confirmarse el primer pago; **cancelar pierde la promoción y el acceso anticipado** (el lugar y la insignia se conservan; el cupo confirmado no se libera); quien vuelve paga el regular; las herramientas de acceso anticipado las elige administración.

**Diferencias respecto del diseño original (§4):**
- `pioneer_members.benefits_ended_at / benefits_end_reason`: marcan el fin de beneficios por cancelación. **Reemplaza P-3**: el acceso anticipado ya **no** vuelve al resuscribirse (la nueva suscripción no está atada al lugar). `step_up_status` pasa a `void`.
- `pioneer_edition.unpaid_hold_days` (11): retención de una suscripción autorizada sin primer cobro aprobado (MP reintenta ~10 días [D]).
- `pioneer_seat_events`: bitácora append-only de cada transición.
- `mark_pioneer_step_up` **no se incluye** (depende del spike); las columnas `step_up_*` ya existen y `sync_pioneer_seat` solo marca `due` / `void`. La función se agrega en una migration aditiva de la etapa 5.
- Una sola función de sincronización, `sync_pioneer_seat(preapproval, estado_proveedor)`: confirma, extiende la retención, libera si MP canceló o termina beneficios. Todo se deriva de `payments`; el estado del proveedor nunca confirma.
- **Pagos tardíos (revisado): no se libera un cupo mientras Mercado Pago pueda cobrarlo.** `_pioneer_seat_chargeable` decide: un lugar es *cobrable* si su checkout en MP sigue en curso (`creating` / `reconciliation_required`), o si algún preapproval (del lugar o del intento) no figura `cancelled` en `subscriptions` (pendiente → aún puede autorizarse; autorizada → se cobra sola; sin fila local → se asume cobrable). Ni el barrido por vencimiento ni `release_pioneer_seat` liberan un lugar cobrable (`chargeable`). Un lugar vencido cobrable **sigue ocupando su número**; `release_expired_pioneer_holds()` devuelve `needs_provider_check` y el servidor debe consultar a MP: *pending* → cancelarla en MP y `sync_pioneer_seat(…, 'cancelled')` (libera); *authorized* → dejarla (`sync … 'authorized'` extiende la retención; si MP cobra, se confirma con su número original); *cancelled* → `sync … 'cancelled'` (libera). `reserve_pioneer_seat` responde `sold_out` con `needs_provider_check` para que el servidor verifique y reintente, y `pioneer_offer_state()` cuenta esos vencidos como no disponibles (`held_expired`). La cancelación en MP es terminal, por lo que después de liberar ya no puede llegar un cobro. Queda como **red de seguridad** (no camino normal) que un pago aprobado sobre un lugar liberado por error operativo lo recupere si hay número libre; si no, queda `released` con `late_payment_no_seat` y se informa (el cupo **nunca** se supera). Costo asumido: una reserva abandonada con checkout creado en MP retiene su cupo hasta que el servidor la verifique y cancele (no basta el tiempo).

**Verificación realizada (local, sin Supabase ni Mercado Pago):** 10 pruebas estáticas y 38 pruebas contra Postgres embebido (migración re-ejecutable, Fundadores y pruebas de $250 sin cambios, 40 reservas simultáneas → exactamente 20, misma persona ×12 → 1 lugar, 12 webhooks simultáneos → 1 confirmación, liberar vs. confirmar en carrera, pagos rechazados/pendientes/de otro importe, vencimiento, pago tardío, cancelación, permanencia, privilegios y RLS por rol). Una mutación (sin el lock) hace fallar las pruebas de concurrencia.

**Verificaciones previas de solo lectura (contra la base real, antes de cualquier autorización):** `supabase/diagnostics/20261111_pioneer_m1_compat.sql` compara con el catálogo real de Supabase los **tipos, relaciones y permisos** que M1 espera (tipos de las 19 columnas que lee o compara, que el dueño de las funciones pueda leer `payments`/`subscriptions`/`checkout_attempts`/`founder_members` sin que RLS lo filtre, reglas de borrado, privilegios de `service_role`, nombres ya existentes) y devuelve `ok` / `MISMATCH` / `info`; **ningún `MISMATCH` puede quedar sin resolver**. `…_pioneer_m1_data_shape.sql` muestra los valores reales (estados, monedas, importes) sin datos personales, para confirmar que `approved`, `cancelled`, `authorized` coinciden en minúsculas con lo que M1 reconoce.

**Para aplicar (cuando se autorice):** 0) `compat` sin `MISMATCH` y `data_shape` revisado; 1) ejecutar `…_pioneer_m1_state.sql` y guardar el resultado; 2) aplicar la migration; 3) volver a ejecutar `state` (filas `founder_*` y `subscriptions_at_250` idénticas) y `…_postcheck.sql` (todas `ok = true`). La configuración nace `enabled = false`, sin términos.

---

## 10. Qué se hizo y qué no en esta etapa
**Hecho (commits locales, sin push):** este informe (v3); la protección de `update-price` con 11 tests; el spike de MP, su runbook y el diagnóstico M0 (ya ejecutado por el usuario).
**No se hizo:** ninguna migration aplicada; ningún registro de producción modificado (los 3 fundadores y las 2 suscripciones de $250 intactos); ningún precio cambiado; **ninguna llamada a Mercado Pago**; la promoción no está activada; la landing no cambió; sin push ni deploy.
