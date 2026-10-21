# QA_REPORT — Universo Stampa (sprint QA 2026-10-14)

> Primera pasada de QA: **no se corrigió ningún bug de producto**. Se agregó una suite E2E (Playwright) y esta documentación.
> Leyenda de evidencia: **E** = reproducido ejecutando la app · **C** = confirmado leyendo código/migrations (sin ejecutar) · **P** = predicción por código, a confirmar con cuenta real.
> La suite E2E vive en `tests/e2e/` (ver `tests/e2e/README.md`); la matriz feature × rol está en `docs/QA_MATRIX.md`.

## 1. Resumen ejecutivo

**Estado general: BETA CON RIESGOS** — con una salvedad que pesa más que cualquier bug: **no se pudo ejecutar nada autenticado** (no hay cuentas de test y el único Supabase conocido es el de producción), así que Free/Beta/Paid/Admin se auditaron por código, migrations y tests con *route-interception*, no por navegación real. Lo anónimo sí se ejecutó a fondo.

| | |
|---|---|
| P0 | **1 confirmado** (QA-001: el deployment `stampa3-d-academy-beta.vercel.app` responde `402 DEPLOYMENT_DISABLED`; hay que confirmar que esa es la URL de la beta) + **1 riesgo potencial** pendiente de verificar (RIESGO-01, RLS de `profiles`) |
| P1 | 0 confirmados · 2 riesgos que podrían serlo (RIESGO-02/03) |
| P2 | 6 (QA-009, 010, 014, 016, 019, 022) |
| P3 | 21 (tabla §4.3) |
| E2E | 1620 escenarios definidos (desktop + mobile); **318 ejecutados y verdes** (de ellos 31 son *bugs conocidos* que el test confirma como `expected failure`), **1302 omitidos** por falta de credenciales (todos los de Free/Beta/Paid/Admin), **0 fallas** |
| Unit (`node --test`) | 1474 tests · 1471 ok · **1 falla preexistente** (`stampy-product-stock-tools`, mock sin `@/lib/filaments/utils`) · 2 skipped |
| `tsc --noEmit` / `next build` / `git diff --check` | OK / OK / OK |

Lo bueno que se verificó: default-deny de middleware sólido (58 rutas × anónimo, todas se comportan según la matriz), `authenticated != paid` respetado en middleware, rutas, APIs y server actions; los 33 server actions de Mi Negocio pasan por `authorizeBusinessAccess` y filtran por `user_id`; los `SECURITY DEFINER` revocan `public/anon` (solo `get_public_*` tienen `anon`, por diseño); Venta rápida es idempotente y a prueba de doble clic; Explorar Modelos degrada bien cuando el provider falla; Calculadora Anonymous/Free no crea stock físico y sus invariantes numéricos se cumplen.

## 2. Entorno, método y límites

* **Entorno usado:** `next start` local (build de producción de este repo) en `http://localhost:3100`, con `.env.local`. Ese archivo apunta a **un único proyecto Supabase remoto** (el mismo de la beta) → se trató como **producción**: solo requests de lectura, sin registrar usuarios, sin webhooks/checkouts, sin SQL remoto, sin tocar datos. El único write real fue un `signInWithPassword` con email inexistente (Supabase lo rechaza).
* No existe staging/preview accesible: `NEXT_PUBLIC_APP_URL` (`stampa3-d-academy-beta.vercel.app`) está caído (QA-001).
* **Sin credenciales E2E** → los tests por rol están escritos y *skipped con motivo*. Los flujos mutantes además exigen `E2E_ALLOW_MUTATIONS=1` + Supabase descartable.
* Explorar Modelos: el servidor local arranca con una clave de provider **falsa**; los resultados son mocks y la API real solo se llama con esa clave (responde `403` del provider → se verificó que degrada).
* Ejecutado en Chrome estable (canal `chrome`), viewports 320/360/375/390/412/430 y 1280/1440.

Cómo se encontró cada cosa: (1) lectura del canon y del código real; (2) inventario de rutas/APIs/RPCs/acciones; (3) escaneo estático de migrations (RLS, grants, funciones); (4) exploración con navegador (anónimo) en 8 anchos; (5) axe-core para contraste/nombres; (6) suite E2E.

