# QA_MATRIX — feature × rol × desktop/mobile (2026-10-14)

Cada celda: `desktop / mobile`. Estados:

* ✅ **E2E ejecutado y verde** · 🐞 **E2E ejecutado, bug confirmado** (id en `docs/QA_REPORT.md`) · 🔎 **solo revisión de código** (sin ejecutar)
* ⏸ **Test escrito, sin ejecutar** (faltan cuentas/entorno de test; se activa con las variables de `tests/e2e/README.md`)
* ⛔ **Sin cobertura** (no automatizado ni revisado en profundidad) · — no aplica / bloqueado por diseño (comportamiento verificado en otra fila)

Roles: **Anon** anónimo · **Free** autenticado sin acceso · **Beta** grant `beta_tester` activo · **Paid** membresía activa · **Admin** · **B-exp/B-rev** Beta vencida/revocada (se comportan como Free).

## 1. Acceso, autenticación y navegación

| Feature | Anon | Free | Beta | Paid | Admin | B-exp/B-rev | Tests / notas |
|---|---|---|---|---|---|---|---|
| Matriz de acceso por ruta (58 rutas) | ✅ ✅ | ⏸ | ⏸ | ⏸ | ⏸ | ⏸ | `01`; Free **no** debe ver ninguna ruta `member` (`authenticated != paid`) |
| Redirect a `/login` conserva destino | 🐞 QA-007 | — | — | — | — | — | middleware sin `returnTo` |
| Login válido / persistencia / logout | — | ⏸ | ⏸ | ⏸ | ⏸ | ⏸ | `02` (flujo por UI + recarga + `/salir`) |
| Login inválido, validaciones, mostrar contraseña | ✅ ✅ | — | — | — | — | — | `02` |
| Mensajes de error de auth | 🐞 QA-005 | — | — | — | — | — | inglés/crudo; `?error=` ignorado |
| Registro (formulario, ref, Beta, returnTo) | ✅ ✅ | — | — | — | — | — | no se envía (no crea cuentas); **registro real: ⛔** |
| Recuperar / actualizar contraseña | ✅ 🐞 QA-005c | — | — | — | — | — | envío real de email: ⛔ |
| open-redirect en `returnTo` y `/auth/callback` | ✅ ✅ | — | — | — | — | — | `02`, `08` |
| `/sin-acceso` (copy, canje, actualizar acceso) | 🐞 QA-003 | ⏸ | → `/` ⏸ | → `/` ⏸ | → `/` ⏸ | ⏸ | |
| Onboarding obligatorio tras recibir acceso | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | 🔎 `middleware.ts`: `needsOnboarding` solo con acceso de plataforma |
| 404 / rutas inexistentes | 🐞 QA-002/008 | ⏸ | ⏸ | ⏸ | ⏸ | ⏸ | `03` |
| Sidebar desktop | — | ⏸ | ⏸ | ⏸ | ⏸ | ⏸ | Free: ítems bloqueados → `/sin-acceso?feature=` |
| Barra inferior mobile | — | ⏸ | ⏸ | ⏸ | ⏸ | ⏸ | Free: 5 ítems; resto: 4 + herramientas |
| Menú radial mobile (7 herramientas) | — | — | 🔎 QA-010 | 🔎 QA-010 | 🔎 QA-010 | — | test `03` escrito (⏸) |
| Parámetros inválidos / deep links / refresh | ⏸ | ⏸ | ⏸ | ⏸ | ⏸ | ⏸ | `03` (UUID inexistente, slugs, XSS en query) |

## 2. Herramientas públicas y Free

