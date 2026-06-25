"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SessionRepository } from "@/lib/repositories/session.repository";
import { useSessionStore } from "@/lib/auth/session";
import type { ApiError } from "@/lib/api-client/errors";

// Layer-3 hook: logs out server-side, then clears the in-memory session, the
// has_session marker, and the entire query cache (regardless of API outcome).
export function useLogout() {
  const clearSession = useSessionStore((state) => state.clearSession);
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, void>({
    mutationFn: () => SessionRepository.logout(),
    onSettled: () => {
      clearSession();
      queryClient.clear();
    },
  });
}
