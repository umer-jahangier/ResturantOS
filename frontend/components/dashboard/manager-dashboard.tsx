"use client";

import { useMemo } from "react";

import { DashboardShell, PortletRow, useNow } from "@/components/dashboard/dashboard-shell";
import {
  ExceptionList,
  KpiTile,
  RankedList,
  RecordList,
} from "@/components/dashboard/portlets/portlet";
import { DASHBOARD_PRESETS, visiblePortlets } from "@/components/dashboard/presets";
import { getAgingState, formatAge } from "@/components/kds/kds-aging";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useKdsStations, useKdsTickets } from "@/lib/hooks/kds/use-kds-tickets";
import { useMenuItemsAdmin } from "@/lib/hooks/pos/use-menu-admin";
import { useOrderSummaries, useTables } from "@/lib/hooks/pos/use-orders";
import { useBranchTills } from "@/lib/hooks/pos/use-till";
import type { KdsTicket } from "@/lib/models/kds.model";
import { cn } from "@/lib/utils";
import { T_SMALL } from "@/components/dashboard/dashboard-type";

const PRESET = DASHBOARD_PRESETS.manager;

const TERMINAL_STATUSES = new Set(["CLOSED", "VOIDED", "REFUNDED"]);

/**
 * MANAGER dashboard — "what needs me in the next five minutes?" (UI-SPEC §7.3).
 *
 * <h3>Why this is a different page and not the owner's page with today's dates in it</h3>
 *
 * Every row-1 tile here is a count somebody can act on before service ends: open orders,
 * tickets past their station's own escalation threshold, today's till variance, tables
 * occupied. Net sales is deliberately absent — it is the owner's first number and it is one
 * a manager can do nothing about between now and close.
 *
 * <h3>"Late tickets" is the same computation the KDS board makes</h3>
 *
 * It calls `getAgingState` from `components/kds/kds-aging.ts`, so a ticket counted late here
 * is late on the board, with the same fraction against the same per-station
 * `escalationThresholdSeconds`. Re-deriving "late" from a hardcoded 15 minutes on this page
 * would produce two numbers that disagree, and a manager who trusts neither.
 */
