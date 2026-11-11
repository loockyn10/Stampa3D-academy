// Static guarantees of supabase/migrations/20261111120000_pioneer_edition.sql (M1 de la Edición Pioneros).
// No base de datos, no red: lee el SQL como texto. La conducta real (concurrencia, atomicidad, RLS) se prueba en
// tests/pioneer-seats-db.test.mjs contra un Postgres real descartable.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readRepoFile } from "./helpers/load-ts.mjs";

const FILE = "supabase/migrations/20261111120000_pioneer_edition.sql";
const sql = readRepoFile(FILE);
// Sin comentarios: las reglas se miden sobre el SQL ejecutable.
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

test("la migration es la más reciente y no reutiliza el nombre de otra", () => {
  const names = fs.readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
  assert.equal(names[names.length - 1], path.basename(FILE), "debe ordenar al final");
  assert.equal(names.filter((n) => n.includes("pioneer")).length, 1);
});

test("Fundadores intactos: founder_members solo se LEE y founder_pricing_tiers no se menciona", () => {
  assert.ok(!/founder_pricing_tiers/i.test(code));
  // El texto de los mensajes de error del preflight no es SQL ejecutable sobre la tabla.
  const executable = code.replace(/raise exception '[^']*'/gi, "raise exception ''");
  const mentions = [...executable.matchAll(/founder_(?:members|pricing_tiers|slot)\w*/gi)];
  assert.ok(mentions.length > 0, "la elegibilidad consulta founder_members");
  for (const match of mentions) {
    const before = executable.slice(Math.max(0, match.index - 40), match.index).toLowerCase();
    const readOnly =
      /from\s+public\.$/.test(before) || // select ... from public.founder_members f
      /to_regclass\('public\.$/.test(before) || // preflight
      /\(\s*'$/.test(before); // preflight: ('founder_members', 'user_id')
    assert.ok(readOnly, `uso no permitido de ${match[0]} cerca de: ${before.trim()}`);
  }
  assert.ok(!/(alter|drop|truncate)\s+(table\s+)?(only\s+)?(public\.)?founder_/i.test(code));
  assert.ok(!/(insert\s+into|update|delete\s+from)\s+(only\s+)?(public\.)?founder_/i.test(code));
  assert.ok(!/\bon\s+(public\.)?founder_/i.test(code), "ni triggers, índices ni policies sobre founder_*");
});

test("es aditiva: todo DDL/DML apunta a objetos pioneer_* y no hay ALTER/UPDATE/DELETE sobre tablas existentes", () => {
  const targets = (re) => [...code.matchAll(re)].map((m) => m[1].toLowerCase());
  const own = (name) => /^(public\.)?(_?pioneer_\w+)$/.test(name);

  for (const t of targets(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w.]+)/gi)) assert.ok(own(t), `ALTER TABLE ${t}`);
  for (const t of targets(/insert\s+into\s+([\w.]+)/gi)) assert.ok(own(t), `INSERT INTO ${t}`);
  for (const t of targets(/\bupdate\s+([\w.]+)\s+(?:\w+\s+)?set\b/gi)) assert.ok(own(t), `UPDATE ${t}`);
  for (const t of targets(/create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?\w+\s+on\s+([\w.]+)/gi)) assert.ok(own(t), `INDEX ON ${t}`);
  for (const t of targets(/create\s+trigger\s+\w+\s+(?:before|after)[\s\S]*?\bon\s+([\w.]+)/gi)) assert.ok(own(t), `TRIGGER ON ${t}`);
  for (const t of targets(/create\s+policy\s+\w+\s+on\s+([\w.]+)/gi)) assert.ok(own(t), `POLICY ON ${t}`);
  for (const t of targets(/drop\s+(?:trigger|policy)\s+if\s+exists\s+\w+\s+on\s+([\w.]+)/gi)) assert.ok(own(t), `DROP ON ${t}`);
  for (const t of targets(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi)) assert.ok(own(t), `CREATE TABLE ${t}`);

  assert.ok(!/\bdelete\s+from\b/i.test(code), "la migration no borra filas");
  assert.ok(!/\btruncate\b/i.test(code));
  assert.ok(!/drop\s+(table|function|column|schema|type)/i.test(code));
  assert.ok(!/alter\s+(function|policy|default|role|schema)/i.test(code));
  assert.ok(!/(has_platform_access|user_access_grants|platform_feature_flags|membership_settings|\bprofiles\b)/i.test(code));
});

