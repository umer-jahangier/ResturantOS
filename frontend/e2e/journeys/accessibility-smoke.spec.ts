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

/**
 * The entrance vocabulary an expressive page opts into (`app/globals.css:1378-1427`).
 *
 * <p>Named rather than "wait for all animations to stop", because some of this product's
 * animations never stop by design — `shimmer` on a skeleton is `infinite`
 * (`globals.css:1557`), and a wait for silence would hang on any page still loading anything.
 */
const ENTRANCE_ANIMATIONS = ["vdlEnter", "vdlEnterScale", "vdlReveal"];

/**
 * Hold until the expressive-zone entrance animations have finished.
 *
 * <h3>Why this is a correctness fix and not a flake patch</h3>
 *
 * Measured on the dashboard, 2026-08-22, at the instant the first portlet became visible:
 * axe reported **17 serious `color-contrast` nodes**, and the tiles were mid-`vdlEnter` at
 * opacity 0.998 / 0.990 / 0.970 / 0.920 — the stagger. Three seconds later, with every portlet
 * at opacity 1, the same scan reported **zero**.
 *
 * <p>The giveaway is in axe's own numbers: the SAME class, `text-foreground-tertiary`, was
 * reported at 3.92:1 on one tile and 2.38:1 on the next. A static colour cannot produce two
 * ratios on one page. What axe measured was the composite of a partially transparent element
 * over its background at two different stagger offsets — i.e. a rendering that exists for
 * ~400ms and that no user is asked to read.
 *
 * <p>So this belongs beside `settled`, and for the same stated reason: a fading element is the
 * same class of not-yet-real as a skeleton, and scanning one produces findings that are neither
 * true nor actionable. Waiting on the animations by name is deterministic — no sleep, and no
 * chance of masking a genuine contrast defect, which is still measured a moment later.
 */
async function settleEntranceAnimations(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(
    (names: string[]) =>
      document
        .getAnimations()
        .every(
          (a) => !names.includes((a as CSSAnimation).animationName) || a.playState === "finished",
        ),
    ENTRANCE_ANIMATIONS,
    { timeout: 15_000 },
  );
}

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
      /*
       * NOT `heading level 1 name "Dashboard"`. That string is not on this page and has not
       * been since the role dashboards landed: `DashboardShell` renders `{preset.question}` as
       * its `<h1>` (`components/dashboard/dashboard-shell.tsx:133`), so a manager's reads
       * "What needs me in the next five minutes?" and an owner's "Is the business healthy?"
       * (`components/dashboard/presets.ts`). The locator could never match, so on 2026-08-22 it
       * timed out for 30s and **axe never ran on the dashboard at all** — this screen had
       * produced no accessibility measurement, ever, while reporting as a covered screen.
       *
       * The replacement is stronger than what it replaces, not weaker. `data-testid="dashboard"`
       * is a stable contract hook, and `[data-portlet]` is a real data-settled signal: measured
       * on the same run, at the instant the shell attaches the page holds 26 skeletons and ZERO
       * `[data-portlet]` elements, and 1.5s later 8 portlets and zero skeletons — each portlet
       * mounts behind its own query boundary (UI-SPEC §8.1.1). The old anchor, had it ever
       * matched, was a static preset string present during the skeleton phase too, i.e. it
       * would have let axe scan skeletons, which is the one thing `settled` exists to prevent.
       */
      await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-testid="dashboard"] h1')).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator("[data-portlet]").first(),
        "the dashboard's portlets each mount behind their own query boundary, so the first one " +
          "on screen is what tells us axe would be scanning content rather than skeletons",
      ).toBeVisible({ timeout: 30_000 });
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
      await settleEntranceAnimations(page);

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
