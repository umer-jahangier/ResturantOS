import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";

/**
 * The runtime gate for the expressive surfaces (plans 34-06 task 3 and 34-07 task 2).
 *
 * <h3>What this asserts that the static tests cannot</h3>
 *
 * `glass-contrast.test.ts` measures the tokens. This measures the SCREEN: that the surface is
 * actually there, that it is accessible with the compositing filter forced off — which is the
 * real deployment condition D-34-04 names, a browser that reports support and then does
 * nothing with it — and that the entrance has finished before anything is judged.
 *
 * <h3>Preconditions before every judgement, and a forbidden condition too</h3>
 *
 * Following the `kds-three-state-greyscale.spec.ts` precedent: a screenshot taken mid-entrance
 * is evidence of nothing, and a screenshot of a screen whose data never loaded is worse than
 * none. Each surface below therefore declares BOTH an anchor that must be present and a
 * pattern whose presence means the page is a refusal rather than the screen.
 *
 * The second half is not paranoia. The phase's evidence harness signed in as
 * `manager@terrace.local`, who does not hold `rbac.manage`, so every settings screenshot on
 * file was of an Access-denied page — filed as evidence that the settings restyle landed.
 * "Access denied" renders perfectly well, and a harness with no forbidden condition files it
 * happily.
 *
 * <h3>Negative controls performed, OBSERVED red then restored</h3>
 *
 * <ol>
 *   <li>The filter-off stylesheet injection changed to a selector that matches nothing
 *       (`.nothing-matches-this`) → the injection assertion failed, naming the elements that
 *       still resolved a filter. Without that assertion this whole describe would have run
 *       under the composited condition while reporting the degraded one.</li>
 *   <li>`GlassPanel` stripped of its `glass-surface` class — the product with no glass at all
 *       → the positive control at the foot of this file failed with ANCHOR NOT FOUND, which
 *       is the state every degradation assertion above is otherwise compatible with.</li>
 * </ol>
 */

const OWNER = persona("saffron", "owner");

const BLOCKING = new Set(["critical", "serious"]);

interface Surface {
  name: string;
  route: string;
  /** Signed in as, or `null` for the unauthenticated login screen. */
  as: typeof OWNER | null;
  /** Must be on screen before anything is judged. */
  anchor: string;
  /** Its presence means the page is not the screen this test claims to be looking at. */
  forbid: RegExp;
}

const SURFACES: Surface[] = [
  {
    name: "login (unauthenticated, glass card)",
    route: "/login",
    as: null,
    anchor: '[data-zone="expressive"]',
    forbid: /Something went wrong/i,
  },
  {
    /*
     * Anchored on a PORTLET, not on the trend chart.
     *
     * The chart portlet renders its own empty state ("No trading days in this window.") when
     * the seeded tenant has no orders in the period, and saffron has none — so anchoring on
     * `trend-chart` would have made this test fail on seed data rather than on the treatment,
     * and "relax the anchor until it passes" is how an anchor becomes decoration. The chart's
     * runtime rendering is verified against a tenant that HAS trading data by
     * `e2e/shots-owner.mjs` (Floating Terrace), and its geometry, mask and frame-zero labels
     * are asserted by `__tests__/components/dashboard-character.test.tsx`.
     */
    name: "owner dashboard (glass portlets on a depth-layered grid)",
    route: "/app/dashboard",
    as: OWNER,
    anchor: '[data-testid="portlet-owner-net-sales"]',
    forbid: /Couldn.t load|Access denied/i,
  },
  {
    name: "settings (expressive zone nested in a restrained shell)",
    route: "/app/settings",
    as: OWNER,
    anchor: '[data-zone="expressive"]',
    forbid: /Access denied|You do not have permission/i,
  },
];

/**
 * Turn the compositing filter off the way a real deployment does, and ASSERT it took.
 *
 * An injected stylesheet that silently matched nothing is how a "degraded path" capture ends
 * up identical to the composited one — the third vacuous gate this phase catalogued, in a
 * different costume.
 */
async function forceFilterOff(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }`,
  });

  const remaining = await page.evaluate(() =>
    Array.from(document.querySelectorAll("*"))
      .filter((el) => {
        const cs = getComputedStyle(el);
        const v = cs.backdropFilter || cs.getPropertyValue("backdrop-filter");
        return Boolean(v) && v !== "none";
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`),
  );

  expect(
    remaining,
    `the injected stylesheet did not remove every compositing filter, so everything measured ` +
      `after this point is the COMPOSITED rendering wearing the degraded one's name:\n` +
      remaining.join("\n"),
  ).toEqual([]);
}

/** Wait for every entrance to finish, so nothing is judged mid-animation. */
async function entranceSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("*")).every((el) => {
        const anims = (el as HTMLElement).getAnimations?.() ?? [];
        return anims.every((a) => a.playState !== "running");
      }),
    undefined,
    { timeout: 15_000 },
  );
}

test.describe.configure({ mode: "serial" });

