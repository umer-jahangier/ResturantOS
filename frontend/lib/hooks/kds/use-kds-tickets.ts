"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KdsRepository } from "@/lib/repositories/kds.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

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
