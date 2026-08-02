"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ChefHat,
  CircleDollarSign,
  ClipboardList,
  LayoutGrid,
  UtensilsCrossed,
} from "lucide-react";

import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton";
import { StatusBadge, type StatusVariant } from "@/components/ui/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useMenuItems } from "@/lib/hooks/pos/use-menu";
import { useOrderSummaries, useTables } from "@/lib/hooks/pos/use-orders";
import type { OrderStatus } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

type DashboardOrder = {
  id: string;
  orderNo: string | null;
  status: OrderStatus;
  totalPaisa: number;
  openedAt: string | null;
};

const ACTIVE_STATUSES: OrderStatus[] = [
  "DRAFT",
  "OPEN",
  "SENT_TO_KDS",
  "PARTIAL_READY",
  "READY",
  "SERVED",
];

function StatCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: React.ReactNode;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="space-y-1">
          <CardDescription>{title}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
        </div>
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function orderStatusVariant(status: OrderStatus): StatusVariant {
  if (status === "CLOSED") return "success";
  if (status === "SENT_TO_KDS" || status === "PARTIAL_READY" || status === "READY") return "pending";
  if (status === "OPEN" || status === "SERVED") return "warning";
  if (status === "VOIDED" || status === "REFUNDED") return "error";
  return "inactive";
}

function KitchenDashboard() {
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Kitchen</h1>
        <p className="text-muted-foreground">
          Your account is set up for kitchen display. Open the KDS board to view and update tickets.
        </p>
      </div>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ChefHat className="size-5" aria-hidden />
            Kitchen Display
          </CardTitle>
          <CardDescription>Live tickets by station for your branch.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/app/kitchen"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Open KDS board
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}

function OperationsDashboard() {
  const { roles } = useCurrentUser();
  const { data: ordersResult, isLoading: ordersLoading } = useOrderSummaries();
  const { data: menuItems = [], isLoading: menuLoading } = useMenuItems();
  const { data: tables = [], isLoading: tablesLoading } = useTables();

  // Normalize the QA OrderSummary list shape into the fields this dashboard needs.
  // (OrderSummary uses orderId/settlementStatus; it has no `type`.)
  const orders = (ordersResult?.data ?? []).map((o) => ({
    id: o.orderId,
    orderNo: o.orderNo,
    status: o.settlementStatus,
    totalPaisa: o.totalPaisa,
    openedAt: o.openedAt,
  }));

  const stats = useMemo(() => {
    const closedOrders = orders.filter((o) => o.status === "CLOSED");
    const activeOrders = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
    const revenuePaisa = closedOrders.reduce((sum, o) => sum + o.totalPaisa, 0);
    const occupiedTables = tables.filter((t) => t.status === "OCCUPIED").length;

    return {
      revenuePaisa,
      closedCount: closedOrders.length,
      activeCount: activeOrders.length,
      menuCount: menuItems.length,
      tableCount: tables.length,
      occupiedTables,
      availableTables: tables.length - occupiedTables,
    };
  }, [orders, menuItems, tables]);

  const recentOrders = useMemo(
    () =>
      [...orders]
        .sort((a, b) => {
          const aTime = a.openedAt ? Date.parse(a.openedAt) : 0;
          const bTime = b.openedAt ? Date.parse(b.openedAt) : 0;
          return bTime - aTime;
        })
        .slice(0, 8),
    [orders],
  );

  if (ordersLoading || menuLoading || tablesLoading) {
    return <DashboardSkeleton />;
  }

  const roleLabel = roles[0]?.replace(/_/g, " ") ?? "Staff";

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview for your branch — signed in as {roleLabel}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Closed sales"
          value={<MoneyDisplay paisa={stats.revenuePaisa} />}
          description={`${stats.closedCount} completed order${stats.closedCount === 1 ? "" : "s"}`}
          icon={CircleDollarSign}
        />
        <StatCard
          title="Active orders"
          value={stats.activeCount}
          description="Open, in kitchen, or being served"
          icon={ClipboardList}
        />
        <StatCard
          title="Menu items"
          value={stats.menuCount}
          description="Active items on this branch menu"
          icon={UtensilsCrossed}
        />
        <StatCard
          title="Dining tables"
          value={`${stats.occupiedTables} / ${stats.tableCount}`}
          description={`${stats.availableTables} available now`}
          icon={LayoutGrid}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent orders</CardTitle>
          <CardDescription>Latest activity for this branch</CardDescription>
        </CardHeader>
        <CardContent>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders yet for this branch.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Order</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <OrderRow key={order.id} order={order} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3 text-sm">
        <QuickLink href="/app/pos" label="POS terminal" permission="pos.order.view" />
        <QuickLink href="/app/kitchen" label="Kitchen display" permission="pos.kds.view" />
        <QuickLink
          href="/app/finance/accounts"
          label="Finance accounts"
          permission="finance.journal.view"
        />
      </div>
    </section>
  );
}

function OrderRow({ order }: { order: DashboardOrder }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2.5 pr-4 font-medium">{order.orderNo ?? order.id.slice(0, 8)}</td>
      <td className="py-2.5 pr-4">
        <StatusBadge
          status={orderStatusVariant(order.status)}
          label={order.status.replace(/_/g, " ")}
        />
      </td>
      <td className="py-2.5 pr-4 text-right tabular-nums">
        <MoneyDisplay paisa={order.totalPaisa} />
      </td>
    </tr>
  );
}

function QuickLink({
  href,
  label,
  permission,
}: {
  href: string;
  label: string;
  // Hide the quick-link if the signed-in role lacks the permission for its target
  // page (the route itself is also guarded, but showing a dead link is poor UX).
  permission?: string;
}) {
  const { permissions } = useCurrentUser();
  if (permission && !permissions.includes(permission)) {
    return null;
  }
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md border border-border px-3 py-1.5 text-muted-foreground",
        "hover:border-primary/40 hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

export function TenantDashboard() {
  const { permissions } = useCurrentUser();
  const canViewOrders = permissions.includes("pos.order.view");

  if (!canViewOrders) {
    return <KitchenDashboard />;
  }

  return <OperationsDashboard />;
}
