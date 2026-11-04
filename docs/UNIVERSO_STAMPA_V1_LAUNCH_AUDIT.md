# Universo Stampa — Auditoría general prelanzamiento V1.0

> **Fecha:** 2026-11-04 · **Autor:** Claude Code (auditoría de solo lectura) · **Commit auditado:** `66e10b2` (`main`, working tree limpio)
> **Lanzamiento previsto:** 2026-11-11 (7 días).
>
> **Alcance:** investigación. No se modificó código, no se aplicaron migraciones, no se desplegó nada. Este documento es el único archivo creado.
>
> **Leyenda de evidencia**
> - **[E]** ejecutado/observado en esta auditoría (comando local, request HTTP o sonda de solo lectura).
> - **[C]** confirmado leyendo código o migraciones del repo (no ejecutado).
> - **[D]** afirmado por la documentación del repo (`docs/`), no reverificado en esta pasada.
> - **[?]** no verificable desde el repo; requiere Supabase, Vercel, Mercado Pago o una cuenta real.
>
> **Verificaciones remotas realizadas (todas de solo lectura, sin sesión de usuario):**
> 1. `GET` anónimos a `/rest/v1/<tabla>?select=<columna>&limit=0` contra el Supabase configurado en `.env.local` (el de producción/beta) para saber qué tablas/columnas existen. No se leyó ninguna fila privada.
> 2. Lectura de `platform_feature_flags` (tabla pública por diseño, `grant select to anon`).
> 3. `curl` de rutas públicas del deploy `https://stampa3-d-academy-beta.vercel.app`.
>
> No se usó la `service_role`, no se ejecutó SQL, no se llamó a Mercado Pago ni a OpenAI.

---

## 1. Resumen ejecutivo

**Estado general: producto amplio y técnicamente sólido en código, pero no validado como producto comercial.** El repositorio contiene mucho más de lo que una V1.0 necesita (≈115 mil líneas de TypeScript, 85 páginas, 46 migraciones, 120 archivos de test), con buenas prácticas visibles (default-deny en el proxy, `authenticated != paid`, RPCs atómicas e idempotentes, feature flags, tests contra Postgres real). Typecheck, build de producción y los 2.280 tests unitarios sin base de datos pasan (0 fallos); el lint tiene 416 errores, en su mayoría tipado `any`. Pero lo que define si se puede **cobrar** el 11 de noviembre no está en el código sino alrededor de él, y casi nada de eso está verificado:

1. **El único punto donde un usuario autenticado podría convertirse en Paid o Admin (`profiles`) no tiene RLS ni trigger versionados en el repo**, y la app actualiza `profiles` directamente desde el navegador. Si la base no bloquea esas columnas, cualquiera se autopromueve. Hay un SQL de diagnóstico listo desde el 14/10 que **nunca se ejecutó**. → **P0 a verificar antes de cualquier venta.**
2. **No hay base legal para vender:** términos, privacidad y condiciones de la membresía tienen `href: null` en la landing; no existe un botón de baja dentro de la app aunque la landing promete «cancelá cuando quieras». → **P0.**
3. **No hay evidencia en el repo de que el ciclo completo de la membresía (pago → acceso → renovación → cancelación → expiración) se haya probado con Mercado Pago real.** El webhook de membresías valida la firma solo si llega el header y responde 200 ante cualquier error (MP no reintenta). → **P0 (prueba) + P1 (endurecer webhook).**
4. **Nunca se probó la plataforma con sesión real en un entorno de test**: no existe staging ni cuentas de prueba; ~1.300 escenarios E2E por rol están escritos pero se omiten. Todas las verificaciones autenticadas de los últimos sprints se hicieron con arneses temporales. → **P0 de proceso: una pasada de QA manual con cuentas Free / Paid / Admin sobre el alcance V1.0.**

**Lo positivo:** el alcance de la V1.0 ya está, de hecho, recortado en producción. Las feature flags remotas tienen **apagadas** Mi Negocio (incluye Presupuestos), Tienda online, Explorar Modelos, Stampa Maker y Sorteos [E]. Lo que queda encendido —Academia, Stampy, Calculadora, Mi Taller, Librería STL, Redes/Canales— es un producto coherente y vendible si se cierran los P0.

**Drift importante:** la documentación (`CURRENT_STATE.md`, `TASKS.md`) afirma que más de diez migraciones «no están aplicadas en remoto», pero las sondas muestran que sus tablas **sí existen** (feature flags, clientes/cuenta corriente, Beta, descuentos, categorías, redes, archivos 3MF, preview 360°). Solo se confirmaron **dos** sin aplicar: `20261031090000_tool_tutorial_versions` y `20260826182313_stampy_user_memory`. La documentación de estado no es confiable para planificar el despliegue.

**Veredicto:** lanzar el 11/11 es **posible solo como lanzamiento acotado y condicionado** (alcance actual de flags, sin Mi Negocio/Maker/Sorteos/Explorar), y solo si el diagnóstico de `profiles` sale bien (o se corrige en ≤1 día), los textos legales están publicados y una compra real de punta a punta funciona. Recomiendo un **punto de decisión go/no-go el viernes 7/11**. Si cualquiera de esos tres puntos falla, mover la fecha antes que vender con el riesgo abierto.

**Prioridad inmediata (hoy):** correr `supabase/diagnostics/20261014_qa_rls_audit.sql` (solo lectura) y poner en marcha los textos legales. Son las dos dependencias más largas y ninguna requiere programar.

---

## 2. Arquitectura actual

### 2.1 Stack [C][E]

| Capa | Tecnología | Evidencia |
|---|---|---|
| Framework | Next.js **16.2.10** (App Router, Turbopack), React 19.2.4 | `package.json` |
| Lenguaje | TypeScript 5 (`strict`), Tailwind 4 | `tsconfig.json`, `postcss.config.mjs` |
| Datos / Auth | Supabase (`@supabase/ssr` 0.12, `supabase-js` 2.110): Postgres + RLS, Auth, Storage, RPCs `SECURITY DEFINER` | `src/utils/supabase/*`, `supabase/migrations` |
| Pagos | Mercado Pago: preapproval (membresía) y Marketplace OAuth (Mi Negocio/tienda) | `src/app/api/mercadopago/*`, `src/app/api/business/*` |
| IA | OpenAI Responses API (Stampy, jarros) + embeddings `text-embedding-3-small` (pgvector) | `src/lib/stampy/responses.ts`, `embeddings.ts` |
| Video | Bunny Stream (`mediadelivery.net`), Vimeo o YouTube embebidos por URL | `src/app/cursos/[id]/course-detail-client.tsx:365-420` |
| 3D | three.js, clipper-lib, earcut, opentype.js (Stampa Maker y visor STL) | `src/lib/maker` (≈28 mil líneas) |
| PDF | `@react-pdf/renderer` (presupuestos), `unpdf` (ingesta de PDFs para Stampy) | |
| Hosting | Vercel (región `gru1` observada en headers) | `curl -I` [E] |
| Tests | `node --test` (unit + DB con Postgres embebido) y Playwright (E2E) | `tests/`, `playwright.config.ts` |

**No hay:** monitoreo de errores (Sentry o similar), analítica de producto, email transaccional propio (Resend no aparece en el código), service worker (el PWA es solo manifest), cabeceras de seguridad propias. [C]

### 2.2 Control de acceso [C]

- `src/proxy.ts` → `src/utils/supabase/middleware.ts`: **default-deny**. Cada request no estática ejecuta `auth.getUser()`, lee `profiles` + `user_access_grants` (`src/lib/auth/user-access.ts`) y, si la ruta pertenece a una funcionalidad, la snapshot de feature flags.
- `src/lib/auth/access-policy.ts` es la única fuente de capacidades: `accessPlatform = admin || membresía activa no vencida || grant vigente (beta_tester / manual_free_access / internal_tester)`.
- Rutas públicas: `/landing*`, `/calculadora`, `/explorar-modelos`, `/tienda*`, auth, `/sin-acceso`, `/no-disponible`, `/pago/estado`, webhooks y APIs de calculadora.
- Free (registrado sin pago): solo `/calculadora`, `/perfil` y `/api/calculator/*`. Admin: `/admin/*` exige `role = 'admin'`.
- **Toda la autorización depende de columnas de `profiles` (`role`, `membership_status`, `membership_expires_at`)**. Ver P0-1.

