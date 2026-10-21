import type { Finding } from "./monitor";

/**
 * Allowlist de hallazgos de consola/red CONOCIDOS y justificados.
 * Regla: una entrada solo existe si hay un bug documentado (id QA-xxx en docs/QA_REPORT.md) con un test
 * dedicado que lo sigue señalando (test.fail dinámico), y se explica por qué se tolera aquí.
 * No agregar entradas "para que pase". Los hallazgos permitidos igual se escriben en
 * test-results/e2e/findings.ndjson y anotan el test como `known-issue`.
 */
export interface KnownIssue {
  id: string;
  reason: string;
  matches: (finding: Finding) => boolean;
}

function pagePath(finding: Finding): string {
  try {
    return new URL(finding.pageUrl).pathname;
  } catch {
    return "";
  }
}

export const KNOWN_ISSUES: KnownIssue[] = [
  {
    id: "QA-003",
    reason: "/sin-acceso consulta membership_settings con la anon key aun sin sesión: RLS responde 401 (la página es pública).",
    matches: (finding) => pagePath(finding) === "/sin-acceso" && !!finding.url?.includes("/rest/v1/membership_settings"),
  },
  {
    id: "QA-004",
    reason: "/pago/estado (pública) llama a /api/mercadopago/sync-subscription sin sesión y muestra el 401 crudo.",
    matches: (finding) =>
      pagePath(finding) === "/pago/estado" &&
      (!!finding.url?.includes("/api/mercadopago/sync-subscription") || /Error verificando estado/.test(finding.message)),
  },
];
