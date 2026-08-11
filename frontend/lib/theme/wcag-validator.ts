import Color from "colorjs.io";

export interface ContrastResult {
  ratio: number;
  passAA: boolean;
  passAALarge: boolean;
}

function relativeLuminance(color: Color): number {
  const srgb = color.to("srgb");
  const channels = [srgb.r ?? 0, srgb.g ?? 0, srgb.b ?? 0].map((c) => {
    const clamped = Math.max(0, Math.min(1, c));
    return clamped <= 0.04045 ? clamped / 12.92 : Math.pow((clamped + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/**
 * Computes the WCAG 2.1 contrast ratio between two colours expressed as
 * CSS-parseable strings (hex, oklch(...), hsl(...), etc.).
 * Passes through colorjs.io for accurate gamut-aware conversion.
 */
export function wcagContrastCheck(fg: string, bg: string): ContrastResult {
  const fgColor = new Color(fg);
  const bgColor = new Color(bg);

  const l1 = relativeLuminance(fgColor);
  const l2 = relativeLuminance(bgColor);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  return {
    ratio: Math.round(ratio * 100) / 100,
    passAA: ratio >= 4.5,
    passAALarge: ratio >= 3.0,
  };
}

/**
 * Folds a possibly-translucent fill onto an opaque substrate and returns the opaque colour a
 * browser would paint — the source-over compositing rule.
 *
 * <h3>Why this exists (phase 34, D-34-01 / D-34-04)</h3>
 *
 * A glass surface has no contrast ratio of its own. `oklch(1 0 195 / 0.72)` is not a colour
 * anybody sees; what a reader sees is that fill over whatever is behind it. D-34-01 requires
 * every new surface treatment to carry a measured figure, so the figure has to be measured
 * against the composite, and this is the operation that produces it. The result drops straight
 * into {@link wcagContrastCheck} — one code path for opaque and translucent alike.
 *
 * <h3>Why the arithmetic is in sRGB and not OKLCH</h3>
 *
 * Everything else in this repo's colour work is authored in OKLCH because it is perceptually
 * uniform, and that is the right space for choosing a ramp. It is the WRONG space for this: a
 * compositor blends in the space it paints in, not perceptually. Interpolating alpha in OKLCH
 * yields a colour that looks plausible and is not what renders — 50% white over black would
 * come out around 0.735 per channel instead of 0.5. `__tests__/lib/theme/composite.test.ts`
 * asserts both the correct value and the absence of the perceptual one.
 *
 * @param fill      a CSS colour, with or without an alpha channel. No alpha means opaque.
 * @param substrate a CSS colour that MUST be opaque.
 * @throws if `substrate` is translucent — a stack with no opaque floor has no defined result,
 *         and silently treating it as opaque is how a meaningless number reaches a table.
 */
export function compositeOver(fill: string, substrate: string): string {
  const top = new Color(fill).to("srgb");
  const bottom = new Color(substrate).to("srgb");

  const substrateAlpha = bottom.alpha ?? 1;
  if (substrateAlpha < 1) {
    throw new Error(
      `compositeOver: the substrate must be opaque, got alpha ${substrateAlpha} for ` +
        `"${substrate}". A stack with no opaque floor has no defined composite, and treating ` +
        `it as opaque would publish a plausible-looking number with no physical meaning.`,
    );
  }

  const alpha = top.alpha ?? 1;
  // Channels are `number | null | undefined`: colorjs.io represents a CSS Color 4 `none`
  // component as null. Compositing treats a missing component as 0, which is what a browser
  // does when it resolves `none` for an actual paint.
  const blend = (f: number | null | undefined, b: number | null | undefined) =>
    (f ?? 0) * alpha + (b ?? 0) * (1 - alpha);

  const r = blend(top.r, bottom.r);
  const g = blend(top.g, bottom.g);
  const b = blend(top.b, bottom.b);

  // Returned as a CSS-parseable sRGB string so it feeds the existing contrast function with
  // no second code path. Not clamped here — relativeLuminance already clamps, and clamping
  // twice would silently hide an out-of-gamut input rather than letting it surface.
  return `rgb(${r * 255} ${g * 255} ${b * 255})`;
}

/**
 * Contrast of a foreground against a translucent fill painted over a named substrate.
 *
 * Same return shape as {@link wcagContrastCheck}, deliberately: a caller or a test reads
 * identically whether the background it is measuring is opaque or glass.
 */
export function wcagContrastOverGlass(fg: string, fill: string, substrate: string): ContrastResult {
  return wcagContrastCheck(fg, compositeOver(fill, substrate));
}

/**
 * Convenience validator for tenant colour pairs.
 * Returns `true` when the primary/foreground pair meets WCAG AA for normal text (≥4.5:1).
 * Used by Settings → Appearance (plan 04-08) to reject failing colour combos.
 */
export function validateTenantColours(primaryHex: string, fgHex: string): boolean {
  try {
    const result = wcagContrastCheck(primaryHex, fgHex);
    return result.passAA;
  } catch {
    return false;
  }
}
