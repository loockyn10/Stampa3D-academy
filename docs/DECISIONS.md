# DECISIONS

Solo se registran decisiones vigentes o necesarias para evitar reabrir problemas ya resueltos.

## D001 — El repositorio y `/docs` son la memoria permanente

**Estado:** Accepted

El historial de chats no debe ser requisito para continuar el proyecto. Código y repo tienen prioridad factual; `/docs` conserva producto, arquitectura y decisiones.

Si código y docs difieren, señalar la contradicción antes de asumir cuál es correcto.

## D002 — Separación de dominios

**Estado:** Accepted

- Academia = aprender.
- Mi Taller = fabricar.
- Mi Negocio = vender.

Esta separación debe mantenerse aunque cambie la navegación visual.

## D003 — Producto productivo y producto comercial no son la misma entidad conceptual

**Estado:** Accepted

Mi Taller describe cómo fabricar. Mi Negocio describe qué vender.

Un artículo fabricado comercialmente referencia su producto productivo; no duplica receta, costo productivo o stock terminado.

## D004 — Fabricado y reventa son tipos comerciales distintos

**Estado:** Accepted

Fabricado deriva de Mi Taller. Reventa tiene stock/costo comercial propio y no requiere receta productiva.

## D005 — El stock terminado no se duplica

**Estado:** Accepted

Las mismas unidades fabricadas no pueden tener dos fuentes de verdad.

Registrar producción consume materiales y aumenta unidades terminadas. Ajustar inventario corrige unidades sin consumir materiales.

## D006 — Showroom y Depósito son ubicaciones del mismo stock comercial

**Estado:** Accepted

Si están habilitados:

`stock total = showroom + depósito`

Venta disponible = total. El backend consume Showroom primero y Depósito por el faltante.

No crear transferencias ficticias para vender.

## D007 — “Eliminar venta” significa anular, no hard-delete

**Estado:** Accepted

La anulación preserva auditoría, crea movimientos compensatorios, deja de contar en métricas y debe ser idempotente.

No iniciar refunds financieros implícitos para pagos online.

## D008 — La Calculadora pública reutiliza el mismo motor

**Estado:** Accepted

No mantener una fórmula Demo y otra para usuarios pagos.

Las diferencias de acceso se resuelven por configuración y datos disponibles, no duplicando el motor.

## D009 — Anonymous prueba antes de registrarse

**Estado:** Accepted

La Calculadora Demo debe entregar valor sin login. Registrarse desbloquea personalización, no toda la plataforma.

## D010 — Free no crea inventario físico

**Estado:** Accepted

Seleccionar una impresora o filamento para calcular no equivale a poseer una máquina/bobina física.

Arquitectura objetivo:

- Anonymous → template Demo.
- Free → referencias a templates para Calculadora.
- Paid → entidades físicas cuando corresponda.

## D011 — `authenticated` no equivale a `paid`

**Estado:** Accepted

El acceso premium debe validarse explícitamente. No cambiar `has_platform_access()` para tratar Free como Paid.

Rutas, RLS, RPCs y actions deben respetar esta separación.

## D012 — No debilitar RLS para resolver UX

**Estado:** Accepted

Cuando Free necesite una capacidad limitada, crear una frontera server-side o modelo específico acotado. No abrir tablas premium completas.

## D013 — Stampy: contexto no es autorización

**Estado:** Accepted

Stampy puede entender el estado de una pantalla sin obtener permisos adicionales.

Las tools de escritura deben ser explícitas, estrechas, server-authoritative y autorizadas.

## D014 — XP es server-authoritative

**Estado:** Accepted

No premiar clicks vacíos. Los límites diarios afectan XP, no el uso. Los eventos deben ser idempotentes. Referrals y XP permanecen separados.

## D015 — E-commerce desacopla vendedor, orden, venta y pago

**Estado:** Accepted

