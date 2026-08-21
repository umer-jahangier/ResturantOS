import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { DashboardTileGrid } from "@/components/reporting/DashboardTileGrid";
import { OrderTypeMix, toOrderTypeSlices } from "@/components/reporting/OrderTypeMix";
import { ReportDataNotes } from "@/components/reporting/ReportDataNotes";
import { ReportTable } from "@/components/reporting/ReportTable";
import type { DashboardTile, ReportResult } from "@/lib/models/reporting.model";

/**
 * D-38-16 on the reporting surfaces: a figure this system cannot compute is rendered as a stated
 * ABSENCE — never as a number, never as a zero — and a caveat the API sends is rendered, not
 * swallowed and not invented.
 */

function result(partial: Partial<ReportResult>): ReportResult {
  return {
    code: "sales-by-item",
    title: "Sales by Item",
    columns: ["item_name", "qty", "revenue_inc_tax_paisa", "cogs_paisa", "gross_margin_paisa"],
    rows: [],
    rowCount: 0,
    durationMs: 12,
    dataNotes: [],
    ...partial,
  };
}

function tile(partial: Partial<DashboardTile>): DashboardTile {
  return {
    tileId: "todays-revenue",
    title: "Today's Revenue",
    valuePaisa: 535_000,
    valueNumber: null,
    unit: "PKR",
    businessDate: "2026-07-18",
    computedAt: "2026-07-18T09:15:30.123Z",
    ...partial,
  };
}

