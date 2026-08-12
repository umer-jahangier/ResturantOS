"use client";

import { useQuery } from "@tanstack/react-query";

import { OrderBillRepository } from "@/lib/repositories/order-bill.repository";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { PrintJobIssue } from "@/lib/models/order-bill.model";

export const orderBillQueryKeys = {
  history: (branchId: string, orderId: string) =>
    ["pos", branchId, "orders", orderId, "print-jobs"] as const,
};

/**
 * Whether this order has produced any paper, and when.
 *
 * <h2>Why this is a query and `useIssueReceipt` is not</h2>
 *
 * <p>`useIssueReceipt` wraps a POST that ALLOCATES a sequence number: asking it "is there a bill?"
 * would create one. This is a plain GET over the same rows, so a screen may ask on every render,
 * on every refocus, and after every payment, without inflating the count of pieces of paper a
 * customer was handed.
 *
 * <p>Kept deliberately un-cached-forever (`staleTime` default) because the answer changes
 * underneath it: the bill appears the moment the tender is recorded, dispatched after that
 * transaction commits. The Charge page invalidates nothing to see it — it refetches.
 */
export function useOrderPrintHistory(orderId: string, enabled = true) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<PrintJobIssue[]>({
    queryKey: orderBillQueryKeys.history(branchId ?? "", orderId),
    queryFn: () => OrderBillRepository.history(orderId),
    enabled: isAuthenticated && Boolean(branchId) && Boolean(orderId) && enabled,
  });
}
