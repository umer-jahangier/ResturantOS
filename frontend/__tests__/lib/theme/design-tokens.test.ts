import { describe, expect, it } from "vitest";

import { wcagContrastCheck } from "@/lib/theme/wcag-validator";
import { rawToken, token, tokenNames, type Scope } from "./css-tokens";

/**
 * UI-SPEC §3.8 — "Complete measured contrast tables" — made executable.
 *
 * <p>The spec tabulates 53 measured pairings. Numbers in a document are decoration: they are
 * true on the day they are written and nobody notices when they stop being true. This test
 * reads the shipped `app/globals.css`, resolves each token through its `var()` chain to a
 * literal `oklch(...)`, and re-measures every pairing with the repo's own
 * `wcagContrastCheck` (`lib/theme/wcag-validator.ts`) — the same WCAG 2.1 relative-luminance
 * algorithm the spec was authored against.
 *
 * <p>Two independent assertions per row, because they catch different failures:
 *   1. the ratio still clears the floor for the level the spec claims (a real a11y gate);
 *   2. the ratio still EQUALS the number the spec records (a drift gate — it fails on any
 *      token edit at all, including one that happens to stay above the floor, so the
 *      document and the stylesheet cannot silently diverge).
 *
 * <p>Measurement basis: the unquantised OKLCH, not the 8-bit hex the spec tabulates
 * alongside it. That is how the spec was measured — every one of the 53 numbers reproduces
 * to the last digit this way, whereas measuring the rounded hex drifts by up to 0.07
 * (e.g. `--neutral-1000` on `--primary-400`: 10.27 from OKLCH, 10.34 from `#57cbca`).
 * OKLCH is also what ships: the browser renders `oklch()` at display precision.
 */

/** Floors per WCAG. `exempt` rows are recorded for completeness and carry no floor. */
const FLOOR = {
  AAA: 7,
  AA: 4.5,
  "SC-1.4.11": 3,
  exempt: 0,
} as const;

type Level = keyof typeof FLOOR;
type Row = readonly [label: string, fg: string, bg: string, ratio: number, level: Level];

// ── §3.8 Light theme ────────────────────────────────────────────────────────────
const LIGHT: readonly Row[] = [
  [
    "text-primary --neutral-950 on surface-0 --neutral-0",
    "--neutral-950",
    "--neutral-0",
    19.21,
    "AAA",
  ],
  ["text-primary on surface-1 --neutral-50", "--neutral-950", "--neutral-50", 18.4, "AAA"],
  ["text-primary on surface-2 --neutral-100", "--neutral-950", "--neutral-100", 17.49, "AAA"],
  ["text-secondary --neutral-700 on surface-0", "--neutral-700", "--neutral-0", 8.83, "AAA"],
  ["text-secondary on surface-2", "--neutral-700", "--neutral-100", 8.05, "AAA"],
  ["text-tertiary --neutral-600 on surface-0", "--neutral-600", "--neutral-0", 5.8, "AA"],
  ["text-tertiary on surface-2", "--neutral-600", "--neutral-100", 5.27, "AA"],
  ["text-disabled --neutral-500 on surface-0", "--neutral-500", "--neutral-0", 3.79, "exempt"],
  ["white on --primary-700 (solid button)", "--neutral-0", "--primary-700", 5.85, "AA"],
  ["--primary-700 link on surface-0", "--primary-700", "--neutral-0", 5.85, "AA"],
  ["--primary-800 on --primary-50 (subtle button)", "--primary-800", "--primary-50", 7.78, "AAA"],
  ["focus ring --primary-600 on surface-0", "--primary-600", "--neutral-0", 3.96, "SC-1.4.11"],
  [
    "--border-interactive --neutral-500 on surface-0",
    "--neutral-500",
    "--neutral-0",
    3.79,
    "SC-1.4.11",
  ],
  ["--success-700 on --success-50", "--success-700", "--success-50", 7.13, "AAA"],
  ["white on --success-600", "--neutral-0", "--success-600", 5.27, "AA"],
  ["--warning-800 on --warning-50", "--warning-800", "--warning-50", 9.67, "AAA"],
  ["--neutral-950 on --warning-400 (solid)", "--neutral-950", "--warning-400", 8.25, "AAA"],
  ["--danger-700 on --danger-50", "--danger-700", "--danger-50", 8.94, "AAA"],
  ["white on --danger-600", "--neutral-0", "--danger-600", 6.9, "AA"],
  ["--info-700 on --info-50", "--info-700", "--info-50", 9.14, "AAA"],
  ["white on --info-600", "--neutral-0", "--info-600", 6.86, "AA"],
];

