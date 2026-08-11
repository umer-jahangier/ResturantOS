/**
 * The glass surface manifest — the thing that makes D-34-01 and D-34-04 checkable rather
 * than aspirational.
 *
 * <h3>Why a manifest exists at all</h3>
 *
 * D-34-01 requires every new surface treatment to carry its own measured contrast figure. A
 * translucent surface does not have one: what a reader sees is the fill composited over
 * whatever is behind it, so the ratio depends on the substrate. Contrast over an ARBITRARY
 * background is not merely hard to measure — it is undefined, and an undefined figure cannot
 * satisfy D-34-01.
 *
 * So each surface declares the exhaustive set of substrates it is permitted to sit over, and
 * `__tests__/lib/theme/glass-contrast.test.ts` measures the composite against every one of
 * them and takes the worst case. An enumerable substrate set is measurable; that is the whole
 * argument.
 *
 * <h3>What this forecloses</h3>
 *
 * Glass over a photograph, a user-supplied image, or a gradient mesh. Those have no bounded
 * substrate, so no row of the contrast table could cover them. The prohibition is enforced by
 * the fact that there is nowhere to declare them here — not by a code-review note.
 *
 * <p>Deliberately free of imports from the component layers, so both the test and any
 * documentation can read it without dragging React in.
 */

/** A CSS custom property name, as authored in `app/globals.css`. */
export type TokenName = `--${string}`;

export interface GlassSurface {
  /** Stable id, also the class name suffix used in globals.css. */
  id: "panel" | "overlay";
  /** The class that consumes these tokens. */
  className: string;
  /**
   * The OPAQUE colour that ships when `backdrop-filter` is unavailable or disabled. This is
   * the BASE declaration in the stylesheet, not a fallback branch — see the D-34-04 note in
   * globals.css for why that ordering is load-bearing.
   */
  fallbackToken: TokenName;
  /** The translucent fill, applied only inside a positive feature query, only when expressive. */
  fillToken: TokenName;
  /** Blur radius token. */
  blurToken: TokenName;
  /** Hairline border. Decorative under SC 1.4.11 and exempt from the 3:1 floor (§3.2). */
  hairlineToken: TokenName;
  /**
   * EXHAUSTIVE list of opaque substrates this surface may sit over. Every one is measured.
   * Adding a surface to a screen whose background is not in this list is a contrast claim
   * nobody has checked.
   */
  substrateTokens: TokenName[];
  /** Foreground tokens permitted on this surface. Each is measured against every substrate. */
  foregroundTokens: TokenName[];
  /**
   * The floor the worst-case pairing must clear. `AA` = 4.5:1 (normal text),
   * `AA_LARGE` = 3:1 (large text and non-text boundaries).
   */
  floor: "AA" | "AA_LARGE";
}

/**
 * Substrates are named as ROLE tokens, not ramp stops, so they follow the theme. Every one is
 * opaque — `glass-contrast.test.ts` asserts that, because a translucent substrate makes the
 * composite undefined and `compositeOver` throws on it.
 */
export const GLASS_SURFACES: readonly GlassSurface[] = [
  {
    id: "panel",
    className: "glass-surface",
    fallbackToken: "--glass-panel-solid",
    fillToken: "--glass-panel-fill",
    blurToken: "--glass-panel-blur",
    hairlineToken: "--glass-panel-hairline",
    // A panel sits on the page background or on one of the three surface steps. It does NOT
    // sit on --card: a glass panel on a card is glass on glass, and the composite of two
    // near-identical lightnesses reads as neither.
    substrateTokens: ["--background", "--surface-1", "--surface-2", "--surface-3"],
    foregroundTokens: ["--foreground", "--foreground-secondary", "--foreground-tertiary"],
    floor: "AA",
  },
  {
    id: "overlay",
    className: "glass-surface-overlay",
    fallbackToken: "--glass-overlay-solid",
    fillToken: "--glass-overlay-fill",
    blurToken: "--glass-overlay-blur",
    hairlineToken: "--glass-overlay-hairline",
    substrateTokens: ["--background", "--surface-1", "--surface-2"],
    foregroundTokens: ["--foreground", "--foreground-secondary"],
    floor: "AA",
  },
] as const;

/**
 * Every glass token the stylesheet is allowed to declare. `glass-contrast.test.ts` asserts
 * this set and the stylesheet's `--glass-*` declarations are MUTUALLY EXHAUSTIVE, so a glass
 * token added later without a declared substrate set fails the build rather than going
 * unmeasured — which is the realistic way this guarantee decays.
 */
export const DECLARED_GLASS_TOKENS: readonly TokenName[] = [
  ...GLASS_SURFACES.flatMap((s) => [s.fallbackToken, s.fillToken, s.blurToken, s.hairlineToken]),
  // Not surface-specific: shared by both weights.
  "--glass-saturate",
  "--glass-scrim",
];

/** The WCAG floor each level maps to. */
export const FLOOR_RATIO: Record<GlassSurface["floor"], number> = {
  AA: 4.5,
  AA_LARGE: 3,
};

/** Depth tokens, listed so the structural assertions can iterate them by name. */
export const DEPTH_TOKENS: readonly TokenName[] = [
  "--depth-1",
  "--depth-2",
  "--depth-3",
  "--depth-lift-shadow",
  "--depth-inset",
];