El vendedor conecta su proveedor de pagos. Orders y sales no se colapsan en una sola entidad. Webhooks son idempotentes y el aislamiento por vendedor es obligatorio.

## D016 — UI consistente y mobile-first

**Estado:** Accepted

Preferir componentes propios para dialogs/selects/popovers. Evitar controles nativos que rompan la experiencia y hacks visuales que oculten bugs estructurales.

## D017 — Metodología multiagente sin doble paso obligatorio

**Estado:** Accepted

Codex y Claude Code son agentes alternativos/complementarios.

No toda tarea debe pasar por ambos. La elección depende de:

- tipo de trabajo;
- riesgo;
- disponibilidad;
- especialización;
- créditos/tokens.

Un segundo agente se usa cuando aporta valor real.

## D018 — Los agentes no cambian arquitectura silenciosamente

**Estado:** Accepted

Si una tarea requiere modificar reglas globales, permisos, schema compartido o una decisión de producto, el agente debe detenerse o reportar la decisión antes de asumirla.

## D020 — Cuenta corriente de clientes es un ledger auditable, no un campo mutable

**Estado:** Accepted (2026-09-18)

`Clientes` pasa a ser un destino propio de Mi Negocio (antes se consideraba redundante si estaba integrado en Presupuestos). La deuda de un cliente se audita mediante `customer_account_movements` (`sale_debt`/`payment`/`sale_reversal`/`adjustment`), nunca como un número mutable en `clients`. `saldo = sum(delta)`.

Reglas fijadas:

- los pagos inmediatos de una venta (`cash`/`transfer`) se guardan como allocations (`business_sale_payment_allocations`); la deuda nunca es una allocation, se deriva como `total - sum(allocations)`;
- cliente obligatorio si la venta deja saldo pendiente, opcional si no;
- no se permite sobrepago ni en la venta ni en un cobro posterior — rechazo explícito, nunca ajuste silencioso;
- anular una venta con deuda genera un `sale_reversal` compensatorio, nunca borra el `sale_debt` original, y no puede duplicarse (índice único parcial por venta);
- se reutiliza `public.clients` (ya usada por Presupuestos); no se crea una segunda tabla de clientes.

## D019 — Trabajo simultáneo requiere aislamiento

**Estado:** Accepted

Si Codex y Claude trabajan al mismo tiempo, deben hacerlo sobre tareas independientes o en branches/worktrees separados.

Si trabajan sucesivamente sobre la misma feature, el segundo parte del código actualizado.

## D021 — Explorar Modelos es un agregador/descubridor, distinto de Librería STL

**Estado:** Accepted (2026-09-21)

`Librería STL` = contenido propio de Stampa. `Explorar Modelos` = descubrimiento de modelos externos vía APIs oficiales de cada fuente. Nunca se mezclan tablas, rutas ni UI.

- No se almacena ni redistribuye ningún archivo de terceros; no hay mirror ni catálogo local; solo cache temporal de queries (minutos).
- Atribución obligatoria: la fuente es visible en cada resultado y "Ver modelo" abre la URL original.
- Solo se integran fuentes con API oficial. Cults3D usa su GraphQL público; MyMiniFactory y Thingiverse sus APIs oficiales. MakerWorld (términos prohíben automatización), Printables (sin API pública) y Thangs no se implementan; no se usan endpoints internos ni scraping.
- Cada provider es independiente: si uno falla o no responde, el resto responde igual (resultados parciales).
- **Thingiverse:** el provider existe pero se deja **sin credencial** en producción hasta obtener respuesta de su Developer Program (los términos de la API restringen cache, comercialización y apps competidoras; ver spike). MyMiniFactory: sus guidelines piden enlazar la fuente y el creador; confirmar por mail uso en SaaS pago, cache y rate limits.

## D022 — Licencia normalizada; gratis ≠ uso comercial; resultado externo ≠ producto

**Estado:** Accepted (2026-09-21)

