# Edición Fundadores — informe técnico (v2)

**Estado:** PROPUESTA + spike preparado (2026-11-10). La implementación de Fundadores **NO está autorizada**; se autoriza cuando el spike de Mercado Pago esté validado. En esta etapa no se tocó código de la app, base, Mercado Pago, precios, usuarios, suscripciones, permisos, feature flags ni landing. Nada está commiteado. Reemplaza a la v1 de este documento.
**Condiciones confirmadas:** 20 fundadores · $9.900/mes durante 6 ciclos · después el precio regular (hoy $19.900) · acceso anticipado a herramientas seleccionadas.

> **[C]** confirmado leyendo código/historial del repo · **[D]** confirmado en la documentación oficial de Mercado Pago · **[?]** NO verificado (requiere prueba real, consulta a MP o a la base). Nada marcado [?] se da por cierto.

Documentos hermanos: [`MP_PRICE_CHANGE_SPIKE.md`](MP_PRICE_CHANGE_SPIKE.md) (runbook de la prueba), `scripts/mp-spike/price-change-spike.mjs` (script con protecciones), `supabase/diagnostics/20261110_founders_legacy_state.sql` (diagnóstico de solo lectura).

---

## 1. Resultado de la validación técnica disponible

### 1.1 Lo que se pudo validar sin tocar Mercado Pago
| Pregunta | Resultado | Fuente |
|---|---|---|
| ¿Existe una forma de modificar el importe de una suscripción existente? | **Sí**: `PUT /preapproval/{id}` con `auto_recurring.transaction_amount` y `currency_id`. | [D] referencia y «Gestión de suscripciones» |
| ¿Se puede **programar** el cambio para el ciclo 7? | **No** hay fecha de vigencia ni calendario de montos en el endpoint. Lo debemos ejecutar nosotros en el momento correcto. | [D] (ausencia) |
| ¿Cambiar nuestra base cambia el cobro? | **No**. `subscriptions.amount` es una copia que se reescribe con lo que informa MP. | [C] |
| ¿Cuándo empieza a aplicarse el nuevo monto? | **No documentado** (ni a la cuota ya generada ni a una en reintento). | [?] |
| ¿Exige nueva autorización del usuario? | **No documentado.** Un hilo del foro de desarrolladores (Google Groups, no oficial, no accesible completo) sugiere que no: solo e-mail informativo. No es evidencia suficiente. | [?] |
| ¿Qué notificación recibe el suscriptor? | Con «Modificar monto» **en el panel**, MP «le avisará el cambio por e-mail» [D]. Para el `PUT` por API: no documentado. El webhook `subscription_preapproval` cubre «creación y actualización» [D]. | [D]/[?] |
| ¿Tope o restricciones de aumento? | No documentado (+101 % en este caso). | [?] |
| ¿El repo ya ejercitó alguna vez un `PUT` de monto? | Está implementado en `update-price` (`apply_to_existing`) pero **nunca se ejercitó contra la API real** (`DEPLOY_MEMBERSHIP_BILLING.md` §6). La leyenda de la UI («actualizará el monto del próximo cobro») es una suposición. | [C] |
| ¿Se pueden hacer pruebas sin cargos reales? | **Sí** con cuentas de prueba (una vendedora y una compradora del mismo país, hasta 15 por aplicación) y tarjetas de prueba (el titular `APRO` aprueba). | [D] |
| ¿Se ve el e-mail al suscriptor con cuentas de prueba? | **Probablemente no** (la doc no dice que tengan bandeja real): se cubre con la Fase B o con una consulta a MP. | [?] |