## 3. Inventario real de superficie (resumen)

* **Rutas con página: 85** (`src/app/**/page.tsx`) + 17 route handlers + 16 módulos de server actions + 42 RPCs usadas por la app + 36 migrations (75 archivos de test unitario).
* **Públicas por middleware:** `/landing*`, `/calculadora`, `/explorar-modelos`, `/tienda*`, auth (`/login`, `/registro`, `/recuperar-password`, `/actualizar-password`, `/auth/*`, `/verificar-email`), `/sin-acceso`, `/pago/estado`, APIs `calculator/*`, `model-search`, webhooks MP, `business/storefront`, cron.
* **Cuenta sin plataforma (Free):** `/calculadora`, `/perfil`, `/api/calculator/*`. **Todo lo demás exige `accessPlatform`**; `/admin/*` exige `role=admin`.
* **Rutas legacy con redirect:** `/productos`, `/stock`, `/mi-negocio/inventario`, `/configuracion?tab=taller`.
* **Admin:** 16 secciones (usuarios, cursos, roadmaps, sorteos, STL, Stampy, transcripciones, membresía, códigos, insignias, impresoras/filamentos de catálogo, calculadora).
* **Nav:** sidebar desktop (distinta para Free: ítems bloqueados → `/sin-acceso?feature=…`), barra inferior mobile de 4 destinos + menú radial de 7 herramientas; Free: 5 ítems con candados.

## 4. Bugs

### 4.1 P0

#### QA-001 — Deployment de la beta caído (`402 DEPLOYMENT_DISABLED`) — **E**, requiere confirmación
* **Área/Rol/Entorno:** infraestructura · todos · `https://stampa3-d-academy-beta.vercel.app` (= `NEXT_PUBLIC_APP_URL` de `.env.local`).
* **Pasos:** `curl -i https://stampa3-d-academy-beta.vercel.app/` (y `/login`, `/api/model-search?q=dragon`).
* **Actual:** `HTTP 402 Payment Required`, `X-Vercel-Error: DEPLOYMENT_DISABLED` (2 chequeos, 2026-10-14 ~08:12 UTC). **Esperado:** 200.
* **Causa probable:** proyecto Vercel deshabilitado/pausado (billing o decisión manual) o URL obsoleta. **Archivos:** ninguno.
* **Test:** sí — `00-smoke` con `E2E_BASE_URL=<url>` falla (`status < 400`). **Acción:** Fede confirma cuál es la URL real de la beta y su estado.

### 4.2 P2

#### QA-009 — Webhook de membresías acepta requests sin firma y persiste antes de validar — **C**
* **Área:** pagos/membresía · anónimo (endpoint público) · `src/app/api/mercadopago/webhook/route.ts:28-71`.
* **Pasos (NO ejecutados: insertarían filas reales):** `POST /api/mercadopago/webhook` sin `x-signature`, cuerpo `{"type":"subscription_preapproval","data":{"id":"x"}}`.
* **Actual (por código):** inserta una fila cruda en `mercado_pago_webhook_events` *antes* de validar; la firma solo se valida `else if (signatureHeader)` → sin header no se valida aunque exista `MERCADO_PAGO_WEBHOOK_SECRET`; comparación `hmac !== v1` no es de tiempo constante; luego consulta la API de MP con el `data.id` recibido.
* **Esperado:** con secret configurado, rechazar `401` si falta o no coincide la firma, antes de persistir. **Impacto acotado:** el estado de la suscripción se lee de la API de MP (no del payload) → no se puede forjar una membresía; sí inflar la tabla y forzar consultas/re-sync.
* **Test:** no (requiere entorno descartable). El webhook de Mi Negocio (`business/mercadopago/webhook`) sí usa `validateMercadoPagoWebhookSignature` y tiene tests unitarios.