// ── §3.8 Dark theme ─────────────────────────────────────────────────────────────
const DARK: readonly Row[] = [
  [
    "text-primary --neutral-50 on surface-0 --neutral-1000",
    "--neutral-50",
    "--neutral-1000",
    19.23,
    "AAA",
  ],
  ["text-primary on surface-1 --neutral-950", "--neutral-50", "--neutral-950", 18.4, "AAA"],
  ["text-primary on surface-2 --neutral-900", "--neutral-50", "--neutral-900", 16.36, "AAA"],
  ["text-secondary --neutral-300 on surface-0", "--neutral-300", "--neutral-1000", 13.64, "AAA"],
  ["text-secondary on surface-2", "--neutral-300", "--neutral-900", 11.6, "AAA"],
  ["text-tertiary --neutral-400 on surface-0", "--neutral-400", "--neutral-1000", 8.71, "AAA"],
  ["text-tertiary on surface-2", "--neutral-400", "--neutral-900", 7.41, "AAA"],
  ["text-disabled --neutral-500 on surface-0", "--neutral-500", "--neutral-1000", 5.3, "AA"],
  [
    "--neutral-1000 on --primary-400 (solid button)",
    "--neutral-1000",
    "--primary-400",
    9.62,
    "AAA",
  ],
  ["--primary-300 link on surface-0", "--primary-300", "--neutral-1000", 12.43, "AAA"],
  ["focus ring --primary-400 on surface-0", "--primary-400", "--neutral-1000", 9.62, "SC-1.4.11"],
  [
    "--border-interactive --neutral-600 on surface-0",
    "--neutral-600",
    "--neutral-1000",
    3.46,
    "SC-1.4.11",
  ],
  ["--success-300 on surface-0", "--success-300", "--neutral-1000", 12.34, "AAA"],
  ["--neutral-1000 on --success-400", "--neutral-1000", "--success-400", 9.16, "AAA"],
  ["--warning-300 on surface-0", "--warning-300", "--neutral-1000", 11.87, "AAA"],
  ["--neutral-1000 on --warning-400", "--neutral-1000", "--warning-400", 8.64, "AAA"],
  ["--danger-300 on surface-0", "--danger-300", "--neutral-1000", 11.5, "AAA"],
  ["--neutral-1000 on --danger-400", "--neutral-1000", "--danger-400", 8.14, "AAA"],
  ["--info-300 on surface-0", "--info-300", "--neutral-1000", 12.09, "AAA"],
  ["--neutral-1000 on --info-400", "--neutral-1000", "--info-400", 8.89, "AAA"],
];

// ── §3.8 "anything a cashier reads under time pressure" (D-UI-01 constraint 2) ──
const POS: readonly Row[] = [
  ["tile label --neutral-950 on tile --neutral-0", "--neutral-950", "--neutral-0", 19.21, "AAA"],
  ["tile label on selected tile --primary-50", "--neutral-950", "--primary-50", 17.89, "AAA"],
  [
    "selected-tile border --primary-600 on --primary-50",
    "--primary-600",
    "--primary-50",
    3.69,
    "SC-1.4.11",
  ],
  ["86'd tile --neutral-500 on --neutral-100", "--neutral-500", "--neutral-100", 3.44, "exempt"],
  ["Charge button: white on --success-600", "--neutral-0", "--success-600", 5.27, "AA"],
  ["Send button: white on --primary-700", "--neutral-0", "--primary-700", 5.85, "AA"],
];

const KDS: readonly Row[] = [
  ["--kds-text on --kds-card", "--kds-text", "--kds-card", 16.06, "AAA"],
  ["--kds-muted on --kds-card", "--kds-muted", "--kds-card", 7.64, "AAA"],
  ["--kds-fresh on --kds-card", "--kds-fresh", "--kds-card", 9.99, "AAA"],
  ["--kds-warn on --kds-card", "--kds-warn", "--kds-card", 11.64, "AAA"],
  ["--kds-late on --kds-card", "--kds-late", "--kds-card", 4.78, "AA"],
  ["--kds-text on --kds-late-fill", "--kds-text", "--kds-late-fill", 9.07, "AAA"],
];

