# Grabación de demostraciones con la cuenta de demostración

Herramientas para producir los videos/capturas de la landing (`/landing-preview`) usando **una cuenta exclusiva de demostración** con datos ficticios.

## Reglas

- Las credenciales **nunca** van al repo, a logs ni a capturas. Se leen del entorno o de `.env.demo.local` (ignorado por Git).
- El login se hace por la pantalla real, en un contexto **sin grabación**; los videos reutilizan la sesión guardada.
- No se desactiva ni se elude ninguna autenticación.
- Salvaguardas: el email debe contener `demo` y el servidor debe ser local (ver abajo).

## Configuración

1. Levantar la app en local: `npm run dev` (http://localhost:3000). Usa el Supabase de `.env.local`.
2. Definir las credenciales, **una** de estas dos formas:

   PowerShell (solo esa terminal):

   ```powershell
   $env:DEMO_ACCOUNT_EMAIL = "demo.universo@ejemplo.com"
   $env:DEMO_ACCOUNT_PASSWORD = "..."
   ```

   o crear `.env.demo.local` en la raíz (ya está ignorado por `.env*`):

   ```
   DEMO_ACCOUNT_EMAIL=demo.universo@ejemplo.com
   DEMO_ACCOUNT_PASSWORD=...
   ```

3. Comprobar el acceso (solo lectura, no guarda capturas ni imprime datos de la cuenta):

   ```bash
   node scripts/demo/check-access.mjs
   ```

## Variables

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DEMO_ACCOUNT_EMAIL` | sí | Email de la cuenta de demostración. Su parte local debe contener `demo`. |
| `DEMO_ACCOUNT_PASSWORD` | sí | Contraseña de esa cuenta. |
| `DEMO_BASE_URL` | no | Por defecto `http://localhost:3000`. Un host no local exige `DEMO_ALLOW_REMOTE=1`. |
| `DEMO_BROWSER_CHANNEL` | no | `msedge` (por defecto) o `chrome`. |
| `DEMO_ALLOW_ANY_EMAIL` | no | `1` salta la salvaguarda del email. No usar con cuentas reales. |

La sesión se guarda en `tests/e2e/.auth/demo-taller.json` (git-ignorado). Para forzar un nuevo login: `--fresh`.
