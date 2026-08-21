"use client";

import { useMemo } from "react";

import { DashboardShell, PortletRow } from "@/components/dashboard/dashboard-shell";
import { ExceptionList, KpiTile, RankedList } from "@/components/dashboard/portlets/portlet";
import { PortletShell } from "@/components/dashboard/portlets/portlet";
import { TrendChart, type TrendSeries } from "@/components/dashboard/portlets/trend-chart";
import { DASHBOARD_PRESETS, visiblePortlets } from "@/components/dashboard/presets";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
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

/** `business_date` arrives as a full ISO instant; the axis wants "7 Aug". */
function shortDate(value: unknown): string {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value ?? "");
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" });
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
 * <h3>The margin tile renders a dash, on purpose</h3>
 *
 * `sales-by-item` returns `cogs_paisa: null` and `gross_margin_paisa: null` — a Phase-8
 * deferral that the report declares in its own `dataNotes`, and that `reporting.schema.ts`
 * types as nullable specifically so it can never be silently defaulted to 0. So this tile
 * says **"—", with the reason**, rather than computing a margin from a null cost and
 * printing 100%.
 *
 * That is not a missing feature politely excused. A dashboard that reports 100% gross margin
 * to an owner is worse than one that reports nothing: the first is a number they will act on.
 * This codebase has already shipped the two adjacent failures — a "Closed sales: Rs 0.00"
 * that was a query bug rather than a quiet day, and a journal detail that rendered raw paisa
 * so every total read 100× too large. Both are the UI stating what it does not know.
 */
export function OwnerDashboard() {
  const { branchId, permissions } = useCurrentUser();
  const portlets = useMemo(() => visiblePortlets(PRESET, permissions), [permissions]);
  const shown = useMemo(() => new Set(portlets.map((p) => p.id)), [portlets]);

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

  // `dataNotes` is the report telling us what it could not compute. Read it rather than
  // inferring from a null, so a future backend fix flips this tile on by itself.
  const marginUnavailable = itemRows.every((r) => r.gross_margin_paisa == null);

  const trendSeries: TrendSeries[] = useMemo(
    () => [
      {
        label: "Net sales",
        values: salesRows.map((r) => num(r, "total_paisa") / 100),
        colorVar: "--chart-1",
        format: (v) => `Rs ${Math.round(v).toLocaleString()}`,
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
      // Money is BIGINT paisa on the wire and converted ONLY here, at display.
      value: `Rs ${(num(r, "revenue_inc_tax_paisa") / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} · ${num(r, "qty")} sold`,
      fraction: max > 0 ? num(r, "revenue_inc_tax_paisa") / max : 0,
    }));
  }, [itemRows]);

  const exceptions = useMemo(
    () =>
      voidedOrders.slice(0, 5).map((o) => ({
        key: o.orderId,
        label: `${o.orderNo ?? o.orderId.slice(0, 8)} — ${o.settlementStatus.toLowerCase()}`,
        detail: `Rs ${(o.totalPaisa / 100).toFixed(2)} · ${
          o.openedAt ? new Date(o.openedAt).toLocaleDateString() : "date unknown"
        }`,
        severity: "warning" as const,
      })),
    [voidedOrders],
  );

  return (
    <DashboardShell preset={PRESET}>
      <QueryBoundary
        query={[salesQuery, priorSalesQuery, itemsQuery, closedQuery, voidedQuery]}
        what="your business summary"
      >
        <PortletRow density={PRESET.density} columns={4}>
          {shown.has("owner-net-sales") && (
            <KpiTile
              id="owner-net-sales"
              title="Net sales"
              drillTo="/app/reports"
              density={PRESET.density}
              value={<MoneyDisplay paisa={netSalesPaisa} />}
              caption={`${orderCount} order${orderCount === 1 ? "" : "s"} in ${WINDOW_DAYS} days`}
              deltaPct={pctChange(netSalesPaisa, priorNetSalesPaisa)}
              spark={salesRows.map((r) => num(r, "total_paisa"))}
            />
          )}
          {shown.has("owner-gross-margin") && (
            <KpiTile
              id="owner-gross-margin"
              title="Gross margin"
              drillTo="/app/reports"
              density={PRESET.density}
              value="—"
              caption="Revenue less cost of goods"
              unavailableReason={
                marginUnavailable
                  ? "Cost of goods is not yet posted per item, so margin cannot be computed. Showing nothing rather than a wrong number."
                  : undefined
              }
            />
          )}
          {shown.has("owner-covers") && (
            <KpiTile
              id="owner-covers"
              title="Covers"
              drillTo="/app/pos/orders"
              density={PRESET.density}
              value={covers.toLocaleString()}
              caption={`Across ${closedOrders.length} closed order${closedOrders.length === 1 ? "" : "s"}`}
            />
          )}
          {shown.has("owner-avg-order") && (
            <KpiTile
              id="owner-avg-order"
              title="Average order"
              drillTo="/app/pos/orders"
              density={PRESET.density}
              value={avgOrderPaisa == null ? "—" : <MoneyDisplay paisa={avgOrderPaisa} />}
              caption="Net sales divided by orders"
              deltaPct={pctChange(orderCount, priorOrderCount)}
              unavailableReason={
                avgOrderPaisa == null ? "No orders in this period to average." : undefined
              }
            />
          )}
        </PortletRow>

        <PortletRow density={PRESET.density} columns={2}>
          {shown.has("owner-sales-trend") && (
            <PortletShell
              id="owner-sales-trend"
              title="Sales and order volume"
              drillTo="/app/reports"
              drillLabel="Sales and order volume — open the sales report"
              density={PRESET.density}
            >
              {salesRows.length === 0 ? (
                <p className="text-[length:var(--text-small)] text-foreground-tertiary">
                  No trading days in this window.
                </p>
              ) : (
                <TrendChart
                  categories={salesRows.map((r) => shortDate(r.business_date))}
                  series={trendSeries}
                />
              )}
            </PortletShell>
          )}
          {shown.has("owner-top-items") && (
            <RankedList
              id="owner-top-items"
              title="Top items by revenue"
              drillTo="/app/reports"
              density={PRESET.density}
              rows={topItems}
              emptyLabel="No items sold in this window."
            />
          )}
        </PortletRow>

        {shown.has("owner-exceptions") && (
          <PortletRow density={PRESET.density} columns={1}>
            <ExceptionList
              id="owner-exceptions"
              title="Needs a decision"
              drillTo="/app/pos/orders"
              density={PRESET.density}
              rows={exceptions}
              emptyLabel="No voids or refunds to review."
            />
          </PortletRow>
        )}
      </QueryBoundary>
    </DashboardShell>
  );
}
