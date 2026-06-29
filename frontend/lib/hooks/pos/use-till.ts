"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import type { OpenTillPayload, CloseTillPayload } from "@/lib/models/pos.model";

const OFFLINE_ERROR =
  "This action requires a connection. Period lock, approvals and payments are processed online.";

export function useTillSession(tillId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.pos.till(tillId ?? ""),
    queryFn: () => PosRepository.getTill(tillId!),
    enabled: !!tillId,
  });
}

export function useOpenTill() {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: OpenTillPayload) => {
      if (!isOnline) throw new Error(OFFLINE_ERROR);
      return PosRepository.openTill(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos", "tills"] });
    },
  });
}

export function useCloseTill() {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tillId,
      payload,
      idempotencyKey,
    }: {
      tillId: string;
      payload: CloseTillPayload;
      idempotencyKey: string;
    }) => {
      if (!isOnline) throw new Error(OFFLINE_ERROR);
      return PosRepository.closeTill(tillId, payload, idempotencyKey);
    },
    onSuccess: (_data, { tillId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.till(tillId) });
      queryClient.invalidateQueries({ queryKey: ["pos", "tills"] });
    },
  });
}