`commercialUse` (`allowed|prohibited|unknown`) y `attributionRequired` (`true|false|unknown`) se mapean solo desde datos explícitos de la fuente; ante duda es `unknown`. `priceType` (`free|paid|unknown`) también requiere señal explícita: `unknown` no entra en filtros Gratis/De pago. Gratis nunca implica `commercialUse = allowed`. Un resultado externo no crea productos de Mi Taller ni de Mi Negocio sin una acción explícita del usuario.

## D023 — Beta Access es independiente de Paid; un código Beta no es una suscripción

**Estado:** Accepted (2026-10-05)

`acceso a plataforma = admin OR paid OR grant activo`. El canje de un código de invitación crea/extiende un grant `beta_tester` en `user_access_grants`; nunca modifica `profiles.membership_*` ni `subscriptions`, ni hace que `authenticated` implique acceso.

- Códigos solo como digest SHA-256 (nunca plaintext en DB/repo/env/docs); validación 100 % server-side vía `redeem_beta_access_code` (identidad = `auth.uid()`, atómico con lock de fila, idempotente por `(code, user)`, con rate limit). El frontend solo envía el código tipeado.
- `redeem_until` (cuándo se puede canjear) y `access_expires_at` (cuándo vence el acceso) son independientes. `max_uses` opcional → V1 código compartido; luego códigos individuales sin rediseño.
- En UI se muestra "Beta Tester" / "Acceso Beta", nunca "Plan Premium"; no entra en billing ni métricas de clientes pagos.
- El Beta temporal no es la futura insignia permanente Cofundador/Beta Tester.
- Una migration nueva **nunca** sobrescribe lógica remota no versionada: `has_platform_access()` no se reemplaza automáticamente; la migration solo verifica compatibilidad y aborta si no puede (corrección manual y revisada aparte).
- Los códigos plaintext legacy de `invite_codes` (tipos beta/manual) quedan desaconsejados; retirarlos es deuda (ver TASKS).

> **Actualizado por D032 (2026-10-28):** el punto sobre `invite_codes` legacy cambió: el canje Beta ahora también honra los códigos Beta creados en `/admin/codigos`.

## D024 — Stampy conversa con Responses API y el historial lo administra la app

**Estado:** Accepted (2026-10-06)

- Stampy usa `openai.responses.create` (no Chat Completions) con `store: false`. El modelo es `OPENAI_MODEL` (default `gpt-5.6-terra`) con razonamiento configurable (`STAMPY_REASONING_EFFORT`, default `low`).
- La conversación multi-turn se arma con el historial de `stampy_messages` (roles nativos user/assistant), no con `previous_response_id` ni Conversations API: los turnos resueltos sin modelo (acciones, herramientas directas) también son parte de la conversación, Supabase sigue siendo la única fuente de verdad y no se retiene estado del usuario en OpenAI.
- Responder primero, derivar después: Stampy ayuda con conocimiento general y ofrece herramientas/clases de Stampa como complemento. Que el ranking no encuentre clases no implica que Academia no tenga contenido; sólo se nombran clases recuperadas por el backend.
- Si el modelo falla o no devuelve texto, se muestra un fallback explícito (no se guarda como respuesta) y se loguea server-side sin secretos.

## D025 — Librería STL: Grupo → Modelos; el viewer 3D solo vive en el detalle y respeta la autorización de la descarga

**Estado:** Accepted (2026-10-09)

