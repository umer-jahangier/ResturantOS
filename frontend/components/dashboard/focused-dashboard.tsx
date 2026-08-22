"use client";

import { useMemo } from "react";
import { ChefHat, Coins, MonitorPlay, ReceiptText, Timer, Utensils } from "lucide-react";

import { DashboardShell, useNow } from "@/components/dashboard/dashboard-shell";
import { PortletGrid, type PortletModels } from "@/components/dashboard/portlets/portlet-renderer";
import {
  DASHBOARD_PRESETS,
  type CashierPortlets,
  type KitchenPortlets,
} from "@/components/dashboard/presets";
import { getAgingState } from "@/components/kds/kds-aging";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useKdsStations, useKdsTickets } from "@/lib/hooks/kds/use-kds-tickets";
import { useOrderSummaries } from "@/lib/hooks/pos/use-orders";
import { useActiveTill } from "@/lib/hooks/pos/use-till";

const TERMINAL_STATUSES = new Set(["CLOSED", "VOIDED", "REFUNDED"]);

/**
 * The two focused dashboards — cashier and kitchen (UI-SPEC §7.3).
 *
 * <h3>What changed in phase 38, and why it is not cosmetic</h3>
 *
 * Both used to hand-write their grid and then render a 72px `Open POS` / `Open KDS board`
 * button UNCONDITIONALLY (`:114-118`, `:183-187`), two lines below KPI tiles that were properly
 * guarded by `shown.has(...)`. That asymmetry is the whole of the audit's finding: an
 * INVENTORY_MANAGER or FINANCE_VIEWER, who both fell through to the cashier preset, saw a page
 * with **no numbers on it at all** and one enormous button into a POS they hold no
 * `pos.order.create` for. The tiles vanished because they were gated; the button survived
 * because it was not.
 *
 * <p>The fix is structural rather than a third `shown.has`: the button is now the `Shortcuts`
 * portlet type, rendered by the same pass that renders and gates everything else
 * (`portlets/portlet-renderer.tsx`), and its slot names `pos.order.create` in the preset table.
 * There is no longer a code path that can render a portlet the table did not authorise, which is
 * the only version of this fix that stays fixed.
 *
 * <p>The two roles that used to land here no longer do at all — they have their own presets now
 * (`inventory-dashboard.tsx`, `finance-dashboard.tsx`). The gate stays regardless: it is correct
 * on its own terms, and the next role to be added should not have to rediscover it.
 */

/**
 * CASHIER — §7.3: "A cashier landing on an analytics dashboard is a bug."
 *
 * Till state, own open orders, one big way into the POS. No revenue, no margin, no trend.
 * The previous shared dashboard showed a cashier the branch's closed-sales total, which is
 * both useless to them and, on a shared terminal, information they should not be handed.
 */
export function CashierDashboard() {
  const preset = DASHBOARD_PRESETS.cashier;
  const { permissions } = useCurrentUser();

  const tillQuery = useActiveTill();
  const ordersQuery = useOrderSummaries();
  const orders = useMemo(() => ordersQuery.data?.data ?? [], [ordersQuery.data]);
  const openOrders = orders.filter((o) => !TERMINAL_STATUSES.has(o.settlementStatus));
  const till = tillQuery.data;

  const models: PortletModels<CashierPortlets> = {
    "cashier-till": till
      ? {
          kind: "KpiTile",
          accent: "primary",
          icon: Coins,
          value: <MoneyDisplay paisa={till.expectedClosingPaisa ?? till.openingFloatPaisa} />,
          caption: `Till ${till.status.toLowerCase()}`,
          boundary: { query: tillQuery, what: "your till" },
        }
      : {
          // No value alongside the reason — the union forbids it, and it forbade it for a
          // reason: this tile used to pass `value="—"` next to the reason, so the dash was
          // live on any render where the reason went undefined.
          kind: "KpiTile",
          accent: "primary",
          icon: Coins,
          caption: "No till open",
          unavailableReason: "You have no open till. Open one from the POS before taking payment.",
          boundary: { query: tillQuery, what: "your till" },
        },
    "cashier-open-orders": {
      kind: "KpiTile",
      accent: "info",
      icon: ReceiptText,
      value: openOrders.length.toString(),
      caption: "Still to be settled",
      tone: openOrders.length > 0 ? "warning" : "neutral",
      boundary: { query: ordersQuery, what: "your open orders" },
    },
    "cashier-shortcuts": {
      kind: "Shortcuts",
      actions: [{ href: "/app/pos", label: "Open POS", icon: MonitorPlay }],
    },
  };

  return (
    <DashboardShell preset={preset}>
      <PortletGrid preset={preset} permissions={permissions} models={models} />
    </DashboardShell>
  );
}

/**
 * KITCHEN dashboard — the landing surface for a principal holding exactly `pos.kds.view`
 * and `pos.kds.update`.
 *
 * The old version was a single card with a link and no numbers at all: it could not tell
 * the cook whether anything was waiting, which is the only question they have before they
 * walk to the pass. It now reads the same board they are about to open, with the same
 * ageing rule, and then hands them a 72px way into it.
 */
export function KitchenDashboard() {
  const preset = DASHBOARD_PRESETS.kitchen;
  const { branchId, permissions } = useCurrentUser();

  const ticketsQuery = useKdsTickets(branchId);
  const stationsQuery = useKdsStations(branchId);
  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);
  const stations = useMemo(() => stationsQuery.data ?? [], [stationsQuery.data]);

  const liveTickets = tickets.filter((t) => t.status !== "SERVED" && t.status !== "CANCELLED");
  const thresholdFor = (code: string) =>
    stations.find((s) => s.code === code)?.escalationThresholdSeconds ?? 900;
  const now = useNow();
  const lateCount = liveTickets.filter(
    (t) => getAgingState(now - t.receivedAt.getTime(), thresholdFor(t.stationCode)) === "late",
  ).length;
  const activeStations = stations.filter((s) => s.active).length;

  // Both queries genuinely feed both numbers: "late" is decided against each station's own
  // escalationThresholdSeconds, so a ticket list without its stations would silently fall back
  // to the 900s default and report a different count.
  const board = { query: [ticketsQuery, stationsQuery], what: "the kitchen board" };

  const models: PortletModels<KitchenPortlets> = {
    "kitchen-late-tickets": {
      kind: "KpiTile",
      accent: "danger",
      icon: Timer,
      value: lateCount.toString(),
      caption: "Past this station's target",
      // `higherIsBetter` is NOT passed. There is no delta on this tile and no honest prior
      // period for one — the kitchen keeps no historical snapshot of its own lateness — so the
      // polarity had nothing to apply to and the type now refuses it.
      tone: lateCount > 0 ? "danger" : "neutral",
      boundary: board,
    },
    "kitchen-open-tickets": {
      kind: "KpiTile",
      accent: "secondary",
      icon: Utensils,
      value: liveTickets.length.toString(),
      caption: `Across ${activeStations} active station${activeStations === 1 ? "" : "s"}`,
      boundary: board,
    },
    "kitchen-shortcuts": {
      kind: "Shortcuts",
      actions: [{ href: "/app/kitchen", label: "Open KDS board", icon: ChefHat }],
    },
  };

  return (
    <DashboardShell preset={preset}>
      <PortletGrid preset={preset} permissions={permissions} models={models} />
    </DashboardShell>
  );
}
