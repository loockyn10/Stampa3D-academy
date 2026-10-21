# Suite E2E de Universo Stampa (Playwright)

Suite reutilizable que simula usuarios reales (UI + red) por rol. Complementa los tests `tests/*.test.mjs` (lógica, `node --test`).
Resultado del primer sprint QA y bugs conocidos: [`docs/QA_REPORT.md`](../../docs/QA_REPORT.md) y [`docs/QA_MATRIX.md`](../../docs/QA_MATRIX.md).

## Ejecutar

```bash
npm run build                      # la suite usa `next start` (build de producción) en el puerto 3100
npm run test:e2e                   # toda la suite, proyectos desktop (1440×900) y mobile (Pixel 7, 390×844)
npm run test:e2e:smoke             # solo smoke global
npm run test:e2e:report            # abre playwright-report/
npx playwright test --project=desktop -g "Calculadora"   # filtros habituales de Playwright
```

Por defecto usa el **Chrome instalado** (`E2E_BROWSER_CHANNEL=chrome`); no descarga navegadores. `E2E_BROWSER_CHANNEL=msedge` usa Edge y
`E2E_BROWSER_CHANNEL=` (vacío) el Chromium propio de Playwright (requiere `npx playwright install chromium`).

> **Entorno.** `.env.local` apunta a **un único Supabase remoto** (el mismo de la beta). Mientras no exista un proyecto de test,
> todo lo que corre acá contra `next start` local **lee** ese Supabase como si fuera producción. Por eso:
> * los tests **mutantes** están desactivados por defecto (ver abajo);
> * los tests anónimos solo hacen requests de lectura, o escrituras que Supabase rechaza antes de tocar datos (login inválido).
> * nunca se envía un webhook, un checkout ni un registro real.

## Variables de entorno

Nunca se guardan secretos en el repo. Se leen del entorno (PowerShell: `$env:E2E_PAID_EMAIL="..."`; o un `.env` fuera del repo cargado con tu herramienta favorita).

| Variable | Para qué |
|---|---|
| `E2E_BASE_URL` | Apunta a un deploy existente (preview/staging). Si falta, se levanta `next start` local. |
| `E2E_TARGET_ENV` | Etiqueta informativa: `local` \| `preview` \| `staging` \| `production`. |
| `E2E_FREE_EMAIL` / `E2E_FREE_PASSWORD` | Cuenta **Free** (autenticada, sin membresía ni grant). |
| `E2E_BETA_EMAIL` / `E2E_BETA_PASSWORD` | Cuenta con grant `beta_tester` **activo** (completó onboarding). |
| `E2E_PAID_EMAIL` / `E2E_PAID_PASSWORD` | Cuenta con membresía **activa** (no admin, no beta; completó onboarding). |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | Cuenta `role=admin`. |
| `E2E_BETA_EXPIRED_*` / `E2E_BETA_REVOKED_*` | Cuentas con grant `beta_tester` vencido / revocado (opcional). |
| `E2E_ALLOW_MUTATIONS=1` | Habilita los tests que escriben datos. **Solo contra un Supabase descartable.** |
| `E2E_DATA_PREFIX` | Prefijo de todo dato creado (por defecto `ZZ-E2E`) para identificarlo y limpiarlo. |
| `E2E_BETA_CODE_VALID` / `E2E_BETA_CODE_INVALID` | Códigos Beta de un entorno descartable (uno de un solo uso válido; uno inexistente). |
| `E2E_STORE_SLUG` | Slug de una tienda de test publicada, para los tests de tienda pública. |
| `E2E_FAKE_PROVIDER_KEY` | Clave **falsa** para que el servidor local muestre la UI de Explorar Modelos (por defecto `e2e-fake-key-not-valid`). |
| `E2E_WORKERS`, `E2E_LOCAL_PORT` | Paralelismo (2) y puerto del servidor local (3100). |

Sin credenciales de un rol, sus tests quedan **skipped con el motivo** (`faltan E2E_PAID_EMAIL / E2E_PAID_PASSWORD`); nunca pasan en falso.
`auth.setup.ts` inicia sesión por UI una vez por rol y guarda `tests/e2e/.auth/<rol>.json` (git-ignorado).

## Estructura

