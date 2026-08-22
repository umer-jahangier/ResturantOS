"use client";

import { useMemo } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PortletGrid, type PortletModels } from "@/components/dashboard/portlets/portlet-renderer";
import type { TrendSeries } from "@/components/dashboard/portlets/trend-chart";
import { DASHBOARD_PRESETS, type OwnerPortlets } from "@/components/dashboard/presets";
import { MoneyDisplay } from "@/components/ui/money-display";
import { formatPaisa } from "@/lib/adapters/shared";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { useOrderSummaries } from "@/lib/hooks/pos/use-orders";
import { useRunReport } from "@/lib/hooks/reporting/use-reports";
import type { ReportRow } from "@/lib/models/reporting.model";

const PRESET = DASHBOARD_PRESETS.owner;
const WINDOW_DAYS = 30;

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

function num(row: ReportRow, column: string): number {
  const value = row[column];
  return typeof value === "number" ? value : 0;
}

/** `business_date` arrives as a full ISO instant; the axis wants "07 Aug". */
function shortDate(value: unknown): string {
  return formatDateTime(String(value ?? ""), { day: "2-digit", month: "short" });
}

function pctChange(current: number, prior: number): number | null {
  // No prior period is NOT a 0% change. A brand-new branch has not been flat.
  if (prior <= 0) return null;
  return ((current - prior) / prior) * 100;
}

/**
 * OWNER dashboard — "is the business healthy?" (UI-SPEC §7.3).
 *
 * <h3>What an owner sees first, and why it is not what a manager sees first</h3>
 *
 * Money and margin, over a period, against the period before it. An owner cannot act on
 * "three tickets are late" — by the time they read it, the tickets are served — so late
 * tickets are not on this page at all. The manager's page opens with them.
 *
 * <h3>The margin tile renders a dash, on purpose — but no longer a HARDCODED one</h3>
 *
 * `sales-by-item` returns `cogs_paisa: null` and `gross_margin_paisa: null` — a Phase-8
 * deferral that the report declares in its own `dataNotes`, and that `reporting.schema.ts`
 * types as nullable specifically so it can never be silently defaulted to 0. So this tile
 * says **"—", with the reason**, rather than computing a margin from a null cost and
 * printing 100%.
 *
 * <p>That is not a missing feature politely excused. A dashboard that reports 100% gross margin
 * to an owner is worse than one that reports nothing: the first is a number they will act on.
 * This codebase has already shipped the two adjacent failures — a "Closed sales: Rs 0.00"
 * that was a query bug rather than a quiet day, and a journal detail that rendered raw paisa
 * so every total read 100× too large. Both are the UI stating what it does not know.
 *
 * <p><b>Phase 38 changed HOW the refusal is expressed.</b> It used to be `value="—"` passed
 * alongside a conditional `unavailableReason` — so on any render where the reason came back
 * undefined, the literal dash was the tile's live VALUE. That is the same class of defect one
 * step quieter: a placeholder masquerading as data. `KpiTileProps` is now a discriminated union
 * (`portlets/portlet.tsx`) and cannot express "a value AND a reason", so the margin is computed
 * from the non-null rows when there are any and refused with a stated reason when there are not.
 * The day reporting starts posting `gross_margin_paisa`, this tile turns on by itself.
 *
 * <h3>Every figure on this page names its source</h3>
 *
 * Net sales, order count and the trend come from `sales-by-day`; covers from closed order
 * summaries; top items and the margin from `sales-by-item`; the exception list from voided and
 * refunded orders. Nothing here is derived from a column this system does not populate — the
 * demo's COGS (MTD), Net Income (MTD), Net Margin and Revenue-vs-COGS chart are all
 * D-38-16 absences and are deliberately absent from the layout rather than present and empty.
 */
