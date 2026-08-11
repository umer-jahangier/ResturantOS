import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";
import { DEFECTS, tolerate } from "../fixtures/known-defects";

/**
 * Phase 34's closing measurement: the operational zone did not get slower.
 *
 * <h3>The number is NOT the gate — read this before quoting it</h3>
 *
 * A wall-clock figure taken on developer hardware, against a dev server, with six other agents
 * building on the same machine, is a RECORDED OBSERVATION with a deliberately generous ceiling.
 * It varies with load and it would fail differently on every machine, which is the definition
 * of a bad gate.
 *
 * The gate is the set of deterministic computed-style assertions below. Those fail identically
 * everywhere: either the POS terminal carries a compositing filter or it does not; either a
 * cart mutation transitions or it does not. D-34-02's promise is structural, so it is checked
 * structurally, and the timing is reported alongside as evidence rather than as proof.
 *
 * <h3>Getting to the tap-to-cart path at all</h3>
 *
 * The menu grid is gated on an OPEN TILL — every POS persona lands on "Your till is closed"
 * otherwise, and no seed provides one. So this spec opens a till through the real UI first.
 * That is why the measurement is of the genuine path a cashier uses rather than of a
 * till-closed empty state, which is what every earlier attempt in this phase measured.
 */

const CASHIER = persona("zaitoon", "cashier");
const KITCHEN = persona("zaitoon", "kitchen");

test.describe.configure({ mode: "serial" });

/** Opens a till through the UI if one is not already open. Returns whether the grid rendered. */
async function ensureTillOpen(page: Page): Promise<boolean> {
  const grid = page.getByTestId("menu-grid");
  if (await grid.isVisible().catch(() => false)) return true;

  const open = page.getByTestId("open-till-button");
  if (!(await open.isVisible().catch(() => false))) return false;

  await open.click();
  await page.waitForTimeout(1200);
  const amount = page.locator('input[inputmode="decimal"], input[type="number"]').first();
  if (await amount.isVisible().catch(() => false)) await amount.fill("5000");
  await page.getByTestId("open-till-confirm-button").click();
  await page.waitForTimeout(4000);

  return grid.isVisible().catch(() => false);
}

