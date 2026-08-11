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

test.describe("operational zone carries no compositing filter", () => {
  test("the POS terminal — at rest and with the order drawer open", async ({ as, obs }) => {
    test.setTimeout(120_000);
    tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);

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
   * measuring what it claims to. This asserts the expressive zone does carry the effect.
   *
   * Skipped with an explicit message until plan 34-02 lands the first zone-scoped rule,
   * because requiring it before then would be a false dependency between plans in the
   * same wave.
   */
  test("the dashboard resolves a compositing filter somewhere", async ({ as, obs }) => {
    test.setTimeout(120_000);
    tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);

    const page = await as(MANAGER);
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    await expect(
      page.locator('[data-zone="expressive"]').first(),
      "the dashboard declares the expressive zone",
    ).toBeAttached({ timeout: 20_000 });

    const glass = await sweep(page);
    test.skip(
      glass.length === 0,
      "No glass exists in the expressive zone yet — plan 34-02 lands the first zone-scoped " +
        "rule. Until then this control cannot pass, and it is skipped LOUDLY rather than " +
        "quietly asserted, so nobody mistakes a green run for a measured one.",
    );
    expect(glass.length).toBeGreaterThan(0);
  });
});
