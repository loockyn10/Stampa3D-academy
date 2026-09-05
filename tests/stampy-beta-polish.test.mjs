import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the base prompt enforces concise Stampa tone without obsolete capability claims", () => {
  const source = read("src/app/stampy/actions.ts");

  assert.match(source, /asistente experto de Academia Stampa/);
  assert.match(source, /principio de respuesta mínima suficiente/);
  assert.match(source, /Consulta simple: respondé en 1 a 3 frases/);
  assert.match(source, /No cierres obligatoriamente con una pregunta ni con varias opciones/);
  assert.match(source, /Nunca nombres SQL, RPC, action_request, can_execute, metadata ni Supabase/);
  assert.doesNotMatch(source, /No podés todavía:\s*\n- crear datos/);
  assert.doesNotMatch(source, /Revisá la configuración de OpenAI/);
  assert.match(source, /Llegaste al límite de mensajes por ahora/);
});

test("the base prompt defines a pedagogical everyday voice with progressive depth", () => {
  const source = read("src/app/stampy/actions.ts");

  assert.match(source, /VOZ PEDAGÓGICA ADAPTATIVA/);
  assert.match(source, /persona con mucha experiencia en impresión 3D que ayuda a alguien común/);
  assert.match(source, /Respondé primero la pregunta/);
  assert.match(source, /nivel conocido del usuario, cómo formuló la pregunta y el detalle que pidió/);
  assert.match(source, /Con alguien que recién empieza, explicá una idea por vez/);
  assert.match(source, /Con nivel intermedio, usá el vocabulario habitual/);
  assert.match(source, /Con nivel avanzado, o si la propia pregunta usa conceptos avanzados con precisión/);
  assert.match(source, /slicer, G-code, retracción, infill/);
  assert.match(source, /ejemplo corto de una impresión real/);
  assert.match(source, /analogía sólo si simplifica de verdad y sigue siendo técnicamente correcta/);
  assert.match(source, /No suenes infantil, condescendiente, excesivamente académico/);
  assert.match(source, /"Perfecto", "Excelente", "Buenísimo", "Claro" o "Te explico"/);
});

test("pedagogical guidance keeps answers short when teaching or analogy would not help", () => {
  const source = read("src/app/stampy/actions.ts");

  assert.match(source, /No agregues analogías a respuestas obvias, de navegación/);
  assert.match(source, /Consulta simple: respondé en 1 a 3 frases/);
  assert.match(source, /Si la consulta quedó resuelta, terminá/);
  assert.doesNotMatch(source, /Siempre (?:usá|incluí|agregá) (?:un )?(?:ejemplo|analogía)/i);
});

test("beta quick suggestions are focused and capped for each UI", () => {
  const page = read("src/app/stampy/page.tsx");
  const widget = read("src/components/stampy/GlobalStampyWidget.tsx");

  assert.match(page, /¿Qué filamentos tengo cargados\?/);
  assert.match(page, /Descontame 20g de PLA/);
  assert.match(page, /Creame una impresora Bambu A1 Mini de 350W/);
  assert.match(page, /Ayudame a solucionar warping/);
  assert.match(widget, /suggestedQuestions\.slice\(0, 4\)/);
  assert.match(widget, /¿Qué puedo hacer en esta pantalla\?/);
});

test("confirmation failures and chat clients use safe non-technical messages", () => {
  const executor = read("src/lib/stampy/action-executor.ts");
  const page = read("src/app/stampy/page.tsx");
  const widget = read("src/components/stampy/GlobalStampyWidget.tsx");
  const lessonChat = read("src/components/stampy/StampyLessonChat.tsx");

  assert.doesNotMatch(executor, /message: error\.message \|\|/);
  assert.match(executor, /No hice ningún cambio\. Probá de nuevo o abrí Stock/);
  for (const client of [page, widget, lessonChat]) {
    assert.match(client, /Algo falló al procesarlo\. No hice ningún cambio\. Probá de nuevo/);
  }
});

test("the action card clearly separates prepared, executed and cancelled states", () => {
  const source = read("src/components/stampy/ActionIntentCard.tsx");

  assert.match(source, /Movimiento preparado\. Revisalo y confirmá para aplicarlo/);
  assert.match(source, /Listo, \$\{verb\}/);
  assert.match(source, /Cancelaste esta acción\. No hice ningún cambio/);
  assert.doesNotMatch(source, /Acción descartada por el usuario/);
});