- La jerarquía pública es **Grupo → Modelo STL** (un solo nivel). "Grupo" **es** `stl_categories` (ya tenía slug, descripción, portada, `sort_order`, `is_active`); `stl_models.category_id` es la relación. No existe `stl_groups` ni `group_id`: una segunda entidad duplicaría la fuente de verdad. Los modelos sin categoría se muestran en el grupo virtual "Otros modelos" (slug reservado `otros-modelos`, sin filas en DB).
- Publicación: grupo y modelo deben estar `is_active`. Un modelo activo dentro de un grupo no publicado NO es visible (no cae en "Otros modelos"). Los grupos sin modelos publicados no se listan.
- El viewer (three + `STLLoader` + `OrbitControls`, carga dinámica) se monta solo en el detalle del modelo; las cards usan thumbnail estático.
- El viewer nunca recibe paths ni buckets: pide una URL firmada de 5 min a `POST /api/stl/preview`, que aplica la misma regla que la descarga (`getCurrentUserAccess` + `capabilities.downloadStl`) y además exige modelo/grupo publicados (salvo Admin). Solo `.stl` y `.3mf` en storage (formato deducido en el servidor del archivo guardado); `.zip`, otros y URL externa → sin preview, solo descarga. Límite del viewer: 60 MB para ambos.
- Dimensiones: bounding box del STL mostrada como "unidades del archivo". STL no declara unidades; no se afirma "mm".
- No se calculan gramos/tiempo/costo desde el STL.

## D026 — Previews 360° de la Librería STL: WebM prerenderizado en el Admin, nunca un viewer por card

Las cards usan un asset de video (`stl_models.preview_url`) generado client-side en el Admin; el viewer Three.js interactivo sigue solo en el detalle (refuerza D025). Bucket público propio `stl-previews` (solo `video/webm`, escritura Admin) en lugar de reutilizar `stl-thumbnails`, cuya configuración de MIME no está versionada; `stl-files` permanece privado. Falla de generación = no destructiva (thumbnail). Sin regeneración masiva automática. Ajuste (2026-10-11): la miniatura WebP automática reutiliza `stl-thumbnails` (path `{modelId}/thumbnail.webp`; su MIME/policies no están versionadas: si el upload falla, solo se avisa) y la distinción manual/generada se infiere del path, sin columna `thumbnail_source`; el ciclo ambiental reproduce un solo video a la vez. Detalle: ARCHITECTURE §18c.

## D027 — Librería STL: 3MF multiplate de Bambu/Orca muestra Plate 1; colores se preservan solo si son interpretables

3MF con metadata reconocible de Bambu Studio/OrcaSlicer y varias plates → viewer, miniatura y WebM muestran **solo la primera cama** (por `model_settings.config`, nunca por posición). 3MF genérico o metadata incompleta → build completo. Los colores del archivo se conservan cuando son interpretables (materiales estándar; filamento configurado por pieza en Bambu/Orca) y el resto queda neutro; no se decodifica `paint_color`. Las tres superficies comparten `prepareModelForDisplay`. Sin selector de camas ni DB/migration. Detalle: ARCHITECTURE §18d.

## D028 — UX V2: dashboards de solo lectura que reutilizan las fuentes existentes

**Estado:** Accepted (2026-10-22)

- `/mi-taller` deja de redirigir a Impresoras: muestra un Dashboard. Orden de pestañas: Dashboard, Inventario, Productos, Filamentos, Impresoras. Las subrutas y deep links de Stampy no cambian.
- Los dashboards de Inicio, Mi Taller y Mi Negocio **no escriben datos** y no crean consultas paralelas: Mi Taller usa `loadWorkshopSummary` (mismas lecturas que Productos/Inventario) + `getProductPricingStatus`; Mi Negocio y el resumen comercial de Inicio usan las server actions existentes (`get_business_metrics`, ventas, pedidos). Un pedido online pendiente nunca cuenta como venta.
- Sin umbrales inventados: "productos sin stock" = activos con `stock_quantity <= 0`; las unidades armables con piezas se muestran aparte de las terminadas.
- "Actividad reciente" de Mi Taller queda **omitida**: `product_stock_movements`/`filament_stock_movements` no están versionadas y el código las lee con columnas distintas (UI: `quantity_delta`/`grams_delta`; contexto de Stampy: `quantity`/`amount`/`type`).
- Precio Mercado Libre (actualizado 2026-10-22, estabilización): la comisión se cobra sobre el precio final, así que `precio ML = (precio sugerido + cargo fijo + envío + otros costos de venta) / (1 − comisión)`, redondeado hacia arriba al centavo para que el neto nunca quede por debajo del sugerido. Comisión 0/vacía → sin estimación; comisión < 0, no numérica o ≥ 100 % → inválida (también se valida al guardar la configuración). Reemplaza la fórmula anterior (comisión sumada sobre el sugerido), que no conservaba el ingreso neto. No se asumen porcentajes oficiales.
- "Configurar valores" de la Calculadora abre un modal que reutiliza `SettingsManager`/`ProductTypesManager` y la misma escritura de `printers`; no hay configuración duplicada.