### 2.3 Módulos según el repo (mapeo a los nombres del brief)

Los nombres «Stampa Lab» y «Stampa Hub» **no existen** en el código ni en la documentación. El repo organiza el producto así (`src/lib/features/registry.ts`, `docs/PROJECT_CONTEXT.md`):

| Nombre del brief | Qué hay en el repo |
|---|---|
| Academia Stampa | `academia` (`/academia`, `/cursos`, `/talleres`) |
| Stampa Lab | `calculadora`, `stampa_maker` (Carteles, Neón, Jarros, Lámparas), `libreria_stl`, `explorar_modelos`, `mi_taller` |
| Stampa Hub | `mi_negocio` (+ Presupuestos), `tienda_online`, `sorteos`, `redes`, `canales` |
| Stampy IA | `stampy` (página, widget global, chat de clase) |
| Sistema general | auth, perfil, onboarding, configuración, membresía, Beta, descuentos, XP/insignias, tutoriales, temas, admin (16 secciones) |

### 2.4 Estado real de producción observado [E]

**Feature flags remotas** (`platform_feature_flags`):

| Funcionalidad | Estado en producción |
|---|---|
| `mi_negocio` (incluye `/presupuestos`) | **apagada** (27/10) |
| `tienda_online` | **apagada** (27/10) |
| `explorar_modelos` | **apagada** (27/10) |
| `stampa_maker` | **apagada** (28/10) |
| `sorteos` | **apagada** (28/10) |
| `academia`, `stampy`, `calculadora`, `libreria_stl`, `mi_taller`, `redes`, `canales` | sin fila → habilitadas por defecto |

**Deploy beta** (`stampa3-d-academy-beta.vercel.app`, = `NEXT_PUBLIC_APP_URL`): responde (el `402 DEPLOYMENT_DISABLED` de QA-001 ya no ocurre). `/landing`, `/calculadora`, `/registro`, `/login` → 200; `/explorar-modelos` y `/tienda/*` → `/no-disponible`; **`/` → `/login` para visitantes**; `/robots.txt` y `/sitemap.xml` → `/login`. Solo HSTS (lo agrega Vercel); ninguna otra cabecera de seguridad. No se pudo determinar qué commit está desplegado.

**Migraciones** — tablas/columnas presentes en remoto según sondas (`401 permission denied` = existe; `404 PGRST205` / `400 42703` = no existe):

| Migración | Evidencia remota | Docs dicen |
|---|---|---|
| `20260826182313_stampy_user_memory` | **NO existe** `stampy_user_memory` | no aplicada ✔ |
| `20260918120000_business_customer_accounts` | existe `customer_account_movements` | «no aplicada» ✘ |
| `20261005120000_beta_access_codes` | existe `beta_access_codes` | «no aplicada» ✘ |
| `20261011120000_stl_model_preview_360` | existe `stl_models.preview_url` | «no aplicada» ✘ |
| `20261024120000_platform_feature_flags` | existe y tiene filas | «no aplicada» ✘ |
| `20261029/20261030` descuentos | existe `discount_code_reservations.over_limit` | «no aplicadas» ✘ |
| `20261031090000_tool_tutorial_versions` | **NO existe** `user_tool_tutorial_views.seen_version` | no aplicada ✔ |
| `20261101120000_product_categories` | existe `product_categories` y `products.category_id` | «no aplicada» ✘ |
| `20261102120000_community_links` | existe `community_links`, pero **sin columna `audience`** | «no aplicada» ✘/parcial |
| `20261102130000_product_print_files` | existe `product_print_files` | «no aplicada» ✘ |

> La existencia de una tabla no prueba que la migración completa (funciones, policies, grants) se haya aplicado igual que en el repo. `community_links` sin `audience` sugiere una versión distinta a la del repo. La lista real debe salir de `supabase_migrations.schema_migrations` o de los diagnósticos (`supabase/diagnostics/*`). **[?]**

**Schema base no versionado [C]:** `profiles`, `user_access_grants`, `subscriptions`, `payments`, `products`, `filaments`, `printers`, `courses`, `course_modules`, `lessons`, `lesson_progress`, `stl_*`, `budgets`, `clients`, `invite_codes`, `referrals`, `tool_tutorials`, `membership_settings` y las funciones `is_admin` / `has_platform_access` no tienen `CREATE` en `supabase/migrations`. No se puede reproducir el entorno ni auditar su RLS desde el repo.

---

## 3. Inventario de funcionalidades

Estado de producción: **ON** = habilitada para usuarios con acceso · **OFF** = apagada por flag · **Admin** = solo administradores · **Pública** = sin sesión.
«Validación» = qué evidencia de funcionamiento real existe (no si compila).

