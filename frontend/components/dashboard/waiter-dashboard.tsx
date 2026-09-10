"use client";

import { useMemo } from "react";
import { BellRing, ConciergeBell, MonitorPlay, Timer, Utensils } from "lucide-react";

import { DashboardShell, useNow } from "@/components/dashboard/dashboard-shell";
import { PortletGrid, type PortletModels } from "@/components/dashboard/portlets/portlet-renderer";
import type { MeterStackRow } from "@/components/dashboard/portlets/portlet";
import { DASHBOARD_PRESETS, type WaiterPortlets } from "@/components/dashboard/presets";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { formatElapsedLong } from "@/lib/format/elapsed";
import { formatNumber } from "@/lib/format/locale";
import { useKdsStations, useKdsTickets } from "@/lib/hooks/kds/use-kds-tickets";
import { useOrderSummaries, useTables } from "@/lib/hooks/pos/use-orders";

const PRESET = DASHBOARD_PRESETS.waiter;

const TERMINAL_STATUSES = new Set(["CLOSED", "VOIDED", "REFUNDED"]);

/**
 * WAITER dashboard — "What are my tables doing?" (PROVISIONAL question; see `presets.ts`,
 * which is where to change it).
 *
 * <h3>What this role got before phase 38</h3>
 *
 * The CASHIER preset, minus its first tile. `resolveDashboardPreset` matched WAITER alongside
 * CASHIER, so the page opened with *"Where is my till, and what is still open?"* — and a waiter
 * holds no `pos.till.open`, so `cashier-till` was filtered straight back out. The page asked a
 * question about a till, then declined to answer the till half of it. Two tiles remained: an
 * open-order count, and an ungated 72px button.
 *
 * <h3>The honest limitation, stated because the question says "my"</h3>
 *
 * `GET /api/v1/pos/orders` is BRANCH-scoped. It carries `cashierId`/`cashierName`, but there is
 * no server-side "mine" filter, and the cashier on a check is whoever rang it rather than
 * whoever is looking after the table — a check opened by a waiter and settled by a till operator
 * changes hands. So **no tile on this page claims to be filtered to the reader**: they are
 * titled for the service ("Tables seated", "Open checks") and the captions say what they counted
 * over. Narrowing them to one waiter's own tables needs a filter this system does not have, and
 * inventing it in the browser — by matching `cashierId` to the signed-in `userId` and calling
 * the result "mine" — would be a figure that is wrong exactly when it matters, on a busy
 * service, with two people on one section.
 *
 * <p>The question keeps the word "my" because it is the question a waiter actually has and the
 * preset table is where a product owner will correct it. The PORTLETS do not repeat the claim.
 *
 * <h3>Every figure is a live read</h3>
 *
 * Tables and their `OCCUPIED` status from pos-service; open checks from the order summaries;
 * "ready to run" and the station load from the same KDS board the kitchen is working. There is
 * no sales figure, no average check and no tip total on this page — a waiter holds no
 * `reporting.report.view`, so any of those would be filtered out of the layout for every
 * principal who could reach it.
 */
