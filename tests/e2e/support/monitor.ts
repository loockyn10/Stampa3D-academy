import fs from "node:fs";
import path from "node:path";
import type { Page, Request, Response, ConsoleMessage } from "@playwright/test";
import { KNOWN_ISSUES, type KnownIssue } from "./known-issues";

export type FindingKind = "console" | "pageerror" | "http" | "requestfailed";

export interface Finding {
  kind: FindingKind;
  message: string;
  /** URL de la request (http/requestfailed) o de la ubicación del console message. */
  url?: string;
  status?: number;
  method?: string;
  /** URL de la página en el momento del hallazgo. */
  pageUrl: string;
}

export interface ExpectedHttp {
  status: number | number[];
  /** Subcadena o regex de la URL de la request. */
  url?: string | RegExp;
  method?: string;
}

const FINDINGS_FILE = path.join(process.cwd(), "test-results", "e2e", "findings.ndjson");

function matchesUrl(matcher: string | RegExp | undefined, url: string | undefined): boolean {
  if (!matcher) return true;
  if (!url) return false;
  return typeof matcher === "string" ? url.includes(matcher) : matcher.test(url);
}

/** Request abortada por el propio navegador (navegación que cancela prefetch/RSC): no es un error de la app. */
function isBrowserCancellation(failure: string | undefined): boolean {
  return !!failure && /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(failure);
}

/**
 * Registra errores de consola, excepciones de página, requests fallidas y respuestas 4xx/5xx.
 * - `expectHttp()` declara estados HTTP esperados POR TEST (p. ej. un 401 que el test provoca a propósito).
 * - Hallazgos cubiertos por `known-issues.ts` se reportan como "known" (siguen apareciendo en findings.ndjson).
 * - Todo lo demás es `unexpected` y hace fallar el test.
 */
export class PageMonitor {
  readonly all: Finding[] = [];
  private readonly expectedHttp: ExpectedHttp[] = [];
  private readonly extraKnown: KnownIssue[] = [];
  private detached = false;

  constructor(private readonly page: Page, private readonly testTitle: string, private readonly project: string) {
    page.on("console", this.onConsole);
    page.on("pageerror", this.onPageError);
    page.on("response", this.onResponse);
    page.on("requestfailed", this.onRequestFailed);
  }

  detach() {
    if (this.detached) return;
    this.detached = true;
    this.page.off("console", this.onConsole);
    this.page.off("pageerror", this.onPageError);
    this.page.off("response", this.onResponse);
    this.page.off("requestfailed", this.onRequestFailed);
  }

  expectHttp(expected: ExpectedHttp) {
    this.expectedHttp.push(expected);
  }

  /** Para allowlist local a un test; exige `reason`. */
  allow(issue: KnownIssue) {
    this.extraKnown.push(issue);
  }

  private push(finding: Omit<Finding, "pageUrl">) {
    this.all.push({ ...finding, pageUrl: this.page.url() });
  }

  private onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const location = msg.location();
    this.push({ kind: "console", message: msg.text(), url: location?.url });
  };

  private onPageError = (error: Error) => {
    this.push({ kind: "pageerror", message: `${error.name}: ${error.message}` });
  };

  private onResponse = (response: Response) => {
    const status = response.status();
    if (status < 400) return;
    const request = response.request();
    this.push({ kind: "http", message: `HTTP ${status}`, status, url: response.url(), method: request.method() });
  };

  private onRequestFailed = (request: Request) => {
    const failure = request.failure()?.errorText;
    if (isBrowserCancellation(failure)) return;
    this.push({ kind: "requestfailed", message: failure ?? "request failed", url: request.url(), method: request.method() });
  };

  private isExpectedHttp(finding: Finding): boolean {
    // Chrome además emite un console.error "Failed to load resource: ... status of N" por cada respuesta 4xx/5xx:
    // si ese N está declarado como esperado para esa URL, el eco de consola también lo está.
    let status = finding.status;
    if (finding.kind === "console") {
      const echoed = /Failed to load resource: the server responded with a status of (\d+)/.exec(finding.message);
      if (!echoed) return false;
      status = Number(echoed[1]);
    } else if (finding.kind !== "http") {
      return false;
    }
    return this.expectedHttp.some((expected) => {
      const statuses = Array.isArray(expected.status) ? expected.status : [expected.status];
      return (
        statuses.includes(status ?? -1) &&
        matchesUrl(expected.url, finding.url) &&
        (finding.kind === "console" || !expected.method || expected.method === finding.method)
      );
    });
  }

  private knownIssueFor(finding: Finding): KnownIssue | undefined {
    return [...KNOWN_ISSUES, ...this.extraKnown].find((issue) => issue.matches(finding));
  }

  classify() {
    const expected: Finding[] = [];
    const known: Array<{ finding: Finding; issue: KnownIssue }> = [];
    const unexpected: Finding[] = [];
    for (const finding of this.all) {
      if (this.isExpectedHttp(finding)) {
        expected.push(finding);
        continue;
      }
      const issue = this.knownIssueFor(finding);
      if (issue) known.push({ finding, issue });
      else unexpected.push(finding);
    }
    return { expected, known, unexpected };
  }

  /** Persiste todo lo observado (también lo permitido) para que nada quede oculto en el reporte. */
  persist() {
    if (this.all.length === 0) return;
    try {
      fs.mkdirSync(path.dirname(FINDINGS_FILE), { recursive: true });
      const { expected, known, unexpected } = this.classify();
      const lines = [
        ...unexpected.map((finding) => ({ status: "unexpected", finding })),
        ...known.map(({ finding, issue }) => ({ status: "known", issue: issue.id, finding })),
        ...expected.map((finding) => ({ status: "expected", finding })),
      ].map((row) => JSON.stringify({ test: this.testTitle, project: this.project, ...row }));
      fs.appendFileSync(FINDINGS_FILE, `${lines.join("\n")}\n`);
    } catch {
      // El registro es best-effort: nunca debe romper un test.
    }
  }
}

export function formatFindings(findings: Finding[]): string[] {
  return findings.map((finding) => {
    const where = finding.url ? ` ${finding.method ?? ""} ${finding.url}`.replace(/\s+/g, " ") : "";
    return `[${finding.kind}] ${finding.message}${where} (en ${finding.pageUrl})`;
  });
}
