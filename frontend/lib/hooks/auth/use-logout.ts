"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { SessionRepository } from "@/lib/repositories/session.repository";
import { useSessionStore } from "@/lib/auth/session";
import type { ApiError } from "@/lib/api-client/errors";

// Layer-3 hook: logs out server-side, then clears the in-memory session, the
// has_session marker, and the entire query cache (regardless of API outcome),
// and finally sends the user back to the login screen. `replace` (not `push`)
// drops the protected page from history so Back can't return to it.
export function useLogout() {
  const clearSession = useSessionStore((state) => state.clearSession);
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation<void, ApiError, void>({
    mutationFn: () => SessionRepository.logout(),
    onSettled: () => {
      clearSession();
      queryClient.clear();
      router.replace("/login");
    },
  });
}