test("nace apagada, sin términos y con acceso anticipado vacío; no se puede encender sin términos", () => {
  assert.ok(/enabled boolean not null default false/.test(code));
  assert.ok(/insert into public\.pioneer_edition \(id, enabled\) values \('default', false\) on conflict \(id\) do nothing/.test(code));
  assert.ok(/early_access_features text\[\] not null default '\{\}'/.test(code));
  assert.ok(/check \(not enabled or terms_version is not null\)/.test(code));
  assert.ok(/capacity integer not null default 20/.test(code) && /check \(capacity between 1 and 20\)/.test(code));
  assert.ok(/promo_price numeric\(12, 2\) not null default 9900/.test(code));
  assert.ok(/price_cycles integer not null default 6/.test(code));
});

test("integridad: índices parciales de ocupación, un lugar por persona, un preapproval por lugar, números 1..20", () => {
  assert.ok(/pioneer_members_number_occupied_idx\s+on public\.pioneer_members \(pioneer_number\) where status in \('reserved', 'active'\)/.test(code));
  assert.ok(/pioneer_members_user_occupied_idx\s+on public\.pioneer_members \(user_id\) where status in \('reserved', 'active'\)/.test(code));
  assert.ok(/pioneer_members_preapproval_idx\s+on public\.pioneer_members \(mercado_pago_preapproval_id\) where mercado_pago_preapproval_id is not null/.test(code));
  assert.ok(/check \(pioneer_number between 1 and 20\)/.test(code));
  assert.ok(/status <> 'active' or \(confirmed_at is not null and first_payment_id is not null\)/.test(code));
  assert.ok(/before insert or update or delete on public\.pioneer_members/.test(code));
  assert.ok(/pioneer seats are never deleted/.test(code));
  assert.ok(/an active pioneer seat is permanent/.test(code));
  assert.ok(/confirmed pioneer numbering is permanent/.test(code));
  assert.ok(/a pioneer seat can only be created as reserved/.test(code));
});

