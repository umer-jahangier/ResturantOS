"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PrintRepository } from "@/lib/repositories/print.repository";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

export const printQueryKeys = {
  all: () => ["print"] as const,
  issue: (branchId: string, orderId: string, issueKey: string) =>
    ["print", branchId, "orders", orderId, "issue", issueKey] as const,
  job: (printJobId: string) => ["print", "jobs", printJobId] as const,
  delivery: (printJobId: string) => ["print", "jobs", printJobId, "delivery"] as const,
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

/**
 * ~5 minutes at the poll interval below. A bill nobody has printed in five minutes is not going to
 * become interesting on the sixth, and a receipt tab left open on a counter overnight must not sit
 * there asking the gateway a question every three seconds until closing time.
 */
const MAX_DELIVERY_POLLS = 100;

/** One agent poll interval. There is no point asking faster than the agent can answer. */
const DELIVERY_POLL_MS = 3_000;

/**
 * Watch what actually happened to an issued bill.
 *
 * <h2>Why the screen watches instead of predicting</h2>
 *
 * <p>The bill screen used to state "the branch print agent will put it on paper" the instant the
 * issue returned — before any agent had been asked, and true only if one was running. Measured on
 * 2026-08-12: nine enrolled agents, every one of them cold, and the sentence rendered anyway. This
 * query is the difference between a screen that says what will happen and one that says what did:
 * it re-reads the same `print_jobs` row until the agent's own acknowledgement moves it to
 * `PRINTED`, or until it is clear nothing is going to.
 *
 * <p>`GET /print-jobs/{id}` is a pure read that allocates nothing, so polling it cannot inflate the
 * reprint count the way re-issuing would.
 *
 * <p>Polling STOPS on a terminal status. `DEAD_LETTERED` is terminal by design on the agent side
 * too — a job that has spent its attempt budget will never be retried automatically — so a screen
 * that kept asking would be waiting for an answer that cannot change.
 */
export function useReceiptDelivery(printJobId: string | null, enabled: boolean) {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: printQueryKeys.delivery(printJobId ?? ""),
    queryFn: () => PrintRepository.getPrintJob(printJobId as string),
    enabled: isAuthenticated && Boolean(printJobId) && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "PRINTED" || status === "DEAD_LETTERED") return false;
      if (query.state.dataUpdateCount >= MAX_DELIVERY_POLLS) return false;
      return DELIVERY_POLL_MS;
    },
    refetchOnWindowFocus: false,
    // The point of this query is that the answer changes underneath it.
    staleTime: 0,
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

/**
 * Re-enqueue an order's kitchen tickets for the branch print agent.
 *
 * <p>A MUTATION, not a query, and not idempotency-keyed: every press is a deliberate request for
 * another piece of paper. That is the difference between this and the receipt issue above, where a
 * retried POST must return the same issue rather than inflating the reprint count — here the cook
 * pressing it twice wants two tickets.
 *
 * <p>The result is the list of stations reprinted. It can legitimately be EMPTY (nothing was ever
 * fired, or no station had a printer when it was), and the caller must say that rather than
 * reporting a success it did not get.
 */
export function useReprintKitchenTickets() {
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (orderId: string) =>
      PrintRepository.reprintKitchenTickets(orderId, branchId as string),
  });
}
