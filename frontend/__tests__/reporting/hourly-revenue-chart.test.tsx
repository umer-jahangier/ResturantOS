import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import {
  findPeaks,
  HourlyRevenueChart,
  toHourlySeries,
  type HourlyRevenuePoint,
} from "@/components/reporting/HourlyRevenueChart";

/**
 * `sales-by-hour`, drawn — the report `ReportCatalog.java:116-128` has computed since phase 12
 * and nothing in the product has ever visualised.
 *
 * The assertions are on what a reader can GET OUT of the chart, in the three channels it offers:
 * the sentence, the visible peak readout, and the text alternative. Nothing here asserts on
 * geometry for its own sake — a `<rect>` at x=214 is not a fact anybody consumes — except where
 * geometry IS the contract (the picture is `aria-hidden`; no money is drawn inside the SVG).
 */

const point = (hour: number, revenuePaisa: number, orderCount: number): HourlyRevenuePoint => ({
  hour,
  revenuePaisa,
  orderCount,
  observed: true,
});

describe("toHourlySeries — an hour with no row is a real zero, and it is filled in", () => {
  it("fills the gap between observed hours rather than closing it up", () => {
    // 15:00 is missing, exactly as ClickHouse returns it: `GROUP BY toHour(closed_at)` with no
    // HAVING emits no row for an hour in which nothing closed.
    const series = toHourlySeries([
      { hour_of_day: 13, order_count: 19, revenue_paisa: 64_000 },
      { hour_of_day: 16, order_count: 9, revenue_paisa: 32_000 },
    ]);

    expect(series?.map((p) => p.hour)).toEqual([13, 14, 15, 16]);
    expect(series?.map((p) => p.revenuePaisa)).toEqual([64_000, 0, 0, 32_000]);
    // The filled hours are FLAGGED, so the caption can say so instead of the chart implying
    // that a quiet hour was measured the same way a busy one was.
    expect(series?.map((p) => p.observed)).toEqual([true, false, false, true]);
  });

  it("spans only the observed hours — never a forced 00:00 to 23:00", () => {
    const series = toHourlySeries([
      { hour_of_day: 18, order_count: 22, revenue_paisa: 82_000 },
      { hour_of_day: 19, order_count: 27, revenue_paisa: 96_000 },
    ]);
    expect(series?.map((p) => p.hour)).toEqual([18, 19]);
  });

  it("returns null — not an empty chart — when no row carries a usable hour bucket", () => {
    expect(toHourlySeries([])).toBeNull();
    expect(toHourlySeries([{ hour_of_day: "lunchtime", revenue_paisa: 1 }])).toBeNull();
    expect(toHourlySeries([{ hour_of_day: 24, revenue_paisa: 1 }])).toBeNull();
  });

  it("a missing revenue on an observed hour is zero for the BAR, and the hour still counts", () => {
    const series = toHourlySeries([{ hour_of_day: 11, order_count: 3 }]);
    expect(series).toEqual([{ hour: 11, revenuePaisa: 0, orderCount: 3, observed: true }]);
  });
});

describe("findPeaks — the rota signal, computed and never asserted", () => {
  it("finds the demo's double peak in the app's own report shape", () => {
    // DEMO-STATS L243's curve, in paisa, with 15:00 absent.
    const series = toHourlySeries([
      { hour_of_day: 10, order_count: 4, revenue_paisa: 12_000 },
      { hour_of_day: 11, order_count: 7, revenue_paisa: 24_000 },
      { hour_of_day: 12, order_count: 16, revenue_paisa: 58_000 },
      { hour_of_day: 13, order_count: 19, revenue_paisa: 64_000 },
      { hour_of_day: 14, order_count: 12, revenue_paisa: 42_000 },
      { hour_of_day: 16, order_count: 9, revenue_paisa: 32_000 },
      { hour_of_day: 17, order_count: 13, revenue_paisa: 48_000 },
      { hour_of_day: 18, order_count: 22, revenue_paisa: 82_000 },
      { hour_of_day: 19, order_count: 27, revenue_paisa: 96_000 },
      { hour_of_day: 20, order_count: 24, revenue_paisa: 84_000 },
      { hour_of_day: 21, order_count: 15, revenue_paisa: 56_000 },
    ])!;
    expect(findPeaks(series).map((i) => series[i]!.hour)).toEqual([13, 19]);
  });

  it("names ONE peak when the second candidate is a quiet hour, not a service", () => {
    // 11:00 is a local maximum but is worth a tenth of 19:00. Labelling it would invent a shift.
    const series = [
      point(10, 2_000, 1),
      point(11, 9_000, 3),
      point(12, 1_000, 1),
      point(13, 96_000, 27),
    ];
    expect(findPeaks(series).map((i) => series[i]!.hour)).toEqual([13]);
  });

  it("does not call the shoulder of one rush a second peak", () => {
    const series = [point(18, 80_000, 20), point(19, 96_000, 27), point(20, 90_000, 24)];
    expect(findPeaks(series).map((i) => series[i]!.hour)).toEqual([19]);
  });

  it("finds nothing when nothing took money — and does not fabricate a busiest hour", () => {
    expect(findPeaks([point(10, 0, 0), point(11, 0, 0)])).toEqual([]);
  });
});