describe("ReportDataNotes — the caveat the API sent, and only that", () => {
  it("renders every note the server attached", () => {
    render(<ReportDataNotes notes={["COGS is not yet available.", "Tax is estimated."]} />);
    const block = screen.getByTestId("report-data-notes");
    expect(within(block).getByText("COGS is not yet available.")).toBeInTheDocument();
    expect(within(block).getByText("Tax is estimated.")).toBeInTheDocument();
  });

  it("renders nothing at all when there is no caveat — no empty advisory furniture", () => {
    render(<ReportDataNotes notes={[]} />);
    expect(screen.queryByTestId("report-data-notes")).not.toBeInTheDocument();
  });

  it("is not an assertive live region — a standing caveat is not an interruption", () => {
    render(<ReportDataNotes notes={["COGS is not yet available."]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ReportTable — the note is surfaced, and never manufactured", () => {
  it("shows the server's note above the grid", () => {
    render(
      <ReportTable
        isLoading={false}
        result={result({
          rows: [
            {
              item_name: "Chicken Karahi",
              qty: 30,
              revenue_inc_tax_paisa: 150_000,
              cogs_paisa: null,
              gross_margin_paisa: null,
            },
          ],
          rowCount: 1,
          dataNotes: ["Margin needs Inventory and is not yet available."],
        })}
      />,
    );
    expect(screen.getByTestId("report-data-notes")).toHaveTextContent(
      "Margin needs Inventory and is not yet available.",
    );
  });

  /**
   * The regression this whole component was rewritten for. The previous implementation, on
   * seeing a `cogs_paisa` column with no accompanying `dataNotes`, supplied its own sentence —
   * a frontend copy of a string the backend owns and is currently revising, and a claim about
   * WHY the column is null that the UI is in no position to make.
   */
  it("does NOT invent a caveat for a null column the server said nothing about", () => {
    render(
      <ReportTable
        isLoading={false}
        result={result({
          rows: [
            {
              item_name: "Seekh Kebab",
              qty: 18,
              revenue_inc_tax_paisa: 72_000,
              cogs_paisa: null,
              gross_margin_paisa: null,
            },
          ],
          rowCount: 1,
          dataNotes: [],
        })}
      />,
    );
    expect(screen.queryByTestId("report-data-notes")).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 8/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/require Inventory/i)).not.toBeInTheDocument();
  });

  it("renders a null money cell as a NAMED absence and never as zero", () => {
    render(
      <ReportTable
        isLoading={false}
        result={result({
          rows: [
            {
              item_name: "Seekh Kebab",
              qty: 18,
              revenue_inc_tax_paisa: 72_000,
              cogs_paisa: null,
              gross_margin_paisa: null,
            },
          ],
          rowCount: 1,
        })}
      />,
    );
    const grid = screen.getByRole("table", { name: "Sales by Item" });
    expect(within(grid).getByLabelText("Cogs Paisa not available")).toHaveTextContent("—");
    expect(within(grid).getByLabelText("Gross Margin Paisa not available")).toBeInTheDocument();
    expect(within(grid).queryByText("Rs 0.00")).not.toBeInTheDocument();
  });

  it("routes money through MoneyDisplay and groups counts through the pinned formatter", () => {
    render(
      <ReportTable
        isLoading={false}
        result={result({
          columns: ["item_name", "qty", "revenue_inc_tax_paisa"],
          rows: [{ item_name: "Chicken Karahi", qty: 1234, revenue_inc_tax_paisa: 150_000 }],
          rowCount: 1,
        })}
      />,
    );
    const grid = screen.getByRole("table", { name: "Sales by Item" });
    expect(within(grid).getByText("Rs 1,500.00")).toBeInTheDocument();
    expect(within(grid).getByText("1,234")).toBeInTheDocument();
  });
});

describe("OrderTypeMix — a share of a real denominator", () => {
  const slices = toOrderTypeSlices([
    { order_type: "DINE_IN", order_count: 96, revenue_paisa: 348_000 },
    { order_type: "TAKEAWAY", order_count: 41, revenue_paisa: 132_000 },
    { order_type: "DELIVERY", order_count: 31, revenue_paisa: 118_000 },
  ])!;

  it("measures each type against the period's own total, spelled out on both sides", () => {
    render(<OrderTypeMix slices={slices} />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(3);
    // 348,000 + 132,000 + 118,000 = 598,000 paisa = Rs 5,980.00.
    expect(bars[0]).toHaveAttribute("aria-valuemax", "598000");
    expect(bars[0]).toHaveAttribute("aria-valuenow", "348000");
  });

  it("prints the order type exactly as the wire spells it, so it matches the grid below", () => {
    render(<OrderTypeMix slices={slices} />);
    expect(screen.getByText("DINE_IN")).toBeInTheDocument();
    expect(screen.queryByText("Dine in")).not.toBeInTheDocument();
  });

  it("reconciles its own footer with the rows it drew", () => {
    render(<OrderTypeMix slices={slices} />);
    expect(screen.getByText("3 order types · 168 orders in total")).toBeInTheDocument();
  });

  it("degrades a type with no revenue figure to a stated absence, not a 0% bar", () => {
    const withGap = toOrderTypeSlices([
      { order_type: "DINE_IN", order_count: 96, revenue_paisa: 348_000 },
      { order_type: "CATERING", order_count: 2, revenue_paisa: null },
    ])!;
    render(<OrderTypeMix slices={withGap} />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars[1]).not.toHaveAttribute("aria-valuenow");
    expect(bars[1]).toHaveAttribute("aria-valuetext", "This order type reported no revenue figure");
  });

  it("returns null rather than an empty panel when no row carries an order type", () => {
    expect(toOrderTypeSlices([{ revenue_paisa: 1 }])).toBeNull();
  });
});

describe("DashboardTileGrid — a tile that is not applicable says so", () => {
  it("renders an absence with a reason, not a bare dash and not a zero", () => {
    render(
      <DashboardTileGrid
        isLoading={false}
        tiles={[
          tile({
            tileId: "average-order-value",
            title: "Average Order Value",
            valuePaisa: null,
            valueNumber: null,
          }),
        ]}
      />,
    );
    const stat = screen.getByLabelText("Average Order Value");
    expect(stat).toHaveAttribute("data-unavailable", "true");
    expect(within(stat).getByText("Not applicable for today's figures")).toBeInTheDocument();
    expect(within(stat).queryByText("Rs 0.00")).not.toBeInTheDocument();
    expect(within(stat).queryByText("0")).not.toBeInTheDocument();
  });

  it("renders money through MoneyDisplay and a count through the pinned formatter", () => {
    render(
      <DashboardTileGrid
        isLoading={false}
        tiles={[
          tile({}),
          tile({
            tileId: "todays-orders",
            title: "Today's Orders",
            valuePaisa: null,
            valueNumber: 1234,
          }),
        ]}
      />,
    );
    expect(
      within(screen.getByLabelText("Today's Revenue")).getByText("Rs 5,350.00"),
    ).toBeInTheDocument();
    expect(within(screen.getByLabelText("Today's Orders")).getByText("1,234")).toBeInTheDocument();
  });

  it("states freshness once, from the OLDEST tile, so a stale one cannot hide behind fresh ones", async () => {
    const now = Date.now();
    render(
      <DashboardTileGrid
        isLoading={false}
        tiles={[
          tile({
            tileId: "fresh",
            title: "Fresh",
            computedAt: new Date(now - 30_000).toISOString(),
          }),
          tile({
            tileId: "stale",
            title: "Stale",
            computedAt: new Date(now - 3 * 60 * 60_000).toISOString(),
          }),
        ]}
      />,
    );
    // Asynchronous on purpose: the clock is state written by a timer, never read during render
    // (`react-hooks/purity`), so the line is absent until the first tick — which is also what
    // keeps the prerender and the hydration in agreement.
    const freshness = await screen.findByTestId("dashboard-tiles-freshness");
    expect(freshness).toHaveTextContent("Computed 3h ago.");
    expect(screen.getAllByTestId("dashboard-tiles-freshness")).toHaveLength(1);
  });

  it("says the board is empty rather than leaving a blank where tiles would be", () => {
    render(<DashboardTileGrid isLoading={false} tiles={[]} />);
    expect(screen.getByText("No tiles yet")).toBeInTheDocument();
  });
});
