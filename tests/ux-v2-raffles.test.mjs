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
  assert.match(read("src/lib/raffles/participants.ts"), /const base = getBaseRaffleChances\(input\.memberLevel\)/);
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

test("chances: una sola interpretación (acceso + base por nivel + extras acreditadas)", () => {
  assert.equal(participants.getUserRaffleChances({ hasPlatformAccess: false, memberLevel: "gold", bonusEntries: 5 }), null);
  assert.deepEqual(participants.getUserRaffleChances({ hasPlatformAccess: true, memberLevel: "gold", bonusEntries: 3 }), { base: 2, bonus: 3, xp: 0, total: 5 });
  assert.deepEqual(participants.getUserRaffleChances({ hasPlatformAccess: true, memberLevel: null, bonusEntries: -2 }), { base: 1, bonus: 0, xp: 0, total: 1 });
  assert.equal(participants.sumActiveBonusEntries([{ entries_count: 2 }, { entries_count: "1" }, { entries_count: null }, { entries_count: -4 }]), 3);
  // Beta (grant activo) participa igual que Paid: misma regla que el registro de ganadores.
  const beta = participants.getRaffleParticipantChances({
    profile: { role: null, membership_status: null, membership_expires_at: null, onboarding_completed: true, member_level: null },
    grants: [{ grantType: "beta_tester", status: "active", expiresAt: null }],
    bonusEntries: 1,
  });
  assert.equal(beta, 2);
});

test("página de Sorteos, registro de ganadores y Stampy usan el mismo cálculo", () => {
  assert.match(read("src/app/sorteos/page.tsx"), /getUserRaffleChances\(\{ hasPlatformAccess, memberLevel, bonusEntries \}\)/);
  assert.match(read("src/lib/raffles/participants.ts"), /return getUserRaffleChances\(\{/);
  const stampy = read("src/lib/stampy/tool-contexts/raffles-context.ts");
  assert.match(stampy, /getUserRaffleChances\(\{/);
  assert.match(stampy, /hasPlatformAccess: access\.capabilities\.accessPlatform/);
  assert.doesNotMatch(stampy, /membership_status === "active"/, "la base ya no depende solo de la membresía");
  assert.match(stampy, /\.eq\("referrer_user_id", userId\)/, "columna real escrita por /auth/callback");
  assert.doesNotMatch(stampy, /referrer_id"/);
  assert.match(read("src/app/auth/callback/route.ts"), /referrer_user_id: referrerProfile\.id/);
});

test("la UI no promete chances por invitaciones (la acreditación no está implementada en el repo)", () => {
  const sources = {
    view: read("src/components/raffles/raffles-view.tsx"),
    perfil: read("src/app/perfil/page.tsx"),
    home: read("src/components/home/home-dashboard.tsx"),
    stampyStatic: read("src/lib/stampy/static-page-contexts.ts"),
    stampyAction: read("src/app/stampy/actions.ts"),
  };
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /suma una participación extra|sumá chances invitando|para sumar chances|código de referido y beneficios por invitar|se suscribe con mi referido|por invitaciones confirmadas|mencioná su código de referido/, name);
  }
  assert.match(sources.view, /Registrar una invitación no suma chances automáticamente/);
  assert.match(sources.stampyAction, /no suman chances automáticamente: no prometas chances por invitar/);
});
