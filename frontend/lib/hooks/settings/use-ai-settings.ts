"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AiSettingsRepository } from "@/lib/repositories/ai-settings.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { AiSettings } from "@/lib/models/ai-settings.model";
import type { UpdateAiSettingsInput } from "@/lib/api-client/schemas/ai-settings.schema";
// Type-only import — permitted from lib/hooks/** (the ESLint layer rule blocks components/**).
import type { ApiError } from "@/lib/api-client/errors";

/**
 * The tenant's AI provider + credential state (Program C).
 *
 * Not branch-scoped: one restaurant group, one provider account, one bill.
 */
export function useAiSettings() {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.nlq.aiSettings(),
    queryFn: () => AiSettingsRepository.get(),
    enabled: isAuthenticated,
  });
}

/**
 * Saving a key invalidates the AI settings AND nothing else.
 *
 * <p>Note what is deliberately NOT done here: the mutation does not keep the submitted key
 * anywhere. `onSuccess` seeds the cache from the SERVER'S response — which has no key field — so
 * the credential exists only inside the form's own state for the duration of the request and is
 * cleared on success. It never enters the query cache, where it would survive navigation, be
 * visible in React Query DevTools, and be serialised by any cache-persistence layer added later.
 */
export function useUpdateAiSettings() {
  const qc = useQueryClient();
  return useMutation<AiSettings, ApiError, UpdateAiSettingsInput>({
    mutationFn: (input) => AiSettingsRepository.update(input),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.nlq.aiSettings(), settings);
      qc.invalidateQueries({ queryKey: queryKeys.nlq.aiSettings() });
    },
  });
}

/** Reverts the tenant to the platform key. */
export function useClearAiSettings() {
  const qc = useQueryClient();
  return useMutation<AiSettings, ApiError, void>({
    mutationFn: () => AiSettingsRepository.clear(),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.nlq.aiSettings(), settings);
      qc.invalidateQueries({ queryKey: queryKeys.nlq.aiSettings() });
    },
  });
}