| # | Funcionalidad | Módulo | Rutas | Prod | Implementación | Validación real | Preparación V1.0 |
|---|---|---|---|---|---|---|---|
| 1 | Catálogo de cursos y talleres | Academia | `/academia`, `/talleres` | ON | Completa [C] | Sin QA autenticada [D] | Lista si hay contenido [?] |
| 2 | Detalle de curso, clases, video, recursos | Academia | `/cursos/[id]` | ON | Completa; Bunny/Vimeo/YouTube [C] | Sin QA autenticada | Requiere QA + verificar protección de video |
| 3 | Progreso por clase | Academia | Server Action | ON | Completa, valida sesión y visibilidad [C] | Sin QA | Requiere QA |
| 4 | Visibilidad de cursos (publicado / próximamente / oculto) | Academia | `/admin/cursos/[id]` | ON | Completa [C] | Tests; migración aplicada [?] | Requiere QA admin |
| 5 | Admin de cursos, módulos, rutas, transcripciones | Academia/Admin | `/admin/cursos*`, `/admin/roadmaps*`, `/admin/transcripciones*` | Admin | Completa [C] | Uso real del dueño [?] | Operativa |
| 6 | Calculadora (Demo anónima, Free personalizable, Paid) | Lab | `/calculadora` | Pública | Completa, un solo motor [C] | E2E anónimos verdes (14/10) [D] | **Lista** (bugs P3) |
| 7 | Mi Taller: impresoras, filamentos, productos/recetas, inventario, producción, categorías, archivos 3MF | Lab | `/mi-taller/*` | ON | Completa [C] | Tests DB; sin QA autenticada; QA-014 abierto | Requiere QA + fix QA-014 |
| 8 | Librería STL (grupos, visor 3D, descarga firmada, previews 360°) | Lab | `/libreria-stl/*` | ON | Completa [C] | Sin QA autenticada; bucket/RLS `stl_*` [?] | Requiere QA + contenido |
| 9 | Stampa Maker: Carteles | Lab | `/stampa-maker/carteles` | **OFF** | Completa [C] | No impreso/laminado [D] | V1.1 |
| 10 | Stampa Maker: Neón | Lab | `/stampa-maker/neon` | **OFF** | Completa [C] | No impreso [D] | V1.1 |
| 11 | Stampa Maker: Jarros (IA) | Lab | `/stampa-maker/jarros` | OFF + Admin | Congelada [C] | — | Ocultar |
| 12 | Stampa Maker: Lámparas E27 | Lab | `/stampa-maker/lamparas` | OFF + Admin | Experimental (V1–V7 + UX V2) [C] | Nada impreso, sin validación térmica [D] | Ocultar |
| 13 | Explorar Modelos (Cults3D, MyMiniFactory, Thingiverse) | Lab | `/explorar-modelos`, `/api/model-search` | **OFF** | Completa [C] | Cults/MMF verificadas 29/10; permisos de uso pendientes [D] | V1.1 |
| 14 | Mi Negocio: catálogo, venta rápida, ventas/anulación, reposición, Showroom/Depósito, clientes/cuenta corriente, ticket, métricas, pedidos | Hub | `/mi-negocio/*` | **OFF** | Completa y compleja [C] | Tests DB; sin prueba funcional real [D] | V1.1 |
| 15 | Presupuestos (PDF) | Hub | `/presupuestos` | **OFF** (dentro de `mi_negocio`) | Completa [C] | No auditado [D] | Decidir (la landing lo promete) |
| 16 | Mi Tienda / tienda pública + checkout MP Marketplace | Hub | `/mi-negocio/tienda`, `/tienda/*` | **OFF** | Completa [C] | Sin compra real; envs faltantes [D] | V1.1+ |
| 17 | Sorteos | Hub | `/sorteos`, `/admin/sorteos*` | **OFF** | Completa [C] | Revisión legal pendiente [D] | V1.1 |
| 18 | Redes y Canales (administrables) | Hub | `/redes`, `/canales`, `/instagram`… | ON (solo miembros) | Completa [C] | Tabla remota sin `audience` [E]; URLs placeholder `extruye` [D] | Requiere revisar URLs |
| 19 | Stampy: chat, widget global, chat en clase, historial | Stampy | `/stampy` | ON | Completa [C] | Sin QA con la batería de evals [D] | Requiere QA + config |
| 20 | Stampy: RAG (embeddings, transcripciones, documentos) | Stampy | `/admin/stampy*` | ON | Completa [C] | Retrieval sin medir sobre datos reales [D] | Aceptable para V1.0 |
| 21 | Stampy: acciones (13 tools; 5 ejecutables, 1 de escritura) | Stampy | — | ON | Completa, revalida auth [C] | Sin QA | Aceptable |
| 22 | Stampy: memoria de usuario | Stampy | — | ON en código | Tabla **inexistente** en remoto [E] | No funciona | Dejar inactiva (V1.1) |
| 23 | Registro, login, recuperación, callback | Sistema | `/registro`, `/login`, … | Pública | Completa [C] | E2E anónimos verdes [D] | Lista (copy en inglés, QA-005) |
| 24 | Onboarding | Sistema | `/onboarding` | ON | Completa [C] | Sin QA | Requiere QA |
| 25 | Membresía: checkout MP (preapproval), webhook, sync, `/pago/estado` | Sistema | `/sin-acceso`, `/api/mercadopago/*` | Pública | Completa [C] | **Sin evidencia de prueba real E2E** | **Bloqueante: probar** |
| 26 | Cancelación de membresía por el usuario | Sistema | — | — | **No existe** [C] | — | **Falta** |
| 27 | Códigos Beta | Sistema | `/registro`, `/perfil`, `/sin-acceso` | ON | Completa [C] | Tablas en remoto [E]; canje real [?] | Requiere prueba |
| 28 | Códigos de descuento en checkout | Sistema | `/admin/codigos` | Apagado por env (`DISCOUNT_CODES_ENABLED`) | Completa [C] | Solo fakes [D] | Mantener apagado |
| 29 | Precio fundador (`reserve_founder_slot`) | Sistema | — | — | `src/lib/founder-pricing.ts` **no se importa** [C]; el webhook aún confirma reservas | — | Código muerto / decidir |
| 30 | Perfil y configuración (cuenta, negocio, tema) | Sistema | `/perfil`, `/configuracion` | ON | Completa [C] | Sin QA; QA-024 | Requiere QA |
| 31 | Inicio / dashboard personalizado | Sistema | `/` | ON | Completa [C] | Sin QA autenticada | Requiere QA |
| 32 | Navegación desktop y mobile (sidebar, barra inferior, menú radial) | Sistema | — | ON | Completa; QA-010 corregido [C] | Barrido responsive sin sesión [D] | Requiere QA mobile autenticada |
| 33 | Feature flags + `/admin/funcionalidades` | Sistema | — | ON | Completa [C] | **En uso en producción** [E] | Lista |
| 34 | Tutoriales gráficos (15) | Sistema | — | ON | Completa [C] | `seen_version` sin migrar; fallback `localStorage` [E][C] | Aceptable |
| 35 | Temas claro/oscuro/automático | Sistema | — | ON | Completa [C] | QA en claro con datos pendiente [D] | Requiere QA visual |
| 36 | XP, niveles, insignias | Sistema | `/admin/insignias` | ON | Completa, server-authoritative [C] | Aplicación limpia en remoto [?] | Aceptable |
| 37 | Admin: usuarios, membresía (precio), catálogo de calculadora, impresoras | Admin | `/admin/*` | Admin | Completa [C] | QA-016/017 abiertos | Operativa con cuidado |
| 38 | Landing comercial de membresía | Sistema | `/landing` | Pública | Completa [C] | Sin precio, sin testimonios, sin legales [C] | **Requiere correcciones** |
| 39 | Notificaciones in-app / email transaccional | Sistema | — | — | **No existe** [C] | — | V1.1 (salvo emails de Supabase Auth) |
| 40 | PWA | Sistema | `manifest.webmanifest` | — | Solo manifest [C] | — | V1.1 |

---

## 4. Estado por módulo

### 4.A Academia Stampa

**Objetivo:** cursos y talleres por nivel, con progreso y asistencia de Stampy en cada clase. Es el núcleo de la propuesta de valor de la membresía.

**Implementado [C]:**
- Catálogo (`src/app/academia/page.tsx`, `src/lib/academy/catalog.ts`), rutas de aprendizaje (`learning-roadmaps.ts`), «Continuar aprendiendo» (`continue-learning.ts`).
- Barrera de servidor en `/cursos/[id]` (`src/lib/academy/access.ts` → `loadCourseGate`): sesión → flag `academia` → `accessPlatform` → visibilidad. Un curso oculto responde 404, uno «próximamente» muestra una pantalla sin clases.
- Progreso: `setLessonProgressAction` toma el `user_id` de la sesión y valida la clase (`src/app/cursos/actions.ts`).
- Video embebido: Bunny Stream, Vimeo y YouTube (`course-detail-client.tsx:365-420`). Recursos por clase, chat de Stampy por clase.
- Admin completo de cursos, módulos, clases, rutas, transcripciones.

**Incompleto / riesgos:**
- **Contenido: no verificable.** No se puede contar cursos publicados ni clases con video sin sesión (RLS) [?]. Para una membresía cuyo primer pilar es «aprender», el volumen y la calidad del contenido publicado el 11/11 es el principal factor comercial. La FAQ de la landing todavía tiene pendientes («Confirmar el formato de todos los cursos publicados»).
- **RLS de `lessons` / `course_modules` / `lesson_resources` no está en el repo** [C]. La migración de visibilidad solo agrega policies RESTRICTIVE por estado del curso; si la policy base permite SELECT a cualquier `authenticated`, un usuario Free podría leer `video_url` de todas las clases vía REST. [?]
- **Protección del video:** si los embeds de Bunny no usan token de autenticación o restricción de dominio, cualquiera con la URL puede ver la clase. [?]
- La carga del curso son 4–5 consultas en cascada desde el cliente con `select("*")`.
- `docs/CURRENT_STATE.md` marca Academia como «no auditada en profundidad». QA autenticada: ninguna.

**Preparación:** técnicamente lista; comercialmente depende del contenido. Requiere QA con cuenta Paid y verificación de RLS/video.

### 4.B Stampa Lab

**Calculadora — lista.** Un único motor (`src/lib/calculator/pricing.ts`) para Anonymous/Free/Paid; Free guarda solo referencias a plantillas, no crea stock (D010). E2E anónimos verdes el 14/10 [D]. Abiertos menores: sin tope de valores (QA-006), inputs < 16 px que hacen zoom en iOS (QA-011), divergencia docs↔motor sobre el multiplicador de margen (`QA_REPORT §7`). Es la puerta de entrada gratuita: **es la pieza más madura para el lanzamiento.**

