import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { Meter } from "@/components/ui/meter";
import { ZoneProvider } from "@/components/providers/zone-provider";
import {
  BARE_ROUNDED,
  countMatches,
  HAND_ROLLED_TABLE,
  RAW_PALETTE,
  read,
  TYPE_SCALE,
} from "@/__tests__/lib/theme/conformance-scan";

/**
 * `Meter` — the proportion bar that cannot be drawn without its denominator (N4).
 *
 * The two assertions that carry the component's whole reason for existing are
 * "the denominator is always rendered" and "an unknown value is never a figure". Everything else
 * here defends those two against the specific ways this codebase has already got it wrong:
 * phase 38's audit found a bar permanently at 100 % because it was fed `fraction: 1`, and D-38-16
 * lists seventeen demo figures with no honest source.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored</h3>
 *
 * 1. Made the unknown state render a `0`-width fill and emit `aria-valuenow={… ?? 0}`.
 *    → RED, 4 tests: "omits aria-valuenow entirely rather than claiming zero", "draws no fill at
 *    all", "degrades a zero denominator …", "treats a NaN value as unknown". Restored.
 * 2. Removed the `Math.min(100, Math.max(0, …))` clamp on the fill width.
 *    → RED, 2 tests: "fills the track and still reads honestly" and "clamps a negative value to
 *    an empty bar". Restored.
 * 3. Made `unavailableReason` optional in the props union. The runtime suite stayed GREEN — which
 *    is the point of asserting this at the type level — and `pnpm typecheck` went red:
 *    "meter.test.tsx(152,5): error TS2578: Unused '@ts-expect-error' directive." Restored.
 * 4. Dropped the `zone !== "operational"` guard on the fill transition.
 *    → RED: "the operational zone gets no transition, even when asked". Restored.
 */

const bar = () => screen.getByRole("progressbar");
const fill = () => document.querySelector('[data-slot="meter-fill"]');

describe("Meter — the denominator is not optional", () => {
  it("renders BOTH numbers, so the bar is never the only reading", () => {
    render(<Meter label="Tables occupied" value={8} of={14} noun="tables" />);

    const readout = document.getElementById(bar().getAttribute("aria-describedby")!)!;
    expect(readout).toHaveTextContent("8");
    expect(readout).toHaveTextContent("14");
    expect(readout.textContent).toMatch(/8\s*\/\s*of\s*14\s*tables/);
  });

  it("publishes the denominator as aria-valuemax and the value as aria-valuenow", () => {
    render(<Meter label="Shift coverage" value={11} of={14} />);

    expect(bar()).toHaveAttribute("aria-valuemin", "0");
    expect(bar()).toHaveAttribute("aria-valuemax", "14");
    expect(bar()).toHaveAttribute("aria-valuenow", "11");
    expect(bar()).toHaveAttribute("aria-valuetext", "11 of 14");
  });

  it("takes its accessible name from the visible label", () => {
    render(<Meter label="Tables occupied" value={8} of={14} />);
    expect(bar()).toHaveAccessibleName("Tables occupied");
  });

  it("keeps the label as the accessible name even when it is visually hidden", () => {
    render(<Meter label="Chicken karahi" value={8} of={14} labelHidden />);
    expect(bar()).toHaveAccessibleName("Chicken karahi");
    expect(screen.getByText("Chicken karahi")).toHaveClass("sr-only");
  });

  it("fills in proportion to the pair, not to a free-floating percentage", () => {
    render(<Meter label="Tables occupied" value={8} of={14} />);
    // 8/14 = 57.14…%, which is the demo's own 57% bar computed rather than asserted.
    expect(fill()).toHaveStyle({ width: "57.14%" });
  });

  it("reaches 100% only when the value genuinely equals the denominator", () => {
    const { rerender } = render(<Meter label="Tables occupied" value={14} of={14} />);
    expect(fill()).toHaveStyle({ width: "100%" });

    // The regression this component exists for: a bar that read 100% because it was handed a
    // hardcoded fraction. There is no fraction prop, so the only route to a full bar is a value
    // that is actually the denominator.
    rerender(<Meter label="Tables occupied" value={0} of={14} />);
    expect(fill()).toHaveStyle({ width: "0%" });
    expect(bar()).toHaveAttribute("aria-valuenow", "0");
  });

  it("does not floor a nearly-empty bar into a visible sliver", () => {
    render(<Meter label="60 days" value={1} of={1000} />);
    expect(fill()).toHaveStyle({ width: "0.1%" });
  });
});

