import fs from "node:fs";
import { test as setup } from "@playwright/test";
import { AUTH_DIR, ROLES, credentialsFor, storageStatePath } from "./support/env";
import { loginViaUi } from "./support/auth";

/**
 * Inicia sesión una vez por rol con credenciales en el entorno y guarda storageState (git-ignorado).
 * Roles sin credenciales se omiten: sus specs quedan "skipped" con el motivo explícito.
 */
fs.mkdirSync(AUTH_DIR, { recursive: true });

for (const role of ROLES) {
  setup(`login ${role}`, async ({ page }) => {
    const credentials = credentialsFor(role);
    setup.skip(!credentials, `sin credenciales E2E para ${role}`);
    await loginViaUi(page, credentials!);
    await page.context().storageState({ path: storageStatePath(role) });
  });
}
