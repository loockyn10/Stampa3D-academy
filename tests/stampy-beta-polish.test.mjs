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
