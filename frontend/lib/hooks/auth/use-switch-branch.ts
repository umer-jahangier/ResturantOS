"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { SessionRepository } from "@/lib/repositories/session.repository";
import { useSessionStore } from "@/lib/auth/session";
import type { ApiError } from "@/lib/api-client/errors";
import type { Session } from "@/lib/models/auth.model";

// Layer-3 hook: POST /api/v1/auth/switch-branch reissues the access JWT (new
// branch_id/permissions/attributes). On success we store the reissued session
// (which IS the active branch) and `queryClient.clear()` — every server-state
// key is branch-scoped, so a full clear is the cheapest correct invalidation.
// On a 403 BRANCH_ACCESS_DENIED (W3) we surface the error and leave the session
// + active branch untouched.
export function useSwitchBranch() {
  const setSession = useSessionStore((state) => state.setSession);
  const queryClient = useQueryClient();

  return useMutation<Session, ApiError, string>({
    mutationFn: (branchId) => SessionRepository.switchBranch(branchId),
    onSuccess: (session) => {
      // setSession stores the reissued JWT AND sets the active branch
      // (session.branchId) — there is no separate active-branch store.
      setSession(session);
      queryClient.clear();
    },
    onError: (error) => {
      if (error.isBranchAccessDenied()) {
        toast.error("You don't have access to that branch");
      }
      // Any other error: leave session + active branch unchanged.
    },
  });
}
