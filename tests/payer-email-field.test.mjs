// Pulido UX: «Correo de Mercado Pago» visible en /sin-acceso y tarjetas estables en el onboarding de la calculadora.
// El correo solo decide con qué correo se contrata en Mercado Pago: el dueño de la membresía sale del checkout attempt.
import assert from "node:assert/strict";
import test from "node:test";
import { readRepoFile } from "./helpers/load-ts.mjs";

const client = await readRepoFile("src/app/sin-acceso/sin-acceso-client.tsx");
const route = await readRepoFile("src/app/api/mercadopago/create-subscription/route.ts");
const modals = await readRepoFile("src/components/calculadora/calculator-access-modals.tsx");

test("el campo está visible (fuera de <details>), antes del botón de contratación y con el texto de ayuda", () => {
  const field = client.indexOf('data-testid="payer-email-field"');
  const details = client.indexOf("<details");
  const activate = client.indexOf('{loading ? "Generando link..." : "Activar membresía"}');
  assert.ok(field > 0 && field < activate, "antes de «Activar membresía»");
  assert.ok(field < details, "no está dentro del desplegable");
  assert.match(client, /Correo de Mercado Pago/);
  assert.match(
    client,
    /Si utilizás otro correo en Mercado Pago, podés indicarlo acá\. Tu membresía seguirá vinculada a tu cuenta de Universo Stampa/,
  );
  assert.match(client, /Contratarás con:/);
  assert.match(client, /htmlFor="payer-email"/);
  assert.match(client, /text-base[^"]*sm:text-sm/, "16px en móvil: sin zoom automático de iOS");
});

test("se precarga con el correo de la cuenta y se valida con la misma regla del servidor", () => {
  assert.match(client, /setPayerEmail\(\(current\) => current \|\| user\.email \|\| ""\)/);
  assert.match(client, /import \{ normalizePayerEmail \} from "@\/lib\/mercadopago\/checkout-restart"/);
  assert.match(client, /if \(!normalizedPayerEmail\) \{[\s\S]*?return;/);
});

test("el correo viaja como payer_email solo si difiere del de la cuenta; la identidad no depende de él", () => {
  assert.match(client, /\.\.\.\(mpEmail !== normalizedAccountEmail \? \{ payer_email: mpEmail \} : \{\}\)/);
  // Ningún user_id / owner / email de cuenta se envía: el servidor resuelve al dueño por la sesión.
  assert.doesNotMatch(client, /user_id|owner_id|userId:/);
  assert.match(route, /payerEmail: body\.payerEmail \?\? user\.email/);
  assert.match(route, /userId: user\.id/);
});

test("cambiar el correo con un checkout pendiente lo reemplaza con el mismo `restart` (nunca cancela uno aprobado)", () => {
  assert.match(client, /const replaceForEmail = mpEmail !== previousEmail;/);
  assert.match(client, /const restartCheckout = restart \|\| replaceForEmail;/);
  assert.match(client, /\.\.\.\(restartCheckout \? \{ restart: true \} : \{\}\)/);
  assert.match(client, /rememberCheckoutAttemptEmail\(mpEmail\)/);
});

test("onboarding de la calculadora: grilla con filas del alto de su tarjeta y scroll en el área (buscador fijo)", () => {
  assert.match(modals, /grid min-h-0 flex-1 auto-rows-max grid-cols-1 content-start gap-3 overflow-y-auto/);
});