describe("HourlyRevenueChart — three channels, and the picture is not one of them", () => {
  const series = toHourlySeries([
    { hour_of_day: 12, order_count: 16, revenue_paisa: 58_000 },
    { hour_of_day: 13, order_count: 19, revenue_paisa: 64_000 },
    { hour_of_day: 14, order_count: 12, revenue_paisa: 42_000 },
    { hour_of_day: 16, order_count: 9, revenue_paisa: 32_000 },
    { hour_of_day: 17, order_count: 13, revenue_paisa: 48_000 },
    { hour_of_day: 18, order_count: 22, revenue_paisa: 82_000 },
    { hour_of_day: 19, order_count: 27, revenue_paisa: 96_000 },
    { hour_of_day: 20, order_count: 24, revenue_paisa: 84_000 },
  ])!;

  it("states the peaks as a sentence, in words a rota can be built from", () => {
    render(<HourlyRevenueChart series={series} />);
    expect(screen.getByText("Two peaks — 13:00 and 19:00.")).toBeInTheDocument();
  });

  it("declares the filled hours instead of letting a drawn zero pass as a measurement", () => {
    render(<HourlyRevenueChart series={series} />);
    expect(
      screen.getByText(/1 hour in that span closed no orders and are drawn at zero/),
    ).toBeInTheDocument();
  });

  it("says 'busiest at' — not 'two peaks' — when only one peak was found", () => {
    render(<HourlyRevenueChart series={[point(18, 10_000, 2), point(19, 96_000, 27)]} />);
    expect(screen.getByText("Busiest at 19:00.")).toBeInTheDocument();
    expect(screen.queryByText(/Two peaks/)).not.toBeInTheDocument();
  });

  it("hides the SVG from assistive technology and carries every hour as text instead", () => {
    const { container } = render(<HourlyRevenueChart series={series} />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    const list = container.querySelector("ul.sr-only")!;
    // Eight hours came back; the span 12:00–20:00 is nine, because 15:00 is filled in. Nine
    // sentences out — the gap included and labelled as a gap rather than silently skipped.
    expect(within(list as HTMLElement).getAllByRole("listitem")).toHaveLength(9);
    expect(list.textContent).toContain("15:00");
    expect(list.textContent).toContain("(no orders closed in this hour)");
    expect(list.textContent).toContain("19:00");
  });

  it("renders every rupee figure through MoneyDisplay, and none of them inside the SVG", () => {
    const { container } = render(<HourlyRevenueChart series={series} />);
    const svg = container.querySelector("svg")!;
    // A `<text>` in an SVG cannot host MoneyDisplay's `<span>`, so a money label inside the
    // picture could only be a second, unpinned rupee formatter. There is none.
    expect(svg.textContent).not.toMatch(/Rs/);
    // Peak values are stated outside it, where the pinned formatter can do the writing.
    const peaks = screen.getByTestId("hourly-revenue-peaks");
    expect(peaks.textContent).toContain("Rs 960.00");
    expect(peaks.textContent).toContain("Rs 640.00");
  });

  it("survives an all-zero period without dividing by zero or claiming a busiest hour", () => {
    render(<HourlyRevenueChart series={[point(10, 0, 0), point(11, 0, 0)]} />);
    expect(screen.getByText("No hour in this period took any revenue.")).toBeInTheDocument();
    expect(screen.getByTestId("hourly-revenue-peaks").textContent).toBe("");
  });
});