## D029 — Sorteos: una sola interpretación de chances; las invitaciones no suman automáticamente

**Estado:** Accepted (2026-10-22)

- Chances = sin acceso vigente a la plataforma → no participa; con acceso → base (1, o 2 para `member_level` gold/elite) + entradas activas de `user_raffle_bonus_entries` (+ XP solo si `XP_RAFFLE_BONUSES_ENABLED=true`). Implementado una vez en `getUserRaffleChances` (`src/lib/raffles/participants.ts`) y usado por la página de Sorteos, el registro de ganadores (`assignRaffleWinner`) y el contexto de Stampy. Las chances no se almacenan: se calculan al mostrarlas y al registrar un ganador.
- Invitaciones: `/registro?ref=CÓDIGO` → `/auth/callback` inserta `referrals` (`referrer_user_id`, `referred_user_id`, `status = 'pending'`) y `profiles.referred_by_user_id`. **No existe en el repo** código ni migration que pase una invitación a `converted`/`rewarded` ni que inserte `user_raffle_bonus_entries`; las tablas `referrals` y `user_raffle_bonus_entries` tampoco están versionadas. Hasta definir ese contrato, la UI y Stampy no prometen chances por invitar o por suscripciones de referidos.

## D030 — Feature flags: disponibilidad pública por funcionalidad, administrable sin deploy

**Estado:** Accepted (2026-10-24), pendiente de aplicar la migration y de QA.

- El registro de funcionalidades vive en código (`src/lib/features/registry.ts`); la base solo guarda el estado que decide el Admin (`platform_feature_flags`). Una sola fuente: proxy, acciones, APIs, navegación, buscador y Stampy consultan el mismo módulo; no se hardcodean rutas ni ids en otro lugar.
- **Sin fila = sin configurar = habilitada** (default del registro). La migration no siembra filas: aplicarla no restringe nada. Cada herramienta se deshabilita explícitamente desde `/admin/funcionalidades`.
- **Administradores** (`profiles.role = admin` vía `getCurrentUserAccess`) conservan acceso a todo; el bypass es solo de flags. Se evalúa antes del gate de membresía: un Free ante una herramienta deshabilitada ve "no disponible", no una invitación a pagar.
- **Falla cerrada acotada:** tabla inexistente → no restringe (despliegue seguro antes de la migration); otro error de lectura → último estado conocido; sin él, los no-admin no acceden a lo controlado (administradores y rutas esenciales sí).
- **No se gatean** webhooks/callbacks/expiración de pedidos de pagos ni rutas esenciales (auth, perfil, configuración, admin, pagos de membresía). La tienda pública es una funcionalidad aparte (`tienda_online`) para no cortar ventas al deshabilitar Mi Negocio por accidente.
- No se modifican roles, membresías, RLS de otras tablas ni datos de usuarios. Las lecturas directas del navegador contra Supabase siguen gobernadas solo por RLS (ver ARCHITECTURE §21).

## D031 — Visibilidad de cursos: tres estados sobre `courses.status`

**Estado:** Accepted (2026-10-26), pendiente de aplicar la migration y de QA.

