"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ReceiptConfigRepository } from "@/lib/repositories/receipt-config.repository";
import type { ReceiptConfig } from "@/lib/models/receipt-config.model";

export const receiptConfigKeys = {
  all: () => ["receipt-config"] as const,
  branch: (branchId: string) => ["receipt-config", "branch", branchId] as const,
};

/**
 * A branch's printer registry.
 *
 * <h2>The rule this hook exists to enforce</h2>
 *
 * <p><b>A failed read is NEVER an empty configuration.</b> No `placeholderData`, no `initialData`,
 * no `select` that coalesces `undefined` into `EMPTY_RECEIPT_CONFIG`. The caller gets `isError`
 * and `data === undefined`, and is expected to render an error state through `QueryBoundary`.
 *
 * <p>The register's single largest defect class is screens that render "no data" when the request
 * failed. On a printer-configuration screen that failure has teeth: a manager sees an empty
 * printer list, concludes nothing is configured, and enters a second configuration over the top of
 * a first one that was fine. Then two configurations disagree and the kitchen prints to whichever
 * one won.
 *
 * <p>{@code EMPTY_RECEIPT_CONFIG} exists in the model for form initialisation. It is not a
 * fallback, and this hook does not reach for it.
 */
export function useReceiptConfig(branchId: string | null) {
  return useQuery({
    queryKey: receiptConfigKeys.branch(branchId ?? ""),
    queryFn: () => ReceiptConfigRepository.get(branchId as string),
    enabled: Boolean(branchId),
  });
}

/**
 * Replace a branch's printer registry.
 *
 * <p>On success the read key is invalidated so the next render shows what the SERVER stored,
 * including the completeness report — which is the only thing that will tell the operator a
 * kitchen station they declared has nowhere to print.
 */
export function useSaveReceiptConfig(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: ReceiptConfig) => ReceiptConfigRepository.save(branchId as string, config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: receiptConfigKeys.branch(branchId ?? "") });
    },
  });
}