#### QA-010 — Menú radial mobile: 7 herramientas y 6 ángulos; "Configuración" queda sin posición — **C** (documentado en TASKS, sin resolver)
* **Área:** navegación mobile · Beta/Paid/Admin · `src/components/layout/mobile-radial-menu.tsx:18` (`RADIAL_ARC_ANGLES` ×6) vs `mobile-navigation.ts` (`secondaryMobileNavigation` ×7).
* **Pasos:** en mobile con acceso completo, tocar "+" y mirar el 7.º ítem. **Actual:** `--radial-angle: undefineddeg` → posición inválida (superpuesto o fuera). **Esperado:** 7 ítems visibles y tocables.
* **Impacto:** Configuración (y por extensión cuenta/negocio/perfil de empresa) puede no ser alcanzable desde mobile. **Test:** sí, `03-navigation` › QA-010 (necesita cuenta).

#### QA-014 — Editores de Mi Taller/Admin: guardado fallido cierra el editor; sin guarda de doble submit; sin validación; errores crudos — **C** (+P para el doble submit)
* **Área:** Mi Taller (impresoras, filamentos, tipos de producto) y Admin catálogo · Paid/Admin · `printers-manager.tsx:118`, `filaments-manager.tsx:72`, `product-types-manager.tsx:72`, `admin/calculadora/page.tsx:80`, `admin/calculadora/filamentos/page.tsx:101`.
* **Causa:** `handleSave` hace `if (!error) setEditingId(null)` leyendo el **estado** `error` (valor del render anterior), no el error de la request recién ejecutada.
* **Actual:** (a) si el primer guardado falla, el editor **se cierra** y se pierde lo escrito; tras un fallo previo, un guardado exitoso **no cierra** el editor (parece que no pasó nada → el usuario reintenta → duplicados). (b) El botón Guardar no se deshabilita mientras guarda: doble clic = dos `INSERT` (**P**). (c) No valida nombre vacío ni negativos (el input `number` no tiene `min`) (**P**). (d) Muestra `error.message` de Postgres tal cual. **Esperado:** editor abierto con los datos tras un fallo, botón bloqueado en vuelo, validación y mensajes en español.
* **Test:** sí — `11-mi-taller` (QA-014/014c con INSERT interceptado: no escribe; doble submit y validaciones en la variante mutante).

#### QA-016 — Admin → Usuarios cambia rol/membresía sin confirmación y sin protección al propio usuario — **C**
* **Área:** Admin · `src/components/admin/users-table.tsx:252-263` (`onChange` → `handleUpdate` → `profiles.update`).
* **Actual:** seleccionar "Admin"/"Active" en el `<select>` escribe de inmediato; un admin puede degradarse a sí mismo; el `role` "instructor" (existe en el tipo) no está en las opciones → se muestra como "Member". **Esperado:** confirmación (diálogo propio) para cambios de privilegio/membresía, y bloqueo de auto-degradación.
* **Test:** sí — `14-admin` › QA-016 (intercepta el PATCH: no escribe). Necesita cuenta admin.

#### QA-019 — Ficha de cliente: "Saldo pendiente" y "Total comprado" se calculan sobre filas truncadas — **C**
* **Área:** Mi Negocio → Clientes · Paid/Beta · `src/app/mi-negocio/actions.ts:1312` (`.limit(100)` ventas), `:1319` (`.limit(200)` movimientos), `:1350` (`balance = suma de esos 200`).
* **Pasos:** cliente con >200 movimientos de cuenta corriente (≈100 ventas a crédito + cobros). **Actual:** el diálogo muestra un saldo que no coincide con el del listado (que viene de `get_business_clients_overview`, agregado en SQL); "Registrar cobro" se deshabilita o limita con un saldo erróneo; "Total comprado" suma solo 100 ventas. **Esperado:** saldo = suma completa (RPC/aggregate), igual en listado, ficha y ticket (`:1541` tampoco pagina; PostgREST corta en 1000).
* **Test:** no (requiere ≥200 movimientos sembrados). Candidato a test de DB en entorno descartable.

#### QA-022 — Ventas: historial limitado a las 50 últimas, sin paginación ni búsqueda — **C**
* **Área:** Mi Negocio → Ventas · `actions.ts:959` (`.limit(50)`).
* **Actual:** ventas más antiguas no se pueden ver, imprimir ni anular desde la UI. **Esperado:** paginación/filtros por fecha/cliente. **Test:** no.

