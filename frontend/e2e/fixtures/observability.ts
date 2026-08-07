import type { ConsoleMessage, Page, Request, Response } from "@playwright/test";

/**
 * The console-error and network-failure guard that every journey carries.
 *
 * WHY THIS EXISTS
 * ===============
 * A spec that only asserts "the page rendered" passes against a page that rendered a React
 * key warning, a failed 500 on a side-panel fetch, and an unhandled promise rejection. Those
 * are exactly the defects users report and specs miss. So every page this suite opens is
 * watched for three things:
 *
 *   console.error   — React warnings, hydration mismatches, caught-and-logged failures
 *   pageerror       — an uncaught exception; the page is broken even if it looks fine
 *   4xx/5xx         — a request the app made that the server refused
 *
 * WHY IT IS ALLOW-LISTED RATHER THAN ABSOLUTE
 * ===========================================
 * Several of the most valuable assertions in this suite are ABOUT a 4xx: a forbidden route
 * must 403, an unauthenticated load must bounce, a feature-gated tenant must be refused
 * FEATURE_DISABLED. A guard with no escape hatch would make the correct behaviour red, and a
 * suite that is red for correct behaviour gets muted. So a spec DECLARES the failures it
 * expects — `obs.expect403("/api/v1/crm/")` — and anything undeclared fails the test.
 *
 * The declaration is the point: it is a written, reviewable claim about which errors are
 * by-design, sitting next to the assertion that depends on it.
 */

export interface NetworkFailure {
  url: string;
  method: string;
  status: number;
  body: string;
}

export interface ConsoleFailure {
  kind: "console.error" | "pageerror";
  text: string;
  location: string;
}

/**
 * Noise that is the DEV TOOLCHAIN's, not the product's, and would otherwise fire on every
 * single test. Each entry is justified — an unexplained mute is how a real defect gets hidden.
 */
const INFRA_CONSOLE_IGNORES: RegExp[] = [
  // Next.js dev server: Fast Refresh / HMR chatter and the webpack dev overlay.
  /\[Fast Refresh\]/i,
  /webpack-hmr|_next\/static\/chunks\/.*hot-update/i,
  // React DevTools nag, printed once per page load in dev.
  /Download the React DevTools/i,
  // The service worker we deliberately disable in prepareForPos() rejects registration.
  /\[e2e\] SW registration disabled/i,
  // Chromium emits this for any HTTP response the page then handles itself; the network
  // guard below is the authoritative check for those, with status and URL.
  /Failed to load resource: the server responded with a status of/i,
];

/**
 * URLs that are not the application's traffic. Kept deliberately short.
 */
const INFRA_URL_IGNORES: RegExp[] = [
  /\/favicon\.ico$/,
  /\/_next\/(static|webpack-hmr|image)/,
  /\/__nextjs/,
  /\/sw\.js$/,
  /\.map$/,
];

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

export interface ExpectedFailure {
  /** Matched against the request URL. */
  url: string | RegExp;
  /** If omitted, ANY 4xx/5xx on that URL is permitted. */
  status?: number | number[];
  /** Why this failure is correct behaviour. Required — it is documentation, not a comment. */
  because: string;
}

/**
 * Collects console and network failures across every page in a test, and asserts at teardown.
 */
export class Observability {
  readonly consoleFailures: ConsoleFailure[] = [];
  readonly networkFailures: NetworkFailure[] = [];

  private readonly expectedNetwork: ExpectedFailure[] = [];
  private readonly expectedConsole: { pattern: RegExp; because: string }[] = [];
  private watched = 0;

  /**
   * Declare that requests matching `url` are EXPECTED to fail — because refusing them is the
   * behaviour under test.
   */
  expectNetworkFailure(spec: ExpectedFailure): this {
    this.expectedNetwork.push(spec);
    return this;
  }

  /** Shorthand for the common case: an authorization refusal that the spec is asserting. */
  expect403(url: string | RegExp, because: string): this {
    return this.expectNetworkFailure({ url, status: 403, because });
  }

