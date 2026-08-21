import { render, screen } from "@testing-library/react";
import { Wallet } from "lucide-react";
import { describe, expect, it } from "vitest";

import { MoneyDisplay } from "@/components/ui/money-display";
import { StatTile } from "@/components/ui/stat-tile";

/**
 * `StatTile` (N1) — the demo's `.kpi-card` as a primitive back-office screens can actually use.
 *
 * What these tests defend is not layout. It is the four things the demo gets wrong and the one
 * thing this product has already shipped wrong twice:
 *
 *   · polarity is COMPUTED from the metric, so `−1.2%` cannot read as bad news on the food-cost
 *     screen and good news on the waste screen (the demo does exactly that at `:667` vs `:788`);
 *   · a figure with no honest source renders as an ABSENCE with a stated reason (D-38-16), and
 *     its delta is suppressed rather than computed against nothing;
 *   · sentiment is carried by a WORD as well as a hue (D-38-13), because teal sits ΔE2000 18.68
 *     from success and this tile can show both at once;
 *   · the drill link is optional, and when it is absent there is no link in the accessibility
 *     tree at all — the reason `KpiTile` could not be reused.
 *
 * Class assertions are used where the contract IS the class (`glass-surface` outside the
 * expressive zone, `text-success` vs `text-destructive`), because jsdom computes no cascade and
 * the alternative is asserting nothing about the zone contract at all.
 */

function tile(): HTMLElement {
  const el = document.querySelector('[data-slot="stat-tile"]');
  if (!el) throw new Error("no stat tile rendered");
  return el as HTMLElement;
}

function part(slot: string): HTMLElement | null {
  return document.querySelector(`[data-slot="stat-tile-${slot}"]`) as HTMLElement | null;
}

describe("StatTile — the figure itself", () => {
  it("renders the label and the value", () => {
    render(<StatTile label="Today's revenue" value="4,218" />);

    expect(screen.getByText("Today's revenue")).toBeInTheDocument();
    expect(part("value")).toHaveTextContent("4,218");
  });

  it("accepts a ReactNode value so money arrives already rendered by MoneyDisplay", () => {
    // The tile must never format money itself: paisa is BIGINT and `formatPaisa` is pinned
    // against the JVM renderer by a shared vector file (37-01). 421_800 paisa is Rs 4,218.00 —
    // if the tile ever "helpfully" divided or rounded, this reads 100x wrong, which is the
    // journal-screen defect this project has already paid for once.
    render(<StatTile label="Today's revenue" value={<MoneyDisplay paisa={421_800n} />} />);

    expect(part("value")).toHaveTextContent("4,218.00");
  });

  it("names the tile for screen readers without needing a client-side generated id", () => {
    render(<StatTile label="Covers today" value="182" />);

    expect(screen.getByRole("article", { name: "Covers today" })).toBeInTheDocument();
  });
});