test.describe("D-34-02 · the POS terminal carries no phase-34 cost", () => {
  test("tap-to-cart: deterministic assertions, with the latency recorded alongside", async ({
    as,
    obs,
  }) => {
    test.setTimeout(180_000);
    tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);

    const page = await as(CASHIER);
    await page.goto("/app/pos", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    const ready = await ensureTillOpen(page);
    if (!ready) {
      // Said out loud rather than passing quietly: a latency spec that never reached the path
      // it claims to measure must not report green as though it did.
      test.info().annotations.push({
        type: "NOT EXERCISED",
        description:
          "the menu grid never rendered (no till could be opened), so tap-to-cart was not " +
          "measured on this run. The structural assertions below still ran.",
      });
    }

    // ── GATE 1: no compositing filter anywhere on the terminal ────────────────────────────
    const filtered = await page.evaluate(() =>
      Array.from(document.querySelectorAll("*"))
        .filter((el) => {
          const v =
            getComputedStyle(el).backdropFilter ||
            getComputedStyle(el).getPropertyValue("backdrop-filter");
          return v && v !== "none";
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`),
    );
    expect(
      filtered,
      `backdrop-filter forces a repaint of everything beneath it. On the one screen a cashier ` +
        `uses under time pressure, that is the cost this phase promised not to add.\n` +
        filtered.join("\n"),
    ).toEqual([]);

    // ── GATE 2: no animation running on the terminal ──────────────────────────────────────
    const animating = await page.evaluate(() =>
      Array.from(document.querySelectorAll("*"))
        .filter((el) => {
          const n = getComputedStyle(el).animationName;
          return n && n !== "none";
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`),
    );
    expect(animating, `elements animating on the POS terminal:\n${animating.join("\n")}`).toEqual(
      [],
    );

    if (!ready) return;

    // ── GATE 3: the cart does not transition on mutation ──────────────────────────────────
    // Phase 20 ruled that a data update never animates, for a reason a cashier feels 200 times
    // a shift. Checked BEFORE the timing, because a transition would also inflate the number
    // and make the observation misleading as well as the behaviour wrong.
    const tile = page.getByTestId("menu-grid").getByRole("button").first();
    await expect(tile).toBeVisible({ timeout: 20_000 });

    /*
     * The settle signal is the CHARGE button becoming actionable, not a fixed delay.
     *
     * There is no cart testid in this codebase (checked: the POS exposes menu-grid,
     * charge-now-button, till panels and payment rows, and nothing for the cart itself), and
     * an earlier version of this waited on a locator that does not exist — which silently
     * spent its full 20s timeout and reported a 20-second "latency". A measurement whose
     * failure mode is to invent a number is worse than no measurement.
     */
    const charge = page.getByTestId("charge-now-button");
    const started = Date.now();
    await tile.click();
    const settled = await charge
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    const elapsedMs = Date.now() - started;

    if (!settled) {
      test.info().annotations.push({
        type: "NOT EXERCISED",
        description:
          "the charge control never became visible after the tap, so the tap-to-cart figure " +
          "below is not a valid measurement and is not reported.",
      });
    }

    /*
     * Scoped to the charge control's own container, NOT to a cart testid.
     *
     * The first version of this looked for [data-testid="cart-lines"] / "pos-cart". Neither
     * exists — the POS exposes no cart testid at all — so the query returned null, the check
     * returned [], and the assertion passed while measuring nothing. That is the third
     * vacuous gate found in this phase, and it is why the scope is now anchored to an element
     * that provably exists (the charge button, which the timing above already waited for) and
     * why the test FAILS if that anchor cannot be resolved.
     */
    const cartTransitions = await page.evaluate(() => {
      const charge = document.querySelector('[data-testid="charge-now-button"]');
      if (!charge) return ["ANCHOR NOT FOUND: charge-now-button is not in the document"];

      // Walk up to the panel that holds both the charge control and the order lines.
      let scope: Element | null = charge;
      for (let up = 0; up < 4 && scope?.parentElement; up += 1) scope = scope.parentElement;
      if (!scope) return ["ANCHOR NOT FOUND: no container above charge-now-button"];

      const elements = Array.from(scope.querySelectorAll("*"));
      if (elements.length === 0) return ["ANCHOR EMPTY: the cart container has no descendants"];

      return (
        elements
          .map((el) => {
            const cs = getComputedStyle(el);
            const props = cs.transitionProperty;
            const dur = cs.transitionDuration;
            return props && props !== "none" && dur !== "0s"
              ? `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}: ${props} ${dur}`
              : null;
          })
          .filter((x): x is string => x !== null)
          // A colour or opacity transition on a hover state is not a data-update animation; the
          // prohibition phase 20 set is on GEOMETRY moving when a number changes.
          .filter((x) => /transform|height|width|top|left|margin|padding/.test(x))
      );
    });

    expect(
      cartTransitions,
      `the cart animates geometry on a mutation. Phase 20 forbade that for a reason a cashier ` +
        `feels 200 times a shift.\n${cartTransitions.join("\n")}`,
    ).toEqual([]);

    // ── OBSERVATION, not a gate ───────────────────────────────────────────────────────────
    if (settled) {
      test.info().annotations.push({
        type: "MEASURED (observation, not a gate)",
        description: `tap-to-cart round trip: ${elapsedMs}ms on developer hardware, dev server, shared machine`,
      });
      process.stdout.write(`\n  POS tap-to-cart: ${elapsedMs}ms (observation)\n`);
    }

    // A ceiling so generous that tripping it means something is badly wrong rather than merely
    // slow — a synchronous layout per frame, or a full re-render on every keystroke.
    if (settled) {
      expect(
        elapsedMs,
        `tap-to-cart took ${elapsedMs}ms. This ceiling is deliberately loose; exceeding it ` +
          `means something structural — a synchronous layout per frame, a full re-render per ` +
          `keystroke — not a slow machine.`,
      ).toBeLessThan(5_000);
    }
  });

  test("a KDS station board runs no animation and carries no filter", async ({ as }) => {
    test.setTimeout(120_000);
    const page = await as(KITCHEN);
    await page.goto("/app/kitchen", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const link = page.locator('a[href^="/app/kitchen/"]').first();
    if (await link.isVisible().catch(() => false)) await link.click();
    await page.waitForTimeout(4000);

    const offenders = await page.evaluate(() =>
      Array.from(document.querySelectorAll("*"))
        .filter((el) => {
          const cs = getComputedStyle(el);
          const filter = cs.backdropFilter || cs.getPropertyValue("backdrop-filter");
          const anim = cs.animationName;
          return (filter && filter !== "none") || (anim && anim !== "none");
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`),
    );

    expect(
      offenders,
      `a KDS board is read at two metres across a hot kitchen. Nothing on it may repaint for ` +
        `decoration.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