function check(row: Row, scope: Scope) {
  const [, fg, bg, expected, level] = row;
  const { ratio } = wcagContrastCheck(token(fg, scope), token(bg, scope));
  // 1. the a11y gate the spec claims for this pairing
  expect(ratio, `${fg} on ${bg} must clear ${level} (≥${FLOOR[level]}:1)`).toBeGreaterThanOrEqual(
    FLOOR[level],
  );
  // 2. the drift gate — the spec's number must still be the truth
  expect(
    Math.abs(ratio - expected),
    `${fg} on ${bg}: measured ${ratio}:1, UI-SPEC §3.8 records ${expected}:1`,
  ).toBeLessThanOrEqual(0.02);
}

describe("UI-SPEC §3.8 — light theme contrast", () => {
  it.each(LIGHT.map((r) => [r[0], r] as const))("%s", (_label, row) => check(row, "light"));
});

describe("UI-SPEC §3.8 — dark theme contrast", () => {
  it.each(DARK.map((r) => [r[0], r] as const))("%s", (_label, row) => check(row, "dark"));
});

describe("UI-SPEC §3.8 — POS surfaces (AAA for text read under time pressure)", () => {
  it.each(POS.map((r) => [r[0], r] as const))("%s", (_label, row) => check(row, "light"));
});

describe("UI-SPEC §3.7/§3.8 — KDS surfaces (permanently dark, legible at 2 m)", () => {
  it.each(KDS.map((r) => [r[0], r] as const))("%s", (_label, row) => check(row, "kds"));
});

// ── §3.2 the two-tier border split — the reason input.tsx changed ───────────────
describe("UI-SPEC §3.2 — decorative vs interactive borders", () => {
  /**
   * WIDENED 2026-08-21. This assertion used to check the PAGE surface only — `--neutral-0`
   * in light, `--neutral-1000` in dark — and that blind spot was hiding a live defect:
   * a text input rendered inside a Card in dark mode measured **2.94:1**, under SC 1.4.11's
   * 3:1 floor, and had done since the dark surfaces were introduced. It was NOT caused by
   * the gold identity — re-measured against the old cyan tokens it reads 2.94:1, against the
   * new blue-black ones 2.95:1. The gate simply never looked at a card.
   *
   * Inputs sit on all three surface tiers. All three are now asserted, so the same class of
   * defect cannot come back through a surface the gate does not happen to name.
   */
  it.each([
    ["light", "--neutral-0"],
    ["light", "--neutral-50"],
    ["light", "--neutral-100"],
    ["dark", "--neutral-1000"],
    ["dark", "--neutral-950"],
    ["dark", "--neutral-900"],
  ] as const)("--border-interactive clears SC 1.4.11 on %s %s", (scope, surface) => {
    const { ratio } = wcagContrastCheck(
      token("--border-interactive", scope),
      token(surface, scope),
    );
    expect(ratio, `--border-interactive on ${surface} (${scope})`).toBeGreaterThanOrEqual(3);
  });

  it("--input is wired to --border-interactive, not to --border", () => {
    // The old value was `oklch(0.922 0 0)` — 1.23:1 on white, a straight SC 1.4.11 failure
    // on every text field in the product. ~28 call sites say `border-input`, so pointing the
    // role token at the interactive stop fixes all of them at once.
    for (const scope of ["light", "dark"] as const) {
      expect(token("--input", scope)).toBe(token("--border-interactive", scope));
      expect(token("--input", scope)).not.toBe(token("--border", scope));
    }
  });

  it("--border stays decorative and is NOT held to 3:1 (SC 1.4.11 exempts gridlines)", () => {
    // Recorded, not asserted as a pass: conflating decorative and interactive boundaries is
    // exactly why most design systems fail 1.4.11 — they raise gridlines to 3:1 and the
    // tables become cages.
    expect(wcagContrastCheck(token("--border"), token("--neutral-0")).ratio).toBeCloseTo(1.23, 1);
    expect(
      wcagContrastCheck(token("--border", "dark"), token("--neutral-1000", "dark")).ratio,
    ).toBeCloseTo(1.49, 1);
  });
});