**Mi Taller — implementado, falta validar con usuario real.** Impresoras, filamentos (una bobina = una card), productos/recetas/componentes, inventario, registrar producción vs ajustar inventario, categorías, archivos 3MF con apertura en laminadores. Riesgos:
- **QA-014 sigue abierto** [C]: `if (!error) setEditingId(null)` lee el estado del render anterior en `src/components/configuracion/printers-manager.tsx:118`, `filaments-manager.tsx:72`, `product-types-manager.tsx:83`, `src/app/admin/calculadora/page.tsx:80`, `src/app/admin/calculadora/filamentos/page.tsx:101`. Efecto: un guardado fallido cierra el editor y se pierde lo escrito; uno exitoso tras un fallo no cierra el editor (el usuario reintenta y duplica). Sin bloqueo de doble submit.
- Doble conteo de filamento si se agrega a un lote un producto y uno de sus componentes (`src/app/stock/page.tsx`, RPC `consume_filaments_for_production_targets`) [D, no corregido].
- RLS de `product_components`/`product_component_filaments` sin `has_platform_access` [D, no verificable: schema no versionado].
- Escrituras directas desde el navegador con `user_id` del cliente (impresoras, filamentos, productos…): la barrera real es RLS no versionada (RIESGO-02) [?].
- Las feature flags solo controlan páginas, acciones y APIs; las escrituras REST directas no las respetan (documentado, `ARCHITECTURE §21.1`).

**Librería STL — implementada, depende de contenido y de Storage.** Descarga autorizada en servidor (`src/app/api/stl/download/route.ts` valida `downloadStl` y la flag). Pendiente: policies de `stl_*` y privacidad del bucket `stl-files` [?], QA del visor en mobile, licencias de uso comercial («pendiente» en la FAQ). QA-026: registra la descarga antes de validar acceso (menor).

**Stampa Maker — OFF en producción; sobredimensionado para V1.0.** ≈28 mil líneas en `src/lib/maker`, cuatro herramientas. Carteles y Neón son las únicas abiertas a no-admins (`src/lib/maker/availability.ts`), pero ninguna pieza fue impresa ni laminada según la documentación. Lámparas y Jarros son Beta solo admin. **El 70 % de los cambios de código de los últimos 30 días están en `src/lib/maker` + `src/components/maker`** (182 + 35 archivos tocados), con 11 commits de Lámparas en 6 días, sobre una funcionalidad apagada en producción. Recomendación: congelar hasta después del lanzamiento.

**Explorar Modelos — OFF; candidato a V1.1.** Implementado con providers aislados, cache y degradación. Cults3D y MyMiniFactory respondieron con credenciales reales el 29/10 [D]; Thingiverse sin credencial. Bloqueante documentado: permiso de uso comercial (MyMiniFactory/Thingiverse) y rate limiter en memoria por instancia (no global en serverless).

### 4.C Stampa Hub

Todo lo comercial-operativo del Hub está **apagado** en producción, lo cual es correcto para la V1.0:

- **Mi Negocio** (catálogo fabricado/reventa, venta rápida con scanner, Showroom+Depósito, anulación idempotente, clientes y cuenta corriente, ticket, métricas, pedidos): el dominio más complejo del repo, con buen diseño de RPCs y tests contra Postgres, pero **sin prueba funcional real** y con QA-019 (saldo calculado sobre filas truncadas, `src/app/mi-negocio/actions.ts`), QA-022 (ventas limitadas a 50) y QA-023 abiertos. → V1.1.
- **Presupuestos** vive bajo la flag `mi_negocio` (`registry.ts:127`) y por lo tanto **está apagado**, pero la landing lo vende en tres lugares (`landing-content.ts`: «Presupuestos listos para enviar», pilar «Gestionar», `membershipOffer.included`). Hay que decidir: separarlo en su propia flag y validarlo, o quitarlo de la landing.
- **Tienda online** con checkout de MP Marketplace: necesita `CRON_SECRET`, `BUSINESS_CHECKOUT_FINGERPRINT_SECRET`, `MERCADO_PAGO_MARKETPLACE_*`, `BUSINESS_PAYMENT_TOKEN_ENCRYPTION_KEY` (ninguna en `.env.local`; RIESGO-08). → V1.1+.
- **Sorteos**: apagado; acreditación por invitaciones sin definir (D029) y revisión legal pendiente. → V1.1.
- **Redes / Canales**: ON solo para miembros (`/redes` exige `accessPlatform`). La tabla remota `community_links` no tiene la columna `audience` del repo [E] → el código podría estar usando el respaldo o fallar según cómo lo lea; hay que verificar en la app. Las URLs `extruye` de WhatsApp/Telegram parecen placeholders (QA-027). «Comunidad de makers» y «Canales de soporte» se prometen en la landing.

### 4.D Stampy IA

**Arquitectura [C]:** Server Action `askStampyAction` (`src/app/stampy/actions.ts`) → atajos deterministas → clasificación de intención por keywords → retrieval opcional (`STAMPY_RETRIEVAL_ENABLED`, `match_stampy_knowledge_chunks`, pgvector 1536, umbral 0,72) → OpenAI Responses API (`src/lib/stampy/responses.ts`, default `gpt-5.6-terra`, reasoning `low`, 4000 tokens) → historial multi-turn administrado por la app → tools como complemento. Contexto de página/usuario sanitizado con límites; «contexto ≠ autorización» respetado (`products.recalculate` revalida en su propia acción). Gate por flag y por `useStampy = accessPlatform`.

**Límites:** 40 mensajes/hora y 150/día por usuario contando `stampy_usage_logs` (`src/lib/stampy/rate-limit.ts`). **Si la consulta falla, deja pasar** (fail-open). No hay tope de costo global.

**Problemas / riesgos:**
- **Modelo en producción [?]:** `.env.local` fija `OPENAI_MODEL=gpt-5-mini`; vacío = `gpt-5.6-terra`. No se verificó qué valor tiene Vercel ni que ese modelo esté disponible para la cuenta. Afecta también a Jarros.
- **Latencia:** sin streaming; una respuesta detallada tarda ~20–25 s [D]. No hay `maxDuration` ni timeout explícito en la llamada a OpenAI [C]. El límite de duración de funciones depende del plan de Vercel [?].
- **Memoria de usuario:** la tabla `stampy_user_memory` no existe en remoto [E]. El código maneja el error, pero la funcionalidad no opera.
- **RAG:** calidad de retrieval no medida sobre datos reales (`docs/STAMPY_KNOWLEDGE_AUDIT.md`); `stampy_page_contexts` remoto podría contradecir el prompt o prometer beneficios de sorteos (`TASKS.md`).
- El test unitario `tests/stampy-product-stock-tools.test.mjs`, rojo en auditorías anteriores, hoy pasa (Anexo A).

**Preparación:** aceptable para V1.0 como asistente de aprendizaje, si se confirma el modelo/timeout en producción y se hace una pasada de la batería `docs/STAMPY_EVALS.md`. Streaming y memoria → V1.1.

### 4.E Sistema general

- **Auth [C]:** Supabase Auth con email/contraseña, recuperación y callback. Errores crudos en inglés («Invalid login credentials», «Failed to fetch»; QA-005). El proxy redirige a `/login` sin `returnTo` (`middleware.ts`, QA-007): se pierde el deep link. Si «Confirm email» está activo en Supabase: [?].
- **Autorización [C]:** sólida en el código; **depende de `profiles`** (P0-1).
- **Membresía [C]:** checkout con idempotencia y reservas (`checkout_attempts`), precio único desde `membership_settings` con fallback `MEMBERSHIP_MONTHLY_PRICE` (`src/lib/mercadopago/membership-price.ts`). Pero:
  - Webhook (`src/app/api/mercadopago/webhook/route.ts`): inserta el evento crudo **antes** de validar; valida la firma **solo si llega** `x-signature` (`else if (signatureHeader)`); comparación no constante; ante cualquier error responde **200** (`:286`), así que MP no reintenta y una activación fallida queda silenciosa salvo que alguien mire `mercado_pago_webhook_events`. El estado se lee de la API de MP (no se puede forjar una membresía), lo que acota el impacto de la firma.
  - `/sin-acceso` muestra un precio de respaldo `19900` si falla la consulta (`sin-acceso-client.tsx:89,92`), distinto de `MEMBERSHIP_MONTHLY_PRICE=15000` del ejemplo (QA-028); y hace `console.log` de la respuesta del checkout (`:151,173-174`, QA-025).
  - **No hay botón de baja**: el usuario solo puede cancelar desde Mercado Pago; Perfil muestra el estado si ya se canceló (`src/app/perfil/page.tsx:311-321`).
  - No hay emails propios de confirmación de pago, fallo de renovación o vencimiento.