  /** Shorthand for an expected 401 (an unauthenticated probe, a refused login). */
  expect401(url: string | RegExp, because: string): this {
    return this.expectNetworkFailure({ url, status: 401, because });
  }

  /** Declare a console error that is correct behaviour (e.g. the app logging a handled 403). */
  expectConsoleError(pattern: RegExp, because: string): this {
    this.expectedConsole.push({ pattern, because });
    return this;
  }

  /** Number of pages this guard is attached to — asserted so a spec cannot silently watch none. */
  get watchedPages(): number {
    return this.watched;
  }

  private isExpectedNetwork(f: NetworkFailure): boolean {
    return this.expectedNetwork.some((e) => {
      const urlOk = typeof e.url === "string" ? f.url.includes(e.url) : e.url.test(f.url);
      if (!urlOk) return false;
      if (e.status === undefined) return true;
      const statuses = Array.isArray(e.status) ? e.status : [e.status];
      return statuses.includes(f.status);
    });
  }

  private isExpectedConsole(f: ConsoleFailure): boolean {
    return this.expectedConsole.some((e) => e.pattern.test(f.text));
  }

  /** Start watching a page. Safe to call for every page a test opens. */
  watch(page: Page): void {
    this.watched += 1;

    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (matchesAny(text, INFRA_CONSOLE_IGNORES)) return;
      const loc = msg.location();
      this.consoleFailures.push({
        kind: "console.error",
        text,
        location: `${loc.url}:${loc.lineNumber}`,
      });
    });

    page.on("pageerror", (err: Error) => {
      this.consoleFailures.push({
        kind: "pageerror",
        text: String(err?.message ?? err),
        location:
          String(err?.stack ?? "")
            .split("\n")[1]
            ?.trim() ?? "",
      });
    });

    page.on("response", (res: Response) => {
      const status = res.status();
      if (status < 400) return;
      const url = res.url();
      if (matchesAny(url, INFRA_URL_IGNORES)) return;
      const req: Request = res.request();
      // Body is read lazily and best-effort: a redirected or aborted response has none, and
      // failing to read it must never be what fails the test.
      void res
        .text()
        .catch(() => "")
        .then((body) => {
          this.networkFailures.push({
            url,
            method: req.method(),
            status,
            body: body.slice(0, 400),
          });
        });
    });
  }

  /** Everything observed that was not declared expected. */
  unexpected(): { console: ConsoleFailure[]; network: NetworkFailure[] } {
    return {
      console: this.consoleFailures.filter((f) => !this.isExpectedConsole(f)),
      network: this.networkFailures.filter((f) => !this.isExpectedNetwork(f)),
    };
  }

  /** A human-readable failure report, or null when clean. */
  report(): string | null {
    const { console: cf, network: nf } = this.unexpected();
    if (cf.length === 0 && nf.length === 0) return null;

    const lines: string[] = [];
    if (cf.length > 0) {
      lines.push(`${cf.length} unexpected browser console error(s):`);
      for (const f of cf.slice(0, 10)) {
        lines.push(`  · [${f.kind}] ${f.text}`);
        if (f.location) lines.push(`      at ${f.location}`);
      }
    }
    if (nf.length > 0) {
      lines.push(`${nf.length} unexpected failed request(s):`);
      for (const f of nf.slice(0, 10)) {
        lines.push(`  · ${f.status} ${f.method} ${f.url}`);
        if (f.body) lines.push(`      ${f.body.replace(/\s+/g, " ").slice(0, 200)}`);
      }
    }
    lines.push("");
    lines.push(
      "If any of these is CORRECT behaviour the spec must say so — " +
        "`obs.expect403(url, 'why')` — rather than the guard being loosened for everyone.",
    );
    return lines.join("\n");
  }
}

/**
 * Give the response listeners a moment to finish reading bodies before the report is built.
 * Without it a failure that arrived on the last action can be reported with an empty body,
 * which is the difference between a diagnosable failure and a puzzling one.
 */
export async function settle(ms = 250): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
