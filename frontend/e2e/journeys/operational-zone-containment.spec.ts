import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";
import { DEFECTS, tolerate } from "../fixtures/known-defects";

/**
 * RUNTIME half of the D-34-02 containment gate. The static half is
 * `__tests__/lib/theme/zone-containment.test.ts`.
 *
 * <h3>Why source analysis is not enough</h3>
 *
 * Three of the ways a compositing filter reaches the operational zone are invisible to a
 * source walk, and this spec exists for exactly those three:
 *
 * <ol>
 *   <li><b>A third-party stylesheet.</b> `node_modules` is out of the static closure by
 *       design — the code cannot be edited — but its CSS still paints.</li>
 *   <li><b>A selector the static parser did not model.</b> The parser understands the rule
 *       shapes this repo authors; a rule that reaches the POS by some other selector shape
 *       would parse as "not a filter rule" and pass.</li>
 *   <li><b>A portalled node.</b> Radix mounts overlays on `document.body`, which never had an
 *       ancestor in the zone subtree at all. This is the one that regressed in 34-01: the POS
 *       order-detail drawer blurred the terminal behind it.</li>
 * </ol>
 *
 * <p>So this reads <b>computed style</b> on the real routes, sweeping every element in the
 * document including portalled roots, rather than reading source text.
 */

/**
 * WAITER, not CASHIER, on the POS. A cashier's terminal renders "Your till is closed" until a
 * till session is opened, so the menu grid never mounts and the sweep would run against an
 * empty-state screen — passing for the wrong reason. A waiter reaches the terminal without a
 * till, which is why the pos-waiter-to-kitchen journey uses the same persona.
 */
const WAITER = persona("zaitoon", "waiter");
const KITCHEN = persona("zaitoon", "kitchen");
const MANAGER = persona("zaitoon", "manager");

/** A filter is "absent" if the resolved value is `none` or empty. Anything else is a repaint. */
interface Offender {
  selector: string;
  value: string;
}

/**
 * Walk every element in the document — `document.querySelectorAll("*")` reaches portalled
 * roots too, because a portal mounts into this same document — and report each one whose
 * resolved backdrop-filter is not absent.
 */
