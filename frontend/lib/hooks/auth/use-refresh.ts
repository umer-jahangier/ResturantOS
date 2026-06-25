"use client";

import { useMutation } from "@tanstack/react-query";
import { refreshSession } from "@/lib/auth/session";

// Layer-3 hook for an explicit refresh (e.g. client bootstrap after a reload).
// Returns whether the refresh succeeded.
export function useRefresh() {
  return useMutation<boolean, Error, void>({
    mutationFn: () => refreshSession(),
  });
}
