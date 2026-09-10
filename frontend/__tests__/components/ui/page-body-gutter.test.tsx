import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageBody } from "@/components/ui/page-body";

/**
 * `PageBody`'s inline gutter — the DOM half of the fix reviewed as
 * *"on opening POS it is literally expanding to full screen with 0 padding at left and right,
 * which should be at least 2-5% on both sides."*
 *
 * <h3>Why this file exists alongside `__tests__/pos/pos-layout-css.test.ts`</h3>
 *
 * The two halves of "the POS has a gutter" fail independently and neither test can see the
 * other's failure:
 *
 *   1. **Does the class compile?** An arbitrary Tailwind value one character off compiles to
 *      nothing while reading perfectly in the source. That is the CSS suite's question, and it
 *      answers it by running globals.css through Tailwind's own compiler.
 *   2. **Does the class reach the element?** A compiled utility on a `className` that `cn()`
 *      drops, or that a later `className` prop overrides, is just as invisible. That is this
 *      file's question, and only a render can answer it.
 *
 * <p>The pairing matters because the defect being fixed was, precisely, a class that was not
 * there. Asserting only half of it would leave the other half free to regress silently.
 *
 * <h3>What is deliberately NOT asserted</h3>
 *
 * The literal `clamp()` string. It is asserted once, in the CSS suite, against the compiled
 * declaration — the place where being wrong is detectable. Re-typing it here would make a value
 * change a two-file edit for no extra coverage, and the second copy is the one that goes stale.
 */
describe("PageBody — the full-bleed surface still gets a side gutter", () => {
  it("emits a percentage inline gutter on the full-bleed branch", () => {
    render(
      <PageBody fullBleed>
        <span>till</span>
      </PageBody>,
    );
    const body = screen.getByText("till").parentElement!;

    expect(body.getAttribute("data-page-body")).toBe("full-bleed");
    // A `px-[…]` utility, whatever its current value — the gutter exists and is inline-axis only.
    const gutter = [...body.classList].find((c) => c.startsWith("px-["));
    expect(gutter, "the full-bleed branch emits no inline gutter class at all").toBeDefined();
    // Percentage, not a fixed step: the review asked for a proportion of the viewport, and a
    // token off the spacing ladder cannot express "2-5% at every width the till ships to".
    expect(gutter).toContain("%");
  });

  it("still declines the back-office gutter it was invented to decline", () => {
    /*
     * The whole point of `fullBleed` is that `p-(--space-lg) … lg:p-(--space-xl)` does not
     * apply. "Full-bleed" now means *not the fixed back-office gutter*, not *zero* — but if the
     * block padding came back, the POS would lose vertical space on the one screen the brief
     * says to optimise for speed, and the KDS would regain the light frame around a dark board
     * that the audit photographed.
     */
    render(
      <PageBody fullBleed>
        <span>till</span>
      </PageBody>,
    );
    const cls = screen.getByText("till").parentElement!.className;

    expect(cls).toContain("h-full");
    expect(cls).not.toContain("p-(--space-lg)");
    expect(cls).not.toContain("lg:p-(--space-xl)");
    // No bottom clearance either — a full-bleed surface manages its own scroll region.
    expect(cls).not.toContain("pb-20");
  });

  it("leaves the gutter branch exactly as it was — this change is scoped to full-bleed", () => {
    /*
     * 59 back-office routes render through this branch. The reported defect was about the POS,
     * and a fix that also moved every back-office page would be an unattributable 65-route
     * visual change riding along with a three-line one.
     */
    render(
      <PageBody>
        <span>office</span>
      </PageBody>,
    );
    const el = screen.getByText("office").parentElement!;

    expect(el.getAttribute("data-page-body")).toBe("gutter");
    expect(el.className).toContain("p-(--space-lg)");
    expect(el.className).toContain("lg:p-(--space-xl)");
    expect([...el.classList].some((c) => c.startsWith("px-["))).toBe(false);
  });

  it("keeps emitting data-page-body on both branches — the shell opt-out depends on it", () => {
    /*
     * `main:has([data-page-body]) { padding: 0 }` is what strips the shell's own `p-4 lg:p-6`.
     * A full-bleed page that stopped emitting the attribute would inherit the shell gutter AND
     * carry its own, which is the doubled 48px inset 38-01 measured in Chromium and fixed.
     */
    const { rerender } = render(
      <PageBody fullBleed>
        <span>x</span>
      </PageBody>,
    );
    expect(screen.getByText("x").parentElement!.hasAttribute("data-page-body")).toBe(true);
    rerender(
      <PageBody>
        <span>x</span>
      </PageBody>,
    );
    expect(screen.getByText("x").parentElement!.hasAttribute("data-page-body")).toBe(true);
  });
});