async function sweep(page: Page): Promise<Offender[]> {
  return page.evaluate(() => {
    const path = (el: Element): string => {
      const parts: string[] = [];
      let node: Element | null = el;
      for (let up = 0; node && up < 5; up += 1) {
        let part = node.tagName.toLowerCase();
        if (node.id) part += `#${node.id}`;
        const slot = node.getAttribute("data-slot");
        if (slot) part += `[data-slot="${slot}"]`;
        const zone = node.getAttribute("data-zone");
        if (zone) part += `[data-zone="${zone}"]`;
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(" > ");
    };

    const out: { selector: string; value: string }[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const style = getComputedStyle(el);
      const value =
        style.backdropFilter ||
        style.getPropertyValue("backdrop-filter") ||
        style.getPropertyValue("-webkit-backdrop-filter");
      if (value && value !== "none" && value.trim() !== "") {
        out.push({ selector: path(el), value });
      }
    }
    return out;
  });
}

function report(where: string, offenders: Offender[]): string {
  return (
    `${offenders.length} element(s) resolve a compositing filter on ${where}. ` +
    `backdrop-filter forces a repaint of everything beneath it, and this is the screen ` +
    `where that costs an operator time (D-34-02).\n` +
    offenders.map((o) => `  · ${o.selector}  →  ${o.value}`).join("\n")
  );
}

/**
 * Elements that create a CONTAINING BLOCK for `position: fixed` descendants.
 *
 * <h3>Why this belongs in a phase about how things look</h3>
 *
 * `transform`, `filter`, `backdrop-filter`, `perspective`, `will-change` and paint/layout
 * `contain` all make an element the containing block for its fixed descendants. That is spec
 * behaviour, not a Chromium quirk, and it applies at PRINT time as well as on screen.
 *
 * Phase 26's receipt lifts the bill out of the application shell with `position: fixed`
 * (`components/print/receipt-print.css`), and the route — `/app/pos/orders/[orderId]/receipt` —
 * lives under `app/pos/`. Glass morphism is exactly the technique that would break it, so this
 * sweep asserts the operational zone creates no such containing block anywhere.
 *
 * <p>It passes today for a structural reason rather than a lucky one: D-34-02 puts the whole POS
 * subtree in the operational zone, and every glass, tilt and lift rule in this phase is
 * selector-rooted at `[data-zone="expressive"]`. This test is what keeps that true when someone
 * later reaches for `will-change: transform` on a wrapper "for smoothness" — which creates the
 * containing block permanently, even with no transform ever applied.
 */
async function containingBlockCreators(page: Page): Promise<Offender[]> {
  return page.evaluate(() => {
    const out: { selector: string; value: string }[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const cs = getComputedStyle(el);
      const reasons: string[] = [];
      if (cs.transform && cs.transform !== "none") reasons.push(`transform: ${cs.transform}`);
      if (cs.filter && cs.filter !== "none") reasons.push(`filter: ${cs.filter}`);
      const backdrop = cs.backdropFilter || cs.getPropertyValue("backdrop-filter");
      if (backdrop && backdrop !== "none") reasons.push(`backdrop-filter: ${backdrop}`);
      if (cs.perspective && cs.perspective !== "none")
        reasons.push(`perspective: ${cs.perspective}`);
      // `will-change: opacity` does NOT create a containing block; transform/filter do.
      if (/transform|filter|perspective/.test(cs.willChange ?? "")) {
        reasons.push(`will-change: ${cs.willChange}`);
      }
      if (/paint|layout|strict|content/.test(cs.contain ?? "")) {
        reasons.push(`contain: ${cs.contain}`);
      }
      if (reasons.length > 0) {
        const tag = el.tagName.toLowerCase();
        const cls = String(el.className).slice(0, 60);
        out.push({ selector: `${tag}${cls ? "." + cls : ""}`, value: reasons.join(", ") });
      }
    }
    return out;
  });
}

/*
 * Serial, like `pos-waiter-to-kitchen.spec.ts`.
 *
 * Every test in this block loads the POS route, which fans out to /api/v1/pos/menu/*,
 * /pos/tables and /pos/tills. Run in parallel across six workers they compete for the same
 * endpoints and draw 503s, and the observability guard then fails them for a reason that has
 * nothing to do with compositing — the suite generating its own load and then reporting it as
 * a defect. Confirmed by running the same test alone, where it passes.
 */
test.describe.configure({ mode: "serial" });

test.describe("operational zone carries no compositing filter", () => {
  test("nothing on the POS route becomes a containing block for the receipt", async ({
    as,
    obs,
  }) => {
    test.setTimeout(120_000);
    tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);
    obs.expect403(
      /\/api\/v1\/pos\/tills/,
      "a waiter has no till permissions; the POS page probes for an active till regardless",
    );

    const page = await as(WAITER);
    await page.goto("/app/pos", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-zone="operational"]').first()).toBeAttached({
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    const offenders = await containingBlockCreators(page);
    expect(
      offenders,
      "An ancestor on the POS route creates a containing block for `position: fixed` " +
        "descendants. The receipt at /app/pos/orders/[orderId]/receipt anchors itself to the " +
        "page box with `position: fixed` precisely so a shell change cannot clip it — and any " +
        "of transform / filter / backdrop-filter / perspective / will-change / contain on an " +
        "ancestor silently undoes that, ON THE PRINTED PAGE, where nobody is looking.\n" +
        offenders.map((o) => `  · ${o.selector}  →  ${o.value}`).join("\n"),
    ).toEqual([]);
  });

  test("the POS terminal — at rest and with the order drawer open", async ({ as, obs }) => {
    test.setTimeout(120_000);
    tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);
    // A WAITER holds no till permissions, so the POS page's active-till probe is correctly
    // refused. Declared with its reason rather than tolerated broadly, so this spec keeps
    // failing on any 403 it did not predict.
    obs.expect403(
      /\/api\/v1\/pos\/tills/,
      "a waiter has no till permissions; the POS page probes for an active till regardless " +
        "and renders the till-closed state from the refusal",
    );

    const page = await as(WAITER);
    await page.goto("/app/pos", { waitUntil: "domcontentloaded" });

    // The zone must actually be declared, or the sweep below passes for the wrong reason —
    // an unrendered screen has no elements and therefore no offenders.
    await expect(
      page.locator('[data-zone="operational"]').first(),
      "the POS layout declares the operational zone; if this is missing the sweep proves nothing",
    ).toBeAttached({ timeout: 30_000 });

    /*
     * Precondition is the terminal's TAB BAR, not the menu grid.
     *
     * The menu grid is gated on an open till session — every POS persona lands on "Your till
     * is closed" until one is opened — so waiting for it makes this gate depend on seed state
     * that has nothing to do with compositing. The tab bar renders either way and proves the
     * terminal actually mounted, which is the property the sweep needs: an unrendered screen
     * has no elements and therefore trivially no offenders.
     */
    await expect(
      page.getByRole("button", { name: "POS Terminal", exact: true }),
      "the POS terminal shell never rendered, so the sweep below would pass vacuously",
    ).toBeVisible({ timeout: 45_000 });

    const atRest = await sweep(page);
    expect(atRest, report("the POS terminal at rest", atRest)).toEqual([]);

    /*
     * ── the portal route, which is the one source analysis cannot see ──────────────────
     *
     * The command palette is used rather than the POS order-detail drawer, and the reason
     * is recorded because it weakens the test slightly: the drawer needs a seeded table AND
     * an open till session, and neither exists for any POS persona in the current seed —
     * the Floor View renders no table cards and "Open Till" is an inline panel, not a
     * dialog. The palette is reachable unconditionally on the POS route and is a genuine
     * Radix portal to `document.body`, so it exercises the mechanism this test exists for.
     *
     * It resolves `restrained`, not `operational`, and that is CORRECT: it is opened from
     * the shell chrome, which declares restrained. What matters for containment is that it
     * is stamped at all (proving the stamp survives the portal) and that it is not
     * expressive (so 34-02's glass rule cannot match it above a POS terminal).
     */
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(2000);

    const overlay = page.locator('[data-slot="dialog-overlay"]').first();
    await expect(
      overlay,
      "the portalled overlay must carry data-slot so a zone-scoped rule can find it — it is " +
        "on document.body, outside every zone subtree, so ancestry cannot reach it",
    ).toBeAttached({ timeout: 20_000 });

    const stampedZone = await overlay.getAttribute("data-zone");
    expect(
      stampedZone,
      "the overlay carries no zone stamp. Without it the zone-scoped rule matches nothing: " +
        "written, looks correct, does nothing. This is the defect the stamp exists to prevent.",
    ).not.toBeNull();
    expect(
      stampedZone,
      "an overlay opened while an operator is on the POS route must never resolve expressive, " +
        "or the glass rule paints a compositing filter over the terminal",
    ).not.toBe("expressive");

    const withOverlay = await sweep(page);
    expect(
      withOverlay,
      report("the POS route with a portalled overlay mounted", withOverlay),
    ).toEqual([]);
  });

  test("a KDS station board", async ({ as }) => {
    test.setTimeout(120_000);
    const page = await as(KITCHEN);
    await page.goto("/app/kitchen", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // The picker links to a station; take the first one rather than hard-coding a code.
    const stationLink = page.locator('a[href^="/app/kitchen/"]').first();
    if (await stationLink.isVisible().catch(() => false)) {
      await stationLink.click();
    }
    await page.waitForTimeout(3000);

    const board = page.getByTestId("kds-board");
    if (await board.isVisible().catch(() => false)) {
      await expect(board).toHaveAttribute("data-zone", "operational");
    }

    const offenders = await sweep(page);
    expect(offenders, report("the KDS board", offenders)).toEqual([]);
  });
});

