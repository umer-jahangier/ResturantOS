"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { TerminalRepository } from "@/lib/repositories/terminal.repository";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { PosTerminal } from "@/lib/models/terminal.model";
import type {
  CreateTerminalInput,
  UpdateTerminalInput,
} from "@/lib/api-client/schemas/terminal.schema";
// Type-only import — permitted from lib/hooks/** (the layer rule covers components/** and app/**).
import type { ApiError } from "@/lib/api-client/errors";

/**
 * POS terminal CATALOGUE hooks (28-09), mirroring `use-station-admin.ts` from one wave earlier.
 *
 * <p>The repetition is deliberate: two catalogue screens built the same way are two screens a
 * manager already knows how to use, and the codebase gets one pattern rather than two.
 *
 * <p>Keys are local for the same reason `stationKeys` and `userKeys` are — `query-keys.ts` is
 * edited by every concurrent workstream and committing it by path would sweep another agent's
 * uncommitted lines into this plan's commit.
 */
export const terminalKeys = {
  all: (branchId: string) => ["pos", branchId, "terminals"] as const,
  /** A CHILD of `all`, so one invalidation refreshes both listings. */
  catalogue: (branchId: string) => ["pos", branchId, "terminals", "catalogue"] as const,
};

/** ACTIVE terminals — what a till's own picker should offer (plan 28-13). */
export function useTerminals() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: terminalKeys.all(branchId),
    queryFn: () => TerminalRepository.list(branchId, false),
    enabled: isAuthenticated && !!branchId,
  });
}

/**
 * Every terminal including retired ones — the catalogue view.
 *
 * <p>`includeInactive` is refused server-side for a caller without `pos.terminals.admin`, so this
 * hook belongs only behind that gate. The active listing above is the one a cashier may read.
 */
export function useTerminalCatalogue() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: terminalKeys.catalogue(branchId),
    queryFn: () => TerminalRepository.list(branchId, true),
    enabled: isAuthenticated && !!branchId,
  });
}

function invalidateTerminals(qc: ReturnType<typeof useQueryClient>, branchId: string) {
  void qc.invalidateQueries({ queryKey: terminalKeys.all(branchId) });
}

export function useCreateTerminal() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<PosTerminal, ApiError, CreateTerminalInput>({
    mutationFn: (input) => TerminalRepository.create(branchId, input),
    onSuccess: () => invalidateTerminals(qc, branchId),
  });
}

export function useUpdateTerminal() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<PosTerminal, ApiError, { id: string; input: UpdateTerminalInput }>({
    mutationFn: ({ id, input }) => TerminalRepository.update(id, branchId, input),
    onSuccess: () => invalidateTerminals(qc, branchId),
  });
}

export function useSetTerminalActive() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<PosTerminal, ApiError, { id: string; active: boolean }>({
    mutationFn: ({ id, active }) => TerminalRepository.setActive(id, branchId, active),
    onSuccess: () => invalidateTerminals(qc, branchId),
  });
}
