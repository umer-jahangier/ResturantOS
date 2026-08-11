"use client";

import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton";
import { CashierDashboard, KitchenDashboard } from "@/components/dashboard/focused-dashboard";
import { ManagerDashboard } from "@/components/dashboard/manager-dashboard";
import { OwnerDashboard } from "@/components/dashboard/owner-dashboard";
import { resolveDashboardPreset } from "@/components/dashboard/presets";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * The dashboard router (UI-SPEC §7.3).
 *
 * This file used to be 316 lines and one screen. It showed every role the same four neutral
 * stat cards — closed sales, active orders, menu items, dining tables — with a single
 * `if (!canViewOrders) return <KitchenDashboard/>` as its entire notion of who was reading.
 * §7.3 is direct about why that fails: "Owner and manager do not get the same page with
 * different numbers — they get different portlet sets."
 *
 * So the branching lives here and nowhere else, it branches on a PRESET resolved from role
 * and permission (`presets.ts`), and each preset is a separate component that fetches only
 * what its own portlets need. An owner's dashboard no longer pays for the manager's six
 * queries, and a cashier no longer pays for either.
 */
export function TenantDashboard() {
  const { roles, permissions, isAuthenticated } = useCurrentUser();

  // Resolving a preset before the session exists would flash the CASHIER dashboard at an
  // owner: `resolveDashboardPreset([], [])` correctly falls through to the most conservative
  // preset, and on a hard refresh the token is decoded a paint later than the first render.
  // The route is already guarded, so the only reachable meaning of "no session yet" here is
  // "still rehydrating".
  if (!isAuthenticated) {
    return <DashboardSkeleton />;
  }

  switch (resolveDashboardPreset(roles, permissions)) {
    case "owner":
      return <OwnerDashboard />;
    case "manager":
      return <ManagerDashboard />;
    case "kitchen":
      return <KitchenDashboard />;
    case "cashier":
    default:
      return <CashierDashboard />;
  }
}