test.describe("positive control — the gate is measuring something", () => {
  /**
   * A containment test that would ALSO pass if the product had no glass anywhere is not
   * measuring what it claims to. This asserts the expressive zone really does carry the effect.
   *
   * <h3>Why the LOGIN screen and not the dashboard</h3>
   *
   * It was the dashboard, and it skipped for two weeks' worth of reasons that had nothing to do
   * with glass: the seeded manager's dashboard renders "Couldn't load today's service" whenever
   * a backing service is down, and an error state has no portlets, so it has no glass, so the
   * control silently skipped while reporting green. A control that is coupled to seeded data and
   * to six services being up is a control that will spend most of its life not running.
   *
   * The login screen is expressive, carries a GlassPanel, needs NO session and NO backend data.
   * If glass is broken anywhere, it is broken here. That makes this the strongest available
   * anchor, not merely the most convenient one.
   */
  test("an expressive surface resolves a compositing filter", async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(
      page.locator('[data-zone="expressive"]').first(),
      "the (auth) layout declares the expressive zone",
    ).toBeAttached({ timeout: 20_000 });

    const glass = await sweep(page);
    expect(
      glass.length,
      "NO element in the expressive zone resolves a compositing filter. Either the glass rule " +
        "is not shipping, or its selector does not match — and in that case every containment " +
        "assertion in this file is passing because the product has no glass anywhere, not " +
        "because the zoning works.",
    ).toBeGreaterThan(0);

    // And it must be the panel weight the login card actually uses, not some incidental effect.
    const resolved = await page
      .locator(".glass-surface")
      .first()
      .evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(resolved, `the login card's glass resolved "${resolved}"`).toContain("blur");
  });

  /**
   * The dashboard check is kept, but as an OBSERVATION rather than a gate, and it records
   * whether it actually ran. A skipped control that reports green is what this phase keeps
   * finding; a control that says out loud "I did not run" is the fix.
   */
  test("the dashboard portlets carry glass when they render", async ({ as, obs }) => {
    test.setTimeout(120_000);
    tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);

    const page = await as(MANAGER);
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);

    const portlets = await page.locator("[data-portlet]").count();
    if (portlets === 0) {
      test.info().annotations.push({
        type: "NOT EXERCISED",
        description:
          "the dashboard rendered no portlets (error or empty state), so portlet glass was " +
          "not measured on this run. The login-screen control above still proves glass ships.",
      });
      return;
    }

    const withGlass = await page.locator("[data-portlet].glass-surface").count();
    expect(
      withGlass,
      `${portlets} portlet(s) rendered but ${withGlass} carry the glass surface class`,
    ).toBe(portlets);

    const resolved = await page
      .locator("[data-portlet]")
      .first()
      .evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(resolved, "a dashboard portlet must resolve the compositing filter").toContain("blur");
  });
});