- Se reutiliza `courses.status` en lugar de una columna nueva: `published`, `coming_soon`, `hidden`. `draft` y `archived` históricos significan `hidden` en código (nunca publicado); la migration no reescribe filas.
- «Oculto» persiste el valor `hidden`; el formulario de un curso nuevo lo crea oculto.
- Defensa en capas: página/acción de servidor + policies RESTRICTIVE (solo recortan). No se reemplazan ni debilitan las policies existentes; si el schema remoto difiere, la migration aborta por dependencias o queda en no-op parcial documentado.
- «En preparación» no se enlaza ni se recomienda: no hay a dónde entrar, y Stampy/buscador/rutas solo ofrecen cursos `published`.
- El progreso se escribe desde una Server Action (sesión → feature flag → membresía → visibilidad); la RLS de `lesson_progress` cubre además el acceso directo a Supabase.

## D032 — Códigos Beta: un solo punto de canje; los descuentos todavía no se aplican en el checkout

**Estado:** Accepted (2026-10-28), pendiente de aplicar la migration `20261028120000_beta_redeem_legacy_invite_codes.sql` y de QA con cuentas reales.

- **Diagnóstico:** había dos arquitecturas sin conexión. `/admin/codigos` crea códigos en `invite_codes` (legacy, texto plano), pero el campo "¿Tenés un código de invitación?", Perfil, Sin acceso y `PendingBetaCodeRedeemer` solo llamaban `redeem_beta_access_code`, que solo conocía `beta_access_codes` (hash). Todo código creado desde el panel respondía «Código inválido». El campo "Código de referido" sí lo leía, pero solo `/auth/callback` (camino de confirmación de email); con sesión inmediata nadie lo procesaba.
- **Decisión:** `redeem_beta_access_code` es el único punto de canje. Si el código no es un código hash, busca en `invite_codes` (solo `beta_tester` / `manual_free_access`) dentro de la misma función `security definer`: identidad `auth.uid()`, fila bloqueada `FOR UPDATE`, mismo rate limit por usuario, idempotente por `(código, usuario)`, `max_uses` contra el mayor entre `used_count` y las redemptions reales, nunca acorta un acceso existente, el código en claro no se copia a `user_access_grants.notes`. Los códigos de descuento / precio fijo **nunca** otorgan acceso.
- **Se revierte parcialmente D023** (aislamiento total con `invite_codes`): no se migran ni borran datos legacy; los códigos existentes, sus usos, fechas y límites se respetan tal cual. `beta_access_codes` sigue siendo el camino recomendado para códigos nuevos.
- Para los códigos hechos a mano, la forma aceptada baja de 8 a 3–64 caracteres sin espacios (los hash siguen exigiendo 8–64). El límite de 5 intentos inválidos / 15 min por usuario sigue protegiendo la adivinanza.
- **Descuentos:** hasta 2026-10-28 se guardaban en `invite_codes` sin que ninguna ruta los aplicara (no era regresión). Se conectaron en D033.

## D033 — Descuentos en el checkout: reserva al crear, consumo al autorizar, solo "para siempre"

**Estado:** Accepted (2026-10-29), pendiente de aplicar la migration, de activar `DISCOUNT_CODES_ENABLED` y de QA con usuarios de prueba de Mercado Pago.

- Aprobado por el producto: (1) empezar solo con duración "para siempre"; el "primer mes" no está soportado porque la preapproval de Mercado Pago tiene un único monto recurrente y subirlo después no está verificado; (2) reserva de 30 minutos; (3) entra antes del lanzamiento, **apagado por defecto** tras un interruptor de servidor.
- Un uso se reserva al crear el checkout (bloquea el monto enviado a Mercado Pago), se consume cuando la suscripción queda `authorized` y se libera si el checkout falla, se cancela o se reemplaza. Un checkout abandonado no consume un uso.
- La regla de precio vive solo en la base (`discount_code_final_amount`): no se duplica pricing en la app y el cliente nunca envía un monto. No se acumula con el precio fundador (inactivo).
- Un checkout pendiente (nunca autorizado) al que se aplica un código se reemplaza cancelando antes la preapproval en Mercado Pago; si no se puede, no se cambia nada.
- No se migran ni modifican códigos, usos, fechas ni límites existentes; los códigos `once` quedan guardados pero el checkout los rechaza como no soportados hasta una decisión posterior.

