// Mecanismo de grabación con cuenta de demostración (scripts/demo): salvaguardas y que los secretos no entren a Git.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readRepoFile as read } from "./helpers/load-ts.mjs";

const SCRIPT = "scripts/demo/check-access.mjs";

/** Ejecuta el script con un entorno controlado. Las salvaguardas terminan antes de abrir el navegador o la red. */
function run(env) {
  const base = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DEMO_SKIP_LOCAL_FILE: "1" };
  return spawnSync(process.execPath, [SCRIPT], { env: { ...base, ...env }, encoding: "utf8", timeout: 20_000 });
}

test("sin credenciales explica qué variables faltan y no abre nada", () => {
  const result = run({});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEMO_ACCOUNT_EMAIL/);
  assert.match(result.stderr, /DEMO_ACCOUNT_PASSWORD/);
});

test("rechaza una cuenta que no parece de demostración y no imprime la contraseña", () => {
  const result = run({ DEMO_ACCOUNT_EMAIL: "persona.real@ejemplo.com", DEMO_ACCOUNT_PASSWORD: "clave-super-secreta-123" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no parece una cuenta de demostración/);
  assert.doesNotMatch(result.stdout + result.stderr, /clave-super-secreta-123|persona\.real/);
});

test("rechaza un servidor que no es local salvo autorización explícita", () => {
  const result = run({ DEMO_ACCOUNT_EMAIL: "demo.universo@ejemplo.com", DEMO_ACCOUNT_PASSWORD: "x-clave-123", DEMO_BASE_URL: "https://sitio-publico.example.com" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no es local/);
});

test("las credenciales y la sesión guardada están ignoradas por Git y el repo no las contiene", () => {
  const ignore = read(".gitignore");
  assert.match(ignore, /^\.env\*$/m);
  assert.match(ignore, /^\/tests\/e2e\/\.auth\/$/m);
  const lib = read("scripts/demo/lib.mjs");
  assert.doesNotMatch(lib, /password\s*[:=]\s*["'][^"']+["']/i);
  // El login nunca se graba: el contexto de login no usa recordVideo y las grabaciones parten de la sesión guardada.
  const loginPart = lib.slice(lib.indexOf("export async function ensureSession"));
  assert.doesNotMatch(loginPart.slice(loginPart.indexOf("browser.newContext"), loginPart.indexOf("browser.newContext") + 200), /recordVideo/);
  assert.match(lib, /storageState: AUTH_FILE/);
});