export function WaiterDashboard() {
  const { branchId, permissions } = useCurrentUser();

  const ordersQuery = useOrderSummaries();
  const tablesQuery = useTables();
  const ticketsQuery = useKdsTickets(branchId);
  const stationsQuery = useKdsStations(branchId);

  const orders = useMemo(() => ordersQuery.data?.data ?? [], [ordersQuery.data]);
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);
  const stations = useMemo(() => stationsQuery.data ?? [], [stationsQuery.data]);

  const openChecks = useMemo(
    () => orders.filter((o) => !TERMINAL_STATUSES.has(o.settlementStatus)),
    [orders],
  );
  const occupied = tables.filter((t) => t.status === "OCCUPIED").length;
  const needsBussing = tables.filter((t) => t.status === "NEEDS_BUSSING").length;

  /** Plated and waiting to be carried out — the one number a runner acts on immediately. */
  const readyTickets = useMemo(() => tickets.filter((t) => t.status === "READY"), [tickets]);

  const now = useNow();

  /**
   * The oldest still-open check.
   *
   * <p>`openedAt` is nullable on the wire, and a check with no stamp cannot be aged — so it is
   * excluded from the search rather than treated as opened now, and when NOTHING has a usable
   * stamp the tile says so instead of reporting the wrong table.
   */
  const oldestCheck = useMemo(() => {
    const stamped = openChecks
      .map((o) => ({ order: o, at: o.openedAt ? new Date(o.openedAt).getTime() : Number.NaN }))
      .filter((c) => Number.isFinite(c.at));
    if (stamped.length === 0) return null;
    return stamped.reduce((oldest, c) => (c.at < oldest.at ? c : oldest));
  }, [openChecks]);

  const checkRows = useMemo(
    () =>
      [...openChecks]
        .sort((a, b) => (a.openedAt ?? "").localeCompare(b.openedAt ?? ""))
        .slice(0, 6)
        .map((o) => ({
          key: o.orderId,
          primary: o.tableName ?? "No table",
          secondary: `${o.orderNo ?? o.orderId.slice(0, 8)} · ${
            o.openedAt ? `open ${formatElapsedLong(new Date(o.openedAt), now)}` : "no open time"
          }`,
          trailing: <MoneyDisplay paisa={o.totalPaisa} />,
        })),
    [openChecks, now],
  );

  /**
   * The pass, as a meter stack against the whole board — the same denominator correction made on
   * the manager's station-load panel. `count / max` measured each station against the busiest
   * one, so the busiest station always drew a full bar and the runner learned nothing from it.
   */
  const passLoad = useMemo<MeterStackRow[]>(() => {
    const live = tickets.filter((t) => t.status !== "SERVED" && t.status !== "CANCELLED");
    const counts = new Map<string, number>();
    for (const t of live) counts.set(t.stationCode, (counts.get(t.stationCode) ?? 0) + 1);
    const total = live.length;
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({
        key: code,
        label: stations.find((s) => s.code === code)?.name ?? code,
        value: count,
        of: total,
        // Agrees with the denominator it sits after, not the numerator — "1 / 5 tickets".
        noun: total === 1 ? "ticket" : "tickets",
      }));
  }, [tickets, stations]);

  const board = { query: [ticketsQuery, stationsQuery], what: "the kitchen board" };

  const models: PortletModels<WaiterPortlets> = {
    "waiter-tables-occupied": {
      kind: "KpiTile",
      // Through the pinned formatter like every other integer on this page — a branch with
      // 1000+ tables would otherwise render ungrouped beside neighbours that group.
      value: `${formatNumber(occupied)} / ${formatNumber(tables.length)}`,
      caption:
        needsBussing > 0
          ? `${formatNumber(needsBussing)} waiting to be bussed`
          : `${formatNumber(tables.length - occupied)} free right now`,
      tone: needsBussing > 0 ? "warning" : "neutral",
      boundary: { query: tablesQuery, what: "tables" },
    },
    "waiter-open-checks": {
      kind: "KpiTile",
      accent: "primary",
      icon: ConciergeBell,
      value: formatNumber(openChecks.length),
      caption: "Across the whole branch, not just your section",
      boundary: { query: ordersQuery, what: "open checks" },
    },
    "waiter-ready-to-run": {
      kind: "KpiTile",
      accent: "success",
      icon: BellRing,
      value: formatNumber(readyTickets.length),
      caption: "Plated and waiting on the pass",
      tone: readyTickets.length > 0 ? "warning" : "neutral",
      boundary: board,
    },
    "waiter-longest-open":
      oldestCheck === null
        ? {
            kind: "KpiTile",
            accent: "warning",
            icon: Timer,
            caption: "Since the check was opened",
            unavailableReason:
              openChecks.length === 0
                ? "No check is open."
                : "No open check carries an opening time, so none of them can be aged.",
            boundary: { query: ordersQuery, what: "open checks" },
          }
        : {
            kind: "KpiTile",
            accent: "warning",
            icon: Timer,
            value: formatElapsedLong(oldestCheck.at, now),
            caption: `${oldestCheck.order.tableName ?? "No table"} · ${
              oldestCheck.order.orderNo ?? oldestCheck.order.orderId.slice(0, 8)
            }`,
            boundary: { query: ordersQuery, what: "open checks" },
          },
    "waiter-checks": {
      kind: "RecordList",
      rows: checkRows,
      emptyLabel: "Nothing open — every check is settled.",
      boundary: { query: ordersQuery, what: "open checks" },
    },
    "waiter-pass": {
      kind: "MeterStack",
      rows: passLoad,
      emptyLabel: "Every station is clear.",
      boundary: board,
    },
    "waiter-shortcuts": {
      kind: "Shortcuts",
      actions: [{ href: "/app/pos", label: "Open POS", icon: MonitorPlay }],
    },
  };

  return (
    <DashboardShell preset={PRESET}>
      <PortletGrid preset={PRESET} permissions={permissions} models={models} />
    </DashboardShell>
  );
}