describe("Meter — an unknown value renders as an absence, never as a figure (D-38-16)", () => {
  it("omits aria-valuenow entirely rather than claiming zero", () => {
    render(
      <Meter label="Gross margin" value={null} of={100} unavailableReason="COGS is not posted" />,
    );

    expect(bar()).not.toHaveAttribute("aria-valuenow");
    expect(bar()).toHaveAttribute("data-unknown", "true");
    expect(bar()).toHaveAttribute("aria-valuetext", "COGS is not posted");
  });

  it("draws no fill at all — an empty track reads as 'none used', which is a different claim", () => {
    render(<Meter label="Gross margin" value={null} of={100} unavailableReason="Not posted" />);
    expect(fill()).toBeNull();
  });

  it("shows an em dash and the stated reason, not a number", () => {
    render(
      <Meter label="Gross margin" value={null} of={100} unavailableReason="COGS is not posted" />,
    );

    const readout = document.getElementById(bar().getAttribute("aria-describedby")!)!;
    expect(readout).toHaveTextContent("—");
    expect(readout.textContent).not.toMatch(/\d/);
    expect(screen.getByText("COGS is not posted")).toBeInTheDocument();
  });

  it("degrades a zero denominator to the unknown state instead of dividing into a full bar", () => {
    render(<Meter label="Tables occupied" value={8} of={0} />);

    expect(bar()).toHaveAttribute("data-unknown", "true");
    expect(bar()).not.toHaveAttribute("aria-valuenow");
    expect(bar()).not.toHaveAttribute("aria-valuemax");
    expect(fill()).toBeNull();
    expect(screen.getByText("No denominator to measure against")).toBeInTheDocument();
  });

  it("degrades a negative or non-finite denominator the same way", () => {
    const { rerender } = render(<Meter label="Coverage" value={8} of={-4} />);
    expect(bar()).toHaveAttribute("data-unknown", "true");

    rerender(<Meter label="Coverage" value={8} of={Number.NaN} />);
    expect(bar()).toHaveAttribute("data-unknown", "true");

    rerender(<Meter label="Coverage" value={8} of={Number.POSITIVE_INFINITY} />);
    expect(bar()).toHaveAttribute("data-unknown", "true");
  });

  it("treats a NaN value as unknown rather than rendering NaN%", () => {
    render(<Meter label="Coverage" value={Number.NaN} of={14} />);
    expect(bar()).toHaveAttribute("data-unknown", "true");
    expect(fill()).toBeNull();
  });

  it("a null value cannot be written without a stated reason", () => {
    // Type-level, enforced by `pnpm typecheck`: the props union pairs `value: null` with a
    // required `unavailableReason`, so a silent absence is not constructible.
    // @ts-expect-error — `value: null` requires `unavailableReason`.
    const invalid = <Meter label="Gross margin" value={null} of={100} />;
    expect(invalid).toBeTruthy();
  });
});

describe("Meter — over-limit is shown, not clipped away", () => {
  it("fills the track and still reads honestly", () => {
    render(
      <Meter label="Food cost" value={32} of={30} format="percent" ofLabel="Budget" />,
    );

    expect(fill()).toHaveStyle({ width: "100%" });
    expect(bar()).toHaveAttribute("data-over", "true");
    // Clamped for ARIA's min<=now<=max rule; the true pair travels in aria-valuetext.
    expect(bar()).toHaveAttribute("aria-valuenow", "30");
    expect(bar()).toHaveAttribute("aria-valuetext", "32 of 30 percent — over");

    const readout = document.getElementById(bar().getAttribute("aria-describedby")!)!;
    expect(readout.textContent).toMatch(/32%\s*\/\s*of\s*30%/);
  });

  it("clamps a negative value to an empty bar while the readout keeps the sign", () => {
    render(<Meter label="Net margin" value={-5} of={40} format="percent" />);

    expect(fill()).toHaveStyle({ width: "0%" });
    expect(bar()).toHaveAttribute("aria-valuenow", "0");
    const readout = document.getElementById(bar().getAttribute("aria-describedby")!)!;
    expect(readout).toHaveTextContent("-5%");
  });
});

describe("Meter — colour is never the only carrier (D-38-13)", () => {
  it("a status hue always ships with its word", () => {
    render(
      <Meter
        label="Food cost"
        value={32}
        of={30}
        format="percent"
        status={{ tone: "danger", label: "Over budget" }}
      />,
    );

    expect(screen.getByText("Over budget")).toBeInTheDocument();
    expect(fill()).toHaveClass("bg-destructive");
  });

  it("maps every tone to a semantic token, never a raw palette literal", () => {
    const tones = [
      ["success", "bg-success"],
      ["warning", "bg-warning"],
      ["danger", "bg-destructive"],
      ["info", "bg-info"],
    ] as const;

    for (const [tone, expected] of tones) {
      const { unmount } = render(
        <Meter label="Coverage" value={7} of={14} status={{ tone, label: tone }} />,
      );
      expect(fill()).toHaveClass(expected);
      unmount();
    }
  });

  it("defaults to the FILL role token, not the text/link role", () => {
    // `--primary` renders bronze in light mode and is the TEXT role; `--primary-solid` is gold in
    // both themes and is what a solid fill must use.
    render(<Meter label="Tables occupied" value={8} of={14} />);
    expect(fill()).toHaveClass("bg-primary-solid");
    expect(fill()).not.toHaveClass("bg-primary");
  });
});

