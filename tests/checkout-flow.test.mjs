import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CheckoutProviderError,
  executeCheckout,
} from "../src/lib/mercadopago/checkout-flow.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const KEY_A = "20000000-0000-4000-8000-000000000001";
const KEY_B = "20000000-0000-4000-8000-000000000002";

function input(idempotencyKey = KEY_A) {
  return {
    userId: USER_ID,
    idempotencyKey,
    amount: 19900,
    currency: "ARS",
    payerEmail: "member@example.com",
    reason: "Membresía Academia Stampa",
    backUrl: "https://example.com/pago/estado",
  };
}

class MemoryCheckoutRepository {
  attemptsByKey = new Map();
  openByUser = new Map();
  sequence = 0;
  failBegin = false;
  failCompleteCount = 0;
  existingSubscription = null;

  async begin(checkoutInput) {
    if (this.failBegin) {
      throw new Error("Supabase unavailable before provider call");
    }

    const key = `${checkoutInput.userId}:${checkoutInput.idempotencyKey}`;
    let attempt = this.attemptsByKey.get(key);

    if (attempt?.state === "completed") {
      return {
        action: "return_ready",
        attemptId: attempt.ref.attemptId,
        preapprovalId: attempt.preapproval.id,
        initPoint: attempt.preapproval.initPoint,
      };
    }

    if (attempt?.state === "creating" || attempt?.state === "reconciliation_required") {
      return { action: "reconcile", attempt: attempt.ref };
    }

    if (attempt?.state === "closed") {
      return { action: "closed_attempt", attemptId: attempt.ref.attemptId };
    }

    const open = this.openByUser.get(checkoutInput.userId);
    if (open?.state === "completed") {
      return {
        action: "return_ready",
        attemptId: open.ref.attemptId,
        preapprovalId: open.preapproval.id,
        initPoint: open.preapproval.initPoint,
      };
    }
    if (open) {
      return { action: "reconcile", attempt: open.ref };
    }

    if (this.existingSubscription) {
      return {
        action: "blocked_existing_subscription",
        subscriptionId: this.existingSubscription.id,
        subscriptionStatus: this.existingSubscription.status,
        preapprovalId: this.existingSubscription.preapprovalId,
      };
    }

    if (attempt?.state === "provider_error") {
      attempt.state = "creating";
      this.openByUser.set(checkoutInput.userId, attempt);
      return { action: "call_provider", attempt: attempt.ref };
    }

    this.sequence += 1;
    const attemptId = `30000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`;
    attempt = {
      userId: checkoutInput.userId,
      state: "creating",
      ref: {
        attemptId,
        idempotencyKey: checkoutInput.idempotencyKey,
        externalReference: `stampa_checkout_${attemptId.replaceAll("-", "")}`,
        claimToken: `40000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`,
        payerEmail: checkoutInput.payerEmail,
      },
      preapproval: null,
    };
    this.attemptsByKey.set(key, attempt);
    this.openByUser.set(checkoutInput.userId, attempt);
    return { action: "call_provider", attempt: attempt.ref };
  }

  async complete(attemptRef, preapproval) {
    if (this.failCompleteCount > 0) {
      this.failCompleteCount -= 1;
      throw new Error("Supabase unavailable after provider response");
    }

    const attempt = [...this.attemptsByKey.values()].find(
      (candidate) => candidate.ref.attemptId === attemptRef.attemptId,
    );
    assert.ok(attempt);
    attempt.preapproval = preapproval;
    attempt.state = "completed";
  }

  async markProviderError(attemptRef) {
    const attempt = [...this.attemptsByKey.values()].find(
      (candidate) => candidate.ref.attemptId === attemptRef.attemptId,
    );
    assert.ok(attempt);
    attempt.state = "provider_error";
    this.openByUser.delete(attempt.userId);
  }

  async markReconciliationRequired(attemptRef) {
    const attempt = [...this.attemptsByKey.values()].find(
      (candidate) => candidate.ref.attemptId === attemptRef.attemptId,
    );
    assert.ok(attempt);
    attempt.state = "reconciliation_required";
  }
}

class MemoryPreapprovalProvider {
  createCalls = 0;
  mode = "success";
  latencyMs = 0;
  preapprovals = new Map();

  async create({ attempt }) {
    this.createCalls += 1;
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    if (this.mode === "definite_error") {
      throw new CheckoutProviderError({
        code: "mp_http_400",
        message: "definite provider rejection",
        ambiguous: false,
      });
    }

    const preapproval = {
      id: `mp-${attempt.attemptId}`,
      initPoint: `https://mercadopago.example/${attempt.attemptId}`,
      status: "pending",
      raw: {
        id: `mp-${attempt.attemptId}`,
        external_reference: attempt.externalReference,
        init_point: `https://mercadopago.example/${attempt.attemptId}`,
        status: "pending",
      },
    };
    this.preapprovals.set(attempt.externalReference, preapproval);

    if (this.mode === "timeout_after_create") {
      this.mode = "success";
      throw new CheckoutProviderError({
        code: "mp_transport_or_timeout",
        message: "response was lost",
        ambiguous: true,
      });
    }

    return preapproval;
  }

  async findByExternalReference({ externalReference }) {
    return this.preapprovals.get(externalReference) ?? null;
  }
}

function dependencies() {
  return {
    repository: new MemoryCheckoutRepository(),
    provider: new MemoryPreapprovalProvider(),
  };
}