## D034 — Descuentos: el asiento lo retiene el checkout abierto; el pago ya hecho nunca se rechaza

**Estado:** Accepted (2026-10-30), pendiente de aplicar `20261030120000_discount_checkout_consistency.sql` y de QA con usuarios de prueba de Mercado Pago. Corrige hallazgos de la revisión de D033.

- **Quitar el código no reutiliza el checkout con descuento:** el checkout que se entrega corresponde siempre al precio de esa compra; si el pendiente lleva otro monto se cancela en Mercado Pago y se crea uno nuevo (una sola preapproval viva, idempotente). Un subscription `authorized`/`active`/`paused` nunca se reescribe.
- **El reloj de 30 min solo vence reservas sin checkout.** Una reserva con checkout abierto conserva el asiento hasta autorizar, cancelar, reemplazar o cerrar. Por eso `max_uses` no se supera por pagos tardíos en los flujos normales.
- **Un pago válido no se pierde ni se perjudica:** si una autorización llega para una reserva que ya no retenía asiento y el código está lleno (solo por intervención manual o datos anómalos) se honra al pagador y se marca `over_limit`. Alternativa descartada: cambiar el monto de la preapproval (`PUT`) para quitarle el descuento, porque no está verificado que Mercado Pago lo acepte sin reautorización del pagador.
- **Decisiones comerciales abiertas antes de habilitar** (documentadas en `docs/DEPLOY_DISCOUNT_CODES.md` §5): checkouts abandonados que retienen asientos, qué hacer con un `over_limit`, y el reemplazo de checkouts con precio de lista viejo.


## D035 — Temas claro/oscuro: variables CSS semánticas, preferencia local y default automático

**Estado:** Accepted (2026-10-29).

- **Mecanismo:** atributo `data-theme` en `<html>` + variables CSS (`--stampa-*` y remapeo de las paletas de Tailwind) en lugar de `dark:` por clase. Con ~46 mil líneas de TSX escritas con clases neutras del tema oscuro, remapear la paleta por variable evita reescribir pantallas y garantiza que el modo oscuro sea idéntico al previo (usa los valores por defecto). Una migración mecánica llevó `text-white`, `bg-white/N`, `border-white/N`, `text-stampa-orange` y los hex de superficie a tokens; el blanco literal se conserva sobre fondos saturados.
- **Persistencia:** `localStorage` por dispositivo; no se guarda en el perfil (evita migration y cambia de dispositivo sin sincronizar). Si se quiere sincronizar entre dispositivos habría que sumar una columna de preferencia en `profiles` (decisión de producto + migration, no hecha).
- **Default:** `system` (Automático), decidido por producto el 2026-10-29: quien no eligió sigue su dispositivo. Los usuarios con SO claro verán el modo claro sin haberlo pedido, por lo que el QA manual en claro (TASKS) es prerrequisito del despliegue. Volver a oscuro por defecto es cambiar `DEFAULT_THEME_PREFERENCE` en `src/lib/theme/theme.ts`.
- **Siempre oscuros por diseño (de momento):** landing de marketing (`/landing`, `/landing-old`), tienda pública (`/tienda/*`) y los viewers 3D (Stampa Maker, visor de Librería STL). Decisión pendiente de producto si se quieren versiones claras.
- **Alternativa descartada:** librería `next-themes` (no hace falta: el script de inicialización y el provider son ~150 líneas y evitan una dependencia).
