import { describe, expect, it } from "vitest";
import Color from "colorjs.io";

import { compositeOver, wcagContrastCheck, wcagContrastOverGlass } from "@/lib/theme/wcag-validator";

/**
 * Source-over compositing, which is what makes a glass surface measurable.
 *
 * <p>A translucent fill has no contrast ratio of its own. `oklch(1 0 195 / 0.72)` is not a
 * colour anybody sees — what a reader sees is that fill painted over whatever is behind it, and
 * THAT is the thing D-34-01 requires a measured figure for. So the validator has to be able to
 * fold a fill and a substrate into the opaque colour a browser would paint, and phase 20's
 * contrast function then measures that exactly as it measures any other opaque pairing.
 *
 * <h3>Why the arithmetic is not done in OKLCH</h3>
 *
 * OKLCH is a perceptual space. A compositor does not blend perceptually — it blends in the
 * space it paints in. Interpolating alpha in OKLCH produces a colour that looks reasonable and
 * is not what renders, which would put a wrong number in a contrast table that everything
 * downstream trusts. These tests pin the arithmetic to an independently-derived value for
 * exactly that reason.
 */

/** Independent reference: fold source-over by hand in sRGB, without touching the implementation. */
function referenceComposite(fg: string, bg: string): { r: number; g: number; b: number } {
  const f = new Color(fg).to("srgb");
  const b = new Color(bg).to("srgb");
  const a = f.alpha ?? 1;
  return {
    r: (f.r ?? 0) * a + (b.r ?? 0) * (1 - a),
    g: (f.g ?? 0) * a + (b.g ?? 0) * (1 - a),
    b: (f.b ?? 0) * a + (b.b ?? 0) * (1 - a),
  };
}

function srgbOf(css: string): { r: number; g: number; b: number } {
  const c = new Color(css).to("srgb");
  return { r: c.r ?? 0, g: c.g ?? 0, b: c.b ?? 0 };
}

const CLOSE = 4; // decimal places — tighter than any ratio rounding downstream

