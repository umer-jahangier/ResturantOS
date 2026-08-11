"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChefHat, MonitorPlay } from "lucide-react";

import { DashboardShell, PortletRow, useNow } from "@/components/dashboard/dashboard-shell";
import { KpiTile } from "@/components/dashboard/portlets/portlet";
import { T_H2 } from "@/components/dashboard/dashboard-type";
import { DASHBOARD_PRESETS, visiblePortlets } from "@/components/dashboard/presets";
import { getAgingState } from "@/components/kds/kds-aging";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useKdsStations, useKdsTickets } from "@/lib/hooks/kds/use-kds-tickets";
import { useOrderSummaries } from "@/lib/hooks/pos/use-orders";
import { useActiveTill } from "@/lib/hooks/pos/use-till";
import { cn } from "@/lib/utils";

const TERMINAL_STATUSES = new Set(["CLOSED", "VOIDED", "REFUNDED"]);

/**
 * The single 72px primary action §7.3 asks for on the cashier and kitchen presets.
 *
 * 72px is not decoration: it is the touch target a cashier hits without looking, on a
 * counter-mounted screen, with wet hands. Everything else on those two dashboards is
 * secondary to getting them into the surface where their work happens.
 */
function PrimaryAction({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof ChefHat;
}) {
  return (
    <Link
      href={href}
      data-testid="dashboard-primary-action"
      className={cn(
        "inline-flex h-[72px] items-center justify-center gap-3 rounded-lg px-8 font-semibold",
        // --primary-700 is the light-theme solid fill. §3.8 measured 500 and 600 against
        // white and both FAIL contrast; 700 is 5.46:1. The token remembers so nobody has to.
        "bg-primary-700 text-white hover:bg-primary-800",
        T_H2,
      )}
    >
      <Icon className="size-6" aria-hidden="true" />
      {label}
    </Link>
  );
}

/**
 * CASHIER dashboard — §7.3: "A cashier landing on an analytics dashboard is a bug."
 *
 * Till state, own open orders, one big way into the POS. No revenue, no margin, no trend.
 * The previous shared dashboard showed a cashier the branch's closed-sales total, which is
 * both useless to them and, on a shared terminal, information they should not be handed.
 */
export function CashierDashboard() {
  const preset = DASHBOARD_PRESETS.cashier;
  const { permissions } = useCurrentUser();
  const shown = useMemo(
    () => new Set(visiblePortlets(preset, permissions).map((p) => p.id)),
    [preset, permissions],
  );

  const tillQuery = useActiveTill();
  const ordersQuery = useOrderSummaries();
  const orders = useMemo(() => ordersQuery.data?.data ?? [], [ordersQuery.data]);
  const openOrders = orders.filter((o) => !TERMINAL_STATUSES.has(o.settlementStatus));
  const till = tillQuery.data;

  return (
    <DashboardShell preset={preset}>
      <QueryBoundary query={[ordersQuery]} what="your shift">
        <PortletRow density={preset.density} columns={2}>
          {shown.has("cashier-till") && (
            <KpiTile
              id="cashier-till"
              title="My till"
              drillTo="/app/pos"
              density={preset.density}
              value={
                till ? (
                  <MoneyDisplay paisa={till.expectedClosingPaisa ?? till.openingFloatPaisa} />
                ) : (
                  "—"
                )
              }
              caption={till ? `Till ${till.status.toLowerCase()}` : "No till open"}
              unavailableReason={
                till
                  ? undefined
                  : "You have no open till. Open one from the POS before taking payment."
              }
            />
          )}
          {shown.has("cashier-open-orders") && (
            <KpiTile
              id="cashier-open-orders"
              title="My open orders"
              drillTo="/app/pos/orders"
              density={preset.density}
              value={openOrders.length.toString()}
              caption="Still to be settled"
              tone={openOrders.length > 0 ? "warning" : "neutral"}
            />
          )}
        </PortletRow>
        <PortletRow density={preset.density} columns={1}>
          <div>
            <PrimaryAction href="/app/pos" label="Open POS" icon={MonitorPlay} />
          </div>
        </PortletRow>
      </QueryBoundary>
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
  const shown = useMemo(
    () => new Set(visiblePortlets(preset, permissions).map((p) => p.id)),
    [preset, permissions],
  );

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

  return (
    <DashboardShell preset={preset}>
      <QueryBoundary query={[ticketsQuery, stationsQuery]} what="the kitchen board">
        <PortletRow density={preset.density} columns={2}>
          {shown.has("kitchen-late-tickets") && (
            <KpiTile
              id="kitchen-late-tickets"
              title="Late tickets"
              drillTo="/app/kitchen"
              density={preset.density}
              value={lateCount.toString()}
              caption="Past this station's target"
              higherIsBetter={false}
              tone={lateCount > 0 ? "danger" : "neutral"}
            />
          )}
          {shown.has("kitchen-open-tickets") && (
            <KpiTile
              id="kitchen-open-tickets"
              title="Tickets on the board"
              drillTo="/app/kitchen"
              density={preset.density}
              value={liveTickets.length.toString()}
              caption={`Across ${stations.filter((s) => s.active).length} active station${
                stations.filter((s) => s.active).length === 1 ? "" : "s"
              }`}
            />
          )}
        </PortletRow>
        <PortletRow density={preset.density} columns={1}>
          <div>
            <PrimaryAction href="/app/kitchen" label="Open KDS board" icon={ChefHat} />
          </div>
        </PortletRow>
      </QueryBoundary>
    </DashboardShell>
  );
}
