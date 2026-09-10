"use client";

import { useMemo } from "react";

import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton";
import { AccountantDashboard } from "@/components/dashboard/accountant-dashboard";
import { CashierDashboard, KitchenDashboard } from "@/components/dashboard/focused-dashboard";
import { FinanceDashboard } from "@/components/dashboard/finance-dashboard";
import { InventoryDashboard } from "@/components/dashboard/inventory-dashboard";
import { ManagerDashboard } from "@/components/dashboard/manager-dashboard";
import { OwnerDashboard } from "@/components/dashboard/owner-dashboard";
import { WaiterDashboard } from "@/components/dashboard/waiter-dashboard";
import {
  DashboardIdentityProvider,
  type DashboardIdentity,
} from "@/components/dashboard/dashboard-shell";
import { resolveDashboardPreset } from "@/components/dashboard/presets";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useMyBranches } from "@/lib/hooks/auth/use-my-branches";
import { useTenantBrand } from "@/lib/hooks/use-tenant-brand";

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
 *
 * <h3>Eight arms, because there are nine roles and there were four presets</h3>
 *
 * The seed mints nine roles. Until phase 38 this switch had four arms and three of the nine
 * landed somewhere wrong: INVENTORY_MANAGER and FINANCE_VIEWER fell through to `cashier` and saw
 * a page with no numbers on it at all, and ACCOUNTANT was caught by a permission fallback and
 * asked the owner's question. WAITER reached `cashier` and was asked about a till it cannot
 * open. Each now has its own arm and its own preset; the `default` remains `cashier`, which is
 * still the most conservative page in the product and is what an unrecognised principal gets.
 *
 * <h3>It also owns the dateline, because it is the only arm rendered under the providers</h3>
 *
 * The demo's dashboard subtitle names the restaurant and the branch, and both come from
 * `useQuery`. `DashboardShell` cannot fetch them itself — every dashboard unit test renders a
 * role dashboard directly, with its own hooks mocked and no `QueryClientProvider` above it, so a
 * query inside the shell throws in eight test files at once. This router is never rendered that
 * way, so it resolves the identity here and pushes it down through
 * {@link DashboardIdentityProvider}, which defaults to nothing.
 */
export function TenantDashboard() {
  const { roles, permissions, branchId, isAuthenticated } = useCurrentUser();
  const brand = useTenantBrand();
  const branchesQuery = useMyBranches();
  /*
   * The dateline degrades rather than fails, and it says so out loud.
   *
   * `isError` is read explicitly — not because a failed branch list should surface an error
   * notice here (it should not; the dashboard's figures are unaffected and eight `QueryBoundary`
   * wrappers below already own the failures that matter), but because `data?.find(...) ?? null`
   * on its own is bug shape 2 from GA-001: an outage silently becoming "no such branch". Written
   * this way the omission is a DECISION — an unnamed branch, never a wrongly named one — and
   * `state-coverage.test.tsx` can see that the question was asked.
   */
  const branchName = branchesQuery.isError
    ? null
    : (branchesQuery.data?.find((branch) => branch.id === branchId)?.name ?? null);
  const identity = useMemo<DashboardIdentity>(() => ({ brand, branchName }), [brand, branchName]);

  // Resolving a preset before the session exists would flash the CASHIER dashboard at an
  // owner: `resolveDashboardPreset([], [])` correctly falls through to the most conservative
  // preset, and on a hard refresh the token is decoded a paint later than the first render.
  // The route is already guarded, so the only reachable meaning of "no session yet" here is
  // "still rehydrating".
  if (!isAuthenticated) {
    return <DashboardSkeleton />;
  }

  return (
    <DashboardIdentityProvider identity={identity}>
      {dashboardFor(roles, permissions)}
    </DashboardIdentityProvider>
  );
}

function dashboardFor(roles: readonly string[], permissions: readonly string[]) {
  switch (resolveDashboardPreset(roles, permissions)) {
    case "owner":
      return <OwnerDashboard />;
    case "manager":
      return <ManagerDashboard />;
    case "accountant":
      return <AccountantDashboard />;
    case "inventory":
      return <InventoryDashboard />;
    case "finance":
      return <FinanceDashboard />;
    case "kitchen":
      return <KitchenDashboard />;
    case "waiter":
      return <WaiterDashboard />;
    case "cashier":
    default:
      return <CashierDashboard />;
  }
}