### 4.3 P3 y menores

| ID | Título | Ev. | Dónde / cómo reproducir | Test |
|---|---|---|---|---|
| QA-002 | Un 404 en ruta pública (p. ej. `/tienda`) renderiza el **shell de miembros** a anónimos y lanza React #418 (hidratación) | E | `/tienda` sin sesión (declarada pública en `middleware.ts:57-58` pero sin `page.tsx`); `main-layout.tsx` decide shell por `usePathname`, que en not-found es `null` en el server | `03-navigation` › QA-002 |
| QA-003 | `/sin-acceso` sin sesión: 401 de `membership_settings` en consola y copy "Tu cuenta está lista / Actualizar acceso / Cerrar sesión" sin ninguna acción de login | E | `/sin-acceso` anónimo; `sin-acceso-client.tsx:62-66` | allowlist `known-issues` + `01-access-matrix` |
| QA-004 | `/pago/estado` (pública) sin sesión: 401 de `/api/mercadopago/sync-subscription` y pantalla "Error de verificación · Unauthorized" | E | `/pago/estado` anónimo | allowlist + matriz |
| QA-005 | Errores de auth crudos y en inglés: login "Invalid login credentials"; red caída "Failed to fetch" (login y registro); `actualizar-password` sin sesión "Auth session missing!"; el mensaje amigable de conexión de `registro/page.tsx:84` es código muerto (supabase-js devuelve `{error}`, no lanza); `/login?error=auth-callback-failed` se ignora | E | `02-auth`, `06-network-failures` | sí (QA-005/b/c/d) |
| QA-006 | Calculadora sin tope: 999.999.999 g → "$59.905.400.300,25" | E | `/calculadora` | sí |
| QA-007 | El middleware redirige a `/login` sin `returnTo` → se pierde el deep link tras iniciar sesión | E | `/mi-negocio/ventas` anónimo; `middleware.ts:99-101` | sí |
| QA-008 | `/tienda/<slug-inexistente>` responde **200** con UI de 404 (soft-404) | E | `curl -I /tienda/zzz` | sí |
| QA-011 | Inputs de la calculadora con fuente < 16 px (zoom automático en iOS Safari al enfocar) | E | `/calculadora` a 375 px; `NumberField` usa `text-sm` | sí |
| QA-012 | Las rutas `/api/*` privadas devuelven 307→`/login` a anónimos en vez de 401 (el `fetch` del cliente parsea HTML de login como JSON) | E | `POST /api/stl/download` sin sesión | sí |
| QA-013 | Sin cabeceras de seguridad (X-Frame-Options/CSP frame-ancestors, nosniff, Referrer-Policy) | E | `next.config.ts` sin `headers()` | sí |
| QA-015 | Venta rápida: un producto sin stock se muestra como "No encontramos productos disponibles" (no distingue "agotado") | C | `venta-rapida/page.tsx:101` filtra `availableStock > 0` | sí (necesita cuenta) |
| QA-017 | Admin → Usuarios: "meses activos" escribe en la DB **en cada tecla** | C | `users-table.tsx:307-308` | sí (PATCH interceptado) |
| QA-018 | Botones de solo ícono sin nombre accesible: enviar de Stampy, +/− del carrito de Venta rápida | C | `stampy/page.tsx:393`, `venta-rapida/page.tsx:305` | sí (Stampy) |
| QA-020 | **Contraste insuficiente**: texto blanco sobre el naranja de marca `#ff780a` = **2,64:1** en todos los CTA primarios (AA exige 4,5:1); grises 500/600 sobre fondo oscuro 2,1–3,7:1 (calculadora 19 nodos, landing 27, registro 3, explorar 1) | E | axe-core en `/login`, `/registro`, `/calculadora`, `/landing`, … | sí (`09-accessibility`) |
| QA-021 | `/registro`: el botón mostrar/ocultar contraseña no tiene nombre accesible (en `/login` sí) | E | axe `button-name` crítico | sí |
| QA-023 | El ticket muestra el nombre de **Mi Tienda** (`business_storefronts.name`) o "Mi Negocio", ignorando `profiles.company_name` configurado en Configuración → Negocio | C | `actions.ts:1541` | no |
| QA-024 | Perfil rotula "🧪 Beta Tester" a cualquier grant (`manual_free_access`, `internal_tester`) y usa `.limit(1)` sobre grants activos: si el primero está vencido oculta otro vigente | C | `perfil/page.tsx:70-82,181` | parcial (`15-…`) |
| QA-025 | `console.log` de datos del checkout de Mercado Pago en el cliente (`[MP frontend] data`) y otros 20 `console.log` en `src/` | C | `sin-acceso-client.tsx:133,153-154` | no |
| QA-026 | La descarga STL registra `stl_downloads` **antes** de que `/api/stl/download` valide acceso (cuenta descargas fallidas) | C | `StlDownloadButton.tsx:37` | no |
| QA-027 | Enlaces sociales/Canales con slug `extruye` (WhatsApp `chat.whatsapp.com/extruye` no tiene formato de invitación real) | C | `canales/page.tsx:17`, `social-view.tsx`, `landing-content.ts` | no (externo, no verificable) |
| QA-028 | Precio de membresía: fallback hardcodeado `19900` en el cliente vs `MEMBERSHIP_MONTHLY_PRICE=15000` del `.env.example` si falla la consulta | C | `sin-acceso-client.tsx:71,74` | no |

