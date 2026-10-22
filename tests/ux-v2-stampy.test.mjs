import assert from "node:assert/strict";
import test from "node:test";
import { readRepoFile as read } from "./helpers/load-ts.mjs";

const page = read("src/app/stampy/page.tsx");

test("Stampy: estado inicial con título protagonista, composer y sugerencias que usan el chat real", () => {
  assert.match(page, /¿En qué puedo ayudarte hoy\?/);
  assert.match(page, /onClick=\{\(\) => void handleSend\(card\.prompt\)\}/);
  for (const title of ["Solucionar un problema de impresión", "Calcular el precio de un producto", "Consultar mi inventario", "Aprender impresión 3D", "Buscar ideas de productos"]) {
    assert.ok(page.includes(title), title);
  }
});

test("Stampy: conserva backend, contexto, historial por conversación, acciones, recomendaciones y feedback", () => {
  assert.match(page, /askStampyAction\(safeText, conversationId/);
  assert.match(page, /getScreenContextSnapshot\(\)/);
  assert.match(page, /MAIN_CONVERSATION_STORAGE_KEY/);
  assert.match(page, /<ActionIntentCard/);
  assert.match(page, /msg\.recommendations/);
  assert.match(page, /msg\.knowledgeTools/);
  assert.match(page, /<StampyFeedback/);
  assert.match(page, /requestInFlightRef\.current/);
});

test("Stampy: scroll dentro del contenedor (sin window.scrollTo) y estados de carga accesibles", () => {
  assert.doesNotMatch(page, /window\.scrollTo/);
  assert.match(page, /container\.scrollTo\(/);
  assert.match(page, /aria-busy=\{loading\}/);
  assert.match(page, /role="status"/);
  assert.match(page, /SLOW_RESPONSE_HINT_MS/);
  assert.match(page, /aria-label="Enviar mensaje"/);
  assert.match(page, /event\.key === "Enter" && !event\.shiftKey/);
});
