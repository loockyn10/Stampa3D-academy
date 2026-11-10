/**
 * Utilidades para grabar las demostraciones de la landing con una cuenta de DEMOSTRACIÓN.
 *
 * Reglas (ver scripts/demo/README.md):
 * - Las credenciales solo se leen del entorno o de `.env.demo.local` (git-ignorado por `.env*`). Nunca se escriben en el repo,
 *   en logs ni en capturas.
 * - El login ocurre en un contexto aparte, SIN grabación; las grabaciones reutilizan la sesión guardada (storageState),
 *   así que la contraseña nunca aparece en un video ni en una imagen.
 * - No se desactiva ni se elude ninguna autenticación: se inicia sesión por la pantalla real de login.
 * - Por defecto solo se usa contra un servidor local (`DEMO_BASE_URL`, http://localhost:3000).
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

export const ROOT = process.cwd();
export const LOCAL_ENV_FILE = path.join(ROOT, ".env.demo.local");
/** Sesión guardada. `/tests/e2e/.auth/` ya está en .gitignore. */
export const AUTH_FILE = path.join(ROOT, "tests", "e2e", ".auth", "demo-taller.json");

/** Pantallas de Mi Taller que el recorrido usa. */
export const TALLER_ROUTES = ["/mi-taller", "/mi-taller/productos", "/mi-taller/filamentos", "/mi-taller/impresoras", "/mi-taller/inventario"];

/** Carga `.env.demo.local` (KEY=VALUE) sin pisar variables ya definidas en el entorno. Solo claves DEMO_*. */
export function loadLocalEnv() {
  // DEMO_SKIP_LOCAL_FILE=1 lo usan los tests para no depender de un archivo local real.
  if (process.env.DEMO_SKIP_LOCAL_FILE === "1" || !fs.existsSync(LOCAL_ENV_FILE)) return false;
  for (const raw of fs.readFileSync(LOCAL_ENV_FILE, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!key.startsWith("DEMO_") || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
  return true;
}

export function maskEmail(email) {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}***@${domain ? `${domain.slice(0, 1)}***` : ""}`;
}

/** Devuelve la configuración o termina con un mensaje accionable (sin imprimir nunca la contraseña). */
export function getConfig() {
  loadLocalEnv();
  const email = process.env.DEMO_ACCOUNT_EMAIL?.trim();
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  const baseUrl = (process.env.DEMO_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");

  const missing = [];
  if (!email) missing.push("DEMO_ACCOUNT_EMAIL");
  if (!password) missing.push("DEMO_ACCOUNT_PASSWORD");
  if (missing.length) {
    fail(
      `Faltan variables: ${missing.join(", ")}.\n` +
        `Definilas en el entorno de tu terminal o en ${path.relative(ROOT, LOCAL_ENV_FILE)} (archivo ignorado por Git). Ver scripts/demo/README.md.`,
    );
  }

  // Salvaguarda 1: solo la cuenta de demostración. Una cuenta real no debe grabarse por error.
  const localPart = email.split("@")[0].toLowerCase();
  if (!localPart.includes("demo") && process.env.DEMO_ALLOW_ANY_EMAIL !== "1") {
    fail(
      `El email ${maskEmail(email)} no parece una cuenta de demostración (la parte local debe contener "demo", p. ej. demo.universo@...).\n` +
        "Esto evita grabar por error una cuenta con datos reales.",
    );
  }

  // Salvaguarda 2: el servidor debe ser local, salvo autorización explícita.
  const host = new URL(baseUrl).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  if (!isLocal && process.env.DEMO_ALLOW_REMOTE !== "1") {
    fail(`DEMO_BASE_URL apunta a ${host}, que no es local. Por defecto solo se graba contra el servidor de desarrollo local.`);
  }

  return { email, password, baseUrl };
}

export function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Quita cualquier rastro de credenciales de un texto antes de imprimirlo. */
export function redact(text, config) {
  let out = String(text ?? "");
  for (const secret of [config.password, config.email]) {
    if (secret) out = out.split(secret).join("[oculto]");
  }
  return out;
}

export async function launchBrowser() {
  const channel = process.env.DEMO_BROWSER_CHANNEL?.trim() || "msedge";
  return chromium.launch({ channel, headless: true });
}

export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

/** Contexto con la sesión guardada. Pasar `recordDir` para grabar video; el login nunca se graba. */
export async function newSessionContext(browser, config, { viewport = DEFAULT_VIEWPORT, recordDir, deviceScaleFactor = 1 } = {}) {
  return browser.newContext({
    baseURL: config.baseUrl,
    viewport,
    deviceScaleFactor,
    colorScheme: "dark",
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    storageState: AUTH_FILE,
    ...(recordDir ? { recordVideo: { dir: recordDir, size: viewport } } : {}),
  });
}

/**
 * Inicia sesión por la pantalla real de login en un contexto SIN grabación y guarda la sesión.
 * Si ya hay una sesión válida y no se fuerza, la reutiliza.
 */
export async function ensureSession(browser, config, { force = false } = {}) {
  if (!force && fs.existsSync(AUTH_FILE)) {
    const context = await newSessionContext(browser, config);
    const page = await context.newPage();
    await page.goto("/mi-taller", { waitUntil: "domcontentloaded" });
    const valid = !new URL(page.url()).pathname.startsWith("/login");
    await context.close();
    if (valid) return "reutilizada";
  }

  const context = await browser.newContext({ baseURL: config.baseUrl, locale: "es-AR", colorScheme: "dark" });
  const page = await context.newPage();
  try {
    // Esperar a que la página termine de cargar: si se escribe antes de la hidratación de React, el formulario envía campos vacíos.
    await page.goto("/login?returnTo=%2Fmi-taller", { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(config.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  } catch {
    await context.close();
    fail("No se pudo iniciar sesión: credenciales incorrectas, email sin confirmar o el servidor local no está levantado.");
  }
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await context.storageState({ path: AUTH_FILE });
  await context.close();
  return "nueva";
}