- **Admin [C]:** 16 secciones. `users-table.tsx:252-308` cambia rol/membresía con un `<select>` sin confirmación, permite autodegradarse (QA-016) y escribe «meses activos» en cada tecla (QA-017).
- **Navegación:** sidebar y mobile filtran por flags; QA-010 (menú radial) **corregido** (`getRadialArcAngles(items.length)`). Visitantes en `/` van a `/login`, no a la landing.
- **Branding inconsistente:** metadata, manifest, landing y nombre de la membresía dicen «Academia Stampa»; el interior de la app dice «Universo Stampa».

---

## 5. Problemas detectados

Esfuerzo: **S** ≤ medio día · **M** ≤ 1,5 días · **L** 2–4 días · **Ext** depende de terceros.
Tipo: **Confirmado** (verificado en código/ejecución) · **Riesgo** (potencial; requiere verificación).

### P0 — Crítico (impide lanzar comercialmente)

| ID | Problema | Tipo | Módulo | Impacto | Evidencia / archivos | Solución sugerida | Esf. | Bloquea |
|---|---|---|---|---|---|---|---|---|
| **P0-1** | **Posible autopromoción a Paid/Admin vía `profiles`.** Toda la autorización sale de `profiles.role/membership_status/membership_expires_at`; la app hace `profiles.update()` desde el navegador (`account-manager.tsx:81`, `business-manager.tsx:61`, `onboarding/page.tsx:114`, Admin `users-table.tsx:109`); no hay trigger, policy ni `GRANT` por columna versionados. | Riesgo (código confirmado; DB [?]) | Sistema | Si la DB no bloquea columnas: cualquier cuenta Free se da acceso pago o admin con un `PATCH` a `/rest/v1/profiles`. Pérdida total de ingresos y de control. | `src/lib/auth/user-access.ts`, `access-policy.ts`; `supabase/diagnostics/20261014_qa_rls_audit.sql` (secciones B/C/D, **nunca ejecutado**) | 1) Ejecutar el diagnóstico (solo lectura). 2) Si está abierto: nueva migración con trigger `BEFORE UPDATE` que rechace cambios de columnas privilegiadas salvo `is_admin()`/`service_role`, o `REVOKE UPDATE` + `GRANT UPDATE (columnas seguras)`; probar con cuenta Free. | S (diagnóstico) + S/M (fix) | **Sí** |
| **P0-2** | **Sin textos legales ni baja de la membresía.** Términos, privacidad y condiciones con `href: null`; la landing promete «cancelá cuando quieras» pero no existe cancelación en la app. | Confirmado | Comercial | Vender una suscripción recurrente sin términos/privacidad ni mecanismo de baja expone a reclamos y sanciones de defensa del consumidor (validar con asesoría local el «botón de baja» y el de arrepentimiento). | `src/components/landing-membership/landing-content.ts` (`legalLinks`, `membershipOffer.cancellation`, FAQ) | Redactar y publicar las tres páginas (estáticas); botón «Cancelar membresía» en Perfil que llame a `PUT /preapproval/{id}` con `status: cancelled` (ya existe `provider.cancel` en `create-subscription/route.ts:266`) o, como mínimo para el día 1, instrucciones claras + enlace de baja asistida. | Ext (textos) + M (botón) | **Sí** |
| **P0-3** | **Ciclo de la membresía sin validar de punta a punta.** No hay evidencia en el repo de una compra real: alta → webhook → `membership_status=active` → acceso → renovación → cancelación → expiración. Los descuentos solo se probaron con fakes. | Riesgo | Sistema / pagos | Si algo falla el día del lanzamiento, el primer cliente paga y no accede (o accede gratis). | `src/app/api/mercadopago/{create-subscription,webhook,sync-subscription}/route.ts`, `docs/CURRENT_STATE.md` §11 | Compra real (o con usuarios de prueba de MP) en producción con un precio de prueba; verificar acceso, la fila en `subscriptions/payments`, `/pago/estado`, cancelación desde MP y expiración. Mantener `DISCOUNT_CODES_ENABLED=false`. | M | **Sí** |
| **P0-4** | **Sin QA autenticada del alcance V1.0.** No hay staging ni cuentas de prueba; ~1.300 escenarios E2E por rol se omiten; todas las pantallas con sesión de los últimos sprints se verificaron con arneses temporales. | Confirmado | Todos | Bugs visibles para los primeros clientes en Inicio, Academia, Stampy, Mi Taller, Perfil u onboarding. | `docs/QA_REPORT.md` §1, §8; `tests/e2e/README.md` | Pasada manual guiada (checklist de §10) con 3 cuentas reales en producción: Free, Paid (o Beta) y Admin, desktop + 375 px. Ideal posterior: Supabase de test. | M | **Sí** |
| **P0-5** | **Contenido de Academia no verificado.** No se puede saber desde el repo cuántos cursos están publicados ni si todas sus clases tienen video. | Riesgo | Academia | Si el catálogo es escaso, la promesa principal de la membresía no se cumple. | `src/lib/academy/catalog.ts`; FAQ con «pending» | Inventario de contenido por el dueño (cursos publicados, clases con video, recursos), y decidir qué se marca «Próximamente». | S (revisión) | **Sí** (decisión de negocio) |

### P1 — Alto

