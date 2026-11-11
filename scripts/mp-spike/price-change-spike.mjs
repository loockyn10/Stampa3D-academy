#!/usr/bin/env node
/**
 * SPIKE CONTROLADO de Mercado Pago: cambio de monto de una suscripción existente (Edición Pioneros).
 * Runbook: docs/MP_PRICE_CHANGE_SPIKE.md. NO se ejecuta automáticamente ni forma parte de la app.
 *
 * Garantías de seguridad (todas verificadas por tests/mp-spike.test.mjs con un `fetch` falso):
 *  - No lee MERCADO_PAGO_ACCESS_TOKEN ni ninguna variable de producción de la app; usa MP_SPIKE_ACCESS_TOKEN y se
 *    niega a correr si es idéntico al token de producción.
 *  - Antes de cualquier operación pregunta a Mercado Pago a quién pertenece el token (GET /users/me) y exige que sea
 *    EXACTAMENTE la cuenta de prueba declarada en MP_SPIKE_EXPECTED_USER_ID. Sin coincidencia exacta no hace nada.
 *  - Solo crea/modifica/cancela suscripciones cuyo `external_reference` empieza con `stampa_spike_` (las que crea este
 *    mismo script). Nunca toca una suscripción real.
 *  - Todo lo que escribe es DRY-RUN salvo que se pase --execute.
 *  - Sin Supabase, sin base de datos, sin tablas de la app. Solo lee/escribe archivos de resultados locales.
 *  - Frecuencia solo en días (1–30) para observar varios ciclos rápido. Nunca "months".
 *
 * Uso (ver el runbook para el procedimiento completo):
 *   node scripts/mp-spike/price-change-spike.mjs whoami
 *   node scripts/mp-spike/price-change-spike.mjs create --amount 9900 --email <comprador-de-prueba> [--days 1] [--execute]
 *   node scripts/mp-spike/price-change-spike.mjs inspect <preapproval_id>
 *   node scripts/mp-spike/price-change-spike.mjs put-amount <preapproval_id> --amount 19900 [--require-charged 6] [--execute]
 *   node scripts/mp-spike/price-change-spike.mjs cancel <preapproval_id> [--execute]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SPIKE_REF_PREFIX = "stampa_spike_";
const API = "https://api.mercadopago.com";
const TIMEOUT_MS = 12_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const COMMANDS = ["whoami", "create", "inspect", "put-amount", "cancel"];

export class SpikeError extends Error {
  constructor(message) {
    super(message);
    this.name = "SpikeError";
  }
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (item.startsWith("--")) {
      const name = item.slice(2);
      const next = rest[index + 1];
      if (next === undefined || next.startsWith("--")) flags[name] = true;
      else {
        flags[name] = next;
        index += 1;
      }
    } else positional.push(item);
  }
  return { command, positional, flags };
}

/** Variables de entorno: solo las del spike. Falla cerrado. */
export function assertSafeEnv(env) {
  const token = env.MP_SPIKE_ACCESS_TOKEN;
  if (!token) throw new SpikeError("Falta MP_SPIKE_ACCESS_TOKEN (token de la CUENTA DE PRUEBA; nunca el de producción).");
  if (env.MP_SPIKE_CONFIRM_TEST_ACCOUNT !== "yes") {
    throw new SpikeError('Falta MP_SPIKE_CONFIRM_TEST_ACCOUNT=yes (confirmación explícita de que el token es de una cuenta de prueba).');
  }
  const expectedId = env.MP_SPIKE_EXPECTED_USER_ID;
  if (!expectedId || !/^\d{3,20}$/.test(expectedId)) {
    throw new SpikeError("Falta MP_SPIKE_EXPECTED_USER_ID (User ID numérico de la cuenta de prueba vendedora, visible en el panel de Mercado Pago).");
  }
  if (env.MERCADO_PAGO_ACCESS_TOKEN && env.MERCADO_PAGO_ACCESS_TOKEN === token) {
    throw new SpikeError("MP_SPIKE_ACCESS_TOKEN es igual al token de producción de la app. Abortado.");
  }
  if (env.VERCEL_ENV === "production") throw new SpikeError("No se ejecuta en un entorno de producción de Vercel.");
  return { token, expectedId };
}