// ── §5.1/§7.4 selected row — the case the spec only wrote for light mode ───────
describe("UI-SPEC §5.1 — the selected row must read in BOTH themes", () => {
  it.each(["light", "dark"] as const)(
    "%s: selected-row text clears AAA on the selected fill",
    (scope) => {
      const { ratio } = wcagContrastCheck(
        token("--selected-foreground", scope),
        token("--selected", scope),
      );
      expect(ratio).toBeGreaterThanOrEqual(7);
    },
  );

  it.each(["light", "dark"] as const)(
    "%s: the selected-row left border clears SC 1.4.11 against its own fill",
    (scope) => {
      const { ratio } = wcagContrastCheck(
        token("--selected-border", scope),
        token("--selected", scope),
      );
      expect(ratio).toBeGreaterThanOrEqual(3);
    },
  );

  it("the naive reading of §5.1 — --foreground on --primary-50 — is illegible in dark", () => {
    // Recorded so nobody re-derives the bug from the spec text. 1.02:1.
    const { ratio } = wcagContrastCheck(
      token("--foreground", "dark"),
      token("--primary-50", "dark"),
    );
    expect(ratio).toBeLessThan(1.1);
    // …and the role token that replaces it is not that.
    expect(token("--selected", "dark")).not.toBe(token("--primary-50", "dark"));
  });
});

// ── §3.4 chart series must survive SC 1.4.11 against the page ──────────────────
describe("UI-SPEC §3.4 — chart series vs surface-0", () => {
  it.each([
    ["light", "--neutral-0", 3.11],
    ["dark", "--neutral-1000", 3.27],
  ] as const)("%s: every series clears 3:1 (min %s)", (scope, surface, expectedMin) => {
    const ratios = [1, 2, 3, 4, 5].map(
      (n) => wcagContrastCheck(token(`--chart-${n}`, scope), token(surface, scope)).ratio,
    );
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(3);
    expect(Math.abs(Math.min(...ratios) - expectedMin)).toBeLessThanOrEqual(0.02);
  });
});

// ── §3.5 the heatmap contract is the CELL LABEL, not the fill ─────────────────
describe("UI-SPEC §3.5 — sequential ramp cell labels", () => {
  // Re-recorded 2026-08-21 for the gold identity (D-38-11 — measured once, recorded once).
  // The sequential ramp follows --brand-h, so all five moved with the hue. Every row still
  // clears the 4.5 AA floor asserted below; only the recorded figure changed.
  // --seq-4 at 4.72 is the tightest row in the whole file — 0.22 of headroom. If a future
  // hue move pushes it under 4.5 the first assertion fails before the drift one does, which
  // is the intended order: an accessibility floor is not a number to re-record.
  it.each([
    ["--seq-1", "--primary-950", 12.64],
    ["--seq-2", "--primary-950", 9.94],
    ["--seq-3", "--primary-950", 7.15],
    ["--seq-4", "--primary-950", 4.72],
    ["--seq-5", "--neutral-0", 5.61],
  ] as const)("%s label passes AA", (fill, label, expected) => {
    const { ratio } = wcagContrastCheck(token(label), token(fill));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(ratio - expected)).toBeLessThanOrEqual(0.02);
  });
});

// ── D-UI-01: "the ramp must be regenerable by changing one hue value" ──────────
/**
 * AMENDED 2026-08-21 by phase 38's demo calibration — see
 * `.planning/phases/38-erp-design-transformation/38-DECISIONS-DEMO.md` **D-38-12**.
 *
 * This block used to assert that the ENTIRE system regenerates from `--brand-h` alone,
 * including all 13 neutral stops. That assertion was correct for the cyan identity and is
 * wrong for the one the product owner chose.
 *
 * The reason is measurable, not aesthetic. The target identity stands a WARM accent
 * (gold, hue 69) on a COOL ground (blue-black, hue 260); that opposition is most of why it
 * reads as expensive. Tying the neutrals to the brand hue makes the surfaces warm
 * brown-grey — a different product. There is no arrangement that keeps both the look and
 * the one-number property, so the one-number property was retired ON PURPOSE.
 *
 * What is asserted now is STRICTER than "some tokens use some hue": every ramp is pinned to
 * its OWN axis, and crossing them is a failure. The ratchet did not loosen; it forked.
 *
 *   --brand-h   69   primary ramp, sequential ramp, --div-mid, every KDS surface
 *   --accent-h  182  secondary ramp, --chart-1
 *   --neutral-h 260  the 13 neutral stops
 *
 * If you are here to re-tie the neutrals to `--brand-h`: read D-38-12 first. That is a
 * product decision, not a tidy-up.
 */