| Feature | Anon | Free | Beta | Paid | Admin | Tests / notas |
|---|---|---|---|---|---|---|
| Landing | ✅ ✅ (enlaces) · 🐞 QA-020 | — | — | — | — | `00`, `17`, `09` |
| Calculadora: render Demo, cálculo, invariantes, 0, inválidos, grandes | ✅ ✅ · 🐞 QA-006/011 | ⏸ | ⏸ | ⏸ | ⏸ | `04`; motor único; sin NaN |
| Calculadora: CTA de registro al personalizar | ✅ ✅ | — | — | — | — | |
| Calculadora Free: plantillas = referencias, no stock físico (D010) | — | 🔎 + ⏸ | — | — | — | código: `POST /api/calculator/selections` solo escribe tablas de selección |
| Calculadora Paid: usa entidades físicas, "Guardar como producto" | — | — | ⏸ | ⏸ | ⏸ | |
| Calculadora ante fallas de API (500/abort/lento/JSON/vacío) | ✅ ✅ | ⏸ | ⏸ | ⏸ | ⏸ | `06` |
| Explorar Modelos: UI (resultados, vacío, error, timeout, 429, paginación, filtros bloqueados, race) | ✅ ✅ (API mockeada) | ⏸ | ⏸ | ⏸ | ⏸ | `07`; "Calcular en Stampa" solo Paid |
| Explorar Modelos: contrato real y provider caído | ✅ ✅ | — | — | — | — | clave falsa → 403 del provider → 200 con `sources[].status=error` |
| Explorar Modelos con providers reales | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | sin credenciales de providers |
| Tienda pública `/tienda/[slug]` | 🐞 QA-002/008 (slug inexistente) | — | — | — | — | con `E2E_STORE_SLUG` ⏸ (DTO sin costos/IDs) |
| Perfil / canje Beta (Free) | — | ⏸ | — | — | — | `15` |

## 3. Plataforma (requiere acceso)

| Feature | Free | Beta | Paid | Admin | Tests / notas |
|---|---|---|---|---|---|
| Inicio `/` y health de 28 pantallas (carga, sin loading infinito, sin NaN, consola limpia) | bloqueado ✅ (matriz anon) ⏸ | ⏸ | ⏸ | ⏸ | `10` |
| Stampy: UI, composer, lanzador global | bloqueado ⏸ | ⏸ | ⏸ | ⏸ | `16`; autorización por server action 🔎 (owner check de conversación OK) |
| Stampy: conversación real / inyección de contexto | — | ⏸ (mutante) | ⏸ (mutante) | ⏸ | consume OpenAI y escribe historial |
| Academia: listado, curso, clase, progreso | bloqueado ⏸ | ⏸ | ⏸ | ⏸ | `15`; contenido no publicado: depende de RLS (RIESGO-03) |
| Mi Taller → Impresoras (lectura, catálogo, editor) | bloqueado ⏸ | ⏸ | ⏸ | ⏸ | `11` |
| Mi Taller → Impresoras CRUD mutante, doble submit, validaciones | — | ⏸ | ⏸ | ⏸ | 🔎 QA-014 |
| Mi Taller → Filamentos (spool físico, templates vs físicos, barcode) | — | ⛔ | ⛔ | ⛔ | 🔎 mismo patrón QA-014; sin test de flujo |
| Mi Taller → Productos (receta, costos, precio) | — | ⛔ | ⛔ | ⛔ | |
| Mi Taller → Inventario: **Registrar producción** (consume material, suma terminado) / **Ajustar** (no consume) | — | ⛔ | ⛔ | ⛔ | reglas D005 verificadas solo por tests unitarios/código; requiere seed |
| Mi Negocio → hub y navegación | bloqueado ⏸ | ⏸ | ⏸ | ⏸ | `12` |
| Catálogo: crear reventa, buscar, archivar/reactivar, validaciones | — | ⏸ | ⏸ | ⏸ | `12` (mutante); barcode duplicado/archivado: 🔎 |
| Venta rápida: carrito, stock máximo, pago efectivo/transferencia/deuda, doble clic | — | ⏸ | ⏸ | ⏸ | `12`; idempotencia 🔎 ✔; QA-015 |
| Showroom/Depósito (2/10→venta 5→0/7; 5/10→3→2/10; > total rechazado) | — | 🔎 | 🔎 | 🔎 | SQL `confirm_business_showroom_sale` revisado (coincide); E2E ⛔ (requiere locations + seed) |
| Ventas: listado, detalle, anular (stock restaurado, idempotente, historia intacta) | — | ⏸ | ⏸ | ⏸ | `12`; 🐞 QA-022 (límite 50) |
| Clientes: crear, editar, deuda, cobro, sobrepago, reverso por anulación | — | ⏸ | ⏸ | ⏸ | `12`; 🐞 QA-019 (saldo truncado) |
| Reposición / compra a proveedor | — | ⏸ (lectura) | ⏸ | ⏸ | edición masiva de costos: ⛔ |
| Métricas (semana/mes, NaN, void excluidas) | — | ⏸ | ⏸ | ⏸ | `12` (sin NaN); exclusión de anuladas 🔎 (RPC filtra `completed`) |
| Ticket: layout, datos, no factura | — | ⏸ | ⏸ | ⏸ | 🐞 QA-023; impresión térmica ⛔ |
| Pedidos online / Mi Tienda / Mercado Pago | — | ⛔ | ⛔ | ⛔ | webhooks y checkout no se prueban contra datos reales |
| Presupuestos | — | ⛔ | ⛔ | ⛔ | solo health de pantalla ⏸ |
| Librería STL: grupos, modelo, visor, descarga, error del visor | bloqueado ⏸ | ⏸ | ⏸ | ⏸ | `13`; previews 360°/3MF reales ⛔ (WebGL + MediaRecorder + datos) |
| Stampa Maker / Sorteos / Redes / Canales | — | ⏸ (carga) | ⏸ | ⏸ | Jarros solo Admin 🔎 (layout con rol) |
| Configuración / Perfil | ⏸ (Perfil) | ⏸ | ⏸ | ⏸ | QA-024 |
| XP | — | ⛔ | ⛔ | ⛔ | server-authoritative 🔎 |