### 1.2 Qué quedó preparado (no ejecutado)
- **Spike de la Fase A** (sin cargos reales, costo $0): script `scripts/mp-spike/price-change-spike.mjs` con `whoami | create | inspect | put-amount | cancel`. Todo es dry-run salvo `--execute`; exige un token de **cuenta de prueba** cuyo User ID coincida exactamente con `MP_SPIKE_EXPECTED_USER_ID`; se niega a correr con el token de producción o en `VERCEL_ENV=production`; solo opera sobre suscripciones que él mismo creó (`external_reference` con prefijo `stampa_spike_`); sin Supabase; solo frecuencia en días. **11 tests con un `fetch` falso** (`tests/mp-spike.test.mjs`) lo verifican; esos tests **no prueban Mercado Pago**, solo las protecciones.
- **Runbook** con el procedimiento día por día, la matriz «pregunta → cómo se responde», el criterio de decisión Modo A/B, la **Fase B** (operación real mínima, **no autorizada**, con alcance/costo/procedimiento) y las preguntas para el soporte de MP.
- Lo que **bloquea** la validación y necesita algo de tu parte: crear las cuentas de prueba, pasar el token de prueba (en tu PowerShell, nunca en el chat) y su User ID.

### 1.3 Resultado
**La validación de Mercado Pago NO está completa.** Es viable que el `PUT` funcione, pero ninguna de las cinco preguntas críticas (cuándo aplica, reautorización, notificación, ausencia de efecto anticipado, tope) tiene respuesta documentada. **Recomendación: no autorizar la implementación del cobro hasta tener el resultado de la Fase A** (y de la B o una respuesta de MP para el e-mail).

---

## 2. Sistema fundador heredado: qué reutilizar y qué reemplazar

