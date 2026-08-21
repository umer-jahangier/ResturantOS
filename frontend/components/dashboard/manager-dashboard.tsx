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
import { getAgingState } from "@/components/kds/kds-aging";
import { formatElapsedLong } from "@/lib/format/elapsed";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useKdsStations, useKdsTickets } from "@/lib/hooks/kds/use-kds-tickets";
import { useMenuItemsAdmin } from "@/lib/hooks/pos/use-menu-admin";
import { useOrderSummaries, useTables } from "@/lib/hooks/pos/use-orders";
import { useBranchTills } from "@/lib/hooks/pos/use-till";
import type { KdsTicket } from "@/lib/models/kds.model";

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
    // No `fraction`. "This item is 86'd" is a boolean, not a magnitude — there is nothing to
    // rank these rows BY, so there is no honest bar to draw. Passing `fraction: 1` (as this did)
    // drew a full-width bar on every row, always: a chart encoding nothing, on the same screen
    // as `stationLoad` below, which computes a real `count / max`. UI-SPEC §9.1.
    return inactive.slice(0, 6).map((i) => ({
      key: i.id,
      label: i.name,
      value: i.categoryName ?? "Uncategorised",
    }));
  }, [menuItems]);

  const exceptions = useMemo(() => {
    const rows = lateTickets.slice(0, 4).map((t: KdsTicket) => ({
      key: `late-${t.id}`,
      label: `${t.orderNo ?? t.id.slice(0, 8)} is late at ${t.stationCode}`,
      // PROSE, and BOUNDED — `lib/format/elapsed.ts`, whose docblock names this very line: the
      // deleted `formatAge` was a ticket-face `mm:ss` timer, so a check left open over a close
      // rendered `114:01:07` here, inside a sentence, in the danger row. The long form says
      // `5d`, and past thirty days it names the date instead of counting at all.
      detail: `${formatElapsedLong(t.receivedAt, now)} on the board — past this station's target`,
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
      {/*
       * Error granularity: ONE boundary PER PORTLET, not one over the page (UI-SPEC §8.1.1).
       *
       * This screen used to open with a single
       *   <QueryBoundary query={[ordersQuery, ticketsQuery, stationsQuery, tablesQuery]}>
       * wrapped around everything. `QueryBoundary` fails an array as a unit — deliberately, and
       * correctly, because a LIST rendered from a partial set of its inputs is a lie. But that
       * contract only holds when every query in the array feeds the same region. Here they fed
       * four independent tiles, so one 503 from any one service replaced all four with a single
       * error box — and then the two rows below it as well.
       *
       * That is not a hypothetical. It is what the audit's very first screenshot captured: the
       * whole manager dashboard reduced to "Couldn't load today's service. [Try again]" by a
       * transient Eureka round-robin 503, which is also how phase 34's positive control came to
       * be anchored on an error state and silently skip for weeks.
       *
       * So each boundary below wraps the smallest region whose content is genuinely unavailable,
       * and names only the queries that region actually reads. A tile whose own query succeeded
       * now renders. Brief §25: "do not freeze the entire interface; prefer localized states."
       */}
      <PortletRow density={PRESET.density} columns={4}>
        {shown.has("manager-open-orders") && (
          <QueryBoundary query={ordersQuery} what="open orders">
            <KpiTile
              id="manager-open-orders"
              title="Open orders"
              drillTo="/app/pos/orders"
              density={PRESET.density}
              value={openOrders.length.toString()}
              caption={`${orders.length} order${orders.length === 1 ? "" : "s"} in view`}
              tone={openOrders.length > 0 ? "warning" : "neutral"}
            />
          </QueryBoundary>
        )}
        {shown.has("manager-late-tickets") && (
          // Both queries genuinely feed this one number: "late" is decided against each
          // station's own escalationThresholdSeconds, so a ticket list without its stations
          // would silently fall back to the 900s default and report a different count.
          <QueryBoundary query={[ticketsQuery, stationsQuery]} what="late tickets">
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
          </QueryBoundary>
        )}
        {shown.has("manager-till-variance") && (
          // Already correct before this change, and the model for the rest: `tillsQuery` was
          // never in the page-wide array, and the tile says WHY a figure is absent rather than
          // showing a confident zero.
          <QueryBoundary query={tillsQuery} what="till sessions">
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
          </QueryBoundary>
        )}
        {shown.has("manager-tables-occupied") && (
          <QueryBoundary query={tablesQuery} what="tables">
            <KpiTile
              id="manager-tables-occupied"
              title="Tables occupied"
              drillTo="/app/pos"
              density={PRESET.density}
              value={`${occupiedTables} / ${tables.length}`}
              caption={`${tables.length - occupiedTables} free right now`}
            />
          </QueryBoundary>
        )}
      </PortletRow>

      <PortletRow density={PRESET.density} columns={2}>
        {shown.has("manager-live-orders") && (
          <QueryBoundary query={ordersQuery} what="live orders">
            <RecordList
              id="manager-live-orders"
              title="Live orders"
              drillTo="/app/pos/orders"
              density={PRESET.density}
              rows={liveOrderRows}
              emptyLabel="Nothing open — every order is settled."
            />
          </QueryBoundary>
        )}
        {shown.has("manager-station-load") && (
          <QueryBoundary query={[ticketsQuery, stationsQuery]} what="station load">
            <RankedList
              id="manager-station-load"
              title="Station load"
              drillTo="/app/kitchen"
              density={PRESET.density}
              rows={stationLoad}
              emptyLabel="Every station is clear."
            />
          </QueryBoundary>
        )}
      </PortletRow>

      <PortletRow density={PRESET.density} columns={2}>
        {shown.has("manager-exceptions") && (
          // "Act now" merges late tickets and till exceptions, so it does need all three —
          // and here failing as a unit is right: a half-populated exception list would tell a
          // manager nothing needs them when something does.
          <QueryBoundary
            query={[ticketsQuery, stationsQuery, tillsQuery]}
            what="the exception list"
          >
            <ExceptionList
              id="manager-exceptions"
              title="Act now"
              drillTo="/app/pos/orders"
              density={PRESET.density}
              rows={exceptions}
              emptyLabel="Nothing needs you right now."
            />
          </QueryBoundary>
        )}
        {shown.has("manager-86d") && (
          <QueryBoundary query={menuQuery} what="menu availability">
            <RankedList
              id="manager-86d"
              title="86'd items"
              drillTo="/app/menu"
              density={PRESET.density}
              rows={eightySixed}
              emptyLabel="Every menu item is available."
            />
          </QueryBoundary>
        )}
      </PortletRow>
    </DashboardShell>
  );
}