describe("Meter — money goes through MoneyDisplay and nowhere else", () => {
  it("renders both sides of the pair as money", () => {
    render(
      <Meter
        label="Current"
        value={482000n}
        of={670000n}
        format="money"
        ofLabel="Total payable"
      />,
    );

    const readout = document.getElementById(bar().getAttribute("aria-describedby")!)!;
    expect(readout.textContent).toMatch(/4,820\.00/);
    expect(readout.textContent).toMatch(/6,700\.00/);
  });

  it("omits aria-valuetext in money mode rather than growing a second formatter", () => {
    render(<Meter label="Current" value={482000n} of={670000n} format="money" />);

    expect(bar()).not.toHaveAttribute("aria-valuetext");
    // The accessible alternative is still there: it points at the visible, MoneyDisplay-rendered
    // readout, so AT reads exactly the string on screen.
    expect(bar()).toHaveAttribute("aria-describedby");
    expect(bar()).toHaveAttribute("aria-valuemax", "670000");
  });

  it("names the denominator in the caption when asked", () => {
    render(<Meter label="Food cost" value={28.4} of={30} format="percent" ofLabel="Budget" />);
    expect(document.querySelector('[data-slot="meter-caption"]')).toHaveTextContent("Budget: 30%");
  });
});

describe("Meter — zone safety (D-38-04)", () => {
  const renderInZone = (zone: "expressive" | "restrained" | "operational", animate: boolean) =>
    render(
      <ZoneProvider zone={zone}>
        <Meter label="Tables occupied" value={8} of={14} animateFill={animate} />
      </ZoneProvider>,
    );

  it("is still by default on every zone", () => {
    for (const zone of ["expressive", "restrained", "operational"] as const) {
      const { unmount } = renderInZone(zone, false);
      expect(fill()!.className).not.toMatch(/transition-/);
      unmount();
    }
  });

  it("the operational zone gets no transition, even when asked", () => {
    renderInZone("operational", true);
    expect(fill()!.className).not.toMatch(/transition-/);
  });

  it("back-office zones may opt in to the filling transition", () => {
    for (const zone of ["expressive", "restrained"] as const) {
      const { unmount } = renderInZone(zone, true);
      expect(fill()).toHaveClass("transition-[width]");
      // Inside phase 20's 240ms ceiling, expressed as the state-transition token rather than a
      // number — the demo's own 0.8s width transition is NOT adopted.
      expect(fill()).toHaveClass("duration-(--motion-state)");
      unmount();
    }
  });

  it("carries no glass, no transform and no entrance animation in any zone", () => {
    renderInZone("operational", true);
    const root = document.querySelector('[data-slot="meter"]')!;
    expect(root.outerHTML).not.toMatch(/backdrop-blur|vdl-enter|vdl-reveal|animate-/);
  });
});

describe("Meter — accessibility shape", () => {
  it("is a real progressbar, not a div with a width", () => {
    render(<Meter label="Tables occupied" value={8} of={14} />);
    expect(bar().tagName).toBe("DIV");
    expect(bar()).toHaveAttribute("role", "progressbar");
  });

  it("takes no input, so it takes no place in the tab order", () => {
    render(<Meter label="Tables occupied" value={8} of={14} />);
    expect(bar()).not.toHaveAttribute("tabindex");
    const root = document.querySelector('[data-slot="meter"]')!;
    expect(within(root as HTMLElement).queryAllByRole("button")).toHaveLength(0);
    expect(within(root as HTMLElement).queryAllByRole("link")).toHaveLength(0);
  });

  it("gives each instance its own ids, so two meters on a page do not collide", () => {
    render(
      <>
        <Meter label="Tables occupied" value={8} of={14} />
        <Meter label="Shift coverage" value={11} of={14} />
      </>,
    );

    const bars = screen.getAllByRole("progressbar");
    const [first, second] = bars as [HTMLElement, HTMLElement];
    expect(first.getAttribute("aria-labelledby")).not.toBe(second.getAttribute("aria-labelledby"));
    expect(first).toHaveAccessibleName("Tables occupied");
    expect(second).toHaveAccessibleName("Shift coverage");
  });
});

describe("Meter — born on-contract (G1–G4, UI-SPEC §11.1)", () => {
  // The gate suite already asserts this product-wide. Asserting it here too means the failure
  // names THIS component when someone edits it, rather than surfacing as an anonymous new
  // offender in a suite nobody associates with this file.
  const source = read("components/ui/meter.tsx");

  it.each([
    ["G1 type scale", TYPE_SCALE],
    ["G2 bare rounded", BARE_ROUNDED],
    ["G3 raw palette literals", RAW_PALETTE],
    ["G4 hand-rolled <table>", HAND_ROLLED_TABLE],
  ])("scores zero on %s", (_name, pattern) => {
    expect(countMatches(source, pattern)).toBe(0);
  });
});
