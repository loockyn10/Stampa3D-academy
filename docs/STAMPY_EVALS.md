# Stampy — evaluación conversacional (QA manual)

Batería reproducible para comparar el comportamiento conversacional de Stampy entre cambios de prompt, modelo o flujo. No es un sistema automático de evals: se corre y se revisa a mano con la rúbrica de cada caso.

## Cómo correrla

```bash
node scripts/stampy-eval.mjs                         # dry run: muestra intención, follow-up, herramientas y tamaño del request; no llama a OpenAI
node scripts/stampy-eval.mjs --live --out eval.md    # llama a OpenAI con OPENAI_API_KEY/OPENAI_MODEL/STAMPY_* (entorno o .env.local)
node scripts/stampy-eval.mjs --live --only material-switch,continuity-the-other
```

- Casos: `scripts/stampy-eval-cases.json` (mensaje, historial opcional, clase opcional, clases recuperadas simuladas, `expect`/`avoid`).
- El script arma el mismo request de Responses API que `askStampyAction` (system prompt, clase actual, orientación por intención, herramientas, clases recuperadas, historial con roles) pero **sin Supabase**: no hay perfil, taller, pantalla, memoria ni retrieval. Evalúa la capa conversacional, no el pipeline completo.
- Para el pipeline completo, repetir los mismos mensajes en la app (página `/stampy`, widget y chat de clase) con una cuenta de prueba.

## Casos

| id | categoría | qué mide |
|---|---|---|
| simple-infill | pregunta simple | respuesta directa y corta, sin derivar |
| technical-first-layer | problema técnico | orientación útil primero, pasos en orden, sin cuestionario |
| followup-why | follow-up corto | "¿por qué?" se refiere al consejo anterior |
| material-switch | cambio de material | "¿y con PETG?" mantiene el problema (primera capa) |
| ambiguous-buy | pregunta ambigua | una sola pregunta aclaratoria |
| tool-pricing | herramienta de Stampa | explica factores y después ofrece la Calculadora avanzada |
| tool-pricing-numbers | herramienta de Stampa | no inventa un precio final; ofrece la Calculadora |
| class-recommended | clase recomendada | menciona sólo la clase recuperada, con título exacto, sin links |
| class-not-found | sin clase recomendada | ayuda igual; no dice "no tenemos una clase" |
| detailed-retraction | explicación detallada | respuesta desarrollada sin recorte artificial |
| continuity-the-other | continuidad | "¿y la otra?" = raft tras hablar de brim |
| lesson-followup | continuidad en clase | "explicame mejor" dentro de una clase |
| identity | identidad | se presenta como Stampy, no como ChatGPT |

## Resultados — sprint de calidad conversacional (2026-10-06)

**Antes** (verificado leyendo el código previo, commit `890d29c`; no se corrió el modelo viejo en vivo):

| caso | comportamiento previo |
|---|---|
| material-switch | La intención se clasificaba sólo con "¿y con PETG?" → `material_help` + directiva "Dá un rango práctico como punto de partida": empujaba a una ficha de temperaturas de PETG en vez de adherencia de primera capa. Retrieval y clases buscaban sólo "¿y con PETG?". |
| followup-why / continuity-the-other / lesson-followup | Sin intención ni retrieval (mensaje sin keywords). El historial sí viajaba con roles (8 mensajes × 1200 chars), pero usuario y asistente del mismo turno comparten `created_at` y su orden no estaba garantizado. |
| tool-pricing | Las herramientas detectadas no llegaban al prompt (sólo como tarjetas en `/stampy`); la regla "derivá al usuario a Presupuestos o Calculadora" favorecía responder sólo con la derivación. |
| class-not-found | El servidor agregaba "No encontré una clase específica que coincida con esta consulta." a la respuesta. |
| class-recommended | El modelo no veía las clases; el servidor agregaba "Te recomiendo ver: X dentro de Y." después de la respuesta. |
| lesson-followup | El prompt no incluía título/resumen de la clase (sólo la transcripción si existía). |
| detailed-retraction | "Consulta simple: respondé en 1 a 3 frases" + "respuesta mínima suficiente" + múltiples "no agregues…" limitaban el desarrollo. |
| fallo del modelo | El texto vacío del modelo se guardaba como "No pude responder esta vez" con `mode: openai`/`status: success`; el log de error incluía el objeto de error completo. |

**Después** (`--live`, `gpt-5.6-terra`, reasoning `low`, verbosity default; latencia y tokens del run):

| caso | resultado | notas |
|---|---|---|
| simple-infill | ✅ define, rangos orientativos, sin derivar | ~180 palabras: algo más largo que lo ideal; `STAMPY_TEXT_VERBOSITY=low` lo acorta poco |
| technical-first-layer | ✅ causa probable + 5 pasos en orden con valores como punto de partida | 7 s |
| followup-why | ✅ explica humedad/temperatura/retracción en PETG sin cambiar de tema | |
| material-switch | ✅ adherencia de primera capa con PETG (offset Z más alto, cama 70-80 °C, separador) | antes se desviaba a ficha de material |
| ambiguous-buy | ✅ una sola pregunta clara | |
| tool-pricing | ✅ factores + fórmula + ejemplo ilustrativo, Calculadora avanzada al final | |
| tool-pricing-numbers | ✅ (tras ajuste) estructura de la cuenta sin precio final; Calculadora avanzada | la 1.ª corrida dio un rango "$6.000 a $12.000+": se endureció la regla de precios |
| class-recommended | ✅ título y curso exactos, sin links ni clases inventadas | responde sólo con la clase (pregunta directa por un video) |
| class-not-found | ✅ (tras ajuste) "no pude ubicar un video puntual", sugiere Cursos y ayuda con soportes | la 1.ª corrida sólo derivaba: se ajustó la instrucción |
| detailed-retraction | ✅ explicación completa y estructurada (física, parámetros, calibración, tabla de síntomas, materiales) | 2365 tokens / 26 s: pide streaming |
| continuity-the-other | ✅ entiende "la otra" = raft | |
| lesson-followup | ✅ amplía desde otro ángulo dentro del marco de la clase | |
| identity | ✅ "Soy Stampy, el asistente de Academia Stampa" | |

Pendiente: repetir la batería en la app real (perfil, taller, pantalla, memoria y retrieval activos) y en el chat de una clase con transcripción.

## Streaming (análisis, no implementado)

La Responses API soporta streaming (`stream: true` / `responses.stream()` con eventos `response.output_text.delta`), pero integrarlo hoy no es un cambio chico:

- `askStampyAction` es un server action que devuelve un objeto completo (respuesta + tarjetas de herramientas/clases + `actionIntent` + ids para feedback). Hacer streaming requiere un Route Handler con `ReadableStream`/SSE y un protocolo de eventos (delta de texto + metadata final).
- Post-proceso que necesita la respuesta entera: `isolateCurrentStampyReply` (quita repeticiones de turnos previos), persistencia en `stampy_messages`, guardado de memoria y `assistantMessageId` para feedback.
- Tres clientes (`/stampy`, `GlobalStampyWidget`, `StampyLessonChat`) renderizan Markdown completo; habría que soportar Markdown parcial y estados de cancelación/error a mitad de stream.

Propuesta para el próximo sprint: Route Handler `POST /api/stampy/chat` que reutilice el armado de contexto de `askStampyAction` (extraído a una función compartida), emita deltas por SSE y al final un evento con metadata y ids; aplicar la limpieza de repeticiones al texto final antes de persistir; un hook cliente común para los tres chats. Los atajos deterministas pueden seguir respondiendo en un solo evento.