```
playwright.config.ts          proyectos setup / desktop / mobile, webServer local
tests/e2e/
  auth.setup.ts               login por UI por rol → storageState
  support/
    env.ts                    roles, credenciales, flags de mutación, prefijos
    fixtures.ts               `test` con monitor automático, describeAsRole, describeMutating, gotoSettled
    monitor.ts                registra console.error / pageerror / requestfailed / HTTP 4xx-5xx por test
    known-issues.ts           allowlist JUSTIFICADA de hallazgos conocidos (con id QA-xxx)
    routes.ts                 matriz ruta × rol (derivada de src/utils/supabase/middleware.ts)
    ui-audit.ts               overflow horizontal, controles fuera de pantalla, áreas táctiles, fuentes < 16px
    auth.ts, viewports.ts
  specs/
    00-smoke                  páginas públicas, assets, 404
    01-access-matrix          ruta × rol (anonymous/free/beta/paid/admin/beta vencida/revocada)
    02-auth                   login/registro/recuperación/logout/sesión/returnTo/open-redirect
    03-navigation             header público, sidebar desktop, barra inferior y menú radial mobile, rutas inválidas
    04-calculator             motor único, invariantes, inputs inválidos, CTA Anonymous, Free/Paid
    05-responsive.desktop-only  320/360/375/390/412/430 y 1280/1440 en todas las pantallas
    06-network-failures       500/abort/lento/JSON inválido/doble submit (route mocking)
    07-explorar-modelos       UI con API mockeada + contrato real; provider caído ≠ bug nuestro
    08-api-security           sondeos no destructivos de la API privada, cron, callback, cabeceras
    09-accessibility.desktop-only  axe-core (nombres accesibles, labels, contraste)
    10-platform-health        cada pantalla de plataforma/admin: carga, sin loading infinito, sin NaN, consola/red limpias
    11-mi-taller              impresoras (lectura + CRUD mutante), manejo de errores de guardado
    12-mi-negocio             catálogo, venta rápida, ventas/void, clientes y deuda, métricas, ticket
    13-libreria-stl           grupos, modelo, visor 3D, descarga, errores del visor
    14-admin                  navegación, usuarios (con PATCH interceptado), STL
    15-academia-perfil-beta   academia, progreso, perfil, Beta activa/vencida/revocada, canje
    16-stampy-storefront      Stampy (lectura/mutante) y tienda pública
    17-links-and-ctas         enlaces rotos / muertos / externos inseguros
```

### Convenciones

* **Locators:** `getByRole` / `getByLabel` / `getByPlaceholder`; el producto casi no tiene `data-testid`. Donde un control de solo ícono no tiene
  nombre accesible se usa una clase de ícono (`.lucide-plus`) y se documenta como bug de accesibilidad (QA-018).
* **Monitor de consola/red:** cada test falla si aparece un `console.error`, `pageerror`, request fallida o 4xx/5xx **no declarada**.
  Para provocar un error a propósito: `monitor.expectHttp({ status: 500, url: "/api/x" })`. Para un hallazgo conocido: entrada en `known-issues.ts`
  con id de bug. Todo lo observado (incluso lo permitido) se escribe en `test-results/e2e/findings.ndjson`.
* **Bugs conocidos:** se codifican como `test.fail(<condición del bug>, "QA-xxx: ...")` *dentro* del test que asevera el comportamiento correcto.
  Mientras el bug exista el test figura como "expected failure"; cuando se corrige, el test pasa a fallar con "expected to fail" y
  hay que **borrar la línea `test.fail`**. Nada se oculta ni se salta.
* **Mutantes:** `describeMutating(...)` exige `E2E_ALLOW_MUTATIONS=1`. Todo dato lleva `E2E_DATA_PREFIX`; los flujos limpian lo que crean (anulan/archivan).
* **Interceptación segura:** tests que verifican "pide confirmación antes de escribir" o "qué pasa si el guardado falla" interceptan el request
  (`page.route`) y lo responden ellos mismos: **no llega nada a la base**, ni siquiera con credenciales reales.

## Cobertura que requiere cuentas / datos (hoy skipped)

Ver la tabla de `docs/QA_MATRIX.md`. En resumen: todo lo autenticado (≈ 1.270 escenarios skipped) se activa al definir las variables `E2E_*`.
Antes de usar cuentas reales, leer el apartado de entorno de arriba.
