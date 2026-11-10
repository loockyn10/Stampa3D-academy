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

## Carga de datos ficticios y grabación (Mi Taller)

Todo usa la interfaz real con la sesión de la cuenta de demostración. Nada accede directo a Supabase.

```bash
node scripts/demo/seed-mi-taller.mjs                 # modo de prueba (por defecto): solo lee y lista qué crearía
node scripts/demo/seed-mi-taller.mjs --apply         # escribe lo pendiente (idempotente: lo que existe se omite)
node scripts/demo/seed-mi-taller.mjs --apply --only=printers,filaments   # pasos: profile, printers, filaments, categories, products, production
node scripts/demo/record-mi-taller.mjs <carpeta>     # graba fotogramas del recorrido (sin ffmpeg, vía CDP screencast)
node scripts/demo/encode-video.mjs <carpeta> public/landing-preview/demos mi-taller   # MP4 + póster
```

- Los datos están en `mi-taller-data.mjs` (ficticios). Si un formulario no se comporta como se espera, el paso se detiene y no fuerza nada.
- La grabación difumina montos, oculta los avisos de costos, se cancela el único formulario que abre y aborta si el email de la cuenta se ve en pantalla.
- En Git Bash las rutas que empiezan con `/` se convierten: usar `MSYS_NO_PATHCONV=1` si se pasan rutas de la app como argumento.

## Academia

```bash
node scripts/demo/seed-academia.mjs            # modo de prueba: impresora principal (Bambu Lab) y 2 clases completadas en Fundamentos
node scripts/demo/seed-academia.mjs --apply    # escribe, solo en la cuenta de demostración
node scripts/demo/record-academia.mjs <carpeta>   # graba el recorrido (usa recorder-lib.mjs)
node scripts/demo/encode-video.mjs <carpeta> public/landing-preview/demos academia --speed=1.0
```

- El reproductor de las clases (iframe externo) arranca solo si el navegador lo permite: la grabación usa `--autoplay-policy=document-user-activation-required`, recarga el curso dentro de un tramo recortado y vuelve a la portada también recortada, así el video nunca muestra una clase reproduciéndose.
- Los tramos de espera de carga se recortan (`cutStart`/`cutEnd` en `recorder-lib.mjs`; `encode-video.mjs` los aplica).

## Stampy IA (consulta REAL: cuesta y escribe)

```bash
node scripts/demo/record-stampy.mjs <carpeta> [--question="..."]
node scripts/demo/encode-video.mjs <carpeta> public/landing-preview/demos stampy --speed=1.0
```

- **Cada ejecución envía una consulta real**: llama a OpenAI con la clave del servidor y escribe una conversación, 2 mensajes y un registro de uso en la cuenta demo (cuenta para el límite de 40/h y 150/día). Ejecutar solo con autorización.
- La respuesta se muestra tal cual y se imprime al final; nunca se edita. Nunca se confirma una acción que Stampy proponga. Lo único que se agrega es un contorno naranja sobre la primera tarjeta de clase recomendada (presentación).
- La espera del modelo se recorta del video (`cutStart`/`cutEnd`).

## Versión cinematográfica (prueba, solo Mi Taller)

Postproduce el material YA grabado sin volver a abrir la app ni tocar la cuenta demo, y sin dependencias nuevas
(no se usa Remotion: el pipeline propio de Edge + canvas alcanza y evita instalar un renderer y su licencia comercial):

```bash
node scripts/demo/cinematic.mjs <carpeta-fotogramas> scripts/demo/directors/mi-taller.json <salida> mi-taller-cine
```

- `directors/mi-taller.json` es el guion: cámara (zoom/desplazamiento), transiciones por desenfoque que reemplazan las pantallas de
  carga, destacados naranjas, rótulos de capítulo y cierre en bucle. La interfaz grabada no se modifica (solo se recorta, mezcla y superpone).
- Los montos siguen difuminados porque ya lo estaban en la grabación original.
- Para verla junto a la original: `/landing-preview?comparar=1` → Mi Taller → selector «Original / Cinematográfica». Sin ese parámetro nadie la ve.
- Para aplicarla a otra herramienta: crear su guion y reemplazar (o agregar) la demostración en `universe-tools.ts`.

## Taller más completo: fotos y productos adicionales (cuenta demo)

```bash
node scripts/demo/render-product-images.mjs                 # renders 3D originales (Three.js) → scripts/demo/assets/products/*.jpg
DEMO_BASE_URL=http://localhost:3100 node scripts/demo/seed-mi-taller-visual.mjs            # modo de prueba
DEMO_BASE_URL=http://localhost:3100 node scripts/demo/seed-mi-taller-visual.mjs --apply   # impresoras del catálogo, fotos y 3 productos más
DEMO_BASE_URL=http://localhost:3100 node scripts/demo/record-mi-taller.mjs <carpeta>      # regrabar
node scripts/demo/cinematic.mjs <carpeta> scripts/demo/directors/mi-taller-v2.json <salida> mi-taller-cine-v2
```

- Las imágenes de producto son **renders** generados por código (sin fotos ni modelos de terceros): no son fotografías.
- Las impresoras salen del catálogo de Stampa (traen su foto). Mi Taller no borra impresoras: «Eliminar» las deja *Inactivas* y siguen listadas (por eso se ve «5 impresoras · 3 activas»).
- Usar `next start` (producción local) para subir fotos: en `next dev` el editor de recorte falla por React StrictMode (revoca la URL del archivo).
- Cada ejecución de `--apply` escribe en la cuenta demo; el script es idempotente.

## Versiones cinematográficas de Academia y Stampy

```bash
node scripts/demo/cinematic.mjs <frames-academia> scripts/demo/directors/academia.json <salida> academia-cine
node scripts/demo/cinematic.mjs <frames-stampy>   scripts/demo/directors/stampy.json   <salida> stampy-cine
```

- Trabajan sobre las grabaciones YA hechas (sin abrir la app, sin nuevas consultas a OpenAI): `cinematic.mjs` aplica los tramos recortados del manifiesto, así que los tiempos de los guiones son los del material recortado.
- Opciones nuevas del guion: `endHold` (segundos con el último fotograma congelado, para dar protagonismo al cierre) y `fadeDark` (el bucle pasa por un fundido breve a oscuro cuando el último y el primer cuadro son pantallas distintas).
- Las grabaciones originales siguen siendo respaldo: `?comparar=1` en `/landing-preview`.