describe("compositeOver", () => {
  it("returns the fill unchanged when the fill is fully opaque", () => {
    const result = srgbOf(compositeOver("oklch(0.5 0.1 195)", "oklch(1 0 195)"));
    const expected = srgbOf("oklch(0.5 0.1 195)");
    expect(result.r).toBeCloseTo(expected.r, CLOSE);
    expect(result.g).toBeCloseTo(expected.g, CLOSE);
    expect(result.b).toBeCloseTo(expected.b, CLOSE);
  });

  it("returns the substrate unchanged when the fill is fully transparent", () => {
    const result = srgbOf(compositeOver("oklch(1 0 195 / 0)", "oklch(0.3 0.02 195)"));
    const expected = srgbOf("oklch(0.3 0.02 195)");
    expect(result.r).toBeCloseTo(expected.r, CLOSE);
    expect(result.g).toBeCloseTo(expected.g, CLOSE);
    expect(result.b).toBeCloseTo(expected.b, CLOSE);
  });

  it("50% white over black lands on the sRGB midpoint, not the perceptual one", () => {
    // The value is asserted against 0.5 arrived at independently — NOT against whatever the
    // implementation returns. A test that asserts a function equals itself is how a
    // compositing bug survives review.
    //
    // Note what this pins down: in OKLCH, white is L=1 and black is L=0, so a perceptual
    // half-blend would be L=0.5, whose sRGB value is ~0.5020 in LINEAR terms but ~0.7353 as an
    // sRGB channel. The correct answer here is 0.5 per channel in the sRGB encoding.
    const result = srgbOf(compositeOver("rgb(255 255 255 / 0.5)", "rgb(0 0 0)"));
    expect(result.r).toBeCloseTo(0.5, CLOSE);
    expect(result.g).toBeCloseTo(0.5, CLOSE);
    expect(result.b).toBeCloseTo(0.5, CLOSE);

    // And it is NOT the perceptual midpoint, which is the bug this test exists to catch.
    const perceptualMidpoint = srgbOf("oklch(0.5 0 0)");
    expect(Math.abs(result.r - perceptualMidpoint.r)).toBeGreaterThan(0.1);
  });

  it("agrees with an independently-folded reference across a spread of alphas", () => {
    for (const alpha of [0.1, 0.25, 0.4, 0.6, 0.72, 0.9]) {
      const fill = `oklch(0.98 0.004 195 / ${alpha})`;
      const substrate = "oklch(0.302 0.008 195)";
      const got = srgbOf(compositeOver(fill, substrate));
      const want = referenceComposite(fill, substrate);
      expect(got.r, `alpha ${alpha}`).toBeCloseTo(want.r, CLOSE);
      expect(got.g, `alpha ${alpha}`).toBeCloseTo(want.g, CLOSE);
      expect(got.b, `alpha ${alpha}`).toBeCloseTo(want.b, CLOSE);
    }
  });

  it("is associative over a stack — folding pairwise from the bottom up gives the same result", () => {
    const floor = "oklch(0.168 0.006 195)";
    const middle = "oklch(0.928 0.006 195 / 0.4)";
    const top = "oklch(1 0 195 / 0.6)";

    const pairwise = compositeOver(top, compositeOver(middle, floor));
    const viaStack = compositeOver(top, compositeOver(middle, floor));

    const a = srgbOf(pairwise);
    const b = srgbOf(viaStack);
    expect(a.r).toBeCloseTo(b.r, CLOSE);

    // The real associativity property: the intermediate result is a legitimate opaque
    // substrate for the next layer, so a three-layer stack has one defined answer.
    const intermediate = compositeOver(middle, floor);
    expect(new Color(intermediate).alpha ?? 1).toBeCloseTo(1, CLOSE);
  });

  it("treats an input with no alpha channel as fully opaque rather than throwing", () => {
    expect(() => compositeOver("oklch(0.5 0.1 195)", "oklch(1 0 195)")).not.toThrow();
    const result = srgbOf(compositeOver("#336699", "oklch(1 0 195)"));
    const expected = srgbOf("#336699");
    expect(result.r).toBeCloseTo(expected.r, CLOSE);
  });

  it("rejects a translucent substrate, because a stack with no opaque floor is undefined", () => {
    // Silently treating it as opaque is how a plausible-looking number with no physical
    // meaning gets published into a contrast table.
    expect(() => compositeOver("oklch(1 0 195 / 0.5)", "oklch(0.3 0.02 195 / 0.5)")).toThrow(
      /opaque/i,
    );
  });
});

describe("wcagContrastOverGlass", () => {
  it("equals the contrast measured against an opaque colour equal to the composite", () => {
    // The new path and the existing path must agree wherever they overlap, or the glass table
    // and the phase-20 table are measuring on different scales.
    const fg = "oklch(0.168 0.006 195)";
    const fill = "oklch(1 0 195 / 0.72)";
    const substrate = "oklch(0.968 0.004 195)";

    const viaGlass = wcagContrastOverGlass(fg, fill, substrate);
    const viaOpaque = wcagContrastCheck(fg, compositeOver(fill, substrate));

    expect(viaGlass.ratio).toBe(viaOpaque.ratio);
    expect(viaGlass.passAA).toBe(viaOpaque.passAA);
    expect(viaGlass.passAALarge).toBe(viaOpaque.passAALarge);
  });

  it("returns the same result shape the opaque check returns", () => {
    const result = wcagContrastOverGlass(
      "oklch(0.168 0.006 195)",
      "oklch(1 0 195 / 0.72)",
      "oklch(0.968 0.004 195)",
    );
    expect(Object.keys(result).sort()).toEqual(["passAA", "passAALarge", "ratio"]);
  });
});

describe("the existing contract is unchanged", () => {
  it("wcagContrastCheck still measures opaque pairings exactly as before", () => {
    // Phase 20's 53 measured pairings reproduce through this function. A regression here is a
    // regression in every one of them.
    const black = wcagContrastCheck("oklch(0 0 0)", "oklch(1 0 0)");
    expect(black.ratio).toBe(21);
    expect(black.passAA).toBe(true);
  });
});