| ID | Problema | Tipo | Módulo | Impacto | Evidencia / archivos | Solución sugerida | Esf. | Bloquea |
|---|---|---|---|---|---|---|---|---|
| P1-1 | Webhook de membresías: firma opcional, persiste antes de validar, comparación no constante, **200 ante errores** (sin reintento de MP). | Confirmado | Pagos | Activaciones perdidas en silencio; tabla de eventos inflable por terceros. | `src/app/api/mercadopago/webhook/route.ts:28-71,270-286` (QA-009) | Exigir firma si hay secret, `timingSafeEqual`, devolver 5xx en errores transitorios para que MP reintente; alerta sobre eventos con `error_message`. El webhook de Mi Negocio ya tiene un validador reutilizable. | S | Recomendado antes de vender |
| P1-2 | **Sin monitoreo ni alertas** (errores, webhooks fallidos, consumo de OpenAI). | Confirmado | Infra | Los fallos del lanzamiento se descubren por reclamos. | No hay Sentry/analytics en `package.json`; 21 `console.log` en `src/` | Mínimo: Vercel logs + alertas de errores, revisión diaria de `mercado_pago_webhook_events` y del panel de uso de OpenAI con límite de gasto. | S | No, pero muy recomendado |
| P1-3 | **Landing vende funcionalidades apagadas** (Presupuestos, catálogo de productos, comunidad/soporte) y **no muestra precio**; sin testimonios (correcto) y con FAQ con respuestas pendientes. | Confirmado | Comercial | Expectativa incumplida desde el primer día; posible reclamo. | `landing-content.ts` (`pillars`, `outcomes`, `membershipOffer`, `faqItems[].pending`) | Alinear la landing con el alcance V1.0 (o habilitar Presupuestos tras validarlo); mostrar precio desde `membership_settings`; cerrar los «pending». | S | Sí, para la comunicación |
| P1-4 | **`/` lleva a `/login` a los visitantes**; `robots.txt` y `sitemap.xml` redirigen a login; metadata genérica. | Confirmado [E] | Comercial / SEO | El dominio principal no presenta el producto; sin indexación. | `middleware.ts` (no incluye `/` ni `robots`/`sitemap` en públicas); `src/app/layout.tsx` | Redirigir anónimos de `/` a `/landing` (o servirla en `/`); agregar `robots.ts`/`sitemap.ts` y excluirlos del proxy; metadata/OG de la landing. | S | Recomendado |
| P1-5 | **Configuración de producción no verificada:** dominio final, plan de Vercel (Hobby no permite uso comercial; el `402 DEPLOYMENT_DISABLED` del 14/10 sugiere problemas de facturación), `OPENAI_MODEL`, `MERCADO_PAGO_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, URLs de redirección de Supabase Auth. | Riesgo | Infra | Caída o funcionamiento erróneo el día del lanzamiento; incumplimiento de ToS del hosting. | `.env.example`, `docs/QA_REPORT.md` QA-001 | Checklist de entorno (§6.3) firmado antes del 10/11. | S | Sí (checklist) |
| P1-6 | QA-014: editores de Mi Taller/Admin pierden datos o duplican al guardar. | Confirmado [C] | Mi Taller | Primera experiencia del usuario Paid configurando su taller. | 5 archivos citados en §4.B | Usar el error devuelto por la request, deshabilitar el botón en vuelo, validar campos. | S | Recomendado |
| P1-7 | RLS de contenido premium (`lessons`, `lesson_resources`, `stl_*`) y protección de video no verificadas. | Riesgo | Academia / STL | Usuarios Free leyendo URLs de video o archivos premium. | Schema base no versionado; diagnóstico secciones B | Ejecutar el mismo diagnóstico; activar token/referrer en Bunny Stream. | S | Sí si el diagnóstico falla |
| P1-8 | Stampy: modelo, timeouts y costo en producción sin verificar; rate limit fail-open; sin streaming (20–25 s). | Riesgo | Stampy | Respuestas que expiran o costos no acotados. | `src/lib/stampy/responses.ts:6,55`, `rate-limit.ts:43-47` | Confirmar modelo; `maxDuration` acorde al plan; límite de gasto en OpenAI; QA con `docs/STAMPY_EVALS.md`. | S | No |
| P1-9 | Drift de documentación de despliegue: `CURRENT_STATE`/`TASKS` dicen «no aplicada» para ≥10 migraciones que existen en remoto; `community_links` remoto difiere del repo. | Confirmado [E] | Proceso | Riesgo de reaplicar o de asumir que falta algo; decisiones con datos falsos. | §2.4 | Obtener `schema_migrations` remoto y reconciliar; actualizar docs. | S | No, pero previo a cualquier migración |

### P2 — Medio

| ID | Problema | Tipo | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|
| P2-1 | Sin cabeceras de seguridad (CSP/`frame-ancestors`, `nosniff`, `Referrer-Policy`) — QA-013 | Confirmado [E] | `next.config.ts` sin `headers()` | Agregar `headers()` básico | S |
| P2-2 | Deep link perdido tras login — QA-007 | Confirmado [C] | `middleware.ts` → `redirectWithCookies('/login')` | Pasar `returnTo` (ya existe `sanitizeReturnTo`) | S |
| P2-3 | APIs privadas responden 307 a login en vez de 401 — QA-012 | Confirmado [E] | `/api/stl/download` → 307 | 401 JSON para `/api/*` | S |
| P2-4 | Errores de auth crudos y en inglés — QA-005 | Confirmado [D] | `login`, `registro`, `actualizar-password` | Mapa de mensajes en español | S |
| P2-5 | Admin → Usuarios sin confirmación, autodegradación, escritura por tecla — QA-016/017 | Confirmado [C] | `users-table.tsx:252-308` | Diálogo de confirmación, bloquear self-demote, debounce | S |
| P2-6 | Precio de respaldo `19900` en `/sin-acceso` y `console.log` del checkout — QA-028/025 | Confirmado [C] | `sin-acceso-client.tsx:89-92,151-174` | Si falla la consulta, no mostrar precio inventado; quitar logs | S |
| P2-7 | Contraste de CTA blanco sobre `#ff780a` = 2,64:1 — QA-020 | Confirmado [D] | `globals.css:22,27` | Token de texto oscuro sobre naranja o naranja más oscuro | S |
| P2-8 | Proxy con 3–4 consultas a Supabase por request (getUser + profiles + grants + flags) | Riesgo de rendimiento | `middleware.ts` | Medir TTFB; cachear flags; evaluar claims en JWT | M |
| P2-9 | Redes/Canales: URLs placeholder `extruye`; tabla remota sin `audience` | Confirmado [E][D] | `/admin/redes-canales`, QA-027 | Revisar en la app con admin; reconciliar schema | S |
| P2-10 | Feature flags no aplican a escrituras REST directas | Confirmado [D] | `ARCHITECTURE §21.1` | Aceptable para V1.0 (las tablas siguen protegidas por RLS de propietario) | L |
| P2-11 | Schema base no versionado: no hay entorno reproducible ni RLS auditable | Confirmado [C] | `supabase/migrations` | `supabase db dump` del schema y versionarlo (post-lanzamiento) | M |
| P2-12 | Branding mezclado «Academia Stampa» / «Universo Stampa» | Confirmado [C] | `layout.tsx`, `manifest.ts`, landing vs app | Decidir marca de venta y unificar textos visibles | S |
| P2-13 | Doble conteo de filamento en producción (producto + componente en el mismo lote) | Confirmado [D] | `src/app/stock/page.tsx`, RPC de consumo | Deduplicar en UI/RPC | M |

### P3 — Bajo

- **Lint:** 564 problemas (**416 errores**, 148 warnings): 327 `no-explicit-any`, ~60 reglas del React Compiler (`set-state-in-effect`, `immutability`, `refs`), 12 `no-unescaped-entities`, 7 `no-assign-module-variable`. No afecta al build (Next 16 no corre lint en `build`). [E]
- `src/lib/founder-pricing.ts` sin uso (precio fundador desconectado del checkout; el webhook aún confirma reservas). [C]
- Stampy: memoria de usuario sin tabla; tutoriales sin `seen_version` (funciona por `localStorage`). [E]
- QA-002/003/004/006/008/011/015/018/021/023/024/026 (ver `docs/QA_REPORT.md` §4.3).
- `location_breakdown` huérfana; `AGENTS-old.md`, `CLAUDE-old.md`, `Redeploy.txt`, `backup/` en la raíz; `README.md` genérico de create-next-app.
- PWA sin service worker.

---

## 6. Seguridad e infraestructura

### 6.1 Lo que está bien [C]
- Default-deny en el proxy; `authenticated != paid` aplicado en proxy, páginas, APIs y Server Actions (33 acciones de Mi Negocio pasan por `authorizeBusinessAccess`, según QA 14/10).
- RPCs críticas `SECURITY DEFINER` con `search_path` fijo, revocadas a `public/anon`, idempotentes (ventas, anulación, stock, canje Beta, descuentos) y probadas contra Postgres real con carreras concurrentes.
- `user_id` tomado de la sesión en las acciones nuevas (progreso, Stampy, 3MF).
- Descarga STL y archivos 3MF autorizadas en servidor con URLs firmadas / tickets.
- Secretos de providers solo en servidor (`.env.example` lo indica; `.env*` ignorado por git).
- Webhook de Mi Negocio con validación de firma testeada.

### 6.2 Riesgos abiertos

| Riesgo | Nivel | Estado |
|---|---|---|
| RLS/trigger de `profiles` (autopromoción) | **P0** | Sin verificar; diagnóstico listo |
| RLS de tablas premium y contenido (`lessons`, `stl_*`, Mi Taller) | P1 | Sin verificar; mismo diagnóstico |
| Webhook de membresías (firma opcional, 200 en errores) | P1 | Confirmado en código |
| Grants amplios en `business_catalog_items` (RIESGO-05) | P3 (feature OFF) | Documentado |
| Canje legacy de `invite_codes` en `/auth/callback` (texto plano, no atómico) | P3 | Documentado; puente nuevo ya canaliza el canje |
| Rate limiters en memoria (Explorar Modelos, checkout de tienda) | P3 (features OFF) | Documentado |
| `service_role` sin SELECT sobre tablas core (observado el 06/10) | ? | Si el webhook escribe `profiles` con service role y le faltan privilegios, la activación falla: **verificar en P0-3** |
| Sin cabeceras de seguridad | P2 | Confirmado |

### 6.3 Checklist de infraestructura antes del 11/11 [?]

1. Dominio de producción definido y apuntado; `NEXT_PUBLIC_APP_URL` igual al dominio final (hoy apunta a `*.vercel.app`).
2. Supabase Auth: Site URL y Redirect URLs con el dominio final; plantillas de email en español; decisión sobre «Confirm email».
3. Plan de Vercel compatible con uso comercial; límite de duración de funciones suficiente para Stampy.
4. Variables en Vercel (sin revelar valores): `SUPABASE_SERVICE_ROLE_KEY`, `MERCADO_PAGO_ACCESS_TOKEN` (producción), `MERCADO_PAGO_WEBHOOK_SECRET`, `MEMBERSHIP_MONTHLY_PRICE` coherente con `membership_settings`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `STAMPY_*`, `DISCOUNT_CODES_ENABLED=false`.
5. Webhook de membresías configurado en Mercado Pago hacia el dominio final.
6. Backups de Supabase activos (plan) y prueba de restauración conocida.
7. Límite de gasto en OpenAI.
8. Buckets `stl-files` y `product-print-files` privados; `stl-previews` público solo para previews.
9. Lista real de migraciones aplicadas (`supabase_migrations.schema_migrations`) archivada.

---

## 7. Experiencia de usuario

- **Navegación:** coherente; desktop (sidebar) y mobile (barra inferior + menú radial) filtran por flags y por rol; Free ve candados que llevan a `/sin-acceso`. QA-010 resuelto. Al estar apagadas cinco herramientas, la navegación de un Paid es más simple, lo cual favorece la V1.0.
- **Diseño:** UX V2 (Inicio, Mi Taller, Stampy, Calculadora) y temas claro/oscuro/automático implementados; tutoriales gráficos en 15 secciones. El default es «Automático», pero **el modo claro no tiene QA con datos reales** (`TASKS.md`), así que un usuario con el sistema en claro verá una variante menos revisada. Considerar fijar oscuro por defecto para el lanzamiento si no hay tiempo de QA en claro.
- **Mobile:** barrido sin scroll horizontal en 14 vistas × 5 anchos con datos de ejemplo [D]; nunca con sesión real. iOS hace zoom en inputs de la calculadora (QA-011).
- **Accesibilidad:** contraste de CTA principal 2,64:1 (QA-020); botones de solo ícono sin nombre (QA-018/021).
- **Fricciones del embudo:** visitante en `/` ve login; tras iniciar sesión se pierde el destino (QA-007); errores de auth en inglés (QA-005); `/sin-acceso` y `/pago/estado` muestran errores 401 sin sesión (QA-003/004).
- **Stampy:** 20–25 s sin streaming para respuestas largas; es la mayor fricción percibida probable dentro de la app.

---

## 8. Preparación comercial

| Elemento | Estado | Evidencia |
|---|---|---|
| Producto vendible (alcance ON) | Sí, en código | Academia + Stampy + Calculadora + Mi Taller + STL + comunidad |
| Contenido de Academia | **[?]** | No verificable desde el repo |
| Checkout de membresía | Implementado; **no validado de punta a punta** | P0-3 |
| Precio | En `membership_settings` (admin `/admin/membresia`); la landing no lo muestra; fallbacks divergentes | P1-3, P2-6 |
| Cancelación / baja | **Falta en la app** | P0-2 |
| Términos, privacidad, condiciones | **Faltan** | P0-2 |
| Facturación fiscal | No hay nada en el repo (fuera de alcance del código; decisión del negocio) [?] | — |
| Emails transaccionales | Solo los de Supabase Auth | §4.E |
| Códigos Beta | Implementados; tablas en remoto | Útil para dar acceso a primeros usuarios sin cobro |
| Descuentos | Implementados, apagados; decisiones comerciales abiertas (`docs/DEPLOY_DISCOUNT_CODES.md` §5) | Mantener apagados |
| Precio fundador | Desconectado | P3 |
| Soporte | Promesa de «canales de soporte»; URLs a revisar | P2-9 |
| Landing | Estructura completa; sin precio, sin legales, promete funciones OFF | P1-3 |
| Analítica de conversión | No existe | V1.1 (o mínimo: Vercel Analytics) |

**Conclusión comercial:** el producto puede venderse como «Membresía Academia/Universo Stampa: cursos + Stampy + calculadora + gestión del taller + librería STL», no como «sistema de gestión de negocio con presupuestos y tienda». La landing hay que reescribirla en ese sentido.

---

## 9. Alcance recomendado para V1.0

### Incluir (ya ON en producción)
Academia · Stampy (sin memoria ni streaming) · Calculadora (pública) · Mi Taller · Librería STL · Redes/Canales (con URLs revisadas) · Perfil/Configuración · Onboarding · Tutoriales · Temas · Códigos Beta · Admin.

### Corregir antes de lanzar
P0-1 (si el diagnóstico falla) · P0-2 · P0-3 · P1-1 · P1-3 · P1-4 · P1-6 · P2-2 · P2-6 · checklist §6.3.

### Mantener ocultas (ya OFF)
Mi Negocio (y Presupuestos, salvo decisión explícita de validarlo y separarlo) · Tienda online · Stampa Maker (las cuatro herramientas) · Explorar Modelos · Sorteos · Descuentos (`DISCOUNT_CODES_ENABLED=false`).

### Sobrecomplicado para esta etapa
- **Stampa Maker / Lámparas:** siete versiones de geometría paramétrica sin una sola impresión validada, sobre una herramienta apagada y solo admin. Absorbió la mayor parte del esfuerzo reciente.
- **Mi Negocio:** Showroom/Depósito, scanner, cuenta corriente, ticket térmico y e-commerce con Marketplace son un producto en sí mismo; su validación real exige tiempo que no hay.
- **Descuentos con reservas de asientos y `over_limit`:** robusto, pero innecesario para el día 1 si se usan códigos Beta.
- **Documentación:** `STAMPA_MAKER.md` tiene 4.066 líneas; los documentos de estado mezclan bitácora con estado y quedaron desactualizados.

### Esencial que falta (mínimo indispensable)
1. Textos legales + baja de la membresía.
2. Validación real del pago.
3. Monitoreo mínimo (logs/alertas, revisión de webhooks, límite de gasto IA).
4. Landing alineada con lo que se vende, con precio.

### Para V1.1
Presupuestos (separado), Mi Negocio, Explorar Modelos (tras permisos), Carteles/Neón (tras impresión), streaming y memoria de Stampy, emails transaccionales, analítica, staging + E2E autenticados, versionar schema base, cabeceras/CSP completas, lint, sorteos (tras revisión legal), PWA.

---

## 10. Backlog de lanzamiento

Orden sugerido; los días son orientativos (hoy = mié 4/11).

| # | Tarea | Prioridad | Depende de | Esf. | Responsable sugerido | Día objetivo |
|---|---|---|---|---|---|---|
| 1 | Ejecutar `supabase/diagnostics/20261014_qa_rls_audit.sql` (solo lectura) y compartir resultados B/C/D/H | P0 | — | S | Dueño (SQL Editor) | 4–5/11 |
| 2 | Obtener lista de migraciones aplicadas (`supabase_migrations.schema_migrations`) y reconciliar con §2.4 | P1 | — | S | Dueño + agente | 5/11 |
| 3 | Si #1 muestra `profiles` abierto: migración de guarda de columnas + prueba con cuenta Free | P0 | 1 | S/M | Agente (aplica el dueño) | 5–6/11 |
| 4 | Redactar Términos, Privacidad y Condiciones de la membresía; publicarlas como páginas públicas y enlazarlas | P0 | Asesoría | Ext + S | Dueño + agente (páginas) | 4–8/11 |
| 5 | Botón «Cancelar membresía» en Perfil (o baja asistida documentada) | P0 | 4 | M | Agente | 6–7/11 |
| 6 | Inventario de contenido de Academia y decisión de qué se publica | P0 | — | S | Dueño | 4–6/11 |
| 7 | Checklist de infraestructura §6.3 (dominio, Vercel, envs, Auth URLs, webhook MP, backups, límite OpenAI) | P1 | — | S | Dueño | 5–7/11 |
| 8 | Endurecer webhook de membresías (firma obligatoria, `timingSafeEqual`, 5xx en errores) | P1 | — | S | Agente | 5/11 |
| 9 | Compra real de punta a punta (alta, acceso, `/pago/estado`, cancelación, expiración) | P0 | 7, 8 | M | Dueño + agente | 7/11 |
| 10 | Alinear landing con el alcance V1.0, mostrar precio, cerrar FAQ «pending», marca unificada | P1 | 6 | S | Agente + dueño (copy) | 6–7/11 |
| 11 | `/` → landing para anónimos; `robots.ts`/`sitemap.ts`; metadata OG | P1 | 7 (dominio) | S | Agente | 6/11 |
| 12 | Fix QA-014 (editores Mi Taller/Admin) | P1 | — | S | Agente | 5/11 |
| 13 | `returnTo` tras login (QA-007); quitar precio de respaldo y `console.log` del checkout (QA-028/025) | P2 | — | S | Agente | 6/11 |
| 14 | Revisar URLs de Redes/Canales en `/admin/redes-canales` | P2 | — | S | Dueño | 6/11 |
| 15 | Confirmar `OPENAI_MODEL` y duración de funciones; batería `STAMPY_EVALS.md` | P1 | 7 | S | Dueño + agente | 7/11 |
| 16 | **Go/no-go** con resultados de 1, 3, 4, 9 | — | 1–9 | — | Dueño | **vie 7/11** |
| 17 | QA manual autenticada (Free/Paid/Admin, desktop + 375 px) del alcance V1.0: registro → onboarding → Inicio → curso/clase/progreso → Stampy → Calculadora → Mi Taller (impresora, bobina, producto, producción) → STL (visor, descarga) → Perfil → `/sin-acceso` → checkout | P0 | 3, 12 | M | Dueño + agente | 8–9/11 |
| 18 | Cabeceras de seguridad básicas (QA-013) | P2 | — | S | Agente | 9/11 |
| 19 | Congelar código (solo fixes) y deploy final; actualizar `CURRENT_STATE`/`TASKS` | — | 17 | S | Dueño | 10/11 |
| 20 | Monitoreo del día 1: logs de Vercel, `mercado_pago_webhook_events` con error, uso de OpenAI, altas | P1 | 19 | S | Dueño | 11/11+ |

---

## 11. Evaluación de viabilidad (lanzamiento 11/11)

**El código no es el cuello de botella.** Con el alcance que hoy está encendido, el trabajo de desarrollo necesario es pequeño (≈ 4–6 días-agente de tareas S/M, paralelizables). Los riesgos de calendario son externos o de verificación:

| Condición | Si se cumple | Si no |
|---|---|---|
| Diagnóstico de `profiles` sin hallazgos (o fix aplicado ≤ 6/11) | Seguir | **No lanzar con cobro** |
| Textos legales publicados ≤ 9/11 | Seguir | Lanzar solo con acceso Beta gratuito (códigos) |
| Compra real E2E OK ≤ 8/11 | Seguir | **No lanzar con cobro** |
| Contenido de Academia suficiente | Seguir | Lanzar como «preventa/fundadores» con expectativa explícita, o mover fecha |
| QA autenticada sin bugs bloqueantes ≤ 9/11 | Lanzar | Corregir y evaluar 1–3 días de corrimiento |

**Conclusión:** lanzar el 11 de noviembre es **realista para una V1.0 acotada** (alcance actual de flags) **si y solo si** los cuatro primeros puntos se resuelven antes del viernes 7. No es realista lanzar con Mi Negocio, Tienda, Stampa Maker, Explorar Modelos o Sorteos encendidos. Alternativa de menor riesgo si algún P0 queda abierto: abrir el 11/11 con **acceso Beta por código** (sin cobro) y habilitar el cobro cuando los P0 estén cerrados.

---

## 12. Conclusión

**¿Dónde estamos parados?** Con un producto grande y bien construido en el código, cuyo alcance comercial ya está correctamente recortado en producción mediante feature flags, pero que **nunca fue verificado como producto pago**: la seguridad del acceso depende de una configuración de base de datos que nadie revisó, el cobro no tiene evidencia de prueba real, no hay términos ni baja, y ninguna pantalla con sesión fue probada en un entorno controlado. Typecheck y build pasan; el lint arrastra deuda; la documentación de estado está desactualizada respecto de lo que hay en Supabase.

**¿Qué nos falta?** Muy poco desarrollo y bastante verificación: (1) confirmar o cerrar la protección de `profiles` y del contenido premium; (2) términos, privacidad y baja; (3) una compra real de punta a punta; (4) QA autenticada del alcance V1.0; (5) landing y dominio alineados con lo que se vende; (6) monitoreo mínimo.

**¿Cuál debería ser la prioridad inmediata?** Hoy mismo, dos acciones que no requieren programar y que son las de mayor plazo: **ejecutar el diagnóstico de RLS** (`supabase/diagnostics/20261014_qa_rls_audit.sql`) e **iniciar los textos legales**. En paralelo, **congelar todo desarrollo nuevo** (en particular Stampa Maker/Lámparas) y dedicar la semana exclusivamente al backlog de §10, con decisión go/no-go el viernes 7/11.

---

## Anexo A — Verificaciones ejecutadas en esta auditoría

| Verificación | Resultado |
|---|---|
| `git status` / branch | `main` en `66e10b2`, limpio (antes y después) |
| `npx tsc --noEmit --incremental false` | **OK** (0 errores) |
| `npx eslint .` | **564 problemas: 416 errores, 148 warnings** (327 `no-explicit-any`) |
| `npx next build` | **OK** (Next 16.2.10, sin warnings relevantes) |
| `node --test` (110 archivos sin base de datos, `tests/*.test.mjs` excepto `*-db`) | **2.280 tests: 2.279 pasan, 0 fallan, 1 omitido** (12 min). El fallo histórico de `stampy-product-stock-tools` ya no aparece. Son tests de lógica, geometría y wiring: no prueban la app con sesión ni contra Supabase real |
| Tests `*-db` (Postgres embebido) | **No ejecutados** (en la sesión del 03/11 quedaron colgados esperando el Postgres embebido) |
| E2E Playwright | **No ejecutados** (sin cuentas de prueba; los anónimos se ejecutaron el 14/10) |
| Sondas REST anónimas de existencia de tablas/columnas | Ver §2.4 |
| Lectura de `platform_feature_flags` | 5 funcionalidades apagadas (§2.4) |
| `curl` al deploy beta | Disponible; `/` → `/login`; sin cabeceras de seguridad propias |

## Anexo B — Lo que no se pudo verificar y cómo verificarlo

| Qué | Cómo |
|---|---|
| RLS/trigger/privilegios de `profiles` y tablas premium | `supabase/diagnostics/20261014_qa_rls_audit.sql` (solo lectura) |
| Migraciones aplicadas exactamente | `select version, name from supabase_migrations.schema_migrations order by version;` |
| Contenido de Academia | Revisión en `/admin/cursos` |
| Ciclo de pagos | Compra real o usuarios de prueba de MP |
| Pantallas autenticadas | QA manual (§10 #17) |
| Configuración de Vercel/Supabase Auth/MP | Checklist §6.3 |
| Calidad de Stampy | `docs/STAMPY_EVALS.md`, `supabase/diagnostics/20261006_stampy_*.sql` |
| Commit desplegado en Vercel | Panel de Vercel (deployment → commit) |

## Anexo C — Cambios que deberían reflejarse en `/docs` (no aplicados: fuera del alcance de esta tarea)

- `CURRENT_STATE.md` / `TASKS.md`: corregir el estado «no aplicada» de las migraciones que existen en remoto (§2.4); registrar las feature flags apagadas en producción; QA-001 resuelto; QA-010 resuelto.
- `QA_REPORT.md`: QA-001 y QA-010 cerrados.
- `PROJECT_CONTEXT.md`: definir si «Stampa Lab»/«Stampa Hub» son nombres de producto vigentes y la marca de venta (Academia vs Universo).
- `ROADMAP.md`: reemplazar por el alcance V1.0 / V1.1 de §9 si se aprueba.
