import { beforeAll, describe, expect, it } from "vitest";

import { buildCss, builtVar, utilityBody } from "./built-css";

/**
 * The gate for the worst defect 38-01 shipped, and the reason it exists (UI-SPEC §2, §7).
 *
 * <h3>What happened</h3>
 *
 * 38-01 bridged the seven usage steps into Tailwind's `--spacing-*` namespace so that `p-md`
 * and `gap-lg` would exist. In Tailwind v4 that namespace is **also** the one `max-w-*`, `w-*`
 * and `min-w-*` consult for a NAMED key, in preference to `--container-*`. Publishing
 * `--spacing-lg: 24px` therefore redefined `max-w-lg` from `32rem` (512px) to **24px**.
 *
 * `components/ui/dialog.tsx` sizes its panel `md:max-w-sm` (`sm:` until 38-14 renamed every
 * dialog width variant onto the declared breakpoint set), and 53 call sites across the
 * product override it with `max-w-md` / `max-w-lg` / `max-w-2xl`. Every dialog in the product
 * — including screens no design plan had touched — collapsed to a sliver.
 *
 * <h3>Why no existing gate caught it</h3>
 *
 * `tsc` was clean. ESLint was clean. All 1,127 unit tests passed. The 38-01 type-scale gate
 * passed, because the type bridge really was fine. jsdom does not apply Tailwind's stylesheet,
 * so a `render()`-and-`getComputedStyle` test would have measured `max-width: ""` and passed
 * too. **A human looked at a screen and saw a 24px column.**
 *
 * The instrument that can see it is the compiled stylesheet, so that is what this reads. It
 * resolves each width utility through the emitted custom properties to a final pixel value and
 * asserts the result is a dialog-sized number rather than a spacing-sized one.
 *
 * <h3>Negative control — run, OBSERVED RED, restored</h3>
 *
 * Re-added `--spacing-sm: var(--space-sm)` … `--spacing-3xl: var(--space-3xl)` to the
 * `@theme inline` block, i.e. the exact state that shipped the bug.
 * → OBSERVED RED, 6 failures, the first reading:
 *   `max-w-sm resolves to 8px — a width utility resolved from the spacing namespace:
 *    expected 8 to be greater than or equal to 300`.
 * Restored, green.
 *
 * A second control confirmed the gate is not merely asserting a constant: changing
 * `--container-sm` to `2rem` also failed it, proving it tracks the real emitted value.
 */

/** Every named width the product actually uses, with the floor each must clear. */
const WIDTH_UTILITIES: Array<{ utility: string; minPx: number }> = [
  { utility: "max-w-sm", minPx: 300 }, // 24rem = 384
  { utility: "max-w-md", minPx: 380 }, // 28rem = 448
  { utility: "max-w-lg", minPx: 440 }, // 32rem = 512
  { utility: "max-w-xl", minPx: 500 }, // 36rem = 576
  { utility: "max-w-2xl", minPx: 600 }, // 42rem = 672
  { utility: "max-w-3xl", minPx: 700 }, // 48rem = 768
];

let css = "";

beforeAll(async () => {
  css = await buildCss(WIDTH_UTILITIES.map((w) => w.utility));
}, 30_000);

/** Follows `var(--x)` through the built stylesheet's own declarations, then converts to px. */
function resolvePx(value: string): number | null {
  let current = value.trim();
  for (let depth = 0; depth < 8 && current.includes("var("); depth += 1) {
    current = current.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name: string) => {
      const resolved = builtVar(css, name);
      if (resolved === null) throw new Error(`built stylesheet never defines ${name}`);
      return resolved;
    });
  }
  const rem = /^([\d.]+)rem$/.exec(current);
  if (rem) return parseFloat(rem[1]!) * 16;
  const px = /^([\d.]+)px$/.exec(current);
  if (px) return parseFloat(px[1]!);
  return null;
}

describe("width utilities resolve from the container scale, never the spacing scale", () => {
  it.each(WIDTH_UTILITIES)(
    "$utility is at least $minPx px — a dialog width, not a padding step",
    ({ utility, minPx }) => {
      const body = utilityBody(css, utility);
      expect(body, `${utility} was not generated at all`).not.toBeNull();

      const declared = /max-width:\s*([^;]+)/.exec(body!)?.[1];
      expect(declared, `${utility} does not declare max-width`).toBeDefined();

      // The tell: the utility must dereference the CONTAINER scale. If this names
      // `--space-*` or `--spacing-*`, the namespace collision is back.
      expect(
        declared,
        `${utility} resolves from the spacing namespace, not the container scale`,
      ).not.toMatch(/--space/);

      const px = resolvePx(declared!);
      expect(px, `${utility} did not resolve to a length: ${declared}`).not.toBeNull();
      expect(
        px!,
        `${utility} resolves to ${px}px — a width utility resolved from the spacing namespace`,
      ).toBeGreaterThanOrEqual(minPx);
    },
  );

  it("the seven usage steps are absent from the --spacing-* namespace", () => {
    // The direct statement of the rule, so the failure names the cause rather than a symptom.
    for (const step of ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"]) {
      expect(
        builtVar(css, `--spacing-${step}`),
        `--spacing-${step} is defined. Named keys in --spacing-* silently redefine ` +
          `max-w-${step} / w-${step} / min-w-${step}. Use p-(--space-${step}) at call sites instead.`,
      ).toBeNull();
    }
  });

  it("the usage steps are still reachable as custom properties", () => {
    // Removing them from --spacing-* must not mean losing them. UI-SPEC §2 requires the
    // scale be canonical and quotable; the call-site form is `p-(--space-lg)`.
    const expected: Record<string, string> = {
      xs: "4px",
      sm: "8px",
      md: "16px",
      lg: "24px",
      xl: "32px",
      "2xl": "48px",
      "3xl": "64px",
    };
    for (const [step, value] of Object.entries(expected)) {
      expect(builtVar(css, `--space-${step}`), `--space-${step}`).toBe(value);
    }
  });
});