describe("StatTile — delta polarity is computed, never hand-picked", () => {
  it("omitting deltaPct renders no delta row (8 of the demo's 24 cards carry none)", () => {
    render(<StatTile label="Open POs" value="14" />);

    expect(part("delta")).toBeNull();
  });

  it("a rise on a higher-is-better metric is 'better', in green, with an up arrow", () => {
    render(<StatTile label="Today's revenue" value="4,218" deltaPct={12.4} />);

    const delta = part("delta")!;
    expect(delta).toHaveTextContent("+12.4% better");
    expect(delta.dataset.sentiment).toBe("better");
    expect(delta.className).toContain("text-success");
  });

  it("a FALL on an inverted metric is 'better' — the demo's Food Cost bug, fixed", () => {
    // Demo `:667` renders Food Cost −1.2% with `.down` (red) while `:788` renders Waste −32%
    // with `.up` (green). Same arithmetic, opposite verdict, because a human chose the class.
    render(<StatTile label="Food cost %" value="28.4%" deltaPct={-1.2} higherIsBetter={false} />);

    const delta = part("delta")!;
    expect(delta).toHaveTextContent("-1.2% better");
    expect(delta.dataset.sentiment).toBe("better");
    expect(delta.className).toContain("text-success");
    expect(delta.className).not.toContain("text-destructive");
  });

  it("a RISE on an inverted metric is 'worse', in the destructive hue", () => {
    render(<StatTile label="Food cost %" value="31.1%" deltaPct={2.7} higherIsBetter={false} />);

    const delta = part("delta")!;
    expect(delta).toHaveTextContent("+2.7% worse");
    expect(delta.dataset.sentiment).toBe("worse");
    expect(delta.className).toContain("text-destructive");
  });

  it("a fall on a higher-is-better metric is 'worse'", () => {
    render(<StatTile label="Covers" value="140" deltaPct={-8} />);

    expect(part("delta")).toHaveTextContent("-8.0% worse");
    expect(part("delta")!.dataset.sentiment).toBe("worse");
  });

  it("a measured zero is 'No change' and takes neither the good nor the bad hue", () => {
    render(<StatTile label="Covers" value="140" deltaPct={0} />);

    const delta = part("delta")!;
    expect(delta).toHaveTextContent("No change");
    expect(delta.dataset.sentiment).toBe("flat");
    expect(delta.className).not.toContain("text-success");
    expect(delta.className).not.toContain("text-destructive");
  });

  it("null means no comparable prior period, and is NOT rendered as 0%", () => {
    // "0%" here is an assertion about the business — that it was flat — made by a UI that only
    // knows it has nothing to compare against.
    render(<StatTile label="Covers" value="140" deltaPct={null} />);

    const delta = part("delta")!;
    expect(delta).toHaveTextContent("No comparable prior period");
    expect(delta.textContent).not.toContain("0.0%");
    expect(delta.dataset.sentiment).toBe("unknown");
  });

  it("states sentiment as a WORD, so hue is never the only channel (D-38-13)", () => {
    // Teal(182) sits DeltaE2000 18.68 from --success-600, the closest pair in the semantic set,
    // and this tile can render both at once. Strip the colour and the meaning must survive.
    render(
      <StatTile label="Waste" value="3.1%" deltaPct={-32} higherIsBetter={false} accent="secondary" />,
    );

    expect(part("delta")!.textContent).toContain("better");
  });

  it("renders the comparison basis in the demo's own words when given", () => {
    render(<StatTile label="Today's revenue" value="4,218" deltaPct={12.4} comparisonLabel="vs last Mon" />);

    expect(screen.getByText("vs last Mon")).toBeInTheDocument();
  });

  it("will not compile when a polarity is declared with no delta to apply it to", () => {
    // The state this refuses is the one the product actually shipped: NINE call sites passed
    // `higherIsBetter={false}` and none of them passed a delta, so nine screens declared a
    // polarity that `showDelta` could never reach. A prop with no effect reads to the next author
    // as evidence the tile is doing something with it, and the natural "fix" for a polarity that
    // never appears is to invent the prior period that would make it appear (D-38-16).
    // @ts-expect-error — `higherIsBetter` requires the `deltaPct` it describes.
    const inertPolarity = <StatTile label="Out of stock" value="3" higherIsBetter={false} />;
    expect(inertPolarity).toBeTruthy();
  });

  it("will not compile when a comparison basis is declared with nothing to compare", () => {
    // `comparisonLabel` renders INSIDE the delta row. With no delta there is no row, so "vs last
    // week" would name a comparison this tile is not making.
    // @ts-expect-error — `comparisonLabel` requires the `deltaPct` it qualifies.
    const inertBasis = <StatTile label="Out of stock" value="3" comparisonLabel="vs last week" />;
    expect(inertBasis).toBeTruthy();
  });

  it("accepts a polarity beside a null delta — 'no comparable prior period' is still a comparison", () => {
    // The union must not be so tight that it refuses the honest absence: `null` means there IS a
    // comparison to make and no period to make it against, which is a different statement from
    // omitting the delta entirely, and the caller still knows which direction would be good news.
    render(<StatTile label="Waste" value="3.1%" deltaPct={null} higherIsBetter={false} />);

    expect(part("delta")).toHaveTextContent("No comparable prior period");
  });
});