test("seguridad: RLS en las 3 tablas, sin acceso de anon, sin escritura directa y solo lectura propia para authenticated", () => {
  for (const table of ["pioneer_edition", "pioneer_members", "pioneer_seat_events"]) {
    assert.ok(new RegExp(`alter table public\\.${table} enable row level security`).test(code), `RLS ${table}`);
    assert.ok(new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role`).test(code), `revoke ${table}`);
  }
  assert.ok(!/grant[^;]*\bto\b[^;]*\banon\b/i.test(code), "nada se concede a anon");
  assert.ok(!/grant\s+(insert|update|delete|truncate|all)[^;]*pioneer_members/i.test(code));
  assert.ok(!/grant\s+(insert|delete|truncate|all)[^;]*pioneer_(edition|seat_events)/i.test(code));
  assert.ok(/grant select on table public\.pioneer_members to service_role/.test(code));
  assert.ok(/grant select, update on table public\.pioneer_edition to service_role/.test(code));
  assert.ok(/create policy pioneer_members_select_own\s+on public\.pioneer_members for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/.test(code));
  assert.ok(!/create policy[^;]*for\s+(insert|update|delete|all)/i.test(code), "ninguna policy de escritura");
  // Las columnas sensibles (preapproval, intento de checkout, ids de pago, errores) no se conceden a authenticated.
  const columnGrant = /grant select \(([\s\S]*?)\) on public\.pioneer_members to authenticated/.exec(code);
  assert.ok(columnGrant, "grant por columnas");
  for (const forbidden of ["mercado_pago_preapproval_id", "checkout_attempt_id", "first_payment_id", "step_up_error", "step_up_target", "release_reason"]) {
    assert.ok(!columnGrant[1].includes(forbidden), `${forbidden} no debe ser visible para authenticated`);
  }
});

test("seguridad de funciones: search_path fijo, EXECUTE solo para service_role y sin parámetro 'pagado' desde el cliente", () => {
  const blocks = code.split(/create or replace function /i).slice(1);
  assert.ok(blocks.length >= 12);
  for (const block of blocks) {
    const name = /^public\.(\w+)/.exec(block)?.[1];
    assert.ok(/set search_path = public, pg_temp/.test(block), `search_path en ${name}`);
  }

  const callable = [
    "pioneer_offer_state()",
    "reserve_pioneer_seat(uuid, numeric, text, text)",
    "attach_pioneer_seat(uuid, uuid, uuid)",
    "sync_pioneer_seat(text, text)",
    "release_pioneer_seat(uuid, text, uuid)",
    "release_expired_pioneer_holds()",
    "pioneer_early_access_features(uuid)",
  ];
  for (const signature of callable) {
    const escaped = signature.replace(/[()]/g, "\\$&");
    assert.ok(new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated`).test(code), `revoke ${signature}`);
    assert.ok(new RegExp(`grant execute on function public\\.${escaped} to service_role`).test(code), `grant ${signature}`);
  }
  for (const internal of ["_pioneer_lock()", "_pioneer_log(uuid, text, jsonb)", "_pioneer_qualifying_payments(uuid)", "_pioneer_seat_chargeable(uuid)", "_pioneer_sweep_expired()"]) {
    const escaped = internal.replace(/[()]/g, "\\$&");
    assert.ok(new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated, service_role`).test(code), `internal ${internal}`);
  }
  assert.ok(!/grant execute[^;]*\bto\s+(anon|authenticated|public)\b/i.test(code));

  // La confirmación sale de public.payments, no de un argumento: la firma solo recibe el preapproval y el estado del proveedor.
  assert.ok(/sync_pioneer_seat\(p_preapproval_id text, p_provider_status text default null\)/.test(code));
  const sync = /create or replace function public\.sync_pioneer_seat[\s\S]*?\n\$\$;/.exec(code)[0];
  assert.ok(/_pioneer_qualifying_payments/.test(sync));
  assert.ok(/status = 'active'/.test(sync));
  const qualifying = /create or replace function public\._pioneer_qualifying_payments[\s\S]*?\n\$\$;/.exec(code)[0];
  assert.ok(/'approved'/.test(qualifying) && /m\.locked_price/.test(qualifying) && /public\.payments/.test(qualifying));
});

test("la elegibilidad excluye Fundadores, cobros previos y suscripciones vivas; reserva con lock global", () => {
  const reserve = /create or replace function public\.reserve_pioneer_seat[\s\S]*?\n\$\$;/.exec(code)[0];
  assert.ok(/pg_advisory_xact_lock|_pioneer_lock\(\)/.test(reserve));
  assert.ok(/from public\.founder_members f where f\.user_id = p_user_id/.test(reserve));
  assert.ok(/from public\.payments p where p\.user_id = p_user_id/.test(reserve));
  assert.ok(/'authorized', 'active', 'paused'/.test(reserve));
  assert.ok(/status', 'sold_out'/.test(reserve));
  assert.ok(/for update/.test(reserve));
});

test("pagos tardíos: ninguna ruta libera un lugar sin comprobar que Mercado Pago ya no puede cobrarlo", () => {
  assert.ok(/create or replace function public\._pioneer_seat_chargeable/.test(code));
  const sweep = /create or replace function public\._pioneer_sweep_expired[\s\S]*?\n\$\$;/.exec(code)[0];
  assert.ok(/not public\._pioneer_seat_chargeable\(m\.id\)/.test(sweep), "el barrido respeta el chequeo");
  assert.ok(/not exists \(select 1 from public\._pioneer_qualifying_payments\(m\.id\)\)/.test(sweep));
  const release = /create or replace function public\.release_pioneer_seat[\s\S]*?\n\$\$;/.exec(code)[0];
  assert.ok(/_pioneer_seat_chargeable\(v_seat\.id\)/.test(release) && /'chargeable'/.test(release));
  // Las únicas escrituras que pasan un lugar reservado a 'released' son: barrido, release_pioneer_seat (ambos con el
  // chequeo), 'superseded' (sin checkout ni preapproval adjuntos) y sync con estado 'cancelled' informado por el servidor.
  const releases = [...code.matchAll(/set status = 'released'/g)].length;
  assert.equal(releases, 4, "no agregar nuevas rutas de liberación sin revisar este test");
});

test("no hay precios, ciclos ni importes escritos en funciones: todo sale de pioneer_edition", () => {
  const functionsPart = code.slice(code.indexOf("create or replace function public._pioneer_lock"));
  assert.ok(!/\b9900\b|\b19900\b|\b9\.900\b/.test(functionsPart), "ningún precio hardcodeado en las funciones");
});
