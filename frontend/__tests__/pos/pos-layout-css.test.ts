import { describe, it, expect, beforeAll } from "vitest";

import { buildCss, builtVar } from "@/__tests__/lib/theme/built-css";

/**
 * 38-04 tasks 2 and 3 — the POS terminal's geometry, compiled rather than asserted.
 *
 * <h3>Why this test exists at all</h3>
 *
 * UI-SPEC §7.2.2 states the rule this suite obeys: *a class present in the source is not evidence
 * it is present in the DOM.* Two of this plan's contracts are pure CSS numbers — the cart column
 * is **360px** and no tile is ever narrower than **130px** — and both are expressed through
 * Tailwind arbitrary values, which are exactly the kind of class that compiles to nothing when the
 * syntax is a character off. A JSDOM test cannot catch that (it has no CSS engine) and neither can
 * a grep (the string is right there in the file, doing nothing).
 *
 * <p>So these compile `app/globals.css` through Tailwind's own compiler and read the rule the
 * browser would receive. The same instrument 38-01 used to prove `text-body` was a live utility
 * rather than a dead custom property.
 *
 * <p>It also stands in for a measurement this plan could not take: the phase's cart-width gate runs
 * in a real browser, and 38-04's own history is a warning about trusting that gate blindly —
 * `verify-38-wave3.mjs` selected `aside` as a fallback and spent an entire wave measuring the
 * SIDEBAR's 256px while reporting it as the cart.
 */

const CANDIDATES = [
  "grid-cols-[repeat(auto-fill,minmax(130px,1fr))]",
  "lg:w-[360px]",
  "min-h-[100px]",
  "h-14",
  "touch-target",
  "bg-surface-2",
  "text-pos",
  "text-small",
  "text-label",
  "text-body",
];

let css = "";

beforeAll(async () => {
  css = await buildCss(CANDIDATES);
});

describe("POS terminal geometry survives the build", () => {
  it("gives the cart column exactly 360px at lg — the contract, not 320 and not 359", () => {
    /*
     * The width sits on the panel WRAPPER and the divider border sits on the menu column, so the
     * element the browser gate measures — `[data-testid="order-panel"]` — fills 360 rather than
     * 360 minus a hairline. UI-SPEC §3.10: 320 was "too narrow for a modifier line plus quantity
     * stepper plus money without truncation".
     */
    expect(css).toMatch(/\.lg\\:w-\\\[360px\\\]/);
    const rule = /\.lg\\:w-\\\[360px\\\][^{]*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("width: 360px");
    expect(css).toMatch(/@media \(width >= 64rem\)/);
  });

  it("states the tile MINIMUM and lets the browser choose the column count", () => {
    /*
     * `repeat(auto-fill, minmax(130px, 1fr))` replaces `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`
     * (adopted from the demo under D-38-15 — the one thing its POS does better than ours did).
     * Three hard-coded counts meant the tile width was whatever the viewport divided by 2, 3 or 4
     * happened to be; this states the thing that actually matters and holds at every width,
     * including the ~255px the operator shell just handed back to the grid.
     */
    // Tailwind escapes the commas and parens in the selector, so this matches on the emitted
    // DECLARATION and then checks the selector that carries it — a regex written against the
    // escaped selector is exactly the kind of thing that passes for the wrong reason.
    const rule = /\.grid-cols[^{]*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule, "the arbitrary grid-template-columns value compiled to nothing").not.toBe("");
    expect(rule.replace(/\s+/g, " ")).toContain(
      "grid-template-columns: repeat(auto-fill,minmax(130px,1fr))",
    );
  });

  it("keeps every tile clear of UI-SPEC §9.2's 56px floor on both axes", () => {
    const rule = /\.min-h-\\\[100px\\\][^{]*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("min-height: 100px");
    // 130px is the width floor from the track above; 100px is the height floor here. Both clear
    // 56px with room, which is the point — 56 is the floor, not the target.
  });

  it("makes `touch-target` a real 44×44 rule, since three POS controls now rely on it", () => {
    const rule = /\.touch-target[^{]*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("min-height: 44px");
    expect(rule).toContain("min-width: 44px");
  });

  it("emits the operator strip's 56px height and its chrome surface", () => {
    /*
      `h-14` is `calc(var(--spacing) * 14)`, so "56px" is only true while `--spacing` is 0.25rem —
      and this codebase deliberately bridges `--spacing-<name>` onto its own `--space-*` ladder
      (globals.css §"sizing namespace"). Both halves are asserted, because the number in the plan
      is 56 and a token move that quietly made the operator strip 44px or 72px would otherwise
      pass every test in the repository.
    */
    expect(builtVar(css, "--spacing")).toBe("0.25rem");
    expect(/\.h-14[^{]*\{[^}]*\}/.exec(css)?.[0] ?? "").toContain(
      "height: calc(var(--spacing) * 14)",
    );
    expect(/\.bg-surface-2[^{]*\{[^}]*\}/.exec(css)?.[0] ?? "").toContain(
      "background-color: var(--surface-2)",
    );
  });

  it("keeps the four contract type roles this plan moved the POS onto", () => {
    // `--text-pos` is 17/24 (UI-SPEC §3) — the whole reason the role exists is that a dish name is
    // read at arm's length. `text-sm` was 14px.
    expect(/\.text-pos[^{]*\{[^}]*\}/.exec(css)?.[0] ?? "").toContain("--text-pos");
    for (const role of ["text-body", "text-small", "text-label"]) {
      expect(
        new RegExp(`\\.${role}[^{]*\\{[^}]*\\}`).exec(css)?.[0] ?? "",
        `${role} did not compile — a dead role class is worse than the text-sm it replaced`,
      ).toContain(`--${role}`);
    }
  });
});
