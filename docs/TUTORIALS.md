# TUTORIALS

Sistema unificado de tutoriales de Universo Stampa: guía visual paso a paso + video opcional, con un único modal reutilizable. Decisión en D036; resumen de arquitectura en ARCHITECTURE §24.

## 1. Cómo funciona (arquitectura)

```
src/lib/tutorials/
  types.ts            modelo de datos (TutorialDefinition, TutorialStep, ilustraciones, iconos permitidos)
  definitions/*.ts    CONTENIDO: un objeto por tutorial (datos puros, sin JSX)
  registry.ts         TUTORIAL_LIST + TUTORIAL_ROUTES (ruta → tutorial) + resolveTutorialId()
  state.ts            navegación del modal (reducer puro) y resolución del video
  video.ts            URL de video → reproductor seguro (YouTube / Bunny / enlace) o null
  progress.ts         "ya lo vio" por usuario y versión (Supabase + espejo local) y override de tool_tutorials
src/components/tutorials/
  GlobalToolTutorial  montado una vez en main-layout: detecta la sección, abre solo el primer acceso, botón "¿Cómo funciona?"
  TutorialModal       Dialog compartido (Escape, foco, scroll lock) + estado del modal
  TutorialPanel       encabezado, paso, progreso y botones (presentacional)
  TutorialIllustration  renderiza las ilustraciones declarativas
  tutorial-icons.ts   nombre de icono → lucide
```

Reutiliza lo que ya existía: el montaje en `main-layout`, la clave `tool_key`, la tabla `user_tool_tutorial_views`, el botón flotante y el `Dialog` compartido. El modal anterior (video-only) y `ToolTutorial.tsx` (sin usos) se reemplazaron: hay un solo sistema.

**Quién lo ve:** solo usuarios con acceso a la plataforma (`hasPlatformAccess`, igual que antes). Free y anónimos no ven tutoriales. Nunca en `/landing`, `/login`, `/registro`, `/sin-acceso`, `/admin`.

## 2. Tutoriales existentes

| id (`tool_key`) | Herramienta | Rutas | Pasos |
|---|---|---|---|
| `dashboard` | Inicio | `/` | 3 |
| `courses` | Academia | `/academia`, `/cursos/*`, `/talleres/*` | 3 |
| `stampy` | Stampy | `/stampy` | 3 |
| `calculator` | Calculadora | `/calculadora` | 4 |
| `model_search` | Explorar Modelos | `/explorar-modelos` | 4 |
| `stl_library` | Librería STL | `/libreria-stl/*` | 3 |
| `maker` | Stampa Maker | `/stampa-maker` (solo el hub) | 3 |
| `workshop` | Mi Taller | `/mi-taller` (solo el hub) | 4 |
| `printers` | Impresoras | `/mi-taller/impresoras` | 3 |
| `stock` | Filamentos e inventario | `/mi-taller/filamentos`, `/mi-taller/inventario`, `/stock` | 3 |
| `products` | Productos | `/mi-taller/productos`, `/productos` | 3 |
| `business` | Mi Negocio | `/mi-negocio` (solo el hub) | 4 |
| `budgets` | Presupuestos | `/presupuestos` | 3 |
| `raffles` | Sorteos | `/sorteos` | 3 |
| `settings` | Configuración | `/configuracion` | 3 |

Los ids `dashboard`, `courses`, `stampy`, `calculator`, `budgets`, `products`, `stock`, `printers`, `stl_library`, `raffles` y `settings` ya existían como `tool_key`: **no renombrarlos** (se perdería el estado de "ya visto"). `workshop`, `business`, `maker` y `model_search` son nuevos: se abren solos una vez por usuario.

Las pantallas de trabajo pesado (venta rápida, catálogo, editores de Maker, ficha de curso/modelo) no abren la guía solas: solo los hubs. Para sumar una, agregar su ruta en `TUTORIAL_ROUTES`.

## 3. Cómo crear un tutorial nuevo

1. **Definirlo** en `src/lib/tutorials/definitions/<archivo>.ts`:

```ts
export const miHerramientaTutorial: TutorialDefinition = {
  id: "mi_herramienta",          // único y estable: es la clave persistida
  toolName: "Mi herramienta",    // encabezado
  title: "Qué vas a poder hacer",
  description: "Una frase.",
  version: 1,
  steps: [
    {
      id: "paso-1",
      title: "Título corto",
      text: "Una o dos frases.",
      illustration: { kind: "flow", nodes: [{ icon: "printer", label: "Impresora" }, { icon: "calculator", label: "Costo" }] },
    },
    // 3 a 5 pasos
  ],
};
```

2. **Registrarlo** en `registry.ts`: sumarlo a `TUTORIAL_LIST` y mapear su ruta en `TUTORIAL_ROUTES` (lo específico antes que lo general; `exact: true` para limitarlo a la ruta sin subrutas).
3. Listo. El modal, el primer acceso, el botón "¿Cómo funciona?", la persistencia y el video funcionan sin tocar nada más. `tests/tutorials.test.mjs` valida solo la estructura (ids únicos, 3–5 pasos, iconos válidos, rutas) y hay que subir el `15` del test de conteo.

**Reglas de contenido:** explicar únicamente lo que la pantalla hace hoy (verificar en el código y en `PRODUCT.md`); no prometer funciones incompletas; texto corto (título de pocas palabras, 1–2 frases); voseo rioplatense como el resto de la app.

## 4. Cómo modificar pasos e ilustraciones