## 4. Admin

| Feature | Anon | Free | Beta/Paid | Admin | Tests / notas |
|---|---|---|---|---|---|
| Acceso a `/admin/*` (18 rutas) | ✅ → `/login` | ⏸ → `/sin-acceso` | ⏸ → `/` | ⏸ | `01`, `10`, `14` |
| Hub y 16 secciones sin 404/5xx | — | — | — | ⏸ | `14` |
| Usuarios: cambio de rol/membresía | — | — | — | 🔎 QA-016/017 | PATCH interceptado (no escribe) |
| Usuarios: otorgar Beta (action) | — | — | — | ⛔ | |
| STL: categorías, modelos, variantes, preview 360° | — | — | — | ⏸ (lectura) | escritura ⛔ |
| Cursos, roadmaps, sorteos, Stampy (contextos/documentos/transcripciones), insignias, códigos legacy, membresía | — | — | — | ⏸ (carga) | CRUD completo ⛔ |
| Mobile del Admin | — | — | — | ⏸ (overflow a 390/1280) | |

## 5. Transversales

| Aspecto | Resultado | Tests |
|---|---|---|
| Responsive 320/360/375/390/412/430 + 1280/1440 (8 pantallas públicas) | ✅ sin overflow ni controles fuera de pantalla | `05` |
| Responsive de plataforma/admin | ⏸ | `05` |
| Contraste / nombres accesibles (axe) | 🐞 QA-020 (contraste), QA-021 | `09` |
| Consola / red (monitor en todos los tests) | ✅ limpio salvo QA-003/004 y los hallazgos de QA-002/005 | `findings.ndjson` |
| Fallas de red (500, abort, lento, JSON inválido, vacío, doble submit) | ✅ Calculadora, Auth, Explorar Modelos · ⏸ STL | `06`, `07`, `13` |
| Seguridad API anónima (no hay datos sin sesión; cron; callback) | ✅ · 🐞 QA-012/013 · 🔎 QA-009 | `08` |
| Autorización server actions (33 de Mi Negocio + admin + stampy) | 🔎 todas validan sesión/acceso y `user_id` | — |
| RLS / IDOR (usuario A vs B) | ⛔ RIESGO-01/02/03 | requiere DB descartable + `20261014_qa_rls_audit.sql` |
| Performance básica | ✅ páginas públicas ≈ 1,2 MB, `load` < 200 ms local, sin loops; duplicados = prefetch RSC | exploración |
| Enlaces rotos / muertos / externos inseguros | ✅ | `17` |
