import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";
import { DEFECTS, tolerate } from "../fixtures/known-defects";

/**
 * The runtime half of the D-34-03 gate, run in BOTH directions against the same route.
 *
 * <h3>Why both directions</h3>
 *
 * A motion system that shipped as dead CSS — a class nobody applies, a keyframe that never
 * runs — passes every stillness assertion ever written. So "the page is still under reduced
 * motion" is only half a gate. The other half asserts that WITHOUT the preference the page is
 * demonstrably not still. Present and escapable, both measured.
 *
 * <h3>Why the reduced pass checks visibility, not just stillness</h3>
 *
 * A blank screen is perfectly still. The defect this phase is most likely to produce is an
 * element whose resting style is hidden and which relies on a keyframe to reveal it — under
 * reduced motion, where the animation is removed outright, such an element never appears. So
 * the reduced pass asserts the animated elements are at full opacity with no residual
 * transform, which is the assertion that actually fails when someone authors it backwards.
 *
 * <h3>Why the CSS contract is asserted on /login and not on a dashboard</h3>
 *
 * These four assertions are about the STYLESHEET, not about data. Running them behind a
 * session made them depend on six services being up and on seeded rows existing — and when a
 * backing service 503s, the dashboard correctly renders phase 14b's error state, which has no
 * animated elements, so the assertions measured nothing while the run reported a failure that
 * had nothing to do with motion. `/login` is expressive, carries a GlassPanel and an entrance,
 * and needs no session and no backend. Fewer moving parts, and the contract is the same one.
 *
 * The POS and KDS checks below DO need their real routes, and keep them.
 */

/*
 * Emulation is applied PER PAGE with `page.emulateMedia`, not via `test.use({ reducedMotion })`.
 *
 * Two reasons, and the first one cost a red run to find: this suite's `as()` fixture builds its
 * own browser context from a persona's stored session, so a project-level option does not reach
 * the page it hands back. And `test.use({ reducedMotion })` is not even typed on the extended
 * fixture, so it type-errors while silently doing nothing at runtime — the reduced-motion pass
 * ran with NO preference set and still reported "reduce" in its name. A gate that lies about
 * which condition it measured is worse than no gate.
 */

/*
 * Serial. These tests each load a route and screenshot it twice; run in parallel across six
 * workers alongside the containment spec they saturate the same services and draw 503s, which
 * the observability guard then reports as a defect. The suite generating its own load and
 * failing on it is not a finding.
 */
test.describe.configure({ mode: "serial" });

const MANAGER = persona("terrace", "manager");
const WAITER = persona("terrace", "waiter");
const KITCHEN = persona("terrace", "kitchen");

/** Count differing bytes between two PNG buffers of the same viewport. */
function differs(a: Buffer, b: Buffer): boolean {
  return a.length !== b.length || !a.equals(b);
}

/**
 * Resolved style of every element carrying an entrance/reveal class, plus a probe element we
 * inject into the expressive zone so the assertion holds even before any screen has adopted
 * the classes (34-04 onward do that).
 */
async function motionState(page: Page) {
  return page.evaluate(() => {
    const zone = document.querySelector('[data-zone="expressive"]') ?? document.body;
    const probe = document.createElement("div");
    probe.className = "vdl-enter";
    probe.setAttribute("data-motion-probe", "");
    zone.appendChild(probe);

    const read = (el: Element) => {
      const cs = getComputedStyle(el);
      return {
        cls: el.className.toString().slice(0, 60),
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
        opacity: cs.opacity,
        transform: cs.transform,
        visibility: cs.visibility,
      };
    };

    const real = Array.from(
      document.querySelectorAll(".vdl-enter, .vdl-enter-scale, .vdl-reveal, .vdl-stagger > *"),
    )
      .filter((el) => !el.hasAttribute("data-motion-probe"))
      .map(read);

    const probeState = read(probe);
    probe.remove();
    return { real, probe: probeState };
  });
}

