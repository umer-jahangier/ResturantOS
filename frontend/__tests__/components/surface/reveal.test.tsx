import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Reveal, RevealGroup } from "@/components/ui/surface/reveal";
import { ZoneProvider } from "@/components/providers/zone-provider";

/**
 * Reveal's contract is that it is a NO-OP which still renders its children correctly.
 *
 * <p>The tests below are mostly about what Reveal must NOT do. That is deliberate: the failure
 * this component exists to prevent is authoring a hidden resting state and relying on a keyframe
 * to reveal it, which renders a blank screen for a reduced-motion user, a backgrounded tab, or a
 * paused compositor — and reads as a data-loading bug rather than a motion bug.
 */

const inZone = (zone: "expressive" | "restrained" | "operational", ui: React.ReactNode) =>
  render(<ZoneProvider zone={zone}>{ui}</ZoneProvider>);

describe("Reveal", () => {
  it("sets NO opacity, transform or visibility of its own", () => {
    // THE assertion. Strip the animation class and the children must be exactly where they
    // belong, at full opacity.
    inZone(
      "expressive",
      <Reveal data-testid="r">
        <p>content</p>
      </Reveal>,
    );
    const el = screen.getByTestId("r");
    expect(el.style.opacity, "Reveal must not set a resting opacity").toBe("");
    expect(el.style.transform, "Reveal must not set a resting transform").toBe("");
    expect(el.style.visibility, "Reveal must not set a resting visibility").toBe("");
  });

  it("applies the entrance class in the expressive zone", () => {
    inZone("expressive", <Reveal data-testid="r">x</Reveal>);
    expect(screen.getByTestId("r").className).toContain("vdl-enter");
  });

  it("applies the scale variant on request", () => {
    inZone("expressive", <Reveal data-testid="r" variant="scale" />);
    expect(screen.getByTestId("r").className).toContain("vdl-enter-scale");
  });

  it.each(["restrained", "operational"] as const)(
    "in the %s zone it renders a plain wrapper with NO entrance class",
    (zone) => {
      // Not a shorter animation — none. The 420ms entrance exceeds phase 20's 240ms ceiling,
      // which still binds outside the expressive zone (D-34-02).
      inZone(
        zone,
        <Reveal data-testid="r">
          <p>content</p>
        </Reveal>,
      );
      const el = screen.getByTestId("r");
      expect(el.className ?? "").not.toContain("vdl-enter");
      expect(screen.getByText("content")).toBeInTheDocument();
    },
  );

  it("renders its children in every zone", () => {
    for (const zone of ["expressive", "restrained", "operational"] as const) {
      const { unmount } = inZone(zone, <Reveal>visible in {zone}</Reveal>);
      expect(screen.getByText(`visible in ${zone}`)).toBeInTheDocument();
      unmount();
    }
  });

  it("passes the stagger index through as --vdl-i rather than a hard-coded delay", () => {
    inZone("expressive", <Reveal data-testid="r" index={3} />);
    expect(screen.getByTestId("r").style.getPropertyValue("--vdl-i")).toBe("3");
    // The DELAY itself is computed by the stylesheet (index × --motion-stagger), so adding a
    // sixth item never means rewriting five delays.
    expect(screen.getByTestId("r").style.animationDelay).toBe("");
  });
});

describe("RevealGroup", () => {
  it("sequences its children by index in the expressive zone", () => {
    inZone(
      "expressive",
      <RevealGroup data-testid="g">
        <div data-testid="a" />
        <div data-testid="b" />
        <div data-testid="c" />
      </RevealGroup>,
    );
    expect(screen.getByTestId("g").className).toContain("vdl-stagger");
    expect(screen.getByTestId("a").style.getPropertyValue("--vdl-i")).toBe("0");
    expect(screen.getByTestId("b").style.getPropertyValue("--vdl-i")).toBe("1");
    expect(screen.getByTestId("c").style.getPropertyValue("--vdl-i")).toBe("2");
  });

  it.each(["restrained", "operational"] as const)("adds no stagger in the %s zone", (zone) => {
    inZone(
      zone,
      <RevealGroup data-testid="g">
        <div data-testid="a" />
      </RevealGroup>,
    );
    expect(screen.getByTestId("g").className ?? "").not.toContain("vdl-stagger");
    expect(screen.getByTestId("a").style.getPropertyValue("--vdl-i")).toBe("");
    expect(screen.getByTestId("a")).toBeInTheDocument();
  });

  it("preserves a child's own inline style while adding the index", () => {
    inZone(
      "expressive",
      <RevealGroup>
        <div data-testid="a" style={{ color: "red" }} />
      </RevealGroup>,
    );
    expect(screen.getByTestId("a").style.color).toBe("red");
    expect(screen.getByTestId("a").style.getPropertyValue("--vdl-i")).toBe("0");
  });
});