describe("StatTile — an uncomputable figure is an absence, not a number (D-38-16)", () => {
  // These three used to pass BOTH `value` and `unavailableReason`, asserting that the reason won
  // at runtime. Since D-38-20 that pair does not typecheck: `StatTileProps` is a discriminated
  // union, so a tile either has a figure or states why it has none. The runtime assertion has
  // been promoted to a compile-time one, which is strictly stronger — a caller can no longer
  // reach the "both" state to be saved from it.
  it("renders the stated reason instead of a value", () => {
    render(
      <StatTile
        label="Food cost %"
        unavailableReason="No aggregate food-cost source — only a per-recipe preview exists"
      />,
    );

    expect(part("unavailable")).toHaveTextContent("No aggregate food-cost source");
    expect(part("value")).not.toHaveTextContent("28.4%");
    expect(tile().dataset.unavailable).toBe("true");
  });

  it("will not compile when a figure and a reason are both supplied", () => {
    // @ts-expect-error — supplying `value` alongside `unavailableReason` is the exact shape that
    // let a fabricated number render where data was missing. If this line ever stops erroring,
    // the union has been widened and D-38-16 is enforced by convention again, not by the compiler.
    const bothAtOnce = <StatTile label="Net margin" value="12%" unavailableReason="cogs_paisa is NULL" />;
    expect(bothAtOnce).toBeTruthy();
  });

  it("hides the bare em dash from screen readers, which hear the reason instead", () => {
    render(<StatTile label="Net margin" unavailableReason="cogs_paisa is NULL" />);

    expect(part("value")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("article", { name: "Net margin" })).toHaveTextContent(
      "cogs_paisa is NULL",
    );
  });

  it("suppresses the delta even when one was passed — no percentage change against nothing", () => {
    render(
      <StatTile label="Net income (MTD)" deltaPct={9.3} unavailableReason="cogs_paisa is NULL" />,
    );

    expect(part("delta")).toBeNull();
  });
});

describe("StatTile — the drill link is optional and does not define the card", () => {
  it("renders NO link when there is nowhere to drill to", () => {
    // The whole reason this primitive exists: `PortletShell` wraps every card in a <Link>, so a
    // back-office stat with no destination could not use `KpiTile` without inventing one.
    render(<StatTile label="Open POs" value="14" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders exactly one keyboard-reachable link, named by drillLabel, when given a destination", () => {
    render(
      <StatTile
        label="Open POs"
        value="14"
        drillTo="/app/purchasing/purchase-orders"
        drillLabel="Open the purchase order list"
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/app/purchasing/purchase-orders");
    expect(links[0]).toHaveAccessibleName("Open the purchase order list");
  });

  it("stretches that one link over the card rather than adding a second click target", () => {
    render(<StatTile label="Open POs" value="14" drillTo="/x" drillLabel="Open POs list" />);

    expect(part("drill")!.className).toContain("after:inset-0");
    expect(tile().className).toContain("relative");
  });
});

describe("StatTile — zone safety (D-38-04) and the accent channel", () => {
  it("is operational-safe by DEFAULT: no glass, no lift, no entrance animation", () => {
    render(<StatTile label="Covers" value="182" />);

    const className = tile().className;
    expect(className).not.toContain("glass-surface");
    expect(className).not.toContain("vdl-lift");
    expect(className).not.toContain("vdl-enter");
    expect(className).not.toContain("vdl-tilt");
    expect(className).toContain("shadow-depth-1");
  });

  it("richness is opt-in, via classes the cascade gates to the expressive zone", () => {
    render(<StatTile label="Covers" value="182" surface="glass" />);

    expect(tile().className).toContain("glass-surface");
    expect(tile().className).toContain("vdl-lift");
  });

  it("draws no accent rail by default — the hue is opt-in, exactly as in the demo", () => {
    render(<StatTile label="Covers" value="182" />);

    expect(part("rail")).toBeNull();
    expect(tile().dataset.accent).toBe("none");
  });

  it("paints the primary rail from the FILL role, not the text role", () => {
    // `--primary` renders bronze in light mode; `--primary-solid` is gold in both (D-38-18).
    render(<StatTile label="Today's revenue" value="4,218" accent="primary" />);

    expect(part("rail")!.className).toContain("from-primary-solid");
    expect(part("rail")).toHaveAttribute("aria-hidden", "true");
  });

  it("spells the teal accent `secondary`, never `teal`", () => {
    render(<StatTile label="Covers" value="182" accent="secondary" icon={Wallet} />);

    const markup = `${part("rail")!.className} ${part("icon")!.className}`;
    expect(markup).toContain("secondary-400");
    expect(markup).not.toContain("teal");
  });

  it("hides the icon from screen readers — the label already names the metric", () => {
    render(<StatTile label="Today's revenue" value="4,218" icon={Wallet} />);

    expect(part("icon")!.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("changes padding with density but keeps the value at the display role", () => {
    const { unmount } = render(<StatTile label="Covers" value="182" density="compact" />);
    expect(tile().className).toContain("p-(--space-sm)");
    expect(part("value")!.className).toContain("text-display");
    unmount();

    render(<StatTile label="Covers" value="182" />);
    expect(tile().className).toContain("p-(--space-md)");
    expect(part("value")!.className).toContain("text-display");
  });
});