describe("D-38-12 — every ramp regenerates from its own hue axis", () => {
  const BRAND_PARAMETERISED = [
    ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => `--primary-${n}`),
    ...[1, 2, 3, 4, 5].map((n) => `--seq-${n}`),
    "--div-mid",
  ];
  const ACCENT_PARAMETERISED = [
    ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => `--secondary-${n}`),
    "--chart-1",
  ];
  const NEUTRAL_PARAMETERISED = [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000].map(
    (n) => `--neutral-${n}`,
  );

  it("the three hue axes are declared exactly once, on :root", () => {
    expect(rawToken("--brand-h")).toBe("69");
    expect(rawToken("--accent-h")).toBe("182");
    expect(rawToken("--neutral-h")).toBe("260");
    for (const axis of ["--brand-h", "--accent-h", "--neutral-h"]) {
      expect(tokenNames("dark")).not.toContain(axis);
      expect(tokenNames("kds")).not.toContain(axis);
    }
  });

  it.each(BRAND_PARAMETERISED)("%s is authored against var(--brand-h)", (name) => {
    expect(rawToken(name)).toContain("var(--brand-h)");
  });

  it.each(ACCENT_PARAMETERISED)("%s is authored against var(--accent-h)", (name) => {
    expect(rawToken(name)).toContain("var(--accent-h)");
  });

  it.each(NEUTRAL_PARAMETERISED)("%s is authored against var(--neutral-h)", (name) => {
    expect(rawToken(name)).toContain("var(--neutral-h)");
  });

  it("the axes do not cross — a ramp never borrows another ramp's hue", () => {
    // The negative control for the three assertions above. Without this, moving a neutral
    // stop onto --brand-h would still pass its own group's check if the group list were
    // edited to match, and the fork would quietly collapse back into one axis.
    for (const name of NEUTRAL_PARAMETERISED) {
      expect(rawToken(name), `${name} must not borrow the brand hue`).not.toContain(
        "var(--brand-h)",
      );
    }
    for (const name of BRAND_PARAMETERISED) {
      expect(rawToken(name), `${name} must not borrow the neutral hue`).not.toContain(
        "var(--neutral-h)",
      );
    }
  });

  it.each(["--kds-surface", "--kds-card", "--kds-card-focus", "--kds-text", "--kds-muted"])(
    "%s is authored against var(--brand-h)",
    (name) => {
      expect(rawToken(name, "kds")).toContain("var(--brand-h)");
    },
  );

  it("the dark chart series regenerate too (--chart-1 only; 2–5 are fixed by contract)", () => {
    // --chart-1 moved from --brand-h to --accent-h (D-38-12): at gold it collided with
    // --chart-2 (literal hue 35), pairwise ΔE2000 falling 26.89 → 20.20 — the worst-separated
    // pair in the series. Series separation is not gated here; that gap is recorded in the
    // recalibration rather than silently relied on.
    expect(rawTokenIn("dark", "--chart-1")).toContain("var(--accent-h)");
    for (const n of [2, 3, 4, 5]) {
      expect(rawTokenIn("dark", `--chart-${n}`)).not.toContain("var(--accent-h)");
    }
  });

  it("no token block contains a hard-coded hex colour", () => {
    // D-UI-01, literally: "do not hard-code hex values throughout". A hex is a value that
    // cannot follow --brand-h, so one hex is one token that silently stops regenerating.
    for (const block of ["root", "dark", "kds"] as const) {
      for (const name of tokenNames(block)) {
        expect(rawTokenIn(block, name), `${name} in :${block}`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      }
    }
  });
});

function rawTokenIn(block: "root" | "dark" | "kds", name: string): string {
  const scope: Scope = block === "root" ? "light" : block;
  return rawToken(name, scope);
}

