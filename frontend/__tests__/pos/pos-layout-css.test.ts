import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The classes `PageBody` emits on its `fullBleed` branch, READ OUT OF THE COMPONENT rather than
 * retyped here.
 *
 * <h3>Why this is not just another entry in `CANDIDATES`</h3>
 *
 * It was, briefly, and the negative control caught it: `buildCss` only emits utilities for the
 * candidates it is handed, so a hard-coded candidate proves the class *can* compile — never that
 * the class *the component ships* does. Putting a space inside the `clamp()` in `page-body.tsx`
 * (`px-[clamp(var(--space-sm), 2.5%, …)]`, which Tailwind does NOT accept) left the suite green,
 * because the correct spelling was still sitting in this array. The gutter would have been dead
 * in the browser with a passing test over it — precisely the failure mode §7.2.2 names, dressed
 * up as its own gate.
 *
 * <p>Reading the source closes the loop: the candidate IS whatever the component says, so a typo
 * compiles to nothing and the assertion below goes red.
 */
const FULL_BLEED_CLASSES: string[] = (() => {
  const src = readFileSync(resolve(FRONTEND, "components/ui/page-body.tsx"), "utf8");
  // The one string literal on the fullBleed arm — it is the only one that opens with `h-full`.
  const literal = /"(h-full[^"]*)"/.exec(src)?.[1];
  if (!literal) {
    throw new Error(
      "could not find PageBody's fullBleed class literal — if the branch was rewritten, " +
        "point this extractor at the new shape rather than deleting it",
    );
  }
  return literal.split(/\s+/).filter(Boolean);
})();

const CANDIDATES = [
  "grid-cols-[repeat(auto-fill,minmax(130px,1fr))]",
  "lg:w-[360px]",
  ...FULL_BLEED_CLASSES,
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

  it("gives the full-bleed surface a percentage side gutter that actually compiles", () => {
    /*
     * ADDED after review: "on opening POS it is literally expanding to full screen with 0
     * padding at left and right, which should be at least 2-5% on both sides."
     *
     * `PageBody fullBleed` emitted `h-full` and nothing else, so the terminal ran into the
     * bezel. The gutter it now carries is a PERCENTAGE — the request scales with the viewport,
     * and a step off the spacing ladder does not — bounded at both ends so it can never vanish
     * or run away.
     *
     * This assertion belongs in THIS file specifically. It is an arbitrary Tailwind value, and
     * this suite's whole premise (UI-SPEC §7.2.2) is that such a value compiles to NOTHING when
     * the syntax is a character off, while still reading correctly in the source and passing
     * every grep and every JSDOM test. A silently-dead gutter class would reproduce the exact
     * defect that was reported, with a green suite over it.
     *
     * <p>The class under test comes from `FULL_BLEED_CLASSES` — read out of `page-body.tsx` —
     * so this measures the component's spelling and not a copy of it kept in step by hand.
     */
    expect(
      FULL_BLEED_CLASSES.some((c) => c.startsWith("px-[")),
      "PageBody's fullBleed branch no longer emits an inline gutter at all",
    ).toBe(true);
    const rule = /\.px-\\\[clamp[^{]*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule, "the full-bleed gutter compiled to nothing").not.toBe("");
    expect(rule.replace(/\s+/g, " ")).toContain(
      "padding-inline: clamp(var(--space-sm), 2.5%, var(--space-3xl))",
    );
    // The bounds have to be real numbers, not just live var() names: a clamp whose floor and
    // ceiling resolve to nothing degrades to no padding at all, which is where this started.
    expect(builtVar(css, "--space-sm")).toBe("8px");
    expect(builtVar(css, "--space-3xl")).toBe("64px");
  });

  it("does not let that gutter grow back into the fixed back-office inset", () => {
    /*
     * The gutter wave 4 removed was a FIXED 255px operator inset, and the failure mode of
     * "add some padding back" is that it returns as a constant nobody re-measures. 2.5% with a
     * 64px ceiling is 36px at 1440 and 48px at 1920 — the 2–5% asked for — and cannot reach 255
     * at any width. The ceiling is what makes that structural rather than a promise, so the
     * ceiling is what is asserted.
     */
    const ceiling = Number.parseInt(builtVar(css, "--space-3xl") ?? "", 10);
    expect(ceiling).toBeLessThan(255);
    // And the cart is not paying for it: 360px is a fixed track on a `shrink-0` column, so the
    // container's padding comes out of the menu grid, not out of the panel the gate measures.
    expect(/\.lg\\:w-\\\[360px\\\][^{]*\{[^}]*\}/.exec(css)?.[0] ?? "").toContain("width: 360px");
  });

  it("lets the KDS board decline the gutter, unlayered so it beats the utility", () => {
    /*
     * `data-surface="kds"` sits INSIDE `PageBody`, on the element painting `bg-kds-surface`.
     * Padding the PageBody insets the board's GROUND, not its content, and what shows down both
     * edges is app chrome — "a dark board floating in light chrome", the photograph that made
     * `fullBleed` exist. The override must also be UNLAYERED: it is beating a Tailwind utility,
     * and a later cascade layer wins regardless of specificity (the lesson `main:has(...)`
     * already learned in this stylesheet).
     */
    const rule =
      /\[data-page-body="full-bleed"\]:has\(\[data-surface="kds"\]\)[^{]*\{[^}]*\}/.exec(
        css,
      )?.[0] ?? "";
    expect(rule, "the KDS gutter opt-out is missing from the built stylesheet").not.toBe("");
    expect(rule).toContain("padding-inline: 0");
    /*
     * …and it must be UNLAYERED, which is the half that is easy to get wrong and impossible to
     * see in the source. Brace depth is the measurement: a top-level rule sits at depth 0, and
     * anything Tailwind wrapped in `@layer utilities { … }` sits at 1 or deeper. Moved inside a
     * layer this rule would read identically here and silently lose to PageBody's gutter in the
     * browser — the failure `main:has([data-page-body])` already had once, when it was written
     * in `@layer base` and did nothing at all.
     */
    expect(braceDepthAt(css, css.indexOf(rule)), "the opt-out is inside a cascade layer").toBe(0);
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

/**
 * Brace nesting depth of `index` within a compiled stylesheet — 0 means "not inside any
 * `@layer`, `@media` or `@supports` block".
 *
 * <p>Written as a scanner rather than as `(prefix.match(/{/g) ?? []).length - …` because a
 * stylesheet legitimately contains braces inside quoted strings (`content: "{"`), and a counter
 * that miscounts one of those reports a rule as layered when it is not — a false failure on the
 * one assertion whose whole job is to be trusted.
 */
function braceDepthAt(css: string, index: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < index; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return depth;
}
