import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GlassPanel } from "@/components/ui/surface/glass-panel";
import { Card } from "@/components/ui/card";
import { ZoneProvider } from "@/components/providers/zone-provider";

/**
 * The primitives refuse to enrich themselves outside the expressive zone — in the COMPONENT as
 * well as in the cascade.
 *
 * <p>The cascade alone would very nearly do: the fill and the compositing filter live in a rule
 * scoped to `[data-zone="expressive"]`. The component checks again because a portalled surface
 * has no zone ancestor for the cascade to walk, and because a mis-imported primitive should
 * degrade at the component boundary rather than depending on a rule several files away still
 * being correct. The recurring failure in this phase is a rule that is present and never
 * matches.
 */

const inZone = (zone: "expressive" | "restrained" | "operational", ui: React.ReactNode) =>
  render(<ZoneProvider zone={zone}>{ui}</ZoneProvider>);

describe("GlassPanel", () => {
  it("carries the glass class and stamps the zone it resolved", () => {
    inZone("expressive", <GlassPanel data-testid="p">content</GlassPanel>);
    const el = screen.getByTestId("p");
    expect(el.className).toContain("glass-surface");
    expect(el.getAttribute("data-zone")).toBe("expressive");
    expect(el.getAttribute("data-slot")).toBe("glass-panel");
  });

  it.each(["restrained", "operational"] as const)(
    "stamps %s so the cascade withholds the fill and the filter",
    (zone) => {
      inZone(zone, <GlassPanel data-testid="p">content</GlassPanel>);
      // The class stays — it carries the OPAQUE base declaration, which is what should render
      // here. What must not resolve is the translucency, and that is the cascade's job: the
      // enhancement rule is rooted at [data-zone="expressive"] and this attribute is not it.
      expect(screen.getByTestId("p").getAttribute("data-zone")).toBe(zone);
    },
  );

  it("defaults to the panel weight and renders the overlay weight on request", () => {
    const { rerender } = inZone("expressive", <GlassPanel data-testid="p" />);
    expect(screen.getByTestId("p").className).toContain("glass-surface");
    expect(screen.getByTestId("p").className).not.toContain("glass-surface-overlay");

    rerender(
      <ZoneProvider zone="expressive">
        <GlassPanel data-testid="p" weight="overlay" />
      </ZoneProvider>,
    );
    expect(screen.getByTestId("p").className).toContain("glass-surface-overlay");
  });

  it("animates nothing outside the transform and opacity families", () => {
    // D-34-06: animating a dimension, a position offset, a shadow spread or a filter radius
    // moves work onto the main thread and defeats the point of using transforms for depth.
    inZone("expressive", <GlassPanel data-testid="p" interactive />);
    const cls = screen.getByTestId("p").className;
    expect(cls).toContain("vdl-lift");
    for (const forbidden of ["transition-all", "transition-\\[width", "transition-\\[height"]) {
      expect(new RegExp(forbidden).test(cls)).toBe(false);
    }
  });

  it("renders children unchanged", () => {
    inZone("expressive", <GlassPanel>hello</GlassPanel>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});

describe("Card — the default rendering MUST NOT change", () => {
  /**
   * The assertion that matters most in this file. Card is consumed across the product, so a
   * silent restyle of every card is a screen rebuild, which this phase is explicitly not doing.
   * Depth is opt-in.
   */
  const DEFAULT_CLASSES =
    "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10";

  it("a Card with no depth prop renders exactly the classes it did before phase 34", () => {
    render(<Card data-testid="c">x</Card>);
    const cls = screen.getByTestId("c").className;
    for (const token of DEFAULT_CLASSES.split(" ")) {
      expect(cls, `default Card lost "${token}"`).toContain(token);
    }
    expect(cls, "a Card with no depth prop must carry NO depth shadow").not.toMatch(
      /shadow-depth-/,
    );
    expect(cls, "and no hover lift").not.toContain("vdl-lift");
  });

  it("data-depth is absent unless asked for", () => {
    render(<Card data-testid="c">x</Card>);
    expect(screen.getByTestId("c").hasAttribute("data-depth")).toBe(false);
  });

  it.each([1, 2, 3] as const)("depth=%s adds exactly one depth shadow", (depth) => {
    render(
      <Card data-testid="c" depth={depth}>
        x
      </Card>,
    );
    const cls = screen.getByTestId("c").className;
    expect(cls).toContain(`shadow-depth-${depth}`);
    expect(cls.match(/shadow-depth-\d/g)).toHaveLength(1);
  });

  it("interactive adds the lift without changing anything else", () => {
    render(
      <Card data-testid="c" interactive>
        x
      </Card>,
    );
    expect(screen.getByTestId("c").className).toContain("vdl-lift");
  });

  it("the size variants still work", () => {
    render(
      <Card data-testid="c" size="sm">
        x
      </Card>,
    );
    expect(screen.getByTestId("c").getAttribute("data-size")).toBe("sm");
  });
});
