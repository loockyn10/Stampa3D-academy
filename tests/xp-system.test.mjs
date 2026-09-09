import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(filename, dependencies = {}) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (request) => {
      if (request in dependencies) return dependencies[request];
      throw new Error(`Unexpected dependency: ${request}`);
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const progression = loadTypeScriptModule(path.join(root, "src/lib/xp/progression.ts"));
const config = loadTypeScriptModule(path.join(root, "src/lib/xp/config.ts"));
const raffle = loadTypeScriptModule(path.join(root, "src/lib/xp/raffle-bonuses.ts"));
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260909145259_xp_progression_foundation.sql"), "utf8");
const calculator = fs.readFileSync(path.join(root, "src/app/calculadora/page.tsx"), "utf8");
const stock = fs.readFileSync(path.join(root, "src/app/stock/page.tsx"), "utf8");
const profile = fs.readFileSync(path.join(root, "src/app/perfil/page.tsx"), "utf8");
const stampy = fs.readFileSync(path.join(root, "src/app/stampy/actions.ts"), "utf8");

test("the level curve matches the agreed early progression and has no maximum", () => {
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => progression.getXpThresholdForLevel(index + 1)),
    [0, 100, 220, 360, 520],
  );
  assert.equal(progression.getXpLevelForTotal(99), 1);
  assert.equal(progression.getXpLevelForTotal(100), 2);
  assert.equal(progression.getXpLevelForTotal(219), 2);
  assert.equal(progression.getXpLevelForTotal(220), 3);
  assert.ok(progression.getXpLevelForTotal(10_000_000) > 20);
});

test("progress is measured inside the current level and detects a crossing", () => {
  const within = progression.getXpProgress(160);
  assert.equal(within.level, 2);
  assert.equal(within.xpIntoLevel, 60);
  assert.equal(within.xpForNextLevel, 120);
  assert.equal(within.progressPercent, 50);
  assert.equal(progression.getXpProgress(219).level, 2);
  assert.equal(progression.getXpProgress(220).level, 3);
});

test("daily, duplicate and lifetime rules affect XP only", () => {
  assert.deepEqual(config.evaluateXpAward({ eventType: "class_completed" }), { xpAwarded: 10, reason: "awarded" });
  assert.deepEqual(config.evaluateXpAward({ eventType: "class_completed", eventAlreadyExists: true }), { xpAwarded: 0, reason: "duplicate" });
  assert.deepEqual(config.evaluateXpAward({ eventType: "class_completed", awardedToday: 2 }), { xpAwarded: 0, reason: "daily_limit" });
  assert.deepEqual(config.evaluateXpAward({ eventType: "calculator_used", awardedToday: 1 }), { xpAwarded: 0, reason: "daily_limit" });
  assert.deepEqual(config.evaluateXpAward({ eventType: "first_sale", awardedLifetime: 1 }), { xpAwarded: 0, reason: "lifetime_limit" });
});

test("production and sale can award their one-time milestone plus daily activity", () => {
  const production = config.evaluateXpAward({ eventType: "production_registered" }).xpAwarded
    + config.evaluateXpAward({ eventType: "first_production" }).xpAwarded;
  const sale = config.evaluateXpAward({ eventType: "sale_completed" }).xpAwarded
    + config.evaluateXpAward({ eventType: "first_sale" }).xpAwarded;
  assert.equal(production, 35);
  assert.equal(sale, 35);
  assert.equal(config.evaluateXpAward({ eventType: "production_registered", awardedToday: 1 }).xpAwarded, 0);
  assert.equal(config.evaluateXpAward({ eventType: "replenishment_completed", awardedToday: 1 }).xpAwarded, 0);
});

test("the logical day changes at Argentina midnight rather than UTC midnight", () => {
  assert.equal(config.getXpLogicalDay(new Date("2026-09-10T02:59:59Z")), "2026-09-09");
  assert.equal(config.getXpLogicalDay(new Date("2026-09-10T03:00:01Z")), "2026-09-10");
});

test("SQL enforces an append-only owned ledger and serializes concurrent awards", () => {
  assert.match(migration, /create table if not exists public\.user_xp_events/i);
  assert.match(migration, /unique index if not exists user_xp_events_user_key_uidx/i);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*stampa-xp:/i);
  assert.match(migration, /grant select on table public\.user_xp_events to authenticated/i);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on table public\.user_xp_events to authenticated/i);
  assert.match(migration, /user_id = auth\.uid\(\)[\s\S]*has_platform_access/i);
});

test("real backend facts drive each V1 event", () => {
  assert.match(migration, /lesson_progress_award_xp after insert on public\.lesson_progress/i);
  assert.match(migration, /printers_award_first_xp after insert on public\.printers/i);
  assert.match(migration, /filaments_award_first_xp after insert on public\.filaments/i);
  assert.match(migration, /products_award_first_xp after insert on public\.products/i);
  assert.match(migration, /business_sales_award_xp after insert or update of status/i);
  assert.match(migration, /business_replenishment_award_xp after insert/i);
  assert.match(migration, /business_stock_movement_award_xp after insert/i);
  assert.match(calculator, /record_calculator_xp/);
  assert.match(stock, /record_production_with_xp/);
});

test("historical bonus is capped, idempotent and does not make new users eligible", () => {
  assert.match(migration, /profile\.created_at < timestamptz '2026-09-09 14:52:59-03'/i);
  assert.match(migration, /least\(count\(\*\)::integer, 2\) \* 10/i);
  assert.match(migration, /on conflict \(user_id, event_key\) do nothing/gi);
  assert.match(migration, /historical_marker/i);
  assert.equal(20 + 15 + 25 + 25 + 25 + 20, 130);
});

test("raffle XP advantages remain off unless explicitly enabled", () => {
  assert.equal(raffle.getXpRaffleBonusChances(20), 0);
  assert.equal(raffle.getXpRaffleBonusChances(4, true), 0);
  assert.equal(raffle.getXpRaffleBonusChances(5, true), 1);
  assert.equal(raffle.getXpRaffleBonusChances(10, true), 2);
  assert.equal(raffle.getXpRaffleBonusChances(99, true), 3);
  assert.equal(raffle.isRaffleAvailableForXpLevel(10, 1, false), true);
  assert.equal(raffle.isRaffleAvailableForXpLevel(10, 9, true), false);
  assert.equal(raffle.isRaffleAvailableForXpLevel(10, 10, true), true);
  assert.match(migration, /alter table public\.raffles add column if not exists minimum_level integer/i);
});

test("profile and Stampy consume the centralized progression without write tools", () => {
  assert.match(profile, /XpProgressCard/);
  assert.match(profile, /from\("user_xp_summary"\)/);
  assert.match(stampy, /formatPublicXpRulesForStampy/);
  assert.match(stampy, /No podés otorgar XP, cambiar niveles/);
  assert.doesNotMatch(stampy, /award_user_xp|record_calculator_xp/);
});
