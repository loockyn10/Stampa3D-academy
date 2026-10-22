import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const status = loadTs("src/lib/raffles/status.ts");
const participants = loadTs("src/lib/raffles/participants.ts");
const now = new Date("2026-10-22T12:00:00Z");

test("estado visible por fecha real: activo, sin fecha y esperando resultado", () => {
  assert.equal(status.getRaffleTimeStatus("2026-10-30T12:00:00Z", now).kind, "open");
  assert.equal(status.getRaffleTimeStatus("2026-10-30T12:00:00Z", now).daysLeft, 8);
  assert.equal(status.getRaffleTimeStatus("2026-10-22T20:00:00Z", now).label, "Se sortea en menos de 24 h");
  assert.equal(status.getRaffleTimeStatus(null, now).kind, "no_date");
  assert.equal(status.getRaffleTimeStatus("2026-10-01T00:00:00Z", now).kind, "awaiting_result", "no se inventa un ganador");
});

test("finalizados: ganadores agrupados por sorteo, más reciente primero", () => {
  const groups = status.groupWinnersByRaffle([
    { id: "w1", winner_name_snapshot: "Ana", prize_name_snapshot: "A1 Mini", won_at: "2026-09-30T00:00:00Z", raffles: { title: "Septiembre", draw_date: "2026-09-30T00:00:00Z" } },
    { id: "w2", winner_name_snapshot: "Luis", prize_name_snapshot: "Rollos", won_at: "2026-09-30T00:00:00Z", raffles: [{ title: "Septiembre", draw_date: "2026-09-30T00:00:00Z" }] },
    { id: "w3", winner_name_snapshot: "Eva", prize_name_snapshot: "Kit", won_at: "2026-10-15T00:00:00Z", raffles: { title: "Octubre", draw_date: "2026-10-15T00:00:00Z" } },
  ]);
  assert.deepEqual(groups.map((g) => g.title), ["Octubre", "Septiembre"]);
  assert.equal(groups[1].winners.length, 2);
});

test("chance base: una sola regla compartida por la página y el registro de ganadores", () => {
  assert.equal(participants.getBaseRaffleChances("gold"), 2);
  assert.equal(participants.getBaseRaffleChances("elite"), 2);
  assert.equal(participants.getBaseRaffleChances("member"), 1);
  assert.equal(participants.getBaseRaffleChances(null), 1);
  assert.match(read("src/lib/raffles/participants.ts"), /const baseChances = getBaseRaffleChances\(input\.profile\.member_level\)/);
  assert.match(read("src/app/sorteos/page.tsx"), /getBaseRaffleChances\(memberLevel\)/);
});

test("Sorteos V2: panel de chances con enlace y copiar, modal de reglas y tarjetas compactas", () => {
  const view = read("src/components/raffles/raffles-view.tsx");
  assert.match(view, /Tus chances/);
  assert.match(view, /aria-label="Copiar enlace de invitación"/);
  assert.match(view, /¿Cómo funcionan los sorteos\?/);
  assert.match(view, /<Dialog/);
  for (const topic of ["¿Cómo obtengo chances?", "¿Cómo funcionan las invitaciones?", "¿Qué son las chances adicionales?", "¿Cómo se usan en los sorteos?", "¿Qué condiciones aplican?"]) {
    assert.ok(view.includes(topic), topic);
  }
  assert.doesNotMatch(view, /\bh-40\b|sm:h-44/, "sin imágenes de alto fijo grande");
  assert.match(view, /aspect-\[4\/3\] w-28/);
  assert.doesNotMatch(read("src/app/sorteos/page.tsx"), /raffle_winners"\)\.(insert|update|delete)|\.rpc\(/, "no toca ganadores ni chances");
});
