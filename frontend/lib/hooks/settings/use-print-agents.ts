"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PrintAgentRepository } from "@/lib/repositories/print-agent.repository";
import { AGENT_CONNECTED_WINDOW_MS } from "@/lib/models/print-agent.model";
import type { EnrolPrintAgentInput } from "@/lib/api-client/schemas/print-agent.schema";

export const printAgentKeys = {
  all: () => ["print-agents"] as const,
  branch: (branchId: string) => ["print-agents", "branch", branchId] as const,
  health: (branchId: string) => ["print-agents", "health", branchId] as const,
};

/**
 * What each of this branch's printers has done with the jobs it was given (S8).
 *
 * <p>Polled on the same interval as the agent list, because the two answers are read side by side
 * and a screen where one half is fresh and the other is a minute old shows a printer as failing
 * next to an agent that reconnected forty seconds ago.
 *
 * <p><b>A failed read is not an empty health list.</b> The caller gets `isError` and must say so:
 * "no printer has failed" and "we could not find out" are the two sentences this whole item exists
 * to keep apart.
 */
export function usePrinterHealth(branchId: string | null) {
  return useQuery({
    queryKey: printAgentKeys.health(branchId ?? ""),
    queryFn: () => PrintAgentRepository.health(branchId as string),
    enabled: Boolean(branchId),
    refetchInterval: AGENT_CONNECTED_WINDOW_MS,
  });
}

/**
 * The branch's print agents, re-read on a timer.
 *
 * <h2>Why this one polls when almost nothing else in the product does</h2>
 *
 * <p>The single question this screen has to answer is "did the thing I just installed come up?".
 * A manager who has to reload a page to find out will conclude the agent is broken and try again;
 * the answer changes on its own within three seconds and the screen has to show that.
 *
 * <p>The interval is one connected-window, so a transition from NEVER_STARTED to CONNECTED is
 * visible within roughly the time it takes to alt-tab back to the browser. `refetchIntervalInBackground`
 * is left OFF: a settings tab left open on a back-office machine overnight should not be polling.
 *
 * <p><b>A failed read is never an empty agent list.</b> The caller gets `isError` and
 * `data === undefined` and is expected to render an error through `QueryBoundary` — an empty list
 * here reads as "no agent is enrolled", which is the sentence that makes a manager enrol a second
 * one and then wonder why two machines are fighting over the same tickets.
 */
export function usePrintAgents(branchId: string | null) {
  return useQuery({
    queryKey: printAgentKeys.branch(branchId ?? ""),
    queryFn: () => PrintAgentRepository.list(branchId as string),
    enabled: Boolean(branchId),
    refetchInterval: AGENT_CONNECTED_WINDOW_MS,
  });
}

/**
 * Enrol a new agent.
 *
 * <p>The mutation RESULT carries the one-time credential. It is deliberately not written into the
 * query cache: cached data is serialised into the devtools, replayed on a refetch and kept for the
 * cache lifetime, and a secret that exists in a second place has two chances to leak and only one
 * of them gets audited. The caller holds it in component state, shows it once, and drops it.
 */
export function useEnrolPrintAgent(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<EnrolPrintAgentInput, "branchId">) =>
      PrintAgentRepository.enrol({ ...input, branchId: branchId as string }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: printAgentKeys.branch(branchId ?? "") });
    },
  });
}

export function useRevokePrintAgent(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => PrintAgentRepository.revoke(agentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: printAgentKeys.branch(branchId ?? "") });
    },
  });
}
