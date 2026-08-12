"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KdsRepository } from "@/lib/repositories/kds.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { KdsItemStatus } from "@/lib/models/kds.model";

/**
 * Fetches open KDS tickets for a branch+station.
 * Polls every 10s as a fallback when WebSocket is disconnected.
 */
export function useKdsTickets(branchId: string, stationCode?: string) {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.kds.tickets(branchId, stationCode),
    queryFn: () => KdsRepository.getTickets(branchId, stationCode),
    enabled: isAuthenticated && !!branchId,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useKdsStations(branchId: string) {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.kds.stations(branchId),
    queryFn: () => KdsRepository.getStations(branchId),
    enabled: isAuthenticated && !!branchId,
    staleTime: 60_000,
  });
}

/** Bumps a KDS ticket item (PENDING→COOKING or COOKING→READY). */
export function useBumpItem(branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, itemId }: { ticketId: string; itemId: string }) =>
      KdsRepository.bumpItem(ticketId, itemId, branchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kds", branchId] });
    },
  });
}

/**
 * Advances a KDS ticket item to a specific target status via the explicit
 * item-status endpoint (07.3-05, KDS-04) — drives the New/Started/Preparing/Ready
 * item-column board and the ticket detail page's per-item transition controls.
 */
export function useUpdateItemStatus(branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      itemId,
      status,
    }: {
      ticketId: string;
      itemId: string;
      status: KdsItemStatus;
    }) => KdsRepository.updateItemStatus(ticketId, itemId, status, branchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kds", branchId] });
    },
  });
}

/**
 * What is on this board from a business day that has already closed (F17).
 *
 * `enabled` is caller-controlled so the board can poll it cheaply for the header badge and the
 * dialog can force a fresh read the moment it opens — the cook must be shown the numbers as they
 * are now, not as they were when the page loaded ten minutes ago.
 */
export function useStaleKdsTickets(
  branchId: string,
  stationCode?: string,
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.kds.stale(branchId, stationCode),
    queryFn: () => KdsRepository.getStaleTickets(branchId, stationCode),
    enabled: isAuthenticated && !!branchId && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval,
    staleTime: 15_000,
  });
}

/** The tickets already cleared off this board — they were taken off it, not deleted. */
export function useClearedKdsTickets(branchId: string, stationCode?: string) {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.kds.tickets(branchId, stationCode, "CLEARED"),
    queryFn: () => KdsRepository.getClearedTickets(branchId, stationCode),
    enabled: isAuthenticated && !!branchId,
    staleTime: 15_000,
  });
}

/**
 * Clears this board's expired tickets.
 *
 * Invalidates the WHOLE `["kds", branchId]` subtree rather than one key: the board, the stale
 * summary, the cleared list and the station picker's counts all changed, and a screen still
 * showing "12 old tickets" after they went is the same lie in a smaller box.
 */
export function useClearStaleKdsTickets(branchId: string, stationCode?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => KdsRepository.clearStaleTickets(branchId, stationCode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kds", branchId] });
    },
  });
}

/** Recalls a READY ticket back to COOKING. */
export function useRecallTicket(branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId }: { ticketId: string }) =>
      KdsRepository.recallTicket(ticketId, branchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kds", branchId] });
    },
  });
}

/**
 * Full ticket detail (all revisions grouped, per-item status+revisionNo+firedAt, plus
 * the order-level "Kitchen Notes" callout) for the KDS "tap a ticket for full order
 * detail" view (KDS-03).
 */
export function useKdsTicketDetail(branchId: string, ticketId: string) {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.kds.ticketDetail(branchId, ticketId),
    queryFn: () => KdsRepository.getTicketDetail(ticketId, branchId),
    enabled: isAuthenticated && !!branchId && !!ticketId,
  });
}