test("un POST normal crea y persiste una sola preapproval", async () => {
  const deps = dependencies();
  const result = await executeCheckout(input(), deps);

  assert.equal(result.kind, "ready");
  assert.equal(deps.provider.createCalls, 1);
});

test("doble clic y 2 requests concurrentes convergen", async () => {
  const deps = dependencies();
  deps.provider.latencyMs = 5;

  const results = await Promise.all([
    executeCheckout(input(), deps),
    executeCheckout(input(), deps),
  ]);

  assert.equal(deps.provider.createCalls, 1);
  assert.ok(results.some((result) => result.kind === "ready"));
  assert.ok(
    results.every((result) =>
      ["ready", "reconciliation_pending"].includes(result.kind),
    ),
  );
});

test("20 requests concurrentes sólo habilitan una creación", async () => {
  const deps = dependencies();
  deps.provider.latencyMs = 5;

  const results = await Promise.all(
    Array.from({ length: 20 }, () => executeCheckout(input(), deps)),
  );

  assert.equal(results.length, 20);
  assert.equal(deps.provider.createCalls, 1);
  assert.ok(results.some((result) => result.kind === "ready"));
});

test("retry con la misma idempotency key reutiliza el resultado", async () => {
  const deps = dependencies();

  const first = await executeCheckout(input(), deps);
  const retry = await executeCheckout(input(), deps);

  assert.equal(first.kind, "ready");
  assert.equal(retry.kind, "ready");
  assert.equal(retry.reused, true);
  assert.equal(deps.provider.createCalls, 1);
});

test("un retry con una clave nueva también reutiliza el intento abierto del usuario", async () => {
  const deps = dependencies();

  const first = await executeCheckout(input(KEY_A), deps);
  const retry = await executeCheckout(input(KEY_B), deps);

  assert.equal(first.kind, "ready");
  assert.equal(retry.kind, "ready");
  assert.equal(retry.reused, true);
  assert.equal(deps.provider.createCalls, 1);
});

test("dos idempotency keys del mismo usuario convergen en el intento abierto", async () => {
  const deps = dependencies();
  deps.provider.latencyMs = 5;

  await Promise.all([
    executeCheckout(input(KEY_A), deps),
    executeCheckout(input(KEY_B), deps),
  ]);

  assert.equal(deps.provider.createCalls, 1);
});

test("una suscripción local abierta bloquea una creación nueva", async () => {
  const deps = dependencies();
  deps.repository.existingSubscription = {
    id: "subscription-1",
    status: "authorized",
    preapprovalId: "existing-mp-id",
  };

  const result = await executeCheckout(input(), deps);

  assert.equal(result.kind, "blocked_existing_subscription");
  assert.equal(deps.provider.createCalls, 0);
});

test("un rechazo definido de Mercado Pago es reintentable sin dejar un intento ambiguo", async () => {
  const deps = dependencies();
  deps.provider.mode = "definite_error";

  const failed = await executeCheckout(input(), deps);
  assert.equal(failed.kind, "provider_error");
  assert.equal(deps.provider.createCalls, 1);

  deps.provider.mode = "success";
  const retried = await executeCheckout(input(), deps);
  assert.equal(retried.kind, "ready");
  assert.equal(deps.provider.createCalls, 2);
});

test("timeout después de una posible creación reconcilia sin otro POST", async () => {
  const deps = dependencies();
  deps.provider.mode = "timeout_after_create";

  const timedOut = await executeCheckout(input(), deps);
  const retry = await executeCheckout(input(), deps);

  assert.equal(timedOut.kind, "reconciliation_pending");
  assert.equal(retry.kind, "ready");
  assert.equal(retry.reused, true);
  assert.equal(deps.provider.createCalls, 1);
});

test("fallo de Supabase antes del claim impide llamar a Mercado Pago", async () => {
  const deps = dependencies();
  deps.repository.failBegin = true;

  const result = await executeCheckout(input(), deps);

  assert.equal(result.kind, "storage_error");
  assert.equal(result.phase, "before_provider");
  assert.equal(deps.provider.createCalls, 0);
});

test("fallo de Supabase después de Mercado Pago se recupera sin recrear", async () => {
  const deps = dependencies();
  deps.repository.failCompleteCount = 1;

  const first = await executeCheckout(input(), deps);
  const retry = await executeCheckout(input(), deps);

  assert.equal(first.kind, "storage_error");
  assert.equal(first.phase, "after_provider");
  assert.equal(retry.kind, "ready");
  assert.equal(deps.provider.createCalls, 1);
});

test("un intento cerrado permite una re-suscripción con una clave nueva", async () => {
  const deps = dependencies();
  const first = await executeCheckout(input(KEY_A), deps);
  assert.equal(first.kind, "ready");

  const attempt = deps.repository.openByUser.get(USER_ID);
  attempt.state = "closed";
  deps.repository.openByUser.delete(USER_ID);

  const oldKey = await executeCheckout(input(KEY_A), deps);
  const newKey = await executeCheckout(input(KEY_B), deps);

  assert.equal(oldKey.kind, "closed_attempt");
  assert.equal(newKey.kind, "ready");
  assert.equal(deps.provider.createCalls, 2);
});

test("la migración contiene las invariantes finales de concurrencia", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/202608250001_checkout_attempts.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(sql, /unique \(user_id, idempotency_key\)/i);
  assert.match(sql, /checkout_attempts_one_open_per_user_idx/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /unique \(mercado_pago_preapproval_id\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /subscription_terminal/i);
});