for (const surface of SURFACES) {
  test.describe(`${surface.name}`, () => {
    for (const theme of ["light", "dark"] as const) {
      test(`${theme}: renders, degrades, and is accessible with the filter off`, async ({
        as,
        page: anonymous,
        obs,
      }, testInfo) => {
        test.setTimeout(180_000);
        obs.expectConsoleError(
          /Failed to load resource|503|SERVICE_UNAVAILABLE/i,
          "a backing service being briefly unavailable is not what this surface test measures; " +
            "the anchor and forbid conditions below are what decide whether the screen rendered",
        );

        const page = surface.as ? await as(surface.as) : anonymous;
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(surface.route, { waitUntil: "domcontentloaded" });

        // ── PRECONDITION 1: the theme actually applied ──────────────────────────────────
        await expect
          .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")), {
            message:
              `the ${theme} theme did not apply. A capture that claims a theme it did not ` +
              `render is the third vacuous gate this phase catalogued.`,
            timeout: 15_000,
          })
          .toBe(theme === "dark");

        // ── PRECONDITION 2: the screen is the screen, not a refusal ─────────────────────
        await expect(
          page.locator(surface.anchor).first(),
          `ANCHOR NOT FOUND: "${surface.anchor}" is not on ${surface.route}. Every assertion ` +
            `below would then be about whatever rendered instead.`,
        ).toBeAttached({ timeout: 30_000 });

        const body = await page.locator("body").innerText();
        expect(
          surface.forbid.test(body),
          `${surface.route} rendered a refusal or a failure, not the surface under test. This ` +
            `is exactly how every settings screenshot in this phase came to be a picture of an ` +
            `Access-denied page.`,
        ).toBe(false);

        // ── PRECONDITION 3: nothing is still moving ─────────────────────────────────────
        await entranceSettled(page);

        // ── The degraded deployment condition, asserted rather than assumed ─────────────
        await forceFilterOff(page);

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();

        const violations = results.violations as unknown as {
          id: string;
          impact?: string | null;
          help: string;
          helpUrl: string;
          nodes: { html: string; target: string[] }[];
        }[];

        await testInfo.attach(
          `axe-${surface.route.replace(/\W+/g, "-")}-${theme}-filter-off.json`,
          { body: JSON.stringify(violations, null, 2), contentType: "application/json" },
        );

        const counts = violations.reduce<Record<string, number>>((acc, v) => {
          const key = v.impact ?? "unknown";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        console.log(
          `[axe] ${surface.name} ${theme}, filter off: ` +
            (Object.entries(counts)
              .map(([k, n]) => `${k}=${n}`)
              .join(" ") || "no violations"),
        );

        const blocking = violations.filter((v) => BLOCKING.has(v.impact ?? ""));
        expect(
          blocking.map((v) => `${v.impact}:${v.id}`),
          blocking
            .map(
              (v) =>
                `  · [${v.impact}] ${v.id} — ${v.help}\n      ${v.helpUrl}\n` +
                v.nodes
                  .slice(0, 3)
                  .map((n) => `        ${n.target.join(" ")}\n          ${n.html.slice(0, 160)}`)
                  .join("\n"),
            )
            .join("\n"),
        ).toEqual([]);
      });
    }
  });
}

test.describe("D-34-04 · the glass card resolves a filter, and its substrate is measured", () => {
  /**
   * The positive control for this file. Every assertion above is compatible with a product
   * that has no glass at all — the degraded condition is forced, and an accessible screen with
   * no glass passes every one of them. This asserts the effect is really shipping.
   *
   * Anchored on /login for the reason 34-01's control was re-anchored there: it is expressive,
   * carries a GlassPanel, and needs no session and no backing service. A control coupled to
   * seeded data and six services being up is a control that spends most of its life skipping.
   */
  test("login carries a real compositing filter over a manifest substrate", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    const glass = page.locator(".glass-surface, .glass-surface-overlay").first();
    await expect(
      glass,
      "ANCHOR NOT FOUND: no glass surface on /login, so every degradation assertion in this " +
        "file is passing because the product has no glass rather than because it degrades",
    ).toBeAttached({ timeout: 20_000 });

    const filter = await glass.evaluate(
      (el) =>
        getComputedStyle(el).backdropFilter ||
        getComputedStyle(el).getPropertyValue("backdrop-filter"),
    );
    expect(
      filter,
      "the glass rule is not resolving. Either it is not shipping or its selector does not match.",
    ).not.toBe("none");

    // And the surface it sits over is the one 34-02 measured, not whatever the page paints.
    const substrate = await page.evaluate(() => {
      const el = document.querySelector('[data-zone="expressive"]');
      if (!el) return "NO EXPRESSIVE ZONE";
      // Walk up to the first ancestor that paints an opaque background.
      let node: Element | null = el;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
        node = node.parentElement;
      }
      return "NO OPAQUE SUBSTRATE";
    });
    expect(
      substrate,
      "a glass surface with no opaque floor beneath it has no defined composite, and an " +
        "undefined figure cannot satisfy D-34-01",
    ).toMatch(/^(rgb|oklch|color)/);
  });
});