function describeFailure(status, body) {
  const cause = Array.isArray(body?.cause) ? body.cause[0] : undefined;
  const parts = [body?.error, body?.message, cause?.code, cause?.description].filter((p) => typeof p === "string" || typeof p === "number");
  return `HTTP ${status}${parts.length ? ` · ${parts.join(" · ").slice(0, 200)}` : ""}`;
}

function client(token, fetchImpl) {
  return async function call(method, apiPath, body) {
    let response;
    try {
      response = await fetchImpl(`${API}${apiPath}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new SpikeError(`Sin respuesta de Mercado Pago (${method} ${apiPath}): ${error instanceof Error ? error.message : "error de red"}`);
    }
    let json = null;
    try {
      const text = await response.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, ok: response.ok, json };
  };
}

async function verifyIdentity(call, expectedId) {
  const me = await call("GET", "/users/me");
  if (!me.ok) throw new SpikeError(`No se pudo verificar la cuenta del token (${describeFailure(me.status, me.json)}).`);
  if (String(me.json?.id) !== expectedId) {
    throw new SpikeError(`El token pertenece a OTRA cuenta (id ${String(me.json?.id)}), no a la esperada. No se hizo nada.`);
  }
  return { id: String(me.json.id), nickname: String(me.json.nickname ?? ""), siteId: String(me.json.site_id ?? "") };
}

function maskEmail(value) {
  if (typeof value !== "string" || !value.includes("@")) return null;
  const [local, domain] = value.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Resumen sin datos personales (ni emails completos, ni tarjetas, ni ids de pagador). */
export function snapshotPreapproval(raw) {
  const recurring = raw?.auto_recurring ?? {};
  const summarized = raw?.summarized ?? {};
  return {
    id: raw?.id ?? null,
    status: raw?.status ?? null,
    version: raw?.version ?? null,
    external_reference: raw?.external_reference ?? null,
    reason: raw?.reason ?? null,
    date_created: raw?.date_created ?? null,
    last_modified: raw?.last_modified ?? null,
    next_payment_date: raw?.next_payment_date ?? null,
    payer_email_masked: maskEmail(raw?.payer_email),
    has_card: Boolean(raw?.card_id),
    preapproval_plan_id: raw?.preapproval_plan_id ?? null,
    auto_recurring: {
      transaction_amount: recurring.transaction_amount ?? null,
      currency_id: recurring.currency_id ?? null,
      frequency: recurring.frequency ?? null,
      frequency_type: recurring.frequency_type ?? null,
      start_date: recurring.start_date ?? null,
      end_date: recurring.end_date ?? null,
      free_trial: recurring.free_trial ?? null,
      repetitions: recurring.repetitions ?? null,
    },
    summarized: {
      charged_quantity: summarized.charged_quantity ?? null,
      charged_amount: summarized.charged_amount ?? null,
      pending_charge_quantity: summarized.pending_charge_quantity ?? null,
      pending_charge_amount: summarized.pending_charge_amount ?? null,
      last_charged_date: summarized.last_charged_date ?? null,
      last_charged_amount: summarized.last_charged_amount ?? null,
    },
  };
}

export function snapshotInvoices(rawList) {
  const results = Array.isArray(rawList?.results) ? rawList.results : [];
  return results.map((item) => ({
    invoice_id: item?.id ?? null,
    status: item?.status ?? null,
    transaction_amount: item?.transaction_amount ?? null,
    currency_id: item?.currency_id ?? null,
    debit_date: item?.debit_date ?? null,
    retry_attempt: item?.retry_attempt ?? null,
    payment_id: item?.payment?.id ?? null,
    payment_status: item?.payment?.status ?? null,
    payment_status_detail: item?.payment?.status_detail ?? null,
    last_modified: item?.last_modified ?? null,
  }));
}

function requireSpikeId(value) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new SpikeError("Falta el id de la suscripción (preapproval_id) o no es válido.");
  return value;
}

function requireAmount(value, label = "--amount") {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000) throw new SpikeError(`${label} inválido (entre 1 y 1.000.000).`);
  return Math.round(amount * 100) / 100;
}

async function readSpikePreapproval(call, id) {
  const read = await call("GET", `/preapproval/${encodeURIComponent(id)}`);
  if (!read.ok) throw new SpikeError(`No se pudo leer la suscripción (${describeFailure(read.status, read.json)}).`);
  const reference = String(read.json?.external_reference ?? "");
  if (!reference.startsWith(SPIKE_REF_PREFIX)) {
    throw new SpikeError(`La suscripción NO fue creada por este spike (external_reference sin el prefijo ${SPIKE_REF_PREFIX}). No se toca.`);
  }
  return read.json;
}

function save(outDir, name, data, log) {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  log(`resultado guardado en: ${file}`);
}

export async function run({ argv, env, fetchImpl = fetch, log = console.log, outDir } = {}) {
  const { command, positional, flags } = parseArgs(argv ?? []);
  if (!COMMANDS.includes(command)) throw new SpikeError(`Comando inválido. Usá uno de: ${COMMANDS.join(", ")}.`);

  const { token, expectedId } = assertSafeEnv(env ?? {});
  const call = client(token, fetchImpl);
  const output = outDir ?? env?.MP_SPIKE_OUT ?? path.join(os.tmpdir(), "mp-spike");
  const execute = flags.execute === true;

  const identity = await verifyIdentity(call, expectedId);
  log(`cuenta verificada: id ${identity.id} · usuario ${identity.nickname || "(sin nombre)"} · sitio ${identity.siteId}`);
  if (command === "whoami") return { identity };

  if (command === "create") {
    const amount = requireAmount(flags.amount);
    const days = Number(flags.days ?? 1);
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new SpikeError("--days debe ser un entero entre 1 y 30.");
    const email = typeof flags.email === "string" ? flags.email.trim() : "";
    if (!email.includes("@")) throw new SpikeError("Falta --email (el email de la cuenta COMPRADORA de prueba).");
    const backUrl = typeof flags["back-url"] === "string" ? flags["back-url"] : "https://www.mercadopago.com.ar";
    if (!backUrl.startsWith("https://")) throw new SpikeError("--back-url debe ser https.");
    const payload = {
      reason: "SPIKE Pioneros (prueba, no es una venta)",
      external_reference: `${SPIKE_REF_PREFIX}${Date.now()}`,
      payer_email: email,
      auto_recurring: { frequency: days, frequency_type: "days", transaction_amount: amount, currency_id: "ARS" },
      back_url: backUrl,
      status: "pending",
    };
    if (!execute) {
      log("DRY-RUN: se enviaría POST /preapproval con:");
      log(JSON.stringify({ ...payload, payer_email: maskEmail(email) }, null, 2));
      log("Agregá --execute para crearla.");
      return { dryRun: true, payload };
    }
    const created = await call("POST", "/preapproval", payload);
    if (!created.ok) throw new SpikeError(`Mercado Pago rechazó la creación (${describeFailure(created.status, created.json)}).`);
    const result = { snapshot: snapshotPreapproval(created.json), init_point: created.json?.init_point ?? null };
    log(`creada: ${result.snapshot.id} (estado ${result.snapshot.status})`);
    log(`abrir con la cuenta COMPRADORA de prueba y pagar con una tarjeta de prueba: ${result.init_point}`);
    save(output, "create", result, log);
    return result;
  }

  const id = requireSpikeId(positional[0]);

  if (command === "inspect") {
    const raw = await readSpikePreapproval(call, id);
    // Solo el filtro documentado (incidente 2026-11-05): nada de `limit`.
    const invoices = await call("GET", `/authorized_payments/search?preapproval_id=${encodeURIComponent(id)}`);
    const result = {
      preapproval: snapshotPreapproval(raw),
      invoices: invoices.ok ? snapshotInvoices(invoices.json) : { error: describeFailure(invoices.status, invoices.json) },
    };
    log(JSON.stringify(result, null, 2));
    save(output, "inspect", result, log);
    return result;
  }

  if (command === "put-amount") {
    const amount = requireAmount(flags.amount);
    const before = await readSpikePreapproval(call, id);
    const status = String(before.status ?? "").toLowerCase();
    if (!["authorized", "pending"].includes(status)) throw new SpikeError(`La suscripción está en estado "${status}": no se cambia el monto.`);
    if (flags["require-charged"] !== undefined) {
      const needed = Number(flags["require-charged"]);
      const charged = Number(before.summarized?.charged_quantity ?? 0);
      if (!Number.isInteger(needed) || needed < 0) throw new SpikeError("--require-charged inválido.");
      if (charged < needed) throw new SpikeError(`Solo hay ${charged} cobros registrados por Mercado Pago; se exigían al menos ${needed}. No se cambia el monto.`);
    }
    const currency = String(before.auto_recurring?.currency_id ?? "ARS");
    const body = { auto_recurring: { transaction_amount: amount, currency_id: currency } };
    if (!execute) {
      log(`DRY-RUN: se enviaría PUT /preapproval/${id} con ${JSON.stringify(body)}`);
      log(`estado actual: ${status} · monto actual: ${before.auto_recurring?.transaction_amount} · cobros: ${before.summarized?.charged_quantity ?? 0}`);
      log("Agregá --execute para aplicarlo.");
      return { dryRun: true, before: snapshotPreapproval(before), body };
    }
    const beforeInvoices = await call("GET", `/authorized_payments/search?preapproval_id=${encodeURIComponent(id)}`);
    const put = await call("PUT", `/preapproval/${encodeURIComponent(id)}`, body);
    const putResult = { http_status: put.status, ok: put.ok, error: put.ok ? null : describeFailure(put.status, put.json) };
    const afterRaw = await readSpikePreapproval(call, id);
    const afterInvoices = await call("GET", `/authorized_payments/search?preapproval_id=${encodeURIComponent(id)}`);
    const result = {
      requested_amount: amount,
      put: putResult,
      put_response: put.ok ? snapshotPreapproval(put.json) : null,
      before: { preapproval: snapshotPreapproval(before), invoices: beforeInvoices.ok ? snapshotInvoices(beforeInvoices.json) : null },
      after: { preapproval: snapshotPreapproval(afterRaw), invoices: afterInvoices.ok ? snapshotInvoices(afterInvoices.json) : null },
    };
    log(JSON.stringify({ put: result.put, before: result.before.preapproval.auto_recurring, after: result.after.preapproval.auto_recurring, status_before: result.before.preapproval.status, status_after: result.after.preapproval.status, version_before: result.before.preapproval.version, version_after: result.after.preapproval.version }, null, 2));
    save(output, "put-amount", result, log);
    return result;
  }

  // cancel
  const current = await readSpikePreapproval(call, id);
  if (!execute) {
    log(`DRY-RUN: se enviaría PUT /preapproval/${id} con {"status":"cancelled"} (estado actual: ${current.status}). Agregá --execute.`);
    return { dryRun: true };
  }
  const cancelled = await call("PUT", `/preapproval/${encodeURIComponent(id)}`, { status: "cancelled" });
  if (!cancelled.ok) throw new SpikeError(`No se pudo cancelar (${describeFailure(cancelled.status, cancelled.json)}).`);
  const result = { snapshot: snapshotPreapproval(cancelled.json) };
  log(`cancelada: estado ${result.snapshot.status}`);
  save(output, "cancel", result, log);
  return result;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  run({ argv: process.argv.slice(2), env: process.env }).catch((error) => {
    console.error(error instanceof SpikeError ? `ERROR: ${error.message}` : `ERROR inesperado: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