export function OwnerDashboard() {
  const { branchId, permissions } = useCurrentUser();

  const from = isoDay(WINDOW_DAYS);
  const to = isoDay(0);
  const priorFrom = isoDay(WINDOW_DAYS * 2);
  const priorTo = isoDay(WINDOW_DAYS + 1);

  const salesQuery = useRunReport("sales-by-day", { branchId, from, to });
  const priorSalesQuery = useRunReport("sales-by-day", { branchId, from: priorFrom, to: priorTo });
  const itemsQuery = useRunReport("sales-by-item", { branchId, from, to });
  const closedQuery = useOrderSummaries(["CLOSED"]);
  const voidedQuery = useOrderSummaries(["VOIDED", "REFUNDED"]);

  const salesRows = useMemo(() => salesQuery.data?.rows ?? [], [salesQuery.data]);
  const priorRows = useMemo(() => priorSalesQuery.data?.rows ?? [], [priorSalesQuery.data]);
  const itemRows = useMemo(() => itemsQuery.data?.rows ?? [], [itemsQuery.data]);
  const closedOrders = useMemo(() => closedQuery.data?.data ?? [], [closedQuery.data]);
  const voidedOrders = useMemo(() => voidedQuery.data?.data ?? [], [voidedQuery.data]);

  const netSalesPaisa = salesRows.reduce((sum, r) => sum + num(r, "total_paisa"), 0);
  const priorNetSalesPaisa = priorRows.reduce((sum, r) => sum + num(r, "total_paisa"), 0);
  const orderCount = salesRows.reduce((sum, r) => sum + num(r, "order_count"), 0);
  const priorOrderCount = priorRows.reduce((sum, r) => sum + num(r, "order_count"), 0);
  const covers = closedOrders.reduce((sum, o) => sum + (o.coverCount ?? 0), 0);
  const avgOrderPaisa = orderCount > 0 ? Math.round(netSalesPaisa / orderCount) : null;
  /**
   * The PRIOR average order, so the tile's delta is the change in the figure it sits under.
   *
   * <p>It used to be `pctChange(orderCount, priorOrderCount)` — the change in ORDER COUNT,
   * rendered as a bare "% vs prior" directly beneath a money value captioned "Net sales divided
   * by orders". If net sales and orders both rise 20% the average order is FLAT and that chip
   * read +20.0%. Not a fabricated value: a fabricated CHANGE in a value, which is the same
   * defect one level up and is exactly what `KpiTileDelta`'s own docblock says it closed.
   */
  const priorAvgOrderPaisa =
    priorOrderCount > 0 ? Math.round(priorNetSalesPaisa / priorOrderCount) : null;

  /*
   * Margin, computed only from rows that actually carry one.
   *
   * `gross_margin_paisa` is NULL for every row today — a Phase-8 deferral — so `marginRows` is
   * empty and the tile refuses. It is written as a real computation rather than a hardcoded
   * dash so that the refusal is a CONSEQUENCE of the data, not a decision baked into the JSX:
   * a reader can see exactly what would have to become true for a number to appear.
   */
  const margin = useMemo(() => {
    const marginRows = itemRows.filter((r) => r.gross_margin_paisa != null);
    if (marginRows.length === 0) return null;
    const revenue = marginRows.reduce((sum, r) => sum + num(r, "revenue_inc_tax_paisa"), 0);
    if (revenue <= 0) return null;
    const marginPaisa = marginRows.reduce((sum, r) => sum + num(r, "gross_margin_paisa"), 0);
    return { pct: (marginPaisa / revenue) * 100, rows: marginRows.length };
  }, [itemRows]);

  const trendSeries: TrendSeries[] = useMemo(
    () => [
      {
        label: "Net sales",
        // Plotted in RUPEES, not paisa. This is a unit choice for the DRAWING — the two series
        // share one scale so they stay comparable by eye, and plotting sales in paisa beside an
        // order count would flatten the order line onto the axis.
        values: salesRows.map((r) => num(r, "total_paisa") / 100),
        colorVar: "--chart-1",
        // The direct end-of-line label is SVG `<text>`, which cannot contain the `<span>`
        // `MoneyDisplay` renders — so this is the one money string on the page that component
        // cannot own. It goes through `formatPaisa` instead, which is the formatter
        // `MoneyDisplay` itself delegates to and the one pinned against the JVM renderer by the
        // shared vector file (37-01). Same single construction, same output string; only the
        // markup differs. The `* 100` returns the plotted rupees to the paisa that formatter
        // takes, and is exact for the integral amounts this series carries.
        format: (v) => formatPaisa(Math.round(v * 100)),
      },
      {
        label: "Orders",
        values: salesRows.map((r) => num(r, "order_count")),
        colorVar: "--chart-2",
        // Dashed — the second series is distinguishable with the colour removed entirely.
        dash: "6 4",
        format: (v) => `${v}`,
      },
    ],
    [salesRows],
  );

  const topItems = useMemo(() => {
    const sorted = [...itemRows].sort(
      (a, b) => num(b, "revenue_inc_tax_paisa") - num(a, "revenue_inc_tax_paisa"),
    );
    const max = sorted.length > 0 ? num(sorted[0]!, "revenue_inc_tax_paisa") : 0;
    return sorted.slice(0, 5).map((r) => ({
      key: String(r.menu_item_id ?? r.item_name),
      label: String(r.item_name ?? "Unnamed item"),
      // Money is BIGINT paisa on the wire and is converted ONLY inside `MoneyDisplay`, which is
      // reachable here because `RankedRow.value` is now a ReactNode. This was a template literal
      // doing its own `/ 100` — the fourth place in the product that rendered a rupee figure.
      value: (
        <>
          <MoneyDisplay paisa={num(r, "revenue_inc_tax_paisa")} /> · {num(r, "qty")} sold
        </>
      ),
      fraction: max > 0 ? num(r, "revenue_inc_tax_paisa") / max : 0,
    }));
  }, [itemRows]);

  const exceptions = useMemo(
    () =>
      voidedOrders.slice(0, 5).map((o) => ({
        key: o.orderId,
        label: `${o.orderNo ?? o.orderId.slice(0, 8)} — ${o.settlementStatus.toLowerCase()}`,
        // Was `Rs ${(o.totalPaisa / 100).toFixed(2)}` — a fourth, hand-rolled money path, with an
        // unpinned `toLocaleDateString()` beside it. Both now go through the sanctioned ones.
        detail: (
          <>
            <MoneyDisplay paisa={o.totalPaisa} /> ·{" "}
            {o.openedAt
              ? formatDateTime(o.openedAt, { day: "2-digit", month: "short", year: "numeric" })
              : "date unknown"}
          </>
        ),
        severity: "warning" as const,
      })),
    [voidedOrders],
  );

  const models: PortletModels<OwnerPortlets> = {
    "owner-net-sales": {
      kind: "KpiTile",
      value: <MoneyDisplay paisa={netSalesPaisa} />,
      caption: `${orderCount} order${orderCount === 1 ? "" : "s"} in ${WINDOW_DAYS} days`,
      deltaPct: pctChange(netSalesPaisa, priorNetSalesPaisa),
      spark: salesRows.map((r) => num(r, "total_paisa")),
      boundary: { query: [salesQuery, priorSalesQuery], what: "net sales" },
    },
    "owner-gross-margin":
      margin === null
        ? {
            kind: "KpiTile",
            caption: "Revenue less cost of goods",
            unavailableReason:
              "Cost of goods is not yet posted per item, so margin cannot be computed. " +
              "Showing nothing rather than a wrong number.",
            boundary: { query: itemsQuery, what: "gross margin" },
          }
        : {
            kind: "KpiTile",
            value: `${formatNumber(margin.pct, { maximumFractionDigits: 1 })}%`,
            caption: `Across ${margin.rows} item${margin.rows === 1 ? "" : "s"} with a posted cost`,
            boundary: { query: itemsQuery, what: "gross margin" },
          },
    "owner-covers": {
      kind: "KpiTile",
      value: formatNumber(covers),
      caption: `Across ${closedOrders.length} closed order${closedOrders.length === 1 ? "" : "s"}`,
      boundary: { query: closedQuery, what: "covers" },
    },
    "owner-avg-order":
      avgOrderPaisa == null
        ? {
            kind: "KpiTile",
            caption: "Net sales divided by orders",
            unavailableReason: "No orders in this period to average.",
            boundary: { query: [salesQuery, priorSalesQuery], what: "the average order" },
          }
        : {
            kind: "KpiTile",
            value: <MoneyDisplay paisa={avgOrderPaisa} />,
            caption: "Net sales divided by orders",
            // `null` when there is no comparable prior average — which KpiTileDelta renders as
            // a stated absence, NOT as 0%. A brand-new branch has not been flat.
            deltaPct:
              priorAvgOrderPaisa === null ? null : pctChange(avgOrderPaisa, priorAvgOrderPaisa),
            boundary: { query: [salesQuery, priorSalesQuery], what: "the average order" },
          },
    "owner-sales-trend": {
      kind: "TrendChart",
      categories: salesRows.map((r) => shortDate(r.business_date)),
      series: trendSeries,
      emptyLabel: "No trading days in this window.",
      boundary: { query: salesQuery, what: "the sales trend" },
    },
    "owner-top-items": {
      kind: "RankedList",
      rows: topItems,
      emptyLabel: "No items sold in this window.",
      boundary: { query: itemsQuery, what: "top items" },
    },
    "owner-exceptions": {
      kind: "ExceptionList",
      rows: exceptions,
      emptyLabel: "No voids or refunds to review.",
      boundary: { query: voidedQuery, what: "voids and refunds" },
    },
  };

  return (
    <DashboardShell preset={PRESET}>
      <PortletGrid preset={PRESET} permissions={permissions} models={models} />
    </DashboardShell>
  );
}
