import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";
import { DEFECTS, tolerate } from "../fixtures/known-defects";

/**
 * ACCESSIBILITY SMOKE — axe-core on the main screens, reported BY SEVERITY.
 *
 * WHY THE GATE IS "NO CRITICAL / SERIOUS" AND NOT "NO VIOLATIONS"
 * ==============================================================
 * axe's four impact levels are not four flavours of the same thing. `critical` and `serious`
 * are "a user relying on assistive technology cannot complete this task" — a keyboard trap,
 * an unlabelled control, text at 2:1 contrast. `moderate` and `minor` are largely advisory
 * (heading order, landmark structure) and a brand-new codebase will have dozens.
 *
 * A gate set at zero-of-everything gets switched off within a week. A gate set at
 * zero-critical-and-serious is one a team can actually hold, so it is the one that survives
 * — and it is the one that maps to "a person cannot use this".
 *
 * EVERY violation is printed regardless of severity, and attached to the Playwright report
 * as JSON, so the advisory ones are visible without being blocking.
 *
 * SCOPE. axe is run against the rendered page AFTER the app has settled, as a signed-in
 * persona — not against a static route. Most of this product's UI does not exist until a
 * session resolves, so scanning /login alone would scan almost nothing.
 */

interface AxeNode {
  html: string;
  target: string[];
  failureSummary?: string;
}
interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

const BLOCKING = new Set(["critical", "serious"]);

/** Screens chosen to cover a different rendering shape each: shell, grid, board, table. */
const SCREENS: Array<{
  name: string;
  route: string;
  personaLocal: "manager" | "cashier" | "kitchen";
  /** Something that must be on screen before axe runs, so it never scans a skeleton. */
  settled: (page: import("@playwright/test").Page) => Promise<void>;
}> = [
  {
    name: "dashboard (app shell + sidebar)",
    route: "/app/dashboard",
    personaLocal: "manager",
    settled: async (page) => {
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible({
        timeout: 30_000,
      });
    },
  },
  {
    name: "POS terminal (menu grid + order panel)",
    route: "/app/pos",
    personaLocal: "cashier",
    settled: async (page) => {
      await expect(page.getByTestId("menu-grid")).toBeVisible({ timeout: 45_000 });
    },
  },
  {
    name: "reports browser (list + links)",
    route: "/app/reports",
    personaLocal: "manager",
    settled: async (page) => {
      await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible({
        timeout: 30_000,
      });
    },
  },
];

test.describe("accessibility smoke", () => {
  for (const screen of SCREENS) {
    test(`axe: ${screen.name}`, async ({ as, obs }, testInfo) => {
      test.setTimeout(120_000);

      // The POS screens carry E2E-D4's rejected socket; the accessibility of the page is
      // not what that defect is about, so it is declared rather than allowed to mask this
      // result.
      if (screen.route.startsWith("/app/pos")) {
        tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);
      }

      const page = await as(persona("terrace", screen.personaLocal));
      await page.goto(screen.route, { waitUntil: "domcontentloaded" });
      await screen.settled(page);

      const results = await new AxeBuilder({ page })
        // The four rulesets that correspond to a real conformance target. `best-practice`
        // is deliberately excluded from the SCAN, not merely from the gate: it is advice,
        // and mixing advice into a conformance report makes the report unreadable.
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const violations = results.violations as unknown as AxeViolation[];

      const bySeverity: Record<string, AxeViolation[]> = {};
      for (const v of violations) {
        const key = v.impact ?? "unknown";
        (bySeverity[key] ??= []).push(v);
      }

      // Attach the full result so the advisory findings are recoverable from the report
      // without re-running anything.
      await testInfo.attach(`axe-${screen.route.replace(/\W+/g, "-")}.json`, {
        body: JSON.stringify({ url: screen.route, violations }, null, 2),
        contentType: "application/json",
      });

      const summary = ["critical", "serious", "moderate", "minor", "unknown"]
        .filter((s) => bySeverity[s]?.length)
        .map((s) => `${s}=${bySeverity[s]!.length}`)
        .join(" ");
      // Printed on PASS as well as failure: "0 critical, 14 moderate" is the number that
      // tells you whether the gate is holding a real line or an empty one.
      console.log(`[axe] ${screen.name}: ${summary || "no violations"}`);

      const blocking = violations.filter((v) => BLOCKING.has(v.impact ?? ""));

      const detail = blocking
        .map((v) => {
          const nodes = v.nodes
            .slice(0, 3)
            .map((n) => `        ${n.target.join(" ")}\n          ${n.html.slice(0, 160)}`)
            .join("\n");
          return `  · [${v.impact}] ${v.id} — ${v.help}\n      ${v.helpUrl}\n${nodes}`;
        })
        .join("\n");

      expect(
        blocking.map((v) => `${v.impact}:${v.id}`),
        `${blocking.length} blocking accessibility violation(s) on ${screen.route} ` +
          `(all severities: ${summary}).\n\n${detail}\n\n` +
          "critical/serious means a user on a screen reader or keyboard cannot complete " +
          "this screen's task. Moderate and minor findings are in the attached JSON and " +
          "are deliberately NOT blocking.",
      ).toEqual([]);
    });
  }
});