test.describe("D-34-03 · with a reduced-motion preference", () => {
  test("an expressive surface is visually identical half a second apart", async ({ page }) => {
    test.setTimeout(60_000);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    /*
     * Blur first, and this is not a convenience.
     *
     * The login form autofocuses the email field, and a focused text input paints a BLINKING
     * CARET — which changes pixels twice a second forever. Measured: with focus the two frames
     * differ every time; after blurring they are byte-identical.
     *
     * A caret is a browser text cursor, not decorative motion, and `prefers-reduced-motion`
     * deliberately does not suppress it — a user who cannot see where they are typing is worse
     * off. Leaving it in frame would have made this assertion fail forever for a reason that
     * has nothing to do with the motion system, and the tempting "fix" would have been to
     * loosen the comparison to a pixel-difference threshold — which would then also swallow a
     * real 10px entrance animation. Removing the caret keeps the comparison EXACT.
     */
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.waitForTimeout(300);

    const first = await page.screenshot();
    await page.waitForTimeout(600);
    const second = await page.screenshot();

    expect(
      differs(first, second),
      "the page changed between two frames 600ms apart under a reduced-motion preference. " +
        "D-34-03 asks for decorative motion to be ABSENT, not fast.",
    ).toBe(false);
  });

  test("animated elements are VISIBLE and still — not merely still", async ({ page }) => {
    test.setTimeout(60_000);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const { real, probe } = await motionState(page);

    // The probe proves the CSS contract holds even on a route that has not yet adopted the
    // classes, so this gate is meaningful from the moment it is written.
    expect(
      probe.animationName,
      "the entrance animation must be REMOVED under reduced motion, not shortened",
    ).toBe("none");
    expect(
      probe.opacity,
      "the entrance class resolves opacity 0 with its animation removed — this is the " +
        "invisible-screen defect: the element's resting style must already be its finished style",
    ).toBe("1");
    expect(probe.transform, "no residual transform may remain").toBe("none");
    expect(probe.visibility).toBe("visible");

    for (const el of real) {
      expect(el.animationName, `${el.cls}: animation must be absent`).toBe("none");
      expect(el.opacity, `${el.cls}: must be visible with the animation removed`).not.toBe("0");
      expect(el.visibility, `${el.cls}: must be visible`).not.toBe("hidden");
    }
  });

  test("hovering a lift target applies no transform", async ({ page }) => {
    test.setTimeout(60_000);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const transform = await page.evaluate(() => {
      const zone = document.querySelector('[data-zone="expressive"]') ?? document.body;
      const probe = document.createElement("div");
      probe.className = "vdl-lift";
      zone.appendChild(probe);
      // :hover cannot be forced from script, so read the rule the cascade would apply.
      const matched = Array.from(document.styleSheets)
        .flatMap((sheet) => {
          try {
            return Array.from(sheet.cssRules);
          } catch {
            return [];
          }
        })
        .filter((rule) => rule.cssText.includes(".vdl-lift") && rule.cssText.includes(":hover"))
        .map((rule) => rule.cssText);
      probe.remove();
      return matched;
    });

    const liftRules = transform.join(" ");
    expect(
      /transform:\s*none/.test(liftRules) || liftRules === "",
      "under reduced motion the hover lift must not translate. The shadow may stay — it " +
        `conveys the same affordance without moving anything.\n${liftRules}`,
    ).toBe(true);
  });

  test("the POS terminal is still (it is still under BOTH preferences)", async ({ as, obs }) => {
    test.setTimeout(120_000);
    tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);
    // A WAITER does not hold till permissions, so the POS page's active-till lookup is
    // correctly refused. Declared rather than tolerated globally: the refusal IS the right
    // behaviour here, and the guard should keep failing on any 403 this spec did not predict.
    obs.expect403(
      /\/api\/v1\/pos\/tills/,
      "a waiter has no till permissions; the POS page probes for an active till regardless " +
        "and renders the till-closed state from the refusal",
    );

    const page = await as(WAITER);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/app/pos", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    const first = await page.screenshot();
    await page.waitForTimeout(600);
    const second = await page.screenshot();
    expect(differs(first, second), "the POS terminal animated under reduced motion").toBe(false);
  });
});

