import Color from "colorjs.io";
import { describe, expect, it } from "vitest";

import {
  BRAND_HUE_MIN_DELTA_E,
  checkBrandHue,
  type BrandHueVerdict,
} from "@/lib/theme/brand-hue-guard";

/**
 * The brand-hue guard (38-10 task 4), and the record of why it is not the rule the plan wrote.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored</h3>
 *
 * A guard nobody has watched fail is a guard nobody can trust, so each of these was broken on
 * purpose and the failure read before the assertion was kept:
 *
 * <ol>
 * <li>Comparing in raw OKLCH instead of gamut-mapped sRGB → the "measures the DARK stop as well"
 *    test went RED with *"expected 'series 1 in light mode' to contain 'dark'"*. That failure is
 *    the reason `inGamut` exists: the guard had been judging a colour the display never paints.</li>
 * <li>`nudge` verifying its candidate through `checkBrandHue` rather than `readHex` → RED with
 *    *"RangeError: Maximum call stack size exceeded"* inside `toGamut`, six frames from the
 *    mistake. Fixed to call the shared reader.</li>
 * <li>`accentStops` returning only the 500 stop → RED with *"expected 'series 2 in light mode'
 *    to contain 'dark'"*. Restored.</li>
 * </ol>
 *
 * <h3>The three hues the plan named are asserted, and two of them PASS</h3>
 *
 * Task 4 asks for the guard to be "asserted at 240, 262 and 290". They are asserted — and 240 and
 * 262 come back clean, which is the finding, not a gap. See `brand-hue-guard.ts` for the full
 * derivation: `--chart-1` stopped following the brand hue at D-38-12, so the walk the rule
 * describes cannot occur.
 */

/** Hold the default preset's L and C so only hue varies — the axis the guard governs. */
const BASE = new Color("#3b82f6").to("oklch");

function hexAtHue(hue: number): string {
  return new Color("oklch", [BASE.l, BASE.c, hue]).to("srgb").toString({ format: "hex" });
}

function refusalAt(hue: number): Extract<BrandHueVerdict, { ok: false }> {
  const verdict = checkBrandHue(hexAtHue(hue));
  if (verdict.ok) throw new Error(`expected hue ${hue} to be refused, got ΔE ${verdict.deltaE}`);
  return verdict;
}

describe("the brand-hue guard refuses the bands that are actually dangerous", () => {
  it("refuses teal — the worst hue on the circle, and the one the plan's rule misses", () => {
    const verdict = refusalAt(185);
    // 1.70 measured — under the just-noticeable difference. Asserted as a band rather than to two
    // decimals so a colorjs point release cannot fail this suite over the fourth significant
    // figure.
    expect(verdict.deltaE).toBeLessThan(3);
    expect(verdict.nearestSeries).toBe("series 1 in light mode");
    // Colour is not the only channel, and neither is a number: the refusal must SAY the series.
    expect(verdict.reason).toContain("series 1 in light mode");
  });

  it("refuses the amber and violet bands too", () => {
    expect(refusalAt(38).nearestSeries).toContain("series 2");
    expect(refusalAt(300).nearestSeries).toContain("series 4");
  });

  it("accepts the whole circle outside the three measured bands", () => {
    // 31–49, 168–198, 289–309 are the refused bands. Everything else must pass, or the guard is
    // not a guard, it is a mood: a threshold that quietly refuses a third of the circle would be
    // switched off the first time a tenant wanted their own colour.
    const refused: number[] = [];
    for (let hue = 0; hue < 360; hue += 1) {
      if (!checkBrandHue(hexAtHue(hue)).ok) refused.push(hue);
    }
    // 71 of 360 measured. Fenced at 80 so a colorjs point release cannot fail the suite, and so
    // that a future widening of the threshold has to be a deliberate edit here.
    expect(refused.length).toBeLessThan(80);
    expect(refused).not.toContain(0);
    expect(refused).not.toContain(120);
    expect(refused).not.toContain(240);
  });

  it("offers a nudge that itself clears the threshold", () => {
    const verdict = refusalAt(185);
    expect(verdict.suggestedHex).not.toBeNull();
    const nudged = checkBrandHue(verdict.suggestedHex!);
    expect(nudged.ok).toBe(true);
    expect(nudged.deltaE).toBeGreaterThanOrEqual(BRAND_HUE_MIN_DELTA_E);
  });

  it("measures the DARK stop as well as the light one", () => {
    // At 185 the nearest neighbour is the LIGHT 500 stop; at 38 it is the DARK 400 stop. A guard
    // that dropped either stop would silently admit one of these two hues, and the pair is chosen
    // so that neither can be satisfied by measuring only one theme.
    expect(refusalAt(185).nearestSeries).toContain("light");
    expect(refusalAt(38).nearestSeries).toContain("dark");
  });
});

describe("the three hues 38-10 task 4 named — two of them are clean, and that is the finding", () => {
  it.each([
    [240, true],
    [262, true],
    [290, false],
  ])("hue %i → ok=%s", (hue, expectedOk) => {
    expect(checkBrandHue(hexAtHue(hue)).ok).toBe(expectedOk);
  });

  it("262 is not a collision: chart-1 was retargeted off the brand hue by D-38-12", () => {
    const verdict = checkBrandHue(hexAtHue(262));
    expect(verdict.ok).toBe(true);
    // 11.82 measured — comfortably clear, and nearly seven times the separation at 185.
    expect(verdict.deltaE).toBeGreaterThan(10);
  });
});

describe("the guard does not refuse the colours this product itself offers", () => {
  // `PRESET_COLOURS` in `components/settings/appearance-form.tsx`, verbatim. A guard that fires
  // on the recommended choices is a guard that gets deleted.
  const PRESETS = [
    ["Ocean Blue", "#3b82f6"],
    ["Emerald", "#10b981"],
    ["Amber", "#f59e0b"],
    ["Coral Red", "#ef4444"],
    ["Violet", "#8b5cf6"],
    ["Pink", "#ec4899"],
    ["Cyan", "#06b6d4"],
    ["Lime", "#84cc16"],
  ] as const;

  it.each(PRESETS)("%s (%s) is accepted", (_label, hex) => {
    expect(checkBrandHue(hex).ok).toBe(true);
  });

  it("the default colour would have been REFUSED by the rule as written in the plan", () => {
    // #3b82f6 is OKLCH hue 259.81 — 2.19° from 262, i.e. inside the plan's "~35° of 262" band.
    // This assertion exists so the divergence is a recorded measurement rather than an opinion:
    // anyone restoring the literal rule breaks the product's own default.
    const hue = new Color("#3b82f6").to("oklch").h ?? 0;
    expect(Math.abs(hue - 262)).toBeLessThan(35);
    expect(checkBrandHue("#3b82f6").ok).toBe(true);
  });
});

describe("malformed input is the hex field's problem, not the guard's", () => {
  it.each(["", "#abc", "not-a-colour", "3b82f6"])("%s passes through as ok", (input) => {
    expect(checkBrandHue(input).ok).toBe(true);
  });
});
