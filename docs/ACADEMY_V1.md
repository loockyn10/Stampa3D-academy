# Academia Stampa — preparación V1.0 (Sprint 3)

Decisión: `docs/DECISIONS.md` D047. Arquitectura: `docs/ARCHITECTURE.md` §30. Sin migraciones.

## 1. Estado

| Pieza | Estado |
|---|---|
| Correcciones de reproducción, progreso, navegación, catálogo y admin | **Hecho en código** — `tests/academy-sprint3.test.mjs` |
| Inventario de contenido real | **Pendiente** — correr `supabase/diagnostics/20261105_academy_content_inventory.sql` (solo lectura) |
| Protección de videos de Bunny con token | **Lista en código, apagada** hasta configurar `BUNNY_STREAM_TOKEN_KEY` (§3) |
| QA con cuenta Premium (desktop y 375 px) | **Pendiente** (§4) |

## 2. Inventario de contenido

No se puede saber desde el repo cuántos cursos hay ni si tienen video (la base exige acceso Premium). Correr el diagnóstico bloque por bloque en el SQL Editor:

- **A** — un renglón por curso/taller con módulos y clases visibles, clases con video, sin video o con enlace no reconocido, y un veredicto: `lista para V1.0`, `publicado con clases sin video`, `PUBLICADO SIN CLASES` o `no publicado (…)`.
- **B** — totales por estado y tipo.
- **C** — lista de clases visibles sin video o con enlace no reconocido en cursos publicados (lo que el alumno vería como «no disponible»).
- **D** — recursos descargables por origen (storage privado / enlace externo).
- **E** — policies y privilegios de las tablas de Academia (deben exigir acceso Premium).

Decidir con ese resultado qué se ofrece en V1.0: lo que no esté «lista para V1.0» conviene pasarlo a **Próximamente** desde `/admin/cursos/[id]` (no se modificó ningún curso).

## 3. Bunny Stream

**Cómo funciona hoy (código):**
- `lessons.video_url` guarda el enlace que pega el admin (URL o iframe completo).
- El reproductor ya **no** usa ese valor directo: pide la URL a `getLessonPlaybackAction`, que aplica la misma barrera que el progreso (sesión, Academia, Premium, curso publicado, clase y módulo activos) y normaliza el enlace (`src/lib/academy/video.ts`). Solo se embeben URLs https de Bunny, YouTube, Vimeo o archivos de video.
- La base (RLS) ya exige `has_platform_access` para leer `lessons` (diagnóstico del 2026-11-04): un usuario Free no puede leer las URLs.

**Riesgo actual:** un socio puede copiar la URL del iframe y compartirla. Si la librería de Bunny no tiene token ni restricción de dominio, esa URL se reproduce en cualquier lado y para siempre.

**Activar la protección (en este orden, sin cortar las clases):**
1. Desplegar este código.
2. Bunny → Stream → la librería → **Security**: copiar la *Token authentication key* (no pegarla en el chat).
3. Vercel → Production: `BUNNY_STREAM_TOKEN_KEY` = esa clave. Redeploy. Desde ahí las URLs salen firmadas (vencen a las 4 h).
4. Abrir una clase con la cuenta Premium y comprobar que el `src` del iframe trae `token=` y `expires=` y que el video se reproduce.
5. Recién entonces activar en Bunny **Embed view token authentication**. Opcional: *Allowed referrers* con el dominio de Universo.
6. Comprobar que la misma URL **sin** `token` da 403 y que la clase sigue reproduciéndose en la app.

Si en el paso 6 las clases no cargan: desactivar el token en Bunny (vuelve a funcionar al instante) y revisar la clave.

## 4. Validaciones manuales (cuenta Premium de prueba, desktop y 375 px)

1. `/academia`, `/cursos`, `/talleres`: los conteos de clases coinciden con lo que se ve dentro del curso; un curso sin clases dice «Clases en preparación».
2. Entrar a un curso nuevo: abre la primera clase; el video se reproduce; «Marcar completada» avanza a la siguiente.
3. Salir y volver (o recargar): abre la primera clase **pendiente**; la URL tiene `?clase=`.
4. Navegar con «Anterior» / «Siguiente», también de un módulo al siguiente; en el celular, elegir una clase del temario lleva al video.
5. Abrir un recurso: se abre en otra pestaña sin bloqueo de popups.
6. Clase sin video: mensaje «Esta clase no tiene video…».
7. Cortar la conexión y recargar: «No pudimos cargar el curso» con «Reintentar».
8. Inicio → «Continuar aprendiendo» → el porcentaje coincide con el del curso.
9. Cuenta Free: `/cursos/<id>` → pantalla de acceso; sin sesión → login y vuelta al curso.
10. Admin: pegar un enlace inválido en una clase → no se guarda y se explica; pegar un iframe completo de Bunny → «Reconocido: Bunny Stream».

## 5. Pendiente / fuera de alcance

- Las recomendaciones de Stampy usan `lessons.is_published`; el curso, el catálogo e Inicio usan `is_active`. Si ambos flags existen y difieren, Stampy puede recomendar una clase oculta o no recomendar una visible (no se tocó Stampy).
- El curso hace 5 consultas en cascada desde el navegador (`select("*")`); funciona, pero conviene moverlo al servidor después de V1.0.
- Sin seguimiento de reproducción (posición del video, % visto): el progreso es «completada» por clase.