// ── §3.9 role-token wiring: components only ever name roles, never ramp stops ──
describe("UI-SPEC §3.9 — role tokens resolve to the intended ramp stop", () => {
  const LIGHT_ROLES: [string, string][] = [
    ["--background", "--neutral-0"],
    ["--surface-1", "--neutral-50"],
    ["--surface-2", "--neutral-100"],
    ["--surface-3", "--neutral-200"],
    ["--foreground", "--neutral-950"],
    ["--foreground-secondary", "--neutral-700"],
    ["--foreground-tertiary", "--neutral-600"],
    ["--foreground-disabled", "--neutral-500"],
    ["--primary", "--primary-700"],
    ["--primary-foreground", "--neutral-0"],
    ["--ring", "--primary-600"],
    ["--border", "--neutral-200"],
    ["--border-strong", "--neutral-300"],
    ["--border-interactive", "--neutral-500"],
    ["--destructive", "--danger-600"],
    ["--success", "--success-600"],
    ["--warning", "--warning-400"],
    ["--info", "--info-600"],
  ];
  const DARK_ROLES: [string, string][] = [
    ["--background", "--neutral-1000"],
    ["--surface-1", "--neutral-950"],
    ["--surface-2", "--neutral-900"],
    ["--surface-3", "--neutral-800"],
    ["--foreground", "--neutral-50"],
    ["--foreground-secondary", "--neutral-300"],
    ["--foreground-tertiary", "--neutral-400"],
    ["--primary", "--primary-400"],
    ["--primary-foreground", "--neutral-1000"],
    ["--ring", "--primary-400"],
    ["--border", "--neutral-800"],
    ["--border-strong", "--neutral-700"],
    ["--border-interactive", "--neutral-500"],
    ["--destructive", "--danger-400"],
  ];

  it.each(LIGHT_ROLES)("light: %s === %s", (role, stop) => {
    expect(token(role)).toBe(token(stop));
  });

  it.each(DARK_ROLES)("dark: %s === %s", (role, stop) => {
    expect(token(role, "dark")).toBe(token(stop, "dark"));
  });

  it("every role token a component can name is defined in BOTH themes", () => {
    // A role defined only on :root silently keeps its light value in dark mode — the class
    // of bug where one card stays white at midnight. Foregrounds must pair with surfaces.
    const paired = [
      "--background",
      "--foreground",
      "--card",
      "--card-foreground",
      "--popover",
      "--popover-foreground",
      "--primary",
      "--primary-foreground",
      "--secondary",
      "--secondary-foreground",
      "--muted",
      "--muted-foreground",
      "--accent",
      "--accent-foreground",
      "--destructive",
      "--destructive-foreground",
      "--success",
      "--success-foreground",
      "--warning",
      "--warning-foreground",
      "--info",
      "--info-foreground",
      "--border",
      "--border-strong",
      "--border-interactive",
      "--input",
      "--ring",
      "--surface-1",
      "--surface-2",
      "--surface-3",
      "--foreground-secondary",
      "--foreground-tertiary",
      "--foreground-disabled",
      "--selected",
      "--selected-foreground",
      "--selected-border",
      "--sidebar",
      "--sidebar-foreground",
      "--sidebar-primary",
      "--sidebar-primary-foreground",
      "--sidebar-accent",
      "--sidebar-accent-foreground",
      "--sidebar-border",
      "--sidebar-ring",
    ];
    for (const name of paired) {
      expect(tokenNames("root"), `${name} missing from :root`).toContain(name);
      expect(tokenNames("dark"), `${name} missing from .dark`).toContain(name);
    }
  });

  it("--primary-solid is the FILL role and --primary is the TEXT role — they do not converge", () => {
    // D-38-18. Gold cannot do both jobs in light mode: primary-400 is gold but measures
    // 2.08:1 as text on white; primary-700 reads as text at 5.86:1 but renders bronze.
    // In LIGHT they must therefore differ. In DARK they legitimately coincide — that is
    // luck, not contract, which is why it is asserted as an equality rather than assumed.
    expect(token("--primary-solid", "light")).not.toBe(token("--primary", "light"));
    expect(token("--primary-solid", "dark")).toBe(token("--primary", "dark"));
    // The button is the same gold in BOTH themes — only the label flips. That is the whole
    // point of the split: one brand colour, two legible labels.
    expect(token("--primary-solid", "light")).toBe(token("--primary-solid", "dark"));
  });

  it("solid fills stay legible against their own foreground in both themes", () => {
    const fills: [string, string, number][] = [
      ["--primary", "--primary-foreground", 4.5],
      // The fill role added by D-38-18. Without this row the split is unguarded: --primary-solid
      // is the ONLY role token whose two themes point at the same ramp stop and differ only in
      // their foreground, so a careless edit to either foreground fails silently on one theme.
      ["--primary-solid", "--primary-solid-foreground", 4.5],
      ["--destructive", "--destructive-foreground", 4.5],
      ["--success", "--success-foreground", 4.5],
      ["--warning", "--warning-foreground", 4.5],
      ["--info", "--info-foreground", 4.5],
    ];
    for (const scope of ["light", "dark"] as const) {
      for (const [bg, fg, floor] of fills) {
        const { ratio } = wcagContrastCheck(token(fg, scope), token(bg, scope));
        expect(ratio, `${fg} on ${bg} (${scope}) = ${ratio}:1`).toBeGreaterThanOrEqual(floor);
      }
    }
  });
});
