import { defineConfig, devices } from "@playwright/test";

/**
 * Suite E2E de Universo Stampa. Ver tests/e2e/README.md.
 *
 * - E2E_BASE_URL: apunta a un servidor ya desplegado (preview/staging). Si falta, se levanta
 *   `next start` local (requiere `npm run build` previo) en E2E_LOCAL_PORT (3100 por defecto).
 * - E2E_BROWSER_CHANNEL: "chrome" (por defecto, usa el Chrome instalado), "msedge", o "" para el
 *   Chromium propio de Playwright (requiere `npx playwright install chromium`).
 * - Credenciales por rol: E2E_{FREE,BETA,PAID,ADMIN}_{EMAIL,PASSWORD}. Sin ellas los tests de ese
 *   rol se omiten (skipped), nunca pasan en falso.
 * - Mutaciones: solo con E2E_ALLOW_MUTATIONS=1 y contra un Supabase descartable (NO producción).
 */
const localPort = Number(process.env.E2E_LOCAL_PORT || 3100);
const externalBaseUrl = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const baseURL = externalBaseUrl || `http://localhost:${localPort}`;
const channel = process.env.E2E_BROWSER_CHANNEL ?? "chrome";

const browserUse = channel ? { channel } : {};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.(spec|setup)\.ts$/,
  outputDir: "./test-results/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/e2e/results.json" }],
  ],
  use: {
    baseURL,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/, use: { ...devices["Desktop Chrome"], ...browserUse } },
    {
      name: "desktop",
      testMatch: /.*\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], ...browserUse, viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      testMatch: /.*\.spec\.ts$/,
      testIgnore: /\.desktop-only\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], ...browserUse, viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npm run start -- -p ${localPort}`,
        url: `http://localhost:${localPort}/login`,
        reuseExistingServer: true,
        timeout: 120_000,
        // Clave de proveedor FALSA solo para el servidor local de la suite: hace visible la UI de Explorar Modelos
        // (los tests mockean /api/model-search; nunca se usa una credencial real).
        env: { MYMINIFACTORY_API_KEY: process.env.E2E_FAKE_PROVIDER_KEY || "e2e-fake-key-not-valid" },
        stdout: "ignore",
        stderr: "pipe",
      },
});
