"use client";

import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomer } from "@/lib/hooks/crm/use-customers";

/**
 * Loyalty standing for the selected customer.
 *
 * <p>Points accrue on ORDER_CLOSED and are debited back on ORDER_REFUNDED. The refund half had
 * never once run before the shared event contract added `customerId` to that payload — the
 * consumer read a field the producer did not publish and returned early every time.
 */
export function CustomerDetail({ customerId }: { customerId: string | null }) {
  const customerQuery = useCustomer(customerId);
  const { data: customer, isLoading } = customerQuery;

  if (!customerId) {
    return (
      <Card className="p-6 text-small text-muted-foreground">
        Select a customer to see their loyalty standing.
      </Card>
    );
  }

  /*
   * A failure is not a longer wait (UI-SPEC §8).
   *
   * `if (isLoading || !customer)` left this card skeletonised FOREVER when the CRM service was
   * down — the least honest of all the loading states, because a skeleton is an active promise
   * that content is coming. A cashier looking up a regular's points balance at the counter had no
   * way to learn the request had failed, and no retry to press.
   */
  if (customerQuery.isError) {
    return (
      <Card className="p-6">
        <QueryErrorNotice
          what="this customer's loyalty standing"
          moduleLabel="Customers"
          error={customerQuery.error}
          onRetry={() => void customerQuery.refetch()}
          isRetrying={customerQuery.isFetching}
        />
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="space-y-3 p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-20 w-full" />
      </Card>
    );
  }

  if (!customer) {
    return (
      <Card className="p-6 text-small text-muted-foreground">
        That customer is no longer on file.
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-6">
      <div className="space-y-1">
        <h2 className="text-h2 font-semibold">{customer.name}</h2>
        <p className="text-small tabular-nums text-muted-foreground">{customer.phone}</p>
        {customer.email ? (
          <p className="text-small text-muted-foreground">{customer.email}</p>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-4 border-t pt-4 text-small">
        <div>
          <dt className="text-muted-foreground">Tier</dt>
          <dd className="mt-1">
            {customer.tier ? (
              <StatusBadge
                status={
                  customer.tier === "GOLD"
                    ? "warning"
                    : customer.tier === "SILVER"
                      ? "active"
                      : "inactive"
                }
                label={customer.tier}
              />
            ) : (
              <span className="text-muted-foreground">Not yet enrolled</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Points</dt>
          <dd className="mt-1 tabular-nums">{customer.pointsBalance}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted-foreground">Lifetime spend</dt>
          <dd className="mt-1 tabular-nums">
            <MoneyDisplay paisa={customer.lifetimeSpendPaisa} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}
