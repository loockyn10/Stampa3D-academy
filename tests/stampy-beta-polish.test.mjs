import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the base prompt keeps Stampa identity and safety limits without obsolete capability claims", () => {
  const prompt = read("src/lib/stampy/system-prompt.ts");
  const actions = read("src/app/stampy/actions.ts");

  assert.match(prompt, /Sos Stampy, el asistente de Academia Stampa/);
  assert.match(prompt, /No digas que sos ChatGPT/);
  assert.match(prompt, /No cierres obligatoriamente con una pregunta ni con varias opciones/);
  assert.match(prompt, /Nunca nombres SQL, RPC, action_request, can_execute, metadata ni Supabase/);
  assert.doesNotMatch(prompt, /No podés todavía:\s*\n- crear datos/);
  assert.doesNotMatch(actions, /Revisá la configuración de OpenAI/);
  assert.match(actions, /Llegaste al límite de mensajes por ahora/);
  assert.match(actions, /STAMPY_SYSTEM_PROMPT/);
});

test("the base prompt defines a natural, competent rioplatense voice", () => {
  const prompt = read("src/lib/stampy/system-prompt.ts");

  assert.match(prompt, /Cercano, competente, directo y natural/);
  assert.match(prompt, /Español rioplatense suave/);
  assert.match(prompt, /No infantil, no condescendiente/);
  assert.match(prompt, /No sonás como un manual ni como un formulario/);
  assert.match(prompt, /slicer, G-code, retracción, infill/);
  assert.match(prompt, /Ajustá el nivel técnico a cómo pregunta la persona/);
  assert.match(prompt, /analogía sólo si aclaran de verdad y siguen siendo técnicamente correctos/);
  assert.match(prompt, /"Perfecto", "Excelente", "Buenísimo", "Claro" o "Te explico"/);
  assert.match(prompt, /ayudar de verdad con lo que la persona necesita ahora, no derivarla/);
});

test("length policy is concise by default, deep on demand and has no hard word cap", () => {
  const prompt = read("src/lib/stampy/system-prompt.ts");

  assert.match(prompt, /Por defecto, conciso/);
  assert.match(prompt, /desarrollala sin recortarla artificialmente/);
  assert.match(prompt, /Si la persona pide detalle, una explicación a fondo o "explicame mejor", respondé en detalle/);
  assert.match(prompt, /Sin relleno/);
  assert.match(prompt, /Si la consulta quedó resuelta, terminá/);
  assert.doesNotMatch(prompt, /Consulta simple: respondé en 1 a 3 frases/);
  assert.doesNotMatch(prompt, /respuesta mínima suficiente/);
  assert.doesNotMatch(prompt, /1[25]0 palabras/);
  assert.doesNotMatch(prompt, /Siempre (?:usá|incluí|agregá) (?:un )?(?:ejemplo|analogía)/i);
});

test("tools are offered after helping and clarifying questions are only asked when material", () => {
  const prompt = read("src/lib/stampy/system-prompt.ts");

  assert.match(prompt, /primero respondé la consulta y después, si de verdad ayuda/);
  assert.match(prompt, /Nunca respondas sólo "usá tal herramienta"/);
  assert.match(prompt, /ofrecé la Calculadora avanzada para hacer el cálculo con sus números/);
  assert.match(prompt, /No inventes herramientas, secciones ni rutas/);
  assert.match(prompt, /No preguntes por preguntar/);
  assert.match(prompt, /falta un dato que cambia materialmente la respuesta/);
  assert.match(prompt, /Dá primero una orientación útil/);
  assert.doesNotMatch(prompt, /derivá al usuario a Presupuestos o Calculadora/);
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
