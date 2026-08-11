"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PrintRepository } from "@/lib/repositories/print.repository";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

export const printQueryKeys = {
  all: () => ["print"] as const,
  issue: (branchId: string, orderId: string, issueKey: string) =>
    ["print", branchId, "orders", orderId, "issue", issueKey] as const,
  job: (printJobId: string) => ["print", "jobs", printJobId] as const,
};

/**
 * Issue the customer receipt for an order and hand back the document to render.
 *
 * <h2>Why a `useQuery` around something that WRITES</h2>
 *
 * Issuing allocates a sequence number and inserts a row, so it is a POST. But the screen's job is
 * "get me the document for this order", and `QueryBoundary` — which every data-fetching screen in
 * this product is required to use — takes a query result. Wrapping the POST in a query gives the
 * page the error/pending/retry shape it must have.
 *
 * <p>That is only honest because of the idempotency key. It is generated ONCE per mount, so:
 *
 * <ul>
 *   <li>TanStack's automatic retry after a network blip returns the SAME issue, not a second one;</li>
 *   <li>the retry button on the error state re-attempts the same issue rather than creating one;</li>
 *   <li>a re-render never re-issues, because the key is part of the query key and the result is
 *       cached.</li>
 * </ul>
 *
 * <p>`staleTime: Infinity` and no refetch on focus, so tabbing away from a printed bill and back
 * does not put a second row in the reprint history. Opening the route AGAIN — a fresh mount — is a
 * deliberate reprint, gets a fresh key, and is correctly recorded as issue 2.
 */
export function useIssueReceipt(orderId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();

  // One key per mount. `useState` with an initialiser, not `useMemo` — useMemo is a performance
  // hint React may discard, and a discarded idempotency key means a duplicate print job.
  const [issueKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `issue-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  return useQuery({
    queryKey: printQueryKeys.issue(branchId ?? "", orderId, issueKey),
    queryFn: () => PrintRepository.issueReceipt(orderId, branchId as string, issueKey),
    enabled: isAuthenticated && Boolean(branchId) && Boolean(orderId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Re-serve a stored document by its job id. A pure read; allocates nothing. */
export function usePrintJob(printJobId: string | null) {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: printQueryKeys.job(printJobId ?? ""),
    queryFn: () => PrintRepository.getPrintJob(printJobId as string),
    enabled: isAuthenticated && Boolean(printJobId),
    staleTime: Infinity,
  });
}