**P4 / observaciones:** diálogo de anular venta usa `<select>` nativo y "Otro" no pide detalle (D016); `archiveBusinessClientAction` no tiene UI (no se puede archivar clientes); `/actualizar-password` usa fondo claro con tarjeta oscura (inconsistente con login); listas de catálogo/clientes cargan todo sin paginar (tope PostgREST 1000 filas); `/pago/estado`, `/tienda` y `/landing-old` no figuran en la navegación; el formulario de Impresoras usa `<label>` sin `htmlFor` (los inputs no quedan asociados).

## 5. Riesgos pendientes de verificar (no se pudo comprobar sin DB de test)

| ID | Riesgo | Por qué importa | Cómo verificarlo |
|---|---|---|---|
| **RIESGO-01** (potencial **P0**) | **RLS/trigger de `profiles`** no está en el repo. La app hace `supabase.from("profiles").update(...)` desde el navegador para el propio usuario (`account-manager`, `business-manager`, `onboarding`) y para otros (Admin). Si no hay trigger o `GRANT` por columna que bloquee `role`, `membership_status`, `membership_expires_at`, `member_level`, `active_months`, un usuario autenticado podría **auto-promoverse a admin/paid** con un `PATCH` a `/rest/v1/profiles` | Es el único punto donde `authenticated` podría volverse `paid`/`admin` | Correr `supabase/diagnostics/20261014_qa_rls_audit.sql` (solo lectura) secciones B/C/D. No se intentó explotar. |
| **RIESGO-02** (P1 si falla) | **Mutaciones premium directas desde el cliente** con `user_id` provisto por el frontend (impresoras, filamentos, productos, recetas, presupuestos, clientes, ajustes de calculadora; 40+ `insert/update/delete` en `src/`). Contradice AGENTS §4 ("no confiar en `user_id` del frontend"). La barrera real es RLS `WITH CHECK (user_id = auth.uid() AND has_platform_access)` | Fuga/escritura cruzada entre usuarios (IDOR) y acceso Free a tablas premium si falta algún `has_platform_access` | Sección B del SQL; test de aislamiento A↔B en DB descartable |
| **RIESGO-03** (P1 si falla) | **~50 tablas y 6 RPCs usadas por la app no están versionadas** (`profiles`, `user_access_grants`, `products`, `filaments`, `printers`, `stl_*`, `courses`, `lessons`, `subscriptions`, `payments`, `invite_codes`, `budgets`, `clients`; RPCs `adjust_product_stock`, `adjust_component_stock`, `adjust_filament_stock`, `assemble_product_from_components`, `ensure_default_calculator_product_types`, `reserve_founder_slot`) → drift: RLS no auditable, entorno de test no reproducible | Imposible garantizar RLS por revisión; no se puede levantar un Supabase de test desde el repo | Versionar el schema base (decisión de arquitectura: no se hizo acá) |
| RIESGO-04 (P2) | Migrations posiblemente **sin aplicar en remoto** (`20260918120000` clientes/cuenta corriente, `20261005120000` Beta, `20261011120000` preview 360°; docs ya lo marcan). Con el código nuevo y la DB vieja, `confirm_business_sale(..., p_payments)` y el canje Beta fallan | Venta rápida/Beta rotas en un entorno con DB desfasada | Sección H del SQL vs `supabase/migrations` |
| RIESGO-05 (P3) | `authenticated` tiene `SELECT/INSERT/UPDATE/DELETE` de tabla sobre `business_catalog_items` (`20260907172205:189`): por REST se puede editar `resale_stock_quantity` sin `business_inventory_movements` (el trigger solo sincroniza ubicaciones) o borrar físicamente un artículo. Solo sobre filas propias | Auditoría de stock evitable; choca con "no hard-delete" | Revisar grants; mover escrituras a RPC |
| RIESGO-06 (P3) | Canje legacy de `invite_codes` en `/auth/callback` (códigos en claro, `used_count` no atómico, `user_access_grants.notes` con el código) — deuda ya documentada en TASKS | Superar `max_uses`; el código visible en `select("*")` de Perfil | Migrar a `beta_access_codes` |
| RIESGO-07 (P3) | Rate limiters en memoria por instancia y basados en `x-forwarded-for` (Explorar Modelos; fingerprint de checkout) | En serverless no limitan de forma global | Limiter compartido (docs ya lo listan) |
| RIESGO-08 (config) | Variables que no están en `.env.local` y rompen funciones si faltan en Vercel: `CRON_SECRET` (el cron `/api/business/orders/expire` responde siempre 401 → las reservas de stock nunca expiran), `BUSINESS_CHECKOUT_FINGERPRINT_SECRET` (todo checkout público devuelve 500), `MERCADO_PAGO_MARKETPLACE_*`, `BUSINESS_PAYMENT_TOKEN_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | | Checklist de entorno de producción |
| Ya documentados (siguen abiertos) | Doble conteo de material en producción; `product_components` sin `has_platform_access` en RLS; columna huérfana `location_breakdown` | | TASKS.md |

## 6. Datos y consistencia (solo detección, nada reparado)

No se pudo consultar la base. Las consultas de detección están en `supabase/diagnostics/20261014_qa_rls_audit.sql` (sección I): stock negativo (productos/reventa), fabricados sin producto, barcodes duplicados por usuario, ventas completadas sin allocation ni deuda, saldos negativos por sobrepago, ventas anuladas con deuda sin `sale_reversal`, modelos STL sin variante/sin grupo/sin archivo, slugs de grupo duplicados.
Del código: el stock se valida en RPC (`confirm_business_showroom_sale` consume Showroom primero y rechaza sobre el total); `void_business_sale` es idempotente (`already_voided`) y revierte deuda con `sale_reversal`; índices únicos parciales impiden doble `sale_debt`/`sale_reversal`; el barcode único incluye archivados (documentado).

## 7. Divergencias código ↔ docs

* `/tienda` figura pública en middleware y docs, pero **no hay página** (404). 
* PRODUCT §5 describe `(base + extras) × (1 + margen)`; el motor aplica el multiplicador **solo al material** (ya señalado en ARCHITECTURE §7; sigue sin reconciliarse).
* CURRENT_STATE/ARCHITECTURE decían "48 archivos / 474 tests / sin Playwright": hoy son 75 archivos / **1474 tests** y hay suite Playwright (actualizado en este sprint).
* PRODUCT §17 pide selects propios; siguen `<select>` nativos en Admin → Usuarios y en anular venta.
* TASKS aún lista el menú radial (QA-010) y el test rojo de Stampy como pendientes: ambos confirmados.

## 8. Cobertura

Detalle por feature/rol en `docs/QA_MATRIX.md`. Resumen:
* **Ejecutado (anónimo, desktop+mobile):** smoke, 58 rutas × anónimo, auth (login/registro/recuperación/returnTo/open-redirect), calculadora Demo (invariantes, inválidos, CTA), Explorar Modelos (UI + contrato API + provider caído), seguridad de API, fallas de red (500/abort/lento/JSON inválido/doble submit), responsive 320–1440 de 8 pantallas públicas, accesibilidad (axe), enlaces.
* **Escrito, sin ejecutar (faltan cuentas):** matriz de acceso por rol, health de 28 pantallas de plataforma y 18 de admin, Mi Taller (impresoras), Mi Negocio completo (catálogo → venta → anulación → deuda → cobro), STL (visor/descarga), Admin, Academia/Perfil/Beta/expirada/revocada, Stampy, tienda pública, responsive de plataforma.
* **No automatizado todavía:** alta/edición de filamentos y productos, **Registrar producción / Ajustar inventario** (requiere seed de producto con receta + bobina), reposición Showroom↔Depósito, scanner HID/cámara, Presupuestos, Stampa Maker, onboarding, checkout de membresía/Mercado Pago, tienda con compra real, previews 360°/3MF reales (WebGL+MediaRecorder), XP, impresión térmica del ticket.

## 9. Qué necesita Fede para completar la cobertura

1. **Un Supabase de test** (o un branch de Supabase) con el schema completo (RIESGO-03) y un deploy preview apuntando a él → `E2E_BASE_URL` + `E2E_TARGET_ENV=staging`.
2. **Cuentas** en ese entorno: Free, Beta activa (grant `beta_tester` vigente), Paid (membresía activa), Admin; opcionales: Beta vencida y Beta revocada. Todas con onboarding completado salvo una cuenta Free sin onboarding. Variables en `tests/e2e/README.md`.
3. **Seed mínimo:** 1 grupo STL publicado con ≥1 modelo (STL y otro 3MF), 1 producto de taller con receta + 1 bobina con stock, 1 tienda publicada (`E2E_STORE_SLUG`), 1 código Beta de un solo uso (`E2E_BETA_CODE_VALID`).
4. Confirmar cuál es la URL real de la beta (QA-001) y correr el SQL de diagnóstico (RIESGO-01/04).
5. Para providers de Explorar Modelos reales: `MYMINIFACTORY_API_KEY` / `THINGIVERSE_ACCESS_TOKEN` en el entorno de test (hoy ninguno).

## 10. Próximos pasos — top 10 para arreglar primero

1. **QA-001** confirmar/rehabilitar el deployment de la beta.
2. **RIESGO-01** correr el diagnóstico de `profiles` (RLS/trigger/privilegios por columna) y cerrarlo antes de abrir la beta.
3. **RIESGO-04** verificar migrations aplicadas (clientes/deuda, Beta, preview 360°).
4. **RIESGO-02/03** versionar el schema base y revisar RLS de las tablas premium; evaluar mover mutaciones premium a server actions/RPC.
5. **QA-014** corregir el cierre/estado del editor de Mi Taller (`if (!error)`), bloquear doble submit y validar (5 archivos).
6. **QA-019 + QA-022** saldo de cliente y "Total comprado" con agregados completos; paginar Ventas.
7. **QA-009** validar firma del webhook de membresías antes de persistir.
8. **QA-016** confirmación para cambios de rol/membresía en Admin (y bloquear auto-degradación).
9. **QA-010** el 7.º ítem del menú radial mobile.
10. **QA-020/005/003/004** copy y contraste: color de marca para texto sobre CTA (≥ 4,5:1), mensajes de auth en español, páginas públicas sin consultas a tablas privadas.

## 11. Cómo se mantiene esto

* Los bugs conocidos están codificados como `test.fail(...)` dentro del test que asevera lo correcto: al corregirlos el test avisa y se borra esa línea.
* `known-issues.ts` solo tiene QA-003 y QA-004 (consola/red de páginas públicas); cada entrada referencia un id de este reporte.
* Qué hay que correr tras cada cambio de acceso o de Mi Negocio: `npm run build && npm run test:e2e` (anónimo siempre; autenticado cuando existan las cuentas).
