"use client";

import { useMemo } from "react";

import { DashboardShell, useNow } from "@/components/dashboard/dashboard-shell";
import { PortletGrid, type PortletModels } from "@/components/dashboard/portlets/portlet-renderer";
import { DASHBOARD_PRESETS, type ManagerPortlets } from "@/components/dashboard/presets";
import { getAgingState } from "@/components/kds/kds-aging";
import { formatElapsedLong } from "@/lib/format/elapsed";
import { formatDateTime } from "@/lib/format/locale";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useKdsStations, useKdsTickets } from "@/lib/hooks/kds/use-kds-tickets";
import { useMenuItemsAdmin } from "@/lib/hooks/pos/use-menu-admin";
import { useOrderSummaries, useTables } from "@/lib/hooks/pos/use-orders";
import { useBranchTills } from "@/lib/hooks/pos/use-till";
import type { KdsTicket } from "@/lib/models/kds.model";
import type { ExceptionRow } from "@/components/dashboard/portlets/portlet";
import { formatNumber } from "@/lib/format/locale";

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
 *
 * <h3>Error granularity: ONE boundary PER PORTLET, not one over the page (UI-SPEC §8.1.1)</h3>
 *
 * This screen used to open with a single `<QueryBoundary query={[ordersQuery, ticketsQuery,
 * stationsQuery, tablesQuery]}>` wrapped around everything. `QueryBoundary` fails an array as a
 * unit — deliberately, and correctly, because a LIST rendered from a partial set of its inputs
 * is a lie. But that contract only holds when every query in the array feeds the same region.
 * Here they fed four independent tiles, so one 503 from any one service replaced all four with a
 * single error box — and then the two rows below it as well.
 *
 * <p>That is not hypothetical. It is what the audit's very first screenshot captured: the whole
 * manager dashboard reduced to "Couldn't load today's service. [Try again]" by a transient
 * Eureka round-robin 503, which is also how phase 34's positive control came to be anchored on
 * an error state and silently skip for weeks.
 *
 * <p>Each `boundary` below therefore names only the queries its own portlet reads, and the
 * renderer wraps that portlet and nothing else. Brief §25: "do not freeze the entire interface;
 * prefer localized states." The eight hand-written `<QueryBoundary>` wrappers that used to
 * express this are gone — the same guarantee now travels with the DATA, which is what makes it
 * survivable when a ninth portlet is added.
 */
export function ManagerDashboard() {
  const { branchId, permissions } = useCurrentUser();

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
    // as `stationLoad` above, which computes a real `count / max`. UI-SPEC §9.1.
    return inactive.slice(0, 6).map((i) => ({
      key: i.id,
      label: i.name,
      value: i.categoryName ?? "Uncategorised",
    }));
  }, [menuItems]);

  const exceptions = useMemo<ExceptionRow[]>(() => {
    const rows: ExceptionRow[] = lateTickets.slice(0, 4).map((t: KdsTicket) => ({
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
        // `toLocaleTimeString()` before this: an unpinned locale AND an unpinned zone, so a till
        // opened 23:30 in Karachi read as the previous day on a UTC server. `formatDateTime`
        // pins both.
        detail: `Opened ${
          till.openedAt
            ? formatDateTime(till.openedAt, { hour: "2-digit", minute: "2-digit" })
            : "today"
        } and not yet counted`,
        severity: "danger" as const,
      });
    }
    for (const till of todaysTills.filter((t) => t.reviewStatus === "PENDING_REVIEW")) {
      rows.push({
        key: `review-${till.id}`,
        label: "A till session is waiting on your review",
        detail:
          till.variancePaisa == null ? (
            "Not yet counted"
          ) : (
            // Was `Rs ${(till.variancePaisa / 100).toFixed(2)}` — a hand-rolled money path in a
            // template literal. `ExceptionRow.detail` is a ReactNode, so `MoneyDisplay` fits.
            <>
              Variance <MoneyDisplay paisa={till.variancePaisa} sign="signed" />
            </>
          ),
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

  // Both queries genuinely feed the two KDS numbers: "late" is decided against each station's
  // own escalationThresholdSeconds, so a ticket list without its stations would silently fall
  // back to the 900s default and report a different count.
  const board = { query: [ticketsQuery, stationsQuery], what: "the kitchen board" };

  const models: PortletModels<ManagerPortlets> = {
    "manager-open-orders": {
      kind: "KpiTile",
      value: openOrders.length.toString(),
      caption: `${orders.length} order${orders.length === 1 ? "" : "s"} in view`,
      tone: openOrders.length > 0 ? "warning" : "neutral",
      boundary: { query: ordersQuery, what: "open orders" },
    },
    "manager-late-tickets": {
      kind: "KpiTile",
      value: lateTickets.length.toString(),
      caption: `${liveTickets.length} on the board now`,
      // `higherIsBetter={false}` used to be passed here with no delta beside it — inert, because
      // the delta row renders only when `deltaPct !== undefined`. There is no honest prior
      // period for "tickets late right now": the system stores no historical snapshot of it. The
      // type now refuses the prop rather than inviting someone to invent the delta.
      tone: lateTickets.length > 0 ? "danger" : "neutral",
      boundary: board,
    },
    "manager-till-variance":
      todaysTills.length === 0 || countedTills.length === 0
        ? {
            kind: "KpiTile",
            caption: `${countedTills.length} of ${todaysTills.length} till${todaysTills.length === 1 ? "" : "s"} counted`,
            unavailableReason:
              todaysTills.length === 0
                ? "No till has been opened today."
                : "No till has been counted yet today.",
            boundary: { query: tillsQuery, what: "till sessions" },
          }
        : {
            kind: "KpiTile",
            value: <MoneyDisplay paisa={variancePaisa} sign="signed" />,
            caption: `${countedTills.length} of ${todaysTills.length} till${todaysTills.length === 1 ? "" : "s"} counted`,
            boundary: { query: tillsQuery, what: "till sessions" },
          },
    "manager-tables-occupied": {
      kind: "KpiTile",
      // See waiter-dashboard: pinned formatter, so this ratio groups like its neighbours.
      value: `${formatNumber(occupiedTables)} / ${formatNumber(tables.length)}`,
      caption: `${tables.length - occupiedTables} free right now`,
      boundary: { query: tablesQuery, what: "tables" },
    },
    "manager-live-orders": {
      kind: "RecordList",
      rows: liveOrderRows,
      emptyLabel: "Nothing open — every order is settled.",
      boundary: { query: ordersQuery, what: "live orders" },
    },
    "manager-station-load": {
      kind: "RankedList",
      rows: stationLoad,
      emptyLabel: "Every station is clear.",
      boundary: { query: [ticketsQuery, stationsQuery], what: "station load" },
    },
    "manager-exceptions": {
      kind: "ExceptionList",
      rows: exceptions,
      emptyLabel: "Nothing needs you right now.",
      // "Act now" merges late tickets and till exceptions, so it does need all three — and here
      // failing as a unit is right: a half-populated exception list would tell a manager nothing
      // needs them when something does.
      boundary: {
        query: [ticketsQuery, stationsQuery, tillsQuery],
        what: "the exception list",
      },
    },
    "manager-86d": {
      kind: "RankedList",
      rows: eightySixed,
      emptyLabel: "Every menu item is available.",
      boundary: { query: menuQuery, what: "menu availability" },
    },
  };

  return (
    <DashboardShell preset={PRESET}>
      <PortletGrid preset={PRESET} permissions={permissions} models={models} />
    </DashboardShell>
  );
}
