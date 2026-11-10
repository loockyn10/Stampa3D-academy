/**
 * Comprobación de SOLO LECTURA: inicia sesión con la cuenta de demostración y recorre las pantallas de Mi Taller
 * para confirmar que la cuenta tiene acceso. No crea, edita ni borra nada, no guarda capturas ni videos y no imprime
 * datos de la cuenta (solo rutas y resultados).
 *
 *   node scripts/demo/check-access.mjs            # reutiliza la sesión guardada si es válida
 *   node scripts/demo/check-access.mjs --fresh    # fuerza un nuevo login
 */

import { TALLER_ROUTES, ensureSession, getConfig, launchBrowser, maskEmail, newSessionContext, redact } from "./lib.mjs";

const config = getConfig();
const fresh = process.argv.includes("--fresh");

console.log(`Servidor: ${config.baseUrl}`);
console.log(`Cuenta:   ${maskEmail(config.email)}`);

const browser = await launchBrowser();
try {
  const session = await ensureSession(browser, config, { force: fresh });
  console.log(`Sesión:   ${session}\n`);

  const context = await newSessionContext(browser, config);
  const page = await context.newPage();
  const problems = [];

  for (const route of TALLER_ROUTES) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    const finalPath = new URL(page.url()).pathname;
    const status = response?.status() ?? "sin respuesta";
    const body = await page.evaluate(() => document.body.innerText).catch(() => "");
    const emailOnScreen = body.toLowerCase().includes(config.email.toLowerCase());

    let verdict = "ok";
    if (finalPath.startsWith("/login")) verdict = "SIN SESIÓN (redirige a /login)";
    else if (finalPath.startsWith("/sin-acceso")) verdict = "SIN ACCESO: la cuenta no tiene acceso a la plataforma";
    else if (finalPath.startsWith("/no-disponible")) verdict = "NO DISPONIBLE: herramienta apagada por feature flag";
    else if (finalPath.startsWith("/onboarding")) verdict = "PIDE ONBOARDING: completarlo con la cuenta de demostración";
    if (verdict !== "ok") problems.push(`${route}: ${verdict}`);

    console.log(`${route.padEnd(24)} → ${finalPath.padEnd(24)} HTTP ${status}  ${verdict}${emailOnScreen ? "  [el email se ve en pantalla: enmascararlo al grabar]" : ""}`);
  }

  await context.close();
  console.log(problems.length ? `\n✖ ${problems.length} problema(s):\n  - ${problems.join("\n  - ")}` : "\n✔ La cuenta de demostración puede abrir todas las pantallas de Mi Taller.");
  process.exitCode = problems.length ? 2 : 0;
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error, config));
  process.exitCode = 1;
} finally {
  await browser.close();
}
