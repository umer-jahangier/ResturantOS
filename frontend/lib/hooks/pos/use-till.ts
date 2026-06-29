"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { OpenTillPayload, CloseTillPayload } from "@/lib/models/pos.model";

export function useTillSession(tillId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.pos.till(tillId ?? ""),
    queryFn: () => PosRepository.getTill(tillId!),
    enabled: !!tillId,
  });
}

export function useOpenTill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: OpenTillPayload) => PosRepository.openTill(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos", "tills"] });
    },
  });
}

export function useCloseTill() {
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
    }) => PosRepository.closeTill(tillId, payload, idempotencyKey),
    onSuccess: (_data, { tillId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.till(tillId) });
      queryClient.invalidateQueries({ queryKey: ["pos", "tills"] });
    },
  });
}