export function ManagerDashboard() {
  const { branchId, permissions } = useCurrentUser();
  const portlets = useMemo(() => visiblePortlets(PRESET, permissions), [permissions]);
  const shown = useMemo(() => new Set(portlets.map((p) => p.id)), [portlets]);

  const ordersQuery = useOrderSummaries();
  const ticketsQuery = useKdsTickets(branchId);
  const stationsQuery = useKdsStations(branchId);
  const tablesQuery = useTables();
  const tillsQuery = useBranchTills(branchId);
  const menuQuery = useMenuItemsAdmin();

  const orders = useMemo(() => ordersQuery.data?.data ?? [], [ordersQuery.data]);
  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);
  const stations = useMemo(() => stationsQuery.data ?? [], [stationsQuery.data]);
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const tills = useMemo(() => tillsQuery.data?.data ?? [], [tillsQuery.data]);
  const menuItems = useMemo(() => menuQuery.data ?? [], [menuQuery.data]);

  const openOrders = useMemo(
    () => orders.filter((o) => !TERMINAL_STATUSES.has(o.settlementStatus)),
    [orders],
  );

  const thresholdFor = useMemo(() => {
    const byCode = new Map(stations.map((s) => [s.code, s.escalationThresholdSeconds]));
    return (code: string) => byCode.get(code) ?? 900;
  }, [stations]);

  const liveTickets = useMemo(
    () => tickets.filter((t) => t.status !== "SERVED" && t.status !== "CANCELLED"),
    [tickets],
  );

  const now = useNow();
  const lateTickets = useMemo(
    () =>
      liveTickets.filter(
        (t) => getAgingState(now - t.receivedAt.getTime(), thresholdFor(t.stationCode)) === "late",
      ),
    [liveTickets, now, thresholdFor],
  );

  const occupiedTables = tables.filter((t) => t.status === "OCCUPIED").length;

  const todaysTills = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return tills.filter((t) => (t.openedAt ?? "").slice(0, 10) === today);
  }, [tills]);

  // A variance of null is "not counted yet", which is not the same as a variance of zero.
  const countedTills = todaysTills.filter((t) => t.variancePaisa != null);
  const variancePaisa = countedTills.reduce((sum, t) => sum + (t.variancePaisa ?? 0), 0);

  const stationLoad = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of liveTickets) {
      counts.set(t.stationCode, (counts.get(t.stationCode) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({
        key: code,
        label: stations.find((s) => s.code === code)?.name ?? code,
        value: `${count} ticket${count === 1 ? "" : "s"}`,
        fraction: count / max,
      }));
  }, [liveTickets, stations]);

  const eightySixed = useMemo(() => {
    const inactive = menuItems.filter((i) => !i.active);
    return inactive.slice(0, 6).map((i) => ({
      key: i.id,
      label: i.name,
      value: i.categoryName ?? "Uncategorised",
      fraction: 1,
    }));
  }, [menuItems]);

  const exceptions = useMemo(() => {
    const rows = lateTickets.slice(0, 4).map((t: KdsTicket) => ({
      key: `late-${t.id}`,
      label: `${t.orderNo ?? t.id.slice(0, 8)} is late at ${t.stationCode}`,
      detail: `${formatAge(now - t.receivedAt.getTime())} on the board — past this station's target`,
      severity: "danger" as const,
    }));
    for (const till of todaysTills.filter((t) => t.status === "OPEN")) {
      rows.push({
        key: `till-${till.id}`,
        label: "A till is still open",
        detail: `Opened ${till.openedAt ? new Date(till.openedAt).toLocaleTimeString() : "today"} and not yet counted`,
        severity: "danger" as const,
      });
    }
    for (const till of todaysTills.filter((t) => t.reviewStatus === "PENDING_REVIEW")) {
      rows.push({
        key: `review-${till.id}`,
        label: "A till session is waiting on your review",
        detail:
          till.variancePaisa == null
            ? "Not yet counted"
            : `Variance Rs ${(till.variancePaisa / 100).toFixed(2)}`,
        severity: "danger" as const,
      });
    }
    return rows.slice(0, 6);
  }, [lateTickets, now, todaysTills]);

  const liveOrderRows = useMemo(
    () =>
      openOrders.slice(0, 6).map((o) => ({
        key: o.orderId,
        primary: o.orderNo ?? o.orderId.slice(0, 8),
        secondary: `${o.tableName ?? "No table"} · ${o.derivedStatus.replace(/_/g, " ").toLowerCase()}`,
        // BIGINT paisa → rupees at the display boundary, and nowhere earlier.
        trailing: <MoneyDisplay paisa={o.totalPaisa} />,
      })),
    [openOrders],
  );

  return (
    <DashboardShell preset={PRESET}>
      <QueryBoundary
        query={[ordersQuery, ticketsQuery, stationsQuery, tablesQuery]}
        what="today's service"
      >
        <PortletRow density={PRESET.density} columns={4}>
          {shown.has("manager-open-orders") && (
            <KpiTile
              id="manager-open-orders"
              title="Open orders"
              drillTo="/app/pos/orders"
              density={PRESET.density}
              value={openOrders.length.toString()}
              caption={`${orders.length} order${orders.length === 1 ? "" : "s"} in view`}
              tone={openOrders.length > 0 ? "warning" : "neutral"}
            />
          )}
          {shown.has("manager-late-tickets") && (
            <KpiTile
              id="manager-late-tickets"
              title="Late tickets"
              drillTo="/app/kitchen"
              density={PRESET.density}
              value={lateTickets.length.toString()}
              caption={`${liveTickets.length} on the board now`}
              higherIsBetter={false}
              tone={lateTickets.length > 0 ? "danger" : "neutral"}
            />
          )}
          {shown.has("manager-till-variance") && (
            <KpiTile
              id="manager-till-variance"
              title="Till variance today"
              drillTo="/app/pos/tills"
              density={PRESET.density}
              value={<MoneyDisplay paisa={variancePaisa} />}
              caption={`${countedTills.length} of ${todaysTills.length} till${todaysTills.length === 1 ? "" : "s"} counted`}
              higherIsBetter={false}
              unavailableReason={
                todaysTills.length === 0
                  ? "No till has been opened today."
                  : countedTills.length === 0
                    ? "No till has been counted yet today."
                    : undefined
              }
            />
          )}
          {shown.has("manager-tables-occupied") && (
            <KpiTile
              id="manager-tables-occupied"
              title="Tables occupied"
              drillTo="/app/pos"
              density={PRESET.density}
              value={`${occupiedTables} / ${tables.length}`}
              caption={`${tables.length - occupiedTables} free right now`}
            />
          )}
        </PortletRow>

        <PortletRow density={PRESET.density} columns={2}>
          {shown.has("manager-live-orders") && (
            <RecordList
              id="manager-live-orders"
              title="Live orders"
              drillTo="/app/pos/orders"
              density={PRESET.density}
              rows={liveOrderRows}
              emptyLabel="Nothing open — every order is settled."
            />
          )}
          {shown.has("manager-station-load") && (
            <RankedList
              id="manager-station-load"
              title="Station load"
              drillTo="/app/kitchen"
              density={PRESET.density}
              rows={stationLoad}
              emptyLabel="Every station is clear."
            />
          )}
        </PortletRow>

        <PortletRow density={PRESET.density} columns={2}>
          {shown.has("manager-exceptions") && (
            <ExceptionList
              id="manager-exceptions"
              title="Act now"
              drillTo="/app/pos/orders"
              density={PRESET.density}
              rows={exceptions}
              emptyLabel="Nothing needs you right now."
            />
          )}
          {shown.has("manager-86d") && (
            <RankedList
              id="manager-86d"
              title="86'd items"
              drillTo="/app/menu"
              density={PRESET.density}
              rows={eightySixed}
              emptyLabel="Every menu item is available."
            />
          )}
        </PortletRow>

        {/* The two secondary queries are allowed to fail without blanking the page, so this
            says which panels are degraded instead of pretending they are empty. */}
        {(tillsQuery.isError || menuQuery.isError) && (
          <p className={cn("text-destructive", T_SMALL)} role="alert">
            Some panels could not load
            {tillsQuery.isError ? " (till sessions)" : ""}
            {menuQuery.isError ? " (menu availability)" : ""}. The counts above exclude them.
          </p>
        )}
      </QueryBoundary>
    </DashboardShell>
  );
}