### 2.1 Hallazgos [C]
- Historial: nació el 2026-08-15 (commit `0ca1b5d`, «Beta Fundadores Referidos 2»). En ese commit el checkout llamaba a `reserve_founder_slot` y guardaba `founder_number`/`founder_tier` en `subscriptions.raw_data`; el checkout posterior (`checkout_attempts`) ya no lo llama. Hoy `src/lib/founder-pricing.ts` **no se importa** y `saveSubscription` **sobrescribe `raw_data`** con lo que devuelve MP.
- **Esquema no versionado:** `founder_members`, `founder_pricing_tiers` y la RPC `reserve_founder_slot` no están en `supabase/migrations` (RIESGO-03 de `QA_REPORT.md`). Forma **inferida del código**: `founder_members(id, user_id, founder_number, price, currency, status reserved|active|expired, reservation_expires_at, confirmed_at, mercado_pago_preapproval_id)`; `founder_pricing_tiers(starts_at_number, ends_at_number, monthly_price, currency, is_active, sort_order, nombre)`. Constraints, RLS, policies y el cuerpo de la RPC: **[?] solo visibles en la base** → diagnóstico M0.
- Quién lo usa hoy: `/perfil` (lee `founder_members` desde el navegador: badge «Fundador #N» y el indicador «Estado fundador visible»), `activateFounderOverrideAdmin` en `/admin/usuarios` (crea fundadores **sin pasar por pago**; el único límite es que exista un tramo de precio para el número siguiente, no una capacidad) y `onSubscriptionAuthorized` (convierte reservas pendientes en `active` al autorizar la tarjeta).
- Semántica heredada vs. la que necesitamos:

| Aspecto | Heredado | Fundadores (necesario) |
|---|---|---|
| Precio | Por tramo de número de fundador, permanente | Fijo, **N ciclos** y luego regular |
| Confirmación | Al **autorizar** la tarjeta | Al **primer cobro aprobado** (D044) |
| Reserva | `reservation_expires_at`, vencimiento sin cancelar en MP | Vencimiento que **cancela antes en MP** (cierra el hueco del pago tardío) |
| Ciclos y paso al regular | No existe | Contador derivado de cobros aprobados + paso verificado |
| Aceptación de términos | No existe | Versionada por persona |
| Override de admin | Crea fundadores sin cupo | Debe consumir cupo y quedar auditado |

### 2.2 Decisión (confirmada con el resultado de M0, ver §2.3)
**Reutilizar los datos y la identidad; reemplazar la lógica.** Evita tablas nuevas y la duplicación del badge/lista:

| Pieza heredada | Decisión |
|---|---|
| `founder_pricing_tiers` | **Reutilizar** como configuración de la edición: una fila 1–20, $9.900, ARS. Se le agregan `price_cycles`, `terms_version` y `early_access_features`. Capacidad = `ends_at_number − starts_at_number + 1`. No hace falta una tabla `founder_editions`. |
| `founder_members` | **Reutilizar** como libro de lugares (una fila por persona). Se le agregan las columnas de §4.1. El badge de `/perfil` sigue funcionando sin cambios. Se mantienen los estados `reserved | active | expired` (la «liberación» es `expired` + `release_reason`) para no chocar con un `CHECK` desconocido. |
| `reserve_founder_slot` + `src/lib/founder-pricing.ts` | **Reemplazar** (código muerto, semántica incompatible, no versionada). Se crean funciones nuevas con otro nombre; la vieja queda sin uso y se le revoca el `EXECUTE` en una etapa posterior. |
| Bloque «fundador» de `onSubscriptionAuthorized` | **Reemplazar** por la sincronización basada en cobros aprobados (§4.4). |
| `activateFounderOverrideAdmin` | **Adaptar**: un lugar manual consume cupo, respeta la capacidad y deja `release_reason`/nota de auditoría. |

**Plan B (si M0 muestra incompatibilidad):** p. ej. `UNIQUE(founder_number)` incondicional + `NOT NULL` (un lugar liberado no podría reasignarse), `UNIQUE(user_id)` que impide que alguien libere y vuelva, o policies de escritura para `authenticated`. Entonces se crea **una sola tabla** nueva `founder_seats` (mismas columnas), `founder_members` queda como histórico de solo lectura y el badge lee de la nueva. Sigue sin haber tabla de ediciones.

M0 es el archivo `supabase/diagnostics/20261110_founders_legacy_state.sql`: **un solo SELECT de solo lectura** (estructura, constraints, índices, RLS, policies, triggers, cuerpo de las dos funciones, conteos agregados; sin datos personales).

### 2.3 Resultado de M0 (ejecutado por el usuario el 2026-11-10; solo lectura)
Se corrió sin errores. Hallazgos [C] (datos reales de la base):

| Hallazgo | Consecuencia |
|---|---|
| `reserve_founder_slot` **no existe** en la base | La RPC heredada nunca se aplicó o se borró: no hay nada que revocar ni reemplazar a nivel de base. `src/lib/founder-pricing.ts` sigue siendo código muerto. |
| `founder_members` (13 columnas) y `founder_pricing_tiers` existen con la forma inferida; ambas con RLS activada, `anon` sin DML | Plan A viable. Ya existe `status` con `CHECK (reserved\|active\|cancelled\|expired)` (hay un `cancelled` que no usábamos) y `founder_number` con `CHECK > 0`. |
| `founder_members_number_unique_idx` **parcial** `(founder_number) where status in ('reserved','active')` | Ya es el índice que habíamos propuesto: un lugar liberado se puede reasignar. Nada que cambiar. |
| `founder_members_user_unique_idx` **incondicional** `UNIQUE (user_id)` | **Choca con el diseño**: una persona cuyo lugar se libera (`expired`/`cancelled`) no podría volver a reservar. M1 debe reemplazarlo por un índice único **parcial** `(user_id) where status in ('reserved','active')` (`drop index` + `create unique index`; 3 filas, riesgo bajo). Es la única incompatibilidad estructural. |
| Policies: admin `ALL`; «cada persona ve su fila»; tiers activos visibles a cualquier autenticado | La policy select-own ya existe. Las policies no impiden el diseño. |
| Grants: `authenticated` con DML completo; **`anon` y `service_role` solo con `REFERENCES/TRIGGER/TRUNCATE`** | **A verificar** (diagnóstico adicional de una línea con `has_table_privilege`): si `service_role` realmente no tiene `SELECT/INSERT/UPDATE`, el bloque fundador de `onSubscriptionAuthorized` (que usa el cliente admin y está en `try/catch`) falla en silencio hoy, y las funciones nuevas deben conceder `EXECUTE` a `service_role` explícitamente. Se resuelve en M1 con `grant` explícitos; no cambia el plan. |
| **3 filas `active`**, números 1–3, sin `mercado_pago_preapproval_id` | Son lugares **sin pago** (alta manual vía `activateFounderOverrideAdmin`). Hoy ocuparían 3 de 20 lugares y, con el acceso anticipado derivado del lugar, darían esa ventaja a personas que no pagaron. **Decisión D-12.** No se tocaron. |
| `founder_pricing_tiers`: 2 filas activas, «Primeros 25 fundadores» (1–25, $9.900) y «Fundadores 26 al 50» (26–50, $14.900) | No coinciden con la oferta aprobada (20 lugares, $9.900 × 6 ciclos). Hoy, el override de admin cobra implícitamente esos tramos. Para reutilizar la tabla hay que **modificar estas filas** (el tramo 1–25 pasa a 1–20 y el 26–50 se desactiva): cambio de datos en M1, solo tras autorización. **Decisión D-13.** |
| `has_platform_access`: cualquier grant `active` y vigente da acceso; **no filtra por tipo** | Confirma que un grant de «acceso anticipado» daría **acceso completo** en RLS. **Descartado definitivamente.** El acceso anticipado se deriva del lugar activo (§4.5). |
| `membership_settings` = 19.900 ARS; **2 suscripciones `authorized` a $250** | Confirma el precio de lista. Esas 2 suscripciones (casi seguro de prueba) serían subidas a $19.900 por `update-price` con «Aplicar a existentes»: **no usar esa casilla hasta aplicar §3.** |

Conclusión: **se mantiene el Plan A**, con una corrección de M1 (índice por usuario), una verificación de privilegios de `service_role`, y dos decisiones sobre datos heredados (D-12, D-13).

---

## 3. Protección de las suscripciones frente a cambios generales de precio

### 3.1 El problema hoy [C]
`/api/admin/membership/update-price` con `apply_to_existing` lee **todas** las suscripciones `authorized` y hace `PUT` con el precio nuevo, **sin comparar con el monto actual de cada una**. Consecuencias: repriciaría a los fundadores (adelantando el escalón) y **ya hoy repriciaría a cualquier suscripción con descuento** (con `DISCOUNT_CODES_ENABLED` apagado el problema está latente). La UI promete «Mercado Pago actualizará el monto del próximo cobro», cosa no verificada. Cambiar solo `membership_settings.monthly_price` (sin `apply_to_existing`) **no** afecta suscripciones existentes.

### 3.2 Protección recomendada (código, sin migration ni tablas)
1. **Regla de oro:** `apply_to_existing` solo modifica una suscripción cuyo **monto actual en Mercado Pago** (se re-lee la preapproval antes de cada `PUT`) sea **igual al precio de lista anterior**. Cualquier otro (fundador, con descuento, regalo, importe histórico) se **omite** y se informa como «omitida: precio especial».
2. **Exclusión explícita de fundadores** además de la anterior: se salta toda preapproval vinculada a un `founder_members` en `reserved|active`, aunque por error su monto coincidiera.
3. El resultado y el historial (`membership_price_history`) reportan `modificadas / omitidas por precio especial / fallidas`; el texto de la UI se corrige (sin prometer el momento de aplicación hasta que el spike lo confirme).
4. El paso al precio regular de un fundador **nunca** depende del botón del admin: lo hace el servicio de §4.4 con el monto aceptado.
5. Tests: fundadora y con descuento omitidas; lista modificada; `PUT` fallido no cambia la base; relectura obligatoria antes del `PUT`.
Esta corrección es independiente del resto y útil aunque no se lance Fundadores; entra como **primera etapa tras la autorización**. Mientras tanto, conviene **no usar `apply_to_existing`** si hay suscripciones con monto distinto del de lista.

---

## 4. Arquitectura definitiva recomendada

### 4.1 Datos (una migration aditiva; sin tablas nuevas en el Plan A)
Sobre las tablas heredadas (después de M0), todo `add column if not exists`:
- `founder_pricing_tiers`: `price_cycles int` (6), `terms_version text`, `early_access_features text[] not null default '{}'`.
- `founder_members`: `checkout_attempt_id uuid`, `locked_price numeric(12,2)`, `locked_cycles int`, `accepted_regular_price numeric(12,2)`, `accepted_terms_version text`, `accepted_at timestamptz`, `first_payment_id text`, `cycles_paid int not null default 0` (monótono), `step_up_status text not null default 'not_due'` (`not_due|due|applied|failed|manual`), `step_up_target numeric(12,2)`, `step_up_applied_at timestamptz`, `step_up_error text`, `released_at timestamptz`, `release_reason text`.
- Invariantes en la base: el índice único parcial `(founder_number) where status in ('reserved','active')` **ya existe** (M0); se **reemplaza** el `UNIQUE (user_id)` incondicional por uno parcial `(user_id) where status in ('reserved','active')`. **El número de lugar se asigna al reservar** (el menor libre entre 1 y la capacidad): imposible tener 21 ocupados, aunque falle el código.
- Preflight de dependencias al estilo de las migrations de descuentos (aborta sin cambiar nada si falta una columna esperada).
- RLS: cada persona lee solo su fila; ninguna escritura para `authenticated`/`anon`; funciones `security definer` con `search_path` fijo ejecutables solo por `service_role`.
- **No se tocan:** `subscriptions`, `payments`, `profiles`, `membership_settings`, `platform_feature_flags`, `user_access_grants`, `has_platform_access`.

### 4.2 Funciones (todas idempotentes; nombres nuevos)
`founder_offer_state()` (lectura agregada: abierta, capacidad, ocupados, retenidos, disponibles, precio, ciclos — única fuente para checkout, landing, admin) · `reserve_founder_seat(user, regular_price, currency, ttl)` (elegibilidad, capacidad bajo lock, reserva reutilizable del mismo usuario) · `attach_founder_seat(user, seat, attempt)` (la base verifica que el intento lleva exactamente `locked_price`) · `sync_founder_seat(preapproval_id)` · `release_founder_seat…` · `list_expired_founder_holds()` · `mark_founder_step_up(…)`. Orden de locks fijo (usuario → configuración) para evitar deadlocks.

### 4.3 Checkout (cambio acotado en `create-subscription`)
Mismo esqueleto que descuentos: reservar → `executeCheckout` con el monto de la base → vincular. El cliente solo envía `expected_offer` y `accept_terms_version`; el monto nunca viene del cliente. Si esperaba precio fundador y el lugar ya no existe → 409 `founder_sold_out` **sin crear nada**; la UI muestra el regular y pide nueva confirmación. No se combina con códigos de descuento. `restart` y cambio de `payer_email` conservan el lugar. El `reason` que ve el pagador en MP incluye las condiciones (largo máximo **[?]**, a confirmar en el spike).
- **Reserva:** un checkout `pending` sin autorizar retiene 60 min; vencido, un job **cancela antes la preapproval en MP** (solo si MP la informa `pending`) y recién entonces libera. `authorized` sin cobro aprobado retiene hasta que MP resuelva el primer cobro (≤ ~10 días de reintentos [D]) y se libera si se cancela o se agotan los reintentos. Un pago rechazado nunca consume lugar definitivo.

### 4.4 Confirmación, ciclos y paso al precio regular
- Un hook nuevo `onPaymentsRecorded` en `syncPreapproval` (webhook, `sync-subscription` y cron pasan todos por ahí [C]) llama a `sync_founder_seat`: primer cobro aprobado → `active`; `cycles_paid = greatest(cycles_paid, cobros aprobados distintos cuyo monto ≈ locked_price)` (no cuenta un eventual cobro de validación de tarjeta **[?]**); al llegar a 6 → `step_up_status = 'due'`. Todo se deriva de `payments`: **un webhook repetido no cambia nada**.
- **Paso al regular (Modo A, si el spike lo valida):** servicio idempotente: re-leer la preapproval (debe estar `authorized` y con el monto fundador y **sin cuota en reintento**) → `PUT` del monto objetivo → re-leer y verificar monto y estado → `applied`. Reintentos por webhook y cron diario; si faltan < 3 días para el próximo débito y no se aplicó → alerta y **se mantiene el precio fundador** (nunca se cobra un monto no avisado). Se verifica además el monto del 7.º cobro.
- **Modo B (si el spike lo exige):** invitación dentro de la app a autorizar una suscripción nueva a precio regular, con consentimiento explícito; rediseño acotado.
- **Cómo se evita aplicarlo antes del 7.º período:** el `PUT` solo se ejecuta con el 6.º cobro aprobado y sin cuota en reintento (el script del spike replica la condición con `--require-charged`). Que MP no altere ese cobro ni una cuota ya generada es **[?] a confirmar en la Fase A**.
- **Monto objetivo:** el regular **aceptado en la compra** como tope (`least(vigente, aceptado)`); cobrar el «vigente» sin tope exige texto legal y aviso previo (**consultar abogado**).

### 4.5 Acceso anticipado (sin tocar los feature flags)
- **Se aprovecha el sistema de permisos existente:** `resolveFeatureAccess(snapshot, id, { isAdmin })` ya recibe opciones por usuario (el bypass de admin). Se le suma una opción **opcional** `earlyAccess?: readonly FeatureId[]` (default `[]` → todos los llamadores actuales no cambian). Una funcionalidad **deshabilitada públicamente** se permite a quien la tenga en `earlyAccess`.
- **`platform_feature_flags`, `FEATURE_REGISTRY` y sus filas no se modifican.** Ninguna herramienta se habilita sola: la lista vive en `founder_pricing_tiers.early_access_features`, **vacía por defecto**; se llena solo cuando vos aprobás herramientas concretas (una a una, validadas contra los ids del registro).
- **Derivado, no un grant:** el derecho = lugar `active` + membresía vigente (se **suspende** solo si vence; no se revoca a mano). Se descarta un grant en `user_access_grants`: `has_platform_access` **no filtra por tipo de grant** (confirmado en M0, §2.3): cualquier grant activo daría acceso completo a la plataforma en RLS; un grant colgado daría acceso de base de datos a alguien que dejó de pagar. Tampoco rol admin ni grants Beta.
- **Plomería:** `UserAccessSnapshot.capabilities.earlyAccessFeatures` (se calcula en `resolveUserAccess` con una consulta extra **solo si** la persona tiene un lugar `active`) y se pasa en los ~6 puntos que hoy pasan `isAdmin` (`server.ts` ×2, `middleware.ts`, `feature-flags-provider`/`visibility.ts`, `feature-gate.ts` de Stampy, `sin-acceso`). Proxy, Server Actions, APIs, navegación, buscador y Stampy lo heredan.
- Las lecturas directas del navegador siguen gobernadas por RLS; las herramientas anticipadas que toquen pagos de terceros (Mi Negocio/Tienda online) requieren QA propio antes de listarlas.

### 4.6 Administración
`/admin/fundadores` (solo lectura al principio): capacidad, **ocupados / retenidos / disponibles** reales, tabla de lugares (n.º, estado, `cycles_paid/6`, `step_up_status`, monto en MP vs. esperado), y acciones auditadas (liberar una retención cancelando antes en MP; reintentar el paso al regular). La edición de precio/ciclos/capacidad se bloquea con lugares existentes.

### 4.7 Landing `/landing-preview`, `/sin-acceso` y Perfil
- Fuente única: `founder_offer_state()` + `membership_settings`. Ningún precio, cupo ni contador en `commercial-content.ts`.
- La oferta se muestra solo si `FOUNDERS_EDITION_ENABLED` (interruptor de servidor, **apagado por defecto**) **y** hay lugares reales; el interruptor se enciende solo cuando el checkout ya respeta la oferta. Cualquier error, edición cerrada o 0 lugares → **Premium regular exactamente como hoy**.
- Con lugares, la oferta fundadora es la protagonista (banda de precio, bloque Premium móvil y CTA final): $9.900/mes durante 6 meses, luego $19.900/mes, 20 primeros miembros pagos, acceso anticipado.
- Frescura: ISR de 60 s + consulta cliente a un endpoint público de solo agregados (caché de ~15–30 s) que **degrada a regular** al agotarse; la confirmación final la da `/sin-acceso` antes de pagar. Casilla de aceptación versionada.

---

## 5. Migraciones realmente necesarias

| # | Qué | Riesgo | Cuándo |
|---|---|---|---|
| **M0** | `supabase/diagnostics/20261110_founders_legacy_state.sql` (solo lectura) | Ninguno | **Ahora**, lo corrés vos |
| **M1** | **Una** migration aditiva (§4.1): columnas en `founder_pricing_tiers` y `founder_members`, **reemplazo** del `UNIQUE (user_id)` por uno parcial, ajuste de los 2 tramos heredados (D-13), `grant` explícitos para `service_role`, funciones (la policy select-own ya existe). **Sin tablas nuevas** (Plan A). Plan B: una tabla `founder_seats`. | Bajo–medio (toca tablas no versionadas: por eso M0 primero y preflight que aborta) | Tras autorización |
| — | **No** hace falta: tabla de ediciones, tabla de eventos, cambios en `platform_feature_flags`, en `user_access_grants`, en `subscriptions`/`payments`/`profiles` ni en `has_platform_access`. | — | — |

Cambios de código (sin migration): protección de `update-price` (§3), hook `onPaymentsRecorded`, `create-subscription`, servicio de paso al regular + job de vencimientos (extiende `/api/mercadopago/reconcile`), `earlyAccess` (§4.5), `/admin/fundadores`, `/sin-acceso`, landing, Perfil.

---

## 6. Riesgos pendientes

| # | Riesgo | Estado / mitigación |
|---|---|---|
| R1 | **El `PUT` no se acepta, exige reautorización o no aplica como se espera** | **Abierto.** Spike Fase A (+B/consulta a MP). Modo B como alternativa. Sin resultado no se implementa el cobro. |
| R2 | Consentimiento y legalidad del escalón y de la oferta (defensa del consumidor, información clara y previa) | Abierto. Texto aprobado por abogado, versionado y guardado por persona; `reason` de MP con condiciones; aviso en la app. No es asesoramiento legal. |
| R3 | Esquema fundador heredado desconocido (RLS, constraints, datos) | **Reducido por M0 (§2.3)**: Plan A viable. Quedan: reemplazar `UNIQUE (user_id)`, verificar privilegios de `service_role`, D-12 y D-13. |
| R4 | Sobreventa por compras simultáneas | Resuelto por diseño (índice único parcial + lock) y probado con tests de concurrencia (20+ paralelas). |
| R5 | Lugares trabados por checkouts abandonados / pago tardío con lugar liberado | TTL 60 min + cancelar en MP antes de liberar; caso residual honrado y marcado `over_limit`. |
| R6 | Cuota 7 ya generada con el monto viejo [?] | Falla segura hacia el monto menor; verificación del cobro 7; alerta. |
| R7 | Contar un cobro de validación de tarjeta como ciclo [?] | Contar solo cobros aprobados ≈ `locked_price`; confirmar en el spike. |
| R8 | `update-price` reprecia fundadores y suscripciones con descuento | Corrección de §3 (primera etapa). |
| R9 | No hay e-mail transaccional propio | Aviso en la app + aviso de MP; e-mail propio solo si lo aprobás. |
| R10 | Sin Supabase de prueba reproducible (tablas base no versionadas) | Conocido (RIESGO-03). Las pruebas de la base se hacen con diagnósticos y tests contra funciones; QA con usuarios de prueba de MP. |
| R11 | Un solo cron diario en Vercel | El webhook es el disparador principal; el paso al regular tiene ~30 días de margen. |
| R12 | Bloqueantes de lanzamiento público: textos legales de la oferta y baja de servicio (D045) | Independientes de este diseño. |
| R13 | Abuso (varias cuentas / mismo pagador) | Un lugar por usuario; evaluar por cuenta de MP en una fase posterior. |

---

## 7. Decisiones aún abiertas (con recomendación)

| # | Decisión | Recomendación |
|---|---|---|
| D-1 | Cuándo se ocupa un lugar | Primer cobro aprobado (retenido mientras tanto) |
| D-2 | Precio desde el ciclo 7 | Regular **aceptado en la compra** como tope (consultar abogado antes de cobrar «el vigente») |
| D-3 | Combinación con descuentos | No se combina |
| D-4 | Elegibilidad | Solo personas sin cobros previos; un lugar por usuario |
| D-5 | Duración del acceso anticipado | Mientras el lugar esté activo y la membresía vigente |
| D-6 | Cancelación antes del ciclo 6 | El lugar queda consumido |
| D-7 | Retención | 60 min sin autorizar; autorizado sin cobro hasta resolución de MP |
| D-8 | Contador público | Real, con degradación a regular |
| D-9 | `reason` de MP con condiciones | Sí (verificar largo en el spike) |
| D-10 | Herramientas anticipadas | Ninguna hasta que las apruebes una a una |
| D-11 | Override de admin | Pasa a consumir cupo y quedar auditado |
| D-12 | Las 3 filas `active` heredadas (n.º 1–3, sin pago ni preapproval) | Decidir quiénes son. Recomendación: **no cuentan** para los 20 lugares «pagos» ni dan acceso anticipado (se distinguen por no tener cobro aprobado asociado) y se conserva su badge; o se pasan a `cancelled`. No se tocan sin tu decisión. |
| D-13 | Los 2 tramos heredados (1–25 a $9.900, 26–50 a $14.900) | Ajustar a una sola fila 1–20 a $9.900 y desactivar el tramo 26–50, en M1 y solo con autorización. Hasta entonces el override de admin sigue cobrando esos tramos. |

---

## 8. Plan de implementación por etapas

| Etapa | Alcance | Puerta |
|---|---|---|
| **0 (ahora, sin implementar)** | Vos: correr M0 (`founders_legacy_state.sql`) y crear cuentas de prueba de MP. Spike **Fase A** (§1.2, runbook). Opcional: preguntas a MP y **Fase B** si autorizás su alcance. Decidir D-2 con asesoramiento legal. | **Resultado del spike validado → autorizás la implementación** |
| 1 | Protección de `update-price` (§3) + tests. Independiente y útil de por sí. | Revisión |
| 2 | M1 + funciones + lógica pura + tests (capacidad, concurrencia 20+, idempotencia, ciclos, TTL, elegibilidad). Sin UI ni checkout. | Tests + revisión de la migration contra M0 |
| 3 | Checkout fundador tras `FOUNDERS_EDITION_ENABLED=false`; `/sin-acceso` con oferta y aceptación de términos. | Pruebas con usuarios de prueba de MP |
| 4 | Hook de cobros, servicio de paso al regular, job de vencimientos, alertas, `/admin/fundadores`. | Ciclo completo (6→7 o reducido) en entorno aislado |
| 5 | Acceso anticipado: `earlyAccess` en la resolución de flags + columna de tier, sin herramientas listadas. | QA de permisos Free / Premium / Fundador / Admin |
| 6 | `/landing-preview` (oferta + fallback), Perfil/membresía, endpoint público de oferta. | Revisión visual 375/390/escritorio y fallback |
| 7 | QA final: carrera de 20+ compras, rechazos, abandonos, webhooks repetidos/desordenados, cancelación a mitad, `update-price` con fundadores, rollback. | Aprobación para encender |
| 8 | Textos legales y D045 resueltos → encender el interruptor → monitoreo diario. | — |

**Rollback:** apagar `FOUNDERS_EDITION_ENABLED` devuelve checkout y landing a los regulares sin migrar nada; los lugares ya activos siguen su curso (el paso al regular continúa por el servicio/cron).

---

## 9. Qué se hizo y qué no en esta etapa
**Se creó:** este informe, `docs/MP_PRICE_CHANGE_SPIKE.md`, `scripts/mp-spike/price-change-spike.mjs`, `tests/mp-spike.test.mjs` (11 tests, pasan) y `supabase/diagnostics/20261110_founders_legacy_state.sql`. El usuario ejecutó M0 el 2026-11-10 (solo lectura; resultado en §2.3). Commit local sin push.
**No se hizo:** ninguna llamada a Mercado Pago ni a la base por parte del agente; ningún cambio de código de la app, migrations, precios, usuarios, suscripciones, permisos, feature flags ni landing; sin push ni deploy.
