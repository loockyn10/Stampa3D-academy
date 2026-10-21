import { test as base, expect, type Page } from "@playwright/test";
import { PageMonitor, formatFindings } from "./monitor";
import {
  hasCredentials,
  missingCredentialsReason,
  storageStatePath,
  MUTATIONS_ALLOWED,
  MUTATION_SKIP_REASON,
  type Role,
} from "./env";

interface Options {
  /** Si es true (por defecto) un hallazgo inesperado de consola/red hace fallar el test. */
  strictMonitor: boolean;
}

interface Fixtures {
  monitor: PageMonitor;
}

export const test = base.extend<Fixtures & Options>({
  strictMonitor: [true, { option: true }],
  monitor: [
    async ({ page, strictMonitor }, use, testInfo) => {
      const monitor = new PageMonitor(page, testInfo.titlePath.slice(1).join(" › "), testInfo.project.name);
      await use(monitor);
      monitor.detach();
      monitor.persist();
      const { unexpected, known } = monitor.classify();
      if (known.length > 0) {
        testInfo.annotations.push({
          type: "known-issue",
          description: [...new Set(known.map(({ issue }) => issue.id))].join(", "),
        });
      }
      if (unexpected.length > 0) {
        await testInfo.attach("console-network-findings", {
          body: formatFindings(unexpected).join("\n"),
          contentType: "text/plain",
        });
      }
      // Si el test ya falló por otra causa, no enmascarar el error original.
      if (strictMonitor && testInfo.status === testInfo.expectedStatus) {
        expect(formatFindings(unexpected), "errores de consola/red inesperados").toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };

/** Agrupa tests que corren con la sesión guardada de un rol; se omiten si faltan credenciales. */
export function describeAsRole(role: Role, title: string, body: () => void) {
  test.describe(`[${role}] ${title}`, () => {
    test.skip(!hasCredentials(role), missingCredentialsReason(role));
    test.use({ storageState: storageStatePath(role) });
    body();
  });
}

/** Tests que escriben datos: solo con opt-in explícito (Supabase descartable). */
export function describeMutating(role: Role, title: string, body: () => void) {
  test.describe(`[${role}] ${title} (mutante)`, () => {
    test.skip(!MUTATIONS_ALLOWED, MUTATION_SKIP_REASON);
    test.skip(!hasCredentials(role), missingCredentialsReason(role));
    test.use({ storageState: storageStatePath(role) });
    body();
  });
}

/** Navega y espera a que la red se calme sin colgarse si hay polling/streams. */
export async function gotoSettled(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  return response;
}

/** Ruta final (path + query) tras redirects. */
export function currentPath(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

/** Overflow horizontal real de la página (el documento se puede desplazar de lado). */
export async function horizontalOverflow(page: Page): Promise<{ overflow: number; offenders: string[] }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const viewport = window.innerWidth;
    const overflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - viewport;
    const offenders: string[] = [];
    if (overflow > 1) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.position === "fixed") continue;
        if (rect.right > viewport + 1) {
          const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${
            typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""
          } (right=${Math.round(rect.right)})`;
          offenders.push(label);
          if (offenders.length >= 8) break;
        }
      }
    }
    return { overflow, offenders };
  });
}
