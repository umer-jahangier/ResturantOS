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