test.describe("D-34-03 · WITHOUT a reduced-motion preference — the system must actually do something", () => {
  test("the entrance animation is live on an expressive surface", async ({ page }) => {
    /*
     * The direction that catches a motion system shipped as dead CSS. Every stillness
     * assertion in this file would also pass if `.vdl-enter` resolved to nothing at all.
     *
     * Asserted on the computed style rather than on a screenshot diff: the dashboard has not
     * adopted the entrance classes yet (34-06 does that), and a pixel diff would then measure
     * data settling rather than motion. Once 34-06 lands, the two-frame diff below also
     * becomes meaningful and is recorded as an observation.
     */
    test.setTimeout(60_000);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const { probe } = await motionState(page);

    expect(
      probe.animationName,
      "without a reduced-motion preference the entrance animation must RUN. If this is 'none' " +
        "the whole motion vocabulary is dead CSS and every stillness assertion above is vacuous.",
    ).toBe("vdlEnter");
    expect(
      probe.animationDuration,
      "and it must run at the expressive entrance duration (--motion-entrance: 420ms)",
    ).toBe("0.42s");

    // Recorded as an observation rather than gated: whether two frames differ depends on
    // which surfaces have adopted the classes, and that changes plan by plan.
    const first = await page.screenshot();
    await page.waitForTimeout(600);
    const second = await page.screenshot();
    test.info().annotations.push({
      type: "observation",
      description: `two frames 600ms apart ${differs(first, second) ? "DIFFER" : "are identical"} on /app/dashboard`,
    });
  });

  test("a KDS station board still does not animate, even without the preference", async ({
    as,
  }) => {
    // The operational zone carries no motion in EITHER preference state. Asserting it here is
    // cheaper than discovering it on a wall screen in a kitchen.
    test.setTimeout(120_000);
    const page = await as(KITCHEN);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/app/kitchen", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    /*
     * The station tiles are BUTTONS driving `router.push`, not anchors.
     *
     * All three of this phase's KDS assertions navigated with
     * `page.locator('a[href^="/app/kitchen/"]').first()`, guarded by
     * `.isVisible().catch(() => false)` — so the locator matched nothing, no click happened,
     * and every "KDS board" assertion in this phase ran against the STATION PICKER instead.
     * Found 2026-08-12 by adding the board anchor below and watching all three go red on a
     * healthy kitchen-service. The picker carries no filter and no animation either, which is
     * why nobody noticed for the life of the phase.
     */
    const stationTile = page.locator('[data-testid^="station-tile-"]').first();
    await expect(
      stationTile,
      "ANCHOR NOT FOUND: no station tile on /app/kitchen, so there is no board to open",
    ).toBeVisible({ timeout: 20_000 });
    await stationTile.click();
    await page.waitForTimeout(4000);

    // The anchor. This whole test is the "without the preference" half of a both-directions
    // gate — its point is that the system is not merely dead CSS — and a board that never
    // rendered is dead in exactly the way the test exists to rule out.
    await expect(
      page.getByTestId("kds-board"),
      "ANCHOR NOT FOUND: no [data-testid=kds-board] on screen. An assertion that nothing " +
        "animates is satisfied by a screen with nothing on it.",
    ).toBeAttached({ timeout: 20_000 });

    const animated = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("*"))
          .filter((el) => {
            const name = getComputedStyle(el).animationName;
            return name && name !== "none";
          })
          .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 50)}`)
          .slice(0, 20),
      // A live board legitimately has none. Any entry here is decorative motion on a screen
      // read at two metres across a hot kitchen.
    );

    expect(
      animated,
      `elements on the KDS board resolve a running animation:\n${animated.join("\n")}`,
    ).toEqual([]);
  });
});