Editar el objeto en `definitions/`. Cada paso lleva una `illustration` declarativa:

| `kind` | Sirve para | Campos |
|---|---|---|
| `flow` | secuencia / cómo se encadena un flujo | `nodes: { icon, label, hint? }[]` (el último nodo se resalta) |
| `cards` | accesos, paneles u opciones de la herramienta | `items: { icon, title, text?, tone?: "accent" }[]` |
| `breakdown` | estructura de un cálculo (sin importes inventados: barras en lugar de números) | `rows, subtotal, result, note?` |
| `chat` | ejemplos de conversación (Stampy) | `messages: { from: "user" \| "stampy", text }[]` |
| `filters` | barra de búsqueda + filtros | `search, groups: { label, options, active? }[]` |

Las ilustraciones representan componentes reales con **tokens del tema** (`bg-stampa-*`, `text-fg`…), así que se ven bien en claro, oscuro y automático sin lógica de tema. No se usan capturas de pantalla (se desactualizan y no se pueden inventar funciones).

**Agregar un tipo de ilustración nuevo:** sumar el caso a `TutorialIllustration` en `types.ts` y su render en `components/tutorials/TutorialIllustration.tsx` (con tokens, listas semánticas y sin colores literales; `tests/tutorials.test.mjs` lo verifica).

**Agregar un icono:** sumar el nombre a `TUTORIAL_ICON_NAMES` (`types.ts`) y su componente de lucide a `tutorial-icons.ts` (el `Record` es exhaustivo: no compila si falta).

## 5. Cómo incorporar un video

En la definición del tutorial:

```ts
video: { url: "https://youtu.be/XXXXXXXXXXX" },
```

- Acepta YouTube (`watch`, `youtu.be`, `embed`; se embebe con `youtube-nocookie.com`), Bunny (`https://player.mediadelivery.net/embed/...`) o cualquier `https` (se muestra un botón "Abrir video" a una pestaña nueva).
- La guía visual **no se quita**: el modal muestra el selector **Guía visual | Ver video** (solo cuando hay video).
- Sin video no existe selector, reproductor, botón deshabilitado ni error. Una URL vacía, `PENDIENTE_*`, inválida o no `https` equivale a "sin video".
- El reproductor es un `iframe` `loading="lazy"` que **solo se monta cuando la persona elige "Ver video"**, sin autoplay, con los controles del proveedor.
- Alternativa sin deploy: cargar la URL en `tool_tutorials.video_url` (fila con `tool_key` = id del tutorial). Se usa solo si el tutorial no define `video` en el código. Una fila con `is_active = false` apaga ese tutorial (interruptor existente); la ausencia de fila no desactiva nada.
- Un video nuevo **no** cambia la versión ni reabre el tutorial a quien ya lo vio.

## 6. Versionado

`version` (entero, empieza en 1). Subirlo vuelve a mostrar la guía automáticamente **solo a quienes vieron una versión anterior de ese tutorial**. Usarlo cuando la herramienta cambió de forma considerable; no para correcciones de texto, videos ni cambios menores (esos se despliegan sin tocar la versión y nadie ve reaparecer nada). Cada tutorial tiene su propia versión: subir una no afecta a las demás.

## 7. Cómo se guarda el estado de visualización

- **Fuente de verdad:** `user_tool_tutorial_views` (una fila por `user_id` + `tool_key`, upsert `onConflict user_id,tool_key`). Columnas existentes `viewed_at`, `dismissed_at` + nueva `seen_version integer not null default 1` (migration `20261031090000_tool_tutorial_versions.sql`, **no aplicada en remoto**).
- **Quién cuenta como "visto":** cualquier fila previa vale versión 1, así que los usuarios que ya cerraron una guía **no la ven de nuevo** por este cambio. Cerrar (X, Escape, clic fuera), omitir o finalizar guardan igual: no vuelve a abrirse sola hasta que suba la versión.
- **Espejo local por usuario:** `localStorage["stampa-tutorial-seen:<userId>:<tutorialId>"] = <versión>`. Evita reabrir la guía si la base no responde o la migration todavía no se aplicó, y al incluir el `userId` dos cuentas en el mismo navegador no mezclan su estado. Gana la versión mayor entre base y espejo.
- **Sin la migration aplicada:** el código lee y escribe sin `seen_version` (reintenta sin la columna). Todo funciona; solo el versionado queda respaldado por el espejo local hasta aplicarla.
- **Reabrir:** el botón flotante **"¿Cómo funciona?"** (`?` en móvil, `? ¿Cómo funciona?` en escritorio) abre el tutorial de la sección cuando se quiera, haya o no sido visto. Reabrir no reinicia nada.

## 8. Accesibilidad y mobile

Diálogo compartido (`Dialog`: `role="dialog"`, `aria-modal`, `aria-labelledby` al título, Escape, scroll lock, restauración del foco al botón que lo abrió); foco contenido con Tab; flechas ← → navegan; barra de progreso con `role="progressbar"`; región `aria-live` en el paso; ilustraciones como listas semánticas; botones de 44 px; el cuerpo hace scroll y el pie con los botones queda fijo dentro del viewport; `motion-reduce` desactiva la animación de paso (y la regla global de `prefers-reduced-motion` acorta el resto).

## 9. Qué verificar manualmente (no automatizable sin cuentas)

Ver `docs/TASKS.md`: primer acceso real con una cuenta nueva y con una que ya había cerrado el tutorial anterior, en claro/oscuro/automático, desktop y 320–430 px.
