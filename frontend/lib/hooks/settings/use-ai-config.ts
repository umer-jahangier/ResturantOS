"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AiConfigRepository } from "@/lib/repositories/ai-config.repository";
import type {
  ApiAiConfigRequest,
  ApiAiConfigTestRequest,
} from "@/lib/api-client/schemas/ai-config.schema";

export type { ApiAiConfigRequest, ApiAiConfigTestRequest };

const AI_CONFIG_KEY = ["ai-config"] as const;

/** Fetch the tenant's current AI config (masked key). */
export function useAiConfig() {
  return useQuery({
    queryKey: AI_CONFIG_KEY,
    queryFn: () => AiConfigRepository.getConfig(),
  });
}

/** Save (create/update) the tenant's AI config. Invalidates the cache on success. */
export function useSaveAiConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ApiAiConfigRequest) => AiConfigRepository.saveConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AI_CONFIG_KEY });
    },
  });
}

/** Delete the tenant's AI config. Invalidates the cache on success. */
export function useDeleteAiConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => AiConfigRepository.deleteConfig(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AI_CONFIG_KEY });
    },
  });
}

/** Test connection with provided credentials. Does NOT save. */
export function useTestAiConnection() {
  return useMutation({
    mutationFn: (data: ApiAiConfigTestRequest) => AiConfigRepository.testConnection(data),
  });
}
